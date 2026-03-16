const path = require("path");
const fs = require("fs");
const { monitorEventLoopDelay } = require("perf_hooks");
if (fs.existsSync("./config.env")) {
  require("dotenv").config({ path: "./config.env" });
}

const { suppressLibsignalLogs } = require("./core/helpers");

suppressLibsignalLogs();

// PostgreSQL savepoint rollback gürültüsünü azalt (bağlantı havuzu otomatik düzeltiyor)
if (process.env.SUPPRESS_PG_SAVEPOINT_LOG !== "false") {
  const config = require("./config");
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = function (chunk, enc, cb) {
    const s = typeof chunk === "string" ? chunk : String(chunk || "");
    if (s.includes("savepoint") && s.includes("does not exist")) {
      if (config.DEBUG) origWrite(chunk, enc, cb);
      return typeof cb === "function" ? (cb(), true) : true;
    }
    return origWrite(chunk, enc, cb);
  };
}

const { initializeDatabase, BotVariable } = require("./core/database");
const { BotManager } = require("./core/manager");
const config = require("./config");
const { SESSION, logger } = config;
const http = require("http");
const {
  ensureTempDir,
  TEMP_DIR,
  initializeKickBot,
  cleanupKickBot,
  startTempCleanup,
  stopTempCleanup,
} = require("./core/helpers");
const { applyDatabaseCaching, shutdownCache } = require("./core/db-cache");

const MEMORY_CHECK_INTERVAL = 3 * 60 * 1000; // 3 dakikada bir
const HEAP_WARN_THRESHOLD_MB = 300;
// Her JID için tutulacak maksimum mesaj sayısı
const MAX_MESSAGES_PER_JID = 30;
// Store'da tutulacak maksimum JID (sohbet) sayısı
const MAX_STORE_JIDS = 200;

let _memoryMonitorTimer = null;
let _runtimeWatchdogTimer = null;

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const EVENT_LOOP_WARN_MS = parseInt(process.env.EVENT_LOOP_WARN_MS || (IS_PRODUCTION ? "1000" : "700"), 10);
const EVENT_LOOP_RESTART_MS = parseInt(process.env.EVENT_LOOP_RESTART_MS || (IS_PRODUCTION ? "12000" : "6000"), 10);
const WATCHDOG_INTERVAL_MS = parseInt(process.env.WATCHDOG_INTERVAL_MS || "60000", 10);
const ALL_BOTS_DOWN_RESTART_MS = parseInt(process.env.ALL_BOTS_DOWN_RESTART_MS || String((IS_PRODUCTION ? 45 : 20) * 60 * 1000), 10);
const EVENT_LOOP_BREACH_WINDOW = Math.max(parseInt(process.env.EVENT_LOOP_BREACH_WINDOW || "5", 10), 1);
const EVENT_LOOP_BREACH_REQUIRED = Math.max(parseInt(process.env.EVENT_LOOP_BREACH_REQUIRED || "3", 10), 1);
const EVENT_LOOP_MITIGATION_COOLDOWN_MS = parseInt(process.env.EVENT_LOOP_MITIGATION_COOLDOWN_MS || "120000", 10);
const EXIT_GUARD_WINDOW_MS = parseInt(process.env.WATCHDOG_EXIT_GUARD_MS || String(5 * 60 * 1000), 10);

let _allBotsDownSince = null;
let _eventLoopBreachHistory = [];
let _lastMitigationAt = 0;
let _intakeResumeTimer = null;
let _lastExitAt = 0;
let _scheduledExitTimer = null;
let _manualReauthMode = false;

function isLikelyPermanentAuthError(text) {
  if (!text) return false;
  return /(invalid\s*pre\s*key|prekey\s*id|session\s+logged\s+out|logged\s*out|manual\s*re-?auth|device\s*removed|bad\s*session|session\s*invalid|401\b|unauthori[sz]ed)/i.test(text);
}

function getBotAuthProblem(bot) {
  const candidates = [
    bot?.lastDisconnect,
    bot?.connectionUpdate,
    bot?.lastError,
    bot?.authError,
    bot?.error,
    bot?.sock?.lastDisconnect,
    bot?.sock?.ws?.closeReason,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const text = typeof candidate === "string"
      ? candidate
      : [candidate?.message, candidate?.error?.message, candidate?.reason, candidate?.output?.statusCode, candidate?.statusCode]
          .filter(Boolean)
          .join(" ");
    if (isLikelyPermanentAuthError(text)) return text;
  }
  return null;
}

function applyCommandIntakeBackpressure(botManager, reason) {
  const pauseMs = EVENT_LOOP_MITIGATION_COOLDOWN_MS;
  const pauseUntil = Date.now() + pauseMs;
  global.__LADES_WATCHDOG_INTAKE_PAUSED_UNTIL = pauseUntil;

  const pausedSessions = [];
  for (const [sessionId, bot] of botManager.bots.entries()) {
    const socket = bot?.sock?.ws?._socket;
    if (socket && typeof socket.pause === "function") {
      try {
        socket.pause();
        pausedSessions.push(sessionId);
      } catch (_) {
        // best effort
      }
    }
  }

  if (_intakeResumeTimer) clearTimeout(_intakeResumeTimer);
  _intakeResumeTimer = setTimeout(() => {
    for (const [, bot] of botManager.bots.entries()) {
      const socket = bot?.sock?.ws?._socket;
      if (socket && typeof socket.resume === "function") {
        try {
          socket.resume();
        } catch (_) {
          // best effort
        }
      }
    }
    global.__LADES_WATCHDOG_INTAKE_PAUSED_UNTIL = 0;
    logger.info({ reason, pauseMs }, "Watchdog backpressure kaldırıldı, komut alımı normale dönüyor");
  }, pauseMs);
  if (_intakeResumeTimer.unref) _intakeResumeTimer.unref();

  logger.warn({ reason, pauseMs, pausedSessions }, "Watchdog: yeni komut alımı geçici olarak yavaşlatıldı/durduruldu");
}

function triggerSelfHeal(reason) {
  process.emit("watchdog:queue-drain", { reason, at: Date.now() });
  if (typeof config.sequelize?.__flushBufferedQueries === "function") {
    config.sequelize.__flushBufferedQueries().catch((err) => {
      logger.warn({ err }, "Watchdog self-heal sırasında buffered query flush başarısız");
    });
  }
}

function guardedExit(code, reason, details = {}) {
  const now = Date.now();
  const sinceLast = now - _lastExitAt;
  const cooldownLeft = Math.max(EXIT_GUARD_WINDOW_MS - sinceLast, 0);

  if (_lastExitAt > 0 && cooldownLeft > 0) {
    logger.error({ reason, cooldownLeftMs: cooldownLeft, guardWindowMs: EXIT_GUARD_WINDOW_MS, ...details }, "Exit guard aktif: PM2 restart fırtınasını azaltmak için çıkış ertelendi");
    if (!_scheduledExitTimer) {
      _scheduledExitTimer = setTimeout(() => {
        _lastExitAt = Date.now();
        logger.fatal({ reason }, "Exit guard bekleme süresi doldu, process çıkıyor");
        process.exit(code);
      }, cooldownLeft);
      if (_scheduledExitTimer.unref) _scheduledExitTimer.unref();
    }
    return;
  }

  _lastExitAt = now;
  logger.fatal({ reason, guardWindowMs: EXIT_GUARD_WINDOW_MS, ...details }, "Watchdog process çıkışı başlatıyor");
  process.exit(code);
}

function getBotSocketState(bot) {
  const wsReadyState = bot?.sock?.ws?.readyState;
  // ws.readyState: 1 => OPEN
  if (wsReadyState === 1) return "open";
  if (wsReadyState === 0) return "connecting";
  if (wsReadyState === 2) return "closing";
  if (wsReadyState === 3) return "closed";
  return "unknown";
}

function startRuntimeWatchdog(botManager) {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();

  _runtimeWatchdogTimer = setInterval(() => {
    const p99LagMs = Math.round(histogram.percentile(99) / 1e6);
    histogram.reset();

    if (p99LagMs > EVENT_LOOP_WARN_MS) {
      logger.warn({ p99LagMs, threshold: EVENT_LOOP_WARN_MS }, "Event loop gecikmesi yüksek");
    }

    const restartBreach = p99LagMs > EVENT_LOOP_RESTART_MS;
    _eventLoopBreachHistory.push(restartBreach);
    if (_eventLoopBreachHistory.length > EVENT_LOOP_BREACH_WINDOW) _eventLoopBreachHistory.shift();
    const breachCount = _eventLoopBreachHistory.filter(Boolean).length;

    if (restartBreach && breachCount >= EVENT_LOOP_BREACH_REQUIRED) {
      const now = Date.now();
      if (now - _lastMitigationAt >= EVENT_LOOP_MITIGATION_COOLDOWN_MS) {
        _lastMitigationAt = now;
        logger.error({ p99LagMs, threshold: EVENT_LOOP_RESTART_MS, breachCount, window: EVENT_LOOP_BREACH_WINDOW }, "Sürekli event-loop tıkanması tespit edildi; önce mitigation uygulanıyor");
        applyCommandIntakeBackpressure(botManager, "event-loop-lag");
        triggerSelfHeal("event-loop-lag");
      } else {
        logger.warn({ p99LagMs, breachCount, cooldownMs: EVENT_LOOP_MITIGATION_COOLDOWN_MS }, "Event-loop breach devam ediyor, mitigation cooldown aktif");
      }
    }

    const states = [];
    let openCount = 0;
    for (const [sessionId, bot] of botManager.bots.entries()) {
      const state = getBotSocketState(bot);
      if (state === "open") openCount += 1;
      states.push({ session: sessionId, state });
    }

    if (states.length > 0 && openCount === 0) {
      if (!_allBotsDownSince) {
        _allBotsDownSince = Date.now();
      }
      const downForMs = Date.now() - _allBotsDownSince;
      if (downForMs > 3 * 60 * 1000) {
        logger.warn({ downForMs, sessions: states }, "Tüm WhatsApp oturumları bağlı değil (" + Math.round(downForMs / 60000) + " dk)");
      }
      if (downForMs > ALL_BOTS_DOWN_RESTART_MS) {
        const authIssues = states
          .map(({ session }) => ({ session, issue: getBotAuthProblem(botManager.bots.get(session)) }))
          .filter((x) => x.issue);
        const allPermanentAuth = authIssues.length === states.length && states.length > 0;

        if (allPermanentAuth) {
          if (!_manualReauthMode) {
            _manualReauthMode = true;
            logger.error({ downForMs, authIssues }, "Kalıcı auth hatası tespit edildi (session invalid/prekey). Restart loop engellendi, manual re-auth gerekli");
          }
        } else {
          logger.fatal({ downForMs, sessions: states, authIssues }, "Oturumlar uzun süredir kapalı, kontrollü process restart uygulanıyor");
          guardedExit(1, "all-bots-down", { downForMs, sessionCount: states.length });
        }
      }
    } else {
      _allBotsDownSince = null;
      _manualReauthMode = false;
    }
  }, WATCHDOG_INTERVAL_MS);

  if (_runtimeWatchdogTimer.unref) _runtimeWatchdogTimer.unref();
}

function trimBaileysStore(botManager) {
  if (!botManager || !botManager.bots) return 0;
  let totalTrimmed = 0;

  for (const [sessionId, bot] of botManager.bots.entries()) {
    if (!bot || !bot.store || !bot.store.messages) continue;
    const msgs = bot.store.messages;
    const jids = Object.keys(msgs);

    // Eğer çok fazla JID varsa en eski sohbetleri sil
    if (jids.length > MAX_STORE_JIDS) {
      // Mesaj arrayleri boş olanları veya en az mesajı olanları temizle
      const sortedJids = jids.sort((a, b) => {
        const aLen = msgs[a]?.array?.length || 0;
        const bLen = msgs[b]?.array?.length || 0;
        return aLen - bLen;
      });
      const toDelete = sortedJids.slice(0, jids.length - MAX_STORE_JIDS);
      for (const jid of toDelete) {
        delete msgs[jid];
        totalTrimmed++;
      }
      logger.info({ session: sessionId, deleted: toDelete.length }, "Aşırı JID sayısı nedeniyle store sohbetleri temizlendi");
    }

    // Her JID için mesaj geçmişini kırp
    let trimmedMsgs = 0;
    for (const jid of Object.keys(msgs)) {
      const chatMessages = msgs[jid];
      if (chatMessages && chatMessages.array && chatMessages.array.length > MAX_MESSAGES_PER_JID) {
        const toRemove = chatMessages.array.length - MAX_MESSAGES_PER_JID;
        chatMessages.array.splice(0, toRemove);
        trimmedMsgs += toRemove;
      }
    }
    if (trimmedMsgs > 0) {
      totalTrimmed += trimmedMsgs;
      logger.info({ session: sessionId, trimmed: trimmedMsgs }, "Store mesajları kırpıldı");
    }
  }
  return totalTrimmed;
}

function startMemoryMonitor(botManager) {
  _memoryMonitorTimer = setInterval(() => {
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);

    if (heapMB > HEAP_WARN_THRESHOLD_MB) {
      logger.warn({ heapMB, rssMB }, `Yüksek bellek kullanımı tespit edildi`);
      console.warn(`[Bellek] Heap: ${heapMB}MB / RSS: ${rssMB}MB — yüksek kullanım!`);
    }

    // Baileys Store Cleanup: Her grupta/sohbette son MAX_MESSAGES_PER_JID mesaj dışındaki eskileri temizle
    const trimmed = trimBaileysStore(botManager);
    if (trimmed > 0) {
      console.log(`[Bellek] Store temizlendi: ${trimmed} eski mesaj/kayıt silindi.`);
      // V8 GC manuel tetikle (eğer --expose-gc ile başlatılmışsa)
      if (typeof global.gc === "function") {
        try { global.gc(); } catch (_) { /* sessizce geç */ }
      }
    }
    
  }, MEMORY_CHECK_INTERVAL);

  if (_memoryMonitorTimer.unref) _memoryMonitorTimer.unref();
}

async function main() {
  ensureTempDir();
  logger.info(`Geçici dizin oluşturuldu: ${TEMP_DIR}`);
  console.log(`Lades v${require("./package.json").version}`);
  console.log(`- Yapılandırılan oturumlar: ${SESSION.join(", ")}`);
  logger.info(`Yapılandırılan oturumlar: ${SESSION.join(", ")}`);
  if (SESSION.length === 0) {
    const warnMsg =
      "⚠️ Oturum yapılandırılmadı. Lütfen SESSION ortam değişkenini ayarlayın.";
    console.warn(warnMsg);
    logger.warn(warnMsg);
    return;
  }

  try {
    await initializeDatabase();
    console.log("- Veritabanı başlatıldı");
    logger.info("Veritabanı başarıyla başlatıldı.");
    try {
      const { syncWarnsSequence } = require("./plugins/utils/db/functions");
      await syncWarnsSequence();
    } catch (seqErr) {
      logger.warn({ err: seqErr }, "Uyarı sequence senkronizasyonu atlandı (PostgreSQL değilse normal)");
    }
    const dbRows = await BotVariable.findAll();
    const dbValues = Object.fromEntries(dbRows.map((r) => [r.key, r.value]));
    if (Object.keys(dbValues).length > 0) {
      config.loadFromDB(dbValues);
    }
  } catch (dbError) {
    console.error(
      "🚫 Veritabanı başlatılamadı veya yapılandırma yüklenemedi. Bot başlatılamıyor.",
      dbError
    );
    logger.fatal(
      "🚫 Veritabanı başlatılamadı veya yapılandırma yüklenemedi. Bot başlatılamıyor.",
      dbError
    );
    process.exit(1);
  }

  applyDatabaseCaching();

  const botManager = new BotManager();

  const shutdownHandler = async (signal) => {
    console.log(`\n${signal} alındı, kapatılıyor...`);
    logger.info(`${signal} alındı, kapatılıyor...`);

    // Eğer işlemler 8 saniyede bitmezse (PM2'nin 10s sınırından önce) zorla çık
    const forceExit = setTimeout(() => {
      console.log("Kapanma süresi aşıldı, process zorla kapatılıyor...");
      process.exit(0);
    }, 8000);
    if (forceExit.unref) forceExit.unref();

    if (_memoryMonitorTimer) clearInterval(_memoryMonitorTimer);
    if (_runtimeWatchdogTimer) clearInterval(_runtimeWatchdogTimer);
    if (_intakeResumeTimer) clearTimeout(_intakeResumeTimer);
    stopTempCleanup();
    cleanupKickBot();
    try {
      await shutdownCache();
      console.log("- DB önbellek verileri yazıldı.");
    } catch (cacheErr) {
      logger.error({ err: cacheErr }, "Kapatma sırasında cache flush hatası");
    }

    if (typeof config.sequelize?.__flushBufferedQueries === 'function') {
      try {
        await config.sequelize.__flushBufferedQueries();
        console.log("- Bekleyen veritabanı sorguları tamamlandı.");
      } catch (flushErr) {
        logger.error({ err: flushErr }, "Kapatma sırasında bekleyen sorgular tamamlanamadı");
      }
    }

    try {
      // botManager.shutdown() websocket kapanmasını beklerken sonsuza kadar asılı kalabiliyor,
      // 3 saniye içinde tamamlanmazsa kapatıp devam etmesini sağlıyoruz.
      await Promise.race([
        botManager.shutdown(),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
      console.log("- Bot bağlantıları kapatıldı.");
    } catch (botErr) {
      console.error("- Bot sonlandırılırken hata:", botErr);
    }
    
    console.log("- Tüm işlemler tamamlandı, başarılı çıkış yapılıyor.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdownHandler("SIGINT"));
  process.on("SIGTERM", () => shutdownHandler("SIGTERM"));

  await botManager.initializeBots();
  console.log("- Bot başlatma tamamlandı.");
  logger.info("Bot başlatma tamamlandı");

  initializeKickBot();

  const startServer = () => {
    const PORT = process.env.PORT || 3000;

    const server = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("OK");
      } else {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Lades Bot çalışıyor!");
      }
    });

    server.listen(PORT, () => {
      logger.info(`Web sunucusu ${PORT} portunda dinleniyor`);
    });
  };

  if (process.env.USE_SERVER !== "false") startServer();

  startMemoryMonitor(botManager);
  startRuntimeWatchdog(botManager);
  startTempCleanup();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Ana çalıştırmada kritik hata: ${error.message}`, error);
    logger.fatal({ err: error }, `Ana çalıştırmada kritik hata`);
    process.exit(1);
  });
}

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

const EVENT_LOOP_WARN_MS = parseInt(process.env.EVENT_LOOP_WARN_MS || "500", 10);
const EVENT_LOOP_RESTART_MS = parseInt(process.env.EVENT_LOOP_RESTART_MS || "2000", 10);
const WATCHDOG_INTERVAL_MS = parseInt(process.env.WATCHDOG_INTERVAL_MS || "60000", 10);
const ALL_BOTS_DOWN_RESTART_MS = parseInt(process.env.ALL_BOTS_DOWN_RESTART_MS || String(15 * 60 * 1000), 10);

let _allBotsDownSince = null;

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

    if (p99LagMs > EVENT_LOOP_RESTART_MS) {
      logger.fatal({ p99LagMs, threshold: EVENT_LOOP_RESTART_MS }, "Event loop kilitlenmesi tespit edildi, process yeniden başlatılıyor");
      process.exit(1);
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
        logger.fatal({ downForMs, sessions: states }, "Oturumlar uzun süredir kapalı, process yeniden başlatılıyor");
        process.exit(1);
      }
    } else {
      _allBotsDownSince = null;
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

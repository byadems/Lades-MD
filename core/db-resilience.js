const P = require("pino");
const path = require("path");
const sqlite3 = require("sqlite3");

/**
 * Birleştirilmiş veritabanı dayanıklılık katmanı.
 * Hem PostgreSQL hem SQLite için ortak query buffering, priority queue,
 * session write coalescing ve antiDelete filtreleme mantığını sağlar.
 *
 * @param {import("sequelize").Sequelize} sequelizeInstance
 * @param {object} opts
 * @param {"postgres"|"sqlite"} opts.dialect
 * @param {import("pino").Logger} opts.logger
 */
function applyResilience(sequelizeInstance, opts = {}) {
  const dialect = opts.dialect || "postgres";
  const logger = opts.logger || P({ level: "warn" });
  const guardFlag = dialect === "postgres" ? "__pgGuardsApplied" : "__sqliteGuardsApplied";

  if (!sequelizeInstance || sequelizeInstance[guardFlag]) {
    return;
  }
  sequelizeInstance[guardFlag] = true;

  // --- Dialect-specific hooks ---
  if (dialect === "postgres") {
    sequelizeInstance.addHook("afterConnect", (connection) => {
      connection.on?.("error", (err) => {
        if (err?.message?.includes("savepoint") && err?.message?.includes("does not exist")) {
          logger.debug({ err: err.message }, "PostgreSQL savepoint hatası (bağlantı yeniden kullanılacak)");
        }
      });
    });
  }

  if (dialect === "sqlite") {
    const busyTimeoutMs = parseInt(process.env.SQLITE_BUSY_TIMEOUT || "15000", 10);
    const pragmas = [
      "PRAGMA journal_mode=WAL;",
      "PRAGMA synchronous=NORMAL;",
      "PRAGMA temp_store=MEMORY;",
      "PRAGMA cache_size=-32000;",
      `PRAGMA busy_timeout=${busyTimeoutMs};`,
    ];

    const storage =
      sequelizeInstance?.options?.storage ||
      process.env.DATABASE_URL ||
      process.env.SQLITE_DATABASE_PATH ||
      "./bot.db";

    const isLikelySqliteFile =
      typeof storage === "string" &&
      !/^postgres(ql)?:\/\//i.test(storage) &&
      !/^mysql:\/\//i.test(storage) &&
      !/^mariadb:\/\//i.test(storage) &&
      !/^mssql:\/\//i.test(storage);

    if (isLikelySqliteFile) {
      try {
        const dbPath = path.resolve(storage);
        const rawDb = new sqlite3.Database(dbPath);
        rawDb.serialize(() => {
          for (const pragma of pragmas) rawDb.run(pragma);
        });
        rawDb.close(() => {});
        logger.info({ dbPath }, "SQLite WAL/PRAGMA bootstrap tamamlandı");
      } catch (error) {
        logger.warn({ err: error }, "SQLite WAL/PRAGMA bootstrap uygulanamadı");
      }
    }

    sequelizeInstance.addHook("afterConnect", async (connection) => {
      if (!connection || typeof connection.exec !== "function") return;
      try {
        for (const pragma of pragmas) {
          await new Promise((resolve, reject) => {
            connection.exec(pragma, (err) => (err ? reject(err) : resolve()));
          });
        }
      } catch (_) {}
    });
  }

  // --- Ortak buffer / queue ayarları ---
  const BUFFER_FLUSH_MS = dialect === "postgres"
    ? parseInt(process.env.PG_BUFFER_FLUSH_MS || String(60 * 1000), 10)   // 60sn
    : parseInt(process.env.SQLITE_BUFFER_FLUSH_MS || String(30 * 1000), 10); // 30sn

  const BUFFER_MAX = dialect === "postgres"
    ? parseInt(process.env.PG_BUFFER_MAX || "300", 10)
    : 100;

  const DB_QUERY_TIMEOUT_MS = parseInt(process.env.DB_QUERY_TIMEOUT_MS || "8000", 10);
  const DB_BATCH_SIZE = parseInt(process.env.DB_BATCH_SIZE || "3", 10);
  const DISABLE_SESSION_DB_WRITES = process.env.DISABLE_SESSION_DB_WRITES === "true";
  const SESSION_WRITE_COALESCE_MS = parseInt(process.env.SESSION_WRITE_COALESCE_MS || "5000", 10);

  const originalQuery = sequelizeInstance.query.bind(sequelizeInstance);
  const priorityQueue = [];
  const bulkQueue = [];
  const bufferedMessageQueries = [];
  let queueActive = false;
  let _lastSessionWriteQueuedAt = 0;

  // --- Ortak yardımcı fonksiyonlar ---
  const HIGH_VOLUME_TABLES = [
    "messages", "message_stats", "chats", "contacts", "group_metadata",
    "users", "userstats", "antideletecaches", "spamtrackers",
  ];

  const PRIORITY_TABLES = [
    "sessions", "auth", "auth_state", "botvars", "bot_vars",
    "whatsappsessions", "bot_variables",
  ];

  const isWriteQuery = (sql) => {
    if (!sql || typeof sql !== "string") return true;
    const normalizedSql = sql.trim().toUpperCase();
    return (
      normalizedSql.startsWith("INSERT") ||
      normalizedSql.startsWith("UPDATE") ||
      normalizedSql.startsWith("DELETE") ||
      normalizedSql.startsWith("CREATE") ||
      normalizedSql.startsWith("ALTER") ||
      normalizedSql.startsWith("DROP")
    );
  };

  const isSchemaIntrospectionQuery = (sql) => {
    if (!sql || typeof sql !== "string") return false;
    const normalizedSql = sql.trim().toUpperCase();
    if (dialect === "sqlite") {
      return (
        normalizedSql.startsWith("PRAGMA ") ||
        normalizedSql.includes("SQLITE_MASTER") ||
        normalizedSql.includes("TABLE_INFO(") ||
        normalizedSql.includes("INDEX_LIST(")
      );
    }
    return (
      normalizedSql.includes("INFORMATION_SCHEMA") ||
      normalizedSql.includes("PG_CLASS") ||
      normalizedSql.includes("PG_ATTRIBUTE") ||
      normalizedSql.includes("PG_NAMESPACE") ||
      normalizedSql.includes("PG_INDEX") ||
      normalizedSql.includes("PG_GET_SERIAL_SEQUENCE")
    );
  };

  const tableMatchesAny = (sql, tables) => {
    if (!sql || typeof sql !== "string") return false;
    const lower = sql.toLowerCase();
    for (const t of tables) {
      if (
        lower.includes(`into "${t}"`) || lower.includes(`into \`${t}\``) || lower.includes(`into ${t} `) ||
        lower.includes(`update "${t}"`) || lower.includes(`update \`${t}\``) || lower.includes(`update ${t} `)
      ) return true;
    }
    return false;
  };

  const isHighVolumeQuery = (sql) => tableMatchesAny(sql, HIGH_VOLUME_TABLES);

  const isAntiDeleteQuery = (sql) => {
    if (!sql || typeof sql !== "string") return false;
    if (!sql.toLowerCase().includes("antideletecache")) return false;
    return isWriteQuery(sql);
  };

  const SESSION_TABLE_PATTERNS = ["sessions", "whatsappsessions"];

  const isSessionWriteQuery = (sql) => {
    if (!sql || typeof sql !== "string") return false;
    const lower = sql.toLowerCase();
    for (const t of SESSION_TABLE_PATTERNS) {
      if (
        lower.includes(`into "${t}"`) || lower.includes(`into \`${t}\``) || lower.includes(`into ${t} `) ||
        lower.includes(`update "${t}"`) || lower.includes(`update \`${t}\``) || lower.includes(`update ${t} `) ||
        lower.includes(`delete from "${t}"`) || lower.includes(`delete from \`${t}\``) || lower.includes(`delete from ${t} `)
      ) return true;
    }
    return false;
  };

  const isPriorityQuery = (sql) => {
    if (!sql || typeof sql !== "string") return false;
    const lower = sql.toLowerCase();
    for (const t of PRIORITY_TABLES) {
      if (
        lower.includes(`into "${t}"`) || lower.includes(`into \`${t}\``) || lower.includes(`into ${t} `) ||
        lower.includes(`update "${t}"`) || lower.includes(`update \`${t}\``) || lower.includes(`update ${t} `) ||
        lower.includes(`from "${t}"`) || lower.includes(`from \`${t}\``) || lower.includes(`from ${t} `)
      ) return true;
    }
    return false;
  };

  // --- Flush queue ---
  const flushQueue = async () => {
    if (queueActive || (priorityQueue.length === 0 && bulkQueue.length === 0)) {
      return;
    }

    queueActive = true;

    while (priorityQueue.length > 0 || bulkQueue.length > 0) {
      const batch = [];
      if (priorityQueue.length > 0) {
        batch.push(priorityQueue.shift());
      }

      while (batch.length < DB_BATCH_SIZE && bulkQueue.length > 0) {
        batch.push(bulkQueue.shift());
      }

      while (batch.length < DB_BATCH_SIZE && priorityQueue.length > 0) {
        batch.push(priorityQueue.shift());
      }

      for (const item of batch) {
        const { task, resolve, reject, isBuffered } = item;
        let timeout;
        let retries = 0;
        const maxRetries = 2;
        let lastError;

        while (retries <= maxRetries) {
          try {
            const result = await Promise.race([
              task(),
              new Promise((_, rej) => {
                timeout = setTimeout(() => rej(new Error("DB query timeout")), DB_QUERY_TIMEOUT_MS);
              })
            ]);
            if (resolve) resolve(result);
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            clearTimeout(timeout);
            const isBusy = error?.parent?.code === "SQLITE_BUSY" ||
              String(error?.message).includes("database is locked") ||
              error?.name === "SequelizeTimeoutError";
            if (isBusy && retries < maxRetries) {
              retries++;
              await new Promise((r) => setTimeout(r, 200 * retries));
              continue;
            }
            break;
          } finally {
            clearTimeout(timeout);
          }
        }

        if (lastError) {
          if (!isBuffered) {
            if (reject) reject(lastError);
          }
        }
      }

      if (priorityQueue.length > 0 || bulkQueue.length > 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    queueActive = false;
  };

  // --- Periyodik flush ---
  const _bufferFlushInterval = setInterval(async () => {
    if (bufferedMessageQueries.length > 0) {
      logger.info(`Periyodik: ${bufferedMessageQueries.length} bekleyen mesaj sorgusu veritabanına yazılıyor...`);
      const pending = bufferedMessageQueries.splice(0);
      bulkQueue.push(...pending);
      setImmediate(flushQueue);
    }
  }, BUFFER_FLUSH_MS);

  // --- Kapatma hook ---
  sequelizeInstance.__flushBufferedQueries = async () => {
    if (bufferedMessageQueries.length > 0) {
      logger.info(`Kapatma: ${bufferedMessageQueries.length} bekleyen mesaj sorgusu veritabanına yazılıyor...`);
      const pending = bufferedMessageQueries.splice(0);
      bulkQueue.push(...pending);
      await flushQueue();
    }
    clearInterval(_bufferFlushInterval);
  };

  // --- Query interceptor fabrikası ---
  function createQueryInterceptor(originalFn) {
    return function serializedQuery(sql, ...rest) {
      if (isSchemaIntrospectionQuery(sql)) {
        // Sequelize'in describeTable/sync akışları PRAGMA sonuç formatına sıkı bağlıdır.
        // Bu sorguları kuyruk/tampon katmanına sokmak metadata parse hatalarına yol açar.
        return originalFn(sql, ...rest);
      }

      if (isAntiDeleteQuery(sql)) {
        return Promise.resolve([[], 0]);
      }

      if (DISABLE_SESSION_DB_WRITES && isSessionWriteQuery(sql)) {
        logger.warn("DISABLE_SESSION_DB_WRITES aktif: sessions tablosuna yazma atlandı");
        return Promise.resolve([[], 0]);
      }

      if (isSessionWriteQuery(sql)) {
        const now = Date.now();
        if (now - _lastSessionWriteQueuedAt < SESSION_WRITE_COALESCE_MS) {
          return Promise.resolve([[], 0]);
        }
        _lastSessionWriteQueuedAt = now;
      }

      if (!isWriteQuery(sql)) {
        return originalFn(sql, ...rest);
      }

      if (isHighVolumeQuery(sql)) {
        bufferedMessageQueries.push({
          task: () => originalFn(sql, ...rest),
          isBuffered: true
        });

        if (bufferedMessageQueries.length > BUFFER_MAX) {
          logger.info(`Tampon ${BUFFER_MAX} öğeye ulaştı, erken yazma yapılıyor...`);
          const pending = bufferedMessageQueries.splice(0);
          bulkQueue.push(...pending);
          setImmediate(flushQueue);
        }

        return Promise.resolve([[], 0]);
      }

      return new Promise((resolve, reject) => {
        const queue = isPriorityQuery(sql) ? priorityQueue : bulkQueue;
        queue.push({
          task: () => originalFn(sql, ...rest),
          resolve,
          reject,
        });
        setImmediate(flushQueue);
      });
    };
  }

  // --- Patch query & queryRaw ---
  sequelizeInstance.query = createQueryInterceptor(originalQuery);

  if (typeof sequelizeInstance.queryRaw === "function") {
    const originalQueryRaw = sequelizeInstance.queryRaw.bind(sequelizeInstance);
    sequelizeInstance.queryRaw = createQueryInterceptor(originalQueryRaw);
  }
}

module.exports = { applyResilience };

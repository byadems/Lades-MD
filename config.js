const P = require("pino");
const fs = require("fs");
const { Sequelize } = require("sequelize");

// Suppress node-cron "missed execution" uyarı — these are triggered when the
// event loop is delayed by >1 second (common under DB load on Koyeb/Heroku).
// They are purely cosmetic log noise and do not affect scheduling correctness.
const _originalWarn = console.warn.bind(console);
console.warn = (...args) => {
  const msg = args[0];
  if (typeof msg === "string" && msg.includes("[NODE-CRON]") && msg.includes("missed execution")) {
    return; // silently drop
  }
  _originalWarn(...args);
};

function convertToBool(text, fault = "true", fault2 = "on") {
  return text === fault || text === fault2;
}

const isVPS = !__dirname.startsWith("/lds");
const isHeroku = __dirname.startsWith("/lds");
const isKoyeb = __dirname.startsWith("/lds");
const isRailway = __dirname.startsWith("/railway");

const logger = P({ level: process.env.LOG_LEVEL || "silent" });

function applyPostgresResilience(sequelizeInstance) {
  if (!sequelizeInstance || sequelizeInstance.__pgGuardsApplied) {
    return;
  }
  sequelizeInstance.__pgGuardsApplied = true;

  sequelizeInstance.addHook("afterConnect", (connection) => {
    connection.on?.("error", (err) => {
      if (err?.message?.includes("savepoint") && err?.message?.includes("does not exist")) {
        logger.debug({ err: err.message }, "PostgreSQL savepoint hatası (bağlantı yeniden kullanılacak)");
      }
    });
  });

  // Query buffering (messages, message_stats) - same logic as SQLite to reduce egress
  const originalQuery = sequelizeInstance.query.bind(sequelizeInstance);
  const writeQueue = [];
  const bufferedMessageQueries = [];
  let queueActive = false;

  const _bufferFlushInterval = setInterval(async () => {
    if (bufferedMessageQueries.length > 0) {
      logger.info(`Periyodik: ${bufferedMessageQueries.length} bekleyen mesaj sorgusu veritabanına yazılıyor...`);
      const pending = [...bufferedMessageQueries];
      bufferedMessageQueries.length = 0;
      writeQueue.push(...pending);
      setImmediate(flushQueue);
    }
  }, 1000 * 60 * 60);

  const flushQueue = async () => {
    if (queueActive || writeQueue.length === 0) {
      return;
    }

    queueActive = true;

    while (writeQueue.length > 0) {
      const { task, resolve, reject, isBuffered } = writeQueue.shift();
      try {
        const result = await task();
        if (resolve) resolve(result);
      } catch (error) {
        if (!isBuffered) {
          if (reject) reject(error);
        } else {
          logger.error({ err: error }, "Bekleyen veritabanı yazma sorgusu çalıştırılamadı");
        }
      }
    }

    queueActive = false;
  };

  sequelizeInstance.__flushBufferedQueries = async () => {
    if (bufferedMessageQueries.length > 0) {
      logger.info(`Kapatma: ${bufferedMessageQueries.length} bekleyen mesaj sorgusu veritabanına yazılıyor...`);
      const pending = [...bufferedMessageQueries];
      bufferedMessageQueries.length = 0;
      writeQueue.push(...pending);
      await flushQueue();
    }
    clearInterval(_bufferFlushInterval);
  };

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

  const isHighVolumeQuery = (sql) => {
    if (!sql || typeof sql !== "string") return false;
    const lower = sql.toLowerCase();
    const tables = ["messages", "message_stats", "chats", "contacts", "group_metadata"];
    for (const t of tables) {
      if (
        lower.includes(`into "${t}"`) || lower.includes(`into \`${t}\``) || lower.includes(`into ${t} `) ||
        lower.includes(`update "${t}"`) || lower.includes(`update \`${t}\``) || lower.includes(`update ${t} `)
      ) return true;
    }
    return false;
  };

  sequelizeInstance.query = function serializedQuery(sql, ...rest) {
    if (!isWriteQuery(sql)) {
      return originalQuery(sql, ...rest);
    }

    if (isHighVolumeQuery(sql)) {
      bufferedMessageQueries.push({
        task: () => originalQuery(sql, ...rest),
        isBuffered: true
      });

      if (bufferedMessageQueries.length > 200) {
        logger.info(`Tampon 200 öğeye ulaştı, erken yazma yapılıyor...`);
        const pending = [...bufferedMessageQueries];
        bufferedMessageQueries.length = 0;
        writeQueue.push(...pending);
        setImmediate(flushQueue);
      }

      return Promise.resolve([[], 0]);
    }

    return new Promise((resolve, reject) => {
      writeQueue.push({
        task: () => originalQuery(sql, ...rest),
        resolve,
        reject,
      });
      setImmediate(flushQueue);
    });
  };

  if (typeof sequelizeInstance.queryRaw === "function") {
    const originalQueryRaw = sequelizeInstance.queryRaw.bind(sequelizeInstance);
    sequelizeInstance.queryRaw = function serializedQueryRaw(sql, ...rest) {
      if (!isWriteQuery(sql)) {
        return originalQueryRaw(sql, ...rest);
      }

      if (isHighVolumeQuery(sql)) {
        bufferedMessageQueries.push({
          task: () => originalQueryRaw(sql, ...rest),
          isBuffered: true
        });

        if (bufferedMessageQueries.length > 200) {
          const pending = [...bufferedMessageQueries];
          bufferedMessageQueries.length = 0;
          writeQueue.push(...pending);
          setImmediate(flushQueue);
        }
        return Promise.resolve([[], 0]);
      }

      return new Promise((resolve, reject) => {
        writeQueue.push({
          task: () => originalQueryRaw(sql, ...rest),
          resolve,
          reject,
        });
        setImmediate(flushQueue);
      });
    };
  }
}

function applySQLiteResilience(sequelizeInstance) {
  if (!sequelizeInstance || sequelizeInstance.__sqliteGuardsApplied) {
    return;
  }

  sequelizeInstance.__sqliteGuardsApplied = true;
  const busyTimeoutMs = parseInt(process.env.SQLITE_BUSY_TIMEOUT || "15000", 10); // modifiable
  const pragmas = [
    "PRAGMA journal_mode=WAL;",
    "PRAGMA synchronous=NORMAL;",
    "PRAGMA temp_store=MEMORY;",
    "PRAGMA cache_size=-32000;",
    `PRAGMA busy_timeout=${busyTimeoutMs};`,
  ];

  sequelizeInstance.addHook("afterConnect", async (connection) => {
    if (!connection || typeof connection.exec !== "function") {
      return;
    }

    try {
      for (const pragma of pragmas) {
        await new Promise((resolve, reject) => {
          connection.exec(pragma, (err) => (err ? reject(err) : resolve()));
        });
      }
    } catch (error) {
      logger.warn({ err: error }, "SQLite pragma ayarları uygulanamadı");
    }
  });

  const originalQuery = sequelizeInstance.query.bind(sequelizeInstance);
  const writeQueue = [];
  const bufferedMessageQueries = []; // For messages and message_stats
  let queueActive = false;

  // Ensure periodic flush of buffered message queries (every 1 hour)
  const _bufferFlushInterval = setInterval(async () => {
    if (bufferedMessageQueries.length > 0) {
      logger.info(`Periyodik: ${bufferedMessageQueries.length} bekleyen mesaj sorgusu veritabanına yazılıyor...`);
      const pending = [...bufferedMessageQueries];
      bufferedMessageQueries.length = 0;
      writeQueue.push(...pending);
      setImmediate(flushQueue);
    }
  }, 1000 * 60 * 60);

  const flushQueue = async () => {
    if (queueActive || writeQueue.length === 0) {
      return;
    }

    queueActive = true;

    while (writeQueue.length > 0) {
      const { task, resolve, reject, isBuffered } = writeQueue.shift();
      try {
        const result = await task();
        if (resolve) resolve(result);
      } catch (error) {
        if (!isBuffered) { // only reject if it's an active awaiter
           if (reject) reject(error);
        } else {
           logger.error({ err: error }, "Bekleyen veritabanı yazma sorgusu çalıştırılamadı");
        }
      }
    }

    queueActive = false;
  };

  // Expose a flush function so that index.js can call it during shutdown
  sequelizeInstance.__flushBufferedQueries = async () => {
    if (bufferedMessageQueries.length > 0) {
      logger.info(`Kapatma: ${bufferedMessageQueries.length} bekleyen mesaj sorgusu veritabanına yazılıyor...`);
      const pending = [...bufferedMessageQueries];
      bufferedMessageQueries.length = 0;
      writeQueue.push(...pending);
      await flushQueue();
    }
    clearInterval(_bufferFlushInterval);
  };

  const isWriteQuery = (sql) => {
    if (!sql || typeof sql !== "string") return true; 
    const normalizedSql = sql.trim().toUpperCase();
    return (
      normalizedSql.startsWith("INSERT") ||
      normalizedSql.startsWith("UPDATE") ||
      normalizedSql.startsWith("DELETE") ||
      normalizedSql.startsWith("CREATE") ||
      normalizedSql.startsWith("ALTER") ||
      normalizedSql.startsWith("DROP") ||
      normalizedSql.startsWith("PRAGMA")
    );
  };
  
  const isHighVolumeQuery = (sql) => {
      if (!sql || typeof sql !== "string") return false;
      const lower = sql.toLowerCase();
      // Target the tables generating the highest load
      return lower.includes('into "messages"') || lower.includes("into `messages`") || lower.includes("into messages") ||
             lower.includes('into "message_stats"') || lower.includes("into `message_stats`") || lower.includes("into message_stats") ||
             lower.includes('update "messages"') || lower.includes("update `messages`") || lower.includes("update messages") ||
             lower.includes('update "message_stats"') || lower.includes("update `message_stats`") || lower.includes("update message_stats");
  };

  sequelizeInstance.query = function serializedQuery(sql, ...rest) {
    if (!isWriteQuery(sql)) {
      return originalQuery(sql, ...rest);
    }

    // High volume queries are pushed to a slow buffer
    if (isHighVolumeQuery(sql)) {
        bufferedMessageQueries.push({
            task: () => originalQuery(sql, ...rest),
            isBuffered: true
        });
        
        // If buffer gets too huge, flush it before 1 hour
        if (bufferedMessageQueries.length > 200) {
            logger.info(`Tampon 200 öğeye ulaştı, erken yazma yapılıyor...`);
            const pending = [...bufferedMessageQueries];
            bufferedMessageQueries.length = 0;
            writeQueue.push(...pending);
            setImmediate(flushQueue);
        }
        
        // Immediately resolve to unblock the caller (store.js usually doesn't await the specific result fields)
        return Promise.resolve([[], 0]);
    }

    // Normal queries execute immediately in queue
    return new Promise((resolve, reject) => {
      writeQueue.push({
        task: () => originalQuery(sql, ...rest),
        resolve,
        reject,
      });
      setImmediate(flushQueue);
    });
  };

  if (typeof sequelizeInstance.queryRaw === "function") {
    const originalQueryRaw = sequelizeInstance.queryRaw.bind(sequelizeInstance);
    sequelizeInstance.queryRaw = function serializedQueryRaw(sql, ...rest) {
      if (!isWriteQuery(sql)) {
        return originalQueryRaw(sql, ...rest);
      }

      if (isHighVolumeQuery(sql)) {
          bufferedMessageQueries.push({
              task: () => originalQueryRaw(sql, ...rest),
              isBuffered: true
          });
          
          if (bufferedMessageQueries.length > 200) {
             const pending = [...bufferedMessageQueries];
             bufferedMessageQueries.length = 0;
             writeQueue.push(...pending);
             setImmediate(flushQueue);
          }
          return Promise.resolve([[], 0]);
      }

      return new Promise((resolve, reject) => {
        writeQueue.push({
          task: () => originalQueryRaw(sql, ...rest),
          resolve,
          reject,
        });
        setImmediate(flushQueue);
      });
    };
  }
}

const MAX_RECONNECT_ATTEMPTS = parseInt(
  process.env.MAX_RECONNECT_ATTEMPTS || "5",
  10
);
const VERSION = require("./package.json").version;
const DATABASE_URL =
  process.env.DATABASE_URL === undefined
    ? "./bot.db"
    : process.env.DATABASE_URL;
const DEBUG =
  process.env.DEBUG === undefined ? false : convertToBool(process.env.DEBUG);

const sequelize = (() => {
  if (DATABASE_URL === "./bot.db") {
    const sqliteInstance = new Sequelize({
      dialect: "sqlite",
      storage: DATABASE_URL,
      logging: DEBUG,
      retry: {
        match: [/SQLITE_BUSY/, /database is locked/, /EBUSY/],
        max: 3,
      },
      pool: {
        max: 5,
        min: 1,
        acquire: 30000,
        idle: 10000,
      },
    });

    applySQLiteResilience(sqliteInstance);
    return sqliteInstance;
  }

  const isPostgres = /^postgres(ql)?:\/\//i.test(DATABASE_URL);
  const pgInstance = new Sequelize(DATABASE_URL, {
    dialectOptions: {
      ssl: { require: true, rejectUnauthorized: false },
      connectTimeout: 30000,
    },
    logging: DEBUG,
    pool: isPostgres
      ? {
          max: parseInt(process.env.PG_POOL_MAX || "10", 10),
          min: parseInt(process.env.PG_POOL_MIN || "2", 10),
          acquire: 60000,
          idle: 30000,
          evict: 5000,
        }
      : {
          max: 3,
          min: 0,
          acquire: 60000,
          idle: 5000,
          evict: 1000,
        },
    retry: {
      max: 5,
      match: [
        /ECONNRESET/,
        /ETIMEDOUT/,
        /ConnectionError/,
        /Operation timeout/,
        /savepoint.*does not exist/,
      ],
    },
  });

  if (isPostgres) {
    applyPostgresResilience(pgInstance);
  }
  return pgInstance;
})();

const SESSION_STRING = process.env.SESSION || process.env.SESSION_ID;

const SESSION = SESSION_STRING
  ? SESSION_STRING.split(",").map((s) => s.split("~")[1].trim())
  : [];

const settingsMenu = [
  { title: "DM anti-spam engelleyici", env_var: "PM_ANTISPAM" },
  { title: "Komutları paralel çalıştır (bloklama yok)", env_var: "PARALLEL_COMMANDS" },
  //{ title: "Komutlara otomatik tepki (emoji) ver", env_var: "CMD_REACTION" },
  { title: "Tüm mesajları otomatik okundu olarak işaretle", env_var: "READ_MESSAGES" },
  { title: "Komut mesajlarını otomatik okundu olarak işaretle", env_var: "READ_COMMAND" },
  { title: "Durum güncellemelerini otomatik okundu olarak işaretle", env_var: "AUTO_READ_STATUS" },
  { title: "Yönetici sudo (grup komutları) izinleri", env_var: "ADMIN_ACCESS" },
  { title: "Handler'lı (. vs) ve handler'sız mod", env_var: "MULTI_HANDLERS" },
  { title: "Aramaları otomatik reddet", env_var: "REJECT_CALLS" },
  { title: "Her zaman çevrimiçi görün", env_var: "ALWAYS_ONLINE" },
  { title: "DM Otomatik Engelleyici", env_var: "PMB_VAR" },
  { title: "Botu DM'lerde devre dışı bırak", env_var: "DIS_PM" },
  { title: "Bot başlangıç mesajını devre dışı bırak", env_var: "DISABLE_START_MESSAGE" },
];

const baseConfig = {
  VERSION,
  ALIVE:
    process.env.ALIVE ||
    "_Çevrimiçiyim! (özel çevrimiçi mesaj için .setalive help kullanın)_",
  BLOCK_CHAT: process.env.BLOCK_CHAT || "",
  PM_ANTISPAM: convertToBool(process.env.PM_ANTISPAM) || "",
  ALWAYS_ONLINE: convertToBool(process.env.ALWAYS_ONLINE) || false,
  MANGLISH_CHATBOT: convertToBool(process.env.MANGLISH_CHATBOT) || false,
  ADMIN_ACCESS: convertToBool(process.env.ADMIN_ACCESS) || false,
  PLATFORM: isHeroku
    ? "Heroku"
    : isRailway
      ? "Railway"
      : isKoyeb
        ? "Koyeb"
        : "Diğer sunucu",
  isHeroku,
  isKoyeb,
  isVPS,
  isRailway,
  AUTOMUTE_MSG:
    process.env.AUTOMUTE_MSG || "_Grup otomatikman susturuldu!_\n_(AUTOMUTE_MSG düzenleyin)_",
  ANTIWORD_WARN: process.env.ANTIWORD_WARN || "",
  ANTI_SPAM: process.env.ANTI_SPAM || "919074309534-1632403322@g.us",
  MULTI_HANDLERS: convertToBool(process.env.MULTI_HANDLERS) || false,
  DISABLE_START_MESSAGE:
    convertToBool(process.env.DISABLE_START_MESSAGE) || false,
  NOLOG: process.env.NOLOG || false,
  DISABLED_COMMANDS:
    (process.env.DISABLED_COMMANDS
      ? process.env.DISABLED_COMMANDS.split(",")
      : undefined) || [],
  ANTI_BOT: process.env.ANTI_BOT || "",
  ANTISPAM_COUNT: process.env.ANTISPAM_COUNT || "10/10",
  AUTOUNMUTE_MSG:
    process.env.AUTOUNMUTE_MSG ||
    "_Grup otomatik susturma kaldırıldı!_\n_(AUTOUNMUTE_MSG düzenleyin)_",
  AUTO_READ_STATUS: convertToBool(process.env.AUTO_READ_STATUS) || true,
  READ_MESSAGES: convertToBool(process.env.READ_MESSAGES) || false,
  PMB_VAR: convertToBool(process.env.PMB_VAR) || false,
  DIS_PM: convertToBool(process.env.DIS_PM) || true,
  REJECT_CALLS: convertToBool(process.env.REJECT_CALLS) || true,
  ALLOWED_CALLS: process.env.ALLOWED_CALLS || "",
  CALL_REJECT_MESSAGE: process.env.CALL_REJECT_MESSAGE || "",
  PMB: process.env.PMB || "_Kişisel mesajlara izin verilmiyor, ENGELLENDİ!_",
  READ_COMMAND: convertToBool(process.env.READ_COMMAND) || true,
  IMGBB_KEY: [
    "76a050f031972d9f27e329d767dd988f",
    "deb80cd12ababea1c9b9a8ad6ce3fab2",
    "78c84c62b32a88e86daf87dd509a657a",
  ],
  RG: process.env.RG || "919074309534-1632403322@g.us,120363116963909366@g.us",
  BOT_INFO: process.env.BOT_INFO || "LADES-Bot;LADES-Bot;varsayılan",
  RBG_KEY: process.env.RBG_KEY || "",
  ALLOWED: process.env.ALLOWED || "90",
  NOT_ALLOWED: process.env.NOT_ALLOWED || "",
  CHATBOT: process.env.CHATBOT || "off",
  HANDLERS: process.env.HANDLERS || ".,",
  STICKER_DATA: process.env.STICKER_DATA || "LADES-Bot;LADES-Bot",
  BOT_NAME: process.env.BOT_NAME || "Lades",
  AUDIO_DATA:
    process.env.AUDIO_DATA === undefined || process.env.AUDIO_DATA === "private"
      ? "default"
      : process.env.AUDIO_DATA,
  TAKE_KEY: process.env.TAKE_KEY || "",
  CMD_REACTION: convertToBool(process.env.CMD_REACTION) || true,
  /** Komutları paralel çalıştır (bir işlem bitmeden diğerine geçebilir) */
  PARALLEL_COMMANDS: convertToBool(process.env.PARALLEL_COMMANDS) || true,
  MODE: process.env.MODE || "private",
  WARN: process.env.WARN || "3",
  ANTILINK_WARN: process.env.ANTILINK_WARN || "",
  ANTI_DELETE: convertToBool(process.env.ANTI_DELETE) || false,
  SUDO: process.env.SUDO || "",
  LANGUAGE: process.env.LANGUAGE || "turkish",
  AUTO_UPDATE: convertToBool(process.env.AUTO_UPDATE) || true,
  SUPPORT_GROUP: process.env.SUPPORT_GROUP || "https://t.me/lades_in",
  ACR_A: "ff489a0160188cf5f0750eaf486eee74",
  ACR_S: "ytu3AdkCu7fkRVuENhXxs9jsOW4YJtDXimAWMpJp",
  settingsMenu,

  SESSION,
  logger,
  MAX_RECONNECT_ATTEMPTS,
  sequelize,
  DATABASE_URL,
  DEBUG,
};

const dynamicValues = new Map();

const config = new Proxy(baseConfig, {
  get(target, prop) {
    const key = typeof prop === "symbol" ? prop.toString() : prop;

    if (key === "toJSON" || key === "valueOf") {
      return () => ({ ...target, ...Object.fromEntries(dynamicValues) });
    }

    if (key === "inspect" || key === Symbol.for("nodejs.util.inspect.custom")) {
      return () => ({ ...target, ...Object.fromEntries(dynamicValues) });
    }

    if (key === 'isPrivate') {
      const mode = dynamicValues.has('MODE') ? dynamicValues.get('MODE') : target.MODE;
      return mode === 'private';
    }

    if (dynamicValues.has(key)) {
      return dynamicValues.get(key);
    }

    if (key in target) {
      return target[key];
    }

    if (typeof key === "string" && process.env[key] !== undefined) {
      return process.env[key];
    }

    return undefined;
  },

  set(target, prop, value) {
    const key = typeof prop === "symbol" ? prop.toString() : prop;

    dynamicValues.set(key, value);
    return true;
  },

  has(target, prop) {
    const key = typeof prop === "symbol" ? prop.toString() : prop;
    return (
      dynamicValues.has(key) ||
      key in target ||
      (typeof key === "string" && key in process.env)
    );
  },

  ownKeys(target) {
    const baseKeys = Object.keys(target);
    const dynamicKeys = Array.from(dynamicValues.keys()).filter(
      (k) => typeof k === "string"
    );
    return [...new Set([...baseKeys, ...dynamicKeys])];
  },

  getOwnPropertyDescriptor(target, prop) {
    const key = typeof prop === "symbol" ? prop.toString() : prop;

    if (dynamicValues.has(key) || key in target) {
      return {
        enumerable: true,
        configurable: true,
        value: this.get(target, prop),
      };
    }
    return undefined;
  },
});

Object.defineProperty(config, "loadFromDB", {
  value: function (dbValues = {}) {
    let loadedCount = 0;
    const booleanKeys = [
      ...settingsMenu.map((item) => item.env_var),
      "MANGLISH_CHATBOT",
    ];
    for (const [key, value] of Object.entries(dbValues)) {
      if (value !== undefined && value !== null) {
        if (booleanKeys.includes(key)) {
          this[key] = convertToBool(value);
        } else {
          this[key] = value;
        }
        loadedCount++;
      }
    }

    console.log(`- Yüklenen değişken: ${loadedCount}`);
    return this;
  },
  writable: false,
  enumerable: false,
});

Object.defineProperty(config, "getDynamicKeys", {
  value: function () {
    return Array.from(dynamicValues.keys());
  },
  writable: false,
  enumerable: false,
});

Object.defineProperty(config, "isDynamic", {
  value: function (key) {
    return dynamicValues.has(key);
  },
  writable: false,
  enumerable: false,
});

Object.defineProperty(config, "getSource", {
  value: function (key) {
    if (dynamicValues.has(key)) return "database";
    if (key in baseConfig) return "config";
    if (typeof key === "string" && process.env[key] !== undefined)
      return "environment";
    return "not_found";
  },
  writable: false,
  enumerable: false,
});

Object.defineProperty(config, "debug", {
  value: function () {
    const result = {
      static: Object.keys(baseConfig),
      dynamic: Array.from(dynamicValues.keys()),
      values: { ...baseConfig, ...Object.fromEntries(dynamicValues) },
    };
    console.log("Yapılandırma hata ayıklama bilgisi:", result);
    return result;
  },
  writable: false,
  enumerable: false,
});

module.exports = config;

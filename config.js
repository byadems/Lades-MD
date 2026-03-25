const P = require("pino");
const fs = require("fs");
const { Sequelize } = require("sequelize");

// Suppress node-cron "missed execution" uyarı — these are triggered when the
// event loop is delayed by >1 second (common under DB load on Koyeb/Heroku).
// They are purely cosmetic log noise and do not affect scheduling correctness.
// Only the specific node-cron pattern is filtered; all other warnings pass through.
const _originalWarn = console.warn.bind(console);
console.warn = (...args) => {
  const msg = args[0];
  if (typeof msg === "string" && msg.includes("[NODE-CRON]")) return;
  _originalWarn(...args);
};

function convertToBool(text, fault = "true", fault2 = "on") {
  return text === fault || text === fault2;
}

const isRailway = __dirname.startsWith("/railway");
const isKoyeb = !!process.env.KOYEB_PUBLIC_DOMAIN;
const isHeroku = __dirname.startsWith("/lds") && !isKoyeb;
const isVPS = !isHeroku && !isKoyeb && !isRailway;

const baseLogger = P({
  level: process.env.LOG_LEVEL || "debug",
  redact: {
    paths: [
      "*.sessionId",
      "*.sessionData",
      "*.token",
      "*.key",
      "*.password",
      "*.phoneNumber",
      "*.jid"
    ],
    placeholder: "[SENSITIVE]",
  },
});

// Baileys/Signal decryption hataları ve transaction rollback'leri sık görülür;
// "No session found" / "No matching sessions" genelde LID/session senkronizasyonundan
// kaynaklanır, kritik değildir. Bu logları debug seviyesine indirerek gürültüyü azalt.
const SUPPRESS_DECRYPTION_LOGS = process.env.SUPPRESS_DECRYPTION_LOGS !== "false";
const NOISY_ERROR_PATTERNS = [
  "failed to decrypt",
  "transaction failed",
];

function wrapLogger(log) {
  if (!log || !SUPPRESS_DECRYPTION_LOGS) return log;
  const origError = log.error.bind(log);
  const origChild = log.child?.bind(log);
  Object.assign(log, {
    error(...args) {
      const msg = typeof args[0] === "string" ? args[0] : args[1];
      if (typeof msg === "string" && NOISY_ERROR_PATTERNS.some((p) => msg.includes(p))) {
        return log.trace(...args);
      }
      return origError(...args);
    },
    child(...args) {
      const child = origChild ? origChild(...args) : log;
      return wrapLogger(child);
    },
  });
  return log;
}

const logger = wrapLogger(baseLogger);

const { applyResilience } = require("./core/db-resilience");

function applyPostgresResilience(sequelizeInstance) {
  applyResilience(sequelizeInstance, { dialect: "postgres", logger });
}

function applySQLiteResilience(sequelizeInstance) {
  applyResilience(sequelizeInstance, { dialect: "sqlite", logger });
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
        max: 1,
        min: 0,
        acquire: 15000,
        idle: 5000,
      },
    });

    applySQLiteResilience(sqliteInstance);
    return sqliteInstance;
  }

  const isPostgres = /^postgres(ql)?:\/\//i.test(DATABASE_URL);
  const pgInstance = new Sequelize(DATABASE_URL, {
    dialectOptions: {
      ssl: { require: true, rejectUnauthorized: false },
      connectTimeout: 15000,
      statement_timeout: 10000,
      query_timeout: 10000,
    },
    logging: DEBUG,
    pool: isPostgres
      ? {
          max: parseInt(process.env.PG_POOL_MAX || "2", 10),
          min: parseInt(process.env.PG_POOL_MIN || "0", 10),
          acquire: 10000,
          idle: 5000,
          evict: 3000,
        }
      : {
          max: 2,
          min: 0,
          acquire: 10000,
          idle: 3000,
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
  ? SESSION_STRING.split(",")
      .map((s) => { const parts = s.split("~"); return parts.length > 1 ? parts[1].trim() : parts[0].trim(); })
      .filter(Boolean)
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
  AUTO_READ_STATUS: process.env.AUTO_READ_STATUS !== undefined ? convertToBool(process.env.AUTO_READ_STATUS) : true,
  READ_MESSAGES: convertToBool(process.env.READ_MESSAGES) || false,
  PMB_VAR: convertToBool(process.env.PMB_VAR) || false,
  DIS_PM: process.env.DIS_PM !== undefined ? convertToBool(process.env.DIS_PM) : true,
  REJECT_CALLS: process.env.REJECT_CALLS !== undefined ? convertToBool(process.env.REJECT_CALLS) : true,
  ALLOWED_CALLS: process.env.ALLOWED_CALLS || "",
  CALL_REJECT_MESSAGE: process.env.CALL_REJECT_MESSAGE || "",
  PMB: process.env.PMB || "_Kişisel mesajlara izin verilmiyor, ENGELLENDİ!_",
  READ_COMMAND: process.env.READ_COMMAND !== undefined ? convertToBool(process.env.READ_COMMAND) : true,
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
  HANDLER_PREFIX: (process.env.HANDLERS || ".,") === "false" ? "" : (process.env.HANDLERS || ".,").charAt(0),
  STICKER_DATA: process.env.STICKER_DATA || "LADES-Bot;LADES-Bot",
  BOT_NAME: process.env.BOT_NAME || "Lades",
  AUDIO_DATA:
    process.env.AUDIO_DATA === undefined || process.env.AUDIO_DATA === "private"
      ? "default"
      : process.env.AUDIO_DATA,
  TAKE_KEY: process.env.TAKE_KEY || "",
  CMD_REACTION: process.env.CMD_REACTION !== undefined ? convertToBool(process.env.CMD_REACTION) : true,
  /** Komutları paralel çalıştır (bir işlem bitmeden diğerine geçebilir) */
  PARALLEL_COMMANDS: process.env.PARALLEL_COMMANDS !== undefined ? convertToBool(process.env.PARALLEL_COMMANDS) : true,
  MODE: process.env.MODE || "private",
  get isPrivate() { return (process.env.MODE || "private") !== "public"; },
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

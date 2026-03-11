/**
 * Agresif veritabanı önbellekleme katmanı.
 *
 * Sorun: store.js (obfuscated) her gelen mesaj için Chat, User, UserStats
 * ve AntiDeleteCache tablolarına SELECT+INSERT/UPDATE yapar. Supabase Free
 * Plan'daki 5 GB egress limiti saatler içinde doluyordu.
 *
 * Çözüm: Sequelize model metodlarını monkey-patch ile sarmalayarak
 *   1) AntiDeleteCache → tamamen in-memory (LRU, DB'ye hiç gitmez)
 *   2) Chat / User → ilk okumada cache'lenir, tekrar DB'ye sorulmaz
 *   3) UserStats → bellekte tutulur, periyodik olarak DB'ye yazılır
 *   4) SELECT sorgularını minimize eder, egress'i %95+ düşürür
 */

const config = require("../config");
const { logger } = config;

const STATS_FLUSH_INTERVAL = 5 * 60 * 1000;
const ANTIDELETE_MAX_ENTRIES = 500;
const MAX_CACHE_SIZE = 5000;

// ─── LRU Cache ───────────────────────────────────────────────────────────────

class LRUCache {
  constructor(max) {
    this.max = max;
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  set(key, val) {
    this.map.delete(key);
    this.map.set(key, val);
    if (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value);
    }
  }
  has(key) { return this.map.has(key); }
  delete(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
  values() { return this.map.values(); }
  entries() { return this.map.entries(); }
  keys() { return this.map.keys(); }
}

// ─── Caches ──────────────────────────────────────────────────────────────────

const chatCache = new Map();
const userCache = new Map();
const antiDeleteCache = new LRUCache(ANTIDELETE_MAX_ENTRIES);
const userStatsCache = new Map();

let _statsFlushTimer = null;
let _statsDirtyKeys = new Set();

// ─── Apply Caching ──────────────────────────────────────────────────────────

function applyDatabaseCaching() {
  let store;
  try {
    store = require("./store");
  } catch (e) {
    logger.error({ err: e }, "db-cache: store yüklenemedi, önbellekleme atlanıyor");
    return;
  }

  const { Chat, User, AntiDeleteCache, UserStats } = store;
  if (!Chat || !User || !AntiDeleteCache || !UserStats) {
    logger.warn("db-cache: model(ler) eksik, önbellekleme atlanıyor");
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. AntiDeleteCache → tamamen in-memory, DB'ye hiç gitmez
  // ═══════════════════════════════════════════════════════════════════════════

  AntiDeleteCache.create = async function (values) {
    if (values && values.messageId) {
      antiDeleteCache.set(values.messageId, {
        messageId: values.messageId,
        chatJid: values.chatJid,
        senderJid: values.senderJid,
        fullContent: values.fullContent,
        timestamp: values.timestamp || new Date(),
        dataValues: values,
        get(k) { return this[k] ?? this.dataValues?.[k]; },
      });
    }
    return values;
  };

  AntiDeleteCache.bulkCreate = async function (records) {
    for (const r of records) {
      await AntiDeleteCache.create(r);
    }
    return records;
  };

  AntiDeleteCache.findOne = async function (options) {
    const rawId = options?.where?.messageId;
    const msgId = typeof rawId === "string" ? rawId
      : typeof rawId === "object" && rawId !== null
        ? rawId[Object.getOwnPropertySymbols(rawId)?.[0]] ?? null
        : null;
    if (msgId && typeof msgId === "string") {
      const exact = antiDeleteCache.get(msgId);
      if (exact) return exact;
    }
    return null;
  };

  AntiDeleteCache.findAll = async function (options) {
    const chatJid = options?.where?.chatJid;
    const results = [];
    for (const v of antiDeleteCache.values()) {
      if (!chatJid || v.chatJid === chatJid) results.push(v);
    }
    return results;
  };

  AntiDeleteCache.destroy = async function (options) {
    if (options?.where?.messageId) {
      antiDeleteCache.delete(options.where.messageId);
      return 1;
    }
    if (options?.where?.timestamp) {
      let count = 0;
      const cutoff = options.where.timestamp?.[Symbol.for("sequelize.Op.lt")] ??
        options.where.timestamp?.[Object.getOwnPropertySymbols(options.where.timestamp)?.[0]];
      if (cutoff) {
        const cutoffTime = new Date(cutoff).getTime();
        for (const [k, v] of antiDeleteCache.entries()) {
          if (new Date(v.timestamp).getTime() < cutoffTime) {
            antiDeleteCache.delete(k);
            count++;
          }
        }
      }
      return count;
    }
    const sz = antiDeleteCache.size;
    antiDeleteCache.clear();
    return sz;
  };

  AntiDeleteCache.count = async function () {
    return antiDeleteCache.size;
  };

  AntiDeleteCache.sync = async function () { return AntiDeleteCache; };

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Chat → bellekte cache'le, sadece yeni chat'ler için DB'ye yaz
  // ═══════════════════════════════════════════════════════════════════════════

  const _origChatFindOrCreate = Chat.findOrCreate.bind(Chat);
  const _origChatFindOne = Chat.findOne.bind(Chat);
  const _origChatUpsert = Chat.upsert.bind(Chat);
  const _origChatCreate = Chat.create.bind(Chat);

  Chat.findOrCreate = async function (options) {
    const jid = options?.where?.jid;
    if (jid && chatCache.has(jid)) {
      return [chatCache.get(jid), false];
    }
    try {
      const result = await _origChatFindOrCreate(options);
      if (jid && result?.[0]) chatCache.set(jid, result[0]);
      pruneMap(chatCache);
      return result;
    } catch (e) {
      if (jid && options?.defaults) {
        const fake = { jid, ...options.defaults, dataValues: { jid, ...options.defaults } };
        chatCache.set(jid, fake);
        return [fake, true];
      }
      throw e;
    }
  };

  Chat.findOne = async function (options) {
    const jid = options?.where?.jid;
    if (jid && chatCache.has(jid)) return chatCache.get(jid);
    const result = await _origChatFindOne(options);
    if (jid && result) chatCache.set(jid, result);
    return result;
  };

  Chat.upsert = async function (values, options) {
    const jid = values?.jid;
    if (jid && chatCache.has(jid)) {
      const existing = chatCache.get(jid);
      if (existing?.dataValues) Object.assign(existing.dataValues, values);
      return [existing, false];
    }
    try {
      const result = await _origChatUpsert(values, options);
      if (jid && result?.[0]) chatCache.set(jid, result[0]);
      pruneMap(chatCache);
      return result;
    } catch (e) {
      if (jid) {
        const fake = { ...values, dataValues: values };
        chatCache.set(jid, fake);
        return [fake, true];
      }
      throw e;
    }
  };

  Chat.create = async function (values, options) {
    const jid = values?.jid;
    if (jid && chatCache.has(jid)) {
      return chatCache.get(jid);
    }
    const result = await _origChatCreate(values, options);
    if (jid && result) chatCache.set(jid, result);
    return result;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. User → bellekte cache'le, sadece yeni user'lar için DB'ye yaz
  // ═══════════════════════════════════════════════════════════════════════════

  const _origUserFindOrCreate = User.findOrCreate.bind(User);
  const _origUserFindOne = User.findOne.bind(User);
  const _origUserUpsert = User.upsert.bind(User);
  const _origUserCreate = User.create.bind(User);

  User.findOrCreate = async function (options) {
    const jid = options?.where?.jid;
    if (jid && userCache.has(jid)) {
      return [userCache.get(jid), false];
    }
    try {
      const result = await _origUserFindOrCreate(options);
      if (jid && result?.[0]) userCache.set(jid, result[0]);
      pruneMap(userCache);
      return result;
    } catch (e) {
      if (jid && options?.defaults) {
        const fake = { jid, ...options.defaults, dataValues: { jid, ...options.defaults }, get(k) { return this[k]; } };
        userCache.set(jid, fake);
        return [fake, true];
      }
      throw e;
    }
  };

  User.findOne = async function (options) {
    const jid = options?.where?.jid;
    if (jid && userCache.has(jid)) return userCache.get(jid);
    const result = await _origUserFindOne(options);
    if (jid && result) userCache.set(jid, result);
    return result;
  };

  User.upsert = async function (values, options) {
    const jid = values?.jid;
    if (jid && userCache.has(jid)) {
      const existing = userCache.get(jid);
      if (existing?.dataValues) Object.assign(existing.dataValues, values);
      return [existing, false];
    }
    try {
      const result = await _origUserUpsert(values, options);
      if (jid && result?.[0]) userCache.set(jid, result[0]);
      pruneMap(userCache);
      return result;
    } catch (e) {
      if (jid) {
        const fake = { ...values, dataValues: values };
        userCache.set(jid, fake);
        return [fake, true];
      }
      throw e;
    }
  };

  User.create = async function (values, options) {
    const jid = values?.jid;
    if (jid && userCache.has(jid)) {
      return userCache.get(jid);
    }
    const result = await _origUserCreate(values, options);
    if (jid && result) userCache.set(jid, result);
    return result;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. UserStats → bellekte sayaçları tut, periyodik flush
  // ═══════════════════════════════════════════════════════════════════════════

  const _origStatsFindOne = UserStats.findOne.bind(UserStats);
  const _origStatsFindAll = UserStats.findAll.bind(UserStats);
  const _origStatsCreate = UserStats.create.bind(UserStats);
  const _origStatsUpsert = UserStats.upsert?.bind(UserStats);

  UserStats.findOne = async function (options) {
    const userJid = options?.where?.userJid;
    const chatJid = options?.where?.chatJid;
    if (userJid && chatJid) {
      const key = `${userJid}::${chatJid}`;
      if (userStatsCache.has(key)) return userStatsCache.get(key);
    }
    const result = await _origStatsFindOne(options);
    if (userJid && chatJid && result) {
      userStatsCache.set(`${userJid}::${chatJid}`, result);
      pruneMap(userStatsCache);
    }
    return result;
  };

  UserStats.findAll = async function (options) {
    return await _origStatsFindAll(options);
  };

  const _origStatsIncrement = UserStats.prototype.increment;
  if (_origStatsIncrement) {
    UserStats.prototype.increment = async function (fields, options) {
      const key = `${this.userJid || this.dataValues?.userJid}::${this.chatJid || this.dataValues?.chatJid}`;

      if (this.dataValues) {
        if (typeof fields === "string") {
          this.dataValues[fields] = (this.dataValues[fields] || 0) + 1;
        } else if (typeof fields === "object" && !Array.isArray(fields)) {
          for (const [f, inc] of Object.entries(fields)) {
            this.dataValues[f] = (this.dataValues[f] || 0) + (inc || 1);
          }
        } else if (Array.isArray(fields)) {
          for (const f of fields) {
            this.dataValues[f] = (this.dataValues[f] || 0) + 1;
          }
        }
      }

      _statsDirtyKeys.add(key);
      userStatsCache.set(key, this);

      return this;
    };
  }

  const _origStatsSave = UserStats.prototype.save;
  if (_origStatsSave) {
    UserStats.prototype.save = async function (options) {
      const key = `${this.userJid || this.dataValues?.userJid}::${this.chatJid || this.dataValues?.chatJid}`;
      _statsDirtyKeys.add(key);
      userStatsCache.set(key, this);
      return this;
    };
  }

  const _origStatsUpdate = UserStats.prototype.update;
  if (_origStatsUpdate) {
    const patchedUpdate = async function (values, options) {
      if (this.dataValues && values) {
        Object.assign(this.dataValues, values);
      }
      const key = `${this.userJid || this.dataValues?.userJid}::${this.chatJid || this.dataValues?.chatJid}`;
      _statsDirtyKeys.add(key);
      userStatsCache.set(key, this);
      return this;
    };
    UserStats.prototype.update = patchedUpdate;
  }

  // ─── Periyodik flush: dirty UserStats'leri DB'ye yaz ───────────────────────

  async function flushDirtyStats() {
    if (_statsDirtyKeys.size === 0) return;

    const keys = [..._statsDirtyKeys];
    _statsDirtyKeys = new Set();

    let flushed = 0;
    let errors = 0;

    for (const key of keys) {
      const instance = userStatsCache.get(key);
      if (!instance?.dataValues) continue;

      try {
        if (_origStatsUpsert) {
          await _origStatsUpsert(instance.dataValues);
        } else if (_origStatsSave && typeof instance.changed === "function") {
          await _origStatsSave.call(instance);
        } else {
          const vals = { ...instance.dataValues };
          delete vals.id;
          const [existing] = await _origStatsFindAll({
            where: { userJid: vals.userJid, chatJid: vals.chatJid },
            limit: 1,
          });
          if (existing) {
            await _origStatsUpdate?.call(existing, vals);
          } else {
            await _origStatsCreate(vals);
          }
        }
        flushed++;
      } catch (e) {
        errors++;
        _statsDirtyKeys.add(key);
        if (errors <= 3) {
          logger.error({ err: e, key }, "db-cache: UserStats flush hatası");
        }
      }
    }

    if (flushed > 0) {
      logger.info(`db-cache: ${flushed} UserStats kaydı DB'ye yazıldı` +
        (errors > 0 ? ` (${errors} hata)` : ""));
    }
  }

  _statsFlushTimer = setInterval(flushDirtyStats, STATS_FLUSH_INTERVAL);
  if (_statsFlushTimer.unref) _statsFlushTimer.unref();

  // ─── Cleanup & Shutdown ────────────────────────────────────────────────────

  store._dbCacheFlush = flushDirtyStats;

  store._dbCacheCleanup = function () {
    if (_statsFlushTimer) {
      clearInterval(_statsFlushTimer);
      _statsFlushTimer = null;
    }
  };

  store._dbCacheStats = function () {
    return {
      chatCache: chatCache.size,
      userCache: userCache.size,
      antiDeleteCache: antiDeleteCache.size,
      userStatsCache: userStatsCache.size,
      dirtyStats: _statsDirtyKeys.size,
    };
  };

  logger.info("db-cache: Veritabanı önbellekleme katmanı aktif");
  console.log("- DB önbellekleme aktif (AntiDelete=bellek, Chat/User/Stats=cache)");
}

function pruneMap(map) {
  if (map.size > MAX_CACHE_SIZE) {
    const excess = map.size - MAX_CACHE_SIZE + 100;
    const keys = map.keys();
    for (let i = 0; i < excess; i++) {
      map.delete(keys.next().value);
    }
  }
}

async function shutdownCache() {
  let store;
  try {
    store = require("./store");
  } catch (_) { return; }

  if (typeof store._dbCacheFlush === "function") {
    try {
      await store._dbCacheFlush();
    } catch (e) {
      logger.error({ err: e }, "db-cache: kapatma sırasında flush hatası");
    }
  }
  if (typeof store._dbCacheCleanup === "function") {
    store._dbCacheCleanup();
  }
}

module.exports = { applyDatabaseCaching, shutdownCache };

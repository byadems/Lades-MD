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

// 0.2 vCPU / 512MB RAM için optimize edilmiş değerler
const STATS_FLUSH_INTERVAL = parseInt(process.env.STATS_FLUSH_INTERVAL || String(10 * 60 * 1000), 10);
const ANTIDELETE_MAX_ENTRIES = parseInt(process.env.ANTIDELETE_MAX || "100", 10);
const MAX_CACHE_SIZE = parseInt(process.env.MAX_CACHE_SIZE || "500", 10);

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

const chatCache = new LRUCache(MAX_CACHE_SIZE);
const userCache = new LRUCache(MAX_CACHE_SIZE);
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

  alignUserStatsModel(UserStats);

  // ─── FK parent guarantee: UserStats insert'ten önce User+Chat DB'de olmalı ──
  const _origUserUpsertRaw = User.upsert.bind(User);
  const _origChatUpsertRaw = Chat.upsert.bind(Chat);
  const _parentEnsureCache = new Set();

  async function ensureParentRecords(userJid, chatJid) {
    const parentKey = `${userJid}::${chatJid}`;
    if (_parentEnsureCache.has(parentKey)) return;

    try {
      if (userJid) {
        await _origUserUpsertRaw({ jid: userJid }, { conflictFields: ["jid"] }).catch(() => {});
      }
      if (chatJid) {
        const chatType = chatJid.endsWith("@g.us") ? "group" : "private";
        await _origChatUpsertRaw({ jid: chatJid, type: chatType }, { conflictFields: ["jid"] }).catch(() => {});
      }
      _parentEnsureCache.add(parentKey);
      if (_parentEnsureCache.size > MAX_CACHE_SIZE) {
        const first = _parentEnsureCache.values().next().value;
        _parentEnsureCache.delete(first);
      }
    } catch (_) {}
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

  UserStats.create = async function (values, options) {
    if (values?.userJid && values?.chatJid) {
      await ensureParentRecords(values.userJid, values.chatJid);
      const key = `${values.userJid}::${values.chatJid}`;
      const result = await _origStatsCreate(values, options);
      if (result) { userStatsCache.set(key, result); pruneMap(userStatsCache); }
      return result;
    }
    return _origStatsCreate(values, options);
  };

  if (_origStatsUpsert) {
    UserStats.upsert = async function (values, options) {
      if (values?.userJid && values?.chatJid) {
        await ensureParentRecords(values.userJid, values.chatJid);
      }
      return _origStatsUpsert(values, options);
    };
  }

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
      pruneMap(userStatsCache);

      return this;
    };
  }

  const _origStatsSave = UserStats.prototype.save;
  if (_origStatsSave) {
    UserStats.prototype.save = async function (options) {
      const key = `${this.userJid || this.dataValues?.userJid}::${this.chatJid || this.dataValues?.chatJid}`;
      _statsDirtyKeys.add(key);
      userStatsCache.set(key, this);
      pruneMap(userStatsCache);
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
      pruneMap(userStatsCache);
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
        const dv = instance.dataValues;
        if (dv.userJid && dv.chatJid) {
          await ensureParentRecords(dv.userJid, dv.chatJid);
        }

        if (_origStatsUpsert) {
          await _origStatsUpsert(dv, {
            conflictFields: ["userJid", "chatJid"],
          });
        } else if (_origStatsSave && typeof instance.changed === "function") {
          await _origStatsSave.call(instance);
        } else {
          const vals = { ...dv };
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
        const isFKError = e?.name === "SequelizeForeignKeyConstraintError" ||
          (e?.parent?.code === "SQLITE_CONSTRAINT" && String(e?.message).includes("FOREIGN KEY"));
        if (isFKError) {
          _parentEnsureCache.delete(`${instance.dataValues?.userJid}::${instance.dataValues?.chatJid}`);
        }
        errors++;
        _statsDirtyKeys.add(key);
        if (errors <= 3 && !isFKError) {
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

function alignUserStatsModel(UserStats) {
  try {
    const attrs = UserStats.rawAttributes || {};

    if (attrs.userJid?.unique) delete attrs.userJid.unique;
    if (attrs.chatJid?.unique) delete attrs.chatJid.unique;

    const indexes = Array.isArray(UserStats.options?.indexes)
      ? UserStats.options.indexes
      : [];

    const filteredIndexes = indexes.filter((idx) => {
      if (!idx?.unique) return true;
      const fields = (idx.fields || []).map((f) =>
        typeof f === "string" ? f : (f?.name || f?.attribute)
      ).filter(Boolean);
      return !(
        fields.length === 1 &&
        (fields[0] === "userJid" || fields[0] === "chatJid")
      );
    });

    const hasCompositeUnique = filteredIndexes.some((idx) => {
      if (!idx?.unique) return false;
      const fields = (idx.fields || []).map((f) =>
        typeof f === "string" ? f : (f?.name || f?.attribute)
      );
      return fields.length === 2 && fields[0] === "userJid" && fields[1] === "chatJid";
    });

    if (!hasCompositeUnique) {
      filteredIndexes.push({
        name: "userstats_userjid_chatjid_unique",
        unique: true,
        fields: ["userJid", "chatJid"],
      });
    }

    UserStats.options.indexes = filteredIndexes;
    if (typeof UserStats.refreshAttributes === "function") {
      UserStats.refreshAttributes();
    }
  } catch (e) {
    logger.warn({ err: e }, "db-cache: UserStats model hizalama başarısız");
  }
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

// Periyodik cache temizliği: her 20 dakikada bir userStatsCache'i prune et.
// chatCache ve userCache artık LRUCache kullandığından otomatik eviction yapar.
const _cacheCleanupTimer = setInterval(() => {
  pruneMap(userStatsCache);
}, 20 * 60 * 1000);
if (_cacheCleanupTimer.unref) _cacheCleanupTimer.unref();

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

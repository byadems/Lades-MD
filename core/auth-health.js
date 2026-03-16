const { logger } = require("../config");

const SIGNAL_WINDOW_MS = parseInt(process.env.AUTH_SIGNAL_WINDOW_MS || String(5 * 60 * 1000), 10);
const SIGNAL_THRESHOLD = Math.max(parseInt(process.env.AUTH_SIGNAL_THRESHOLD || "6", 10), 1);
const LOG_THROTTLE_MS = parseInt(process.env.AUTH_LOG_THROTTLE_MS || "60000", 10);
const DEGRADED_TTL_MS = parseInt(process.env.AUTH_DEGRADED_TTL_MS || String(30 * 60 * 1000), 10);

const SIGNAL_ERROR_REGEX = /(no\s+session\s+found\s+to\s+decrypt\s+message|failed\s+to\s+decrypt|prekey|invalid\s+pre\s*key|invalid\s+session|session\s+logged\s+out|signal)/i;

const sessions = new Map();
const logThrottle = new Map();

function getSessionState(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      signalErrorTimestamps: [],
      degradedAuth: false,
      degradedUntil: 0,
      operatorAlerted: false,
      lastSignalText: null,
    });
  }
  const state = sessions.get(sessionId);
  if (state.degradedAuth && state.degradedUntil && Date.now() > state.degradedUntil) {
    state.degradedAuth = false;
    state.degradedUntil = 0;
    state.operatorAlerted = false;
  }
  return state;
}

function withLogThrottle(key, level, payload, message) {
  const now = Date.now();
  const last = logThrottle.get(key) || 0;
  if (now - last < LOG_THROTTLE_MS) return false;
  logThrottle.set(key, now);
  logger[level](payload, message);
  return true;
}

function pushSignalError(sessionId, text, meta = {}) {
  const state = getSessionState(sessionId);
  const now = Date.now();
  state.signalErrorTimestamps.push(now);
  state.signalErrorTimestamps = state.signalErrorTimestamps.filter((t) => now - t <= SIGNAL_WINDOW_MS);
  state.lastSignalText = text;

  withLogThrottle(
    `signal:${sessionId}:${String(text || "unknown").toLowerCase()}`,
    "warn",
    { session: sessionId, countInWindow: state.signalErrorTimestamps.length, windowMs: SIGNAL_WINDOW_MS, err: text, ...meta },
    "Signal decrypt/auth hatası algılandı"
  );

  if (!state.degradedAuth && state.signalErrorTimestamps.length >= SIGNAL_THRESHOLD) {
    state.degradedAuth = true;
    state.degradedUntil = now + DEGRADED_TTL_MS;

    logger.error(
      {
        session: sessionId,
        countInWindow: state.signalErrorTimestamps.length,
        threshold: SIGNAL_THRESHOLD,
        windowMs: SIGNAL_WINDOW_MS,
        degradedUntil: new Date(state.degradedUntil).toISOString(),
      },
      "Oturum degraded_auth moduna alındı; yüksek maliyetli grup operasyonları geçici askıda"
    );

    if (!state.operatorAlerted) {
      state.operatorAlerted = true;
      logger.error(
        { session: sessionId },
        "OPERATÖR UYARISI: SESSION yenile + linked devices temizle"
      );
    }
  }

  return {
    countInWindow: state.signalErrorTimestamps.length,
    degradedAuth: state.degradedAuth,
    degradedUntil: state.degradedUntil,
  };
}

function isSignalAuthError(text) {
  return SIGNAL_ERROR_REGEX.test(String(text || ""));
}

function noteError(sessionId, errorOrText, meta = {}) {
  const text = typeof errorOrText === "string"
    ? errorOrText
    : [
      errorOrText?.message,
      errorOrText?.data,
      errorOrText?.reason,
      errorOrText?.stack,
      errorOrText?.output?.statusCode,
      errorOrText?.statusCode,
    ].filter(Boolean).join(" ");

  if (!isSignalAuthError(text)) return null;
  return pushSignalError(sessionId, text, meta);
}

function isSessionDegraded(sessionId) {
  return getSessionState(sessionId).degradedAuth;
}

function hasAnyDegradedSession(sessionIds = []) {
  if (sessionIds.length === 0) {
    return Array.from(sessions.keys()).some((sid) => isSessionDegraded(sid));
  }
  return sessionIds.some((sid) => isSessionDegraded(sid));
}

function classifyForbiddenError(error, operation, sessionId) {
  const statusCode = Number(
    error?.output?.statusCode ||
    error?.statusCode ||
    error?.response?.status ||
    error?.data?.status
  );
  if (statusCode !== 403) return null;

  const text = [
    error?.message,
    error?.data,
    error?.response?.data?.message,
    error?.response?.data?.error,
  ].filter(Boolean).join(" ").toLowerCase();

  let category = "wa_policy_or_temporary";
  if (/(not\s+admin|admin\s+required|insufficient\s+permission|forbidden\s+to\s+access)/i.test(text)) {
    category = "missing_admin_privilege";
  } else if (/(not\s+in\s+group|item-not-found|group\s+not\s+found|participant\s+not\s+found|404)/i.test(text)) {
    category = "bot_removed_or_not_in_group";
  }

  withLogThrottle(
    `forbidden:${sessionId}:${operation}:${category}`,
    "warn",
    { session: sessionId, statusCode, operation, category, err: error?.message || String(error) },
    "403 forbidden grup operasyonu sınıflandırıldı"
  );

  return { statusCode, operation, category };
}

function wrapGroupOpsForSession(bot, sessionId) {
  const sock = bot?.sock;
  if (!sock || sock.__authHealthWrapped) return;

  const wrap = (methodName, operationName, highCost = false) => {
    const original = sock[methodName];
    if (typeof original !== "function") return;

    sock[methodName] = async function wrappedGroupOperation(...args) {
      if (highCost && isSessionDegraded(sessionId)) {
        withLogThrottle(
          `degraded-op:${sessionId}:${operationName}`,
          "warn",
          { session: sessionId, operation: operationName, argsPreview: String(args[0] || "") },
          "degraded_auth nedeniyle yüksek maliyetli grup işlemi geçici olarak atlandı"
        );
        const err = new Error(`Operation blocked in degraded_auth mode: ${operationName}`);
        err.code = "DEGRADED_AUTH_MODE";
        throw err;
      }

      try {
        return await original.apply(this, args);
      } catch (error) {
        noteError(sessionId, error, { operation: operationName });
        classifyForbiddenError(error, operationName, sessionId);
        throw error;
      }
    };
  };

  wrap("groupMetadata", "groupMetadata", true);
  wrap("groupParticipantsUpdate", "groupParticipantsUpdate", true);
  sock.__authHealthWrapped = true;
}

module.exports = {
  noteError,
  isSignalAuthError,
  isSessionDegraded,
  hasAnyDegradedSession,
  classifyForbiddenError,
  wrapGroupOpsForSession,
  withLogThrottle,
};

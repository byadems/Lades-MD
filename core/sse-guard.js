const Module = require("module");
const { logger } = require("../config");
const { withLogThrottle } = require("./auth-health");

const RECOVERABLE_SSE_REGEX = /(terminated:\s*other side closed|econnreset|socket hang up)/i;
const BASE_BACKOFF_MS = [1000, 2000, 5000];
const MAX_BACKOFF_MS = 30000;
const JITTER_RATIO = 0.2;
const OPERATOR_ALERT_THRESHOLD = Math.max(parseInt(process.env.SSE_OPERATOR_ALERT_THRESHOLD || "5", 10), 1);

const sessionFailures = new Map();

function normalizeReason(reason) {
  return String(reason || "unknown")
    .toLowerCase()
    .slice(0, 160)
    .replace(/\s+/g, " ")
    .trim();
}

function getSessionKey(url, init) {
  const raw = String(url || "");

  try {
    const parsed = new URL(raw);
    const querySession =
      parsed.searchParams.get("session") ||
      parsed.searchParams.get("sessionId") ||
      parsed.searchParams.get("sid") ||
      parsed.searchParams.get("device") ||
      parsed.searchParams.get("id");

    if (querySession) return String(querySession);

    const pathMatch = parsed.pathname.match(/\/(session|sessions|device|devices)\/([^/?#]+)/i);
    if (pathMatch?.[2]) return String(pathMatch[2]);
  } catch (_) {
    // best effort
  }

  const headerSession =
    init?.headers?.["x-session-id"] ||
    init?.headers?.["X-Session-Id"] ||
    init?.headers?.["x-device-id"];

  return String(headerSession || raw || "unknown-session");
}

function isRecoverableError(reason) {
  return RECOVERABLE_SSE_REGEX.test(String(reason || ""));
}

function isNormalClose(reason, readyState) {
  if (readyState !== 2) return false;
  const s = String(reason || "").toLowerCase();
  if (!s) return true;
  return /(close|closed|eof|stream ended|ended normally)/i.test(s) && !/error|exception|fail/.test(s);
}

function computeBackoffMs(failureCount) {
  if (failureCount <= BASE_BACKOFF_MS.length) return BASE_BACKOFF_MS[failureCount - 1];
  const doubled = BASE_BACKOFF_MS[BASE_BACKOFF_MS.length - 1] * (2 ** (failureCount - BASE_BACKOFF_MS.length));
  return Math.min(doubled, MAX_BACKOFF_MS);
}

function applyJitter(ms) {
  const jitter = Math.floor(ms * JITTER_RATIO * Math.random());
  return Math.min(ms + jitter, MAX_BACKOFF_MS);
}

function getState(sessionKey) {
  if (!sessionFailures.has(sessionKey)) {
    sessionFailures.set(sessionKey, { failures: 0, alerted: false });
  }
  return sessionFailures.get(sessionKey);
}

function extractReason(error) {
  return [error?.message, error?.code, error?.status, error?.type, error?.cause?.message]
    .filter(Boolean)
    .join(" ");
}

function buildGuardedEventSource(NativeEventSource) {
  return class GuardedEventSource {
    constructor(url, init = {}) {
      this.url = url;
      this.init = init;
      this.sessionKey = getSessionKey(url, init);
      this.listeners = new Map();
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.readyState = 0;
      this.withCredentials = init?.withCredentials || false;
      this.CONNECTING = NativeEventSource.CONNECTING || 0;
      this.OPEN = NativeEventSource.OPEN || 1;
      this.CLOSED = NativeEventSource.CLOSED || 2;
      this._closedByUser = false;
      this._source = null;
      this._retryTimer = null;
      this._connect();
    }

    _dispatch(type, event) {
      const list = this.listeners.get(type) || [];
      for (const handler of list) {
        try {
          handler.call(this, event);
        } catch (_) {
          // noop
        }
      }

      const prop = this[`on${type}`];
      if (typeof prop === "function") {
        prop.call(this, event);
      }
    }

    _clearRetryTimer() {
      if (this._retryTimer) {
        clearTimeout(this._retryTimer);
        this._retryTimer = null;
      }
    }

    _connect() {
      this._clearRetryTimer();
      this.readyState = this.CONNECTING;

      const src = new NativeEventSource(this.url, this.init);
      this._source = src;

      src.onopen = (event) => {
        this.readyState = this.OPEN;
        const state = getState(this.sessionKey);
        state.failures = 0;
        state.alerted = false;
        this._dispatch("open", event);
      };

      src.onmessage = (event) => {
        this.readyState = this.OPEN;
        this._dispatch("message", event);
      };

      src.onerror = (event) => {
        const reason = extractReason(event);
        const state = getState(this.sessionKey);
        const normalClose = isNormalClose(reason, src.readyState);

        if (this._closedByUser) {
          this.readyState = this.CLOSED;
          return;
        }

        if (normalClose) {
          this.readyState = this.CLOSED;
          withLogThrottle(
            `sse-close:${this.sessionKey}`,
            "warn",
            { session: this.sessionKey, reason: reason || "stream closed", phase: "close" },
            "SSE stream closed, reconnect will be attempted"
          );
          this._scheduleRetry("normal-close");
          this._dispatch("error", event);
          return;
        }

        if (isRecoverableError(reason)) {
          state.failures += 1;
          const backoffMs = applyJitter(computeBackoffMs(state.failures));

          withLogThrottle(
            `sse-recoverable:${this.sessionKey}:${normalizeReason(reason)}`,
            "warn",
            { session: this.sessionKey, reason, failures: state.failures, nextRetryMs: backoffMs },
            "SSE recoverable connection issue"
          );

          if (state.failures >= OPERATOR_ALERT_THRESHOLD && !state.alerted) {
            state.alerted = true;
            logger.error(
              { session: this.sessionKey, failures: state.failures, threshold: OPERATOR_ALERT_THRESHOLD },
              "OPERATÖR UYARISI: Aynı SSE oturumunda ardışık bağlantı hataları tespit edildi"
            );
          }

          this._scheduleRetry("recoverable", backoffMs);
          this._dispatch("error", event);
          return;
        }

        logger.error(
          { session: this.sessionKey, reason, event },
          "SSE connection error"
        );

        this._dispatch("error", event);
      };
    }

    _scheduleRetry(category, explicitDelayMs) {
      if (this._closedByUser) return;
      const state = getState(this.sessionKey);
      const delay = explicitDelayMs || applyJitter(computeBackoffMs(Math.max(state.failures, 1)));
      this.readyState = this.CONNECTING;

      if (this._source?.readyState !== this.CLOSED) {
        try {
          this._source.close();
        } catch (_) {
          // noop
        }
      }

      withLogThrottle(
        `sse-retry:${this.sessionKey}:${category}`,
        "warn",
        { session: this.sessionKey, category, retryInMs: delay, failures: state.failures },
        "SSE reconnect scheduled"
      );

      this._clearRetryTimer();
      this._retryTimer = setTimeout(() => this._connect(), delay);
    }

    addEventListener(type, listener) {
      const list = this.listeners.get(type) || [];
      list.push(listener);
      this.listeners.set(type, list);
    }

    removeEventListener(type, listener) {
      const list = this.listeners.get(type) || [];
      this.listeners.set(type, list.filter((fn) => fn !== listener));
    }

    close() {
      this._closedByUser = true;
      this._clearRetryTimer();
      this.readyState = this.CLOSED;
      if (this._source && typeof this._source.close === "function") {
        this._source.close();
      }
    }
  };
}

function installSSEGuard() {
  if (global.__LADES_SSE_GUARD_INSTALLED) return;
  global.__LADES_SSE_GUARD_INSTALLED = true;

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, [request, parent, isMain]);
    if (request !== "eventsource") return loaded;

    if (loaded?.EventSource?.__ladesSseGuarded) return loaded;

    const NativeEventSource = loaded?.EventSource || loaded;
    if (typeof NativeEventSource !== "function") return loaded;

    const GuardedEventSource = buildGuardedEventSource(NativeEventSource);
    GuardedEventSource.__ladesSseGuarded = true;

    if (loaded?.EventSource) {
      return { ...loaded, EventSource: GuardedEventSource };
    }
    return GuardedEventSource;
  };
}

module.exports = {
  installSSEGuard,
  isRecoverableError,
  computeBackoffMs,
};

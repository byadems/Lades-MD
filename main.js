const config = require("./config");

const Commands = [];
let commandPrefix;
let handlerPrefix;

const COMMAND_MAX_CONCURRENCY = parseInt(
  process.env.COMMAND_MAX_CONCURRENCY || "8",
  10
);
const COMMAND_QUEUE_LIMIT = parseInt(
  process.env.COMMAND_QUEUE_LIMIT || "500",
  10
);
const COMMAND_TIMEOUT_MS = parseInt(
  process.env.COMMAND_TIMEOUT_MS || "45000",
  10
);

let commandActiveCount = 0;
let commandTimedOutCount = 0;
let commandZombieCount = 0;
const commandQueue = [];

function logQueueMetrics(reason, extra = {}) {
  const metrics = {
    reason,
    queueLength: commandQueue.length,
    activeCount: commandActiveCount,
    timedOutCount: commandTimedOutCount,
    zombieCount: commandZombieCount,
    ...extra,
  };
  console.log("[QueueMetrics]", JSON.stringify(metrics));
}

function getDispatchLoad() {
  return commandActiveCount + commandZombieCount;
}

class CommandTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "CommandTimeoutError";
  }
}

function runCommandQueue() {
  while (
    getDispatchLoad() < COMMAND_MAX_CONCURRENCY &&
    commandQueue.length > 0
  ) {
    const queued = commandQueue.shift();
    commandActiveCount++;
    logQueueMetrics("dispatch", { jobId: queued.id, command: queued.commandName });

    Promise.resolve()
      .then(() => queued.task())
      .then((result) => {
        if (result?.timedOut) {
          commandTimedOutCount++;
          console.warn(
            `[Queue] Komut zaman aşımına uğradı (${queued.commandName || "unknown"}, job=${queued.id})`
          );
        }

        if (result?.stillRunningPromise) {
          commandZombieCount++;
          console.warn(
            `[Queue] Timeout sonrası hala çalışan iş (zombi) tespit edildi (${queued.commandName || "unknown"}, job=${queued.id})`
          );
          logQueueMetrics("zombie_detected", { jobId: queued.id, command: queued.commandName });

          result.stillRunningPromise
            .catch(() => {})
            .finally(() => {
              commandZombieCount = Math.max(0, commandZombieCount - 1);
              logQueueMetrics("zombie_resolved", {
                jobId: queued.id,
                command: queued.commandName,
              });
              setImmediate(runCommandQueue);
            });
        }
      })
      .catch((e) => {
        console.error("Komut hatası:", e?.message || e);
      })
      .finally(() => {
        commandActiveCount = Math.max(0, commandActiveCount - 1);
        logQueueMetrics("complete", { jobId: queued.id, command: queued.commandName });
        setImmediate(runCommandQueue);
      });
  }
}

let commandTaskId = 0;

function enqueueCommand(task, meta = {}) {
  if (commandQueue.length >= COMMAND_QUEUE_LIMIT) {
    // Kuyruk dolarsa en eskiyi atarak anlık mesajlara öncelik ver.
    commandQueue.shift();
    console.warn(
      `[Queue] Komut kuyruğu doldu (${COMMAND_QUEUE_LIMIT}), en eski görev düşürüldü.`
    );
  }
  const id = ++commandTaskId;
  commandQueue.push({
    id,
    task,
    commandName: meta.commandName || "unknown",
  });
  logQueueMetrics("enqueue", { jobId: id, command: meta.commandName || "unknown" });
  setImmediate(runCommandQueue);
}

async function runWithTimeout(func, args, context = {}) {
  const controller = new AbortController();
  let timeoutId;
  let timedOut = false;
  let settled = false;

  const executionPromise = Promise.resolve()
    .then(() =>
      func(...args, {
        signal: controller.signal,
        commandContext: context,
      })
    )
    .finally(() => {
      settled = true;
    });

  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => {
          timedOut = true;
          controller.abort();
          reject(new CommandTimeoutError(`Komut zaman aşımı (${COMMAND_TIMEOUT_MS}ms)`));
        },
        COMMAND_TIMEOUT_MS
      );
      if (timeoutId.unref) timeoutId.unref();
    });

    await Promise.race([executionPromise, timeoutPromise]);
    return {
      timedOut: false,
      stillRunningPromise: null,
    };
  } catch (error) {
    if (!timedOut) {
      throw error;
    }

    return {
      timedOut: true,
      stillRunningPromise: settled ? null : executionPromise,
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function escapeRegex(str) {
  return String(str).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function buildHandlerPrefix(rawHandlers, allowNoPrefix) {
  if (rawHandlers === "^" || rawHandlers === "" || rawHandlers == null) {
    return "^";
  }

  const handlersStr = String(rawHandlers);

  if (handlersStr.length > 1 && handlersStr[0] === handlersStr[1]) {
    const literal = `^${escapeRegex(handlersStr)}`;
    return allowNoPrefix ? `${literal}?` : literal;
  }

  const parts = Array.from(handlersStr)
    .map((h) => escapeRegex(h))
    .filter(Boolean);

  if (parts.length === 0) {
    return "^";
  }

  const group = `^(?:${parts.join("|")})`;
  return allowNoPrefix ? `${group}?` : group;
}

if (config.HANDLERS === "false") {
  commandPrefix = "^";
} else {
  commandPrefix = config.HANDLERS;
}

handlerPrefix = buildHandlerPrefix(commandPrefix, Boolean(config.MULTI_HANDLERS));

function Module(info, func) {
  const validEventTypes = [
    "photo",
    "image",
    "text",
    "button",
    "group-update",
    "message",
    "start",
  ];

  const wrappedFunc = config.PARALLEL_COMMANDS
    ? async (...args) => {
        const commandName = info.pattern || info.on || "message";
        enqueueCommand(
          () =>
            runWithTimeout(func, args, {
              commandName,
              enqueuedAt: Date.now(),
            }),
          { commandName }
        );
      }
    : func;

  const commandInfo = {
    fromMe: info.fromMe ?? config.isPrivate,
    desc: info.desc ?? "",
    usage: info.usage ?? "",
    excludeFromCommands: info.excludeFromCommands ?? false,
    dontAddCommandList: info.dontAddCommandList ?? false,
    warn: info.warn ?? "",
    use: info.use ?? "",
    function: wrappedFunc,
  };

  if (info.on === undefined && info.pattern === undefined) {
    commandInfo.on = "message";
    commandInfo.fromMe = false;
  } else if (info.on !== undefined && validEventTypes.includes(info.on)) {
    commandInfo.on = info.on;
    if (info.pattern !== undefined) {
      const prefix = (info.handler ?? true) ? handlerPrefix : "";
      const patternStr = `${prefix}${info.pattern}`;
      commandInfo.pattern = new RegExp(patternStr, "s");
    }
  } else if (info.pattern !== undefined) {
    const prefix = (info.handler ?? true) ? handlerPrefix : "";
    const patternStr = `${prefix}${info.pattern}`;
    commandInfo.pattern = new RegExp(patternStr, "s");
  }

  Commands.push(commandInfo);
  return commandInfo;
}

module.exports = {
  Module,
  commands: Commands,
};

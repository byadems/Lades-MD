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
const commandQueue = [];

function runCommandQueue() {
  while (
    commandActiveCount < COMMAND_MAX_CONCURRENCY &&
    commandQueue.length > 0
  ) {
    const queued = commandQueue.shift();
    commandActiveCount++;

    Promise.resolve()
      .then(() => queued.task())
      .catch((e) => {
        console.error("Komut hatası:", e?.message || e);
      })
      .finally(() => {
        commandActiveCount = Math.max(0, commandActiveCount - 1);
        setImmediate(runCommandQueue);
      });
  }
}

function enqueueCommand(task) {
  if (commandQueue.length >= COMMAND_QUEUE_LIMIT) {
    // Kuyruk dolarsa en eskiyi atarak anlık mesajlara öncelik ver.
    commandQueue.shift();
    console.warn(
      `[Queue] Komut kuyruğu doldu (${COMMAND_QUEUE_LIMIT}), en eski görev düşürüldü.`
    );
  }
  commandQueue.push({ task });
  setImmediate(runCommandQueue);
}

async function runWithTimeout(func, args) {
  let timeoutId;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Komut zaman aşımı (${COMMAND_TIMEOUT_MS}ms)`)),
        COMMAND_TIMEOUT_MS
      );
      if (timeoutId.unref) timeoutId.unref();
    });

    await Promise.race([Promise.resolve(func(...args)), timeoutPromise]);
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
        enqueueCommand(() => runWithTimeout(func, args));
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

const path = require("path");
const fs = require("fs");
const os = require("os");
const { Readable } = require("stream");
const ffmpeg = require("fluent-ffmpeg");

let TEMP_DIR;
if (process.env.TEMP_DIR) {
  TEMP_DIR = process.env.TEMP_DIR;
  os.tmpdir = () => path.join(__dirname, "..", TEMP_DIR);
} else {
  TEMP_DIR = path.join(os.tmpdir(), "lades");
}

function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
  return TEMP_DIR;
}

function getTempPath(filename) {
  ensureTempDir();
  return path.join(TEMP_DIR, filename);
}

function getTempSubdir(subdir) {
  const subdirPath = path.join(TEMP_DIR, subdir);
  if (!fs.existsSync(subdirPath)) {
    fs.mkdirSync(subdirPath, { recursive: true });
  }
  return subdirPath;
}

async function loadBaileys() {
  try {
    const baileys = await import("baileys");
    return baileys;
  } catch (err) {
    try {
      const baileys = require("baileys");
      return baileys;
    } catch (requireErr) {
      throw new Error(
        `Baileys yüklenemedi: ${err.message}. Yedek hata: ${requireErr.message}`
      );
    }
  }
}

function suppressLibsignalLogs() {
  const LIBSIGNAL_NOISE = [
    "No session found",
    "No matching sessions",
    "session not found",
    "Bad Mac",
    "MessageCounterError",
  ];
  const _origLog = console.log.bind(console);
  console.log = (...args) => {
    const msg = typeof args[0] === "string" ? args[0] : "";
    if (LIBSIGNAL_NOISE.some((p) => msg.includes(p))) return;
    _origLog(...args);
  };
}

const jimp = require("jimp");

async function genThumb(url) {
  try {
    const MAX_SIZE = 300;
    const img = await jimp.read(url);
    
    let { width, height } = img.bitmap;
    let w = width;
    let h = height;

    if (width > MAX_SIZE || height > MAX_SIZE) {
      const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
      w = Math.floor(width * ratio);
      h = Math.floor(height * ratio);
    }
    
    return await img.resize(w, h, jimp.RESIZE_NEAREST_NEIGHBOR).getBufferAsync("image/jpeg");
  } catch (error) {
    console.error("Küçük resim oluşturulamadı:", error);
    return null;
  }
}

let activeKickBotTasks = [];
let isKickBotInitialized = false;

function detectHostnames() {
  const hostnames = [];
  if (process.env.KOYEB_PUBLIC_DOMAIN?.trim()) {
    hostnames.push(`https://${process.env.KOYEB_PUBLIC_DOMAIN.trim()}`);
  }
  if (process.env.RENDER_EXTERNAL_HOSTNAME?.trim()) {
    hostnames.push(`https://${process.env.RENDER_EXTERNAL_HOSTNAME.trim()}`);
  }
  if (process.env.RAILWAY_PUBLIC_DOMAIN?.trim()) {
    hostnames.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN.trim()}`);
  }
  return hostnames;
}

async function pingHostname(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Lades-KickBot/1.0" },
    });
    if (response.ok) {
      return true;
    }
  } catch (e) {}
  return false;
}

async function initializeKickBot() {
  if (isKickBotInitialized) return;
  const hostnames = detectHostnames();
  if (hostnames.length === 0) return;

  isKickBotInitialized = true;
  console.log(`[Bot-Sistemi] Etkin: ${hostnames[0]}`);

  await Promise.allSettled(hostnames.map(pingHostname));

  const intervalId = setInterval(
    () => Promise.allSettled(hostnames.map(pingHostname)),
    8 * 60 * 1000
  );

  activeKickBotTasks.push(intervalId);
}

function cleanupKickBot() {
  activeKickBotTasks.forEach(clearInterval);
  activeKickBotTasks = [];
  isKickBotInitialized = false;
}

function convertToOgg(inputBuffer) {
  return new Promise((resolve, reject) => {
    const inputStream = Readable.from(inputBuffer);
    const outputStream = ffmpeg(inputStream)
      .audioCodec("libopus")
      .format("ogg")
      .pipe();

    const chunks = [];
    outputStream.on("data", (chunk) => chunks.push(chunk));
    outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    outputStream.on("error", reject);
  });
}

async function toBuffer(input) {
  const fs = require("fs");
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (input && input.url) {
    const url = input.url;
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      return await require("../plugins/utils").getBuffer(url);
    }
    if (typeof url === "string" && fs.existsSync(url))
      return await fs.promises.readFile(url);
    if (Buffer.isBuffer(url)) return url;
  }
  if (typeof input === "string" && fs.existsSync(input))
    return await fs.promises.readFile(input);
  const d = input && (input.data || input.buffer);
  if (Buffer.isBuffer(d)) return d;
  if (Array.isArray(d)) return Buffer.from(d);
  if (d instanceof Uint8Array) return Buffer.from(d);

  return null;
}

const STALE_FILE_AGE_MS = 30 * 60 * 1000;
let _tempCleanupTimer = null;

function startTempCleanup() {
  if (_tempCleanupTimer) return;
  _tempCleanupTimer = setInterval(() => {
    try {
      if (!fs.existsSync(TEMP_DIR)) return;
      const now = Date.now();
      const entries = fs.readdirSync(TEMP_DIR, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(TEMP_DIR, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs > STALE_FILE_AGE_MS) {
            if (entry.isDirectory()) {
              fs.rmSync(fullPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(fullPath);
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }, 15 * 60 * 1000);

  if (_tempCleanupTimer.unref) _tempCleanupTimer.unref();
}

function stopTempCleanup() {
  if (_tempCleanupTimer) {
    clearInterval(_tempCleanupTimer);
    _tempCleanupTimer = null;
  }
}

module.exports = {
  loadBaileys,
  suppressLibsignalLogs,
  genThumb,
  convertToOgg,
  toBuffer,
  initializeKickBot,
  cleanupKickBot,
  TEMP_DIR,
  ensureTempDir,
  getTempPath,
  getTempSubdir,
  startTempCleanup,
  stopTempCleanup,
};

const axios = require("axios");
const cheerio = require("cheerio");
const { Module } = require("../main");
const { BotVariable } = require("../core/database");
const { downloadGram, fb } = require("./utils");

const DEFAULT_IG_URL = "https://www.instagram.com/mansurgrossavm/";
const DEFAULT_FB_URL = "https://www.facebook.com/mansurgrossavm/?locale=tr_TR";
const DEFAULT_INTERVAL_DAYS = 2;
const TICK_MS = 60 * 1000;

const VARS = {
  enabled: "SOCIAL_WATCH_ENABLED",
  target: "SOCIAL_WATCH_TARGET",
  intervalDays: "SOCIAL_WATCH_INTERVAL_DAYS",
  source: "SOCIAL_WATCH_SOURCE",
  igUrl: "SOCIAL_WATCH_IG_URL",
  fbUrl: "SOCIAL_WATCH_FB_URL",
  lastPost: "SOCIAL_WATCH_LAST_POST",
  lastCheck: "SOCIAL_WATCH_LAST_CHECK",
};

let latestClient = null;
let tickerStarted = false;
let activeRun = null;

function normalizeUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function toBool(value) {
  const v = String(value || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}

async function getVar(key, fallback = null) {
  const row = await BotVariable.findOne({ where: { key } });
  return row ? row.value : fallback;
}

async function setVar(key, value) {
  await BotVariable.upsert({ key, value: String(value ?? "") });
}

async function loadSettings() {
  const enabled = toBool(await getVar(VARS.enabled, "false"));
  const target = await getVar(VARS.target, "");
  const source = (await getVar(VARS.source, "auto")).toLowerCase();
  const igUrl = await getVar(VARS.igUrl, DEFAULT_IG_URL);
  const fbUrl = await getVar(VARS.fbUrl, DEFAULT_FB_URL);
  const intervalDaysRaw = await getVar(VARS.intervalDays, String(DEFAULT_INTERVAL_DAYS));
  const lastPost = await getVar(VARS.lastPost, "");
  const lastCheckRaw = await getVar(VARS.lastCheck, "0");

  return {
    enabled,
    target,
    source,
    igUrl,
    fbUrl,
    intervalDays: Math.max(1, parseInt(intervalDaysRaw || "2", 10) || 2),
    lastPost,
    lastCheck: parseInt(lastCheckRaw || "0", 10) || 0,
  };
}

async function fetchHtml(url) {
  const response = await axios.get(url, {
    timeout: 20000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
    },
  });
  return response.data;
}

function pickLatestInstagramPost(html) {
  const directUrls =
    html.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/?/gi) || [];

  const escapedUrls = [];
  const escapedRegex = new RegExp(
    String.raw`https:\\/\\/www\.instagram\.com\\/(?:p|reel)\\/[A-Za-z0-9_-]+\\/?`,
    "gi"
  );
  let m;
  while ((m = escapedRegex.exec(html)) !== null) {
    escapedUrls.push(m[0].replace(/\\\//g, "/").replace(/\\\\/g, ""));
  }

  const rawPaths = html.match(/\/(?:p|reel)\/[A-Za-z0-9_-]+\//gi) || [];
  const pathUrls = rawPaths.map((p) => `https://www.instagram.com${p}`);

  const candidates = unique([...directUrls, ...escapedUrls, ...pathUrls]).map(normalizeUrl);
  return candidates.length ? candidates[0] : null;
}

function pickLatestFacebookPost(html) {
  const direct =
    html.match(/https?:\/\/(?:www\.)?facebook\.com\/[^"' \n]+(?:\/posts\/\d+|\/videos\/\d+|\/reel\/\d+)/gi) || [];

  const escaped = [];
  const escapedRegex = new RegExp(
    String.raw`https:\\/\\/www\.facebook\.com\\/[^\"]+(?:\\/posts\\/\d+|\\/videos\\/\d+|\\/reel\\/\d+)`,
    "gi"
  );
  let m;
  while ((m = escapedRegex.exec(html)) !== null) {
    escaped.push(m[0].replace(/\\\//g, "/").replace(/\\\\/g, ""));
  }

  const $ = cheerio.load(html);
  const links = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const abs = href.startsWith("http")
      ? href
      : `https://www.facebook.com${href.startsWith("/") ? "" : "/"}${href}`;
    if (/\/posts\/\d+|\/videos\/\d+|\/reel\/\d+/.test(abs)) {
      links.push(abs);
    }
  });

  const candidates = unique([...direct, ...escaped, ...links]).map(normalizeUrl);
  return candidates.length ? candidates[0] : null;
}

async function detectLatestPost(settings) {
  const trace = [];
  const selectedSource = settings.source;
  const tryInstagram = selectedSource === "instagram" || selectedSource === "auto";
  const tryFacebook = selectedSource === "facebook" || selectedSource === "auto";

  if (tryInstagram) {
    try {
      const igHtml = await fetchHtml(settings.igUrl || DEFAULT_IG_URL);
      const latestIgPost = pickLatestInstagramPost(igHtml);
      trace.push(latestIgPost ? "instagram:ok" : "instagram:no_match");
      if (latestIgPost) {
        return { detected: { source: "instagram", url: latestIgPost }, trace };
      }
    } catch (err) {
      trace.push(`instagram:error:${err?.message || "unknown"}`);
    }
  }

  if (tryFacebook) {
    try {
      const fbHtml = await fetchHtml(settings.fbUrl || DEFAULT_FB_URL);
      const latestFbPost = pickLatestFacebookPost(fbHtml);
      trace.push(latestFbPost ? "facebook:ok" : "facebook:no_match");
      if (latestFbPost) {
        return { detected: { source: "facebook", url: latestFbPost }, trace };
      }
    } catch (err) {
      trace.push(`facebook:error:${err?.message || "unknown"}`);
    }
  }

  return { detected: null, trace };
}

function mediaTypeFromUrl(url) {
  return /\.(jpg|jpeg|png|webp|heic)(\?|$)/i.test(url) ? "image" : "video";
}

async function forwardPost(client, targetJid, detected) {
  if (detected.source === "instagram") {
    const media = await downloadGram(detected.url);
    if (!Array.isArray(media) || media.length === 0) {
      throw new Error("Instagram gonderisi indirilemedi.");
    }

    await client.sendMessage(targetJid, {
      text: `Yeni Instagram gonderisi bulundu:\n${detected.url}`,
    });

    for (const url of media) {
      const type = mediaTypeFromUrl(url);
      if (type === "image") {
        await client.sendMessage(targetJid, { image: { url } });
      } else {
        await client.sendMessage(targetJid, { video: { url } });
      }
    }
    return;
  }

  const result = await fb(detected.url);
  if (!result?.url) {
    throw new Error("Facebook gonderisi indirilemedi.");
  }

  await client.sendMessage(targetJid, {
    text: `Yeni Facebook gonderisi bulundu:\n${detected.url}`,
  });
  await client.sendMessage(targetJid, { video: { url: result.url } });
}

async function runWatcher({ force = false } = {}) {
  if (activeRun) {
    if (!force) return { status: "busy" };
    try {
      await activeRun;
    } catch {}
    if (activeRun) return { status: "busy" };
  }

  if (!latestClient) return { status: "no_client" };

  const currentRun = (async () => {
    try {
      const settings = await loadSettings();
      if (!settings.enabled) return { status: "disabled" };
      if (!settings.target) return { status: "no_target" };

      const now = Date.now();
      const dueAt = settings.lastCheck + settings.intervalDays * 24 * 60 * 60 * 1000;
      if (!force && settings.lastCheck > 0 && now < dueAt) {
        return { status: "not_due", dueAt };
      }

      await setVar(VARS.lastCheck, String(now));

      const { detected, trace } = await detectLatestPost(settings);
      if (!detected?.url) return { status: "no_post", trace };

      const normalizedDetected = normalizeUrl(detected.url);
      const normalizedLast = normalizeUrl(settings.lastPost);

      if (!normalizedDetected) return { status: "invalid_post", trace };
      if (normalizedDetected === normalizedLast) {
        return { status: "same_post", url: normalizedDetected, trace };
      }

      await forwardPost(latestClient, settings.target, detected);
      await setVar(VARS.lastPost, normalizedDetected);

      return {
        status: "posted",
        source: detected.source,
        url: normalizedDetected,
        trace,
      };
    } catch (err) {
      return { status: "error", error: err?.message || String(err) };
    }
  })();

  activeRun = currentRun;
  try {
    return await currentRun;
  } finally {
    if (activeRun === currentRun) {
      activeRun = null;
    }
  }
}

function ensureTicker() {
  if (tickerStarted) return;
  tickerStarted = true;
  setInterval(async () => {
    const result = await runWatcher();
    if (result?.status === "error") {
      console.error("[social-watch]", result.error);
    }
  }, TICK_MS);
}

Module(
  {
    pattern: "sosyal ?(.*)",
    fromMe: true,
    desc: "Instagram/Facebook sayfasini periyodik kontrol eder ve yeni gonderileri otomatik gruba iletir.",
    usage:
      ".sosyal ac [gun]\n.sosyal kapat\n.sosyal durum\n.sosyal simdi\n.sosyal kaynak instagram|facebook|auto\n.sosyal sifirla",
  },
  async (message, match) => {
    latestClient = message.client;
    ensureTicker();

    const input = (match[1] || "").trim();
    const [cmd, ...restParts] = input.split(/\s+/).filter(Boolean);
    const rest = restParts.join(" ");

    if (!cmd) {
      const settings = await loadSettings();
      return await message.sendReply(
        `*Social Watch*\n\n` +
          `Durum: ${settings.enabled ? "Acik" : "Kapali"}\n` +
          `Hedef: ${settings.target || "-"}\n` +
          `Kaynak: ${settings.source}\n` +
          `Aralik: ${settings.intervalDays} gun\n` +
          `Son gonderi: ${settings.lastPost || "-"}\n\n` +
          `Komutlar:\n` +
          `.sosyal ac [gun]\n` +
          `.sosyal kapat\n` +
          `.sosyal durum\n` +
          `.sosyal simdi\n` +
          `.sosyal kaynak instagram|facebook|auto\n` +
          `.sosyal sifirla`
      );
    }

    const c = cmd.toLowerCase();

    if (["on", "ac", "aç"].includes(c)) {
      const days = Math.max(
        1,
        parseInt(restParts[0] || String(DEFAULT_INTERVAL_DAYS), 10) || DEFAULT_INTERVAL_DAYS
      );
      await setVar(VARS.enabled, "true");
      await setVar(VARS.target, message.jid);
      await setVar(VARS.intervalDays, String(days));
      await setVar(VARS.igUrl, (await getVar(VARS.igUrl, DEFAULT_IG_URL)) || DEFAULT_IG_URL);
      await setVar(VARS.fbUrl, (await getVar(VARS.fbUrl, DEFAULT_FB_URL)) || DEFAULT_FB_URL);
      await setVar(VARS.source, (await getVar(VARS.source, "auto")) || "auto");
      return await message.sendReply(
        `_Social watch acildi._\n_Hedef: ${message.jid}_\n_Aralik: ${days} gun_\n_Kaynak: ${(await getVar(VARS.source, "auto"))}_`
      );
    }

    if (["off", "kapat"].includes(c)) {
      await setVar(VARS.enabled, "false");
      return await message.sendReply("_Social watch kapatildi._");
    }

    if (["status", "durum"].includes(c)) {
      const settings = await loadSettings();
      const nextRunAt =
        settings.lastCheck > 0
          ? new Date(settings.lastCheck + settings.intervalDays * 24 * 60 * 60 * 1000).toLocaleString("tr-TR")
          : "Ilk kontrol bekleniyor";
      return await message.sendReply(
        `*Social Watch Durum*\n\n` +
          `Durum: ${settings.enabled ? "Acik" : "Kapali"}\n` +
          `Hedef: ${settings.target || "-"}\n` +
          `Kaynak: ${settings.source}\n` +
          `Aralik: ${settings.intervalDays} gun\n` +
          `Instagram: ${settings.igUrl}\n` +
          `Facebook: ${settings.fbUrl}\n` +
          `Son gonderi: ${settings.lastPost || "-"}\n` +
          `Son kontrol: ${settings.lastCheck ? new Date(settings.lastCheck).toLocaleString("tr-TR") : "-"}\n` +
          `Sonraki kontrol: ${nextRunAt}`
      );
    }

    if (["source", "kaynak"].includes(c)) {
      const value = (rest || "").toLowerCase();
      if (!["instagram", "facebook", "auto"].includes(value)) {
        return await message.sendReply("_Gecersiz kaynak. Kullanim: .sosyal kaynak instagram|facebook|auto_");
      }
      await setVar(VARS.source, value);
      return await message.sendReply(`_Kaynak guncellendi: ${value}_`);
    }

    if (["reset", "sifirla"].includes(c)) {
      await setVar(VARS.lastPost, "");
      await setVar(VARS.lastCheck, "0");
      return await message.sendReply("_Son post ve son kontrol bilgisi sifirlandi._");
    }

    if (["now", "simdi", "şimdi"].includes(c)) {
      const result = await runWatcher({ force: true });

      if (result.status === "posted") {
        return await message.sendReply(
          `_Yeni post iletildi._\n_Kaynak: ${result.source}_\n_URL: ${result.url}_`
        );
      }

      if (result.status === "same_post") {
        return await message.sendReply(
          `_Yeni post yok._\n_Son tespit edilen post zaten gonderilmis:_\n${result.url}\n\n` +
            `_Tekrar gondermek icin: .sosyal sifirla sonra .sosyal simdi_`
        );
      }

      if (result.status === "no_post") {
        return await message.sendReply(
          `_Post linki tespit edilemedi._\n` +
            `_Trace: ${result.trace?.join(" | ") || "-"}_\n\n` +
            `_Kaynak secimini auto yapip tekrar deneyin: .sosyal kaynak auto_`
        );
      }

      if (result.status === "error") {
        return await message.sendReply(`_Kontrol hatasi:_ ${result.error}`);
      }

      if (result.status === "disabled") {
        return await message.sendReply("_Ozellik kapali. Once .sosyal ac yazin._");
      }

      if (result.status === "no_target") {
        return await message.sendReply("_Hedef sohbet ayarli degil. .sosyal ac komutunu grupta calistirin._");
      }

      if (result.status === "no_client") {
        return await message.sendReply("_Istemci hazir degil. Bir mesaj yazip tekrar deneyin._");
      }

      if (result.status === "busy") {
        return await message.sendReply("_Kontrol su anda calisiyor. Birkac saniye sonra tekrar deneyin._");
      }

      return await message.sendReply(`_Kontrol sonucu:_ ${result.status}`);
    }

    return await message.sendReply("_Gecersiz secenek. .sosyal yazip menuyu acin._");
  }
);

Module(
  {
    on: "text",
    fromMe: false,
    excludeFromCommands: true,
  },
  async (message) => {
    if (!latestClient) {
      latestClient = message.client;
    }
    ensureTicker();
  }
);

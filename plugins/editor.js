const { Module } = require("../main");
const { MODE } = require("../config");
const { getBuffer } = require("./utils");
const { uploadToImgbb } = require("./utils/upload");

const x = MODE == "public" ? false : true;

const EFFECTS = [
  { command: "blur", desc: "Fotoğrafı bulanıklaştırır.", route: "filter/blur" },
  { command: "pixelate", desc: "Fotoğrafı pikselleştirir.", route: "filter/pixelate" },
  { command: "blue", desc: "Mavi filtre uygular.", route: "filter/blue" },
  { command: "blurple", desc: "Blurple filtre uygular.", route: "filter/blurple" },
  { command: "blurple2", desc: "Blurple v2 filtre uygular.", route: "filter/blurple2" },
  { command: "brightness", desc: "Parlaklık filtresi uygular.", route: "filter/brightness" },
  { command: "color", desc: "Renk doygunluğu filtresi uygular.", route: "filter/color" },
  { command: "green", desc: "Yeşil filtre uygular.", route: "filter/green" },
  { command: "bw", desc: "Siyah-beyaz efekti uygular.", route: "filter/greyscale" },
  { command: "invert", desc: "Ters çevirme efekti uygular.", route: "filter/invert" },
  {
    command: "2invert",
    desc: "Ters + gri çevirme efektini uygular.",
    route: "filter/invertgreyscale",
  },
  { command: "red", desc: "Kırmızı filtre uygular.", route: "filter/red" },
  { command: "golden", desc: "Altın (sepia) filtresi uygular.", route: "filter/sepia" },
  { command: "threshold", desc: "Eşik filtresi uygular.", route: "filter/threshold" },
  { command: "rainbow", desc: "LGBT gökkuşağı efekti uygular.", route: "misc/lgbt" },
  { command: "gay", desc: "Gay overlay efekti uygular.", route: "overlay/gay" },
  { command: "horny", desc: "Ateşli kart üretir.", route: "misc/horny" },
  { command: "simpcard", desc: "Simp kartı üretir.", route: "misc/simpcard" },
  { command: "circle", desc: "Dairesel avatar efekti uygular.", route: "misc/circle" },
  { command: "heart", desc: "Kalp temalı efekt uygular.", route: "misc/heart" },
  { command: "glass", desc: "Cam overlay efekti uygular.", route: "overlay/glass" },
  { command: "wasted", desc: "GTA Wasted efekti uygular.", route: "overlay/wasted" },
  { command: "passed", desc: "GTA Mission Passed efekti uygular.", route: "overlay/passed" },
  { command: "jail", desc: "Hapishane overlay efekti uygular.", route: "overlay/jail" },
  { command: "comrade", desc: "Comrade overlay efekti uygular.", route: "overlay/comrade" },
  { command: "triggered", desc: "Triggered overlay efekti uygular.", route: "overlay/triggered" },
];

function buildCategoryLines(prefix, items) {
  const lines = [`🔹 *${prefix}*`];
  items.forEach((item) => {
    lines.push(`• .${item.command} → ${item.desc}`);
  });
  return lines;
}

const filterEffects = EFFECTS.filter((item) => item.route.startsWith("filter/"));
const miscEffects = EFFECTS.filter((item) => item.route.startsWith("misc/"));
const overlayEffects = EFFECTS.filter((item) => item.route.startsWith("overlay/"));

const list =
  "```" +
  [
    "╔══════════════════════════════════════╗",
    "║   📸 FOTOĞRAF DÜZENLEME KOMUTLARI   ║",
    "╚══════════════════════════════════════╝",
    "Herhangi bir fotoğrafa yanıt vererek kullanabilirsiniz.",
    "",
    ...buildCategoryLines("Filtreler", filterEffects),
    "",
    ...buildCategoryLines("Misc Efektler", miscEffects),
    "",
    ...buildCategoryLines("Overlay Efektler", overlayEffects),
  ].join("\n") +
  "\n```";

function buildCandidateUrls(route, imageUrl) {
  const encoded = encodeURIComponent(imageUrl);
  const base = `https://api.some-random-api.com/canvas/${route}`;
  if (route.startsWith("overlay/")) {
    return [`${base}?avatar=${encoded}`, `${base}?image=${encoded}`];
  }
  return [`${base}?avatar=${encoded}`, `${base}?image=${encoded}`];
}

async function applyEffect(message, route) {
  if (!message.reply_message || !message.reply_message.image) {
    return await message.sendReply("❗️ *Bir fotoğrafa yanıt vererek yazınız.*");
  }

  const imagePath = await message.reply_message.download();
  const upload = await uploadToImgbb(imagePath);
  const link = upload?.url;

  if (!link) {
    return await message.sendReply("❌ *Görsel yüklenemedi. Tekrar deneyin.*");
  }

  const urls = buildCandidateUrls(route, link);
  let buffer;
  let lastError;

  for (const url of urls) {
    try {
      buffer = await getBuffer(url);
      if (buffer?.length) break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!buffer) {
    console.error("Editör efekti başarısız:", route, lastError?.message || lastError);
    return await message.sendReply(
      "❌ *Efekt uygulanamadı. API şu an yanıt vermiyor olabilir.*"
    );
  }

  return await message.sendMessage(buffer, "image");
}

Module(
  {
    pattern: "editör",
    fromMe: x,
    desc: "Fotoğraf düzenleme araçlarını getirir.",
    use: "utility",
  },
  async (message) => {
    await message.sendReply(list);
  }
);

function registerEffect(command, desc, route) {
  Module(
    {
      pattern: `${command} ?(.*)`,
      fromMe: x,
      dontAddCommandList: true,
      desc,
      use: "utility",
    },
    async (message) => {
      await applyEffect(message, route);
    }
  );
}

for (const effect of EFFECTS) {
  registerEffect(effect.command, effect.desc, effect.route);
}

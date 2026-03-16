const { Module } = require("../main");
const axios = require("axios");
const config = require("../config");
const { uploadToCatbox } = require("./utils");

const BASE = "https://api.nexray.web.id";
const TIMEOUT = 45000;
const isFromMe = config.MODE === "private";

async function nx(path, opts = {}) {
  const res = await axios.get(`${BASE}${path}`, {
    timeout: opts.timeout || TIMEOUT,
    validateStatus: () => true,
    responseType: opts.buffer ? "arraybuffer" : "json",
  });

  if (opts.buffer) {
    // If we requested a buffer but got JSON (happens on some errors or redirected tools like ssweb)
    const contentType = res.headers["content-type"] || "";
    if (res.status === 200 && contentType.includes("application/json")) {
      const jsonStr = Buffer.from(res.data).toString();
      try {
        const d = JSON.parse(jsonStr);
        if (d.result?.file_url) return { url: d.result.file_url };
        if (d.status === false) throw new Error(d.error || d.message || "API Hatası");
      } catch (e) {
        // Not JSON after all or no file_url, continue to size check
      }
    }

    if (res.status === 200 && res.data?.byteLength > 100) {
      return Buffer.from(res.data);
    }

    // Attempt to extract error from buffer if it's small (likely JSON error)
    if (res.data?.byteLength < 500) {
      try {
        const errJson = JSON.parse(Buffer.from(res.data).toString());
        throw new Error(errJson.error || errJson.message || `HTTP ${res.status}`);
      } catch (e) { }
    }
    throw new Error(`API hatası: HTTP ${res.status}`);
  }

  const d = res.data;
  if (d?.status === true && d?.result !== undefined) return d.result;
  if (d?.status && d?.data !== undefined) return d.data;
  if (d?.result !== undefined) return d.result;
  if (d?.data !== undefined) return d.data;
  if (res.status === 200 && d && typeof d === "object") return d;
  throw new Error(d?.message || d?.error || `API hatası: HTTP ${res.status}`);
}

async function nxTry(paths, opts = {}) {
  const errors = [];
  for (const path of paths) {
    try {
      return await nx(path, opts);
    } catch (e) {
      errors.push(`${path} → ${e.message}`);
    }
  }
  throw new Error(errors.length ? errors.join(" | ") : "API isteği başarısız");
}

function fmtCount(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString() : "-";
}

function trToEn(text) {
  const tr = {
    'ç': 'c', 'Ç': 'C',
    'ğ': 'g', 'Ğ': 'G',
    'ı': 'i', 'İ': 'I',
    'ö': 'o', 'Ö': 'O',
    'ş': 's', 'Ş': 'S',
    'ü': 'u', 'Ü': 'U'
  };
  return text.split('').map(c => tr[c] || c).join('');
}

// ════════════════════════════════════════════════════════════
// STALKER KOMUTLarı
// ════════════════════════════════════════════════════════════

Module(
  {
    pattern: "igbio ?(.*)",
    fromMe: isFromMe,
    desc: "Instagram kullanıcı profili bilgilerini gösterir",
    usage: ".igbio username",
    use: "stalker",
  },
  async (message, match) => {
    const user = (match[1] || "").trim().replace(/^@/, "");
    if (!user) return await message.sendReply("📸 _Kullanıcı adı girin:_ `.igbio username`");
    try {
      const r = await nxTry([
        `/stalker/instagram?username=${encodeURIComponent(user)}`,
      ]);
      const full = r.full_name || r.fullname || r.name || user;
      const bio = r.biography || r.bio || "-";
      const followers = r.follower_count ?? r.followers ?? "-";
      const following = r.following_count ?? r.following ?? "-";
      const posts = r.media_count ?? r.posts ?? "-";
      const priv = r.is_private ? "🔒 Gizli" : "🌐 Açık";
      const verified = r.is_verified ? "✅" : "❌";
      const avatar = r.profile_pic_url || r.profile_pic || r.avatar || r.profile?.avatar;

      const caption =
        `📸 *Instagram Profili*\n\n` +
        `👤 *Ad:* ${full}\n` +
        `🔑 *Kullanıcı:* @${user}\n` +
        `📝 *Bio:* ${bio}\n` +
        `👥 *Takipçi:* ${fmtCount(followers)}\n` +
        `➡️ *Takip:* ${fmtCount(following)}\n` +
        `📷 *Gönderi:* ${posts}\n` +
        `🔐 *Hesap:* ${priv}\n` +
        `✅ *Doğrulanmış:* ${verified}`;

      if (avatar) {
        await message.client.sendMessage(message.jid, { image: { url: avatar }, caption }, { quoted: message.data });
      } else {
        await message.sendReply(caption);
      }
    } catch (e) {
      await message.sendReply(`❌ _Instagram profili alınamadı:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "twara ?(.*)",
    fromMe: isFromMe,
    desc: "Twitter/X kullanıcı profili bilgilerini gösterir",
    usage: ".twara kullanıcı adı",
    use: "stalker",
  },
  async (message, match) => {
    const user = (match[1] || "").trim().replace(/^@/, "");
    if (!user) return await message.sendReply("🐦 _Kullanıcı adı giriniz:_ `.twara kullanıcı adı`");
    try {
      const r = await nxTry([
        `/stalker/twitter?username=${encodeURIComponent(user)}`,
      ]);
      const name = r.name || user;
      const bio = r.description || r.bio || r.signature || "-";
      const stats = r.stats || {};
      const followers = stats.followers ?? r.followers_count ?? r.followers ?? "-";
      const following = stats.following ?? r.friends_count ?? r.following ?? "-";
      const tweets = stats.tweets ?? r.statuses_count ?? r.tweets ?? "-";
      const likes = stats.likes ?? r.favourites_count ?? "-";
      const verified = r.verified ? "✅" : "❌";
      const avatar = r.profile?.avatar || r.avatar || r.profile_image_url;

      const caption =
        `🐦 *X/Twitter Profili*\n\n` +
        `👤 *Ad:* ${name}\n` +
        `🔑 *Kullanıcı:* @${user}\n` +
        `📝 *Biyografi:* ${bio}\n` +
        `👥 *Takipçi:* ${fmtCount(followers)}\n` +
        `➡️ *Takip:* ${fmtCount(following)}\n` +
        `🐦 *Tweet:* ${fmtCount(tweets)}\n` +
        `❤️ *Beğeni:* ${fmtCount(likes)}\n` +
        `✅ *Doğrulanmış mı?:* ${verified}`;

      if (avatar) {
        await message.client.sendMessage(message.jid, { image: { url: avatar }, caption }, { quoted: message.data });
      } else {
        await message.sendReply(caption);
      }
    } catch (e) {
      await message.sendReply(`❌ _X profiline ulaşamadım:_ ${e.message}`);
    }
  }
);

// ════════════════════════════════════════════════════════════
// EDITOR KOMUTLarı
// ════════════════════════════════════════════════════════════

Module(
  {
    pattern: "wasted ?(.*)",
    fromMe: isFromMe,
    desc: "GTA tarzı 'Wasted' efekti uygular",
    usage: ".wasted (görsel gönder veya yanıtla)",
    use: "editor",
  },
  async (message, match) => {
    const mime = message.reply_message?.mimetype || message.mimetype || "";
    const isImg = mime.startsWith("image/");
    if (!isImg) return await message.sendReply("🖼️ _Bir görseli yanıtlayın:_ `.wasted`");
    try {
      const wait = await message.send("💀 _İşliyorum..._");
      const path = await message.reply_message.download();
      const { url } = await uploadToCatbox(path);
      if (!url || url.includes("hata")) throw new Error("Görsel yüklenemedi");

      const buf = await nx(`/editor/wasted?url=${encodeURIComponent(url)}`, { buffer: true });
      await message.edit("💀 *Wasted!*", message.jid, wait.key);
      await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Wasted efektini uygulayamadım:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "wanted ?(.*)",
    fromMe: isFromMe,
    desc: "Aranıyor posteri oluşturur",
    usage: ".wanted (görsel gönder veya yanıtla)",
    use: "editor",
  },
  async (message, match) => {
    const replyMime = message.reply_message?.mimetype || "";
    const isImg = replyMime.startsWith("image/");
    let imgUrl = (match[1] || "").trim();

    if (!isImg && !imgUrl.startsWith("http")) {
      return await message.sendReply("🖼️ _Bir görseli yanıtlayın veya URL girin:_ `.wanted`");
    }
    try {
      if (!imgUrl && isImg) {
        const wait = await message.send("🔫 _İşleniyor..._");
        const path = await message.reply_message.download();
        const { url } = await uploadToCatbox(path);
        imgUrl = url;
        await message.edit("✅ _Görsel yüklendi, poster oluşturuluyor..._", message.jid, wait.key);
      }
      if (!imgUrl || imgUrl.includes("hata")) throw new Error("Görsel URL alınamadı");

      const buf = await nx(`/editor/wanted?url=${encodeURIComponent(imgUrl)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: "🔫 *ARANIYOR!*" }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Wanted efektini uygulayamadım:_ ${e.message}`);
    }
  }
);

// ════════════════════════════════════════════════════════════
// EPHOTO KOMUTLarı  
// ════════════════════════════════════════════════════════════

// Yardımcı: URL olan resimli mesaja ephoto efekti uygula
async function applyEphoto(message, endpoint, caption) {
  const replyMime = message.reply_message?.mimetype || "";
  const isImg = replyMime.startsWith("image/");
  if (!isImg) return await message.sendReply(`🖼️ _Bir görseli yanıtlayın:_ \`${endpoint}\``);
  try {
    const wait = await message.send("⌛ _İşliyorum..._");
    const path = await message.reply_message.download();
    const { url } = await uploadToCatbox(path);
    if (!url || url.includes("hata")) throw new Error("Görsel yüklenemedi");

    await message.edit("✅ _Efekti uyguluyorum..._", message.jid, wait.key);
    const result = await nx(`${endpoint}?url=${encodeURIComponent(url)}`, { buffer: true, timeout: 90000 });
    await message.client.sendMessage(message.jid, { image: result, caption }, { quoted: message.data });
  } catch (e) {
    await message.sendReply(`❌ _Tüh! Efekti uygulayamadım:_ ${e.message}`);
  }
}

Module(
  {
    pattern: "anime ?(.*)",
    fromMe: isFromMe,
    desc: "Fotoğrafı anime stiline dönüştürür",
    usage: ".anime (görsel yanıtla)",
    use: "ephoto",
  },
  async (message) => applyEphoto(message, "/ephoto/anime", "🎌 *Anime dönüşümü tamamlandı!*")
);

Module(
  {
    pattern: "ghiblistil ?(.*)",
    fromMe: isFromMe,
    desc: "Fotoğrafı Studio Ghibli stiline dönüştürür",
    usage: ".ghiblistil (görsel yanıtla)",
    use: "ephoto",
  },
  async (message) => applyEphoto(message, "/ephoto/ghibli", "🌿 *Studio Ghibli dönüşümü tamamlandı!*")
);

Module(
  {
    pattern: "chibi ?(.*)",
    fromMe: isFromMe,
    desc: "Fotoğrafı chibi stiline dönüştürür",
    usage: ".chibi (görsel yanıtla)",
    use: "ephoto",
  },
  async (message) => applyEphoto(message, "/ephoto/chibi", "🧸 *Chibi dönüşümü tamamlandı!*")
);

Module(
  {
    pattern: "efektsinema ?(.*)",
    fromMe: isFromMe,
    desc: "Fotoğrafa sinematik film efekti uygular",
    usage: ".sinema (görsel yanıtla)",
    use: "ephoto",
  },
  async (message) => applyEphoto(message, "/ephoto/cinematic", "🎬 *Sinematik efekt uygulandı!*")
);

Module(
  {
    pattern: "grafitisokak ?(.*)",
    fromMe: isFromMe,
    desc: "Fotoğrafı sokak grafiti sanatına dönüştürür",
    usage: ".grafitisokak (görsel yanıtla)",
    use: "ephoto",
  },
  async (message) => applyEphoto(message, "/ephoto/street", "🎨 *Grafiti dönüşümü tamamlandı!*")
);

Module(
  {
    pattern: "pikselart ?(.*)",
    fromMe: isFromMe,
    desc: "Fotoğrafı piksel NFT sanatına dönüştürür",
    usage: ".pikselart (görsel yanıtla)",
    use: "ephoto",
  },
  async (message) => applyEphoto(message, "/ephoto/nft", "👾 *Piksel sanat dönüşümü tamamlandı!*")
);

Module(
  {
    pattern: "komik ?(.*)",
    fromMe: isFromMe,
    desc: "Fotoğrafı çizgi roman stiline dönüştürür",
    usage: ".komik (görsel yanıtla)",
    use: "ephoto",
  },
  async (message) => applyEphoto(message, "/ephoto/comic", "💥 *Çizgi roman dönüşümü tamamlandı!*")
);

Module(
  {
    pattern: "mafia ?(.*)",
    fromMe: isFromMe,
    desc: "Fotoğrafı mafia stiline dönüştürür",
    usage: ".mafia (görsel yanıtla)",
    use: "ephoto",
  },
  async (message) => applyEphoto(message, "/ephoto/mafia", "🕴️ *Mafia dönüşümü tamamlandı!*")
);

// ════════════════════════════════════════════════════════════
// TOOLS KOMUTLarı
// ════════════════════════════════════════════════════════════

Module(
  {
    pattern: "ss ?(.*)",
    fromMe: isFromMe,
    desc: "Web sitesinin ekran görüntüsünü alır",
    usage: ".ss https://fenomensen.net",
    use: "tools",
  },
  async (message, match) => {
    let url = (match[1] || "").trim();
    if (message.reply_message?.text && !url) {
      const m = message.reply_message.text.match(/https?:\/\/\S+/);
      if (m) url = m[0];
    }
    if (!url) return await message.sendReply("🌐 _Web sitesi URL'si girin:_ `.ss https://fenomensen.net`");
    if (!url.startsWith("http")) url = "https://" + url;
    try {
      const res = await nxTry([
        `/tools/ssweb?url=${encodeURIComponent(url)}`,
      ], { buffer: true, timeout: 60000 });

      const imgData = res.url ? { url: res.url } : res;
      await message.client.sendMessage(message.jid, {
        image: imgData,
        caption: `🌐 *${url}*`,
      }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Ekran görüntüsünü alamadım:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "metin ?(.*)",
    fromMe: isFromMe,
    desc: "Görseldeki metni okur (OCR)",
    usage: ".metin (görsel yanıtla)",
    use: "tools",
  },
  async (message, match) => {
    const replyMime = message.reply_message?.mimetype || "";
    const isImg = replyMime.startsWith("image/");
    let imgUrl = (match[1] || "").trim();
    if (!isImg && !imgUrl.startsWith("http")) return await message.sendReply("🖼️ _Bir görseli yanıtlayın:_ `.metin`");
    try {
      if (!imgUrl && isImg) {
        const wait = await message.send("🔍 _İnceliyorum..._");
        const path = await message.reply_message.download();
        const { url } = await uploadToCatbox(path);
        imgUrl = url;
        await message.edit("✍🏻 _Metni okuyorum..._", message.jid, wait.key);
      }
      if (!imgUrl || imgUrl.includes("hata")) throw new Error("Görsel URL alınamadı!");

      const result = await nxTry([
        `/tools/ocr?url=${encodeURIComponent(imgUrl)}`,
        `/tools/ocr?image=${encodeURIComponent(imgUrl)}`,
      ]);
      const text = typeof result === "string" ? result : result?.text || result?.result || JSON.stringify(result);
      if (!text || text === "null") throw new Error("Metin bulunamadı");
      await message.sendReply(`📝 *Görselde şunlar yazıyor:*\n\n${text}`);
    } catch (e) {
      await message.sendReply(`❌ _Metni okuyamadım:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "hd ?(.*)",
    fromMe: isFromMe,
    desc: "Görseli HD kaliteye yükseltir",
    usage: ".hd (görsele yanıtla)",
    use: "tools",
  },
  async (message, match) => {
    const replyMime = message.reply_message?.mimetype || "";
    const isImg = replyMime.startsWith("image/");
    let imgUrl = (match[1] || "").trim();
    if (!isImg && !imgUrl.startsWith("http")) return await message.sendReply("🖼️ _Bir görseli yanıtlayın:_ `.hd`");
    try {
      if (!imgUrl && isImg) {
        const wait = await message.send("⬆️ _İşliyorum..._");
        const path = await message.reply_message.download();
        const { url } = await uploadToCatbox(path);
        imgUrl = url;
        await message.edit("😎 _Görseli yükseltiyorum..._", message.jid, wait.key);
      }
      if (!imgUrl || imgUrl.includes("hata")) throw new Error("Görsel URL alınamadı");

      const buf = await nxTry([
        `/tools/upscale?url=${encodeURIComponent(imgUrl)}&resolusi=2`,
        `/tools/upscale?url=${encodeURIComponent(imgUrl)}&resolution=2`,
        `/tools/upscale?image=${encodeURIComponent(imgUrl)}&resolusi=2`,
      ], { buffer: true, timeout: 90000 });
      await message.client.sendMessage(message.jid, { image: buf, caption: "✨ *İşte bu kadar, HD kaliteye yükselttim!*" }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Tüh! Yükseltme başarısız:_ ${e.message}`);
    }
  }
);

// ════════════════════════════════════════════════════════════
// DOWNLOADER KOMUTLarı (yeni)
// ════════════════════════════════════════════════════════════

Module(
  {
    pattern: "capcut ?(.*)",
    fromMe: isFromMe,
    desc: "CapCut videosu indirir",
    usage: ".capcut <bağlantı>",
    use: "download",
  },
  async (message, match) => {
    let url = (match[1] || "").trim();
    if (!url && message.reply_message?.text) {
      const m = message.reply_message.text.match(/https?:\/\/\S+/);
      if (m) url = m[0];
    }
    if (!url || !url.includes("capcut")) return await message.sendReply("🎬 _CapCut bağlantısı girin:_ `.capcut <url>`");
    try {
      const sent = await message.send("⬇️ _İndiriliyor..._");
      const result = await nxTry([
        `/downloader/capcut?url=${encodeURIComponent(url)}`,
        `/downloader/capcut?link=${encodeURIComponent(url)}`,
      ]);
      await message.edit("✅ _Tamamlandı!_", message.jid, sent.key);
      const videoUrl = result?.url || result?.video || (Array.isArray(result) ? result[0]?.url : null);
      if (!videoUrl) throw new Error("Video URL bulunamadı");
      await message.client.sendMessage(message.jid, {
        video: { url: videoUrl },
        caption: `🎬 *${result?.title || "CapCut Video"}*`,
      }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _CapCut indirme başarısız:_ ${e.message}`);
    }
  }
);

// ════════════════════════════════════════════════════════════
// MAKER KOMUTLarı (yeni)
// ════════════════════════════════════════════════════════════

Module(
  {
    pattern: "meme ?(.*)",
    fromMe: isFromMe,
    desc: "Meme görseli oluşturur (üst ve alt metin)",
    usage: ".meme ÜSTMETIN|ALTMETIN (görsel yanıtla)",
    use: "fun",
  },
  async (message, match) => {
    const input = (match[1] || "").trim();
    const replyMime = message.reply_message?.mimetype || "";
    const isImg = replyMime.startsWith("image/");
    if (!input || !input.includes("|")) return await message.sendReply("😂 _Kullanım:_ `.meme ÜSTMETIN|ALTMETIN` _(görsel yanıtlayarak)_");
    if (!isImg) return await message.sendReply("🖼️ _Bir görseli yanıtlayın:_ `.meme ÜSTMETIN|ALTMETIN`");
    const [top, bottom] = input.split("|").map(s => s.trim());
    try {
      const wait = await message.send("⌛ _Meme oluşturuyorum..._");
      const path = await message.reply_message.download();
      const { url } = await uploadToCatbox(path);
      if (!url || url.includes("hata")) throw new Error("Görsel yüklenemedi");

      const result = await nx(
        `/maker/smeme?background=${encodeURIComponent(url)}&text_atas=${encodeURIComponent(top)}&text_bawah=${encodeURIComponent(bottom || "")}`,
        { buffer: true }
      );
      await message.edit("😂", message.jid, wait.key);
      await message.client.sendMessage(message.jid, { image: result, caption: `😂 *${top}* — *${bottom}*` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Meme oluşturamadım:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "kodgörsel ?(.*)",
    fromMe: isFromMe,
    desc: "Kodu güzel bir görsel olarak oluşturur",
    usage: ".kodgörsel const x = 1",
    use: "fun",
  },
  async (message, match) => {
    let code = (match[1] || "").trim();
    if (!code && message.reply_message?.text) code = message.reply_message.text.trim();
    if (!code) return await message.sendReply("💻 _Metin girin:_ `.kodgörsel const x = 1`");
    try {
      const buf = await nx(`/maker/codesnap?code=${encodeURIComponent(code)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Kod görselini oluşturamadım:_ ${e.message}`);
    }
  }
);

// ════════════════════════════════════════════════════════════
// SEARCH KOMUTLarı (yeni)
// ════════════════════════════════════════════════════════════

Module(
  {
    pattern: "resim ?(.*)",
    fromMe: isFromMe,
    desc: "Google'dan resim arar",
    usage: ".resim kedi",
    use: "search",
  },
  async (message, match) => {
    const query = (match[1] || "").trim();
    if (!query) return await message.sendReply("🔍 _Konu girin:_ `.resim kedi`");
    try {
      const results = await nxTry([
        `/search/googleimage?q=${encodeURIComponent(query)}`,
        `/search/bingimage?q=${encodeURIComponent(query)}`,
      ]);
      if (!results?.length) throw new Error("Sonuç bulamadım");
      const pick = results[Math.floor(Math.random() * Math.min(results.length, 5))];
      const imgUrl = pick.url || pick.image || pick.link || pick.original || pick.thumbnail;
      if (!imgUrl) throw new Error("Görsel URL bulamadım");
      await message.client.sendMessage(message.jid, {
        image: { url: imgUrl },
        caption: `🔍 *${query}*`,
      }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel bulamadım:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "(?:reçete|recete) ?(.*)",
    fromMe: isFromMe,
    desc: "Yemek tarifi arar",
    usage: ".reçete pilav",
    use: "search",
  },
  async (message, match) => {
    const query = (match[1] || "").trim();
    if (!query) return await message.sendReply("🍲 _Yemek adı girin:_ `.reçete pilav`");
    try {
      const results = await nxTry([
        `/search/resep?q=${encodeURIComponent(query)}`,
      ]);
      if (!results?.length) throw new Error("Tarif bulamadım");
      const r = results[0];
      const title = r.judul || r.title || r.name || query;
      const info = [
        `🍲 *${title}*`,
        r.waktu_masak ? `⏱️ *Süre:* ${r.waktu_masak}` : "",
        r.tingkat_kesulitan ? `📊 *Zorluk:* ${r.tingkat_kesulitan}` : "",
        r.hasil ? `🍽️ *Porsiyon:* ${r.hasil}` : "",
        r.link || r.url ? `🔗 ${r.link || r.url}` : "",
      ].filter(Boolean).join("\n");
      await message.sendReply(info);
    } catch (e) {
      await message.sendReply(`❌ _Tarif bulamadım:_ ${e.message}`);
    }
  }
);

// ════════════════════════════════════════════════════════════
// GAMES KOMUTLarı
// ════════════════════════════════════════════════════════════

Module(
  {
    pattern: "beyin",
    fromMe: isFromMe,
    desc: "Rastgele beyin jimnastiği sorusu gönderir",
    usage: ".beyin",
    use: "games",
  },
  async (message) => {
    try {
      const r = await nx("/games/asahotak");
      const question = r.question || r.soal || r.pertanyaan || JSON.stringify(r);
      const answer = r.answer || r.jawaban || r.kunci || "?";
      await message.sendReply(
        `🧠 *Beyin Jimnastiği*\n\n` +
        `❓ ${question}\n\n` +
        `💡 _10 saniye sonra cevap..._`
      );
      setTimeout(async () => {
        await message.sendReply(`✅ *Cevap:* ${answer}`);
      }, 10000);
    } catch (e) {
      await message.sendReply(`❌ _Soruyu alamadım:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "bilmece",
    fromMe: isFromMe,
    desc: "Rastgele bilmece sorusu gönderir",
    usage: ".bilmece",
    use: "games",
  },
  async (message) => {
    try {
      const r = await nx("/games/tebaktebakan");
      const question = r.question || r.soal || r.pertanyaan || JSON.stringify(r);
      const answer = r.answer || r.jawaban || r.kunci || "?";
      await message.sendReply(
        `🎯 *Bilmece*\n\n` +
        `❓ ${question}\n\n` +
        `⏳ _15 saniye sonra cevap..._`
      );
      setTimeout(async () => {
        await message.sendReply(`✅ *Cevap:* ${answer}`);
      }, 15000);
    } catch (e) {
      await message.sendReply(`❌ _Bilmece alınamadı:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "kimyasoru",
    fromMe: isFromMe,
    desc: "Rastgele kimya sorusu gönderir",
    usage: ".kimyasoru",
    use: "games",
  },
  async (message) => {
    try {
      const r = await nx("/games/tebakkimia");
      const element = r.element || r.question || r.soal || JSON.stringify(r);
      const symbol = r.symbol || r.jawaban || r.answer || "?";
      const number = r.atomicNumber || r.atomic_number || r.nomor || "";
      await message.sendReply(
        `⚗️ *Kimya Sorusu*\n\n` +
        `Bu elementin sembolü nedir?\n` +
        `🧪 *${element}*${number ? ` (Atom No: ${number})` : ""}\n\n` +
        `⏳ _10 saniye sonra cevap..._`
      );
      setTimeout(async () => {
        await message.sendReply(`✅ *Cevap:* ${symbol}`);
      }, 10000);
    } catch (e) {
      await message.sendReply(`❌ _Soru alınamadı:_ ${e.message}`);
    }
  }
);

// ════════════════════════════════════════════════════════════
// FUN KOMUTLarı
// ════════════════════════════════════════════════════════════

Module(
  {
    pattern: "alay ?(.*)",
    fromMe: isFromMe,
    desc: "Metni alay/slang formatına dönüştürür",
    usage: ".alay Merhaba nasılsın",
    use: "fun",
  },
  async (message, match) => {
    let text = (match[1] || "").trim();
    if (!text && message.reply_message?.text) text = message.reply_message.text.trim();
    if (!text) return await message.sendReply("😜 _Metin girin:_ `.alay Merhaba nasılsın`");
    try {
      const result = await nx(`/fun/alay?text=${encodeURIComponent(text)}`);
      const alay = typeof result === "string" ? result : result?.result || result?.text || JSON.stringify(result);
      await message.sendReply(`😜 ${alay}`);
    } catch (e) {
      await message.sendReply(`❌ _Dönüştürme başarısız:_ ${e.message}`);
    }
  }
);

// ════════════════════════════════════════════════════════════
// TEXTPRO KOMUTLarı (ek)
// ════════════════════════════════════════════════════════════

Module(
  {
    pattern: "(?:dragonyazı|dragonyazi) ?(.*)",
    fromMe: isFromMe,
    desc: "Dragon Ball stili metin logosu oluşturur",
    usage: ".dragonyazı LADES",
    use: "fun",
  },
  async (message, match) => {
    const text = trToEn((match[1] || "").trim());
    if (!text) return await message.sendReply("🐉 _Metin girin:_ `.dragonyazı LADES`");
    try {
      const buf = await nx(`/textpro/dragonball?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "(?:neonyazı|neonyazi) ?(.*)",
    fromMe: isFromMe,
    desc: "Neon ışıklı metin logosu oluşturur",
    usage: ".neonyazı LADES",
    use: "fun",
  },
  async (message, match) => {
    const text = trToEn((match[1] || "").trim());
    if (!text) return await message.sendReply("💡 _Metin girin:_ `.neonyazı LADES`");
    try {
      const buf = await nx(`/textpro/typography?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "(?:grafitiyazı|grafitiyazi) ?(.*)",
    fromMe: isFromMe,
    desc: "Grafiti stili metin logosu oluşturur",
    usage: ".grafitiyazı LADES",
    use: "fun",
  },
  async (message, match) => {
    const text = trToEn((match[1] || "").trim());
    if (!text) return await message.sendReply("🖊️ _Metin girin:_ `.grafitiyazı LADES`");
    try {
      const buf = await nx(`/textpro/write-graffiti?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "(?:devilyazı|devilyazi) ?(.*)",
    fromMe: isFromMe,
    desc: "Şeytan kanadı stili metin logosu oluşturur",
    usage: ".devilyazı LADES",
    use: "fun",
  },
  async (message, match) => {
    const text = trToEn((match[1] || "").trim());
    if (!text) return await message.sendReply("😈 _Metin girin:_ `.devilyazı LADES`");
    try {
      const buf = await nx(`/textpro/devil-wings?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ════════════════════════════════════════════════════════════
// CANVAS KOMUTLarı
// ════════════════════════════════════════════════════════════

Module(
  {
    pattern: "(?:müzikkartı|muzikkarti) ?(.*)",
    fromMe: isFromMe,
    desc: "Müzik kartı görseli oluşturur",
    usage: ".müzikkartı Şarkı Adı|Sanatçı|<resim_url>",
    use: "fun",
  },
  async (message, match) => {
    const parts = (match[1] || "").split("|").map(s => trToEn(s.trim()));
    if (parts.length < 2) return await message.sendReply("🎵 _Kullanım:_ `.müzikkartı Şarkı Adı|Sanatçı` veya `Şarkı|Sanatçı|<resim_url>`");
    const [title, artist, img] = parts;
    let imageUrl = img || "https://i.imgur.com/Y3KqMfn.jpg";

    // Reply to image check
    const isImg = (message.reply_message?.mimetype || "").startsWith("image/");
    try {
      if (isImg && !img) {
        const path = await message.reply_message.download();
        const { url } = await uploadToCatbox(path);
        if (url && !url.includes("hata")) imageUrl = url;
      }
      const buf = await nx(
        `/canvas/musiccard?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&image=${encodeURIComponent(imageUrl)}`,
        { buffer: true }
      );
      await message.client.sendMessage(message.jid, {
        image: buf,
        caption: `🎵 *${title}* — _${artist}_`,
      }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Müzik kartı oluşturulamadı:_ ${e.message}`);
    }
  }
);

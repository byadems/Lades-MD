/**
 * Nexray API (api.nexray.web.id) yardımcı modülü
 * Yedek indirme, colorize ve AI görsel işleme için kullanılır.
 */
const axios = require("axios");
const FormData = require("form-data");

const BASE = "https://api.nexray.web.id";
const TIMEOUT = 60000;

/**
 * Siyah-beyaz fotoğrafı renklendirir.
 * @param {string} imageUrl - Görsel URL'si
 * @returns {Promise<Buffer|null>} Renklendirilmiş görsel buffer veya null
 */
async function colorize(imageUrl) {
  try {
    const res = await axios.get(`${BASE}/tools/colorize`, {
      params: { url: imageUrl },
      responseType: "arraybuffer",
      timeout: TIMEOUT,
    });
    if (res.status === 200 && res.data?.length) {
      return Buffer.from(res.data);
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray colorize]", e?.message);
  }
  return null;
}

/**
 * GPT Vision ile görseli metin promptuna göre düzenler.
 * @param {Buffer} imageBuffer - Düzenlenecek görsel
 * @param {string} prompt - Düzenleme talimatı (örn: "Change skin color to black")
 * @param {string} [mimetype] - Görsel MIME tipi (varsayılan: image/jpeg)
 * @returns {Promise<Buffer|null>} Düzenlenmiş görsel buffer veya null
 */
async function gptImage(imageBuffer, prompt, mimetype = "image/jpeg") {
  try {
    const ext = mimetype.split("/")[1] || "jpg";
    const form = new FormData();
    form.append("image", imageBuffer, { filename: `image.${ext}`, contentType: mimetype });
    form.append("param", String(prompt).trim());

    const res = await axios.post(`${BASE}/ai/gptimage`, form, {
      headers: form.getHeaders(),
      responseType: "arraybuffer",
      timeout: 90000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    if (res.status === 200 && res.data?.length) {
      return Buffer.from(res.data);
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray gptImage]", e?.message);
  }
  return null;
}

/**
 * AI ile metinden görsel oluşturur (DeepImg).
 * @param {string} prompt - Görsel açıklaması
 * @returns {Promise<Buffer|null>} Oluşturulan görsel buffer veya null
 */
async function deepImg(prompt) {
  try {
    const res = await axios.get(`${BASE}/ai/deepimg`, {
      params: { prompt: String(prompt).trim() },
      responseType: "arraybuffer",
      timeout: 90000,
    });
    if (res.status === 200 && res.data?.length) {
      return Buffer.from(res.data);
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray deepImg]", e?.message);
  }
  return null;
}

/**
 * Instagram indirme
 * @param {string} url - Instagram URL
 * @returns {Promise<string[]|null>} Medya URL listesi veya null
 */
async function downloadInstagram(url) {
  // v1 endpoint
  try {
    const res = await axios.get(`${BASE}/downloader/instagram`, {
      params: { url },
      timeout: TIMEOUT,
    });
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      if (Array.isArray(r)) {
        const urls = r.map(item => item?.url || item?.thumbnail || item).filter(Boolean);
        if (urls.length) return urls;
      }
      if (r.url) return [r.url];
      if (r.video_url) return [r.video_url];
      if (r.video_urls) return r.video_urls.filter(Boolean);
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray instagram v1]", e?.message);
  }

  // v2 endpoint (daha zengin veri, yedek)
  try {
    const res = await axios.get(`${BASE}/downloader/v2/instagram`, {
      params: { url },
      timeout: TIMEOUT,
    });
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      if (r.media && Array.isArray(r.media)) {
        const urls = r.media.map(m => m?.url || m).filter(Boolean);
        if (urls.length) return urls;
      }
      if (r.thumbnail) return [r.thumbnail];
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray instagram v2]", e?.message);
  }
  return null;
}

/**
 * TikTok indirme
 * @param {string} url - TikTok URL
 * @returns {Promise<{url?: string, video?: string}|null>} Video URL veya null
 */
async function downloadTiktok(url) {
  try {
    const res = await axios.get(`${BASE}/downloader/tiktok`, {
      params: { url },
      timeout: TIMEOUT,
    });
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      return { url: r.data || r.url || r.video || r.play?.url || r.download_url, title: r.title };
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray tiktok]", e?.message);
  }
  return null;
}

/**
 * Facebook video indirme
 * @param {string} url - Facebook URL
 * @returns {Promise<{url?: string}|null>}
 */
async function downloadFacebook(url) {
  try {
    const res = await axios.get(`${BASE}/downloader/facebook`, {
      params: { url },
      timeout: TIMEOUT,
    });
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      const videoUrl = r.video_hd || r.video_sd || r.url || r.hd || r.sd || r.audio;
      if (videoUrl) return { url: videoUrl, title: r.title };
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray facebook]", e?.message);
  }
  return null;
}

/**
 * Pinterest indirme
 * @param {string} url - Pinterest URL
 * @returns {Promise<string|null>} Medya URL veya null
 */
async function downloadPinterest(url) {
  try {
    const res = await axios.get(`${BASE}/downloader/pinterest`, {
      params: { url },
      timeout: TIMEOUT,
    });
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      return r.image || r.url || r.video || r.thumbnail || null;
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray pinterest]", e?.message);
  }
  return null;
}

/**
 * Twitter/X video indirme
 * @param {string} url - Twitter/X URL
 * @returns {Promise<{url?: string, video?: string}|null>}
 */
async function downloadTwitter(url) {
  try {
    const res = await axios.get(`${BASE}/downloader/twitter`, {
      params: { url },
      timeout: TIMEOUT,
    });
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      const dlArr = r.download_url;
      const bestUrl = Array.isArray(dlArr) && dlArr.length > 0
        ? dlArr[0]?.url || dlArr[0]
        : r.video_url || r.video || r.url || r.videos?.[0]?.url;
      return bestUrl ? { url: bestUrl, title: r.title, thumbnail: r.thumbnail } : null;
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray twitter]", e?.message);
  }
  return null;
}

/**
 * Spotify indirme (doğrudan ses indirir)
 * @param {string} url - Spotify track URL
 * @returns {Promise<{url?: string, title?: string}|null>}
 */
async function downloadSpotify(url) {
  try {
    const res = await axios.get(`${BASE}/downloader/spotify`, {
      params: { url },
      timeout: TIMEOUT,
    });
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      const dl = r.download_url || r.audio_url || r.url;
      return dl ? { url: dl, title: r.title || r.name } : null;
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray spotify]", e?.message);
  }
  return null;
}

/**
 * YouTube video indirme (MP4)
 * @param {string} url - YouTube URL
 * @returns {Promise<{url?: string, title?: string}|null>}
 */
async function downloadYtMp4(url) {
  try {
    const res = await axios.get(`${BASE}/downloader/ytmp4`, {
      params: { url },
      timeout: 90000,
    });
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      return { url: r.url || r.download_url, title: r.title };
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray ytmp4]", e?.message);
  }
  return null;
}

/**
 * YouTube ses indirme (MP3)
 * @param {string} url - YouTube URL
 * @returns {Promise<{url?: string, title?: string}|null>}
 */
async function downloadYtMp3(url) {
  try {
    const res = await axios.get(`${BASE}/downloader/ytmp3`, {
      params: { url },
      timeout: 90000,
    });
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      return { url: r.url || r.download_url, title: r.title };
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray ytmp3]", e?.message);
  }
  return null;
}

/**
 * YouTube Play (Arama + İndirme tek seferde) - Ses
 * @param {string} query - Arama terimi
 * @returns {Promise<{url?: string, title?: string}|null>}
 */
async function ytPlayAud(query) {
  try {
    const res = await axios.get(`${BASE}/downloader/ytplay`, {
      params: { q: String(query).trim() },
      timeout: 90000,
    });
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      return { url: r.download_url || r.url, title: r.title };
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray ytPlayAud]", e?.message);
  }
  return null;
}

/**
 * YouTube Play (Arama + İndirme tek seferde) - Video
 * @param {string} query - Arama terimi
 * @returns {Promise<{url?: string, title?: string}|null>}
 */
async function ytPlayVid(query) {
  try {
    const res = await axios.get(`${BASE}/downloader/ytplayvid`, {
      params: { q: String(query).trim() },
      timeout: 90000,
    });
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      return { url: r.download_url || r.url, title: r.title };
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray ytPlayVid]", e?.message);
  }
  return null;
}

/**
 * YouTube arama (Arama terimi ile sonuç listeler)
 * @param {string} query - Arama terimi
 * @returns {Promise<any[]|null>}
 */
async function searchYoutube(query) {
  try {
    const res = await axios.get(`${BASE}/search/youtube`, {
      params: { q: String(query).trim() },
      timeout: TIMEOUT,
    });
    const data = res.data;
    if (data?.status && Array.isArray(data?.result)) {
      return data.result;
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray searchYoutube]", e?.message);
  }
  return null;
}

module.exports = {
  colorize,
  gptImage,
  deepImg,
  downloadInstagram,
  downloadTiktok,
  downloadFacebook,
  downloadPinterest,
  downloadTwitter,
  downloadSpotify,
  downloadYtMp4,
  downloadYtMp3,
  ytPlayAud,
  ytPlayVid,
  searchYoutube,
};

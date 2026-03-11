/**
 * Nexray API (api.nexray.web.id) yardımcı modülü
 * Yedek indirme, colorize ve AI görsel üretimi için kullanılır.
 */
const axios = require("axios");

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
  try {
    const res = await axios.get(`${BASE}/downloader/instagram`, {
      params: { url },
      timeout: TIMEOUT,
    });
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      if (Array.isArray(r)) return r.filter(Boolean);
      if (r.url) return [r.url];
      if (r.video_url) return [r.video_url];
      if (r.video_urls) return r.video_urls.filter(Boolean);
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray instagram]", e?.message);
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
      return { url: r.url || r.video || r.play?.url || r.download_url };
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
      return { url: r.url || r.hd || r.sd };
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
      return r.url || r.video || r.image || null;
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
      const vid = r.video_url || r.video || r.url || r.videos?.[0]?.url;
      return vid ? { url: vid } : null;
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

module.exports = {
  colorize,
  deepImg,
  downloadInstagram,
  downloadTiktok,
  downloadFacebook,
  downloadPinterest,
  downloadTwitter,
  downloadSpotify,
  downloadYtMp4,
};

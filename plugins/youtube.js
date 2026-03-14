const { Module } = require("../main");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const {
  downloadVideo,
  downloadAudio,
  searchYoutube,
  getVideoInfo,
  convertM4aToMp3,
} = require("./utils/yt");
const { spotifyTrack } = require("./utils/misc");
const { censorBadWords } = require("./utils");
const nexray = require("./utils/nexray");

const config = require("../config");
const MODE = config.MODE;
const fromMe = MODE === "public" ? false : true;

const VIDEO_SIZE_LIMIT = 150 * 1024 * 1024;

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function formatViews(views) {
  if (views >= 1000000) {
    return (views / 1000000).toFixed(1) + "M";
  } else if (views >= 1000) {
    return (views / 1000).toFixed(1) + "K";
  }
  return views?.toString() || "Belirtilmedi";
}

Module(
  {
    pattern: "song ?(.*)",
    fromMe: fromMe,
    desc: "YouTube'da ara ve ses indir",
    usage: ".song <arama terimi> | .şarkı <arama terimi veya bağlantı>",
    use: "download",
  },
  async (message, match) => {
    const query = match[1];
    if (!query) {
      return await message.sendReply("_⚠️ Lütfen aranacak kelimeyi girin!_\n_Örnek: .song sezen aksu_"
      );
    }

    try {
      const searchMsg = await message.sendReply("_🔍 YouTube'da aranıyor..._");
      const results = await searchYoutube(query, 10);

      if (!results || results.length === 0) {
        return await message.edit(
          "_❌ Sonuç bulunamadı!_",
          message.jid,
          searchMsg.key
        );
      }

      let resultText = "🎵 YouTube Arama Sonuçları\n\n";
      resultText += `_${results.length} sonuç bulundu:_ *${query}*\n\n`;

      results.forEach((video, index) => {
        resultText += `*${index + 1}.* ${censorBadWords(video.title)}\n`;
        resultText += `   _Süre:_ \`${
          video.duration
        }\` | _Görüntülenme:_ \`${formatViews(video.views)}\`\n`;
        resultText += `   _Kanal:_ ${video.channel.name}\n\n`;
      });

      resultText += "_Ses indirmek için bir numara (1-10) ile yanıtlayın_";

      await message.edit(resultText, message.jid, searchMsg.key);
    } catch (error) {
      console.error("Şarkı arama hatası:", error);
      await message.sendReply("_❌ Arama başarısız oldu. Lütfen daha sonra tekrar deneyin._");
    }
  }
);

Module(
  {
    pattern: "ytara ?(.*)",
    fromMe: fromMe,
    desc: "YouTube araması (detaylı bilgi ile)",
    usage: ".ytara <sorgu>",
    use: "download",
  },
  async (message, match) => {
    const query = match[1];
    if (!query) {
      return await message.sendReply("_⚠️ Lütfen aranacak kelimeyi girin!_\n_Örnek: .ytara ncs music_"
      );
    }

    try {
      const searchMsg = await message.sendReply("_🔍 YouTube'da aranıyor..._");
      const results = await searchYoutube(query, 10);

      if (!results || results.length === 0) {
        return await message.edit(
          "_❌ Sonuç bulunamadı!_",
          message.jid,
          searchMsg.key
        );
      }

      let resultText = "🎵 YouTube Arama Sonuçları\n\n";
      resultText += `_${results.length} sonuç bulundu:_ *${query}*\n\n`;

      results.forEach((video, index) => {
        resultText += `*${index + 1}.* ${censorBadWords(video.title)}\n`;
        resultText += `   _Süre:_ \`${
          video.duration
        }\` | _Görüntülenme:_ \`${formatViews(video.views)}\`\n`;
        resultText += `   _Kanal:_ ${video.channel.name}\n\n`;
      });

      resultText += "_Video detaylarını görüntülemek için bir numara (1-10) ile yanıtlayın_";

      await message.edit(resultText, message.jid, searchMsg.key);
    } catch (error) {
      console.error("YouTube arama hatası:", error);
      await message.sendReply("_❌ Arama başarısız oldu. Lütfen daha sonra tekrar deneyin._");
    }
  }
);

Module(
  {
    pattern: "ytvideo ?(.*)",
    fromMe: fromMe,
    desc: "Video kalitesi seçimi ile YouTube videosu indir",
    usage: ".ytvideo <bağlantı>",
    use: "download",
  },
  async (message, match) => {
    let url = match[1] || message.reply_message?.text;

    if (url && /\bhttps?:\/\/\S+/gi.test(url)) {
      url = url.match(/\bhttps?:\/\/\S+/gi)[0];
    }

    if (!url || (!url.includes("youtube.com") && !url.includes("youtu.be"))) {
      return await message.sendReply("_⚠️ Lütfen geçerli bir YouTube bağlantısı verin!_\n_Örnek: .ytvideo https://youtube.com/watch?v=xxxxx_"
      );
    }

    // Convert YouTube Shorts URL to regular watch URL if needed
    if (url.includes("youtube.com/shorts/")) {
      const shortId = url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]+)/)?.[1];
      if (shortId) {
        url = `https://www.youtube.com/watch?v=${shortId}`;
      }
    }

    try {
      const infoMsg = await message.sendReply("_📊 Video bilgileri alınıyor..._");
      const info = await getVideoInfo(url);

      const videoFormats = info.formats
        .filter((f) => f.type === "video" && f.quality)
        .sort((a, b) => {
          const getRes = (q) => {
            const match = q.match(/(\d+)/);
            return match ? parseInt(match[1]) : 0;
          };
          return getRes(b.quality) - getRes(a.quality);
        });

      const uniqueQualities = [...new Set(videoFormats.map((f) => f.quality))];

      const videoIdMatch = url.match(
        /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([^&\s/?]+)/
      );
      const videoId = videoIdMatch ? videoIdMatch[1] : info.videoId || "";

      let qualityText = "🎬 _*Video Kalitesini Seçin*_\n\n";
      qualityText += `_*${censorBadWords(info.title)}*_\n\n(${videoId})\n\n`;

      if (uniqueQualities.length === 0) {
        return await message.edit(
          "_❌ Bu video için uygun format bulunamadı._",
          message.jid,
          infoMsg.key
        );
      }

      uniqueQualities.forEach((quality, index) => {
        const format = videoFormats.find((f) => f.quality === quality);
        const audioFormat = info.formats.find((f) => f.type === "audio");

        let sizeInfo = "";
        if (format.size && audioFormat?.size) {
          // Parse sizes and estimate total
          const parseSize = (sizeStr) => {
            const match = sizeStr.match(/([\d.]+)\s*(KB|MB|GB)/i);
            if (!match) return 0;
            const value = parseFloat(match[1]);
            const unit = match[2].toUpperCase();
            if (unit === "KB") return value * 1024;
            if (unit === "MB") return value * 1024 * 1024;
            if (unit === "GB") return value * 1024 * 1024 * 1024;
            return value;
          };

          const videoSize = parseSize(format.size);
          const audioSize = parseSize(audioFormat.size);
          const totalSize = videoSize + audioSize;

          if (totalSize > 0) {
            sizeInfo = ` ~ _${formatBytes(totalSize)}_`;
          }
        }

        qualityText += `*${index + 1}.* _*${quality}*_${sizeInfo}\n`;
      });

      const audioFormat = info.formats.find((f) => f.type === "audio");
      if (audioFormat) {
        let audioSizeInfo = "";
        if (audioFormat.size) {
          const parseSize = (sizeStr) => {
            const match = sizeStr.match(/([\d.]+)\s*(KB|MB|GB)/i);
            if (!match) return 0;
            const value = parseFloat(match[1]);
            const unit = match[2].toUpperCase();
            if (unit === "KB") return value * 1024;
            if (unit === "MB") return value * 1024 * 1024;
            if (unit === "GB") return value * 1024 * 1024 * 1024;
            return value;
          };
          const audioSize = parseSize(audioFormat.size);
          if (audioSize > 0) {
            audioSizeInfo = ` ~ _${formatBytes(audioSize)}_`;
          }
        }
        qualityText += `*${
          uniqueQualities.length + 1
        }.* _*Sadece Ses*_${audioSizeInfo}\n`;
      }

      qualityText += "\n_İndirmek için bir numara ile yanıtlayın_";

      await message.edit(qualityText, message.jid, infoMsg.key);
    } catch (error) {
      console.error("YouTube video bilgi hatası:", error);
      await message.sendReply("_⚠️ Video bilgisi alınamadı. Lütfen bağlantıyı kontrol edin._"
      );
    }
  }
);

Module(
  {
    pattern: "video ?(.*)",
    fromMe: fromMe,
    desc: "YouTube videosunu 360p indir",
    usage: ".video <link>",
    use: "download",
  },
  async (message, match) => {
    let url = match[1] || message.reply_message?.text;

    if (url && /\bhttps?:\/\/\S+/gi.test(url)) {
      url = url.match(/\bhttps?:\/\/\S+/gi)[0];
    }

    if (!url || (!url.includes("youtube.com") && !url.includes("youtu.be"))) {
      return await message.sendReply("_⚠️ Lütfen geçerli bir YouTube bağlantısı verin!_\n_Örnek: .video https://youtube.com/watch?v=xxxxx_"
      );
    }

    // Convert YouTube Shorts URL to regular watch URL if needed
    if (url.includes("youtube.com/shorts/")) {
      const shortId = url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]+)/)?.[1];
      if (shortId) {
        url = `https://www.youtube.com/watch?v=${shortId}`;
      }
    }

    let downloadMsg;
    let videoPath;

    try {
      downloadMsg = await message.sendReply("_⬇️ Video indiriliyor..._");
      const result = await downloadVideo(url, "360p");
      videoPath = result.path;

      await message.edit("_📤 Video yükleniyor..._", message.jid, downloadMsg.key);

      const stats = fs.statSync(videoPath);

      const safeTitle = censorBadWords(result.title);
      if (stats.size > VIDEO_SIZE_LIMIT) {
        const stream = fs.createReadStream(videoPath);
        await message.sendMessage({ stream }, "document", {
          fileName: `${safeTitle}.mp4`,
          mimetype: "video/mp4",
          caption: `_*${safeTitle}*_\n\n_Dosya boyutu: ${formatBytes(
            stats.size
          )}_\n_Kalite: 360p_`,
        });
        stream.destroy();
      } else {
        const stream = fs.createReadStream(videoPath);
        await message.sendReply({ stream }, "video", {
          caption: `_*${safeTitle}*_\n\n_Kalite: 360p_`,
        });
        stream.destroy();
      }

      await message.edit("_✅ İndirme tamamlandı!_", message.jid, downloadMsg.key);

      await new Promise((resolve) => setTimeout(resolve, 100));
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
    } catch (error) {
      try {
        const fallback = await nexray.downloadYtMp4(url);
        if (fallback?.url) {
          if (!downloadMsg) downloadMsg = await message.sendReply("_⬇️ Yedek yöntemle indiriliyor..._");
          await message.edit("_📤 Video yükleniyor..._", message.jid, downloadMsg.key);
          const safeTitle = censorBadWords(fallback.title || "video");
          await message.sendReply({ url: fallback.url }, "video", {
            caption: `_*${safeTitle}*_\n\n_Yedek indirme_`,
          });
          await message.edit("_✅ İndirme tamamlandı!_", message.jid, downloadMsg.key);
          return;
        }
      } catch (_) {}
      console.error("Video indirme hatası:", error);
      if (downloadMsg) {
        await message.edit("_❌ İndirme başarısız!_", message.jid, downloadMsg.key);
      } else {
        await message.sendReply("_❌ İndirme başarısız oldu. Lütfen tekrar deneyin._");
      }

      if (videoPath && fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
    }
  }
);

Module(
  {
    pattern: "ytses ?(.*)",
    fromMe: fromMe,
    desc: "YouTube sesini belge olarak indir",
    usage: ".ytses <bağlantı>",
    use: "download",
  },
  async (message, match) => {
    let url = match[1] || message.reply_message?.text;

    if (url && /\bhttps?:\/\/\S+/gi.test(url)) {
      url = url.match(/\bhttps?:\/\/\S+/gi)[0];
    }

    if (!url || (!url.includes("youtube.com") && !url.includes("youtu.be"))) {
      return await message.sendReply("_⚠️ Lütfen geçerli bir YouTube bağlantısı verin!_\n_Örnek: .ytses https://youtube.com/watch?v=xxxxx_"
      );
    }

    // Convert YouTube Shorts URL to regular watch URL if needed
    if (url.includes("youtube.com/shorts/")) {
      const shortId = url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]+)/)?.[1];
      if (shortId) {
        url = `https://www.youtube.com/watch?v=${shortId}`;
      }
    }

    let downloadMsg;
    let audioPath;

    try {
      downloadMsg = await message.sendReply("_⬇️ Ses indiriliyor..._");
      const result = await downloadAudio(url);
      audioPath = result.path;

      const mp3Path = await convertM4aToMp3(audioPath);
      audioPath = mp3Path;

      await message.edit("_📤 Ses gönderiliyor..._", message.jid, downloadMsg.key);

      const safeTitle = censorBadWords(result.title);
      const stream = fs.createReadStream(audioPath);
      await message.sendMessage({ stream }, "document", {
        fileName: `${safeTitle}.m4a`,
        mimetype: "audio/mp4",
        caption: `_*${safeTitle}*_`,
      });
      stream.destroy();

      await message.edit("_✅ İndirme tamamlandı!_", message.jid, downloadMsg.key);

      await new Promise((resolve) => setTimeout(resolve, 100));
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }
    } catch (error) {
      console.error("YouTube ses indirme hatası:", error);
      if (downloadMsg) {
        await message.edit("_❌ İndirme başarısız!_", message.jid, downloadMsg.key);
      } else {
        await message.sendReply("_❌ İndirme başarısız oldu. Lütfen tekrar deneyin._");
      }

      if (audioPath && fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }
    }
  }
);

Module(
  {
    pattern: "şarkı ?(.*)",
    fromMe: fromMe,
    desc: "YouTube araması veya bağlantısı üzerinden ses oynat (yedek yöntem otomatik)",
    usage: ".şarkı <şarkı adı veya bağlantı> | .song <şarkı adı>",
    use: "download",
  },
  async (message, match) => {
    let input = (match[1] || message.reply_message?.text || "").trim();
    if (!input) {
      return await message.sendReply("_⚠️ Lütfen şarkı adı veya bağlantısı yazın!_\n_Örnek: .şarkı Duman - Bu Akşam_"
      );
    }

    let downloadMsg;
    let audioPath;

    try {
      let url = null;
      if (/\bhttps?:\/\/\S+/gi.test(input)) {
        const urlMatch = input.match(/\bhttps?:\/\/\S+/gi);
        if (
          urlMatch &&
          (urlMatch[0].includes("youtube.com") ||
            urlMatch[0].includes("youtu.be"))
        ) {
          url = urlMatch[0];
          if (url.includes("youtube.com/shorts/")) {
            const shortId = url.match(
              /youtube\.com\/shorts\/([A-Za-z0-9_-]+)/
            )?.[1];
            if (shortId) {
              url = `https://www.youtube.com/watch?v=${shortId}`;
            }
          }
        }
      }

      if (url) {
        downloadMsg = await message.sendReply("_🔻 İndiriliyor..._");
        const result = await downloadAudio(url);
        audioPath = result.path;

        const mp3Path = await convertM4aToMp3(audioPath);
        audioPath = mp3Path;

        const safeTitle = censorBadWords(result.title);
        await message.edit(
          `_🔺 Yükleniyor..._ *${safeTitle}*`,
          message.jid,
          downloadMsg.key
        );

        const stream1 = fs.createReadStream(audioPath);
        await message.sendReply({ stream: stream1 }, "audio", {
          mimetype: "audio/mp4",
        });
        stream1.destroy();

        await message.edit(
          `_✅ Hazır!_ *${safeTitle}*`,
          message.jid,
          downloadMsg.key
        );

        await new Promise((resolve) => setTimeout(resolve, 100));
        if (fs.existsSync(audioPath)) {
          fs.unlinkSync(audioPath);
        }
      } else {
        const query = input;
        downloadMsg = await message.sendReply("_🔍 Aranıyor..._");
        const results = await searchYoutube(query, 1);

        if (!results || results.length === 0) {
          return await message.edit(
            "_❌ Sonuç bulunamadı!_",
            message.jid,
            downloadMsg.key
          );
        }

        const video = results[0];
        const safeTitle = censorBadWords(video.title);
        await message.edit(
          `_🔻 İndiriliyor..._ *${safeTitle}*`,
          message.jid,
          downloadMsg.key
        );

        const result = await downloadAudio(video.url);
        audioPath = result.path;

        const mp3Path = await convertM4aToMp3(audioPath);
        audioPath = mp3Path;

        await message.edit(
          `_🔺 Yükleniyor..._ *${safeTitle}*`,
          message.jid,
          downloadMsg.key
        );

        const stream2 = fs.createReadStream(audioPath);
        await message.sendReply({ stream: stream2 }, "audio", {
          mimetype: "audio/mp4",
        });
        stream2.destroy();

        await message.edit(
          `_✅ Hazır!_ *${safeTitle}*`,
          message.jid,
          downloadMsg.key
        );

        await new Promise((resolve) => setTimeout(resolve, 100));
        if (fs.existsSync(audioPath)) {
          fs.unlinkSync(audioPath);
        }
      }
    } catch (error) {
      if (config.DEBUG) console.error("Çalma hatası, yedek yöntem deneniyor:", error.message);
      if (audioPath && fs.existsSync(audioPath)) {
        try {
          fs.unlinkSync(audioPath);
        } catch (_) {}
      }

      try {
        if (!downloadMsg) {
          downloadMsg = await message.sendReply("_🔎 Aranıyor..._ (bu işlem 10-60 saniye sürebilir)");
        } else {
          await message.edit("_🔎 Aranıyor..._ (bu işlem 10-60 saniye sürebilir)", message.jid, downloadMsg.key);
        }

        let query = input.trim();
        const urlMatch = input.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]+)/);
        if (urlMatch) {
          query = `https://www.youtube.com/watch?v=${urlMatch[1]}`;
        }

        const apiUrl = `https://api.nexray.web.id/downloader/ytplay?q=${encodeURIComponent(query)}`;
        const { data } = await axios.get(apiUrl, { timeout: 60000 });

        if (!data?.status || !data?.result?.download_url) {
          return await message.edit(
            "_❌ Sonuç bulunamadı!_",
            message.jid,
            downloadMsg.key
          );
        }

        const { title, duration, download_url } = data.result;
        const safeTitle = censorBadWords(title);
        await message.edit(
          `_🔻 İndirilip yükleniyor... *${safeTitle}* (${duration || "—"})_`,
          message.jid,
          downloadMsg.key
        );

        await message.client.sendMessage(message.jid, {
          audio: { url: download_url },
          mimetype: "audio/mpeg",
          fileName: `${safeTitle}.mp3`,
        }, { quoted: message.data });

        await message.edit(
          `_✅ Hazır!_ *${safeTitle}*`,
          message.jid,
          downloadMsg.key
        );
      } catch (fallbackError) {
        console.error("Yedek yöntem hatası:", fallbackError.message);
        if (downloadMsg) {
          await message.edit("_⚠️ İndirme başarısız! Farklı şekilde deneyin._", message.jid, downloadMsg.key);
        } else {
          await message.sendReply("_⚠️ İndirme başarısız! Farklı şekilde deneyin._");
        }
      }
    }
  }
);

Module(
  {
    on: "text",
    fromMe: fromMe,
  },
  async (message, match) => {
    const numberMatch = message.text?.match(/^\d+$/);
    if (!numberMatch) return;
    const selectedNumber = parseInt(numberMatch[0]);
    if (
      !message.reply_message ||
      !message.reply_message.fromMe ||
      !message.reply_message.message
    ) {
      return;
    }
    const repliedText = message.reply_message.message;
    if (
      repliedText.includes("🎵 YouTube Arama Sonuçları") &&
      repliedText.includes("ses indirmek için")
    ) {
      if (selectedNumber < 1 || selectedNumber > 10) {
        return await message.sendReply("_⚠️ Lütfen 1-10 arasında bir sayı seçin_");
      }

      const lines = repliedText.split("\n");
      let videoTitle = null;
      let videoUrl = null;

      try {
        const queryMatch = repliedText.match(
          /\d+ sonuç bulundu:_\s*\*(.+?)\*/
        );
        if (!queryMatch) return;

        const query = queryMatch[1];
        const results = await searchYoutube(query, 10);

        if (!results[selectedNumber - 1]) {
          return await message.sendReply("_❌ Geçersiz seçim!_");
        }

        const selectedVideo = results[selectedNumber - 1];
        let downloadMsg;
        let audioPath;

        try {
          const safeTitle = censorBadWords(selectedVideo.title);
          downloadMsg = await message.sendReply(
            `_⬇️ *${safeTitle}* indiriliyor..._`
          );

          const result = await downloadAudio(selectedVideo.url);
          audioPath = result.path;

          const mp3Path = await convertM4aToMp3(audioPath);
          audioPath = mp3Path;

          await message.edit(
            "_📤 Ses gönderiliyor..._",
            message.jid,
            downloadMsg.key
          );

          const stream3 = fs.createReadStream(audioPath);
          await message.sendReply({ stream: stream3 }, "audio", {
            mimetype: "audio/mp4",
          });
          stream3.destroy();

          await message.edit(
            "_✅ İndirme tamamlandı!_",
            message.jid,
            downloadMsg.key
          );

          await new Promise((resolve) => setTimeout(resolve, 100));
          if (fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
          }
        } catch (error) {
          console.error("Şarkı indirme hatası:", error);
          if (downloadMsg) {
            await message.edit(
              "_❌ İndirme başarısız!_",
              message.jid,
              downloadMsg.key
            );
          }

          if (audioPath && fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
          }
        }
      } catch (error) {
        console.error("Şarkı seçim hatası:", error);
        await message.sendReply("_❌ Seçiminiz işlenemedi._");
      }
    } else if (
      repliedText.includes("🎵 YouTube Arama Sonuçları") &&
      repliedText.includes("video detaylarını görüntüle")
    ) {
      if (selectedNumber < 1 || selectedNumber > 10) {
        return await message.sendReply("_⚠️ Lütfen 1-10 arasında bir sayı seçin_");
      }

      try {
        const queryMatch = repliedText.match(
          /\d+ sonuç bulundu:_\s*\*(.+?)\*/
        );
        if (!queryMatch) return;

        const query = queryMatch[1];
        const results = await searchYoutube(query, 10);

        if (!results[selectedNumber - 1]) {
          return await message.sendReply("_❌ Geçersiz seçim!_");
        }

        const selectedVideo = results[selectedNumber - 1];

        const axios = require("axios");
        const thumbnailResponse = await axios.get(selectedVideo.thumbnail, {
          responseType: "arraybuffer",
        });
        const thumbnailBuffer = Buffer.from(thumbnailResponse.data);

        const safeTitle = censorBadWords(selectedVideo.title);
        let caption = `_*${safeTitle}*_\n\n`;
        caption += `*Kanal:* ${selectedVideo.channel.name}\n`;
        caption += `*Süre:* \`${selectedVideo.duration}\`\n`;
        caption += `*Görüntülenme:* \`${formatViews(selectedVideo.views)}\`\n`;
        caption += `*Yükleme:* ${selectedVideo.uploadedAt || "Bilinmiyor"}\n\n`;
        caption += `*URL:* ${selectedVideo.url}\n\n`;
        caption += "_Yanıtlayın:_\n";
        caption += "*1.* Ses\n";
        caption += "*2.* Video";

        await message.sendReply(thumbnailBuffer, "image", {
          caption: caption,
        });
      } catch (error) {
        console.error("YouTube video bilgi hatası:", error);
        await message.sendReply("_🎬 Video bilgisi alınamadı._");
      }
    } else if (
      repliedText.includes("Yanıtlayın:") &&
      repliedText.includes("* Ses")
    ) {
      if (selectedNumber !== 1 && selectedNumber !== 2) {
        return await message.sendReply("_🎬 Ses için 1'i Video için 2'yi seçin_"
        );
      }

      try {
        const urlMatch = repliedText.match(/\*URL:\*\s*(https?:\/\/\S+)/m);
        if (!urlMatch) return;

        const url = urlMatch[1].trim();
        const titleMatch = repliedText.match(/_\*([^*]+)\*_/);
        const title = titleMatch ? titleMatch[1] : "Video";

        let downloadMsg;
        let filePath;

        if (selectedNumber === 1) {
          try {
            downloadMsg = await message.sendReply(`_⬇️ Ses indiriliyor..._`);

            const result = await downloadAudio(url);
            filePath = result.path;

            const mp3Path = await convertM4aToMp3(filePath);
            filePath = mp3Path;

            await message.edit(
              "_📤 Ses gönderiliyor..._",
              message.jid,
              downloadMsg.key
            );

            const stream4 = fs.createReadStream(filePath);
            await message.sendReply({ stream: stream4 }, "audio", {
              mimetype: "audio/mp4",
            });
            stream4.destroy();

            await message.edit(
              "_✅ İndirme tamamlandı!_",
              message.jid,
              downloadMsg.key
            );

            await new Promise((resolve) => setTimeout(resolve, 100));
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          } catch (error) {
            console.error("YouTube ses indirme hatası:", error);
            if (downloadMsg) {
              await message.edit(
                "_❌ İndirme başarısız!_",
                message.jid,
                downloadMsg.key
              );
            }

            if (filePath && fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
        } else if (selectedNumber === 2) {
          try {
            downloadMsg = await message.sendReply(`_⬇️ Video indiriliyor..._`);

            const result = await downloadVideo(url, "360p");
            filePath = result.path;

            await message.edit(
              "_📤 Video yükleniyor..._",
              message.jid,
              downloadMsg.key
            );

            const stats = fs.statSync(filePath);
            const safeTitle = censorBadWords(result.title);

            if (stats.size > VIDEO_SIZE_LIMIT) {
              const stream5 = fs.createReadStream(filePath);
              await message.sendMessage({ stream: stream5 }, "document", {
                fileName: `${safeTitle}.mp4`,
                mimetype: "video/mp4",
                caption: `_*${safeTitle}*_\n\n_Dosya boyutu: ${formatBytes(
                  stats.size
                )}_\n_Kalite: 360p_`,
              });
              stream5.destroy();
            } else {
              const stream6 = fs.createReadStream(filePath);
              await message.sendReply({ stream: stream6 }, "video", {
                caption: `_*${safeTitle}*_\n\n_Kalite: 360p_`,
              });
              stream6.destroy();
            }

            await message.edit(
              "_✅ İndirme tamamlandı!_",
              message.jid,
              downloadMsg.key
            );

            await new Promise((resolve) => setTimeout(resolve, 100));
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          } catch (error) {
            console.error("YouTube video indirme hatası:", error);
            if (downloadMsg) {
              await message.edit(
                "_❌ İndirme başarısız!_",
                message.jid,
                downloadMsg.key
              );
            }

            if (filePath && fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
        }
      } catch (error) {
        console.error("YouTube indirme seçim hatası:", error);
        await message.sendReply("_❌ İndirme işlemi başarısız oldu._");
      }
    } else if (
      repliedText.includes("Video Kalitesini Seçin") &&
      repliedText.includes("İndirmek için bir numara ile yanıtlayın")
    ) {
      try {
        const lines = repliedText.split("\n");
        let videoId = "";

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();

          if (
            line.startsWith("(") &&
            line.endsWith(")") &&
            line.length >= 13 &&
            !line.includes("Select") &&
            !line.includes("Reply") &&
            !line.match(/^\*\d+\./)
          ) {
            videoId = line.replace(/[()]/g, "").trim();
            if (videoId.length >= 10) break;
          }
        }

        if (!videoId || videoId.length < 10) {
          return await message.sendReply("_🎬 Video kimliği alınamadı._");
        }

        const url = `https://www.youtube.com/watch?v=${videoId}`;

        const titleMatch = repliedText.match(/_\*([^*]+)\*_/);
        if (!titleMatch) return;

        const qualityLines = lines.filter((line) => line.match(/^\*\d+\./));

        if (!qualityLines[selectedNumber - 1]) {
          return await message.sendReply("_❌ Geçersiz kalite seçimi!_");
        }

        const selectedLine = qualityLines[selectedNumber - 1];
        const isAudioOnly = selectedLine.includes("Sadece Ses");

        if (isAudioOnly) {
          let downloadMsg;
          let audioPath;

          try {
            downloadMsg = await message.sendReply("_⬇️ Ses indiriliyor..._");

            const result = await downloadAudio(url);
            audioPath = result.path;

            const mp3Path = await convertM4aToMp3(audioPath);
            audioPath = mp3Path;

            await message.edit(
              "_📤 Ses gönderiliyor..._",
              message.jid,
              downloadMsg.key
            );

            const safeTitle = censorBadWords(result.title);
            const stream = fs.createReadStream(audioPath);
            await message.sendMessage({ stream }, "document", {
              fileName: `${safeTitle}.m4a`,
              mimetype: "audio/mp4",
              caption: `_*${safeTitle}*_`,
            });
            stream.destroy();

            await message.edit(
              "_✅ İndirme tamamlandı!_",
              message.jid,
              downloadMsg.key
            );

            await new Promise((resolve) => setTimeout(resolve, 100));
            if (fs.existsSync(audioPath)) {
              fs.unlinkSync(audioPath);
            }
          } catch (error) {
            console.error("YouTube video ses indirme hatası:", error);
            if (downloadMsg) {
              await message.edit(
                "_İndirme başarısız!_",
                message.jid,
                downloadMsg.key
              );
            }

            if (audioPath && fs.existsSync(audioPath)) {
              fs.unlinkSync(audioPath);
            }
          }
        } else {
          const qualityMatch = selectedLine.match(/(\d+p)/);
          if (!qualityMatch) return;

          const selectedQuality = qualityMatch[1];

          let downloadMsg;
          let videoPath;

          try {
            downloadMsg = await message.sendReply(
              `_⬇️ *${selectedQuality}* kalitesinde video indiriliyor..._`
            );

            const result = await downloadVideo(url, selectedQuality);
            videoPath = result.path;

            await message.edit(
              "_📤 Video yükleniyor..._",
              message.jid,
              downloadMsg.key
            );

            const stats = fs.statSync(videoPath);
            const safeTitle = censorBadWords(result.title);

            if (stats.size > VIDEO_SIZE_LIMIT) {
              const stream7 = fs.createReadStream(videoPath);
              await message.sendMessage({ stream: stream7 }, "document", {
                fileName: `${safeTitle}.mp4`,
                mimetype: "video/mp4",
                caption: `_*${safeTitle}*_\n\n_Dosya boyutu: ${formatBytes(
                  stats.size
                )}_\n_Kalite: ${selectedQuality}_`,
              });
              stream7.destroy();
            } else {
              const stream8 = fs.createReadStream(videoPath);
              await message.sendReply({ stream: stream8 }, "video", {
                caption: `_*${safeTitle}*_\n\n_Kalite: ${selectedQuality}_`,
              });
              stream8.destroy();
            }

            await message.edit(
              "_✅ İndirme tamamlandı!_",
              message.jid,
              downloadMsg.key
            );

            await new Promise((resolve) => setTimeout(resolve, 100));
            if (fs.existsSync(videoPath)) {
              fs.unlinkSync(videoPath);
            }
          } catch (error) {
            console.error("YouTube video indirme hatası:", error);
            if (downloadMsg) {
              await message.edit(
                "_İndirme başarısız!_",
                message.jid,
                downloadMsg.key
              );
            }

            if (videoPath && fs.existsSync(videoPath)) {
              fs.unlinkSync(videoPath);
            }
          }
        }
      } catch (error) {
        console.error("YouTube kalite seçim hatası:", error);
        await message.sendReply("_❌ Kalite seçimi işlenemedi._");
      }
    }
  }
);

Module(
  {
    pattern: "spotify ?(.*)",
    fromMe: fromMe,
    desc: "Spotify bağlantısından ses indir",
    usage: ".spotify <spotify link>",
    use: "download",
  },
  async (message, match) => {
    let url = match[1] || message.reply_message?.text;

    if (url && /\bhttps?:\/\/\S+/gi.test(url)) {
      url = url.match(/\bhttps?:\/\/\S+/gi)[0];
    }

    if (!url || !url.includes("spotify.com")) {
      return await message.sendReply("_⚠️ Lütfen geçerli bir Spotify bağlantısı verin!_\n_Örnek: .spotify https://open.spotify.com/track/xxxxx_"
      );
    }

    let downloadMsg;
    let audioPath;

    try {
      downloadMsg = await message.sendReply("_⏳ Spotify bilgileri alınıyor..._");
      const spotifyInfo = await spotifyTrack(url);
      const { title, artist } = spotifyInfo;

      const safeTitle = censorBadWords(title);
      await message.edit(
        `_⬇️ *${artist}* - *${safeTitle}* indiriliyor..._`,
        message.jid,
        downloadMsg.key
      );

      const query = `${title} ${artist}`;
      const results = await searchYoutube(query, 1);

      if (!results || results.length === 0) {
        return await message.edit(
          "_❌ YouTube'da eşleşen şarkı bulunamadı!_",
          message.jid,
          downloadMsg.key
        );
      }

      const video = results[0];
      const result = await downloadAudio(video.url);
      audioPath = result.path;

      const mp3Path = await convertM4aToMp3(audioPath);
      audioPath = mp3Path;

      await message.edit(
        "_📤 Ses gönderiliyor..._",
        message.jid,
        downloadMsg.key
      );

      const stream = fs.createReadStream(audioPath);
      await message.sendReply({ stream: stream }, "audio", {
        mimetype: "audio/mp4",
      });
      stream.destroy();

      await message.edit(
        "_✅ İndirme tamamlandı!_",
        message.jid,
        downloadMsg.key
      );

      await new Promise((resolve) => setTimeout(resolve, 100));
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }
    } catch (error) {
      try {
        const fallback = await nexray.downloadSpotify(url);
        if (fallback?.url) {
          if (!downloadMsg) downloadMsg = await message.sendReply("_⬇️ Yedek yöntemle indiriliyor..._");
          await message.edit("_📤 Ses gönderiliyor..._", message.jid, downloadMsg.key);
          await message.sendReply({ url: fallback.url }, "audio");
          await message.edit("_✅ İndirme tamamlandı!_", message.jid, downloadMsg.key);
          return;
        }
      } catch (_) {}
      console.error("Spotify indirme hatası:", error);
      if (downloadMsg) {
        await message.edit("_❌ İndirme başarısız!_", message.jid, downloadMsg.key);
      } else {
        await message.sendReply("_❌ İndirme başarısız oldu. Lütfen tekrar deneyin._");
      }

      if (audioPath && fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }
    }
  }
);

const { Module } = require("../main");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const {
  bass,
  sticker,
  addExif,
  attp,
  gtts,
  gis,
  aiTTS,
  getBuffer,
} = require("./utils");
const config = require("../config");
const axios = require("axios");
const fileType = require("file-type");
const { getTempPath, getTempSubdir } = require("../core/helpers");

const getFileType = async (buffer) => {
  try {
    if (fileType.fileTypeFromBuffer) {
      return await fileType.fileTypeFromBuffer(buffer);
    }

    if (fileType.fromBuffer) {
      return await fileType.fromBuffer(buffer);
    }

    return await fileType(buffer);
  } catch (error) {
    console.log("file-type detection failed:", error);
    return null;
  }
};
let MODE = config.MODE,
  STICKER_DATA = config.STICKER_DATA;
const { getString } = require("./utils/lang");
const Lang = getString("converters");

Module(
  {
    pattern: "img ?(.*)",
    use: "search",
    desc: "Google Görseller'de resim arar ve istenen sayıda sonucu gönderir.",
  },
  async (message, match) => {
    if (!match[1]) return await message.send("*_Arama terimi gerekli!_*");
    let splitInput = match[1].split(",");
    let count = parseInt(splitInput[1] || 5);
    await message.send(`*_${count} görsel aranıyor..._*`);

    const buffer = Math.ceil(count * 0.5);
    let results = await gis(splitInput[0], count + buffer);
    if (results.length < 1) return await message.send("*_Sonuç bulunamadı!_*");

    // buffer and send with success tracking since many URLs have access issues
    let successCount = 0;
    let i = 0;
    const imagesToSend = [];

    while (successCount < count && i < results.length) {
      try {
        const imageBuffer = await getBuffer(results[i]);
        imagesToSend.push({ image: imageBuffer });
        successCount++;
      } catch (e) {
        console.log(`Failed to buffer image ${i + 1}:`, e.message);
        if (i === results.length - 1 && successCount < count) {
          let moreResults = await gis(splitInput[0], buffer, {
            page: Math.floor(i / 10) + 1,
          });
          if (moreResults.length > 0) {
            results = results.concat(moreResults);
          }
        }
      }
      i++;
    }

    if (imagesToSend.length === 0) {
      return await message.send("*_Hiçbir görsel indirilemedi_*");
    }

    try {
      await message.client.albumMessage(
        message.jid,
        imagesToSend,
        message.data
      );
    } catch (e) {
      console.log("Album send failed:", e.message);
      for (const img of imagesToSend) {
        try {
          await message.sendMessage(img, "image", { quoted: message.data });
        } catch (sendErr) {
          console.log("Failed to send individual image:", sendErr.message);
        }
      }
    }

    if (successCount < count) {
      await message.send(
        `*_Sadece ${successCount}/${count} görsel indirilebildi. Bazı URL'lerde erişim sorunu vardı._*`
      );
    }
  }
);

Module(
  {
    pattern: "sticker ?(.*)",
    use: "edit",
    desc: Lang.STICKER_DESC,
  },
  async (message, match) => {
    if (match[1] && match[1].trim() !== "") {
      var result = await attp(match[1].trim());
      var exif = {
        author: STICKER_DATA.split(";")[1] || "",
        packname: message.senderName,
        categories: STICKER_DATA.split(";")[2] || "😂",
        android: "https://github.com/byadems/Lades-MD/",
        ios: "https://github.com/byadems/Lades-MD/",
      };
      return await message.sendMessage(
        fs.readFileSync(await addExif(result, exif)),
        "sticker"
      );
    }

    if (message.reply_message === false)
      return await message.send(Lang.STICKER_NEED_REPLY);

    var exif = {
      author: STICKER_DATA.split(";")[1] || "",
      packname: message.senderName,
      categories: STICKER_DATA.split(";")[2] || "😂",
      android: "https://github.com/byadems/Lades-MD/",
      ios: "https://github.com/byadems/Lades-MD/",
    };

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const allFiles = [...(albumData.images || []), ...(albumData.videos || [])];
      if (allFiles.length === 0) return await message.send("_Albümde medya yok_");

      await message.send(`_${allFiles.length} çıkartma dönüştürülüyor..._`);
      for (const file of allFiles) {
        try {
          const isVideo = albumData.videos?.includes(file);
          const stickerFile = fs.readFileSync(
            await addExif(
              await sticker(file, isVideo ? "video" : "image"),
              exif
            )
          );
          await message.sendMessage(stickerFile, "sticker", {
            quoted: message.quoted,
          });
        } catch (err) {
          console.error("Failed to convert album sticker:", err);
        }
      }
      return;
    }

    var savedFile = await message.reply_message.download();
    if (message.reply_message.image === true) {
      return await message.sendMessage(
        fs.readFileSync(await addExif(await sticker(savedFile), exif)),
        "sticker",
        { quoted: message.quoted }
      );
    } else {
      return await message.sendMessage(
        fs.readFileSync(await addExif(await sticker(savedFile, "video"), exif)),
        "sticker",
        { quoted: message.quoted }
      );
    }
  }
);
Module(
  {
    pattern: "mp3 ?(.*)",
    use: "edit",
    desc: Lang.MP3_DESC,
  },
  async (message) => {
    if (
      !message.reply_message ||
      (!message.reply_message.video &&
        !message.reply_message.audio &&
        !message.reply_message.document &&
        !message.reply_message.album)
    )
      return await message.sendReply(Lang.MP3_NEED_REPLY);

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const videoFiles = albumData.videos || [];
      
      if (videoFiles.length === 0) {
        return await message.send("_Albümde video dosyası yok. MP3 için video/ses dosyası gerekir._");
      }

      await message.send(`_${videoFiles.length} dosya mp3'e dönüştürülüyor..._`);
      for (let i = 0; i < videoFiles.length; i++) {
        try {
          const file = videoFiles[i];
          const outputPath = getTempPath(`album_${i}.mp3`);
          await new Promise((resolve, reject) => {
            ffmpeg(file)
              .save(outputPath)
              .on("end", resolve)
              .on("error", reject);
          });
          await message.sendMessage(
            fs.readFileSync(outputPath),
            "audio",
            { quoted: message.quoted }
          );
        } catch (err) {
          console.error("Failed to convert album mp3:", err);
        }
      }
      return;
    }

    let savedFile = await message.reply_message.download();
    ffmpeg(savedFile)
      .save(getTempPath("tomp3.mp3"))
      .on("end", async () => {
        await message.sendMessage(
          fs.readFileSync(getTempPath("tomp3.mp3")),
          "audio",
          { quoted: message.quoted }
        );
      });
  }
);
Module(
  {
    pattern: "slow",
    use: "edit",
    desc: "Müziği yavaşlatır ve ses tonunu düşürür. Slowed+reverb sesleri yapmak için",
  },
  async (message, match) => {
    if (message.reply_message === false)
      return await message.sendReply(Lang.MP3_NEED_REPLY);

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const videoFiles = albumData.videos || [];
      
      if (videoFiles.length === 0) {
        return await message.send("_Albümde video dosyası yok. Yavaşlatma için video/ses dosyası gerekir._");
      }

      await message.send(`_${videoFiles.length} dosya yavaşlatılıyor..._`);
      for (let i = 0; i < videoFiles.length; i++) {
        try {
          const file = videoFiles[i];
          const outputPath = getTempPath(`album_slow_${i}.mp3`);
          await new Promise((resolve, reject) => {
            ffmpeg(file)
              .audioFilter("atempo=0.5")
              .outputOptions(["-y", "-af", "asetrate=44100*0.9"])
              .save(outputPath)
              .on("end", resolve)
              .on("error", reject);
          });
          await message.sendMessage(
            fs.readFileSync(outputPath),
            "audio",
            { quoted: message.quoted }
          );
        } catch (err) {
          console.error("Failed to slow album audio:", err);
        }
      }
      return;
    }

    var { seconds } =
      message.quoted.message[Object.keys(message.quoted.message)[0]];
    if (seconds > 120)
      await message.sendReply(`_❌ Uyarı: Süre 2 dakikadan uzun. Bu işlem başarısız olabilir veya çok daha uzun sürebilir!_`
      );
    var savedFile = await message.reply_message.download();
    ffmpeg(savedFile)
      .audioFilter("atempo=0.5")
      .outputOptions(["-y", "-af", "asetrate=44100*0.9"])
      .save(getTempPath("slow.mp3"))
      .on("end", async () => {
        await message.sendMessage(
          fs.readFileSync(getTempPath("slow.mp3")),
          "audio",
          {
            quoted: message.quoted,
          }
        );
      });
  }
);
Module(
  {
    pattern: "sped ?(.*)",
    use: "edit",
    desc: "Müziği hızlandırır ve ses tonunu yükseltir. Sped-up+reverb sesleri yapmak için",
  },
  async (message, match) => {
    if (message.reply_message === false)
      return await message.sendReply(Lang.MP3_NEED_REPLY);

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const videoFiles = albumData.videos || [];
      
      if (videoFiles.length === 0) {
        return await message.send("_Albümde video dosyası yok. Hızlandırma için video/ses dosyası gerekir._");
      }

      await message.send(`_${videoFiles.length} dosya hızlandırılıyor..._`);
      for (let i = 0; i < videoFiles.length; i++) {
        try {
          const file = videoFiles[i];
          const outputPath = getTempPath(`album_sped_${i}.mp3`);
          await new Promise((resolve, reject) => {
            ffmpeg(file)
              .audioFilter("atempo=0.5")
              .outputOptions(["-y", "-af", "asetrate=44100*1.2"])
              .save(outputPath)
              .on("end", resolve)
              .on("error", reject);
          });
          await message.sendMessage(
            fs.readFileSync(outputPath),
            "audio",
            { quoted: message.quoted }
          );
        } catch (err) {
          console.error("Failed to speed album audio:", err);
        }
      }
      return;
    }

    var { seconds } =
      message.quoted.message[Object.keys(message.quoted.message)[0]];
    if (seconds > 120)
      await message.sendReply(`_❌ Uyarı: Süre 2 dakikadan uzun. Bu işlem başarısız olabilir veya çok daha uzun sürebilir!_`
      );
    var savedFile = await message.reply_message.download();
    ffmpeg(savedFile)
      .audioFilter("atempo=0.5")
      .outputOptions(["-y", "-af", "asetrate=44100*1.2"])
      .save(getTempPath("sped.mp3"))
      .on("end", async () => {
        await message.sendMessage(
          fs.readFileSync(getTempPath("sped.mp3")),
          "audio",
          {
            quoted: message.quoted,
          }
        );
      });
  }
);
Module(
  {
    pattern: "bass ?(.*)",
    use: "edit",
    desc: Lang.BASS_DESC,
  },
  async (message, match) => {
    if (message.reply_message === false)
      return await message.sendReply(Lang.BASS_NEED_REPLY);

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const videoFiles = albumData.videos || [];
      
      if (videoFiles.length === 0) {
        return await message.send("_Albümde video dosyası yok. Bas için video/ses dosyası gerekir._");
      }

      await message.send(`_${videoFiles.length} dosyaya bas ekleniyor..._`);
      for (const file of videoFiles) {
        try {
          bass(file, match[1], async function (audio) {
            await message.sendMessage(audio, "audio", { quoted: message.data });
          });
        } catch (err) {
          console.error("Failed to add bass to album audio:", err);
        }
      }
      return;
    }

    var savedFile = await message.reply_message.download();
    bass(savedFile, match[1], async function (audio) {
      await message.sendMessage(audio, "audio", { quoted: message.data });
    });
  }
);
Module(
  {
    pattern: "photo ?(.*)",
    use: "edit",
    desc: Lang.PHOTO_DESC,
  },
  async (message, match) => {
    if (message.reply_message === false)
      return await message.send(Lang.PHOTO_NEED_REPLY);
    var savedFile = await message.reply_message.download();
    ffmpeg(savedFile)
      .fromFormat("webp_pipe")
      .save("output.png")
      .on("end", async () => {
        await message.sendReply(fs.readFileSync("output.png"), "image");
      });
  }
);
Module(
  {
    pattern: "attp ?(.*)",
    use: "utility",
    desc: "Metinden hareketli çıkartmaya",
  },
  async (message, match) => {
    if (match[1] == "") return await message.send("*Need text*");
    var result = await attp(match[1]);
    var exif = {
      author: STICKER_DATA.split(";")[1] || "",
      packname: message.senderName,
      categories: STICKER_DATA.split(";")[2] || "😂",
      android: "https://github.com/byadems/Lades-MD/",
      ios: "https://github.com/byadems/Lades-MD/",
    };
    await message.sendMessage(
      fs.readFileSync(await addExif(result, exif)),
      "sticker"
    );
  }
);
Module(
  {
    pattern: "tts ?(.*)",
    desc: Lang.TTS_DESC,
    use: "utility",
  },
  async (message, match) => {
    var query = match[1] || message.reply_message.text;
    if (!query) return await message.sendReply(Lang.TTS_NEED_REPLY);
    const ttsDir = getTempSubdir("tts");
    query = query.replace("tts", "");
    var lng = "en";
    if (/[\u0D00-\u0D7F]+/.test(query)) lng = "ml";
    let LANG = lng,
      ttsMessage = query,
      SPEED = 1.0,
      VOICE = "nova";
    if ((langMatch = query.match("\\{([a-z]{2})\\}"))) {
      LANG = langMatch[1];
      ttsMessage = ttsMessage.replace(langMatch[0], "");
    }
    if ((speedMatch = query.match("\\{([0-9]+\\.[0-9]+)\\}"))) {
      SPEED = parseFloat(speedMatch[1]);
      ttsMessage = ttsMessage.replace(speedMatch[0], "");
    }
    if (
      (voiceMatch = query.match(
        "\\{(nova|alloy|ash|coral|echo|fable|onyx|sage|shimmer)\\}"
      ))
    ) {
      VOICE = voiceMatch[1];
      ttsMessage = ttsMessage.replace(voiceMatch[0], "");
    }
    let audio;

    if (LANG === "ml") {
      try {
        audio = await gtts(ttsMessage.trim(), LANG);
      } catch {
        return await message.sendReply("_" + Lang.TTS_ERROR + "_");
      }
    } else {
      try {
        const ttsResult = await aiTTS(
          ttsMessage.trim(),
          VOICE,
          SPEED.toFixed(2)
        );
        if (ttsResult && ttsResult.url) {
          audio = { url: ttsResult.url };
        } else {
          throw new Error(
            ttsResult && ttsResult.error ? ttsResult.error : "AI TTS failed"
          );
        }
      } catch (e) {
        console.error("AI TTS failed, falling back to gtts:", e);
        try {
          audio = await gtts(ttsMessage.trim(), LANG);
        } catch {
          return await message.sendReply("_" + Lang.TTS_ERROR + "_");
        }
      }
    }

    await message.sendMessage(audio, "audio", {
      quoted: message.data,
      mimetype: "audio/mpeg",
      ptt: true,
    });
  }
);
Module(
  {
    pattern: "doc ?(.*)",
    use: "edit",
    desc: "Yanıtlanan medyayı belge (document) formatına dönüştürür",
  },
  async (message, match) => {
    if (message.reply_message === false)
      return await message.send(
        "_Bir medya dosyasına (görsel, video, ses, çıkartma veya belge) yanıt verin_"
      );

    if (
      !message.reply_message.image &&
      !message.reply_message.video &&
      !message.reply_message.audio &&
      !message.reply_message.sticker &&
      !message.reply_message.document &&
      !message.reply_message.album
    ) {
      return await message.send(
        "_Bir medya dosyasına (görsel, video, ses, çıkartma veya belge) yanıt verin_"
      );
    }

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const allFiles = [...(albumData.images || []), ...(albumData.videos || [])];
      if (allFiles.length === 0) return await message.send("_Albümde medya yok_");

      await message.send(`_${allFiles.length} dosya belgeye dönüştürülüyor..._`);
      for (let i = 0; i < allFiles.length; i++) {
        try {
          const filePath = allFiles[i];
          const stream = fs.createReadStream(filePath);
          var randomHash = Math.random().toString(36).substring(2, 8);
          var fileName = match[1] || `album_${i}_${randomHash}`;
          var mimetype = "application/octet-stream";

          if (!fileName.includes(".")) {
            const ext = filePath.split(".").pop();
            if (ext) fileName += `.${ext}`;
          }

          await message.sendMessage({ stream: stream }, "document", {
            quoted: message.quoted,
            fileName: fileName,
            mimetype: mimetype,
            caption: "_Belgeye dönüştürüldü_",
          });
        } catch (err) {
          console.error("Failed to convert album file to document:", err);
        }
      }
      return;
    }

    try {
      const mediaMessage = message.reply_message.data.message;
      const mediaType = Object.keys(mediaMessage)[0];
      const mediaInfo = mediaMessage[mediaType];

      if (mediaInfo.fileLength && mediaInfo.fileLength > 50 * 1024 * 1024) {
        return await message.send("_Dosya çok büyük! Maksimum boyut 50MB_");
      }
      const processingMsg = await message.send("_Belgeye dönüştürülüyor..._");

      const filePath = await message.reply_message.download();
      const stream = fs.createReadStream(filePath);
      var randomHash = Math.random().toString(36).substring(2, 8);
      var fileName = match[1];
      var mimetype = mediaInfo.mimetype || "application/octet-stream";

      if (message.reply_message.document && mediaInfo.fileName && !match[1]) {
        fileName = mediaInfo.fileName;
      } else if (!fileName) {
        fileName = `converted_file_${randomHash}`;
      }

      if (!fileName.includes(".") && mimetype) {
        const ext = mimetype.split("/")[1];
        if (ext && ext !== "octet-stream") {
          fileName += `.${ext}`;
        }
      }
      await message.sendMessage({ stream: stream }, "document", {
        quoted: message.quoted,
        fileName: fileName,
        mimetype: mimetype,
        caption: match[1] ? "" : "_Belgeye dönüştürüldü_",
      });

      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.log("Failed to delete temp file:", filePath);
      }

      await message.edit(
        "_Belge dönüşümü tamamlandı!_",
        message.jid,
        processingMsg.key
      );
    } catch (error) {
      console.error("Doc conversion error:", error);
      if (error.message.includes("download")) {
        await message.send(
          "_Medya indirilemedi. Dosya bozuk veya süresi dolmuş olabilir_"
        );
      } else if (
        error.message.includes("large") ||
        error.message.includes("memory")
      ) {
        await message.send("_Dosya işlemek için çok büyük_");
      } else {
        await message.send("_Medya belgeye dönüştürülemedi_");
      }
    }
  }
);
Module(
  {
    pattern: "upload ?(.*)",
    use: "utility",
    desc: "URL'den dosya indirir ve belge olarak gönderir",
  },
  async (message, match) => {
    var url =
      match[1] || (message.reply_message ? message.reply_message.text : "");

    const urlMatch = url.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      url = urlMatch[0];
    }

    if (!url || !url.startsWith("http")) {
      return await message.send(
        "_Geçerli bir URL girin veya URL içeren bir mesaja yanıt verin_"
      );
    }

    try {
      await message.send("_Dosya indiriliyor..._");

      const response = await axios.get(url, {
        responseType: "stream",
        timeout: 60000,
      });

      var randomHash = Math.random().toString(36).substring(2, 8);
      var fileName = `downloaded_file_${randomHash}`;
      var mimetype =
        response.headers["content-type"] || "application/octet-stream";

      const contentDisposition = response.headers["content-disposition"];
      if (contentDisposition && contentDisposition.includes("filename=")) {
        const filenameMatch = contentDisposition.match(
          /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/
        );
        if (filenameMatch) {
          fileName = filenameMatch[1].replace(/['"]/g, "");
        }
      } else {
        const urlPath = new URL(url).pathname;
        const urlFileName = urlPath.split("/").pop();
        if (urlFileName && urlFileName.includes(".")) {
          fileName = urlFileName;
        }
      }

      if (!fileName.includes(".") && response.headers["content-type"]) {
        const ext = response.headers["content-type"].split("/")[1];
        if (ext && ext !== "octet-stream") {
          fileName += `.${ext}`;
        }
      }
      await message.sendMessage({ stream: response.data }, "document", {
        quoted: message.quoted,
        fileName: fileName,
        mimetype: mimetype,
        caption: `_İndirildi: ${url}_`,
      });
    } catch (error) {
      console.error("Upload error:", error);
      if (error.code === "ECONNABORTED") {
        await message.send(
          "_İndirme zaman aşımı. Dosya çok büyük veya sunucu yavaş olabilir_"
        );
      } else if (error.response && error.response.status === 404) {
        await message.send("_Dosya bulunamadı (404). Lütfen URL'yi kontrol edin_");
      } else if (error.response && error.response.status >= 400) {
        await message.send(
          `_İndirme başarısız (durum: ${error.response.status})_`
        );
      } else {
        await message.send(
          "_Dosya indirilemedi. Lütfen URL'yi kontrol edip tekrar deneyin_"
        );
      }
    }
  }
);
Module(
  {
    pattern: "square ?(.*)",
    use: "edit",
    desc: "Video/resmi 1:1 oranında (kare formatında) kırpar",
  },
  async (message, match) => {
    if (
      !message.reply_message ||
      (!message.reply_message.video && !message.reply_message.image)
    ) {
      return await message.sendReply("_🎬 Kare formatında kırpmak için bir videoyu veya resmi yanıtlayın_"
      );
    }

    try {
      const processingMsg = await message.send(
        "_Medya kare formata işleniyor..._"
      );

      const savedFile = await message.reply_message.download();
      const isVideo = message.reply_message.video;
      const outputPath = getTempPath(
        `square_${Date.now()}.${isVideo ? "mp4" : "jpg"}`
      );

      const command = ffmpeg(savedFile)
        .outputOptions(["-y"])
        .videoFilters([
          "scale='min(iw,ih)':'min(iw,ih)':force_original_aspect_ratio=increase",
          "crop='min(iw,ih)':'min(iw,ih)'",
        ]);

      if (isVideo) {
        command
          .videoCodec("libx264")
          .audioCodec("aac")
          .outputOptions(["-preset", "fast", "-crf", "23"])
          .format("mp4");
      } else {
        command.format("mjpeg").outputOptions(["-q:v", "2"]);
      }

      command
        .save(outputPath)
        .on("end", async () => {
          try {
            if (isVideo) {
              await message.sendMessage(fs.readFileSync(outputPath), "video", {
                quoted: message.quoted,
                caption: "_Kare formata kırpıldı_",
              });
            } else {
              await message.sendMessage(fs.readFileSync(outputPath), "image", {
                quoted: message.quoted,
                caption: "_Kare formata kırpıldı_",
              });
            }

            fs.unlinkSync(savedFile);
            fs.unlinkSync(outputPath);

            await message.edit(
              "_Kare kırpma tamamlandı ✅_",
              message.jid,
              processingMsg.key
            );
          } catch (e) {
            console.error("Send error:", e);
            await message.send("_İşlendi ancak gönderilemedi_");
          }
        })
        .on("error", (err) => {
          console.error("FFmpeg error:", err);
          message.send("_Medya işlenemedi. Lütfen tekrar deneyin_");
          try {
            fs.unlinkSync(savedFile);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          } catch (e) {}
        });
    } catch (error) {
      console.error("Square crop error:", error);
      await message.send("_Medya kare kırpma için işlenemedi_");
    }
  }
);

Module(
  {
    pattern: "resize ?(.*)",
    use: "edit",
    desc: "Video/resim en-boy oranını değiştirin. Kullanım: .resize 16:9, .resize 9:16",
  },
  async (message, match) => {
    if (
      !message.reply_message ||
      (!message.reply_message.video && !message.reply_message.image)
    ) {
      return await message.sendReply("_🎬 Boyutunu değiştirmek için bir videoyu veya resmi yanıtlayın_"
      );
    }

    if (!match[1]) {
      return await message.send(
        "_En-boy oranı belirtin. Örnekler:_\n• `.resize 16:9` - Geniş ekran\n• `.resize 9:16` - Dikey/Hikaye\n• `.resize 4:3` - Klasik\n• `.resize 21:9` - Ultra geniş\n• `.resize 1:1` - Kare"
      );
    }

    const input = match[1].trim();

    if (!input.includes(":")) {
      return await message.send(
        "_Geçersiz format! 16:9, 9:16, 4:3 gibi en-boy oranları kullanın._"
      );
    }

    const [widthRatio, heightRatio] = input
      .split(":")
      .map((x) => parseInt(x.trim()));

    if (
      isNaN(widthRatio) ||
      isNaN(heightRatio) ||
      widthRatio <= 0 ||
      heightRatio <= 0
    ) {
      return await message.send(
        "_Geçersiz en-boy oranı! 16:9, 9:16 gibi pozitif sayılar kullanın._"
      );
    }

    try {
      const processingMsg = await message.send(
        `_${input} en-boy oranına yeniden boyutlandırılıyor..._`
      );

      const savedFile = await message.reply_message.download();
      const isVideo = message.reply_message.video;
      const outputPath = getTempPath(
        `resized_${Date.now()}.${isVideo ? "mp4" : "jpg"}`
      );

      let targetWidth, targetHeight;

      if (widthRatio >= heightRatio) {
        targetWidth = 1280;
        targetHeight = Math.round((targetWidth * heightRatio) / widthRatio);
      } else {
        targetHeight = 1280;
        targetWidth = Math.round((targetHeight * widthRatio) / heightRatio);
      }

      targetWidth = targetWidth % 2 === 0 ? targetWidth : targetWidth + 1;
      targetHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight + 1;

      const command = ffmpeg(savedFile)
        .outputOptions(["-y"])
        .videoFilters([
          `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase`,
          `crop=${targetWidth}:${targetHeight}`,
        ]);

      if (isVideo) {
        command
          .videoCodec("libx264")
          .audioCodec("aac")
          .outputOptions(["-preset", "fast", "-crf", "23"])
          .format("mp4");
      } else {
        command.format("mjpeg").outputOptions(["-q:v", "2"]);
      }

      command
        .save(outputPath)
        .on("end", async () => {
          try {
            if (isVideo) {
              await message.sendMessage(fs.readFileSync(outputPath), "video", {
                quoted: message.quoted,
                caption: `_${input} en-boy oranına boyutlandırıldı (${targetWidth}x${targetHeight})_`,
              });
            } else {
              await message.sendMessage(fs.readFileSync(outputPath), "image", {
                quoted: message.quoted,
                caption: `_${input} en-boy oranına boyutlandırıldı (${targetWidth}x${targetHeight})_`,
              });
            }

            fs.unlinkSync(savedFile);
            fs.unlinkSync(outputPath);

            await message.edit(
              `_${input} en-boy oranı değişikliği tamamlandı ✅_`,
              message.jid,
              processingMsg.key
            );
          } catch (e) {
            console.error("Send error:", e);
            await message.send("_İşlendi ancak gönderilemedi_");
          }
        })
        .on("error", (err) => {
          console.error("FFmpeg resize error:", err);
          message.send(
            "_Medya boyutu değiştirilemedi. En-boy oranını kontrol edip tekrar deneyin_"
          );
          try {
            fs.unlinkSync(savedFile);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          } catch (e) {}
        });
    } catch (error) {
      console.error("Resize error:", error);
      await message.send("_Medya boyutlandırma için işlenemedi_");
    }
  }
);
Module(
  {
    pattern: "compress ?(.*)",
    use: "edit",
    desc: "Video/resmi yüzdeyle sıkıştırın. Kullanım: .compress 50 (%50 sıkıştırma)",
  },
  async (message, match) => {
    if (
      !message.reply_message ||
      (!message.reply_message.video && !message.reply_message.image)
    ) {
      return await message.sendReply("_🎬 Sıkıştırmak için bir videoyu veya resmi yanıtlayın_"
      );
    }

    if (!match[1]) {
      return await message.send(
        "_Sıkıştırma yüzdesi belirtin. Örnekler:_\n• `.compress 50` - %50 sıkıştırma (orta)\n• `.compress 70` - %70 sıkıştırma (yüksek)\n• `.compress 80` - %80 sıkıştırma (çok yüksek)\n• `.compress 30` - %30 sıkıştırma (hafif)"
      );
    }

    const compressionPercent = parseInt(match[1].trim());

    if (
      isNaN(compressionPercent) ||
      compressionPercent < 10 ||
      compressionPercent > 95
    ) {
      return await message.send(
        "_Geçersiz sıkıştırma yüzdesi! 10-95 arası değer kullanın._"
      );
    }

    try {
      const processingMsg = await message.send(
        `_%${compressionPercent} sıkıştırılıyor..._`
      );

      const savedFile = await message.reply_message.download();
      const isVideo = message.reply_message.video;
      const outputPath = getTempPath(
        `compressed_${Date.now()}.${isVideo ? "mp4" : "jpg"}`
      );

      const command = ffmpeg(savedFile).outputOptions(["-y"]);

      if (isVideo) {
        const crf = Math.round(
          18 + ((compressionPercent - 10) * (45 - 18)) / (95 - 10)
        );

        command
          .videoCodec("libx264")
          .audioCodec("aac")
          .outputOptions([
            "-preset",
            "medium",
            "-crf",
            crf.toString(),
            "-profile:v",
            "main",
            "-level",
            "3.1",
          ])
          .format("mp4");
      } else {
        const quality = Math.round(
          2 + ((compressionPercent - 10) * (28 - 2)) / (95 - 10)
        );

        command.format("mjpeg").outputOptions(["-q:v", quality.toString()]);
      }

      command
        .save(outputPath)
        .on("end", async () => {
          try {
            const originalSize = fs.statSync(savedFile).size;
            const compressedSize = fs.statSync(outputPath).size;
            const actualReduction = Math.round(
              (1 - compressedSize / originalSize) * 100
            );

            const formatSize = (bytes) => {
              const mb = bytes / (1024 * 1024);
              return mb > 1
                ? `${mb.toFixed(1)}MB`
                : `${(bytes / 1024).toFixed(1)}KB`;
            };

            if (isVideo) {
              await message.sendMessage(fs.readFileSync(outputPath), "video", {
                quoted: message.quoted,
                caption: `_%${actualReduction} sıkıştırıldı_\n_${formatSize(
                  originalSize
                )} → ${formatSize(compressedSize)}_`,
              });
            } else {
              await message.sendMessage(fs.readFileSync(outputPath), "image", {
                quoted: message.quoted,
                caption: `_%${actualReduction} sıkıştırıldı_\n_${formatSize(
                  originalSize
                )} → ${formatSize(compressedSize)}_`,
              });
            }

            fs.unlinkSync(savedFile);
            fs.unlinkSync(outputPath);

            await message.edit(
              `_Sıkıştırma tamamlandı ✅ (%${actualReduction} azalma)_`,
              message.jid,
              processingMsg.key
            );
          } catch (e) {
            console.error("Send error:", e);
            await message.send("_İşlendi ancak gönderilemedi_");
          }
        })
        .on("error", (err) => {
          console.error("FFmpeg compress error:", err);
          message.send("_Medya sıkıştırılamadı. Lütfen tekrar deneyin_");
          try {
            fs.unlinkSync(savedFile);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          } catch (e) {}
        });
    } catch (error) {
      console.error("Compress error:", error);
      await message.send("_Medya sıkıştırma için işlenemedi_");
    }
  }
);

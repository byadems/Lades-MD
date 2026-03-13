const { Module } = require("../main");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const https = require("https");
const { getTempPath, getTempSubdir } = require("../core/helpers");

const config = require("../config"),
  MODE = config.MODE;
const { getString } = require("./utils/lang");
const { avMix, circle, rotate, trim, uploadToImgbb } = require("./utils");
const nexray = require("./utils/nexray");
const { censorBadWords } = require("./utils/censor");
const acrcloud = require("acrcloud");
const acr = new acrcloud({
  host: "identify-eu-west-1.acrcloud.com",
  access_key: config.ACR_A,
  access_secret: config.ACR_S,
});
var handler = config.HANDLERS !== "false" ? config.HANDLERS.split("")[0] : "";
async function findMusic(file) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Müzik tanıma zaman aşımına uğradı")), 15000);
    acr.identify(file).then((result) => {
      clearTimeout(timeout);
      resolve(result.metadata?.music?.[0] ?? null);
    }).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
const Lang = getString("media");

async function transcribeVoiceMessage(message, targetMessage) {
  let processingMsg;
  try {
    const voiceMsg = targetMessage || message;
    const isVoice = voiceMsg.audio ||
      voiceMsg.ptt ||
      voiceMsg.data?.message?.audioMessage ||
      voiceMsg.reply_message?.audio ||
      voiceMsg.reply_message?.ptt;
    if (!isVoice) {
      return;
    }
    if ((!config.GROQ_API_KEY || config.GROQ_API_KEY === '') && 
        (!config.OPENAI_API_KEY || config.OPENAI_API_KEY === '')) {
      return await message.sendReply("⚠️ _API Anahtarı bulunamadı! (Groq veya OpenAI)_");
    }
    processingMsg = await message.send("🎙️ _Ses analiz ediliyor..._");
    const audioBuffer = await voiceMsg.download("buffer");
    const tempFile = path.join(__dirname, `audio_${Date.now()}.ogg`);
    fs.writeFileSync(tempFile, audioBuffer);
    const boundary = `----WebKitFormBoundary${Date.now()}`;
    const chunks = [];

    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="model"\r\n\r\n`));
    chunks.push(Buffer.from(`whisper-large-v3-turbo\r\n`));
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="language"\r\n\r\n`));
    chunks.push(Buffer.from(`tr\r\n`));
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="audio.ogg"\r\n`));
    chunks.push(Buffer.from(`Content-Type: audio/ogg\r\n\r\n`));
    chunks.push(audioBuffer);
    chunks.push(Buffer.from(`\r\n`));
    chunks.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(chunks);
    const useGroq = config.GROQ_API_KEY && config.GROQ_API_KEY !== '';
    const makeRequest = (useOpenAI = false) => {
      return new Promise((resolve, reject) => {
        const options = useOpenAI ? {
          hostname: 'api.openai.com',
          port: 443,
          path: '/v1/audio/transcriptions',
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
            'Content-Length': body.length
          }
        } : {
          hostname: 'api.groq.com',
          port: 443,
          path: '/openai/v1/audio/transcriptions',
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Authorization': `Bearer ${config.GROQ_API_KEY}`,
            'Content-Length': body.length
          }
        };
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject({ statusCode: res.statusCode, data, useOpenAI });
            } else {
              resolve({ data, useOpenAI });
            }
          });
        });
        req.on('error', (err) => {
          reject({ error: err, useOpenAI });
        });
        req.write(body);
        req.end();
      });
    };

    let response;
    try {
      if (useGroq) {
        response = await makeRequest(false);
      } else {
        response = await makeRequest(true);
      }
    } catch (groqError) {
      if (!groqError.useOpenAI && config.OPENAI_API_KEY && config.OPENAI_API_KEY !== '') {
        console.log("⚠️ Groq başarısız, OpenAI API'ye geçiliyor...");
        try {
          response = await makeRequest(true);
          console.log("✅ OpenAI API başarılı!");
        } catch (openaiError) {
          console.error("❌ Her iki API de başarısız:", openaiError);
          return await message.edit(
            `⚠️ _API hatası: ${openaiError.statusCode || 'Bağlantı hatası'}_\n_${openaiError.data ? JSON.parse(openaiError.data).error?.message : openaiError.error?.message || 'Bilinmeyen hata'}_`,
            message.jid, processingMsg.key
          );
        }
      } else {
        console.error("❌ Groq API hatası ve OpenAI anahtarı yok:", groqError);
        return await message.edit(
          `⚠️ _API hatası: ${groqError.statusCode || 'Bağlantı hatası'}_\n_${groqError.data ? JSON.parse(groqError.data).error?.message : groqError.error?.message || 'Bilinmeyen hata'}_`,
          message.jid, processingMsg.key
        );
      }
    }
    try {
      const result = JSON.parse(response.data);
      let transcription = result.text;
      if (!transcription || transcription.trim() === '') {
        return await message.edit(
          "❌ _Maalesef, sesi analiz edemedim veya sessizlik tespit ettim._",
          message.jid, processingMsg.key
        );
      }
      transcription = censorBadWords(transcription);
      const apiUsed = response.useOpenAI ? "OpenAI" : "Groq";
      return await message.edit(
        `🎙️ *Seste şunları duydum:*\n\n_"${transcription}"_`,
        message.jid, processingMsg.key
      );
    } catch (parseErr) {
      console.error("Yanıt hatası:", parseErr, response.data);
      return await message.edit("⚠️ _API yanıtı işlenirken hata oluştu. .dinle komutu ile deneyin._", message.jid, processingMsg.key);
    }
  } catch (err) {
    console.error("dinle modülünde hata:", err);
    if (processingMsg) {
      return await message.edit("⚠️ Ses çevrilirken bir hata oluştu.", message.jid, processingMsg.key);
    } else {
      return await message.send("⚠️ Ses çevrilirken bir hata oluştu.");
    }
  }
}

Module({
  pattern: "dinle",
  fromMe: false,
  desc: "Sesli mesajı metne dönüştürür. (Tek seferlik sesler de dahil)",
  usage: ".dinle (bir ses mesajına yanıtlayarak)",
  use: "group",
},
async (message, match) => {
  const replied = message.reply_message;
  if (!replied || (!replied.audio && !replied.ptt)) {
    return await message.sendReply("❌ Lütfen bir ses mesajına yanıtlayarak yazın!");
  }
  return await transcribeVoiceMessage(message, replied);
});

Module({
  on: 'message',
  fromMe: false,
  desc: "Ses mesajını otomatik olarak metne dönüştürür.",
  use: "group",
},
async (message, match) => {
  try {
    const audioMsg = message.data?.message?.audioMessage;
    if (!audioMsg) {
      return;
    }
    if ((!config.GROQ_API_KEY || config.GROQ_API_KEY === '') && 
        (!config.OPENAI_API_KEY || config.OPENAI_API_KEY === '')) {
      return;
    }
    return await transcribeVoiceMessage(message, message);
  } catch (err) {
    console.error("Otomatik dinle hatası:", err);
  }
});

Module(
  {
    pattern: "trim ?(.*)",
    desc: Lang.TRIM_DESC,
    usage: Lang.TRIM_USE,
    use: "edit",
  },
  async (message, match) => {
    if (
      !message.reply_message ||
      (!message.reply_message.video && !message.reply_message.audio)
    )
      return await message.sendReply(Lang.TRIM_NEED_REPLY);
    if (!match[1] || !match[1].includes(","))
      return await message.sendReply(
        message.reply_message.audio ? Lang.TRIM_NEED : Lang.TRIM_VIDEO_NEED
      );
    const parts = match[1].split(",");
    const start = parts[0]?.trim();
    const end = parts[1]?.trim();
    const savedFile = await message.reply_message.download();
    await message.sendMessage("_⏳ Kırpma işleniyor..._");
    if (message.reply_message.audio) {
      const out = getTempPath("trim.ogg");
      await trim(savedFile, start, end, out);
      await message.sendReply({stream: fs.createReadStream(out)}, "audio");
    } else if (message.reply_message.video) {
      const out = getTempPath("trim.mp4");
      await trim(savedFile, start, end, out);
      await message.send({stream: fs.createReadStream(out)}, "video");
    }
  }
);
Module(
  {
    pattern: "renklendir",
    desc: "Siyah-beyaz fotoğrafı renklendirir (yanıtlanan görsel)",
    usage: ".renklendir (görsele yanıt verin)",
    use: "edit",
  },
  async (message) => {
    if (!message.reply_message || !message.reply_message.image)
      return await message.sendReply("_🖼️ Renklendirmek için siyah-beyaz bir görsele yanıt verin._");

    try {
      const processingMsg = await message.sendReply("_🎨 Görsel renklendiriliyor..._");
      const imgPath = await message.reply_message.download();
      const uploadRes = await uploadToImgbb(imgPath);
      const imageUrl = uploadRes?.url || uploadRes?.image?.url;
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);

      if (!imageUrl) {
        await message.edit("_❌ Görsel yüklenemedi. Lütfen tekrar deneyin._", message.jid, processingMsg.key);
        return;
      }

      const resultBuffer = await nexray.colorize(imageUrl);
      if (resultBuffer && resultBuffer.length) {
        await message.sendReply(resultBuffer, "image");
        await message.edit("_✅ Renklendirme tamamlandı!_", message.jid, processingMsg.key);
      } else {
        await message.edit("_❌ Renklendirme başarısız. Lütfen tekrar deneyin._", message.jid, processingMsg.key);
      }
    } catch (error) {
      console.error("Renklendir hatası:", error);
      await message.sendReply("_❌ Bir hata oluştu. Lütfen tekrar deneyin._");
    }
  }
);

Module(
  {
    pattern: "ai ?(.*)",
    desc: "AI araçları: görsel oluşturma, görsel düzenleme",
    usage: ".ai görsel <açıklama> | .ai yzdüzenle <talimat> (görsele yanıt)",
    use: "edit",
  },
  async (message, match) => {
    const argRaw = (match[1] || "").trim();
    const arg = argRaw.toLowerCase();

    if (!argRaw) {
      return await message.sendReply(
        "_🤖 *AI Komutları_\n\n" +
        "• _.ai görsel <açıklama>_ – Metinden görsel oluşturur\n" +
        "• _.ai yzdüzenle <talimat>_ – Görsele yanıt verip GPT Vision ile düzenler\n\n" +
        "_Örnek: .ai görsel gün batımında deniz_\n" +
        "_Örnek: .ai yzdüzenle cilt rengini siyah yap_"
      );
    }

    if (arg.startsWith("görsel")) {
      const prompt = argRaw.slice(6).trim() || message.reply_message?.text?.trim();
      if (!prompt)
        return await message.sendReply("_🖼️ Görsel açıklaması girin._\n_Örnek: .ai görsel gün batımında deniz manzarası_");

      try {
        const processingMsg = await message.sendReply("_🎨 Görsel oluşturuluyor..._");
        const resultBuffer = await nexray.deepImg(prompt);
        if (resultBuffer && resultBuffer.length) {
          await message.sendReply(resultBuffer, "image", {
            caption: `_*${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}*_`,
          });
          await message.edit("_✅ Görsel oluşturuldu!_", message.jid, processingMsg.key);
        } else {
          await message.edit("_❌ Görsel oluşturulamadı. Lütfen farklı bir açıklama deneyin._", message.jid, processingMsg.key);
        }
      } catch (error) {
        console.error("AI görsel hatası:", error);
        await message.sendReply("_❌ Bir hata oluştu. Lütfen tekrar deneyin._");
      }
      return;
    }

    if (arg.startsWith("yzdüzenle") || arg.startsWith("düzenle")) {
      if (!message.reply_message || !message.reply_message.image)
        return await message.sendReply("_🖼️ Düzenlemek için bir görsele yanıt verin._");

      const prompt = (arg.startsWith("yzdüzenle") ? argRaw.slice(9) : argRaw.slice(7)).trim();
      if (!prompt)
        return await message.sendReply("_📝 Düzenleme talimatı girin._\n_Örnek: .ai yzdüzenle cilt rengini siyah yap_");

      try {
        const processingMsg = await message.sendReply("_🎨 Görsel GPT Vision ile düzenleniyor..._");
        const imgBuffer = await message.reply_message.download("buffer");
        const mimetype = message.reply_message.mimetype || "image/jpeg";
        const resultBuffer = await nexray.gptImage(imgBuffer, prompt, mimetype);
        if (resultBuffer && resultBuffer.length) {
          await message.sendReply(resultBuffer, "image", {
            caption: `_*${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}*_`,
          });
          await message.edit("_✅ Görsel düzenlendi!_", message.jid, processingMsg.key);
        } else {
          await message.edit("_❌ Düzenleme başarısız. Lütfen farklı bir talimat deneyin._", message.jid, processingMsg.key);
        }
      } catch (error) {
        console.error("AI yzdüzenle hatası:", error);
        await message.sendReply("_❌ Bir hata oluştu. Lütfen tekrar deneyin._");
      }
      return;
    }

    await message.sendReply(
      "_⚠️ Bilinmeyen alt komut._\n\n" +
      "_Kullanım: .ai görsel <açıklama> | .ai yzdüzenle <talimat>_"
    );
  }
);

Module(
  {
    pattern: "black",
    desc: "Sesi siyah videoya dönüştürür",
    use: "edit",
  },
  async (message, match) => {
    if (!message.reply_message || !message.reply_message.audio)
      return await message.send("_🎵 Ses dosyası gerekli!_");

    try {
      const processingMsg = await message.sendReply("_🎬 Ses siyah ekrana sahip videoya dönüştürülüyor..._"
      );
      const audioFile = await message.reply_message.download();
      const outputPath = getTempPath(`black_${Date.now()}.mp4`);

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(audioFile)
          .input("color=c=black:s=320x240:r=30")
          .inputFormat("lavfi")
          .outputOptions([
            "-shortest",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "51",
            "-c:a",
            "copy",
            "-pix_fmt",
            "yuv420p",
          ])
          .format("mp4")
          .save(outputPath)
          .on("end", resolve)
          .on("error", reject);
      });

      const videoBuffer = fs.readFileSync(outputPath);
      await message.send(videoBuffer, "video");
      await message.edit(
        "_✅ Siyah video başarıyla oluşturuldu!_",
        message.jid,
        processingMsg.key
      );
      if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch (error) {
      console.error("Siyah video oluşturma hatası:", error);
      await message.send("_❌ Siyah video oluşturulamadı. Lütfen tekrar deneyin._");
    }
  }
);
Module(
  {
    pattern: "avmix",
    desc: Lang.AVMIX_DESC,
    use: "edit",
  },
  async (message, match) => {
    const avmixDir = getTempSubdir("avmix");
    let files = fs.readdirSync(avmixDir);
    if (
      (!message.reply_message && files.length < 2) ||
      (message.reply_message &&
        !message.reply_message.audio &&
        !message.reply_message.video)
    )
      return await message.send(Lang.AVMIX_NEED_FILES);
    if (message.reply_message.audio) {
      var savedFile = await message.reply_message.download();
      await fs.writeFileSync(
        getTempPath("avmix/audio.mp3"),
        fs.readFileSync(savedFile)
      );
      return await message.sendReply(Lang.AVMIX_AUDIO_ADDED);
    }
    if (message.reply_message.video) {
      var savedFile = await message.reply_message.download();
      await fs.writeFileSync(
        getTempPath("avmix/video.mp4"),
        fs.readFileSync(savedFile)
      );
      return await message.sendReply(Lang.AVMIX_VIDEO_ADDED);
    }
    if (files.length >= 2 || !message.reply_message) {
      let video = await avMix(
        getTempPath("avmix/video.mp4"),
        getTempPath("avmix/audio.mp3")
      );
      await message.sendReply(video, "video");
      await fs.unlinkSync(getTempPath("avmix/video.mp4"));
      await fs.unlinkSync(getTempPath("avmix/audio.mp3"));
      await fs.unlinkSync("./merged.mp4");
      return;
    }
  }
);
Module(
  {
    pattern: "vmix ?(.*)",
    desc: "İki videoyu birleştirir",
    use: "edit",
  },
  async (message, match) => {
    const vmixDir = getTempSubdir("vmix");
    let files = fs.readdirSync(vmixDir);
    if (
      (!message.reply_message && files.length < 2) ||
      (message.reply_message && !message.reply_message.video)
    )
      return await message.send("_🎬 Bana videolar verin_");
    if (message.reply_message.video && files.length == 1) {
      var savedFile = await message.reply_message.download();
      await fs.writeFileSync(
        getTempPath("vmix/video1.mp4"),
        fs.readFileSync(savedFile)
      );
      return await message.sendReply("*🎬 2. Video Eklendi. İşlemek için tekrar .vmix yazın!*"
      );
    }
    if (message.reply_message.video && files.length == 0) {
      var savedFile = await message.reply_message.download();
      await fs.writeFileSync(
        getTempPath("vmix/video2.mp4"),
        fs.readFileSync(savedFile)
      );
      return await message.sendReply("*🎬 1. Video Eklendi*");
    }
    async function merge(files, folder, filename) {
      return new Promise((resolve, reject) => {
        var cmd = ffmpeg({ priority: 20 })
          .fps(29.7)
          .on("error", function (err) {
            resolve();
          })
          .on("end", function () {
            resolve(fs.readFileSync(folder + "/" + filename));
          });

        for (var i = 0; i < files.length; i++) {
          cmd.input(files[i]);
        }

        cmd.mergeToFile(folder + "/" + filename, folder);
      });
    }
    if (files.length === 2) {
      await message.sendReply("*🎬 Videolar birleştiriliyor..*");
      await message.send(
        await merge(
          [getTempPath("vmix/video1.mp4"), getTempPath("vmix/video2.mp4")],
          getTempSubdir(""),
          "merged.mp4"
        ),
        "video"
      );
      await fs.unlinkSync(getTempPath("vmix/video1.mp4"));
      await fs.unlinkSync(getTempPath("vmix/video2.mp4"));
      return;
    }
  }
);
Module(
  {
    pattern: "slowmo",
    desc: "Videoyu pürüzsüz ağır çekime dönüştürür",
    use: "edit",
  },
  async (message, match) => {
    if (!message.reply_message || !message.reply_message.video)
      return await message.sendReply("*🎬 Bir videoyu yanıtla*");
    var savedFile = await message.reply_message.download();
    await message.sendReply("*✨ Hareket enterpolasyonu ve işleniyor..*");
    ffmpeg(savedFile)
      .videoFilters("minterpolate=fps=120")
      .videoFilters("setpts=4*PTS")
      .noAudio()
      .format("mp4")
      .save(getTempPath("slowmo.mp4"))
      .on("end", async () => {
        return await message.send(
          fs.readFileSync(getTempPath("slowmo.mp4")),
          "video"
        );
      });
  }
);
Module(
  {
    pattern: "circle",
    desc: "Çıkartma/fotoğrafı yuvarlak olarak kırpar",
    use: "edit",
  },
  async (message, match) => {
    await circle(message);
  }
);
Module(
  {
    pattern: "gif",
    desc: "Sesli olarak videoyu gif'e dönüştürür",
  },
  async (message, match) => {
    if (!message.reply_message || !message.reply_message.video)
      return await message.sendReply("*🎬 Bir videoyu yanıtla*");
    var savedFile = await message.reply_message.download();
    await message.sendReply("*⏳ İşleniyor..*");
    ffmpeg(savedFile)
      .fps(13)
      .videoBitrate(500)
      .save(getTempPath("agif.mp4"))
      .on("end", async () => {
        return await message.client.sendMessage(message.jid, {
          video: fs.readFileSync(getTempPath("agif.mp4")),
          gifPlayback: true,
        });
      });
  }
);
Module(
  {
    pattern: "interp ?(.*)",
    desc: "Videonun kare hızını (FPS) artırır",
    use: "edit",
  },
  async (message, match) => {
    if (!message.reply_message || !message.reply_message.video)
      return await message.sendReply("*🎬 Bir videoyu yanıtla*");
    if (match[1] <= 10)
      return await message.send("*⚠️ FPS değeri düşük*\n*Minimum = 10*");
    if (match[1] >= 500)
      return await message.send("*⚠️ FPS değeri yüksek*\n*Maksimum = 500*");
    var savedFile = await message.reply_message.download();
    await message.sendReply("*✨ Hareket enterpolasyonu ve işleniyor..*");
    ffmpeg(savedFile)
      .videoFilters(`minterpolate=fps=${match[1]}:mi_mode=mci:me_mode=bidir`)
      .format("mp4")
      .save(getTempPath("interp.mp4"))
      .on("end", async () => {
        return await message.send(
          fs.readFileSync(getTempPath("interp.mp4")),
          "video"
        );
      });
  }
);
Module(
  {
    pattern: "bul ?(.*)",
    fromMe: false,
    desc: "Yapay zeka aracılığıyla çalan şarkının adını bulur.",
    usage: "Ses dosyasına etiketleyerek .bul yazın.",
    use: "search",
  },
  async (message, match) => {
    if (!message.reply_message?.audio)
      return await message.sendReply("⚠️ Bir ses dosyasına etiketleyerek yazın!");

    var { seconds } = message.quoted.message[Object.keys(message.quoted.message)[0]];
    if (seconds > 60)
      return await message.sendReply(
        "⚠️ *Ses çok uzun! .trim komutunu kullanıp sesi 60 saniyeye düşürmenizi öneririm.*"
      );

    await message.send("🧐 Şarkıyı dinliyorum...");
    var audio = await message.reply_message.download("buffer");
    var data = await findMusic(audio);
    if (!data)
      return await message.sendReply(
        "🤯 Eşleşen bir sonuç bulunamadı! 👩🏻‍🔧 Dilerseniz daha iyi bir analiz için 15 saniyenin üzerinde kaydederek tekrar deneyin."
      );

    function getDuration(millis) {
      var minutes = Math.floor(millis / 60000);
      var seconds = ((millis % 60000) / 1000).toFixed(0);
      return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
    }

    const Message = {
      text: `🎶 Başlık: *${data.title}*
🎤 Sanatçılar: ${data.artists?.map((e) => e.name + " ")}
📆 Çıkış Tarihi: ${data.release_date}
⏱️ Süre: ${getDuration(data.duration_ms)}
💿 Albüm: ${data.album?.name}
🕺🏻 Tür: ${data.genres?.map((e) => e.name + " ")}
🏢 Yapım Şirketi: ${data.label}
🤔 Spotify: ${"spotify" in data.external_metadata ? "Mevcut" : "Mevcut Değil"}
▶️ YouTube: *${"youtube" in data.external_metadata ? "https://youtu.be/" + data.external_metadata.youtube.vid : "Mevcut Değil"}*\n
ℹ️ İndirmek isterseniz *".şarkı Şarkı İsmi"* şeklinde yazabilirsiniz.`,
    };

    await message.client.sendMessage(message.jid, Message);
  }
);
Module(
  {
    pattern: "rotate ?(.*)",
    desc: "Videoyu döndürür (sol/sağ)",
  },
  async (message, match) => {
    if (!match[1] || !message.reply_message || !message.reply_message.video)
      return await message.sendReply("*🎬 Bir videoyu yanıtla*\n*.rotate sol|sağ|ters*"
      );
    var file = await message.reply_message.download();
    var angle = "1";
    const dir = (match[1] || "").toLowerCase();
    if (dir === "left" || dir === "sol") angle = "2";
    if (dir === "flip" || dir === "ters") angle = "3";
    await message.send("_⏳ İşleniyor..._");
    await message.sendReply(
      fs.readFileSync(await rotate(file, angle)),
      "video"
    );
  }
);
Module(
  { pattern: "flip ?(.*)", desc: "Videoyu ters çevirir (flip)" },
  async (message, match) => {
    if (!message.reply_message || !message.reply_message.video)
      return await message.sendReply("*🎬 Bir videoyu yanıtla*");
    var file = await message.reply_message.download();
    var angle = "3";
    await message.send("_⏳ İşleniyor..._");
    await message.sendReply(
      fs.readFileSync(await rotate(file, angle)),
      "video"
    );
  }
);

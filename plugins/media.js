const { Module } = require("../main");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const { getTempPath, getTempSubdir } = require("../core/helpers");

const config = require("../config"),
  MODE = config.MODE;
const { getString } = require("./utils/lang");
const { avMix, circle, rotate, trim } = require("./utils");
const acrcloud = require("acrcloud");
const acr = new acrcloud({
  host: "identify-eu-west-1.acrcloud.com",
  access_key: config.ACR_A,
  access_secret: config.ACR_S,
});
var handler = config.HANDLERS !== "false" ? config.HANDLERS.split("")[0] : "";
async function findMusic(file) {
  return new Promise((resolve, reject) => {
    acr.identify(file).then((result) => {
      var data = result.metadata?.music[0];
      resolve(data);
    });
  });
}
const Lang = getString("media");
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
        "_Siyah video başarıyla oluşturuldu!_",
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
    pattern: "find ?(.*)",
    desc: "Yapay zeka (AI) kullanarak müzik adını bulur",
    usage: ".find bir müziğe yanıt verin",
    use: "search",
  },
  async (message, match) => {
    if (!message.reply_message?.audio)
      return await message.sendReply("_💬 Bir müziği yanıtlayın_");
    if (message.reply_message.duration > 60)
      return await message.send(
        "_Ses çok büyük! .trim komutuyla sesi 60 saniyenin altına kısaltın_"
      );
    var audio = await message.reply_message.download("buffer");
    var data = await findMusic(audio);
    if (!data) return await message.sendReply("_❌ Eşleşen sonuç bulunamadı!_");
    var buttons = [];
    function getDuration(millis) {
      var minutes = Math.floor(millis / 60000);
      var seconds = ((millis % 60000) / 1000).toFixed(0);
      return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
    }
    const Message = {
      text: `*Başlık:* ${data.title}\n
Sanatçılar: ${data.artists?.map((e) => e.name + " ")}\n
Yayın: ${data.release_date}\n
Süre: ${getDuration(data.duration_ms)}\n
Albüm: ${data.album?.name}\n
Türler: ${data.genres?.map((e) => e.name + " ")}\n
Etiket: ${data.label}\n
Spotify: ${"spotify" in data.external_metadata ? "Mevcut" : "Mevcut değil"}\n
YouTube: ${
        "youtube" in data.external_metadata
          ? "https://youtu.be/" + data.external_metadata.youtube.vid
          : "Mevcut değil"
      }\n`,
      //    footer: '🎼 Listen to full music on',
      //    buttons,
      //    headerType:1
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

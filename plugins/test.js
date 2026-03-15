function TimeCalculator(a) {
  a = Math.abs(a);
  let b = Math.floor(a / 31536e3),
    c = Math.floor((a % 31536e3) / 2628e3),
    d = Math.floor(((a % 31536e3) % 2628e3) / 86400),
    e = Math.floor((a % 86400) / 3600),
    f = Math.floor((a % 3600) / 60),
    g = Math.floor(a % 60);

  let parts = [];
  if (b > 0) parts.push(b + " yıl");
  if (c > 0) parts.push(c + " ay");
  if (d > 0) parts.push(d + " gün");
  if (e > 0) parts.push(e + " saat");
  if (f > 0) parts.push(f + " dakika");
  if (g > 0) parts.push(g + " saniye");

  return parts.length > 0 ? parts.join(", ") : "0 saniye";
}

const { Module } = require("../main");
const { exec } = require("child_process");
const { promisify } = require("util");
const execPromise = promisify(exec);
const fs = require("fs");
const path = require("path");

// ═══════════════════════════════════
// 📅 Yaş Hesaplayıcı
// ═══════════════════════════════════
Module(
  {
    pattern: "yaşhesap ?(.*)",
    desc: "Yaş hesaplayıcı",
    use: "utility",
  },
  async (m, match) => {
    if (!match) return await m.sendReply("_📅 Doğum tarihinizi girin_\n_Örnek: .yaşhesap 15/06/1990_");
    if (
      !/^(0?[1-9]|[12][0-9]|3[01])[\/\-](0?[1-9]|1[012])[\/\-]\d{4}$/.test(match)
    )
      return await m.sendReply("_⚠️ Tarih gg/aa/yyyy formatında olmalıdır_\n_Örnek: 15/06/1990_");

    var DOB = match;
    var parts = DOB.includes("-") ? DOB.split("-") : DOB.split("/");
    var actual = parts[1] + "/" + parts[0] + "/" + parts[2];
    var dob = new Date(actual).getTime();

    if (isNaN(dob)) return await m.sendReply("_⚠️ Geçersiz tarih!_");

    var today = new Date().getTime();

    if (dob > today) return await m.sendReply("_⚠️ Doğum tarihi gelecekte olamaz!_");

    var age = (today - dob) / 1000;
    return await m.sendReply("```🎂 Yaşınız: " + TimeCalculator(age) + "```");
  }
);

// ═══════════════════════════════════
// ⏳ Geri Sayım
// ═══════════════════════════════════
Module(
  {
    pattern: "gerisayım ?(.*)",
    desc: "Tarihe geri sayım yapar",
    use: "utility",
  },
  async (m, match) => {
    if (!match) return await m.sendReply("_📅 Bana gelecek bir tarih verin!_\n_Örnek: .gerisayım 01/01/2026_");
    if (
      !/^(0?[1-9]|[12][0-9]|3[01])[\/\-](0?[1-9]|1[012])[\/\-]\d{4}$/.test(match)
    )
      return await m.sendReply("_⚠️ Tarih gg/aa/yyyy formatında olmalıdır_\n_Örnek: 01/01/2026_");

    var DOB = match;
    var parts = DOB.includes("-") ? DOB.split("-") : DOB.split("/");
    var actual = parts[1] + "/" + parts[0] + "/" + parts[2];
    var dob = new Date(actual).getTime();

    if (isNaN(dob)) return await m.sendReply("_⚠️ Geçersiz tarih!_");

    var today = new Date().getTime();

    if (dob <= today) return await m.sendReply("_⚠️ Lütfen gelecekte bir tarih girin!_");

    var remaining = (dob - today) / 1000;
    return await m.sendReply("_⏳ " + TimeCalculator(remaining) + " kaldı_");
  }
);

// ═══════════════════════════════════
// 🏓 Ping Testi
// ═══════════════════════════════════
Module(
  {
    pattern: "ping",
    use: "utility",
    desc: "Ağ gecikmesini (ping) ölçer",
  },
  async (message) => {
    const start = process.hrtime();
    let sent_msg = await message.sendReply("*❮ ᴘɪɴɢ ᴛᴇsᴛɪ ❯*");
    const diff = process.hrtime(start);
    const ms = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);
    await message.edit(
      "*🚀 ᴛᴇᴘᴋɪ sᴜ̈ʀᴇsɪ: " + ms + " _ᴍs_*",
      message.jid,
      sent_msg.key
    );
  }
);

// ═══════════════════════════════════
// ⚡ Gerçek Speedtest (CLI Binary)
// ═══════════════════════════════════
Module(
  {
    pattern: "hıztesti",
    desc: "Ookla Speedtest ile gerçek hız testi",
    use: "utility",
  },
  async (message) => {
    const loading = await message.sendReply(
      "```⚡ Hız testi başlatılıyor...\n⏳ Lütfen bekleyin (30-60 saniye)```"
    );

    try {
      const speedtestPath = path.join(__dirname, "..", "speedtest");
      let speedtestBin = speedtestPath;

      // Speedtest binary kontrolü ve kurulumu
      if (!fs.existsSync(speedtestPath)) {
        await message.edit(
          "```📦 Speedtest CLI indiriliyor...\n⏳ İlk kullanım 1-2 dakika sürebilir```",
          message.jid,
          loading.key
        );

        try {
          // Platform tespiti
          const platform = process.platform;
          const arch = process.arch;

          let downloadUrl;
          if (platform === "linux" && arch === "x64") {
            downloadUrl = "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-x86_64.tgz";
          } else if (platform === "linux" && arch === "arm64") {
            downloadUrl = "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-aarch64.tgz";
          } else if (platform === "darwin") {
            downloadUrl = "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-macosx-universal.tgz";
          } else {
            throw new Error("Desteklenmeyen platform: " + platform + " " + arch);
          }

          // İndir ve çıkart
          await execPromise(`cd ${path.dirname(speedtestPath)} && curl -Ls ${downloadUrl} | tar xz && chmod +x speedtest`);

          if (!fs.existsSync(speedtestPath)) {
            throw new Error("Speedtest binary kurulamadı");
          }

        } catch (installError) {
          console.error("Speedtest install error:", installError);
          throw new Error("Speedtest kurulumu başarısız: " + installError.message);
        }
      }

      // Speedtest çalıştır
      await message.edit(
        "```⚡ Speedtest çalışıyor...\n📊 En yakın sunucu bulunuyor...```",
        message.jid,
        loading.key
      );

      const { stdout } = await execPromise(`${speedtestBin} --accept-license --accept-gdpr --format=json`, {
        timeout: 90000
      });

      const result = JSON.parse(stdout);

      // Sonuçları parse et
      const download = (result.download.bandwidth * 8 / 1000000).toFixed(2); // Mbps
      const upload = (result.upload.bandwidth * 8 / 1000000).toFixed(2); // Mbps
      const ping = result.ping.latency.toFixed(0);
      const jitter = result.ping.jitter.toFixed(2);
      const server = result.server.name;
      const serverLocation = `${result.server.location}, ${result.server.country}`;
      const isp = result.isp;
      const packetLoss = result.packetLoss ? result.packetLoss.toFixed(1) : "0";

      // Sistem bilgileri
      const os = require("os");
      const totalMem = (os.totalmem() / (1024 ** 3)).toFixed(2);
      const freeMem = (os.freemem() / (1024 ** 3)).toFixed(2);
      const usedMem = (totalMem - freeMem).toFixed(2);
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);

      // Hız kategorisi
      let speedRating = "";
      const dlSpeed = parseFloat(download);
      if (dlSpeed < 10) speedRating = "🐌 Yavaş";
      else if (dlSpeed < 50) speedRating = "🚶 Orta";
      else if (dlSpeed < 100) speedRating = "🏃 Hızlı";
      else if (dlSpeed < 500) speedRating = "🚀 Çok Hızlı";
      else speedRating = "⚡ Ultra Hızlı";

      let finalResult = `⚡ *SPEEDTEST SONUÇLARI*\n\n`;
      finalResult += `╭─「 Hız Testi 」\n`;
      finalResult += `│ 📥 *İndirme:* ${download} Mbps\n`;
      finalResult += `│ 📤 *Yükleme:* ${upload} Mbps\n`;
      finalResult += `│ 🏓 *Ping:* ${ping} ms\n`;
      finalResult += `│ 📊 *Jitter:* ${jitter} ms\n`;
      finalResult += `│ 📦 *Paket Kaybı:* ${packetLoss}%\n`;
      finalResult += `│ ⭐ *Değerlendirme:* ${speedRating}\n`;
      finalResult += `╰──────────────\n\n`;
      
      finalResult += `╭─「 Sunucu Bilgisi 」\n`;
      finalResult += `│ 🖥️ *Sunucu:* ${server}\n`;
      finalResult += `│ 📍 *Konum:* ${serverLocation}\n`;
      finalResult += `│ 📡 *ISP:* ${isp}\n`;
      finalResult += `╰──────────────\n\n`;
      
      finalResult += `╭─「 Sistem Durumu 」\n`;
      finalResult += `│ ⏰ *Çalışma:* ${hours}s ${minutes}d\n`;
      finalResult += `│ 💾 *RAM:* ${usedMem}/${totalMem} GB\n`;
      finalResult += `│ 🆓 *Boş:* ${freeMem} GB\n`;
      finalResult += `╰──────────────\n\n`;
      
      finalResult += `_✅ Test tamamlandı (Ookla Speedtest)_\n`;
      finalResult += `_🔗 Sonuç ID: ${result.result.id}_`;

      await message.edit(finalResult, message.jid, loading.key);

    } catch (error) {
      console.error("Speedtest error:", error);
      
      let errorMsg = `❌ *Hız testi başarısız!*\n\n`;
      
      if (error.message.includes("Desteklenmeyen platform")) {
        errorMsg += `_Platform desteklenmiyor: ${process.platform} ${process.arch}_`;
      } else if (error.killed) {
        errorMsg += `_Zaman aşımı! Test 90 saniyede tamamlanamadı._`;
      } else if (error.message.includes("EACCES")) {
        errorMsg += `_İzin hatası! Speedtest binary çalıştırılamadı._`;
      } else if (error.message.includes("kurulumu başarısız")) {
        errorMsg += `_Speedtest indirilemedi. İnternet bağlantınızı kontrol edin._`;
      } else {
        errorMsg += `_${error.message}_`;
      }
      
      errorMsg += `\n\n💡 *Alternatif:* .ping komutunu deneyin`;
      
      await message.edit(errorMsg, message.jid, loading.key);
    }
  }
);

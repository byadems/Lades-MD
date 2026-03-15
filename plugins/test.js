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
const axios = require("axios");

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
// ⚡ Hız Testi (HTTP Download Test)
// ═══════════════════════════════════
Module(
  {
    pattern: "hıztesti",
    desc: "İnternet hız testi yapar",
    use: "utility",
  },
  async (message) => {
    const loading = await message.sendReply(
      "```⚡ Hız testi başlatılıyor...\n⏳ Lütfen bekleyin```"
    );

    try {
      // Test dosyası (10MB)
      const testUrl = "https://speed.cloudflare.com/__down?bytes=10000000";
      
      // İndirme hızı testi
      await message.edit(
        "```⚡ Hız testi yapılıyor...\n📥 İndirme hızı ölçülüyor...```",
        message.jid,
        loading.key
      );

      const downloadStart = Date.now();
      const downloadResponse = await axios({
        method: 'get',
        url: testUrl,
        responseType: 'arraybuffer',
        timeout: 30000,
        onDownloadProgress: (progressEvent) => {
          // Progress takibi (isteğe bağlı)
        }
      });
      const downloadEnd = Date.now();
      const downloadTime = (downloadEnd - downloadStart) / 1000; // saniye
      const downloadBytes = downloadResponse.data.byteLength;
      const downloadSpeed = ((downloadBytes * 8) / downloadTime / 1000000).toFixed(2); // Mbps

      // Yükleme hızı testi
      await message.edit(
        "```⚡ Hız testi yapılıyor...\n📤 Yükleme hızı ölçülüyor...```",
        message.jid,
        loading.key
      );

      const uploadData = Buffer.alloc(1000000); // 1MB dummy data
      const uploadStart = Date.now();
      await axios.post("https://speed.cloudflare.com/__up", uploadData, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/octet-stream' }
      });
      const uploadEnd = Date.now();
      const uploadTime = (uploadEnd - uploadStart) / 1000;
      const uploadSpeed = ((uploadData.length * 8) / uploadTime / 1000000).toFixed(2); // Mbps

      // Ping testi
      const pingStart = Date.now();
      await axios.get("https://1.1.1.1", { timeout: 5000 });
      const pingEnd = Date.now();
      const ping = pingEnd - pingStart;

      // Sunucu bilgisi
      let serverInfo = "Cloudflare CDN";
      try {
        const geoResponse = await axios.get("https://ipapi.co/json/", { timeout: 5000 });
        serverInfo = `${geoResponse.data.city || 'Unknown'}, ${geoResponse.data.country_name || 'Unknown'}`;
      } catch (e) {
        // Geo bilgisi alınamazsa varsayılan kalır
      }

      // Sistem bilgileri
      const os = require("os");
      const totalMem = (os.totalmem() / (1024 ** 3)).toFixed(2);
      const freeMem = (os.freemem() / (1024 ** 3)).toFixed(2);
      const usedMem = (totalMem - freeMem).toFixed(2);

      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);

      let result = `⚡ *LADES HIZ TESTİ*\n\n`;
      result += `╭─「 İnternet Hızı 」\n`;
      result += `│ 📥 *İndirme:* ${downloadSpeed} Mbps\n`;
      result += `│ 📤 *Yükleme:* ${uploadSpeed} Mbps\n`;
      result += `│ 🏓 *Ping:* ${ping} ms\n`;
      result += `│ 🌐 *Konum:* ${serverInfo}\n`;
      result += `╰──────────────\n\n`;
      result += `╭─「 Sistem Durumu 」\n`;
      result += `│ ⏰ *Çalışma:* ${hours}s ${minutes}d\n`;
      result += `│ 💾 *RAM:* ${usedMem}/${totalMem} GB\n`;
      result += `│ 🆓 *Boş:* ${freeMem} GB\n`;
      result += `╰──────────────`;

      await message.edit(result, message.jid, loading.key);

    } catch (error) {
      console.error("Speedtest Error:", error);
      
      let errorMsg = `❌ *Hız testi başarısız!*\n\n`;
      
      if (error.code === 'ECONNABORTED') {
        errorMsg += `_Zaman aşımı! Bağlantınız çok yavaş._`;
      } else if (error.response?.status) {
        errorMsg += `_HTTP Hatası: ${error.response.status}_`;
      } else {
        errorMsg += `_${error.message}_`;
      }
      
      errorMsg += `\n\n💡 *Alternatif:* .ping komutunu kullanın`;
      
      await message.edit(errorMsg, message.jid, loading.key);
    }
  }
);

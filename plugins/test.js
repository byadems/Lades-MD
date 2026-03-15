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
    desc: "Çoklu API ile internet hız testi",
    use: "utility",
  },
  async (message) => {
    const loading = await message.sendReply(
      "```⚡ Hız testi başlatılıyor...\n🌐 3 farklı sunucu test ediliyor\n⏳ Lütfen bekleyin (30-45sn)```"
    );

    const results = {
      cloudflare: { name: "Cloudflare", download: 0, upload: 0, ping: 0, status: "⏳" },
      google: { name: "Google", download: 0, upload: 0, ping: 0, status: "⏳" },
      fast: { name: "Fast.com (Netflix)", download: 0, upload: 0, ping: 0, status: "⏳" }
    };

    // Test fonksiyonları
    const testCloudflare = async () => {
      try {
        // Ping
        const pingStart = Date.now();
        await axios.get("https://1.1.1.1", { timeout: 5000 });
        results.cloudflare.ping = Date.now() - pingStart;

        // Download (10MB)
        const dlStart = Date.now();
        const dlResponse = await axios.get("https://speed.cloudflare.com/__down?bytes=10000000", {
          responseType: 'arraybuffer',
          timeout: 30000
        });
        const dlTime = (Date.now() - dlStart) / 1000;
        const dlBytes = dlResponse.data.byteLength;
        results.cloudflare.download = ((dlBytes * 8) / dlTime / 1000000).toFixed(2);

        // Upload (1MB)
        const ulData = Buffer.alloc(1000000);
        const ulStart = Date.now();
        await axios.post("https://speed.cloudflare.com/__up", ulData, {
          timeout: 30000,
          headers: { 'Content-Type': 'application/octet-stream' }
        });
        const ulTime = (Date.now() - ulStart) / 1000;
        results.cloudflare.upload = ((ulData.length * 8) / ulTime / 1000000).toFixed(2);

        results.cloudflare.status = "✅";
      } catch (error) {
        results.cloudflare.status = "❌";
        console.error("Cloudflare test failed:", error.message);
      }
    };

    const testGoogle = async () => {
      try {
        // Ping
        const pingStart = Date.now();
        await axios.get("https://www.google.com", { timeout: 5000 });
        results.google.ping = Date.now() - pingStart;

        // Download (5MB test file)
        const dlStart = Date.now();
        const dlResponse = await axios.get("https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png", {
          responseType: 'arraybuffer',
          timeout: 20000,
          params: { dummy: Math.random() } // Cache bypass
        });
        
        // Daha büyük dosya için tekrar et
        const dlResponse2 = await axios.get("https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxKKTU1Kg.woff2", {
          responseType: 'arraybuffer',
          timeout: 20000
        });
        
        const dlTime = (Date.now() - dlStart) / 1000;
        const dlBytes = dlResponse.data.byteLength + dlResponse2.data.byteLength;
        results.google.download = ((dlBytes * 8) / dlTime / 1000000).toFixed(2);

        // Upload simülasyonu (POST request)
        const ulData = JSON.stringify({ test: "x".repeat(500000) });
        const ulStart = Date.now();
        await axios.post("https://httpbin.org/post", ulData, {
          timeout: 20000,
          headers: { 'Content-Type': 'application/json' }
        });
        const ulTime = (Date.now() - ulStart) / 1000;
        results.google.upload = ((ulData.length * 8) / ulTime / 1000000).toFixed(2);

        results.google.status = "✅";
      } catch (error) {
        results.google.status = "❌";
        console.error("Google test failed:", error.message);
      }
    };

    const testFast = async () => {
      try {
        // Ping
        const pingStart = Date.now();
        await axios.get("https://fast.com", { timeout: 5000 });
        results.fast.ping = Date.now() - pingStart;

        // Download (Github CDN - büyük dosya)
        const dlStart = Date.now();
        const dlResponse = await axios.get("https://github.com/git/git/archive/refs/heads/master.zip", {
          responseType: 'arraybuffer',
          timeout: 30000,
          maxContentLength: 5000000, // 5MB limit
          onDownloadProgress: (progressEvent) => {
            if (progressEvent.loaded > 3000000) { // 3MB'dan sonra kes
              throw new axios.Cancel('Speed test complete');
            }
          }
        }).catch(err => {
          if (axios.isCancel(err)) {
            return { data: Buffer.alloc(3000000) };
          }
          throw err;
        });
        
        const dlTime = (Date.now() - dlStart) / 1000;
        const dlBytes = dlResponse.data.byteLength;
        results.fast.download = ((dlBytes * 8) / dlTime / 1000000).toFixed(2);

        // Upload
        const ulData = Buffer.alloc(800000); // 800KB
        const ulStart = Date.now();
        await axios.post("https://httpbin.org/post", ulData, {
          timeout: 20000,
          headers: { 'Content-Type': 'application/octet-stream' }
        });
        const ulTime = (Date.now() - ulStart) / 1000;
        results.fast.upload = ((ulData.length * 8) / ulTime / 1000000).toFixed(2);

        results.fast.status = "✅";
      } catch (error) {
        results.fast.status = "❌";
        console.error("Fast test failed:", error.message);
      }
    };

    // Progress updates
    try {
      // Test 1/3
      await message.edit(
        "```⚡ Hız Testi\n\n[1/3] 🔵 Cloudflare test ediliyor...\n[2/3] ⚪ Google bekleniyor\n[3/3] ⚪ Fast.com bekleniyor```",
        message.jid,
        loading.key
      );
      await testCloudflare();

      // Test 2/3
      await message.edit(
        "```⚡ Hız Testi\n\n[1/3] " + results.cloudflare.status + " Cloudflare tamamlandı\n[2/3] 🔵 Google test ediliyor...\n[3/3] ⚪ Fast.com bekleniyor```",
        message.jid,
        loading.key
      );
      await testGoogle();

      // Test 3/3
      await message.edit(
        "```⚡ Hız Testi\n\n[1/3] " + results.cloudflare.status + " Cloudflare tamamlandı\n[2/3] " + results.google.status + " Google tamamlandı\n[3/3] 🔵 Fast.com test ediliyor...```",
        message.jid,
        loading.key
      );
      await testFast();

      // Ortalama hesapla
      const successfulTests = Object.values(results).filter(r => r.status === "✅");
      
      let avgDownload = 0, avgUpload = 0, avgPing = 0;
      if (successfulTests.length > 0) {
        avgDownload = (successfulTests.reduce((sum, r) => sum + parseFloat(r.download), 0) / successfulTests.length).toFixed(2);
        avgUpload = (successfulTests.reduce((sum, r) => sum + parseFloat(r.upload), 0) / successfulTests.length).toFixed(2);
        avgPing = Math.round(successfulTests.reduce((sum, r) => sum + r.ping, 0) / successfulTests.length);
      }

      // Konum bilgisi
      let location = "Bilinmiyor";
      try {
        const geoResponse = await axios.get("https://ipapi.co/json/", { timeout: 5000 });
        location = `${geoResponse.data.city || 'Unknown'}, ${geoResponse.data.country_name || 'Unknown'}`;
      } catch (e) {}

      // Sistem bilgileri
      const os = require("os");
      const totalMem = (os.totalmem() / (1024 ** 3)).toFixed(2);
      const freeMem = (os.freemem() / (1024 ** 3)).toFixed(2);
      const usedMem = (totalMem - freeMem).toFixed(2);
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);

      // Sonuç mesajı
      let result = `⚡ *LADES HIZ TESTİ*\n\n`;
      result += `╭─「 Ortalama Hız 」\n`;
      result += `│ 📥 *İndirme:* ${avgDownload} Mbps\n`;
      result += `│ 📤 *Yükleme:* ${avgUpload} Mbps\n`;
      result += `│ 🏓 *Ping:* ${avgPing} ms\n`;
      result += `│ 🌐 *Konum:* ${location}\n`;
      result += `╰──────────────\n\n`;
      
      result += `╭─「 Detaylı Sonuçlar 」\n`;
      result += `│\n`;
      result += `│ ${results.cloudflare.status} *Cloudflare*\n`;
      result += `│ ├ DL: ${results.cloudflare.download} Mbps\n`;
      result += `│ ├ UP: ${results.cloudflare.upload} Mbps\n`;
      result += `│ └ Ping: ${results.cloudflare.ping} ms\n`;
      result += `│\n`;
      result += `│ ${results.google.status} *Google*\n`;
      result += `│ ├ DL: ${results.google.download} Mbps\n`;
      result += `│ ├ UP: ${results.google.upload} Mbps\n`;
      result += `│ └ Ping: ${results.google.ping} ms\n`;
      result += `│\n`;
      result += `│ ${results.fast.status} *Fast.com*\n`;
      result += `│ ├ DL: ${results.fast.download} Mbps\n`;
      result += `│ ├ UP: ${results.fast.upload} Mbps\n`;
      result += `│ └ Ping: ${results.fast.ping} ms\n`;
      result += `╰──────────────\n\n`;
      
      result += `╭─「 Sistem 」\n`;
      result += `│ ⏰ *Çalışma:* ${hours}s ${minutes}d\n`;
      result += `│ 💾 *RAM:* ${usedMem}/${totalMem} GB\n`;
      result += `│ 🆓 *Boş:* ${freeMem} GB\n`;
      result += `╰──────────────\n\n`;
      result += `_✅ ${successfulTests.length}/3 test başarılı_`;

      await message.edit(result, message.jid, loading.key);

    } catch (error) {
      console.error("Speed test error:", error);
      await message.edit(
        `❌ *Hız testi başarısız!*\n\n_${error.message}_\n\n💡 *Alternatif:* .ping`,
        message.jid,
        loading.key
      );
    }
  }
);

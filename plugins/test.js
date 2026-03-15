function TimeCalculator(a) {
  let b = Math.floor(a / 31536e3),
    c = Math.floor((a % 31536e3) / 2628e3),
    d = Math.floor(((a % 31536e3) % 2628e3) / 86400),
    e = Math.floor((a % 86400) / 3600),
    f = Math.floor((a % 3600) / 60),
    g = Math.floor(a % 60);
  return (
    (b > 0 ? b + (1 === b ? " yıl, " : " yıl, ") : "") +
    (c > 0 ? c + (1 === c ? " ay, " : " ay, ") : "") +
    (d > 0 ? d + (1 === d ? " gün, " : " gün, ") : "") +
    (e > 0 ? e + (1 === e ? " saat, " : " saat, ") : "") +
    (f > 0 ? f + (1 === f ? " dakika " : " dakika, ") : "") +
    (g > 0 ? g + (1 === g ? " saniye" : " saniye ") : "")
  );
}
const { Module } = require("../main");
Module(
  {
    pattern: "yaşhesap ?(.*)",
    desc: "Yaş hesaplayıcı",
    use: "utility",
  },
  async (m, t) => {
    if (!t[1]) return await m.sendReply("_📅 Doğum tarihinizi girin_");
    if (
      !/^(0?[1-9]|[12][0-9]|3[01])[\/\-](0?[1-9]|1[012])[\/\-]\d{4}$/.test(t[1])
    )
      return await m.sendReply("_⚠️ Tarih gg/aa/yy formatında olmalıdır_");
    var DOB = t[1];
    var actual = DOB.includes("-")
      ? DOB.split("-")[1] + "-" + DOB.split("-")[0] + "-" + DOB.split("-")[2]
      : DOB.split("/")[1] + "-" + DOB.split("/")[0] + "-" + DOB.split("/")[2];
    var dob = new Date(actual).getTime();
    var today = new Date().getTime();
    var age = (today - dob) / 1000;
    return await m.sendReply("```" + TimeCalculator(age) + "```");
  }
);
Module({
    pattern: "gerisayım ?(.*)",
    desc: "Tarihi Sayar",
    use: "utility",
  },
  async (m, t) => {
    if (!t[1]) return await m.sendReply("_📅 Bana gelecek bir tarih verin!_");
    if (
      !/^(0?[1-9]|[12][0-9]|3[01])[\/\-](0?[1-9]|1[012])[\/\-]\d{4}$/.test(t[1])
    )
      return await m.sendReply("_⚠️ Tarih gg/aa/yy formatında olmalıdır_");
    var DOB = t[1];
    var actual = DOB.includes("-")
      ? DOB.split("-")[1] + "-" + DOB.split("-")[0] + "-" + DOB.split("-")[2]
      : DOB.split("/")[1] + "-" + DOB.split("/")[0] + "-" + DOB.split("/")[2];
    var dob = new Date(actual).getTime();
    var today = new Date().getTime();
    var age = (dob - today) / 1000;
    return await m.sendReply("_" + TimeCalculator(age) + " kalan_");
  }
);

Module({
    pattern: "ping",
    use: "utility",
    desc: "Ağ gecikmesini (ping) ölçer",
  },
  async (message, match) => {
    const start = process.hrtime();
    let sent_msg = await message.sendReply("*❮ ᴘɪɴɢ ᴛᴇsᴛɪ ❯*");
    const diff = process.hrtime(start);
    const ms = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);
    await message.edit("*🚀 ᴛᴇᴘᴋɪ sᴜ̈ʀᴇsɪ: " + ms + " _ᴍs_*", message.jid, sent_msg.key);
  }
);

Module({
    pattern: "hıztesti",
    use: "utility",
    desc: "Speedtest.net ile gerçek indirme/yükleme hızını ölçer",
  },
  async (message, match) => {
    let sent_msg = await message.sendReply("_⏳ Speedtest.net sunucuları aranıyor..._");

    try {
      const configRes = await fetch("https://www.speedtest.net/speedtest-config.php", {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const configText = await configRes.text();
      const ipMatch  = configText.match(/ip="([^"]+)"/);
      const latMatch = configText.match(/lat="([^"]+)"/);
      const lonMatch = configText.match(/lon="([^"]+)"/);
      const ispMatch = configText.match(/isp="([^"]+)"/);
      const clientIp  = ipMatch  ? ipMatch[1]  : "N/A";
      const clientLat = latMatch ? parseFloat(latMatch[1]) : 0;
      const clientLon = lonMatch ? parseFloat(lonMatch[1]) : 0;
      const clientIsp = ispMatch ? ispMatch[1] : "N/A";

      const serverRes  = await fetch("https://www.speedtest.net/api/js/servers?engine=js&limit=10", {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const servers = await serverRes.json();

      function haversine(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }
      const server = servers
        .map((s) => ({ ...s, dist: haversine(clientLat, clientLon, parseFloat(s.lat), parseFloat(s.lon)) }))
        .sort((a, b) => a.dist - b.dist)[0];

      await message.edit(
        `_📡 Sunucu: ${server.sponsor} (${server.name}) — bağlanılıyor..._`,
        message.jid, sent_msg.key
      );

      const pingUrl = `https://${server.host}/speedtest/latency.txt`;
      const pings = [];
      for (let i = 0; i < 5; i++) {
        const t0 = Date.now();
        await fetch(pingUrl, { cache: "no-store" });
        pings.push(Date.now() - t0);
      }
      const ping   = Math.min(...pings);
      const jitter = Math.round(Math.max(...pings) - Math.min(...pings));

      const dlSizes  = [350, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000];
      const dlUrl    = `https://${server.host}/speedtest/random${dlSizes[dlSizes.length - 1]}x${dlSizes[dlSizes.length - 1]}.jpg`;
      const dlStart  = Date.now();
      const dlResults = await Promise.all([
        fetch(`${dlUrl}?x=${Math.random()}`).then((r) => r.arrayBuffer()),
        fetch(`${dlUrl}?x=${Math.random()}`).then((r) => r.arrayBuffer()),
        fetch(`${dlUrl}?x=${Math.random()}`).then((r) => r.arrayBuffer()),
        fetch(`${dlUrl}?x=${Math.random()}`).then((r) => r.arrayBuffer()),
      ]);
      const dlTime  = (Date.now() - dlStart) / 1000;
      const dlBytes = dlResults.reduce((s, b) => s + b.byteLength, 0);
      const dlMbps  = ((dlBytes * 8) / dlTime / 1_000_000).toFixed(2);

      const ulChunk = new Uint8Array(1 * 1024 * 1024);
      const ulStart = Date.now();
      await Promise.all([
        fetch(`https://${server.host}/speedtest/upload.php`, { method: "POST", body: ulChunk }),
        fetch(`https://${server.host}/speedtest/upload.php`, { method: "POST", body: ulChunk }),
        fetch(`https://${server.host}/speedtest/upload.php`, { method: "POST", body: ulChunk }),
        fetch(`https://${server.host}/speedtest/upload.php`, { method: "POST", body: ulChunk }),
      ]);
      const ulTime  = (Date.now() - ulStart) / 1000;
      const ulBytes = ulChunk.byteLength * 4;
      const ulMbps  = ((ulBytes * 8) / ulTime / 1_000_000).toFixed(2);

      const text =
        `*❮ sᴘᴇᴇᴅᴛᴇsᴛ.ɴᴇᴛ ❯*\n\n` +
        `*📥 İndirme:* \`${dlMbps} Mbps\`\n` +
        `*📤 Yükleme:* \`${ulMbps} Mbps\`\n` +
        `*🏓 Ping:* \`${ping} ms\`\n` +
        `*📳 Jitter:* \`${jitter} ms\`\n\n` +
        `*📡 Sunucu:* ${server.sponsor} — ${server.name}\n` +
        `*🌐 ISP:* ${clientIsp}\n` +
        `*🔌 IP:* \`${clientIp}\``;

      await message.edit(text, message.jid, sent_msg.key);

    } catch (error) {
      console.error("Speedtest error:", error);
      await message.edit(
        "_❌ Hız testi başarısız oldu!_\n_Hata: " + (error.message || "Bilinmeyen hata") + "_",
        message.jid,
        sent_msg.key
      );
    }
  }
);

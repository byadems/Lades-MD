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
Module(
  {
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
const FastSpeedtest = require("fast-speedtest-api");

Module(
  {
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

Module(
  {
    pattern: "hıztesti",
    use: "utility",
    desc: "Sunucu ağ hızını (Fast.com) ölçer",
  },
  async (message, match) => {
    let sent_msg = await message.sendReply("_🚀 Hız testi başlatılıyor... Lütfen bekleyin._");
    
    try {
      const speedtest = new FastSpeedtest({
        token: "YXNkZmFzZGZhc2RmYXNkZmFzZGY=", // Public Fast.com token
        verbose: false,
        timeout: 10000,
        https: true,
        urlCount: 5,
        bufferSize: 8,
        unit: FastSpeedtest.UNITS.Mbps
      });

      const speed = await speedtest.getSpeed();

      const text = `*❮ ꜰᴀsᴛ.ᴄᴏᴍ sᴘᴇᴇᴅᴛᴇsᴛ ❯*

*📥 İndirme Hızı:* \`${speed.toFixed(2)} Mbps\`

_Not: Fast.com (Netflix) altyapısı kullanılmıştır._`;

      await message.edit(text, message.jid, sent_msg.key);
    } catch (error) {
      console.error("Speedtest error:", error);
      await message.edit("_❌ Hız testi başarısız oldu!_\n_Hata: " + (error.message || "Bilinmeyen hata") + "_", message.jid, sent_msg.key);
    }
  }
);

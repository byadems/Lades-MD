const { Module } = require("../main");
const { scheduledMessages } = require("./utils/db/schedulers");
const moment = require("moment");
let config = require("../config");

function isValidJID(text) {
  return (
    text.endsWith("@g.us") ||
    text.endsWith("@s.whatsapp.net") ||
    text.endsWith("@lid")
  );
}
function parseTime(timeStr) {
  const now = moment();
  const durationMatch =
    timeStr.match(/^(\d+)([dhms])$/i) ||
    timeStr.match(/^(\d+)h(\d+)m$/i) ||
    timeStr.match(/^(\d+)m(\d+)s$/i);
  if (durationMatch) {
    let duration = moment.duration();
    if (timeStr.includes("h") && timeStr.includes("m")) {
      const [, hours, minutes] = timeStr.match(/^(\d+)h(\d+)m$/i);
      duration.add(parseInt(hours), "hours").add(parseInt(minutes), "minutes");
    } else if (timeStr.includes("m") && timeStr.includes("s")) {
      const [, minutes, seconds] = timeStr.match(/^(\d+)m(\d+)s$/i);
      duration
        .add(parseInt(minutes), "minutes")
        .add(parseInt(seconds), "seconds");
    } else {
      const [, value, unit] = durationMatch;
      const unitMap = { d: "days", h: "hours", m: "minutes", s: "seconds" };
      duration.add(parseInt(value), unitMap[unit.toLowerCase()]);
    }
    return now.add(duration).subtract(1, "minute").toDate();
  }
  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})(\s*[ap]m)?$/i);
  if (timeMatch) {
    let [, hours, minutes, period] = timeMatch;
    hours = parseInt(hours);
    minutes = parseInt(minutes);
    if (period) {
      period = period.trim().toLowerCase();
      if (period === "pm" && hours !== 12) hours += 12;
      if (period === "am" && hours === 12) hours = 0;
    }
    const targetTime = moment().hours(hours).minutes(minutes).seconds(0);
    if (targetTime.isBefore(now)) {
      targetTime.add(1, "day");
    }
    return targetTime.subtract(1, "minute").toDate();
  }
  const dateTime = moment(timeStr, [
    "YYYY-MM-DD HH:mm",
    "DD/MM/YYYY HH:mm",
    "MM/DD/YYYY HH:mm",
  ]);
  if (dateTime.isValid()) {
    return dateTime.subtract(1, "minute").toDate();
  }
  return null;
}
async function createMessageObject(replyMessage) {
  let messageObj = {};
  if (replyMessage.text) {
    messageObj.text = replyMessage.text;
  }
  if (replyMessage.image) {
    const buffer = await replyMessage.download("buffer");
    messageObj.image = buffer.toString("base64");
    if (replyMessage.caption) messageObj.caption = replyMessage.caption;
    messageObj._mediaType = "image";
  }
  if (replyMessage.video) {
    const buffer = await replyMessage.download("buffer");
    messageObj.video = buffer.toString("base64");
    if (replyMessage.caption) messageObj.caption = replyMessage.caption;
    messageObj._mediaType = "video";
    if (replyMessage.gifPlayback) messageObj.gifPlayback = true;
  }
  if (replyMessage.audio) {
    const buffer = await replyMessage.download("buffer");
    messageObj.audio = buffer.toString("base64");
    messageObj.mimetype = replyMessage.mimetype || "audio/mp4";
    messageObj._mediaType = "audio";
    if (replyMessage.ptt) messageObj.ptt = true;
  }
  if (replyMessage.document) {
    const buffer = await replyMessage.download("buffer");
    messageObj.document = buffer.toString("base64");
    messageObj.fileName = replyMessage.fileName || "document";
    messageObj.mimetype = replyMessage.mimetype;
    messageObj._mediaType = "document";
  }
  if (replyMessage.sticker) {
    const buffer = await replyMessage.download("buffer");
    messageObj.sticker = buffer.toString("base64");
    messageObj._mediaType = "sticker";
  }
  return JSON.stringify(messageObj);
}
Module(
  {
    pattern: "schedule ?(.*)",
    use: "utility",
    desc: "İleri bir tarih için mesaj planlar. Mesajı yanıtlayarak kullanın.",
  },
  async (m, match) => {
    if (match[1] === "d") return;
    if (!m.reply_message) {
      return await m.sendReply("_💬 Zamanlamak istediğiniz mesajı yanıtlayın_\n\n*📋 Kullanım:*\n• schedule <jid> <zaman>\n• schedule <zaman> <jid>"
      );
    }
    if (!match[1]) {
      return await m.sendReply("_💬 Lütfen JID ve zaman sağlayın_\n\n*📋 Örnek:*\n• schedule 905554443322@s.whatsapp.net 2h"
      );
    }
    const args = match[1].trim().split(/\s+/);
    if (args.length < 2) {
      return await m.sendReply("_⚠️ Lütfen hem JID hem de zamanı belirtin_");
    }
    let jid, timeStr;
    if (isValidJID(args[0])) {
      jid = args[0];
      timeStr = args.slice(1).join(" ");
    } else if (isValidJID(args[args.length - 1])) {
      jid = args[args.length - 1];
      timeStr = args.slice(0, -1).join(" ");
    } else {
      const jidArg = args.find((arg) => isValidJID(arg));
      if (jidArg) {
        jid = jidArg;
        timeStr = args.filter((arg) => arg !== jidArg).join(" ");
      } else {
        return await m.sendReply("_❌ Geçersiz JID formatı. JID, @g.us, @s.whatsapp.net veya @lid ile bitmelidir_"
        );
      }
    }
    const scheduleTime = parseTime(timeStr);
    if (!scheduleTime) {
      return await m.sendReply("_⚠️ Geçersiz zaman formatı_\n\n*📋 Desteklenen formatlar:*\n• 2h30m, 1g, 30m, 5s\n• 14:30, 14:45\n• YYYY-AA-GG SS:dd"
      );
    }
    const originalTime = moment(scheduleTime).add(1, "minute").toDate();
    if (originalTime <= new Date()) {
      return await m.sendReply("_⏰ Zamanlama zamanı gelecekte olmalıdır_");
    }
    const minTime = moment().add(2, "minutes").toDate();
    if (originalTime < minTime) {
      return await m.sendReply("_⚠️ Minimum zamanlama süresi 2 dakikadır. Lütfen şu andan itibaren en az 2 dakika sonraya ayarlayın._"
      );
    }
    try {
      const messageData = await createMessageObject(m.reply_message);
      await scheduledMessages.add(jid, messageData, scheduleTime);
      const timeFromNow = moment(scheduleTime).add(1, "minute").fromNow();
      const formattedTime = moment(scheduleTime)
        .add(1, "minute")
        .format("DD/MM/YYYY HH:mm");
      await m.sendReply(
        `✅ *Mesaj başarıyla zamanlandı!*\n\n📅 *Zaman:* ${formattedTime}\n⏰ *Şu andan itibaren:* ${timeFromNow}\n📱 *Hedef:* ${jid}`
      );
    } catch (error) {
      console.error("Schedule error:", error);
      await m.sendReply("_❌ Mesaj zamanlanamadı. Lütfen tekrar deneyin._");
    }
  }
);
Module(
  {
    pattern: "scheduled ?(.*)",
    use: "utility",
    desc: "Bekleyen tüm planlanmış mesajları listeler",
  },
  async (m, match) => {
    try {
      const pending = await scheduledMessages.getAllPending();
      if (pending.length === 0) {
        return await m.sendReply("📭 _Bekleyen zamanlanmış mesaj yok_");
      }
      let response = "📋 *Zamanlanmış Mesajlar*\n\n";
      pending.sort(
        (a, b) => a.scheduleTime.getTime() - b.scheduleTime.getTime()
      );
      pending.forEach((msg, index) => {
        const timeFromNow = moment(msg.scheduleTime).add(1, "minute").fromNow();
        const formattedTime = moment(msg.scheduleTime)
          .add(1, "minute")
          .format("DD/MM/YYYY HH:mm");
        const preview = JSON.parse(msg.message);
        let content = preview.text || preview.caption || "Medya mesajı";
        if (content.length > 30) content = content.substring(0, 30) + "...";
        response += `${index + 1}. *ID:* ${msg.id}\n`;
        response += `   *Alıcı:* ${msg.jid}\n`;
        response += `   *Zaman:* ${formattedTime}\n`;
        response += `   *Kalan:* ${timeFromNow}\n`;
        response += `   *İçerik:* ${content}\n\n`;
      });
      response += '_Zamanlanmış mesajı iptal etmek için "cancel <id>" kullanın_';
      await m.sendReply(response);
    } catch (error) {
      console.error("List scheduled error:", error);
      await m.sendReply("_❌ Zamanlanmış mesajlar alınamadı_");
    }
  }
);
Module(
  {
    pattern: "cancel ?(.*)",
    use: "utility",
    desc: "ID'ye göre zamanlanmış bir mesajı iptal eder",
  },
  async (m, match) => {
    if (!match[1]) {
      return await m.sendReply("_💬 İptal edilecek mesajın ID'sini belirtin_\n\n*Kullanım:* cancel <id>"
      );
    }
    const messageId = parseInt(match[1].trim());
    if (isNaN(messageId)) {
      return await m.sendReply("_⚠️ Lütfen geçerli bir mesaj ID'si girin_");
    }
    try {
      const success = await scheduledMessages.delete(messageId);
      if (success) {
        await m.sendReply(
          `✅ *Zamanlanmış mesaj ${messageId} başarıyla iptal edildi*`
        );
      } else {
        await m.sendReply("❌ *Mesaj bulunamadı veya zaten gönderildi*");
      }
    } catch (error) {
      console.error("Cancel scheduled error:", error);
      await m.sendReply("_❌ Zamanlanmış mesaj iptal edilemedi_");
    }
  }
);

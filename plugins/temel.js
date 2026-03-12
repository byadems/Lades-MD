const fs = require("fs");
const axios = require('axios');
const {
    isAdmin,isNumeric,getWarn,setWarn,resetWarn,decrementWarn,getWarnCount,getAllWarns,mentionjid,getJson,gtts,gis,aiTTS
} = require('./utils');
const { getNumericId } = require('./utils/lid-helper');
const { loadBaileys } = require("../core/helpers");
const fileType = require('file-type');
const {
  ADMIN_ACCESS,MODE,HANDLERS,AUDIO_DATA,BOT_INFO,SUDO,WARN,ANTILINK_WARN,ANTIWORD_WARN,settingsMenu,
} = require('../config');
const config = require('../config');
const {Module} = require('../main')
const cheerio = require('cheerio');
const path = require('path');
const https = require('https');
const moment = require("moment");
const {
    getString
} = require('./utils/lang');
const Lang = getString('group');
const {delay} = require('baileys');
const { callGenerativeAI } = require("./utils/misc");
const { scheduledMessages } = require("./utils/db/schedulers");
const {
  fetchFromStore,
  getTopUsers,
  getGlobalTopUsers,
} = require("../core/store");
const {
  downloadVideo,
  downloadAudio,
  searchYoutube,
  getVideoInfo,
  convertM4aToMp3,
} = require("./utils/yt");
const ffmpeg = require('fluent-ffmpeg');
const acrcloud = require("acrcloud");
const acr = new acrcloud({
  host: "identify-eu-west-1.acrcloud.com",
  access_key: config.ACR_A,
  access_secret: config.ACR_S
});
const sudoUsers = (SUDO || '').split(',');
const handler = HANDLERS !== 'false' ? HANDLERS.split("")[0] : "";

async function findMusic(file){
return new Promise((resolve,reject)=>{
acr.identify(file).then(result => {
  var data = result.metadata?.music[0];
  resolve(data);
});
});
}

let {containsDisallowedWords} = require('./manage');
const warnLimit = parseInt(WARN || 3);

Module({ on: 'text', fromMe: false }, async (k) => {
    const isActivated = !process.env.AUTO_DEL
        ? true
        : process.env.AUTO_DEL.split(',').includes(k.jid);
    if (!isActivated) return;
    if (!/\bhttps?:\/\/\S+/gi.test(k.message)) return;
    const links = k.message.match(/\bhttps?:\/\/\S+/gi);
    if (!links) return;

    let currentGroupCode = null;
    if (k.isGroup) {
        try {
            currentGroupCode = await k.client.groupInviteCode(k.jid);
        } catch (_) {}
    }

    for (const link of links) {
        const match = link.match(/^(https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]{22})(\?.*)?$/i);
        if (!match) continue;
        const isBotAdmin = await isAdmin(k);
        const isSenderAdmin = await isAdmin(k, k.sender);
        if (!isBotAdmin || isSenderAdmin) return;
        if (currentGroupCode && match[2] === currentGroupCode) continue;
        const groupMetadata = await k.client.groupMetadata(k.jid);
        const senderNumber = k.sender.split('@')[0];
        const infoMessage =
            `Saygıdeğer yöneticilerim; *${groupMetadata.subject}* grubunda ` +
            `şu şahsı *${senderNumber}* suçüstü yakaladım. 😈\n\n🔗 ${k.message}`;
        await k.client.sendMessage("120363258254647790@g.us", { text: infoMessage });
        await k.send('🚨 *Hey! Grup reklamı yapmamalısın.* 🤐');
        try {
            await k.client.sendMessage(k.jid, { delete: k.data.key });
        } catch {}
        await k.client.groupParticipantsUpdate(k.jid, [k.sender], "remove");
        return;
    }
});

Module({
    pattern: "üyetemizle ?(.*)",
    fromMe: false,
    desc: "Belirtilen süre boyunca mesaj atmayan üyeleri listeler veya çıkarır.",
    usage:
      ".üyetemizle 30 gün | .üyetemizle 2 hafta | .üyetemizle 3 ay | .üyetemizle 1 yıl\n\n" +
      "Komutun sonuna 'çıkar' ekleyerek üyeleri gruptan atabilirsiniz.",
    use: "group",
  },
  async (message, match) => {
    try {
      if (!message.isGroup) {
        return await message.sendReply("❌ _Bu komut sadece grup sohbetlerinde kullanılabilir!_");
      }
      const admin = await isAdmin(message, message.sender);
      if (!admin) {
        return await message.sendReply("❌ _Bu komut yalnızca grup yöneticileri tarafından kullanılabilir!_");
      }
      if (!match[1]) {
        return await message.sendReply(
          "❗  *Lütfen şu şekillerde kullanınız:*\n" +
            ".üyetemizle 30 gün\n" +
            ".üyetemizle 2 hafta\n" +
            ".üyetemizle 3 ay\n" +
            ".üyetemizle 1 yıl\n" +
            "🧹 _(Üyeleri çıkarmak için komut sonuna *çıkar* ekleyebilirsiniz.)_"
        );
      }
      const args = match[1].trim().split(/\s+/);
      const durationStr = args[0];
      const durationUnit = args[1]?.toLowerCase();
      const shouldKick = args.includes("çıkar");
      const durationMs = parseDuration(durationStr, durationUnit);
      if (!durationMs) {
        return await message.sendReply(
          "❌ _Geçersiz süre formatı!_\n" +
            "Örnekler:\n" +
            ".üyetemizle 30 gün\n" +
            ".üyetemizle 2 hafta\n" +
            ".üyetemizle 3 ay\n" +
            ".üyetemizle 1 yıl çıkar"
        );
      }
      const cutoffDate = new Date(Date.now() - durationMs);
      const groupMetadata = await message.client.groupMetadata(message.jid);
      const participants = groupMetadata.participants.map((p) => p.id);
      const admins = groupMetadata.participants
        .filter((p) => p.admin !== null)
        .map((p) => p.id);
      const userStats = await fetchFromStore(message.jid);
      let oldestMessageDate = null;
      if (userStats.length > 0) {
        const oldest = userStats.reduce((oldest, current) => {
          const currDate = new Date(current.lastMessageAt || current.createdAt);
          const oldDate = new Date(oldest.lastMessageAt || oldest.createdAt);
          return currDate < oldDate ? current : oldest;
        });
        oldestMessageDate = new Date(oldest.lastMessageAt || oldest.createdAt);
      }
      const dataWarning = oldestMessageDate && cutoffDate < oldestMessageDate;
      let inactiveMembers = [];
      for (const user of participants) {
        if (admins.includes(user)) continue;
        const userStat = userStats.find((stat) => stat.userJid === user);
        if (!userStat || !userStat.lastMessageAt) {
          inactiveMembers.push({
            jid: user,
            lastMessage: "*Hiç mesaj yok*",
            totalMessages: userStat?.totalMessages || 0,
          });
          continue;
        }
        const lastMsgDate = new Date(userStat.lastMessageAt);
        if (lastMsgDate < cutoffDate) {
          inactiveMembers.push({
            jid: user,
            lastMessage: timeSince(userStat.lastMessageAt, "tr"),
            totalMessages: userStat.totalMessages,
          });
        }
      }
        if (shouldKick) {
          const botIsAdmin = await isAdmin(message);
        if (!botIsAdmin) {
          return await message.sendReply("⚠️ _Üzgünüm! Üyeleri çıkarabilmem için yönetici olmam gerekiyor._");
        }
        if (inactiveMembers.length === 0) {
          return await message.sendReply("😎 _Belirtilen süre zarfında çıkarılacak inaktif üye bulunamadı._");
        }
        const kickMsg =
          `⚠️ _Dikkat! Bu işlem geri alınamaz._\n` +
          `🧹 _Toplam ${inactiveMembers.length} üye ${durationStr} ${durationUnit} boyunca sessiz kaldıkları için çıkarılacaklar._\n` +
          `_5 saniye içinde başlıyoruz. Dua etmeye başlayın..._ 🥲`;
        await message.client.sendMessage(message.jid, {
          text: kickMsg,
          mentions: inactiveMembers.map((m) => m.jid),
        });
        await sendBanAudio(message);
        await new Promise((r) => setTimeout(r, 5000));
        let kickCount = 0;
        for (let i = 0; i < Math.min(inactiveMembers.length, 20); i++) {
          const member = inactiveMembers[i];

          try {
            await new Promise((r) => setTimeout(r, 3000));
            await message.client.groupParticipantsUpdate(message.jid, [member.jid], "remove");
            kickCount++;
            if (kickCount % 5 === 0) {
              await message.send(`_Şu ana kadar ${kickCount}/${inactiveMembers.length} üye gruptan çıkarıldı..._`);
            }
          } catch (err) {
            console.error("Üye çıkarılırken hata:", err);
            await message.send(`❌ @${member.jid.split("@")[0]} çıkarılırken bir sorun oluştu.`);
          }
        }

        return await message.send(
          `✅ _Toplam ${kickCount}/${inactiveMembers.length} inaktif üye gruptan çıkarıldı._`
        );
      }
      if (inactiveMembers.length === 0) {
        return await message.sendReply(
          `_Belirtilen süre (${durationStr} ${durationUnit}) için inaktif üye bulunamadı._`
        );
      }
      let responseMsg =
        `ℹ️ *Son _${durationStr} ${durationUnit}_ boyunca mesaj atmayan üyeler;* _(${inactiveMembers.length})_\n` +
        `_(Kendilerine birer fatiha okuyalım)_ 🥲\n\n`;
      if (dataWarning) {
        responseMsg +=
          `⚠️ _Dikkat! Veritabanı yalnızca ${timeSince(oldestMessageDate, "tr")}'den itibaren kayıt tutuyor. ` +
          `Bu tarihten önce aktif olanlar da inaktif sayılmış olabilir._\n\n`;
      }
      for (let i = 0; i < inactiveMembers.length; i++) {
        const member = inactiveMembers[i];
        responseMsg += `${i + 1}. @${member.jid.split("@")[0]}\n`;
        responseMsg += `   _Son mesaj:_ ${member.lastMessage}\n`;
        responseMsg += `   _Toplam mesaj:_ ${member.totalMessages}\n\n`;
      }
      return await message.client.sendMessage(message.jid, {
        text: responseMsg,
        mentions: inactiveMembers.map((m) => m.jid),
      });
    } catch (err) {
      console.error("üyetemizle komutunda hata:", err);
      return await message.sendReply("⚠️ _Bir hata oluştu. Lütfen tekrar deneyin._");
    }
  }
);

function parseDuration(number, unit) {
  const num = parseInt(number);
  if (isNaN(num)) return null;
  switch (unit) {
    case "gün": return num * 24 * 60 * 60 * 1000;
    case "hafta": return num * 7 * 24 * 60 * 60 * 1000;
    case "ay": return num * 30 * 24 * 60 * 60 * 1000;
    case "yıl": return num * 365 * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

function timeSince(date, lang = "tr") {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  let interval = Math.floor(seconds / 31536000);
  if (interval >= 1) return lang == "tr" ? `${interval} yıl önce` : `${interval} years ago`;
  interval = Math.floor(seconds / 2592000);
  if (interval >= 1) return lang == "tr" ? `${interval} ay önce` : `${interval} months ago`;
  interval = Math.floor(seconds / 604800);
  if (interval >= 1) return lang == "tr" ? `${interval} hafta önce` : `${interval} weeks ago`;
  interval = Math.floor(seconds / 86400);
  if (interval >= 1) return lang == "tr" ? `${interval} gün önce` : `${interval} days ago`;
  interval = Math.floor(seconds / 3600);
  if (interval >= 1) return lang == "tr" ? `${interval} saat önce` : `${interval} hours ago`;
  interval = Math.floor(seconds / 60);
  if (interval >= 1) return lang == "tr" ? `${interval} dakika önce` : `${interval} minutes ago`;
  return lang == "tr" ? `az önce` : `just now`;
}

Module({
    pattern: "mesajlar ?(.*)",
    fromMe: false,
    desc: "En az bir mesajı olan üyelerin gönderdiği mesaj sayılarını gösterir. (sayıya göre sıralanmış şekilde)",
    usage: ".mesajlar (mesaj gönderen tüm üyeler)\n.mesajlar @etiket (belirli bir üye)",
    use: "group",
  },
  async (message, match) => {
    if (!message.isGroup)
      return await message.sendReply("⚠ _Bu komut sadece gruplarda kullanılabilir!_");
      var users = (
        await message.client.groupMetadata(message.jid)
      ).participants.map((e) => e.id);
      if (message.mention?.[0]) users = message.mention;
      if (message.reply_message && !message.mention.length)
        users = [message.reply_message?.jid];
      let userStats = await fetchFromStore(message.jid);
      let usersWithMessages = [];
      for (let user of users) {
        let userStat = userStats.find((stat) => stat.userJid === user);
        if (userStat && userStat.totalMessages > 0) {
          usersWithMessages.push({
            jid: user,
            stat: userStat,
          });
        }
      }
      usersWithMessages.sort(
        (a, b) => b.stat.totalMessages - a.stat.totalMessages
      );
      if (usersWithMessages.length === 0) {
        return await message.sendReply(
          "❌ _Veritabanında mesaj gönderen üye bulunamadı._"
        );
      }
      let final_msg = `👥 _${usersWithMessages.length} üye tarafından gönderilen mesajlar_\n🏆 _Mesaj sayısına göre sıralanmış (en yüksekten en düşüğe)_\n\n`;
      let mentionsList = [];
      
      for (let i = 0; i < usersWithMessages.length; i++) {
        let userObj = usersWithMessages[i];
        let user = userObj.jid;
        let userStat = userObj.stat;
        let count = userStat.totalMessages;
        let name = userStat.User?.name?.replace(/[\r\n]+/gm, "") || "Bilinmiyor";
        let lastMsg = timeSince(userStat.lastMessageAt);
        let types_msg = "\n";
        if (userStat.textMessages > 0)
          types_msg += `💬 Metin: *${userStat.textMessages}*\n`;
        if (userStat.imageMessages > 0)
          types_msg += `🖼️ Görsel: *${userStat.imageMessages}*\n`;
        if (userStat.videoMessages > 0)
          types_msg += `🎥 Video: *${userStat.videoMessages}*\n`;
        if (userStat.audioMessages > 0)
          types_msg += `🎙 Ses: *${userStat.audioMessages}*\n`;
        if (userStat.stickerMessages > 0)
          types_msg += `🎨 Çıkartma: *${userStat.stickerMessages}*\n`;
        if (userStat.otherMessages > 0)
          types_msg += `📎 Diğer: *${userStat.otherMessages}*\n`;
        mentionsList.push(user);
        final_msg += `${i + 1}. 👤 Üye: @${user.split("@")[0]}\n`;
        final_msg += `📝 İsim: *${name}*\n`;
        final_msg += `📊 Toplam mesaj: *${count}*\n`;
        final_msg += `🕒 Son mesaj: *${lastMsg}*${types_msg}\n`;
      }
      return await message.client.sendMessage(message.jid, {
        text: final_msg,
        mentions: mentionsList,
      });
   }
);

Module({
    pattern: 'uyar ?(.*)',
    fromMe: false,
    desc: 'Grup üyelerini uyarmaya yarar. Limit aşıldığında üye gruptan atılır.',
    usage: '.uyar @üye sebep\n.uyar sebep',
    use: 'group'
}, async (message, match) => {
    if (!match[0].split(" ")[0]?.toLowerCase().endsWith('uyar')) return;
    if (!message.isGroup) return await message.sendReply('❌ _Bu komut sadece gruplarda kullanılabilir!_');
    const userIsAdmin = await isAdmin(message, message.sender);
    if (!userIsAdmin) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) { return await message.sendReply('❌ _Uyarabilmem için öncelikle yönetici olmam gerekiyor!_'); }
    const targetUser = message.mention?.[0] || message.reply_message?.jid;
    if (!targetUser) {
        return await message.sendReply(
            `❗ _Lütfen bir üyeyi etiketleyin veya mesajına yanıt verin!_\n\n` +
            `🔻 *Kullanımı:* \n` +
            `• \`${handler}uyar @üye sebep\` - Uyarmaya yarar\n` +
            `• \`${handler}kaçuyarı @üye\` - Uyarı sayısını gösterir\n` +
            `• \`${handler}uyarısil @üye\` - 1 uyarıyı siler\n` +
            `• \`${handler}uyarısıfırla @üye\` - Tüm uyarıları sıfırlar\n` +
            `• \`${handler}uyarılimit\` - Maksimum uyarı limitini belirler`
        );
    }
    const isTargetAdmin = await isAdmin(message, targetUser);
    if (isTargetAdmin) {
        return await message.sendReply('❗ _OPS! Yöneticiler uyarılamaz._');
    }
    const targetNumericId = getNumericId(targetUser);
    if (sudoUsers.includes(targetNumericId)) {
        return await message.sendReply('❗ _OPS! Bot geliştiricisi uyarılamaz._');
    }
    let rawReason = match[1] || 'Sebep belirtilmedi';
    const mentionRegex = new RegExp(`@${targetNumericId}\\s*`, 'g');
    const reason = rawReason.replace(mentionRegex, '').trim() || 'Sebep belirtilmedi';
    try {
        await setWarn(message.jid, targetUser, reason, message.sender);
        const warnData = await getWarn(message.jid, targetUser, warnLimit);
        const currentWarns = warnData.current;
        const remaining = warnData.remaining;

        if (warnData.exceeded) {
            try {
                await message.client.groupParticipantsUpdate(message.jid, [targetUser], "remove");
                await message.client.sendMessage(message.jid,
                    { text: `⚠ *UYARI LİMİTİ AŞILDI!*\n\n` +
                        `👤 Üye: *@${targetNumericId}*\n` +
                        `🤔 Sebep: \`${reason}\`\n` +
                        `🔢 Uyarı Sayısı: \`${currentWarns}/${warnLimit} (LİMİT AŞILDI)\`\n` +
                        `👋🏻 İşlem: \`Gruptan çıkarılma\`\n\n` +
                        `🧹 _Maksimum uyarı sayısını aştığı için üye gruptan atıldı._ 😆`,
                    mentions: [targetUser] }
                );
            } catch (kickError) {
                await message.client.sendMessage(message.jid,
                    { text: `⚠ *UYARI LİMİTİ AŞILDI!*\n\n` +
                        `👤 Üye: *@${targetNumericId}*\n` +
                        `🔢 Uyarı Sayısı: \`${currentWarns}/${warnLimit}\`\n` +
                        `❌ Hata: \`Üye atılamadı!\`\n\n` +
                        `🛠️ _Lütfen üyeyi manuel çıkarın veya bot'un yönetici yetkisini kontrol edin._`,
                    mentions: [targetUser] }
                );
            }
        } else {
            await message.client.sendMessage(message.jid,
                { text: `⚠ *UYARI!*\n\n` +
                    `👤 Üye: @${targetNumericId}\n` +
                    `🤔 Sebep: \`${reason}\`\n` +
                    `🔢 Uyarı Sayısı: \`${currentWarns}/${warnLimit}\`\n` +
                    `⏳ Kalan Hakkı: \`${remaining}\`\n\n` +
                    `${remaining === 1 ? '🫡 _Bir uyarı daha alırsa gruptan atılacak!_' : `🫡 _${remaining} uyarı sonra gruptan atılacak._`}`,
                mentions: [targetUser] }
            );
        }
    } catch (error) {
        console.error('Uyarı verme hatası:', error);
        await message.sendReply('❌ _Uyarı verilemedi! Lütfen tekrar deneyin._');
    }
});

Module({
    pattern: 'kaçuyarı ?(.*)',
    fromMe: false,
    desc: 'Bir üyenin uyarılarını kontrol etmeyi sağlar.',
    usage: '.kaçuyarı @üye',
    use: 'group'
}, async (message, match) => {
    if (!message.isGroup) return await message.sendReply('❌ _Bu komut sadece gruplarda kullanılabilir!_');
    const userIsAdmin = await isAdmin(message, message.sender);
    if (!userIsAdmin) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");

    const targetUser = message.mention?.[0] || message.reply_message?.jid || message.sender;
    const targetNumericId = getNumericId(targetUser);
    try {
        const warnings = await getWarn(message.jid, targetUser);
        if (!warnings || warnings.length === 0) {
            return await message.client.sendMessage(message.jid,
                { text: `✅ *UYARI BULUNAMADI!*\n\n` +
                `👤 Üye: *@${targetNumericId}*\n` +
                `ℹ️ Durumu: *SİCİLİ TEMİZ* 😎\n` +
                `🔢 Uyarı Sayısı: \`0/${warnLimit}\``,
                mentions: [targetUser] }
            );
        }
        const currentWarns = warnings.length;
        const remaining = warnLimit - currentWarns;

        let warningsList = `📋 *UYARI GEÇMİŞİ*\n\n`;
        warningsList += `👤 Üye: *@${targetNumericId}*\n`;
        warningsList += `🔢 Toplam Uyarı: \`${currentWarns}/${warnLimit}\`\n`;
        warningsList += `🥲 Kalan Hakkı: \`${remaining > 0 ? remaining : 0}\`\n\n`;

        warnings.slice(0, 5).forEach((warn, index) => {
            const date = new Date(warn.timestamp).toLocaleString();
            const warnedByNumeric = getNumericId(warn.warnedBy);
            warningsList += `🤔 Sebep: *${index + 1}.* ${warn.reason}\n`;
            warningsList += `   👀 _Uyarıyı Veren:_ @${warnedByNumeric}\n`;
            warningsList += `   📅 _Tarih: *${date}*_\n\n`;
        });
        if (warnings.length > 5) {
            warningsList += `_... ve ${warnings.length - 5} uyarı daha görünüyor._ 🧐\n\n`;
        }
        if (remaining <= 0) {
            warningsList += `🫢 _Kullanıcı uyarı limitini aştı!_`;
        } else if (remaining === 1) {
            warningsList += `🥲 _Bir sonraki uyarıda atılacak!_`;
        }
        await message.client.sendMessage(message.jid, { text: warningsList, 
            mentions: [targetUser, ...warnings.slice(0, 5).map(w => w.warnedBy)] 
        });
    } catch (error) {
        console.error('Uyarı kontrol hatası:', error);
        await message.sendReply('⚠️ _Uyarılar alınamadı! Tekrar deneyin._');
    }
});

Module({
    pattern: 'uyarısil ?(.*)',
    fromMe: false,
    desc: 'Bir kullanıcının bir uyarısını kaldır',
    usage: '.uyarısil @üye',
    use: 'grup'
}, async (message, match) => {
    if (!message.isGroup) return await message.sendReply('❌ _Bu komut sadece gruplarda kullanılabilir!_');
    const userIsAdmin = await isAdmin(message, message.sender);
    if (!userIsAdmin) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const targetUser = message.mention?.[0] || message.reply_message?.jid;
    if (!targetUser) {
        return await message.sendReply('❗ _Lütfen bir üye etiketleyin veya mesajına yanıtlayın!_');
    }
    const targetNumericId = getNumericId(targetUser);
    try {
        const currentCount = await getWarnCount(message.jid, targetUser);
        if (currentCount === 0) {
            return await message.client.sendMessage(message.jid,
                { text: "🥳 *Hiç uyarısı yok!*\n\n" +
                "👤 Üye: `@" + targetNumericId + "`\n" +
                "ℹ️ Durumu: `Silinecek uyarı bulunamadı`",
                mentions: [targetUser] }
            );
        }
        const removed = await decrementWarn(message.jid, targetUser);
        if (removed) {
            const newCount = await getWarnCount(message.jid, targetUser);
            await message.client.sendMessage(message.jid,
                { text: "✅ *UYARI SİLİNDİ!*\n\n" +
                "👤 Üye: *@" + targetNumericId + "*\n" +
                "⛔ Silinen: `1 uyarı`\n" +
                "🔢 Kalan: `" + newCount + " uyarı`\n" +
                "ℹ️ Durumu: *" + (newCount === 0 ? "*SİCİLİ TEMİZ 😎" : "Hâlâ uyarısı mevcut") + "*",
                mentions: [targetUser] }
            );
        } else {
            await message.sendReply('❌ *Uyarı silinemedi! Tekrar deneyin.*');
        }
    } catch (error) {
        console.error('Uyarı kaldırma hatası:', error);
        await message.sendReply('❌ *Uyarı silinemedi! Tekrar deneyin.*');
    }
});

Module({
    pattern: 'uyarısıfırla ?(.*)',
    fromMe: false,
    desc: 'Bir üyenin tüm uyarılarını sıfırlar.',
    usage: '.uyarısıfırla @üye',
    use: 'group'
}, async (message, match) => {
    if (!message.isGroup) return await message.sendReply('❌ _Bu komut sadece gruplarda kullanılabilir!_');
    const userIsAdmin = await isAdmin(message, message.sender);
    if (!userIsAdmin) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) { return await message.sendReply('❌ _Uyarıları sıfırlayabilmem için öncelikle yönetici olmam gerekiyor!_'); }
    const targetUser = message.mention?.[0] || message.reply_message?.jid;
    if (!targetUser) {
        return await message.sendReply('❗ _Lütfen bir üyeyi etiketleyin veya mesajına yanıt verin!_');
    }
    const targetNumericId = getNumericId(targetUser);
    try {
        const currentCount = await getWarnCount(message.jid, targetUser);
        if (currentCount === 0) {
            return await message.client.sendMessage(message.jid,
                { text: "🤯 *UYARI BULUNAMADI!*\n\n" +
                "👤 Üye: *@" + targetNumericId + "*\n" +
                "ℹ️ Durumu: `Sıfırlanacak uyarı yok`",
                mentions: [targetUser] }
            );
        }
        const removed = await resetWarn(message.jid, targetUser);
        if (removed) {
            await message.client.sendMessage(message.jid,
                { text: "✅ *Uyarılar Sıfırlandı!*\n\n" +
                "👤 Üye: *@" + targetNumericId + "*\n" +
                "🔢 Sıfırlanan: `" + currentCount + " uyarı`\n" +
                "ℹ️ Durumu: *SİCİLİ TEMİZ* 😎",
                mentions: [targetUser] }
            );
        } else {
            await message.sendReply('❌ *Uyarılar sıfırlanamadı! Tekrar deneyin.*');
        }
    } catch (error) {
        console.error('Uyarı sıfırlama hatası:', error);
        await message.sendReply('❌ *Uyarılar sıfırlanamadı! Tekrar deneyin.*');
    }
});

Module({
    pattern: "uyarıliste",
    fromMe: false,
    desc: "Grupta uyarı alan tüm üyeleri listeler",
    usage: ".uyarıliste",
    use: "group",
  },
  async (message) => {
    if (!message.isGroup)
      return await message.sendReply(
        "🚫 _Bu komut sadece gruplarda kullanılabilir!_"
      );
    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) {
      return await message.sendReply(
        "⛔ _Üzgünüm! Öncelikle yönetici olmalısınız.__"
      );
    }
    try {
      const allWarnings = await getAllWarns(message.jid);
      if (Object.keys(allWarnings).length === 0) {
        return await message.sendReply(
          `✅ *GRUP TEMİZ!*\n\n` +
          `🎉 Bu grupta uyarı alan üye göremedim.\n` +
          `💯 _Herkes kurallara uyuyor, böyle devam!_ 😎`
        );
      }
      const sortedUsers = Object.entries(allWarnings).sort(
        ([, a], [, b]) => b.length - a.length
      );
      let warnList = `📋 *Grup Uyarı Listesi*\n\n`;
      warnList += `📊 _Toplam uyarılan üye sayısı: *${sortedUsers.length}*_\n\n`;
      warnList += `⚠️ Uyarı limiti: \`${warnLimit}\`\n\n`;
      let mentions = [];
      sortedUsers.forEach(([userJid, userWarnings], index) => {
        const userNumericId = userJid?.split("@")[0];
        const warnCount = userWarnings.length;
        const remaining = warnLimit - warnCount;
        const status =
          remaining <= 0
            ? "🚫 LİMİT AŞILDI!"
            : remaining === 1
            ? "⚠️ SON UYARI"
            : `🔢 ${remaining} hak kaldı`;

        warnList += `*${index + 1}.* 👤 @${userNumericId}\n`;
        warnList += `   🧾 _Uyarılar: \`${warnCount}/${warnLimit}\`_\n`;
        warnList += `   📌 _Durum: \${status}\_\n`;

        if (userWarnings.length > 0) {
          const latestWarning = userWarnings[0];
          warnList += `   🕒 _Son Uyarı Sebebi: \${latestWarning.reason.substring(0, 30)}${
            latestWarning.reason.length > 30 ? "..." : ""
          }\_\n`;
        }
        warnList += "\n";
        mentions.push(userJid);
      });
      warnList += `ℹ️ _Detaylı uyarı geçmişi için: ${handler}kaçuyarı @üye_`;
      await message.client.sendMessage(message.jid, {
        text: warnList,
        mentions,
      });
    } catch (error) {
      console.error("Uyarı listesi hatası:", error);
      await message.sendReply(
        "❌ _Uyarı listesi alınırken bir hata oluştu!_"
      );
    }
  }
);

Module({
    pattern: 'uyarılimit ?(.*)',
    fromMe: false,
    desc: 'Grup için uyarı limitini ayarlar',
    usage: '.uyarılimit 5',
    use: 'group'
}, async (message, match) => {
    const userIsAdmin = await isAdmin(message, message.sender);
    if (!userIsAdmin) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const newLimit = parseInt(match[1]);
    if (!newLimit || newLimit < 1 || newLimit > 20) {
        return await message.sendReply(
            `⚠ *Geçersiz Uyarı Limiti!*\n\n` +
            `- Lütfen 1 ile 20 arasında bir miktar girin.\n` +
            `- Mevcut limit: \`${warnLimit}\`\n\n` +
            `💬 *Kullanım:* \`${handler}uyarılimit 5\``
        );
    }
    try {
        await message.sendReply(
            `✅ *Uyarı Limiti Güncellendi!*\n\n` +
            `- Yeni limit: \`${newLimit}\`\n` +
            `- Önceki limit: \`${warnLimit}\`\n\n` +
            `ℹ _Üyeler artık ${newLimit} uyarıdan sonra gruptan atılacak._`
        );
    } catch (error) {
        console.error('Uyarı limiti ayarlanırken hata oluştu:', error);
        await message.sendReply('❌ _Uyarı limiti güncellenemedi! Tekrar deneyin._');
    }
});

async function sendAudioFromPath(message, downloadMsg, originalPath, title) {
  let convertedPath;
  try {
    convertedPath = await convertM4aToMp3(originalPath);
    await message.edit(
      `_🔺 Yükleniyor... *${title}*_`,
      message.jid,
      downloadMsg.key
    );
    const stream = fs.createReadStream(convertedPath);
    await message.sendReply({ stream }, "audio", {
      mimetype: "audio/mpeg",
    });
    stream.destroy();
    await message.edit(
      `_✅ Hazır! *${title}*_`,
      message.jid,
      downloadMsg.key
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    for (const p of [originalPath, convertedPath]) {
      if (p && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch (e) {
          console.error("Dosya silinirken hata:", e);
        }
      }
    }
  }
}

Module({
    pattern: "yedekşarkı ?(.*)",
    fromMe: false,
    desc: "YouTube üzerinden şarkı indirir.",
    use: "download",
  },
  async (message, match) => {
    let input = (match[1] || message.reply_message?.text || "").trim();
    if (!input) {
      return await message.sendReply(
        "⚠️ Geçersiz şarkı adı!\nÖrnek: *.yedekşarkı Duman - Bu Akşam*"
      );
    }
    const downloadMsg = await message.send("🔎 _Aranıyor... (bu işlem 10-60 saniye sürebilir)_");
    try {
      let query = input;
      const urlMatch = input.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]+)/);
      if (urlMatch) {
        query = `https://www.youtube.com/watch?v=${urlMatch[1]}`;
      }
      const apiUrl = `https://api.nexray.web.id/downloader/ytplay?q=${encodeURIComponent(query)}`;
      const { data } = await axios.get(apiUrl, { timeout: 600000 });
      if (!data?.status || !data?.result?.download_url) {
        return await message.edit(
          "❌ _Sonuç bulunamadı!_",
          message.jid,
          downloadMsg.key
        );
      }
      const { title, duration, download_url } = data.result;
      const censoredTitle = censorBadWords(title);
await message.edit(
  `_🔻 İndirilip yükleniyor... *${censoredTitle}* (${duration})_`,
  message.jid,
  downloadMsg.key
);

await message.client.sendMessage(message.jid, {
  audio: { url: download_url },
  mimetype: "audio/mpeg",
  fileName: `${censoredTitle}.mp3`,
  pttAudioisMp4: false,
}, { quoted: message.data });

await message.edit(
  `_✅ Hazır! *${censoredTitle}*_`,
  message.jid,
  downloadMsg.key
);
      try { fs.unlinkSync(tmpPath); } catch (e) {}
    } catch (error) {
      console.error("İndirme hatası:", error);
      await message.edit(
        "⚠️ _İndirme başarısız! Farklı şekilde deneyin._",
        message.jid,
        downloadMsg.key
      );
    }
  }
);

function censorBadWords(text) {
  let censored = text;
  const sortedWords = [...badWords].sort((a, b) => b.length - a.length);
  
  sortedWords.forEach(word => {
    const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    censored = censored.replace(regex, (match) => {
      if (match.length <= 2) return '*'.repeat(match.length);
      return match[0] + '*'.repeat(match.length - 2) + match[match.length - 1];
    });
  });
  
  return censored;
}

const badWords = [
    'amk', 'orospu', 'orospu çocuğu', 'oç', 'o.ç', 'o ç', 'siktir', 'sikik', 'sikti', 'sikerim', 
    'sikiyim', 'sik', 'sikim', 's*ktir', 'piç', 'p.i.ç', 'pic', 'yarrak', 'yarak', 'yarrağım',
    'göt', 'got', 'gotveren', 'götveren', 'mal', 'salak', 'aptal', 'gerizekalı', 'ananı', 'amını', 
    'amına', 'amcık', 'avradını', 'bacını', 'pezevenk', 'ibne', 'ibine', 'ibneyim', 'puşt', 'şerefsiz', 
    'serefsiz', 'kaltak', 'kahpe', 'kaşar', 'kasar', 'dalyarak', 'dingil', 'yavşak', 'yavsak', 'döl',
    'amına koyayım', 'amına koyim', 'amına kodum', 'yarram'
];

Module({pattern: 'ses ?(.*)', fromMe: false, desc: Lang.TTS_DESC, use: 'utility'},    
async (message, match) => {
if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND)    
    const query = match[1] || message.reply_message?.text;    
        if (!query) {
        const usageText = `🎙️ *Sesli Mesaj Aracı*
📝 *Kullanım:*
.ses <metin>
.ses /cinsiyet <metin>
.ses /dil <metin>
.ses /hız <metin>

🔧 *Seçenekler:*
- */sage* - Ses tonu seçimi
- */erkek* veya */e* - Erkek sesi
- */kadın* veya */k* - Kadın sesi
- */tr, /en, /es* - Dil seçimi
- */1.5, /2.0* - Hız ayarı (0.5-2.0)

🎤 *Ses Tonları:*
/nova, /alloy, /ash, /coral, /echo, /fable, /onyx, /sage, /shimmer

📌 *Örnekler:*
.ses Naber canım
.ses /sage Nasıl gidiyor?
.ses /erkek Nasılsın?
.ses /k Hava çok güzel
.ses /en /1.2 How are you
.ses /e /1.5 Hızlı konuş

💡 *Not:* Bir mesajı yanıtlayarak da kullanabilirsiniz.`;
    return await message.sendReply(usageText);
    }
    let ttsMessage = query;    
    let LANG = 'tr';    
    let SPEED = 0.9;    
    let VOICE = 'coral';     
    if (/\/erkek\b|\/e\b/i.test(ttsMessage)) {
        VOICE = "ash";
        ttsMessage = ttsMessage.replace(/\/erkek\b|\/e\b/gi, "").trim();
    } else if (/\/kadın\b|\/k\b/i.test(ttsMessage)) {
        VOICE = "nova";
        ttsMessage = ttsMessage.replace(/\/kadın\b|\/k\b/gi, "").trim();
    }
    const langMatch = ttsMessage.match(/\/(tr|en|es|fr|de|it|pt|ru|ja|ko|zh)\b/i);    
    if (langMatch) {        
        LANG = langMatch[1].toLowerCase();        
        ttsMessage = ttsMessage.replace(langMatch[0], "").trim();    
    }     
    const speedMatch = ttsMessage.match(/\/([0-9]+\.?[0-9]*)\b/);    
    if (speedMatch) {        
        const speed = parseFloat(speedMatch[1]);
        if (speed >= 0.5 && speed <= 2.0) {
            SPEED = speed;
            ttsMessage = ttsMessage.replace(speedMatch[0], "").trim();
        }
    }            
    const voiceMatch = ttsMessage.match(/\/(nova|alloy|ash|coral|echo|fable|onyx|sage|shimmer)\b/i);    
    if (voiceMatch) {    
        VOICE = voiceMatch[1].toLowerCase();    
        ttsMessage = ttsMessage.replace(voiceMatch[0], "").trim();    
    }     
    ttsMessage = ttsMessage.replace(/\s+/g, ' ').trim();
    if (!ttsMessage) {
        return await message.sendReply('❌ Seslendirilecek metin bulunamadı.');
    }
    function makeBadWordRegex(word) {       
        const pattern = word        
            .replace(/a/g, '[a4@]')        
            .replace(/i/g, '[i1!İî]')        
            .replace(/o/g, '[o0ö]')        
            .replace(/u/g, '[uü]')        
            .replace(/s/g, '[s5$ş]')        
            .replace(/c/g, '[cç]')        
            .replace(/g/g, '[gğ9]')        
            .replace(/e/g, '[e3]')        
            .replace(/\s+|\./g, '(\\s|\\.|-|_)*');      
        return new RegExp(`\\b${pattern}\\b`, 'iu');    
    }     

    const filterRegexes = badWords.map(makeBadWordRegex);    
    const containsBadWord = filterRegexes.some(rx => rx.test(ttsMessage));     
    if (containsBadWord) {        
        return await message.sendReply('🚫 OPS! Seslendirme hatası.');    
    }     
    try {        
        let audio;        
        try {            
            const ttsResult = await aiTTS(ttsMessage, VOICE, SPEED.toFixed(2));            
            if (ttsResult.url) {                
                audio = { url: ttsResult.url };            
            } else {                
                throw new Error(ttsResult.error || 'YZ Ses Sunucu Hatası!');            
            }        
        } catch (e) {            
            console.log('YZ TTS hatası, Google TTS\'e geçiliyor:', e.message);
            audio = await gtts(ttsMessage, LANG);        
        }        
        await message.client.sendMessage(message.jid, {             
            audio,             
            mimetype: 'audio/mpeg',             
            ptt: true        
        });    
    } catch (error) {
        console.error('TTS Hatası:', error);
        await message.sendReply("_" + Lang.TTS_ERROR + "_");    
    }
});

async function sendBanAudio(message) {
  const fsp = fs.promises;
  const path = require('path');
  const tempDir = path.join(__dirname, 'temp');
  const audioPath = path.join(tempDir, 'ban.mp3');
  try {
    if (!fs.existsSync(tempDir)) {
      await fsp.mkdir(tempDir, { recursive: true });
    }
    if (!fs.existsSync(audioPath)) {
      const response = await axios.get(
        'https://dl.sndup.net/bq7y/Ban.mp3',
        { responseType: 'stream' }
      );

      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(audioPath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    }
    const stream = fs.createReadStream(audioPath);
    try {
      await message.send({ stream }, "audio");
    } finally {
      stream.destroy();
    }
  } catch (err) {
    console.error('Ban sesini gönderirken hata:', err);
    await message.sendReply('⚠️ _Ban sesi gönderilemedi, işlem devam ediyor._');
  }
}

Module({
  pattern: 'at ?(.*)',
  fromMe: false,
  desc: Lang.KICK_DESC,
  use: 'group'
}, async (message, match) => {
  if (!message.isGroup) {
    return await message.sendReply(Lang.GROUP_COMMAND);
  }
  const userIsAdmin = await isAdmin(message, message.sender);
  if (!userIsAdmin) {
    return await message.sendReply('❌ _Üzgünüm! Öncelikle yönetici olmalısınız._');
  }
  const botIsAdmin = await isAdmin(message);
  if (!botIsAdmin) {
    return await message.sendReply('❌ _Bot\'un üyeleri atabilmesi için yönetici olması gerekiyor!_');
  }
  let usersToKick = [];
  if (message.mention && message.mention.length > 0) {
    usersToKick = message.mention;
  } else if (message.reply_message) {
    const replyUser = message.reply_message.participant 
                   || message.reply_message.sender 
                   || message.reply_message.jid;
    if (replyUser) {
      usersToKick = [replyUser];
    }
  }
  if (!usersToKick.length) {
    return await message.sendReply(
      '❌ _Lütfen bir üye etiketleyin veya bir mesaja yanıt verin!_'
    );
  }
  const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
  let canKickAnyone = false;
  let adminUsers = [];
  for (const user of usersToKick) {
    if (user === botId) {
      continue;
    }
    try {
      const isTargetAdmin = await isAdmin(message, user);
      if (isTargetAdmin) {
        adminUsers.push(user);
      } else {
        canKickAnyone = true;
      }
    } catch (error) {
      console.error('Admin kontrolü hatası:', user, error);
      canKickAnyone = true;
    }
  }
  if (!canKickAnyone) {
    if (adminUsers.length > 0) {
      return await message.sendReply(
        `❌ _Belirtilen kişi${adminUsers.length > 1 ? 'lar' : ''} yönetici olduğu için atılamaz!_`
      );
    } else {
      return await message.sendReply('❌ _Bot kendisini gruptan atamaz!_');
    }
  }
  await sendBanAudio(message);
  for (const user of usersToKick) {
    try {
      if (user === botId) {
        await message.sendReply('❌ _Bot kendisini gruptan atamaz!_');
        continue;
      }
      const isTargetAdmin = await isAdmin(message, user);
      if (isTargetAdmin) {
        await message.sendReply(
          `❌ ${mentionjid(user)} _bir yönetici olduğu için atılamaz!_`,
          { mentions: [user] }
        );
        continue;
      }
      await message.client.sendMessage(message.jid, {
        text: mentionjid(user) + Lang.KICKED,
        mentions: [user]
      });
      await message.client.groupParticipantsUpdate(
        message.jid,
        [user],
        'remove'
      );
      if (usersToKick.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    } catch (error) {
      console.error('Üye atılırken hata:', error);
      await message.sendReply(
        `❌ ${mentionjid(user)} _atılırken bir hata oluştu!_`,
        { mentions: [user] }
      );
    }
  }
});

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
    timeStr.match(/^(\d+)\s*(g|gün|gun)$/i) || 
    timeStr.match(/^(\d+)\s*(s|saat)$/i) ||
    timeStr.match(/^(\d+)\s*(d|dk|dakika)$/i) ||
    timeStr.match(/^(\d+)\s*(sn|saniye)$/i) ||
    timeStr.match(/^(\d+)\s*(saat)\s*(\d+)\s*(dk|dakika)$/i) ||
    timeStr.match(/^(\d+)\s*(s)\s*(\d+)\s*(dk|dakika)$/i) ||
    timeStr.match(/^(\d+)\s*(dk|dakika)\s*(\d+)\s*(sn|saniye)$/i);
  
  if (durationMatch) {
    let duration = moment.duration();
    if ((timeStr.includes("saat") || timeStr.match(/\d+s\d+/)) && (timeStr.includes("dk") || timeStr.includes("dakika"))) {
      const match = timeStr.match(/^(\d+)\s*(saat|s)\s*(\d+)\s*(dk|dakika)$/i);
      if (match) {
        const [, hours, , minutes] = match;
        duration.add(parseInt(hours), "hours").add(parseInt(minutes), "minutes");
      }
    }
    else if ((timeStr.includes("dk") || timeStr.includes("dakika")) && (timeStr.includes("sn") || timeStr.includes("saniye"))) {
      const match = timeStr.match(/^(\d+)\s*(dk|dakika)\s*(\d+)\s*(sn|saniye)$/i);
      if (match) {
        const [, minutes, , seconds] = match;
        duration.add(parseInt(minutes), "minutes").add(parseInt(seconds), "seconds");
      }
    }
    else {
      const [, value, unit] = durationMatch;
      const unitMap = { 
        g: "days",
        gün: "days",
        gun: "days",
        s: "hours",
        saat: "hours",
        d: "minutes",
        dk: "minutes",
        dakika: "minutes",
        sn: "seconds",
        saniye: "seconds"
      };
      duration.add(parseInt(value), unitMap[unit.toLowerCase()]);
    }
    return now.add(duration).subtract(1, "minute").toDate();
  }
  
  const timeMatch = timeStr.match(/^(\d{1,2})[:.](\d{2})$/i);
  if (timeMatch) {
    let [, hours, minutes] = timeMatch;
    hours = parseInt(hours);
    minutes = parseInt(minutes);
    const targetTime = moment().hours(hours).minutes(minutes).seconds(0);
    if (targetTime.isBefore(now)) {
      targetTime.add(1, "day");
    }
    return targetTime.subtract(1, "minute").toDate();
  }
  const dateTime = moment(timeStr, [
    "DD.MM.YYYY HH:mm",
    "DD/MM/YYYY HH:mm",
    "DD.MM.YYYY HH.mm",
    "YYYY-MM-DD HH:mm",
  ]);
  if (dateTime.isValid()) {
    return dateTime.subtract(1, "minute").toDate();
  }
  return null;
}

async function createMessageObject(replyMessage, mentionJid = null, isGroupMessage = false) {
  let messageObj = {};
  if (isGroupMessage && mentionJid && replyMessage.text) {
    const mentionText = `⏰ @${mentionJid.split('@')[0]} `;
    messageObj.text = mentionText + replyMessage.text;
    messageObj.mentions = [mentionJid];
  } else if (replyMessage.text) {
    messageObj.text = replyMessage.text;
  }
  if (replyMessage.image) {
    const buffer = await replyMessage.download("buffer");
    messageObj.image = buffer.toString("base64");
    if (replyMessage.caption) {
      if (isGroupMessage && mentionJid) {
        const mentionText = `⏰ @${mentionJid.split('@')[0]} `;
        messageObj.caption = mentionText + replyMessage.caption;
        messageObj.mentions = [mentionJid];
      } else {
        messageObj.caption = replyMessage.caption;
      }
    }
    messageObj._mediaType = "image";
  }
  if (replyMessage.video) {
    const buffer = await replyMessage.download("buffer");
    messageObj.video = buffer.toString("base64");
    if (replyMessage.caption) {
      if (isGroupMessage && mentionJid) {
        const mentionText = `⏰ @${mentionJid.split('@')[0]} `;
        messageObj.caption = mentionText + replyMessage.caption;
        messageObj.mentions = [mentionJid];
      } else {
        messageObj.caption = replyMessage.caption;
      }
    }
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

Module({
    pattern: "planla ?(.*)",
    use: "utility",
    desc: "⏰ Mesaj planla - Gruba veya özele zamanlanmış mesaj gönder",
  },
  async (m, match) => {
    if (!m.reply_message) {
      return await m.sendReply(
        "⚠️ _Planlamak istediğiniz mesaja yanıt veriniz._\n\n*📋 Kullanımı:*\n• `.planla @üye <zaman>` (gruba etiketle ve gönder)\n• `.planla dm @üye <zaman>` (özeline gönder)\n\n*⏱️ Zaman formatları:*\n• `2 saat 30 dakika` veya `2saat30dk` veya `2s30dk`\n• `1 gün` veya `1g`\n• `30 dakika` veya `30dk` veya `30 dk`\n• `5 saniye` veya `5sn`\n• `14:30` veya `14.30`\n• `25.12.2026 11:00`"
      );
    }
    if (!match[1]) {
      return await m.sendReply(
        "⚠️ _Lütfen üye etiketleyip zaman belirtiniz._\n\n*💡 Örnek:*\n• `.planla @üye 2 saat`\n• `.planla dm @üye 30 dakika`"
      );
    }
    let input = match[1].trim();
    let isDM = false;
    if (input.startsWith('dm ')) {
      isDM = true;
      input = input.substring(3).trim();
    }
    let targetJid = null;
    let mentionedUser = m.mention?.[0];
    if (!mentionedUser) {
      return await m.sendReply(
        "⚠️ _Lütfen bir üyeyi etiketleyin!_\n\n*💡 Örnek:*\n• `.planla @üye 2 saat`\n• `.planla dm @üye 30 dakika`"
      );
    }
    targetJid = mentionedUser;
    input = input.replace(/@\d+/g, '').trim();
    const timeStr = input.trim();
    if (!timeStr) {
      return await m.sendReply(
        "⚠️ _Lütfen zaman belirtin!_\n\n*💡 Örnek:*\n• `.planla @üye 2 saat`\n• `.planla dm @üye 30 dakika`"
      );
    }
    const scheduleTime = parseTime(timeStr);
    if (!scheduleTime) {
      return await m.sendReply(
        "❌ _Geçersiz zaman formatı_\n\n*⏱️ Desteklenen formatlar:*\n• `2 saat 30 dakika`, `2saat30dk`, `2s30dk`\n• `1 gün`, `1g`\n• `30 dakika`, `30dk`, `30 dk`\n• `5 saniye`, `5sn`\n• `14:30`, `14.30`\n• `25.12.2024 14:30`"
      );
    }
    const originalTime = moment(scheduleTime).add(1, "minute").toDate();
    if (originalTime <= new Date()) {
      return await m.sendReply("⚠️ _Planlama zamanı gelecek zaman olmalıdır._");
    }
    const minTime = moment().add(2, "minutes").toDate();
    if (originalTime < minTime) {
      return await m.sendReply(
        "⚠️ _Minimum planlama süresi 2 dakikadır. Lütfen en az 2 dakika sonrası için planlayın._"
      );
    }
    const finalJid = isDM ? targetJid : m.jid;
    const isGroupMessage = !isDM;
    try {
      const messageData = await createMessageObject(
        m.reply_message, 
        isGroupMessage ? targetJid : null, 
        isGroupMessage
      );
      await scheduledMessages.add(finalJid, messageData, scheduleTime);
      moment.locale('tr');
      const timeFromNow = moment(scheduleTime).add(1, "minute").fromNow();
      const formattedTime = moment(scheduleTime)
        .add(1, "minute")
        .format("DD.MM.YYYY HH:mm");
      const targetInfo = isDM ? "📩 özelden" : "💬 gruba (⏰ etiketli)";
      await m.sendReply(
        `✅ *Mesaj başarıyla planlandı!*\n\n📅 *Tarih:* ${formattedTime}\n⏰ *Kalan süre:* ${timeFromNow}\n📱 *Hedef:* ${targetInfo}\n👤 *Üye:* @${targetJid.split('@')[0]}`,
        { mentions: [targetJid] }
      );
    } catch (error) {
      console.error("Mesaj planlama hatası:", error);
      await m.sendReply("❌ _Mesaj planlanırken hata oluştu. Lütfen tekrar deneyin._");
    }
  }
);

Module({
    pattern: "plandurum ?(.*)",
    use: "utility",
    desc: "📋 Planlanan tüm mesajları listeler",
  },
  async (m, match) => {
    try {
      const pending = await scheduledMessages.getAllPending();
      if (pending.length === 0) {
        return await m.sendReply("📭 _Bekleyen planlı mesaj bulunmuyor._");
      }
      moment.locale('tr');
      let response = "📋 *Planlanan Mesajlar*\n\n";
      pending.sort(
        (a, b) => a.scheduleTime.getTime() - b.scheduleTime.getTime()
      );
      pending.forEach((msg, index) => {
        const timeFromNow = moment(msg.scheduleTime).add(1, "minute").fromNow();
        const formattedTime = moment(msg.scheduleTime)
          .add(1, "minute")
          .format("DD.MM.YYYY HH:mm");
        const preview = JSON.parse(msg.message);
        let content = preview.text || preview.caption || "🎬 Medya mesajı";
        if (content.length > 30) content = content.substring(0, 30) + "...";
        response += `${index + 1}. *🆔 ID:* ${msg.id}\n`;
        response += `   *📱 Gönderilecek:* ${msg.jid}\n`;
        response += `   *📅 Tarih:* ${formattedTime}\n`;
        response += `   *⏰ Kalan:* ${timeFromNow}\n`;
        response += `   *💬 İçerik:* ${content}\n\n`;
      });
      response += '💡 _Planlı mesajı iptal etmek için ".plansil <id>" yazınız._';
      await m.sendReply(response);
    } catch (error) {
      console.error("Planlananlar listelenirken hata:", error);
      await m.sendReply("❌ _Planlanan mesajlar getirilemedi_");
    }
  }
);

Module({
    pattern: "plansil ?(.*)",
    use: "utility",
    desc: "🗑️ Planlanan mesajı ID ile iptal eder",
  },
  async (m, match) => {
    if (!match[1]) {
      return await m.sendReply(
        "⚠️ _Lütfen iptal edilecek mesajın ID'sini girin._\n\n*💡 Kullanım:* `.plansil <id>`\n\n_Planlanan mesajları görmek için `.plandurum` yazınız._"
      );
    }
    const messageId = parseInt(match[1].trim());
    if (isNaN(messageId)) {
      return await m.sendReply("⚠️ _Lütfen geçerli bir mesaj ID'si girin!_");
    }
    try {
      const success = await scheduledMessages.delete(messageId);
      if (success) {
        await m.sendReply(
          `✅ *Planlı mesaj başarıyla silindi!*\n\n🗑️ *Mesaj ID:* ${messageId}`
        );
      } else {
        await m.sendReply("❌ *Mesaj bulunamadı veya zaten gönderilmiş!*");
      }
    } catch (error) {
      console.error("Planlama iptal hatası:", error);
      await m.sendReply("❌ _Planlı mesaj iptal edilemedi!_");
    }
  }
);

const cityCodes = {
  '01': 'Adana', '02': 'Adıyaman', '03': 'Afyonkarahisar', '04': 'Ağrı', '05': 'Amasya',
  '06': 'Ankara', '07': 'Antalya', '08': 'Artvin', '09': 'Aydın', '10': 'Balıkesir',
  '11': 'Bilecik', '12': 'Bingöl', '13': 'Bitlis', '14': 'Bolu', '15': 'Burdur',
  '16': 'Bursa', '17': 'Çanakkale', '18': 'Çankırı', '19': 'Çorum', '20': 'Denizli',
  '21': 'Diyarbakır', '22': 'Edirne', '23': 'Elazığ', '24': 'Erzincan', '25': 'Erzurum',
  '26': 'Eskişehir', '27': 'Gaziantep', '28': 'Giresun', '29': 'Gümüşhane', '30': 'Hakkari',
  '31': 'Hatay', '32': 'Isparta', '33': 'Mersin', '34': 'İstanbul', '35': 'İzmir',
  '36': 'Kars', '37': 'Kastamonu', '38': 'Kayseri', '39': 'Kırklareli', '40': 'Kırşehir',
  '41': 'Kocaeli', '42': 'Konya', '43': 'Kütahya', '44': 'Malatya', '45': 'Manisa',
  '46': 'Kahramanmaraş', '47': 'Mardin', '48': 'Muğla', '49': 'Muş', '50': 'Nevşehir',
  '51': 'Niğde', '52': 'Ordu', '53': 'Rize', '54': 'Sakarya', '55': 'Samsun', '56': 'Siirt',
  '57': 'Sinop', '58': 'Sivas', '59': 'Tekirdağ', '60': 'Tokat', '61': 'Trabzon',
  '62': 'Tunceli', '63': 'Şanlıurfa', '64': 'Uşak', '65': 'Van', '66': 'Yozgat',
  '67': 'Zonguldak', '68': 'Aksaray', '69': 'Bayburt', '70': 'Karaman', '71': 'Kırıkkale',
  '72': 'Batman', '73': 'Şırnak', '74': 'Bartın', '75': 'Ardahan', '76': 'Iğdır',
  '77': 'Yalova', '78': 'Karabük', '79': 'Kilis', '80': 'Osmaniye', '81': 'Düzce'
};

const turkishCities = Object.values(cityCodes).map((city) => city.toLowerCase());

async function sendMessage(m, message) {
  try {
    await m.sendReply(message);
  } catch (error) {
    console.error('Mesaj gönderme hatası:', error);
  }
}

function isTurkishCity(cityName) {
  return turkishCities.includes(cityName.toLowerCase());
}

function normalizeTurkishCharacters(text) {
  return text
    .replace(/ö/g, 'o').replace(/Ö/g, 'O').replace(/ü/g, 'u').replace(/Ü/g, 'U').replace(/ş/g, 's').replace(/Ş/g, 'S')
    .replace(/ı/g, 'i').replace(/İ/g, 'I').replace(/ç/g, 'c').replace(/Ç/g, 'C').replace(/ğ/g, 'g').replace(/Ğ/g, 'G');
}

function getTimeBasedEmoji(temp) {
  const turkeyTime = new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' });
  const turkeyDate = new Date(turkeyTime);
  const hour = turkeyDate.getHours();

  if (hour >= 22 || hour < 5) {
    if (temp <= 0) return { start: '🌙', end: '❄️' };
    if (temp <= 10) return { start: '🌙', end: '🥶' };
    if (temp <= 20) return { start: '🌙', end: '😴' };
    return { start: '🌙', end: '🔥' };
  }
  if (hour >= 5 && hour < 12) {
    if (temp <= 0) return { start: '🌅', end: '❄️' };
    if (temp <= 10) return { start: '🌅', end: '🥶' };
    if (temp <= 20) return { start: '🌅', end: '☕' };
    return { start: '🌅', end: '☀️' };
  }
  if (hour >= 12 && hour < 19) {
    if (temp <= 0) return { start: '☀️', end: '❄️' };
    if (temp <= 10) return { start: '🌤️', end: '🧥' };
    if (temp <= 20) return { start: '☀️', end: '😊' };
    if (temp <= 30) return { start: '☀️', end: '🔥' };
    return { start: '🔥', end: '🥵' };
  }
  if (hour >= 19 && hour < 22) {
    if (temp <= 0) return { start: '🌆', end: '❄️' };
    if (temp <= 10) return { start: '🌆', end: '🧥' };
    if (temp <= 20) return { start: '🌆', end: '😌' };
    return { start: '🌆', end: '🔥' };
  }

  return { start: '🌤️', end: '🌡️' };
}

Module({
  pattern: 'hava ?(.*)',
  fromMe: false,
  desc: 'Hava durumu bilgisi gönderir.',
  use: 'utility'
}, async (m, match) => {
  const restrictedGroupId = '905396978235-1601666238@g.us';
  if (m.jid === restrictedGroupId) {
    await sendMessage(m, '❗ *Bu komut sadece sohbet grubunda kullanılabilir!*');
    return;
  }

  const queriedCity = match[1]?.trim();
  if (!queriedCity) {
    await sendMessage(m, '❗ Lütfen bir şehir adı belirtiniz.');
    return;
  }

  const normalizedCity = normalizeTurkishCharacters(queriedCity);
  const plateCode = queriedCity.padStart(2, '0');
  const city = cityCodes[queriedCity] || cityCodes[plateCode] || normalizedCity;

  try {
    const API_KEY = '3df525a18b9fc5c3a689ac0456be979c';
    const encodedCity = encodeURIComponent(city);
    const apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodedCity}&appid=${API_KEY}&units=metric&lang=tr`;
    const response = await axios.get(apiUrl);
    const data = response.data;

    if (data.cod === '404' || data.cod === 404) {
      await sendMessage(m, `❌ Konum bulunamadı: ${queriedCity}\n💬 *Örnek: _.hava şehir veya ilçe veya mahalle_*`);
      return;
    }

    const { main, wind, weather } = data;
    const temp = Math.round(main.temp);
    const humidity = main.humidity;
    const windSpeed = wind.speed;
    const description = weather[0].description;
    const cityName = data.name;
    const emojiPair = getTimeBasedEmoji(temp);

    await sendMessage(
      m,
      `📍 *${cityName}* için hava durumu:\n${emojiPair.start} Sıcaklık: *${temp}°C* - ${description} ${emojiPair.end}\n💧 Nem: *%${humidity}*\n💨 Rüzgar: *${windSpeed} m/s*`
    );
  } catch (error) {
    if (error.response?.status === 404) {
      await sendMessage(m, '❌ Belirtilen konum bulunamadı!\n💬 *Örnek: _.hava şehir veya ilçe veya mahalle_*');
      return;
    }

    if (isTurkishCity(queriedCity) || isTurkishCity(normalizedCity)) {
      await sendMessage(m, '⚠️ Hava durumu bilgisi alınırken bir hata oluştu. Tekrar deneyiniz.');
      return;
    }

    await sendMessage(m, '⚠️ Geçersiz şehir adı ya da servis hatası. Lütfen tekrar deneyiniz.');
  }
});

function parseSarrafiye(html) {
  const results = {};
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>([\d.,]+)<\/td>\s*<td[^>]*>([\d.,]+)<\/td>\s*<td[^>]*>(.*?)<\/td>/gi;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const name = match[1]
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    results[name] = {
      buy: match[2],
      sell: match[3],
      change: match[4].replace('%', '').trim(),
    };
  }
  return results;
}

Module(
  {
    pattern: 'altın ?(.*)',
    fromMe: false,
    desc: 'Güncel altın fiyatlarını gösterir',
    use: 'utility',
  },
  async (message) => {
    const loading = await message.send('🔄 _Altın fiyatlarına bakıyorum..._');
    try {
      const { data: html } = await axios.get('https://www.sarrafiye.net/piyasa/altin.html', {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
      });
      const data = parseSarrafiye(html);
      const kur = data['Kur'];
      const gram = data['Gram Altın'];
      const ceyrek = data['Çeyrek Altın'];
      const yarim = data['Yarım Altın'];
      const tam = data['Tam Ata Lira'] || data['Tam Altın'];
      if (!kur && !gram && !ceyrek && !yarim && !tam) {
        return await message.edit(
          '⚠️ _Altın verilerine ulaşılamadı!_\n_Kaynak yapısı değişmiş olabilir._',
          message.jid,
          loading.key
        );
      }
      let text = '💰 `GÜNCEL ALTIN FİYATLARI`\n\n';
      function addBlock(title, emoji, item, currency = '₺') {
        if (!item) return;
        const symbol = item.change.startsWith('-') ? '📉' : '📈';
        text += `${emoji} *${title}*\n`;
        text += `   💵 Alış: *${item.buy} ${currency}*\n`;
        text += `   💰 Satış: *${item.sell} ${currency}*\n`;
        text += `   ${symbol} Değişim: %${item.change}\n\n`;
      }
      addBlock('Kur', '📊', kur);
      addBlock('Gram Altın', '🟡', gram);
      addBlock('Çeyrek Altın', '🪙', ceyrek);
      addBlock('Yarım Altın', '💎', yarim);
      addBlock('Tam Altın', '🏅', tam);
      const now = new Date().toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      text += `_📅 ${now}_`;
      text += '\nℹ Kaynak: _Kuyumcu Altın Verileri_';
      await message.edit(text.trim(), message.jid, loading.key);
    } catch (err) {
      console.error('Altın modülü hata:', err?.message || err);
      await message.edit(
        '⚠️ _Altın verileri alınırken hata oluştu._\n_Lütfen daha sonra tekrar deneyin._',
        message.jid,
        loading.key
      );
    }
  }
);

/*Module({
    pattern: 'ekle ?(.*)',
    fromMe: true,
    desc: Lang.ADD_DESC,
    warn: "Numaranız yasaklanabilir, dikkatlice kullanın.",
    use: 'group'
}, async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);

    let input = match[1] || (message.reply_message && message.reply_message.jid.split("@")[0]);
    if (!input) return await message.sendReply(Lang.NEED_USER);

    const admin = await isAdmin(message);
    if (!admin) return await message.sendReply(Lang.NOT_ADMIN);

    const rawNumbers = input.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);

    const numbers = rawNumbers.map(num => {
        return num
            .replace(/\+/g, '')
            .replace(/\D/g, '');
    });

    if (numbers.length === 0) return await message.sendReply("Geçerli bir numara bulunamadı.");

    for (let i = 0; i < numbers.length; i++) {
        const user = numbers[i] + "@s.whatsapp.net";
        try {
            const result = await message.client.groupAdd(user, message);
        } catch (err) {
            await message.sendReply(`❌ ${numbers[i]} eklenemedi: ${err.message || err}`);
        }

        if (i < numbers.length - 1) {
            const delay = Math.floor(Math.random() * 7000) + 3000;
            await new Promise(res => setTimeout(res, delay));
        }
    }
});
*/
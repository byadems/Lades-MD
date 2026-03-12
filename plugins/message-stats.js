const { isAdmin, mentionjid } = require("./utils");
const { ADMIN_ACCESS } = require("../config");
const { Module } = require("../main");
const {
  fetchFromStore,
  getTopUsers,
  getGlobalTopUsers,
} = require("../core/store");

function timeSince(date) {
  if (!date) return "Hiç";
  var seconds = Math.floor((new Date() - new Date(date)) / 1000);
  var interval = seconds / 31536000;
  if (interval > 1) {
    return Math.floor(interval) + " yıl önce";
  }
  interval = seconds / 2592000;
  if (interval > 1) {
    return Math.floor(interval) + " ay önce";
  }
  interval = seconds / 86400;
  if (interval > 1) {
    return Math.floor(interval) + " gün önce";
  }
  interval = seconds / 3600;
  if (interval > 1) {
    return Math.floor(interval) + " saat önce";
  }
  interval = seconds / 60;
  if (interval > 1) {
    return Math.floor(interval) + " dakika önce";
  }
  return Math.floor(seconds) + " saniye önce";
}

function parseDuration(value, unit) {
  const now = new Date();
  const short = /^\s*(\d+)\s*([dwmy])\s*$/i.exec(value || "");
  if (short) {
    value = short[1];
    unit = short[2];
  }

  const num = parseInt(value, 10);
  if (isNaN(num)) return null;

  const normalized = (unit || "").toLowerCase();
  let ms = null;
  if (["d", "g", "gün", "gun"].includes(normalized)) ms = num * 24 * 60 * 60 * 1000;
  else if (["w", "hafta"].includes(normalized)) ms = num * 7 * 24 * 60 * 60 * 1000;
  else if (["m", "ay"].includes(normalized)) ms = num * 30 * 24 * 60 * 60 * 1000;
  else if (["y", "yıl", "yil"].includes(normalized)) ms = num * 365 * 24 * 60 * 60 * 1000;
  if (!ms) return null;
  return new Date(now.getTime() - ms);
}


Module(
  {
    pattern: "mesajlar ?(.*)",
    fromMe: false,
    desc: "Grupta mesaj atan kullanıcıların mesaj sayılarını gösterir",
    usage:
      ".mesajlar (mesajı olan tüm üyeler)\n.mesajlar @etiket (belirli üye)",
    use: "group",
  },
  async (message, match) => {
    if (!message.isGroup)
      return await message.sendReply("_ℹ️ Bu bir grup komutudur!_");

    let adminAccesValidated = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (message.fromOwner || adminAccesValidated) {
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
        return await message.sendReply("_❌ Veritabanında mesajı olan üye bulunamadı._"
        );
      }

      let final_msg = `📊 _${usersWithMessages.length} üyenin gönderdiği mesajlar_\n_Mesaj sayısına göre sıralı (en yüksekten en düşüğe)_\n\n`;

      for (let userObj of usersWithMessages) {
        let user = userObj.jid;
        let userStat = userObj.stat;
        let count = userStat.totalMessages;
        let name = userStat.User?.name?.replace(/[\r\n]+/gm, "") || "Bilinmiyor";
        let lastMsg = timeSince(userStat.lastMessageAt);
        let types_msg = "\n";
        if (userStat.textMessages > 0)
          types_msg += `_Metin: *${userStat.textMessages}*_\n`;
        if (userStat.imageMessages > 0)
          types_msg += `_Görsel: *${userStat.imageMessages}*_\n`;
        if (userStat.videoMessages > 0)
          types_msg += `_Video: *${userStat.videoMessages}*_\n`;
        if (userStat.audioMessages > 0)
          types_msg += `_Ses: *${userStat.audioMessages}*_\n`;
        if (userStat.stickerMessages > 0)
          types_msg += `_Çıkartma: *${userStat.stickerMessages}*_\n`;
        if (userStat.otherMessages > 0)
          types_msg += `_Diğer: *${userStat.otherMessages}*_\n`;
        final_msg += `_Katılımcı: *+${
          user.split("@")[0]
        }*_\n_İsim: *${name}*_\n_Toplam mesaj: *${count}*_\n_Son mesaj: *${lastMsg}*_${types_msg}\n\n`;
      }

      return await message.sendReply(final_msg);
    }
  }
);

Module(
  {
    pattern: "üyetemizle ?(.*)",
    fromMe: false,
    desc: "Belirtilen süre boyunca mesaj atmayan üyeleri listeler veya çıkarır.",
    usage:
      ".üyetemizle 30d (30+ gündür pasif üyeler)\n.üyetemizle 10d kick (10+ gündür pasif üyeleri at)\n\nDesteklenen birimler: d (gün), w (hafta), m (ay), y (yıl)",
    use: "group",
  },
  async (message, match) => {
    if (!message.isGroup)
      return await message.sendReply("_ℹ️ Bu bir grup komutudur!_");

    let adminAccesValidated = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (message.fromOwner || adminAccesValidated) {
      if (!match[1]) {
        return await message.sendReply("_Kullanım:_\n" +
            "• `.üyetemizle 30d` - 30+ gündür pasif üyeleri göster\n" +
            "• `.üyetemizle 10d kick` - 10+ gündür pasif üyeleri at\n" +
            "• `.üyetemizle 2w` - 2+ haftadır pasif üyeleri göster\n" +
            "• `.üyetemizle 3m kick` - 3+ aydır pasif üyeleri at\n\n" +
            "_Desteklenen birimler:_ d (gün), w (hafta), m (ay), y (yıl)"
        );
      }

      const args = match[1].trim().split(/\s+/);
      const durationStr = args[0];
      const durationUnit = args[1];
      const shouldKick = args.includes("kick") || args.includes("çıkar");

      const cutoffDate = parseDuration(durationStr, durationUnit);
      if (!cutoffDate) {
        return await message.sendReply("_❌ Geçersiz süre formatı!_\n" + "_Örnekler:_ 30d, 2w, 3m, 1y veya 30 gün, 2 hafta"
        );
      }

      if (shouldKick) {
        var admin = await isAdmin(message);
        if (!admin)
          return await message.sendReply("_🔒 Üyeleri çıkarmak için botun yönetici yetkilerine ihtiyacı var!_"
          );
      }

      const groupMetadata = await message.client.groupMetadata(message.jid);
      const participants = groupMetadata.participants.map((e) => e.id);
      const userStats = await fetchFromStore(message.jid);

      let oldestMessageDate = null;
      if (userStats.length > 0) {
        const oldestStat = userStats.reduce((oldest, current) => {
          const currentDate = new Date(
            current.lastMessageAt || current.createdAt
          );
          const oldestDate = new Date(oldest.lastMessageAt || oldest.createdAt);
          return currentDate < oldestDate ? current : oldest;
        });
        oldestMessageDate = new Date(
          oldestStat.lastMessageAt || oldestStat.createdAt
        );
      }

      const dataWarning = oldestMessageDate && cutoffDate < oldestMessageDate;

      let inactiveMembers = [];
      for (let user of participants) {
        let userStat = userStats.find((stat) => stat.userJid === user);

        if (!userStat || !userStat.lastMessageAt) {
          inactiveMembers.push({
            jid: user,
            name: userStat?.User?.name?.replace(/[\r\n]+/gm, "") || "Bilinmeyen",
            lastMessage: "Hiç",
            totalMessages: userStat?.totalMessages || 0,
          });
        } else {
          const lastMessageDate = new Date(userStat.lastMessageAt);
          if (lastMessageDate < cutoffDate) {
            inactiveMembers.push({
              jid: user,
              name: userStat.User?.name?.replace(/[\r\n]+/gm, "") || "Bilinmeyen",
              lastMessage: timeSince(userStat.lastMessageAt),
              totalMessages: userStat.totalMessages,
            });
          }
        }
      }

      if (shouldKick) {
        const botId =
          message.client.user?.lid?.split(":")[0] + "@lid" ||
          message.client.user.id.split(":")[0] + "@s.whatsapp.net";
        inactiveMembers = inactiveMembers.filter((member) => {
          const participant = groupMetadata.participants.find(
            (p) => p.id === member.jid
          );
          return !participant?.admin && member.jid !== botId;
        });
      }

      if (inactiveMembers.length === 0) {
        return await message.sendReply(
          `_Belirtilen süre için pasif üye bulunamadı (${durationStr}${durationUnit ? " " + durationUnit : ""})._`
        );
      }

      let responseMsg = `👥 _Aktif olmayan üyeler (${durationStr}${durationUnit ? " " + durationUnit : ""}+):_ *${inactiveMembers.length}*\n\n`;

      if (dataWarning) {
        responseMsg += `⚠️ _Uyarı: Veritabanında sadece ${timeSince(
          oldestMessageDate
        )} tarihinden itibaren veri var. Bu tarihten önce aktif olan üyeler pasif görünebilir._\n\n`;
      }

      if (shouldKick) {
        responseMsg += `_❗❗ ${inactiveMembers.length} pasif üye gruptan atılıyor. Bu işlem geri alınamaz! ❗❗_\n\n`;

        for (let i = 0; i < Math.min(inactiveMembers.length, 10); i++) {
          const member = inactiveMembers[i];
          responseMsg += `${i + 1}. @${member.jid.split("@")[0]} (${
            member.name
          })\n`;
        }

        if (inactiveMembers.length > 10) {
          responseMsg += `... ve ${inactiveMembers.length - 10} kişi daha\n`;
        }

        responseMsg += `\n_5 saniye içinde atma işlemi başlayacak..._`;

        await message.client.sendMessage(message.jid, {
          text: responseMsg,
          mentions: inactiveMembers.map((m) => m.jid),
        });

        await new Promise((r) => setTimeout(r, 5000));

        let kickCount = 0;
        for (let member of inactiveMembers) {
          try {
            await new Promise((r) => setTimeout(r, 2000));
            await message.client.groupParticipantsUpdate(
              message.jid,
              [member.jid],
              "remove"
            );
            kickCount++;

            if (kickCount % 5 === 0) {
              await message.send(
                `_${kickCount}/${inactiveMembers.length} üye atıldı..._`
              );
            }
          } catch (error) {
            console.error(`${member.jid} gruptan atılamadı:`, error);
          }
        }

        return await message.send(
          `_✅ ${kickCount}/${inactiveMembers.length} pasif üye atıldı._`
        );
      } else {
        for (let i = 0; i < inactiveMembers.length; i++) {
          const member = inactiveMembers[i];
          responseMsg += `${i + 1}. @${member.jid.split("@")[0]}\n`;
          responseMsg += `   _İsim:_ ${member.name}\n`;
          responseMsg += `   _Son mesaj:_ ${member.lastMessage}\n`;
          responseMsg += `   _Toplam mesaj:_ ${member.totalMessages}\n\n`;
        }

        responseMsg += `_Bu üyeleri atmak için \`.üyetemizle ${durationStr} kick\` kullanın._`;

        return await message.client.sendMessage(message.jid, {
          text: responseMsg,
          mentions: inactiveMembers.map((m) => m.jid),
        });
      }
    }
  }
);

Module(
  {
    pattern: "users ?(.*)",
    fromMe: true,
    desc: "Mesaj sayısına göre en iyi kullanıcıları gösterir.",
    usage:
      ".users (shows top 10 users - global in DM, chat-specific in gruplar)\n.users global (shows global top users)\n.users 20 (shows top 20 users)\n.users global 15 (shows top 15 global users)",
    use: "utility",
  },
  async (message, match) => {
    let adminAccesValidated =
      ADMIN_ACCESS && message.isGroup
        ? await isAdmin(message, message.sender)
        : false;
    if (message.fromOwner || adminAccesValidated) {
      let limit = 10;
      let isGlobal = false;

      if (match[1]) {
        const args = match[1].trim().split(" ");

        if (args.includes("global")) {
          isGlobal = true;

          const limitArg = args.find(
            (arg) => arg !== "global" && !isNaN(parseInt(arg))
          );
          if (limitArg) {
            const parsedLimit = parseInt(limitArg);
            if (parsedLimit > 0 && parsedLimit <= 50) {
              limit = parsedLimit;
            } else if (parsedLimit > 50) {
              return await message.sendReply("_👤 Maksimum sınır 50 kullanıcıdır._");
            }
          }
        } else {
          const parsedLimit = parseInt(args[0]);
          if (parsedLimit && parsedLimit > 0 && parsedLimit <= 50) {
            limit = parsedLimit;
          } else if (parsedLimit > 50) {
            return await message.sendReply("_👤 Maksimum sınır 50 kullanıcıdır._");
          } else if (parsedLimit <= 0) {
            return await message.sendReply("_⚠️ Sınır pozitif bir sayı olmalıdır._"
            );
          }
        }
      }

      if (!message.isGroup && !match[1]?.includes("chat")) {
        isGlobal = true;
      }

      try {
        let topUsers;
        let scopeText;

        if (isGlobal) {
          topUsers = await getGlobalTopUsers(limit);
          scopeText = "global";
        } else {
          topUsers = await getTopUsers(message.jid, limit);
          scopeText = message.isGroup ? "group" : "chat";
        }

        if (topUsers.length === 0) {
          return await message.sendReply(
            `📊 _${scopeText} istatistikleri için veritabanında kullanıcı verisi bulunamadı._`
          );
        }

        let responseMsg = `_Mesaj sayısına göre en iyi ${topUsers.length} ${scopeText} kullanıcı_\n\n`;

        for (let i = 0; i < topUsers.length; i++) {
          const user = topUsers[i];
          const rank = i + 1;
          const name = user.name?.replace(/[\r\n]+/gm, "") || "Bilinmiyor";
          const lastMessage = timeSince(user.lastMessageAt);

          responseMsg += `*${rank}.* @${user.jid.split("@")[0]}\n`;
          responseMsg += `   _İsim:_ ${name}\n`;
          responseMsg += `   _Mesajlar:_ ${user.totalMessages}${
            isGlobal ? " (tüm sohbetlerde)" : ""
          }\n`;
          responseMsg += `   _Son görülme:_ ${lastMessage}\n\n`;
        }

        if (isGlobal) {
          responseMsg += `\n_💡 İpucu: Sadece mevcut sohbet istatistikleri için \`.users chat\` kullanın._`;
        } else if (message.isGroup) {
          responseMsg += `\n_💡 İpucu: Tüm sohbetlerdeki genel istatistikler için \`.users global\` kullanın._`;
        }

        const mentions = topUsers.map((user) => user.jid);

        return await message.client.sendMessage(message.jid, {
          text: responseMsg,
          mentions: mentions,
        });
      } catch (error) {
        console.error("Kullanıcılar komutunda hata:", error);
        return await message.sendReply("_⚠️ Kullanıcı verisi alınamadı. Lütfen tekrar deneyin._"
        );
      }
    }
  }
);

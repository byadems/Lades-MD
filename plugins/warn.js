const { Module } = require("../main");
const { ADMIN_ACCESS, HANDLERS, WARN, SUDO } = require("../config");
const {
  isAdmin,
  getWarn,
  setWarn,
  resetWarn,
  decrementWarn,
  getWarnCount,
  getAllWarns,
} = require("./utils");

const handler = HANDLERS !== "false" ? HANDLERS.split("")[0] : "";
const warnLimit = parseInt(WARN || 4);
const sudoUsers = (SUDO || "").split(",");

Module(
  {
    pattern: "warn ?(.*)",
    fromMe: false,
    desc: "Gruptaki bir kullanıcıyı uyarır. Sınıra ulaştığında atılır.",
    usage: ".warn @user reason\n.warn reply reason",
    use: "group",
  },
  async (message, match) => {
    if (!match[0].split(" ")[0]?.toLowerCase().endsWith("warn")) return;
    if (!message.isGroup)
      return await message.sendReply("_ℹ️ Bu sadece gruplarda kullanılabilen bir komuttur!_");

    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;

    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) {
      return await message.sendReply("_⚠️ Uyarıları yönetmek için yönetici yetkilerine ihtiyacım var!_"
      );
    }

    const targetUser = message.mention?.[0] || message.reply_message?.jid;
    if (!targetUser) {
      return await message.sendReply(`_💬 Lütfen bir kullanıcıdan bahsedin veya mesajını yanıtlayın!_\n\n` +
          `*Kullanım:*\n` +
          `• \`${handler}warn @user reason\`\n` +
          `• \`${handler}warn reply reason\`\n` +
          `• \`${handler}uyarı @user\` - Uyarıları kontrol et\n` +
          `• \`${handler}rmwarn @user\` - Bir uyarıyı kaldır\n` +
          `• \`${handler}resetwarn @user\` - Tüm uyarıları kaldır\n` +
          `• \`${handler}warnlist\` - Tüm uyarılanları listele`
      );
    }

    const isTargetAdmin = await isAdmin(message, targetUser);
    if (isTargetAdmin) {
      return await message.sendReply("_⚠️ Grup yöneticileri uyarılamaz!_");
    }

    const targetNumericId = targetUser?.split("@")[0];
    if (sudoUsers.includes(targetNumericId)) {
      return await message.sendReply("_🔍 Bot sahiplerini/yöneticileri uyaramazsınız!_");
    }

    let rawReason = match[1] || "Sebep belirtilmedi";
    const mentionRegex = new RegExp(`@${targetNumericId}\\s*`, "g");
    const reason =
      rawReason.replace(mentionRegex, "").trim() || "Sebep belirtilmedi";

    try {
      await setWarn(message.jid, targetUser, reason, message.sender);

      const warnData = await getWarn(message.jid, targetUser, warnLimit);
      const currentWarns = warnData.current;
      const kalan = warnData.kalan;

      if (warnData.exceeded) {
        try {
          await message.client.groupParticipantsUpdate(
            message.jid,
            [targetUser],
            "remove"
          );

          await message.client.sendMessage(message.jid, {
            text: `⚠ *Kullanıcı Gruptan Çıkarıldı!*\n\n` +
              `- Kullanıcı: \`@${targetNumericId}\`\n` +
              `- Sebep: \`${reason}\`\n` +
              `- Uyarılar: \`${currentWarns}/${warnLimit} (SINIR AŞILDI)\`\n` +
              `- İşlem: \`Gruptan çıkarıldı\`\n\n` +
              `_Kullanıcı uyarı sınırını aştığı için atıldı._`,
            mentions: [targetUser],
          });
        } catch (kickError) {
          await message.client.sendMessage(message.jid, {
            text: `⚠ *Uyarı Sınırı Aşıldı!*\n\n` +
              `- Kullanıcı: \`@${targetNumericId}\`\n` +
              `- Uyarılar: \`${currentWarns}/${warnLimit}\`\n` +
              `- Hata: \`Kullanıcı atılamadı\`\n\n` +
              `_Lütfen kullanıcıyı elle çıkarın veya yönetici izinlerimi kontrol edin._`,
            mentions: [targetUser],
          });
        }
      } else {
        await message.client.sendMessage(message.jid, {
          text: `⚠ *Kullanıcı Uyarıldı!*\n\n` +
            `- Kullanıcı: \`@${targetNumericId}\`\n` +
            `- Sebep: \`${reason}\`\n` +
            `- Uyarılar: \`${currentWarns}/${warnLimit}\`\n` +
            `- Kalan: \`${kalan}\`\n\n` +
            `${
              kalan === 1
                ? "_Sonraki uyarı atılmayla sonuçlanacak!_"
                : `_${kalan} uyarı daha kaldı._`
            }`,
          mentions: [targetUser],
        });
      }
    } catch (error) {
      console.error("Uyarı hatası:", error);
      await message.sendReply("_⚠️ Uyarı eklenemedi! Lütfen tekrar deneyin._");
    }
  }
);

Module(
  {
    pattern: "uyarı ?(.*)",
    fromMe: false,
    desc: "Bir kullanıcının uyarılarını kontrol eder",
    usage: ".uyarı @user\n.uyarı reply",
    use: "group",
  },
  async (message, match) => {
    if (!message.isGroup)
      return await message.sendReply("_ℹ️ Bu sadece gruplarda kullanılabilen bir komuttur!_");

    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;

    const targetUser =
      message.mention?.[0] || message.reply_message?.jid || message.sender;
    const targetNumericId = targetUser?.split("@")[0];

    try {
      const uyarı = await getWarn(message.jid, targetUser);

      if (!uyarı || uyarı.length === 0) {
        return await message.client.sendMessage(message.jid, {
          text: `✓ *Uyarı Yok*\n\n` +
            `- Kullanıcı: \`@${targetNumericId}\`\n` +
            `- Durum: \`Temiz sicil\`\n` +
            `- Uyarılar: \`0/${warnLimit}\``,
          mentions: [targetUser],
        });
      }

      const currentWarns = uyarı.length;
      const kalan = warnLimit - currentWarns;

      let uyarıList = `📋 *Uyarı Geçmişi*\n\n`;
      uyarıList += `- Kullanıcı: \`@${targetNumericId}\`\n`;
      uyarıList += `- Toplam Uyarılar: \`${currentWarns}/${warnLimit}\`\n`;
      uyarıList += `- Kalan: \`${kalan > 0 ? kalan : 0}\`\n\n`;

      uyarı.slice(0, 5).forEach((warn, index) => {
        const date = new Date(warn.timestamp).toLocaleString();
        const warnedByNumeric = warn.warnedBy?.split("@")[0];
        uyarıList += `*${index + 1}.* ${warn.reason}\n`;
        uyarıList += `   _Uyaran: @${warnedByNumeric}_\n`;
        uyarıList += `   _Tarih: ${date}_\n\n`;
      });

      if (uyarı.length > 5) {
        uyarıList += `_... ve ${uyarı.length - 5} daha fazla uyarı_\n\n`;
      }

      if (kalan <= 0) {
        uyarıList += `⚠ _Kullanıcı uyarı sınırını aştı!_`;
      } else if (kalan === 1) {
        uyarıList += `⚠ _Sonraki uyarı atılmayla sonuçlanacak!_`;
      }

      await message.client.sendMessage(message.jid, {
        text: uyarıList,
        mentions: [targetUser, ...uyarı.slice(0, 5).map((w) => w.warnedBy)],
      });
    } catch (error) {
      console.error("Uyarı kontrol hatası:", error);
      await message.sendReply("_⚠️ Uyarılar alınamadı!_");
    }
  }
);

Module(
  {
    pattern: "rmwarn ?(.*)",
    fromMe: false,
    desc: "Kullanıcıdan bir uyarıyı siler",
    usage: ".rmwarn @user\n.rmwarn reply",
    use: "group",
  },
  async (message, match) => {
    if (!message.isGroup)
      return await message.sendReply("_ℹ️ Bu sadece gruplarda kullanılabilen bir komuttur!_");

    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;

    const targetUser = message.mention?.[0] || message.reply_message?.jid;
    if (!targetUser) {
      return await message.sendReply("_💬 Lütfen bir kullanıcıdan bahsedin veya mesajını yanıtlayın!_"
      );
    }

    const targetNumericId = targetUser?.split("@")[0];

    try {
      const currentCount = await getWarnCount(message.jid, targetUser);

      if (currentCount === 0) {
        return await message.client.sendMessage(message.jid, {
          text: "ℹ *Uyarı Yok*\n\n" +
            "- Kullanıcı: `@" +
            targetNumericId +
            "`\n" +
            "- Durum: `Kaldırılacak uyarı yok`",
          mentions: [targetUser],
        });
      }

      const removed = await decrementWarn(message.jid, targetUser);

      if (removed) {
        const newCount = await getWarnCount(message.jid, targetUser);
        await message.client.sendMessage(message.jid, {
          text: "✓ *Uyarı Kaldırıldı!*\n\n" +
            "- Kullanıcı: `@" +
            targetNumericId +
            "`\n" +
            "- Kaldırıldı: `1 uyarı`\n" +
            "- Kalan: `" +
            newCount +
            " uyarı`\n" +
            "- Durum: `" +
            (newCount === 0 ? "Temiz sicil" : "Hâlâ uyarıları var") +
            "`",
          mentions: [targetUser],
        });
      } else {
        await message.sendReply("_❌ Uyarı kaldırılamadı!_");
      }
    } catch (error) {
      console.error("Uyarı kaldırma hatası:", error);
      await message.sendReply("_❌ Uyarı kaldırılamadı!_");
    }
  }
);

Module(
  {
    pattern: "resetwarn ?(.*)",
    fromMe: false,
    desc: "Kullanıcının tüm uyarılarını sıfırlar",
    usage: ".resetwarn @user\n.resetwarn reply",
    use: "group",
  },
  async (message, match) => {
    if (!message.isGroup)
      return await message.sendReply("_ℹ️ Bu sadece gruplarda kullanılabilen bir komuttur!_");

    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) {
      return await message.sendReply("_🔒 Uyarıları sıfırlamak için yönetici ayrıcalıklarına ihtiyacınız var!_"
      );
    }

    const targetUser = message.mention?.[0] || message.reply_message?.jid;
    if (!targetUser) {
      return await message.sendReply("_💬 Lütfen bir kullanıcıdan bahsedin veya mesajını yanıtlayın!_"
      );
    }

    const targetNumericId = targetUser?.split("@")[0];

    try {
      const currentCount = await getWarnCount(message.jid, targetUser);

      if (currentCount === 0) {
        return await message.client.sendMessage(message.jid, {
          text: "ℹ *Uyarı Yok*\n\n" +
            "- Kullanıcı: `@" +
            targetNumericId +
            "`\n" +
            "- Durum: `Sıfırlanacak uyarı yok`",
          mentions: [targetUser],
        });
      }

      const removed = await resetWarn(message.jid, targetUser);

      if (removed) {
        await message.client.sendMessage(message.jid, {
          text: "✓ *Uyarılar Sıfırlandı!*\n\n" +
            "- Kullanıcı: `@" +
            targetNumericId +
            "`\n" +
            "- Kaldırıldı: `" +
            currentCount +
            " uyarı`\n" +
            "- Durum: `Temiz sicil`",
          mentions: [targetUser],
        });
      } else {
        await message.sendReply("_⚠️ Uyarılar sıfırlanamadı!_");
      }
    } catch (error) {
      console.error("Uyarı sıfırlama hatası:", error);
      await message.sendReply("_⚠️ Uyarılar sıfırlanamadı!_");
    }
  }
);

Module(
  {
    pattern: "warnlist",
    fromMe: false,
    desc: "Gruptaki tüm uyarılan kullanıcıları listeler",
    usage: ".warnlist",
    use: "group",
  },
  async (message) => {
    if (!message.isGroup)
      return await message.sendReply("_ℹ️ Bu sadece gruplarda kullanılabilen bir komuttur!_");

    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) {
      return await message.sendReply("_🔒 Uyarı listesini görüntülemek için yönetici yetkilerine ihtiyacınız var!_"
      );
    }

    try {
      const allWarnings = await getAllWarns(message.jid);

      if (Object.keys(allWarnings).length === 0) {
        return await message.sendReply(`✓ *Temiz Grup!*\n\n` +
            `- Bu grupta hiçbir kullanıcının uyarısı yok.\n` +
            `_Herkes kurallara uyuyor!_`
        );
      }

      let warnList = `📋 *Grup Uyarı Listesi*\n\n`;
      warnList += `- Uyarı Sınırı: \`${warnLimit}\`\n\n`;

      const sortedUsers = Object.entries(allWarnings).sort(
        ([, a], [, b]) => b.length - a.length
      );

      let mentions = [];

      sortedUsers.forEach(([userJid, userWarnings], index) => {
        const userNumericId = userJid?.split("@")[0];
        const warnCount = userWarnings.length;
        const kalan = warnLimit - warnCount;
        const status =
          kalan <= 0
            ? "⚠ SINIR AŞILDI"
            : kalan === 1
            ? "⚠ SON UYARI"
            : `✓ ${kalan} kalan`;

        warnList += `*${index + 1}.* @${userNumericId}\n`;
        warnList += `   _Uyarılar: \`${warnCount}/${warnLimit}\`_\n`;
        warnList += `   _Durum: \`${status}\`_\n`;

        if (userWarnings.length > 0) {
          const latestWarning = userWarnings[0];
          warnList += `   _Son: \`${latestWarning.reason.substring(0, 30)}${
            latestWarning.reason.length > 30 ? "..." : ""
          }\`_\n`;
        }
        warnList += "\n";

        mentions.push(userJid);
      });

      warnList += `_Toplam uyarılan kullanıcı: ${sortedUsers.length}_\n`;
      warnList += `_Detaylı geçmiş için ${handler}uyarı @user kullanın_`;

      await message.client.sendMessage(message.jid, {
        text: warnList,
        mentions,
      });
    } catch (error) {
      console.error("Uyarı listeleme hatası:", error);
      await message.sendReply("_❌ Uyarı listesi alınamadı!_");
    }
  }
);

Module(
  {
    pattern: "setwarnlimit ?(.*)",
    fromMe: true,
    desc: "Grup için uyarı sınırını ayarlar",
    usage: ".setwarnlimit 5",
    use: "group",
  },
  async (message, match) => {
    const newLimit = parseInt(match[1]);

    if (!newLimit || newLimit < 1 || newLimit > 20) {
      return await message.sendReply(`⚠ *Geçersiz Uyarı Sınırı*\n\n` +
          `- Lütfen 1 ile 20 arasında bir sayı girin.\n` +
          `- Mevcut sınır: \`${warnLimit}\`\n\n` +
          `*Kullanım:* \`${handler}setwarnlimit 5\``
      );
    }

    try {
      await message.sendReply(`✓ *Uyarı Sınırı Güncellendi!*\n\n` +
          `- Yeni sınır: \`${newLimit} uyarı\`\n` +
          `- Önceki sınır: \`${warnLimit}\`\n\n` +
          `_Kullanıcılar artık ${newLimit} uyarı sonrasında atılacak._`
      );
    } catch (error) {
      console.error("Uyarı limiti ayarlama hatası:", error);
      await message.sendReply("_❌ Uyarı sınırı güncellenemedi!_");
    }
  }
);

Module(
  {
    pattern: "warnstats",
    fromMe: false,
    desc: "Grup için uyarı istatistiklerini gösterir",
    usage: ".warnstats",
    use: "group",
  },
  async (message) => {
    if (!message.isGroup)
      return await message.sendReply("_ℹ️ Bu sadece gruplarda kullanılabilen bir komuttur!_");

    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) {
      return await message.sendReply("_🔒 Uyarı istatistiklerini görüntülemek için yönetici ayrıcalıklarına ihtiyacınız var!_"
      );
    }

    try {
      const allWarnings = await getAllWarns(message.jid);

      const totalUsers = Object.keys(allWarnings).length;
      const totalWarnings = Object.values(allWarnings).reduce(
        (sum, uyarı) => sum + uyarı.length,
        0
      );

      let atLimit = 0;
      let nearLimit = 0;
      let safe = 0;

      Object.values(allWarnings).forEach((userWarnings) => {
        const count = userWarnings.length;
        if (count >= warnLimit) atLimit++;
        else if (count >= warnLimit - 1) nearLimit++;
        else safe++;
      });

      const stats =
        `📊 *Grup Uyarı İstatistikleri*\n\n` +
        `- Uyarı Sınırı: \`${warnLimit}\`\n` +
        `- Toplam Uyarılan Kullanıcı: \`${totalUsers}\`\n` +
        `- Verilen Toplam Uyarı: \`${totalWarnings}\`\n\n` +
        `*Kullanıcı Durumu:*\n` +
        `- ⚠ Sınırda: \`${atLimit}\`\n` +
        `- ⚠ Sınıra Yakın: \`${nearLimit}\`\n` +
        `- ✓ Güvende: \`${safe}\`\n\n` +
        `_Detaylı liste için ${handler}warnlist kullanın_`;

      await message.sendReply(stats);
    } catch (error) {
      console.error("Uyarı istatistik hatası:", error);
      await message.sendReply("_❌ Uyarı istatistikleri alınamadı!_");
    }
  }
);

const { commands, Module } = require("../main");
const { MODE, HANDLERS, ALIVE, VERSION } = require("../config");
const config = require("../config");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { uploadToImgbb } = require("./utils/upload");
const { setVar } = require("./manage");
const { getTotalUserCount } = require("../core/store");
const { parseAliveMessage, sendAliveMessage } = require("./utils/alive-parser");

const isPrivateMode = MODE === "private";

const extractCommandName = (pattern) => {
  // Türkçe karakterler dahil: ıİşŞğĞüÜöÖçÇ (Unicode)
  const match = pattern?.toString().match(/(\W*)([A-Za-z0-9\u0130\u0131\u015E\u015F\u011E\u011F\u00FC\u00DC\u00F6\u00D6\u00E7\u00C7\s]*)/u);
  return match && match[2] ? match[2].trim() : "";
};

const retrieveCommandDetails = (commandName) => {
  const foundCommand = commands.find(
    (cmd) => extractCommandName(cmd.pattern) === commandName
  );
  if (!foundCommand) return null;
  return {
    name: commandName,
    ...foundCommand,
  };
};

Module(
  {
    pattern: "info ?(.*)",
    fromMe: isPrivateMode,
    desc: "Komut bilgisini verir",
  },
  async (message, args) => {
    const commandName = args[1]?.trim();
    if (!commandName) {
      return await message.sendReply("_⚠️ Lütfen bir komut adı girin. Örnek: .info insta_"
      );
    }

    const commandDetails = retrieveCommandDetails(commandName);
    if (!commandDetails) {
      return await message.sendReply(
        `_❌ '${commandName}' komutu bulunamadı. Yazımı kontrol edin._`
      );
    }

    let infoMessage = `*📋 ───「 Komut Detayları 」───*\n\n`;
    infoMessage += `• *Komut:* \`${commandDetails.name}\`\n`;
    infoMessage += `• *Açıklama:* ${commandDetails.desc || "Yok"}\n`;
    infoMessage += `• *Sahip Komutu:* ${
      commandDetails.fromMe ? "Evet" : "Hayır"
    }\n`;
    if (commandDetails.use) infoMessage += `• *Tür:* ${commandDetails.use}\n`;
    if (commandDetails.usage)
      infoMessage += `• *Kullanım:* ${commandDetails.name} ${commandDetails.usage}\n`;
    if (commandDetails.warn)
      infoMessage += `• *Uyarı:* ${commandDetails.warn}\n`;

    await message.sendReply(infoMessage);
  }
);

Module(
  {
    pattern: "list ?(.*)",
    fromMe: isPrivateMode,
    excludeFromCommands: true,
  },
  async (message, args) => {
    const availableCommands = commands.filter(
      (cmd) => !cmd.excludeFromCommands && !cmd.dontAddCommandList && cmd.pattern
    );
    const totalCommandCount = availableCommands.length;

    const categorizedCommands = {};
    availableCommands.forEach((cmd) => {
      const category = cmd.use || "Genel";
      if (!categorizedCommands[category]) {
        categorizedCommands[category] = [];
      }
      const commandName = extractCommandName(cmd.pattern);
      if (commandName) {
        categorizedCommands[category].push({
          name: commandName,
          desc: cmd.desc,
          usage: cmd.usage,
          warn: cmd.warn,
        });
      }
    });

    let responseMessage = `*📋 Toplam Mevcut Komut: ${totalCommandCount}*\n\n`;
    const handlerPrefix = HANDLERS.match(/\[(\W*)\]/)?.[1]?.[0] || ".";

    for (const category in categorizedCommands) {
      responseMessage += `*───「 ${category.toUpperCase()} 」───*\n\n`;
      categorizedCommands[category].forEach((cmd) => {
        responseMessage += `• \`${handlerPrefix}${cmd.name}\`\n`;
        if (cmd.desc) responseMessage += `  _Açıklama:_ ${cmd.desc}\n`;
        if (cmd.usage) responseMessage += `  _Kullanım:_ ${cmd.usage}\n`;
        if (cmd.warn) responseMessage += `  _Uyarı:_ ${cmd.warn}\n`;
        responseMessage += "\n";
      });
    }
    await message.sendReply(responseMessage);
  }
);

function bytesToSize(bytes) {
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "0 Byte";
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return Math.round(bytes / Math.pow(1024, i), 2) + " " + sizes[i];
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function parseAlive(message, aliveMessage) {
  if (!aliveMessage) {
    const defaultAliveMessage = "🟢 Çevrimiçiyim!";
    return await message.sendReply(defaultAliveMessage);
  }

  if (aliveMessage.includes("$")) {
    const parsedMessage = await parseAliveMessage(aliveMessage, message);
    if (parsedMessage) {
      await sendAliveMessage(message, parsedMessage);
    } else {
      await message.sendReply(aliveMessage);
    }
  } else {
    await message.sendReply(aliveMessage);
  }
}

const manage = {
  setVar: async (key, value, message) => {
    await message.sendReply(
      `_ℹ️ ${key} değeri ${value} olarak ayarlanmaya çalışıldı. (Not: Bu bir demo ve değişiklikler kalıcı değildir)_`
    );
  },
};

Module(
  {
    pattern: "alive",
    fromMe: isPrivateMode,
    desc: "Botun çevrimiçi olup olmadığını kontrol eder.",
  },
  async (message, match) => {
    await parseAlive(message, ALIVE);
  }
);

Module(
  {
    pattern: "setalive ?(.*)",
    fromMe: true,
    desc: "Bot için çevrimiçi (alive) mesajı ayarlar.",
    usage:
      ".setalive <message> (with placeholders)\n.setalive help (show formatting help)",
    dontAddCommandList: true,
  },
  async (message, match) => {
    if (!match[1]) {
      return await message.sendReply(`*📝 Çevrimiçi Mesaj Ayarları*

*Kullanım:*
• \`.setalive <mesaj>\` - Çevrimiçi mesajı ayarla
• \`.setalive help\` - Biçimlendirme yardımını göster
• \`.setalive get\` - Mevcut çevrimiçi mesajı görüntüle
• \`.setalive del\` - Özel çevrimiçi mesajı sil
• \`.testalive\` - Mevcut çevrimiçi mesajı test et

*Hızlı Örnek:*
\`.setalive Merhaba $user! $botname çevrimiçi!
_Sürüm: $version_
_Çalışma süresi: $uptime_
_Kullanıcılar: $users_ $pp\`

*Tüm yer tutucular için \`.setalive help\` kullanın.*`);
    }

    const input = match[1].toLowerCase();

    if (input === "help") {
      const helpText = `*📖 Çevrimiçi Mesaj Biçimlendirme Yardımı*

*Kullanılabilir Yer Tutucular:*

*Bot Bilgileri:*
• \`$botname\` - Botun görünen adı
• \`$owner\` - Bot sahibi adı
• \`$version\` - Bot sürümü
• \`$mode\` - Bot modu (özel/genel)
• \`$server\` - Sunucu işletim sistemi
• \`$uptime\` - Bot çalışma süresi

*Sistem Bilgileri:*
• \`$ram\` - Kullanılabilir RAM
• \`$totalram\` - Toplam RAM
• \`$users\` - Veritabanındaki toplam kullanıcı

*Kullanıcı Bilgileri:*
• \`$user\` - Gönderenin adı
• \`$number\` - Gönderenin numarası
• \`$date\` - Güncel tarih
• \`$time\` - Güncel saat

*Medya Seçenekleri:*
• \`$pp\` - Gönderenin profil fotoğrafı
• \`$media:url\` - Özel görsel/video URL'si

*Örnek Mesajlar:*

*Basit:*
\`Merhaba $user! $botname çevrimiçi!\`

*Detaylı:*
\`*$botname Durumu*
_Merhaba $user!_
*İstatistikler:*
• _Sürüm: $version_
• _Mod: $mode_
• _Çalışma süresi: $uptime_
• _Kullanıcılar: $users_
• _RAM: $ram/$totalram_
*Tarih:* _$date saat $time_ $pp\`

*Özel Medya ile:*
\`$botname çevrimiçi! $media:https://example.com/image.jpg\`

*Video ile (otomatik gif oynatma):*
\`Bot durumu: Aktif! $media:https://example.com/video.mp4\`

*Notlar:*
• Mesajlar 2000 karakterle sınırlıdır
• Videolar otomatik GIF olarak oynar
• \`$pp\` gönderenin profil fotoğrafını içerir
• \`$media:\` içindeki URL'ler doğrudan bağlantı olmalıdır
• Çok kelimeli mesajlar için tırnak kullanın`;

      return await message.sendReply(helpText);
    }

    if (input === "get") {
      const current = ALIVE;
      if (!current) {
        return await message.sendReply("_⚙️ Özel çevrimiçi mesajı ayarlanmadı! Varsayılan mesaj kullanılıyor._"
        );
      }
      return await message.sendReply(
        `*📄 Mevcut Çevrimiçi Mesaj:*\n\n${current}\n\n_💡 İpucu: Mesajınızı test etmek için_ \`.testalive\` _kullanın!_`
      );
    }

    if (input === "del" || input === "delete") {
      await setVar("ALIVE", "");
      return await message.sendReply("_🗑️ Özel çevrimiçi mesaj silindi! Bot varsayılan mesajı kullanacak._"
      );
    }

    const aliveMessage = match[1];
    if (aliveMessage.length > 2000) {
      return await message.sendReply("_⚠️ Çevrimiçi mesajı çok uzun! Lütfen 2000 karakterin altında tutun._"
      );
    }

    await setVar("ALIVE", aliveMessage);
    return await message.sendReply(
      `_✅ Çevrimiçi mesaj başarıyla ayarlandı!_\n\n*📋 Önizleme:*\n${aliveMessage}\n\n_💡 İpucu: Mesajınızı test etmek için_ \`.testalive\` _kullanın!_`
    );
  }
);

Module(
  {
    pattern: "menu",
    fromMe: isPrivateMode,
    use: "utility",
    desc: "Bot komut menüsünü gösterir.",
  },
  async (message, match) => {
    const stars = ["✦", "✯", "✯", "✰", "◬"];
    const star = stars[Math.floor(Math.random() * stars.length)];

    const visibleCommands = commands.filter(
      (cmd) =>
        cmd.pattern &&
        !cmd.excludeFromCommands &&
        !cmd.dontAddCommandList
    );
    let use_ = visibleCommands.map((e) => e.use);
    const others = (use) => {
      return use === "" ? "diğer" : use;
    };
    let types = [
      ...new Set(
        visibleCommands.map((e) => e.use || "Genel")
      ),
    ];

    let cmd_obj = {};
    for (const command of visibleCommands) {
      let type_det = command.use || "Genel";
      if (!cmd_obj[type_det]?.length) cmd_obj[type_det] = [];
      let cmd_name = extractCommandName(command.pattern);
      if (cmd_name) cmd_obj[type_det].push(cmd_name);
    }

    let final = "";
    let i = 0;
    const handlerPrefix = HANDLERS !== "false" ? HANDLERS.split("")[0] : "";
    for (const n of types) {
      for (const x of cmd_obj[n]) {
        i = i + 1;
        const newn = n.charAt(0).toUpperCase() + n.slice(1);
        final += `${
          final.includes(newn) ? "" : "\n\n╭════〘 *_`" + newn + "`_* 〙════⊷❍"
        }\n┃${star}│ _\`${i}.\` ${handlerPrefix}${x.trim()}_${
          cmd_obj[n]?.indexOf(x) === cmd_obj[n]?.length - 1
            ? `\n┃${star}╰─────────────────❍\n╰══════════════════⊷❍`
            : ""
        }`;
      }
    }

    let cmdmenu = final.trim();
    const used = bytesToSize(os.freemem());
    const total = bytesToSize(os.totalmem());
    const totalUsers = await getTotalUserCount();
    const infoParts = config.BOT_INFO.split(";");
    const botName = infoParts[0] || "Botum";
    const botOwner = infoParts[1] || "Belirtilmedi";
    const botVersion = VERSION;
    // Görsel URL: 4 parçalı (ad;sahip;telefon;url) veya 3 parçalı (ad;sahip;url) format desteklenir
    const imagePart = infoParts.find((p) => (p || "").trim().startsWith("http"));
    let botImageLink = (imagePart || infoParts[2] || "").trim();
    const isVarsayilan =
      !botImageLink ||
      botImageLink === "default" ||
      botImageLink === "varsayılan" ||
      !botImageLink.startsWith("http");
    const defaultLogoPath = path.join(__dirname, "utils", "images", "default.png");
    let imagePayload;
    if (isVarsayilan && fs.existsSync(defaultLogoPath)) {
      imagePayload = fs.readFileSync(defaultLogoPath);
    } else if (isVarsayilan) {
      imagePayload = { url: "https://i.ibb.co/0Rb3CrkM/Lades-Bot-Logo.png" };
    } else {
      imagePayload = { url: botImageLink };
    }

    const menu = `╭═══〘 \`${botName}\` 〙═══⊷❍
┃${star}╭──────────────
┃${star}│
┃${star}│ _*\`Geliştiricim\`*_ : ${botOwner}
┃${star}│ _*\`Üye\`*_ : ${message.senderName.replace(/[\r\n]+/gm, "")}
┃${star}│ _*\`Mod\`*_ : ${MODE}
┃${star}│ _*\`Sunucu\`*_ : ${os.platform() === "linux" ? "Linux" : "Bilinmeyen İşletim Sistemi"}
┃${star}│ _*\`Kullanılabilir RAM\`*_ : ${used} / ${total}
┃${star}│ _*\`Toplam Kullanıcı\`*_ : ${totalUsers}
┃${star}│ _*\`Versiyon\`*_ : ${botVersion}
┃${star}│
┃${star}│
┃${star}│  ▎▍▌▌▉▏▎▌▉▐▏▌▎
┃${star}│  ▎▍▌▌▉▏▎▌▉▐▏▌▎
┃${star}│   ${botName}
┃${star}│
┃${star}╰───────────────
╰═════════════════⊷

${cmdmenu}`;
    try {
      await message.client.sendMessage(message.jid, {
        image: imagePayload,
        caption: menu,
      });
    } catch (error) {
      console.error("Menü görseli gönderilirken hata:", error);
      await message.client.sendMessage(message.jid, {
        text: menu,
      });
    }
  }
);
Module(
  {
    pattern: "games ?(.*)",
    fromMe: isPrivateMode,
    desc: "Mevcut tüm oyunları listeler",
  },
  async (message, args) => {
    const gameCommands = commands.filter(
      (cmd) => cmd.use === "game" && cmd.pattern
    );
    if (!gameCommands.length) {
      return await message.sendReply("_🎮 Yüklü oyun yok._");
    }
    const handlerPrefix = HANDLERS.match(/\[(\W*)\]/)?.[1]?.[0] || ".";
    let response = `*🎮 ───「 Mevcut Oyunlar 」───*\n\n`;
    gameCommands.forEach((cmd) => {
      const name = extractCommandName(cmd.pattern);
      if (name) {
        response += `• *Komut:* \`${handlerPrefix}${name}\`\n`;
        response += `• *Açıklama:* ${cmd.desc || "Yok"}\n`;
        if (cmd.use) response += `• *Tür:* ${cmd.use}\n`;
        if (cmd.usage) response += `• *Kullanım:* ${cmd.usage}\n`;
        if (cmd.warn) response += `• *Uyarı:* ${cmd.warn}\n`;
        response += "\n";
      }
    });
    await message.sendReply(response);
  }
);

Module(
  {
    pattern: "setinfo ?(.*)",
    fromMe: true,
    desc: "Bot yapılandırma komutları hakkında bilgi gösterir.",
    use: "settings",
  },
  async (message, match) => {
    const infoText = `*⚙️ ───「 Bot Bilgi Yapılandırması 」───*

_\`.setinfo\` yerine bu ayrı komutları kullanın:_

*Bot Adı:*
- Komut: \`.setname <ad>\`
- Örnek: \`.setname Lades\`
- Açıklama: _Botun görünen adını ayarlar_

*Bot Sahibi:*
- Komut: \`.setowner <sahip>\`
- Örnek: \`.setowner Ahmet\`
- Açıklama: _Bot sahibi adını ayarlar_

*Bot Görseli:*
- Komut: \`.setimage\`
- Kullanım: _\`.setimage\` ile bir görsele yanıt verin_
- Açıklama: _Botun profil görselini ayarlar_

*Mevcut Format:*
_Bot bilgisi şu şekilde saklanır: \`ad;sahip;görselbağlantısı\`_

*İpuçları:*
- _Yerel varsayılan görsel için \`varsayılan\` kullanın_
- _Değişiklikler otomatik kaydedilir_
- _Güncel bilgiyi görmek için \`.menu\` kullanın_`;

    return await message.sendReply(infoText);
  }
);

Module(
  {
    pattern: "setname ?(.*)",
    fromMe: true,
    desc: "Bot adını ayarlar",
    use: "settings",
  },
  async (message, match) => {
    const name = match[1]?.trim();
    if (!name)
      return await message.sendReply("_💬 İsim verin: .setname Lades_");
    const parts = config.BOT_INFO.split(";");
    parts[0] = name;
    await setVar("BOT_INFO", parts.join(";"));
    return await message.sendReply(
      `_✅ Bot adı başarıyla güncellendi!_\n\n*📋 Yeni Ad:* ${name}`
    );
  }
);

Module(
  {
    pattern: "setowner ?(.*)",
    fromMe: true,
    desc: "Bot sahibini ayarlar",
    use: "settings",
  },
  async (message, match) => {
    const owner = match[1]?.trim();
    if (!owner)
      return await message.sendReply("_💬 Sahip verin: .setowner SahipAdi_");
    const parts = config.BOT_INFO.split(";");
    parts[1] = owner;
    await setVar("BOT_INFO", parts.join(";"));
    return await message.sendReply(
      `_✅ Bot sahibi başarıyla güncellendi!_\n\n*📋 Yeni Sahip:* ${owner}`
    );
  }
);

Module(
  {
    pattern: "setimage",
    fromMe: true,
    desc: "Bot resmini ayarlar (bir resme yanıt verin)",
    use: "settings",
  },
  async (message, match) => {
    if (!message.reply_message || !message.reply_message.image) {
      return await message.sendReply("_🖼️ Bir resmi .setimage ile yanıtlayın_");
    }

    try {
      const downloadedFile = await message.reply_message.download();

      const uploadRes = await uploadToImgbb(downloadedFile);

      try {
        fs.unlinkSync(downloadedFile);
      } catch (e) {
        console.log("Geçici dosya silinemedi:", downloadedFile);
      }

      const url = uploadRes.url || uploadRes.display_url;
      if (!url) {
        return await message.sendReply("_❌ Görsel yüklemesi başarısız oldu._");
      }

      const parts = config.BOT_INFO.split(";");
      while (parts.length < 3) parts.push("");
      parts[parts.length - 1] = url;
      await setVar("BOT_INFO", parts.join(";"));
      return await message.sendReply(
        `_✅ Bot görseli başarıyla güncellendi!_\n\n*🖼️ Yeni Görsel URL:* ${url}`
      );
    } catch (error) {
      console.error("Görsel ayarlanırken hata:", error);
      return await message.sendReply("_⚠️ Görsel ayarlanamadı. Lütfen tekrar deneyin._"
      );
    }
  }
);
Module(
  {
    pattern: "testalive",
    fromMe: true,
    desc: "Mevcut çevrimiçi (alive) mesajını biçimlendirmesiyle test eder.",
    usage: ".testalive",
    use: "utility",
  },
  async (message, match) => {
    const aliveMessage = ALIVE;

    if (!aliveMessage) {
      return await message.sendReply("*💬 Varsayılan Çevrimiçi Mesaj Test Ediliyor:*\nÇevrimiçiyim!"
      );
    }

    await message.sendReply("*💬 Çevrimiçi Mesajı Test Ediliyor:*");
    await parseAlive(message, aliveMessage);
  }
);

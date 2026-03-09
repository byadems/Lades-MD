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
  const match = pattern?.toString().match(/(\W*)([A-Za-z1234567890 ]*)/);
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
        `_Command '${commandName}' not found. Please check the spelling._`
      );
    }

    let infoMessage = `*───「 Command Details 」───*\n\n`;
    infoMessage += `• *Command:* \`${commandDetails.name}\`\n`;
    infoMessage += `• *Description:* ${commandDetails.desc || "N/A"}\n`;
    infoMessage += `• *Owner Command:* ${
      commandDetails.fromMe ? "Yes" : "No"
    }\n`;
    if (commandDetails.use) infoMessage += `• *Tür:* ${commandDetails.use}\n`;
    if (commandDetails.usage)
      infoMessage += `• *Kullanım:* ${commandDetails.name} ${commandDetails.usage}\n`;
    if (commandDetails.warn)
      infoMessage += `• *Warning:* ${commandDetails.warn}\n`;

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
      (cmd) => !cmd.excludeFromCommands && cmd.pattern
    );
    const totalCommandCount = availableCommands.length;

    const categorizedCommands = {};
    availableCommands.forEach((cmd) => {
      const category = cmd.use || "General";
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

    let responseMessage = `*Total Available Commands: ${totalCommandCount}*\n\n`;
    const handlerPrefix = HANDLERS.match(/\[(\W*)\]/)?.[1]?.[0] || ".";

    for (const category in categorizedCommands) {
      responseMessage += `*───「 ${category.toUpperCase()} 」───*\n\n`;
      categorizedCommands[category].forEach((cmd) => {
        responseMessage += `• \`${handlerPrefix}${cmd.name}\`\n`;
        if (cmd.desc) responseMessage += `  _Description:_ ${cmd.desc}\n`;
        if (cmd.usage) responseMessage += `  _Kullanım:_ ${cmd.usage}\n`;
        if (cmd.warn) responseMessage += `  _Warning:_ ${cmd.warn}\n`;
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
    const defaultAliveMessage = "I'm alive!";
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
      `_Attempted to set ${key} to ${value}. (Note: This is a placeholder and doesn't persist changes in this demo)_`
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
      return await message.sendReply(`*Alive Message Setup*

*Kullanım:*
• \`.setalive <message>\` - Set alive message
• \`.setalive help\` - Show detailed formatting help
• \`.setalive get\` - View current alive message
• \`.setalive del\` - Delete custom alive message
• \`.testalive\` - Test current alive message

*Quick Example:*
\`.setalive Hey $user! $botname is online!
_Version: $version_
_Uptime: $uptime_
_Kullanmak içinrs: $users_ $pp\`

*Use \`.setalive help\` for all available placeholders.*`);
    }

    const input = match[1].toLowerCase();

    if (input === "help") {
      const helpText = `*Alive Message Formatting Help*

*Available Placeholders:*

*Bot Stats:*
• \`$botname\` - Bot's display name
• \`$owner\` - Bot owner name
• \`$version\` - Bot version
• \`$mode\` - Bot mode (private/public)
• \`$server\` - Server OS
• \`$uptime\` - Bot uptime

*System Stats:*
• \`$ram\` - Available RAM
• \`$totalram\` - Total RAM
• \`$users\` - Total users in database

*User Info:*
• \`$user\` - Sender's name
• \`$number\` - Sender's number
• \`$date\` - Current date
• \`$time\` - Current time

*Media Options:*
• \`$pp\` - Sender's profile picture
• \`$media:url\` - Custom image/video URL

*Example Messages:*

*Simple:*
\`Hey $user! $botname is alive!\`

*Detailed:*
\`*$botname Status*
_Hi $user!_
*Stats:*
• _Version: $version_
• _Mode: $mode_
• _Uptime: $uptime_
• _Kullanmak içinrs: $users_
• _RAM: $ram/$totalram_
*Date:* _$date at $time_ $pp\`

*With Custom Media:*
\`$botname is online! $media:https://example.com/image.jpg\`

*With Video (auto gif playback):*
\`Bot status: Active! $media:https://example.com/video.mp4\`

*Notes:*
• Messages limited to 2000 characters
• Videos auto-play as GIFs
• \`$pp\` includes sender's profile picture
• URLs in \`$media:\` must be direct links
• Use quotes for multi-word messages`;

      return await message.sendReply(helpText);
    }

    if (input === "get") {
      const current = ALIVE;
      if (!current) {
        return await message.sendReply("_⚙️ Özel çevrimiçi mesajı ayarlanmadı! Varsayılan mesaj kullanılıyor._"
        );
      }
      return await message.sendReply(
        `*Current Alive Message:*\n\n${current}\n\n_Tip: Use_ \`.testalive\` _to test your message!_`
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
      `_Alive message set successfully!_\n\n*Preview:*\n${aliveMessage}\n\n_Tip: Use_ \`.testalive\` _to test your message!_`
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

    let use_ = commands.map((e) => e.use);
    const others = (use) => {
      return use === "" ? "others" : use;
    };
    let types = [
      ...new Set(
        commands.filter((e) => e.pattern).map((e) => e.use || "General")
      ),
    ];

    let cmd_obj = {};
    for (const command of commands) {
      let type_det = command.use || "General";
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
    const botName = infoParts[0] || "My Bot";
    const botOwner = infoParts[1] || "N/A";
    const botVersion = VERSION;
    let botImageLink = infoParts[2] || "";
    if (botImageLink === "default" || (botImageLink && !botImageLink.startsWith("http"))) {
      botImageLink = path.join(__dirname, "utils", "images", "default.png");
    }

    const menu = `╭═══〘 \`${botName}\` 〙═══⊷❍
┃${star}╭──────────────
┃${star}│
┃${star}│ _*\`Geliştiricim\`*_ : ${botOwner}
┃${star}│ _*\`Üye\`*_ : ${message.senderName.replace(/[\r\n]+/gm, "")}
┃${star}│ _*\`Mod\`*_ : ${MODE}
┃${star}│ _*\`Sunucu\`*_ : ${os.platform() === "linux" ? "Linux" : "Unknown OS"}
┃${star}│ _*\`Kullanılabilir RAM\`*_ : ${used} of ${total}
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
      if (
        botImageLink === path.join(__dirname, "utils", "images", "default.png")
      ) {
        await message.client.sendMessage(message.jid, {
          image: fs.readFileSync(botImageLink),
          caption: menu,
        });
      } else {
        await message.client.sendMessage(message.jid, {
          image: { url: botImageLink },
          caption: menu,
        });
      }
    } catch (error) {
      console.error("Error sending menu:", error);
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
      return await message.sendReply("_✨ Yüklü oyun yok._");
    }
    const handlerPrefix = HANDLERS.match(/\[(\W*)\]/)?.[1]?.[0] || ".";
    let response = `*───「 Available Games 」───*\n\n`;
    gameCommands.forEach((cmd) => {
      const name = extractCommandName(cmd.pattern);
      if (name) {
        response += `• *Command:* \`${handlerPrefix}${name}\`\n`;
        response += `• *Description:* ${cmd.desc || "N/A"}\n`;
        if (cmd.use) response += `• *Tür:* ${cmd.use}\n`;
        if (cmd.usage) response += `• *Kullanım:* ${cmd.usage}\n`;
        if (cmd.warn) response += `• *Warning:* ${cmd.warn}\n`;
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
    const infoText = `*───「 Bot Info Configuration 」───*

_Instead of using \`.setinfo\`, use these individual commands:_

*Bot Name:*
- Command: \`.setname <name>\`
- Example: \`.setname Lades\`
- Description: _Sets the bot's display name_

*Bot Owner:*
- Command: \`.setowner <owner>\`
- Example: \`.setowner John\`
- Description: _Sets the bot owner name_

*Bot Image:*
- Command: \`.setimage\`
- Usage: _Reply to an image with \`.setimage\`_
- Description: _Sets the bot's profile image_

*Current Format:*
_Bot info is stored as: \`name;owner;imagelink\`_

*Tips:*
- _Kullanmak için \`default\` as image to use local default image_
- _Changes are saved automatically_
- _Kullanmak için \`.menu\` to see the updated info_`;

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
      return await message.sendReply("_✨ İsim verin: .setname Lades_");
    const parts = config.BOT_INFO.split(";");
    parts[0] = name;
    await setVar("BOT_INFO", parts.join(";"));
    return await message.sendReply(
      `_Bot name updated successfully!_\n\n*New Name:* ${name}`
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
      return await message.sendReply("_✨ Sahip verin: .setowner SahipAdi_");
    const parts = config.BOT_INFO.split(";");
    parts[1] = owner;
    await setVar("BOT_INFO", parts.join(";"));
    return await message.sendReply(
      `_Bot owner updated successfully!_\n\n*New Owner:* ${owner}`
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
      return await message.sendReply("_💬 Bir resmi .setimage ile yanıtlayın_");
    }

    try {
      const downloadedFile = await message.reply_message.download();

      const uploadRes = await uploadToImgbb(downloadedFile);

      try {
        fs.unlinkSync(downloadedFile);
      } catch (e) {
        console.log("Failed to delete temp file:", downloadedFile);
      }

      const url = uploadRes.url || uploadRes.display_url;
      if (!url) {
        return await message.sendReply("_❌ Görsel yüklemesi başarısız oldu._");
      }

      const parts = config.BOT_INFO.split(";");
      parts[2] = url;
      await setVar("BOT_INFO", parts.join(";"));
      return await message.sendReply(
        `_Bot image updated successfully!_\n\n*New Image URL:* ${url}`
      );
    } catch (error) {
      console.error("Error setting image:", error);
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

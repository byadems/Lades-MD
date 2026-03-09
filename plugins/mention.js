const { Module } = require("../main");
const { SUDO, HANDLERS } = require("../config");
const config = require("../config");
const { uploadToCatbox } = require("./utils/upload");

const fs = require("fs");
const path = require("path");

var handler = HANDLERS !== "false" ? HANDLERS.split("")[0] : "";

const { setVar, delVar } = require("./manage");

function getMentionReply() {
  try {
    return config.MENTION_REPLY ? JSON.parse(config.MENTION_REPLY) : null;
  } catch (error) {
    console.error("Error parsing mention reply:", error);
    return null;
  }
}

async function setMentionReply(data) {
  try {
    return await setVar("MENTION_REPLY", JSON.stringify(data));
  } catch (error) {
    console.error("Error setting mention reply:", error);
    return false;
  }
}

async function deleteMentionReply() {
  try {
    return await delVar("MENTION_REPLY");
  } catch (error) {
    console.error("Error deleting mention reply:", error);
    return false;
  }
}

function isSudoUser(jid) {
  if (!jid) return false;

  let sudoMap = [];
  if (config.SUDO_MAP) {
    try {
      sudoMap = JSON.parse(config.SUDO_MAP);
      if (!Array.isArray(sudoMap)) sudoMap = [];
    } catch (e) {
      sudoMap = [];
    }
  }

  return sudoMap.includes(jid);
}

Module(
  {
    pattern: "mention ?(.*)",
    fromMe: true,
    desc: "Auto mention reply management",
    usage:
      ".mention set (reply to message) | .mention set <text> | .mention get | .mention del | .mention help",
  },
  async (message, match) => {
    const args = match[1]?.trim().split(" ");
    const subcommand = args?.[0]?.toLowerCase();
    const input = args?.slice(1).join(" ");

    if (!subcommand) {
      return await message.sendReply(
        `Lütfen bir alt komut belirtin!\n\n*Mevcut komutlar:*\n• \`${handler}mention set\` - Set mention reply (reply to message or add text)\n• \`${handler}mention get\` - View current mention reply\n• \`${handler}mention del\` - Delete mention reply\n• \`${handler}mention help\` - Show detailed help`
      );
    }

    switch (subcommand) {
      case "del":
      case "delete":
        const success = await deleteMentionReply();
        if (success) {
          return await message.sendReply("Bahsetme yanıtı başarıyla silindi!");
        } else {
          return await message.sendReply("Bahsetme yanıtı silinemedi!");
        }

      case "get":
      case "show":
        const mentionData = getMentionReply();
        if (!mentionData) {
          return await message.sendReply(
            "Bahsetme yanıtı ayarlanmadı!\n\n*Kullanım:*\n• Bir mesajı yanıtlayıp `.mention set` yazın\n• Veya metin mesajı için `.mention set <metin>` kullanın"
          );
        }

        let responseText = "*Current Mention Reply:*\n\n";
        responseText += `*Type:* \`${mentionData.type.toUpperCase()}\`\n`;
        if (mentionData.caption) {
          responseText += `*Caption:* _${mentionData.caption}_\n`;
        }
        if (mentionData.url) {
          responseText += `*Media URL:* \`${mentionData.url}\`\n`;
        }
        responseText += `*Set on:* _${new Date(
          mentionData.timestamp
        ).toLocaleString()}_`;

        return await message.sendReply(responseText);

      case "set":
        if (message.reply_message) {
          try {
            const replyMsg = message.reply_message;
            let mentionData = {
              type: "text",
              content: "",
              caption: "",
              url: "",
              timestamp: new Date().toISOString(),
            };

            if (
              replyMsg.image ||
              replyMsg.video ||
              replyMsg.audio ||
              replyMsg.document ||
              replyMsg.sticker
            ) {
              let mediaType = "document";
              if (replyMsg.image) mediaType = "image";
              else if (replyMsg.video) mediaType = "video";
              else if (replyMsg.audio) mediaType = "audio";
              else if (replyMsg.sticker) mediaType = "sticker";

              const downloadedFilePath = await replyMsg.download();

              const uploadResult = await uploadToCatbox(downloadedFilePath);

              fs.unlinkSync(downloadedFilePath);

              if (uploadResult && uploadResult.url) {
                mentionData.type = mediaType;
                mentionData.url = uploadResult.url;
                mentionData.caption = replyMsg.text || "";
              } else {
                return await message.sendReply(
                  "Medya yüklenemedi! Lütfen tekrar deneyin."
                );
              }
            } else if (replyMsg.text) {
              mentionData.type = "text";
              mentionData.content = replyMsg.text;
            } else {
              return await message.sendReply(
                "Bahsetme yanıtı için desteklenmeyen mesaj türü!"
              );
            }

            const success = await setMentionReply(mentionData);
            if (success) {
              return await message.sendReply(
                `Bahsetme yanıtı başarıyla ayarlandı!\n\n*Tür:* \`${mentionData.type.toUpperCase()}\`\n*Content:* _${
                  mentionData.content || mentionData.caption || "Media file"
                }_`
              );
            } else {
              return await message.sendReply("Bahsetme yanıtı ayarlanamadı!");
            }
          } catch (error) {
            console.error("Error setting mention reply:", error);
            return await message.sendReply(
              "Bahsetme yanıtı ayarlanırken hata oluştu! Lütfen tekrar deneyin."
            );
          }
        }

        if (input && input.trim()) {
          const mentionData = {
            type: "text",
            content: input.trim(),
            caption: "",
            url: "",
            timestamp: new Date().toISOString(),
          };

          const success = await setMentionReply(mentionData);
          if (success) {
            return await message.sendReply(
              `Mention reply set successfully!\n\n*Content:* _${mentionData.content}_`
            );
          } else {
            return await message.sendReply("Bahsetme yanıtı ayarlanamadı!");
          }
        }

        return await message.sendReply(
          `Lütfen 'set' komutu için içerik sağlayın!\n\n*Kullanım:*\n• Herhangi bir mesajı yanıtlayın ve \ yazın`${handler}mention set\`\n• Or use \`${handler}mention set <text>\` for text message`
        );

      case "help":
        const helpText = `*Auto Mention Reply Help*

*What is it?*
When someone mentions the bot or sudo users, the bot automatically sends a saved reply message.

*Commands:* _(Owner only)_
• \`${handler}mention set\` - Reply to any message to set it as mention reply
• \`${handler}mention set <text>\` - Set text as mention reply
• \`${handler}mention get\` - View current mention reply
• \`${handler}mention del\` - Delete mention reply

*Supported Types:*
• Text messages
• Images _(with captions)_
• Videos _(with captions)_
• Audio files
• Stickers
• Documents

*How it works:*
1. Set a mention reply using the commands above
2. When someone mentions @bot or @sudo in a message
3. Bot automatically sends the saved reply

*Examples:*
• Reply to an image and type \`${handler}mention set\`
• \`${handler}mention set Hello! I'm a bot\`
• \`${handler}mention get\` - to see current reply
• \`${handler}mention del\` - to remove reply

_Note: Media files are uploaded to cloud storage for reliability._`;

        return await message.sendReply(helpText);

      default:
        return await message.sendReply(
          `Bilinmeyen alt komut: \`${subcommand}\`\n\n*Available commands:*\n• \`${handler}mention set\` - Set mention reply\n• \`${handler}mention get\` - View current mention reply\n• \`${handler}mention del\` - Delete mention reply\n• \`${handler}mention help\` - Show help`
        );
    }
  }
);

Module(
  {
    on: "text",
    fromMe: false,
  },
  async (message) => {
    try {
      if (
        !message.mention ||
        !Array.isArray(message.mention) ||
        message.mention.length === 0
      ) {
        return;
      }

      const botId = message.client.user?.lid?.split(":")[0] + "@s.whatsapp.net";
      const botNumericId = botId?.split("@")[0];

      let isMentioned = false;

      for (const mentionedJid of message.mention) {
        const mentionedNumericId = mentionedJid?.split("@")[0];

        if (mentionedNumericId === botNumericId || mentionedJid === botId) {
          isMentioned = true;
          break;
        }

        if (isSudoUser(mentionedJid)) {
          isMentioned = true;
          break;
        }
      }

      if (!isMentioned) {
        return;
      }

      const mentionData = getMentionReply();
      if (!mentionData) {
        return;
      }

      switch (mentionData.type) {
        case "text":
          if (mentionData.content) {
            await message.sendReply(mentionData.content);
          }
          break;

        case "image":
          if (mentionData.url) {
            await message.sendReply({ url: mentionData.url }, "image", {
              caption: mentionData.caption || "",
            });
          }
          break;

        case "video":
          if (mentionData.url) {
            await message.sendReply({ url: mentionData.url }, "video", {
              caption: mentionData.caption || "",
            });
          }
          break;

        case "audio":
          if (mentionData.url) {
            await message.sendReply({ url: mentionData.url }, "audio", {
              ptt: true,
              mimetype: "audio/mpeg",
            });
          }
          break;

        case "sticker":
          if (mentionData.url) {
            await message.sendReply({ url: mentionData.url }, "sticker");
          }
          break;

        case "document":
          if (mentionData.url) {
            await message.sendReply({ url: mentionData.url }, "document", {
              caption: mentionData.caption || "",
            });
          }
          break;
      }
    } catch (error) {
      console.error("Error in auto mention reply:", error);
    }
  }
);

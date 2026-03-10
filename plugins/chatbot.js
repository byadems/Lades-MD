const { Module } = require("../main");
const config = require("../config");
const axios = require("axios");
const fromMe = config.MODE !== "public";
const { setVar } = require("./manage");
const fs = require("fs");
const { callGenerativeAI } = require("./utils/misc");

const API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/";
const models = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemma-3-12b-it",
];
const chatbotStates = new Map();
const chatContexts = new Map();
const modelStates = new Map();

let globalSystemPrompt =
  "Sen Lades adında yardımsever bir yapay zeka asistandısın. Kısa, nazik ve bilgilendirici ol.";

async function initChatbotData() {
  try {
    const chatbotData = config.CHATBOT || "";
    if (chatbotData) {
      const enabledChats = chatbotData.split(",").filter((jid) => jid.trim());
      enabledChats.forEach((jid) => {
        chatbotStates.set(jid.trim(), true);
        modelStates.set(jid.trim(), 0);
      });
    }

    const systemPrompt = config.CHATBOT_SYSTEM_PROMPT;
    if (systemPrompt) {
      globalSystemPrompt = systemPrompt;
    }
  } catch (error) {
    console.error("Error initializing chatbot data:", error);
  }
}

async function saveChatbotData() {
  try {
    const enabledChats = [];
    for (const [jid, enabled] of chatbotStates.entries()) {
      if (enabled) {
        enabledChats.push(jid);
      }
    }
    await setVar("CHATBOT", enabledChats.join(","));
  } catch (error) {
    console.error("Error saving chatbot data:", error);
  }
}

async function saveSystemPrompt(prompt) {
  try {
    globalSystemPrompt = prompt;
    await setVar("CHATBOT_SYSTEM_PROMPT", prompt);
  } catch (error) {
    console.error("Error saving system prompt:", error);
  }
}

async function imageToGenerativePart(imageBuffer) {
  try {
    const data = imageBuffer.toString("base64");

    return {
      inlineData: {
        mimeType: "image/jpeg",
        data: data,
      },
    };
  } catch (error) {
    console.error("Error processing image:", error.message);
    return null;
  }
}

async function getAIResponse(message, chatJid, imageBuffer = null) {
  const apiKey = config.GEMINI_API_KEY;
  if (!apiKey) {
    return "_❌ GEMINI_API_KEY yapılandırılmadı. Ayarlamak için şunu kullanın: `.setvar GEMINI_API_KEY your_api_key`_";
  }

  const currentModelIndex = modelStates.get(chatJid) || 0;
  const currentModel = models[currentModelIndex];

  try {
    const apiUrl = `${API_BASE_URL}${currentModel}:generateContent?key=${apiKey}`;

    const context = chatContexts.get(chatJid) || [];

    const contents = [
      {
        role: "user",
        parts: [{ text: `System: ${globalSystemPrompt}` }],
      },
    ];

    const recentContext = context.slice(-10);
    recentContext.forEach((msg) => {
      contents.push({
        role: msg.role,
        parts: [{ text: msg.text }],
      });
    });

    const parts = [{ text: message }];

    if (imageBuffer) {
      const imagePart = await imageToGenerativePart(imageBuffer);
      if (imagePart) {
        parts.push(imagePart);
      }
    }

    contents.push({
      role: "user",
      parts: parts,
    });

    const payload = {
      contents: contents,
      generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.7,
      },
    };

    const response = await axios.post(apiUrl, payload, {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    if (
      response.data &&
      response.data.candidates &&
      response.data.candidates.length > 0 &&
      response.data.candidates[0].content &&
      response.data.candidates[0].content.parts &&
      response.data.candidates[0].content.parts.length > 0
    ) {
      const aiResponse = response.data.candidates[0].content.parts[0].text;

      if (!chatContexts.has(chatJid)) {
        chatContexts.set(chatJid, []);
      }
      const contextArray = chatContexts.get(chatJid);
      const contextMessage = imageBuffer
        ? `${message} [Image included]`
        : message;
      contextArray.push({ role: "user", text: contextMessage });
      contextArray.push({ role: "model", text: aiResponse });

      if (contextArray.length > 20) {
        contextArray.splice(0, contextArray.length - 20);
      }

      return aiResponse;
    } else {
      return "_❌ YZ'den beklenmeyen bir yanıt alındı. Lütfen tekrar deneyin._";
    }
  } catch (error) {
    console.error("Error getting AI response:", error.message);

    if (error.response && error.response.status === 429) {
      const nextModelIndex = currentModelIndex + 1;
      if (nextModelIndex < models.length) {
        modelStates.set(chatJid, nextModelIndex);
        console.log(
          `Switching to model: ${models[nextModelIndex]} for chat: ${chatJid}`
        );
        return "_⚠️ Oran sınırına ulaşıldı. Yedek modele geçildi. Lütfen tekrar deneyin._";
      } else {
        return "_❌ Tüm modeller hız sınırına ulaştı. Lütfen daha sonra tekrar deneyin._";
      }
    }

    if (error.response) {
      return `_❌ API Error: ${
        error.response.data?.error?.message || "Bilinmeyen hata"
      }_`;
    }

    return "_❌ Ağ hatası. Bağlantınızı kontrol edip tekrar deneyin._";
  }
}

function isChatbotEnabled(jid) {
  if (chatbotStates.get(jid) === true) {
    return true;
  }

  const isGroup = jid.includes("@g.us");
  if (isGroup && config.CHATBOT_ALL_GROUPS === "true") {
    return true;
  }

  if (!isGroup && config.CHATBOT_ALL_DMS === "true") {
    return true;
  }

  return false;
}

async function enableChatbot(jid) {
  chatbotStates.set(jid, true);
  if (!modelStates.has(jid)) {
    modelStates.set(jid, 0);
  }
  await saveChatbotData();
}

async function disableChatbot(jid) {
  chatbotStates.set(jid, false);

  chatContexts.delete(jid);
  await saveChatbotData();
}

function clearContext(jid) {
  chatContexts.delete(jid);
}

async function clearAllContexts(target) {
  if (target === "gruplar") {
    for (const [jid] of chatbotStates.entries()) {
      if (jid.includes("@g.us")) {
        clearContext(jid);
      }
    }
  } else if (target === "dms") {
    for (const [jid] of chatbotStates.entries()) {
      if (!jid.includes("@g.us")) {
        clearContext(jid);
      }
    }
  }
}

initChatbotData();

Module(
  {
    pattern: "chatbot ?(.*)",
    fromMe: true,
    desc: "Gemini API ile YZ Sohbet Botu yönetimi - metin ve resim analizi destekler",
    usage:
      ".chatbot - _Yardım menüsünü göster_\n.chatbot on/off - _Bu sohbette aç/kapat_\n.chatbot on/off gruplar - _Tüm gruplarda aç/kapat_\n.chatbot on/off dms - _Tüm DM'lerde aç/kapat_\n.chatbot set \"prompt\" - _Sistem komutunu ayarla_\n.chatbot clear - _AI geçmişini temizle_\n_Görsellere yanıt vererek YZ görsel analizi yapın_",
  },
  async (message, match) => {
    const input = match[1]?.trim();
    const chatJid = message.jid;

    if (!input) {
      const isEnabled = isChatbotEnabled(chatJid);
      const globalGroups = config.CHATBOT_ALL_GROUPS === "true";
      const globalDMs = config.CHATBOT_ALL_DMS === "true";
      const currentModel = models[modelStates.get(chatJid) || 0];
      const contextSize = chatContexts.get(chatJid)?.length || 0;
      const hasApiKey = !!config.GEMINI_API_KEY;

      const helpText =
        `*_🤖 YZ Sohbet Botu Yönetimi_*\n\n` +
        `📊 _Mevcut Durum:_ \`${isEnabled ? "Açık" : "Kapalı"}\`\n` +
        `🔑 _API Anahtarı:_ \`${hasApiKey ? "Yapılandırıldı ✅" : "Eksik ❌"}\`\n` +
        `🌐 _Genel Gruplar:_ \`${
          globalGroups ? "Açık ✅" : "Kapalı ❌"
        }\`\n` +
        `💬 _Genel DM'ler:_ \`${globalDMs ? "Açık ✅" : "Kapalı ❌"}\`\n` +
        `🤖 _Mevcut Model:_ \`${currentModel}\`\n` +
        `💭 _Bağlam Mesajları:_ \`${contextSize}\`\n` +
        `🎯 _Sistem Komutu:_ \`${globalSystemPrompt.substring(0, 100)}${
          globalSystemPrompt.length > 100 ? "..." : ""
        }\`\n\n` +
        (hasApiKey
          ? `*_Komutlar:_*\n` +
            `- \`.chatbot on\` - _Bu sohbette sohbet botunu aç_\n` +
            `- \`.chatbot off\` - _Bu sohbette sohbet botunu kapat_\n` +
            `- \`.chatbot on gruplar\` - _Tüm gruplarda aç_\n` +
            `- \`.chatbot on dms\` - _Tüm DM'lerde aç_\n` +
            `- \`.chatbot off gruplar\` - _Tüm gruplarda kapat_\n` +
            `- \`.chatbot off dms\` - _Tüm DM'lerde kapat_\n` +
            `- \`.chatbot set "prompt"\` - _Sistem komutunu ayarla_\n` +
            `- \`.chatbot clear\` - _AI geçmişini temizle_\n` +
            `- \`.chatbot status\` - _Detaylı durumu göster_\n\n` +
            `*_Nasıl çalışır:_*\n` +
            `- _Bota gelen direkt mesajlar YZ yanıtını tetikler_\n` +
            `- _Etiketler (@bot) YZ yanıtını tetikler_\n` +
            `- _Bot mesajlarına yanıtlar YZ yanıtını tetikler_\n` +
            `- _Görsellere yanıt vererek YZ görsel analizi yapın_\n` +
            `- _Konuşma bağlamını otomatik olarak sürdürür_\n` +
            `- _Hız sınırlarında otomatik model değiştirir_`
          : `*_⚠️ Kurulum Gerekli:_*\n` +
            `_Sohbet botunu kullanmak için API anahtarı gereklidir._\n\n` +
            `*_API anahtarınızı alın:_*\n` +
            `- _Ziyaret edin: https://aistudio.google.com/app/apikey_\n` +
            `- _Google hesabıyla giriş yapın_\n` +
            `- _API Anahtarı Oluşturun_\n\n` +
            `*_API anahtarınızı ayarlayın:_*\n` +
            `\`.setvar GEMINI_API_KEY=your_api_key_here\`\n\n` +
            `_Anahtarı ayarladıktan sonra, etkinleştirmek için \`.chatbot on\` kullanın._`);

      return await message.sendReply(helpText);
    }

    const args = input.split(" ");
    const command = args[0].toLowerCase();
    const target = args[1]?.toLowerCase();

    switch (command) {
      case "on":
        if (!config.GEMINI_API_KEY) {
          return await message.sendReply(`*_❌ GEMINI_API_KEY Yapılandırılmadı_*\n\n` +
              `_Gemini API anahtarı olmadan sohbet botu etkinleştirilemez._\n\n` +
              `*_API anahtarınızı nasıl alırsınız:_*\n` +
              `- _Ziyaret edin: https://aistudio.google.com/app/apikey_\n` +
              `- _Google hesabınızla giriş yapın_\n` +
              `- _Click "API Anahtarı Oluştur"_\n` +
              `- _Oluşturulan API anahtarını kopyalayın_\n\n` +
              `*_Nasıl ayarlanır:_*\n` +
              `\`.setvar GEMINI_API_KEY=your_api_key_here\`\n\n` +
              `_Yerine \`your_api_key_here\` gerçek API anahtarınızı yazın._`
          );
        }

        if (target === "gruplar") {
          await setVar("CHATBOT_ALL_GROUPS", "true");
          return await message.sendReply(`*_🤖 Sohbet Botu Tüm Gruplar için Açıldı_*\n\n` +
              `✅ _Sohbet botu artık tüm gruplarda yanıt verecek_\n` +
              `🤖 _Model:_ \`${models[0]}\`\n` +
              `📍 _Tetikleyici:_ _Sadece etiketler ve yanıtlar_\n\n` +
              `_Kullanmak için \`.chatbot off gruplar\` kullanarak kapatın._`
          );
        } else if (target === "dms") {
          await setVar("CHATBOT_ALL_DMS", "true");
          return await message.sendReply(`*_🤖 Sohbet Botu Tüm DM'ler için Açıldı_*\n\n` +
              `✅ _Sohbet botu artık tüm DM'lerde yanıt verecek_\n` +
              `🤖 _Model:_ \`${models[0]}\`\n` +
              `📍 _Tetikleyici:_ _Tüm mesajlar_\n\n` +
              `_Kullanmak için \`.chatbot off dms\` kullanarak kapatın._`
          );
        } else {
          await enableChatbot(chatJid);
          return await message.sendReply(`*_🤖 Sohbet Botu Açıldı_*\n\n` +
              `📍 _Sohbet:_ \`${chatJid.includes("@g.us") ? "Grup" : "DM"}\`\n` +
              `🤖 _Model:_ \`${models[0]}\`\n` +
              `💭 _Bağlam:_ _Yeni başlangıç_\n\n` +
              `_Artık direkt mesajlara, etiketlere ve yanıtlara cevap vereceğim!_`
          );
        }

      case "off":
        if (target === "gruplar") {
          await setVar("CHATBOT_ALL_GROUPS", "false");
          return await message.sendReply(`*_🤖 Sohbet Botu Tüm Gruplar için Kapatıldı_*\n\n` +
              `❌ _Sohbet botu artık küresel olarak gruplarda yanıt vermeyecek_\n` +
              `📝 _Bireysel grup ayarları korunur_\n\n` +
              `_Kullanmak için \`.chatbot on gruplar\` tekrar etkinleştirin._`
          );
        } else if (target === "dms") {
          await setVar("CHATBOT_ALL_DMS", "false");
          return await message.sendReply(`*_🤖 Sohbet Botu Tüm DM'ler için Kapatıldı_*\n\n` +
              `❌ _Sohbet botu artık küresel olarak DM'lerde yanıt vermeyecek_\n` +
              `📝 _Bireysel DM ayarları korunur_\n\n` +
              `_Kullanmak için \`.chatbot on dms\` tekrar etkinleştirin._`
          );
        } else {
          await disableChatbot(chatJid);
          return await message.sendReply(`*_🤖 Sohbet Botu Kapatıldı_*\n\n` +
              `_Sohbet botu bu sohbette kapatıldı._\n` +
              `_Konuşma bağlamı temizlendi._`
          );
        }

      case "set":
        const promptMatch = input.match(/set\s+"([^"]+)"/);
        if (!promptMatch) {
          return await message.sendReply(`_⚠️ Lütfen sistem komutunu tırnak içinde belirtin._\n\n` +
              `*_Örnek:_*\n` +
              `\`.chatbot set "You are a helpful assistant specialized in programming."\``
          );
        }
        const newPrompt = promptMatch[1];
        await saveSystemPrompt(newPrompt);
        return await message.sendReply(`*_🎯 Sistem Komutu Güncellendi_*\n\n` +
            `📝 _Yeni Komut:_ \`${newPrompt}\`\n\n` +
            `_Bu tüm yeni konuşmalara uygulanacak._`
        );

      case "clear":
        if (target === "gruplar" || target === "dms") {
          await clearAllContexts(target);
          return await message.sendReply(
            `*_💭 Contexts Cleared for All ${
              target === "gruplar" ? "Gruplar" : "DM'ler"
            }_*\n\n` +
              `_Konuşma geçmişleri tüm  ${
                target === "gruplar" ? "gruplar" : "DMs"
              }._\n` +
              `_Sonraki mesajlar yeni konuşmalar başlatacak._`
          );
        } else {
          clearContext(chatJid);
          return await message.sendReply(`*_💭 Bağlam Temizlendi_*\n\n` +
              `_Konuşma geçmişi sıfırlandı._\n` +
              `_Sonraki mesaj yeni bir konuşma başlatacak._`
          );
        }

      case "status":
        const isEnabled = isChatbotEnabled(chatJid);
        const isEnabledIndividually = chatbotStates.get(chatJid) === true;
        const globalGroups = config.CHATBOT_ALL_GROUPS === "true";
        const globalDMs = config.CHATBOT_ALL_DMS === "true";
        const currentModel = models[modelStates.get(chatJid) || 0];
        const contextSize = chatContexts.get(chatJid)?.length || 0;
        const modelIndex = modelStates.get(chatJid) || 0;
        const isGroup = chatJid.includes("@g.us");

        let enabledReason = "";
        if (isEnabledIndividually) {
          enabledReason = "Bireysel ayar";
        } else if (isGroup && globalGroups) {
          enabledReason = "Küresel grup ayarı";
        } else if (!isGroup && globalDMs) {
          enabledReason = "Küresel DM ayarı";
        }

        const statusText =
          `*_🤖 Sohbet Botu Durumu_*\n\n` +
          `📊 _Durum:_ \`${isEnabled ? "Açık ✅" : "Kapalı ❌"}\`\n` +
          (isEnabled && enabledReason
            ? `📋 _Şununla etkin:_ \`${enabledReason}\`\n`
            : "") +
          `🌐 _Genel Gruplar:_ \`${
            globalGroups ? "Açık ✅" : "Kapalı ❌"
          }\`\n` +
          `💬 _Genel DM'ler:_ \`${globalDMs ? "Açık ✅" : "Kapalı ❌"}\`\n` +
          `🤖 _Mevcut Model:_ \`${currentModel}\`\n` +
          `📈 _Model Yedek Seviyesi:_ \`${modelIndex + 1}/${
            models.length
          }\`\n` +
          `💭 _Bağlam Mesajları:_ \`${contextSize}\`\n` +
          `🎯 _Sistem Komutu:_ \`${globalSystemPrompt}\`\n` +
          `🔑 _API Anahtarı:_ \`${
            config.GEMINI_API_KEY ? "Yapılandırıldı ✅" : "Eksik ❌"
          }\`\n\n` +
          `*_Kullanılabilir Modeller:_*\n` +
          models
            .map(
              (model, index) =>
                `${index + 1}. \`${model}\` ${
                  index === modelIndex ? "← Mevcut" : ""
                }`
            )
            .join("\n");

        return await message.sendReply(statusText);

      default:
        return await message.sendReply(`_❌ Bilinmeyen komut: \`${command}\`_\n\n_💡 Mevcut komutları görmek için \`.chatbot\` kullanın._`
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
      const chatJid = message.jid;
      const senderJid = message.sender;
      const isGroup = message.isGroup;
      const isDM = !isGroup;

      if (!isChatbotEnabled(chatJid)) {
        return;
      }

      if (message.fromMe) {
        return;
      }

      if (!config.GEMINI_API_KEY) {
        return;
      }

      let shouldRespond = false;
      const messageText = message.text;
      if (isDM) {
        shouldRespond = true;
      } else if (isGroup) {
        const botJid = message.client.user?.lid;

        if (message.mention && message.mention.length > 0) {
          const botMentioned = message.mention.some((jid) => {
            const mentionedNum = jid.split("@")[0];
            const botNum = botJid?.split(":")[0];
            return mentionedNum === botNum;
          });
          if (botMentioned) shouldRespond = true;
        }

        if (message.reply_message && message.reply_message.jid) {
          const repliedToNum = message.reply_message.jid.split("@")[0];
          const botNum = botJid?.split(":")[0];
          if (repliedToNum === botNum) shouldRespond = true;
        }
      }

      if (!shouldRespond) {
        return;
      }

      let imageBuffer = null;
      let responseText = messageText;

      if (message.reply_message && message.reply_message.image) {
        try {
          imageBuffer = await message.reply_message.download("buffer");

          if (!messageText || messageText.length < 2) {
            responseText = "Bu görselde ne görüyorsun?";
          }
        } catch (error) {
          console.error("Error downloading image:", error);
          return await message.sendReply("_❌ Görsel indirilemedi. Lütfen tekrar deneyin._"
          );
        }
      } else if (messageText.length < 2) {
        return;
      }

      let commandPrefixes = [];
      if (config.HANDLERS === "false") {
        commandPrefixes = [];
      } else {
        const handlers = config.HANDLERS || ".,";
        if (typeof handlers === "string") {
          commandPrefixes = handlers.split("").filter((char) => char.trim());
        }
      }

      if (
        commandPrefixes.length > 0 &&
        commandPrefixes.some((prefix) => responseText.startsWith(prefix))
      ) {
        return;
      }

      const aiResponse = await getAIResponse(
        responseText,
        chatJid,
        imageBuffer
      );

      if (aiResponse) {
        await message.sendReply(aiResponse);
      }
    } catch (error) {
      console.error("Error in message handler:", error);
    }
  }
);

Module(
  {
    pattern: "ai ?(.*)",
    fromMe,
    desc: "Metin ve/veya görsel girişiyle Gemini YZ'ye sorun",
    type: "ai",
  },
  async (message, match) => {
    let imageParts = [];
    let prompt = match[1]?.trim() || "";

    if (message.reply_message) {
      if (message.reply_message.image) {
        try {
          const buffer = await message.reply_message.download("buffer");
          const imagePart = await imageToGenerativePart(buffer);
          if (imagePart) imageParts.push(imagePart);
        } catch (error) {
          console.error("Error downloading image:", error);
          return await message.sendReply("❌ Görsel indirilemedi.");
        }
        if (!prompt) prompt = "Bu görselde ne görüyorsun?";
      }
      else if (message.reply_message.album) {
        try {
          const albumData = await message.reply_message.download();

          for (const imagePath of albumData.images) {
            try {
              const buffer = fs.readFileSync(imagePath);
              const imagePart = await imageToGenerativePart(buffer);
              if (imagePart) imageParts.push(imagePart);
            } catch (err) {
              console.error("Error processing album image:", err);
            }
          }

          if (!imageParts.length) {
            return await message.sendReply("❌ Albümde resim bulunamadı.");
          }
          if (!prompt) prompt = "Bu görselleri benim için analiz et.";
        } catch (error) {
          console.error("Error downloading album:", error);
          return await message.sendReply("❌ Albüm indirilemedi.");
        }
      }
      else if (message.reply_message.text && !prompt) {
        prompt = message.reply_message.text;
      }
    }

    if (!prompt && !imageParts.length) {
      return await message.sendReply("⚠️ Lütfen bir komut girin veya bir mesaja/resme yanıt verin.");
    }

    let sent_msg;
    try {
      sent_msg = await message.sendReply("_Düşünüyor..._");
      const fullText = await callGenerativeAI(prompt, imageParts, message, sent_msg);

      if (!fullText) {
        await message.edit("❌ YZ'den boş bir yanıt alındı.", message.jid, sent_msg.key);
        return;
      }

      await message.edit(fullText, message.jid, sent_msg.key);
    } catch (error) {
      console.error("AI command error:", error.message);
      if (sent_msg) {
        await message.edit("❌ AI API'si ile ilgili bir hata oluştu.", message.jid, sent_msg.key);
      } else {
        await message.sendReply("❌ AI API'si ile ilgili bir hata oluştu.");
      }
    }
  }
);

const { Module } = require("../main");
const config = require("../config");
const axios = require("axios");
const { setVar } = require("./manage");
const fs = require("fs");
const {
  addExif,
  webp2mp4,
  addID3,
  getBuffer,
  uploadToImgbb,
  uploadToCatbox,
} = require("./utils");
const { callGenerativeAI } = require("./utils/misc");

const API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/";
const models = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-exp",
  "gemini-2.0-flash-lite",
  "gemini-pro-latest"
];

let validApiModels = [];

const chatbotStates = new Map();
const chatContexts = new Map();
const modelStates = new Map();
const modelCooldowns = new Map();

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_TIMEOUT = 15000;

let globalSystemPrompt =
  "Lades adında yardımsever bir süper yapay zekâ asistanısın. Özlü, arkadaş canlısı ve sadece gerektiğinde bilgilendirici ol.";

async function logValidGeminiModels() {
  const apiKey = config.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("⚠️ GEMINI_API_KEY yok, model listesi alınamadı.");
    return;
  }

  try {
    const res = await axios.get(
      "https://generativelanguage.googleapis.com/v1beta/models",
      {
        headers: {
          "x-goog-api-key": apiKey,
        },
      }
    );

    const modelsFromApi = res.data.models || [];

    validApiModels = modelsFromApi
      .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
      .map(m => m.name.replace("models/", ""));

    console.log("✅ API tarafından geçerli Gemini modelleri:");
    validApiModels.forEach(m => console.log(" -", m));

    if (!validApiModels.length) {
      console.warn("⚠️ API geçerli model döndürmedi.");
    }
  } catch (err) {
    console.error(
      "❌ Gemini model listesi alınamadı:",
      err.response?.data || err.message
    );
  }
}

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

    const systemPrompt = config.AI_DEFAULT_PROMPT;
    if (systemPrompt) {
      globalSystemPrompt = systemPrompt;
    }
  } catch (error) {
    console.error("Sohbet botu verileri başlatılırken hata oluştu:", error);
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
    console.error("Sohbet botu verileri kaydedilirken hata oluştu:", error);
  }
}

async function saveSystemPrompt(prompt) {
  try {
    globalSystemPrompt = prompt;
    await setVar("AI_DEFAULT_PROMPT", prompt);
  } catch (error) {
    console.error("Varsayılan istem kaydedilirken hata oluştu:", error);
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
    console.error("Görsel işlenirken hata oluştu:", error.message);
    return null;
  }
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function jitter(min, max) {
  return Math.random() * (max - min) + min;
}

async function postWithRetry(url, payload, opts = {}) {
  const maxAttempts = opts.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  const headers = opts.headers || { "Content-Type": "application/json" };

  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const source = axios.CancelToken.source();
      const timer = setTimeout(() => {
        source.cancel(`timeout ${timeout}ms`);
      }, timeout);

      const res = await axios.post(url, payload, {
        headers,
        cancelToken: source.token,
      });

      clearTimeout(timer);
      return res;
    } catch (err) {
      lastErr = err;

      if (axios.isCancel(err)) {
        console.warn(`Request canceled (timeout) for ${url}: ${err.message}`);
      }

      const status = err.response?.status;
      const retryAfterRaw = err.response?.headers?.["retry-after"];
      let retryAfter = null;
      if (retryAfterRaw) {
        const parsed = parseInt(retryAfterRaw, 10);
        if (!Number.isNaN(parsed)) retryAfter = parsed * 1000;
      }

      if (status && [401, 403, 400, 404].includes(status)) {
        throw err;
      }

      if (status && [429, 500, 502, 503].includes(status)) {
        const baseDelay = retryAfter !== null ? retryAfter : Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        const delay = baseDelay + jitter(100, 600);
        console.warn(`Request to ${url} failed with ${status}. Attempt ${attempt}/${maxAttempts}. Retrying in ${Math.round(delay)}ms.`);
        await sleep(delay);
        continue;
      }

      if (!err.response) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000) + jitter(100, 600);
        console.warn(`Network error for ${url}, attempt ${attempt}/${maxAttempts}. Retrying in ${Math.round(delay)}ms.`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }

  if (lastErr) {
    lastErr.isMaxAttempts = true;
    throw lastErr;
  }

  const e = new Error("Max attempts reached");
  e.isMaxAttempts = true;
  throw e;
}

async function getAIResponse(message, chatJid, imageBuffer = null, retryCount = 0) {
  const MAX_MODEL_RETRIES = 10;
  const apiKey = config.GEMINI_API_KEY;
  if (!apiKey) {
    return "_❌ GEMINI_API_KEY yapılandırılmamış. Lütfen `.setvar GEMINI_API_KEY` komutunu kullanarak ayarlayın._";
  }

  const currentModelIndex = modelStates.get(chatJid) || 0;
  const currentModel = models[currentModelIndex];

  const cooldownUntil = modelCooldowns.get(chatJid) || 0;
  if (Date.now() < cooldownUntil) {
    return "_⏳ Çok sık model değişim denemesi algılandı. Lütfen birkaç saniye sonra tekrar deneyin._";
  }

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

  let lastError = null;

  try {
    const response = await postWithRetry(apiUrl, payload, {
      headers: { "Content-Type": "application/json" },
      maxAttempts: 3,
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
      const contextMessage = imageBuffer ? `${message} [Image included]` : message;
      contextArray.push({ role: "user", text: contextMessage });
      contextArray.push({ role: "model", text: aiResponse });

      if (contextArray.length > 20) {
        contextArray.splice(0, contextArray.length - 20);
      }
      modelStates.set(chatJid, 0);
      return aiResponse;
    } else {
      console.warn("YZ beklenmedik içerik döndürdü.");
      return "_❌ YZ beklenmedik içerik döndürdü._";
    }
  } catch (error) {
    lastError = error;
    const status = error.response?.status;
    const retryAfterRaw = error.response?.headers?.["retry-after"];
    let retryAfterMs = retryAfterRaw ? (parseInt(retryAfterRaw, 10) * 1000) : 2000;

    if (status && [401, 403].includes(status)) {
      console.error("YZ yanıtı alınırken hata (auth):", status, error.response?.data || error.message);
      return `_❌ API Authentication Error: ${error.response?.data?.error?.message || "Yetkilendirme hatası."}_`;
    }

    console.warn("YZ isteği başarısız oldu:", status || error.message, error.isMaxAttempts ? "(isMaxAttempts)" : "");

    if (status && [400, 404].includes(status)) {
      const nextModelIndex = (modelStates.get(chatJid) || 0) + 1;
      if (nextModelIndex < models.length) {
        modelStates.set(chatJid, nextModelIndex);
        modelCooldowns.set(chatJid, Date.now() + 3000);
        console.log(`🔄 Modele geçiş: ${models[nextModelIndex]} | Sohbet: ${chatJid} | Hata: ${status}`);
        
        await sleep(2000);
        return await getAIResponse(message, chatJid, imageBuffer);
      } else {
        modelStates.set(chatJid, 0);
        return "_🤯 Tüm modeller denenip hata alındı. Lütfen geliştiricime haber verin._";
      }
    }

    if (status && [429, 500, 502, 503].includes(status)) {
      const nextModelIndex = (modelStates.get(chatJid) || 0) + 1;

      if (nextModelIndex < models.length) {
        modelStates.set(chatJid, nextModelIndex);
        modelCooldowns.set(chatJid, Date.now() + retryAfterMs + 500);
        console.log(`🔄 Modele geçiş: ${models[nextModelIndex]} | Sohbet: ${chatJid} | Hata: ${status}`);
        
        await sleep(retryAfterMs + 1000);
        return await getAIResponse(message, chatJid, imageBuffer);
      } else {
        modelStates.set(chatJid, 0);
        modelCooldowns.set(chatJid, Date.now() + Math.max(retryAfterMs, 5000));
        return `_🤯 Tüm modeller başarısız oldu (kod: ${status}). Lütfen bir süre sonra tekrar deneyin._`;
      }
    }

    if (lastError && lastError.isMaxAttempts) {
      return "_❌ Çok fazla deneme yapıldı, isteğiniz tamamlanamadı. Ağ/Servis durumunu kontrol edin._";
    }

    if (lastError?.response) {
      return `_❌ API Error: ${JSON.stringify(lastError.response.data || lastError.message)}_`;
    }
    return "_❌ Ağ hatası! 🛜 Lütfen bağlantınızı kontrol edin ve tekrar deneyin._";
  }
}

function isChatbotEnabled(jid) {
  if (chatbotStates.get(jid) === true) {
    return true;
  }

  const isGroup = jid.includes("@g.us");
  if (isGroup && config.AI_ALL_GRUP === "true") {
    return true;
  }

  if (!isGroup && config.AI_ALL_DM === "true") {
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
  if (target === "grup") {
    for (const [jid] of chatbotStates.entries()) {
      if (jid.includes("@g.us")) {
        clearContext(jid);
      }
    }
  } else if (target === "dm") {
    for (const [jid] of chatbotStates.entries()) {
      if (!jid.includes("@g.us")) {
        clearContext(jid);
      }
    }
  }
}

initChatbotData();
logValidGeminiModels();

Module(
  {
    pattern: "yzayar ?(.*)",
    fromMe: true,
    desc: "Gemini API ile yapay zeka destekli sohbet botu yapılandırması - metin ve görüntü analizini destekler.",
    usage:
      '.yzayar - _Ayar menüsünü açar\n.yzayar aç/kapat - _Mevcut sohbette etkinleştir/devre dışı bırak_\n.yzayar aç/kapat grup - _Tüm gruplarda etkinleştir/devre dışı bırak_\n.yzayar aç/kapat dm - _DM olarak çalışmasını etkinleştir/devre dışı bırak_\n.yzayar seç "istem" - _Varsayılan istemi ayarla_\n.yzayar temizle - _Tüm sohbet geçmişini sil_\n_Yapay Zeka görsel analizi için görsellere yanıt verebilirsiniz_',
  },
  async (message, match) => {
    const input = match[1]?.trim();
    const chatJid = message.jid;

    if (!input) {
      const isEnabled = isChatbotEnabled(chatJid);
      const globalGroups = config.AI_ALL_GRUP === "true";
      const globalDMs = config.AI_ALL_DM === "true";
      const currentModel = models[modelStates.get(chatJid) || 0];
      const contextSize = chatContexts.get(chatJid)?.length || 0;
      const hasApiKey = !!config.GEMINI_API_KEY;

      const helpText =
        `*_🤖 Yapay Zeka Botu Yapılandırması_*\n\n` +
        `📊 _Mevcut Durum:_ \`${isEnabled ? "Aktif" : "Devre Dışı"}\`\n` +
        `🔑 _API Anahtarı:_ \`${hasApiKey ? "Ekli ✅" : "Eksik ❌"}\`\n` +
        `🌐 _Gruplarda:_ \`${
          globalGroups ? "Aktif ✅" : "Devre Dışı ❌"
        }\`\n` +
        `💬 _DM'de:_ \`${globalDMs ? "Aktif ✅" : "Devre Dışı ❌"}\`\n` +
        `🤖 Seçili Model:_ \`${currentModel}\`\n` +
        `💭 _Sohbet Hafızası:_ \`${contextSize}\`\n` +
        `🎯 _Varsayılan İstem:_ \`${globalSystemPrompt.substring(0, 100)}${
          globalSystemPrompt.length > 100 ? "..." : ""
        }\`\n\n` +
        (hasApiKey
          ? `*_Komutlar:_*\n` +
            `- \`.yzayar aç\` - _Mevcut sohbette Yapay Zeka'yı etkinleştirir_\n` +
            `- \`.yzayar kapat\` - _Mevcut sohbette Yapay Zeka'yı kapatır\n` +
            `- \`.yzayar aç grup\` - _Tüm gruplarda Yapay Zeka'yı etkinleştirir_\n` +
            `- \`.yzayar aç dm\` - _DM için Yapay Zeka'yı etkinleştirir_\n` +
            `- \`.yzayar kapat grup\` - _Tüm gruplarda Yapay Zeka'yı kapatır\n` +
            `- \`.yzayar kapat dm\` - _DM için Yapay Zeka'yı kapatır\n` +
            `- \`.yzayar seç "istem"\` - _Varsayılan istemi ayarlar_\n` +
            `- \`.yzayar temizle\` - _Tüm sohbet geçmişini siler_\n` +
            `- \`.yzayar durum\` - _Ayrıntılı olarak yapılandırmayı gösterir_\n\n` +
            `🤔 *_Peki, nasıl çalışır?_*\n` +
            `- _Bot'a gönderilen direkt mesajlar Yapay Zeka'yı çalıştırır_\n` +
            `- _Bahsetmeler (@bot) Yapay Zeka'yı çalıştırır_\n` +
            `- _Bot mesajlarına verilen yanıtlar Yapay Zeka'yı çalıştırır_\n` +
            `- _Görsel Analizi için mesajı yanıtlamak Yapay Zeka'yı çalıştırır_\n` +
            `- _Sohbet geçmişini otomatik olarak korur_\n` +
            `- _Hız limitlerine bağlı olarak modelleri otomatik olarak değiştirir_`
          : `*_⚠️ Kurulum Gerekli!_*\n` +
            `_Yapay Zeka'yı kullanmak için API anahtarı gereklidir._\n\n` +
            `*_API anahtarı edinmek için:_*\n` +
            `- _Bağlantıya tıklayın: https://aistudio.google.com/app/apikey_\n` +
            `- _Google hesabınızla oturum açın_\n` +
            `- _API Anahtarı Oluşturun_\n\n` +
            `*_API anahtarınızı ayarlamak içinse:_*\n` +
            `\`.setvar GEMINI_API_KEY=your_api_key_here\`\n\n` +
            `_Anahtarı ayarladıktan sonra aktifleştirmek için \`.yzayar aç\` yazın._`);

      return await message.sendReply(helpText);
    }

    const args = input.split(" ");
    const command = args[0].toLowerCase();
    const target = args[1]?.toLowerCase();

    switch (command) {
      case "aç":
        if (!config.GEMINI_API_KEY) {
          return await message.sendReply(
            `*_❌ GEMINI_API_KEY Eklenmemiş!_*\n\n` +
              `_Gemini API anahtarı olmadan Yapay Zeka etkinleştirilemez._\n\n` +
              `*_API anahtarı edinmek için:_*\n` +
              `- _Bağlantıya tıklayın: https://aistudio.google.com/app/apikey_\n` +
              `- _Google hesabınızla oturum açın_\n` +
              `- _API Anahtarı Oluşturun_\n` +
              `- _Oluşturulan API anahtarını kopyalayın._\n\n` +
              `*_API anahtarınızı ayarlamak içinse:_*\n` +
              `\`.setvar GEMINI_API_KEY=sizin_api_anahtarınız\`\n\n` +
              `_Şu kısmı \`sizin_api_anahtarınız\` gerçek API anahtarınızla değiştirin._`
          );
        }

        if (target === "grup") {
          await setVar("AI_ALL_GRUP", "true");
          return await message.sendReply(
            `*_🤖 Tüm gruplar için Yapay Zeka aktifleştirildi!_*\n\n` +
              `✅ _Yapay Zeka artık tüm gruplarda yanıt verecek._\n` +
              `🤖 _Model:_ \`${models[0]}\`\n` +
              `📍 _Çalışma Koşulu:_ _Yalnızca bahsetmeler ve mesaj yanıtları_\n\n` +
              `_Yeniden devre dışı bırakmak için \`.yzayar kapat grup\` yazın._`
          );
        } else if (target === "dm") {
          await setVar("AI_ALL_DM", "true");
          return await message.sendReply(
            `*_🤖 DM için Yapay Zeka Aktifleştirildi!_*\n\n` +
              `✅ _Yapay Zeka artık doğrudan tüm mesajlara yanıt verecek._\n` +
              `🤖 _Model:_ \`${models[0]}\`\n` +
              `📍 _Çalışma Koşulu:_ _Tüm Mesajlar_\n\n` +
              `_Yeniden devre dışı bırakmak için \`.yzayar kapat dm\` yazın._`
          );
        } else {
          await enableChatbot(chatJid);
          return await message.sendReply(
            `*_🤖 Yapay Zeka Aktif!_*\n\n` +
              `📍 _Sohbet:_ \`${chatJid.includes("@g.us") ? "Group" : "DM"}\`\n` +
              `🤖 _Model:_ \`${models[0]}\`\n` +
              `💭 _Sohbet Geçmişi:_ _Yeni Başlangıç_\n\n` +
              `_Artık direkt mesajlara, bahsetmelere ve mesaj yanıtlarına cevap vereceğim!_`
          );
        }

      case "kapat":
        if (target === "grup") {
          await setVar("AI_ALL_GRUP", "false");
          return await message.sendReply(
            `*_🤖 Tüm gruplar için Yapay Zeka devre dışı bırakıldı!_*\n\n` +
              `❌ _Yapay Zeka artık hiçbir grupta yanıt vermeyecek._\n` +
              `📝 _Kişisel grup ayarları korunacaktır._\n\n` +
              `_Yeniden aktifleştirmek için \`.yzayar aç grup\` yazın._`
          );
        } else if (target === "dm") {
          await setVar("AI_ALL_DM", "false");
          return await message.sendReply(
            `🤖 *_DM için Yapay Zeka devre dışı bırakıldı!_*\n\n` +
              `❌ _Yapay Zeka artık DM üzerinden yanıt vermeyecek._\n` +
              `📝 _Kişisel DM ayarları korunacaktır._\n` +
              `_Yeniden aktifleştirmek için \`.yzayar aç dm\` yazın._`
          );
        } else {
          await disableChatbot(chatJid);
          return await message.sendReply(
            `*_🤖 Yapay Zeka artık devre dışı!_*\n\n` +
              `_Bu sohbette Yapay Zeka devre dışı bırakıldı._\n` +
              `_Sohbet geçmişi ise temizlendi._`
          );
        }

      case "seç":
        const promptMatch = input.match(/"([^"]+)"/);
        if (!promptMatch) {
          return await message.sendReply(
            `_Lütfen istemi tırnak içinde belirtin._\n\n` +
              `*_Örnek:_*\n` +
              `\`.yzayar seç "Sen konuşma konusunda uzmanlaşmış, yardımsever bir asistansın."\``
          );
        }
        const newPrompt = promptMatch[1];
        await saveSystemPrompt(newPrompt);
        return await message.sendReply(
          `*_🎯 Varsayılan İstem Güncellendi!_*\n\n` +
            `📝 _Yeni İstem:_ \`${newPrompt}\`\n\n` +
            `_Bu tüm yeni sohbetler için geçerli olacaktır._`
        );

      case "temizle":
        if (target === "grup" || target === "dm") {
          await clearAllContexts(target);
          return await message.sendReply(
            `*_💭 Contexts Cleared for All ${target === "grup" ? "Grup" : "DM"}_*\n\n` +
              `_Conversation histories have been reset for all ${target === "grup" ? "grup" : "DM"}._\n` +
              `_Next messages will start fresh conversations._`
          );
        } else {
          clearContext(chatJid);
          return await message.sendReply(
            `*_💭 Geçmiş Temizlendi!_*\n\n` +
              `_Konuşma geçmişi sıfırlandı._\n` +
              `_Sonraki mesaj yeni bir konuşma başlatacak._`
          );
        }

      case "durum":
        const isEnabled = isChatbotEnabled(chatJid);
        const isEnabledIndividually = chatbotStates.get(chatJid) === true;
        const globalGroups = config.AI_ALL_GRUP === "true";
        const globalDMs = config.AI_ALL_DM === "true";
        const currentModel = models[modelStates.get(chatJid) || 0];
        const contextSize = chatContexts.get(chatJid)?.length || 0;
        const modelIndex = modelStates.get(chatJid) || 0;
        const isGroup = chatJid.includes("@g.us");

        let enabledReason = "";
        if (isEnabledIndividually) {
          enabledReason = "Individual setting";
        } else if (isGroup && globalGroups) {
          enabledReason = "Global groups setting";
        } else if (!isGroup && globalDMs) {
          enabledReason = "Global DMs setting";
        }

        const statusText =
          `*_🤖 Chatbot Status_*\n\n` +
          `📊 _Status:_ \`${isEnabled ? "Enabled ✅" : "Disabled ❌"}\`\n` +
          (isEnabled && enabledReason
            ? `📋 _Enabled via:_ \`${enabledReason}\`\n`
            : "") +
          `🌐 _Global Groups:_ \`${
            globalGroups ? "Enabled ✅" : "Disabled ❌"
          }\`\n` +
          `💬 _Global DMs:_ \`${globalDMs ? "Enabled ✅" : "Disabled ❌"}\`\n` +
          `🤖 _Current Model:_ \`${currentModel}\`\n` +
          `📈 _Model Fallback Level:_ \`${modelIndex + 1}/${models.length}\`\n` +
          `💭 _Context Messages:_ \`${contextSize}\`\n` +
          `🎯 _System Prompt:_ \`${globalSystemPrompt}\`\n` +
          `🔑 _API Key:_ \`${config.GEMINI_API_KEY ? "Configured ✅" : "Missing ❌"}\`\n\n` +
          `*_Available Models:_*\n` +
          models
            .map(
              (model, index) =>
                `${index + 1}. \`${model}\` ${index === modelIndex ? "← Current" : ""}`
            )
            .join("\n");

        return await message.sendReply(statusText);

      default:
        return await message.sendReply(
          `_Bilinmeyen komut: \`${command}\`_\n\n_Kullanılabilir komutları görmek için \`.yzayar\` yazın._`
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
          console.error("Görsel indirilirken hata oluştu:", error);
          return await message.sendReply(
            "_❌ Görsel indirme başarısız oldu. Lütfen tekrar deneyin._"
          );
        }
      } else if (!messageText || messageText.length < 2) {
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

      const aiResponse = await getAIResponse(responseText, chatJid, imageBuffer);

      if (aiResponse) {
        await message.sendReply(aiResponse);
      }
    } catch (error) {
      console.error("Mesaj işleyicisinde hata:", error);
    }
  }
);

Module({
    pattern: "yz ?(.*)",
    fromMe: false,
    desc: "Gemini - Yapay Zeka'sına mesaj veya görsel ile soru sorun.",
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
          console.error("Görsel indirilirken hata oluştu::", error);
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
              console.error("Albüm görselleri işlenirken hata oluştu:", err);
            }
          }

          if (!imageParts.length) {
            return await message.sendReply("❌ Albümde hiçbir görsel bulunamadı.");
          }
          if (!prompt) prompt = "Bu görselleri benim için analiz et.";
        } catch (error) {
          console.error("Albüm indirme hatası:", error);
          return await message.sendReply("❌ Albüm indirmesi başarısız oldu.");
        }
      }
      else if (message.reply_message.text && !prompt) {
        prompt = message.reply_message.text;
      }
    }

    if (!prompt && !imageParts.length) {
      return await message.sendReply("⚠️ Lütfen bir mesaja/görsele yanıt verin veya hızlı bir şekilde cevaplayın.");
    }

    let sent_msg;
    try {
      sent_msg = await message.sendReply("🧐 _Düşünüyorum..._");
      const fullText = await callGenerativeAI(prompt, imageParts, message, sent_msg);

      if (!fullText) {
        await message.edit("❌ Yapay Zeka'dan boş yanıt alındı.", message.jid, sent_msg.key);
        return;
      }

      await message.edit(fullText, message.jid, sent_msg.key);
    } catch (error) {
      console.error("YZ komut hatası:", error.message);
      if (sent_msg) {
        await message.edit("❌ Yapay Zeka API'sinde bir hata oluştu.", message.jid, sent_msg.key);
      } else {
        await message.sendReply("❌ Yapay Zeka API'sinde bir hata oluştu.");
      }
    }
  }
);

Module({
    pattern: "soruçöz ?(.*)",
    fromMe: false,
    desc: "Sınav sorularını YZ yardımıyla çözer",
    type: "ai",
  },
  async (message, match) => {
    let extra = match[1]?.trim() || "";
    let imageParts = [];

    let basePrompt =
      "Şimdi gönderilen sınav sorusunu adım adım çözelim. " +
      "Önce soruyu analiz et, sonra çözüm yolunu açık ve mantıklı bir şekilde adım adım göster. " +
      "En sonunda ise net cevabı yaz.";

    if (extra) {
      basePrompt += "\n\nEk not: " + extra;
    }

    if (message.reply_message) {
      if (message.reply_message.image) {
        try {
          const buffer = await message.reply_message.download("buffer");
          const part = await imageToGenerativePart(buffer);
          if (part) imageParts.push(part);
        } catch (err) {
          console.error("Görsel indirilemedi:", err);
          return await message.sendReply("❌ Görsel yüklenemedi. Tekrar deneyin.");
        }
      } else if (message.reply_message.album) {
        try {
          const album = await message.reply_message.download();
          for (const img of album.images) {
            const buffer = fs.readFileSync(img);
            const part = await imageToGenerativePart(buffer);
            if (part) imageParts.push(part);
          }
        } catch (err) {
          console.error("Albüm indirilemedi:", err);
          return await message.sendReply("❌ Medya yüklenemedi! Tekrar deneyin.");
        }
      }
    }

    if (!imageParts.length && !message.reply_message?.text) {
      return await message.sendReply("❗ *Lütfen bir sınav sorusuna yanıtlayarak `.soruçöz` yazın.*");
    }

    let sent;
    try {
      sent = await message.sendReply("🧐 _Düşünüyorum..._");

      const result = await callGenerativeAI(
        basePrompt,
        imageParts,
        message,
        sent
      );

      if (!result) {
        return await message.edit(
          "❌ YZ boş yanıt gönderdi.",
          message.jid,
          sent.key
        );
      }

      await message.edit(result, message.jid, sent.key);
    } catch (err) {
      console.error("SORU ÇÖZME HATASI:", err);
      if (sent) {
        await message.edit(
          "❌ İşlemde hata oluştu. Tekrar deneyiniz.",
          message.jid,
          sent.key
        );
      } else {
        await message.sendReply("❌ Yapay Zeka hatası!");
      }
    }
  }
);

Module({
    pattern: "animeçiz ?(.*)",
    fromMe: false,
    desc: "Fotoğrafı Yapay Zeka ile anime stiline dönüştürür.",
    type: "ai",
  },
  async (message, match) => {
    if (!message.reply_message?.image) {
      return await message.sendReply("❗ *Lütfen bir fotoğrafa yanıt vererek `.animeçiz` yazın.*");
    }
    let sent;
    let tempFile = null;
    try {
      sent = await message.send("🎨 _Anime stili uygulanıyor..._ ⌛");
      const buffer = await message.reply_message.download("buffer");
      tempFile = `./temp_anime_${Date.now()}.jpg`;
      fs.writeFileSync(tempFile, buffer);
      const uploadResult = await uploadToImgbb(tempFile);
      const imageUrl = uploadResult.url;
      const animeResponse = await axios.get(
        `https://zellapi.autos/ai/applyfilter?imageUrl=${encodeURIComponent(imageUrl)}`
      );
      if (!animeResponse.data?.result) {
        throw new Error("API'den geçersiz yanıt");
      }
      const animeBuffer = await getBuffer(animeResponse.data.result);
      await message.edit("✅ _Anime stili uygulandı!_", message.jid, sent.key);
      await message.client.sendMessage(message.jid, {
        image: animeBuffer
      }, { quoted: message.reply_message });
    } catch (err) {
      console.error("ANİME ÇİZME HATASI:", err.response?.data || err.message);
      if (sent) {
        await message.edit(
          "❌ Anime dönüştürmesi başarısız oldu. Lütfen tekrar deneyin.",
          message.jid,
          sent.key
        );
      } else {
        await message.sendReply("❌ *Anime dönüştürmesi başarısız oldu!*");
      }
    } finally {
      if (tempFile && fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  }
);
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
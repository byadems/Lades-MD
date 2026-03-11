const axios = require('axios');
const fs = require('fs/promises');
const { Module } = require('../main');
const { MODE } = require('../config');
let auto = MODE === 'public' ? false : true;

const CHECK_INTERVAL = 90000;
const lastEarthquakeFilePath = 'lastEarthquake.txt';
let intervalId = null;
let lastEarthquake = {};

(async () => {
  try {
    const data = await fs.readFile(lastEarthquakeFilePath, 'utf-8');
    if (data) lastEarthquake = JSON.parse(data);
  } catch (err) {
    console.log('No previous earthquake data found, starting fresh.');
  }
})();

const getEarthquakeData = async (timeout = 30000, retryCount = 0) => {
  try {
    const response = await axios.get('https://api.orhanaydogdu.com.tr/deprem/kandilli/live?limit=1', { timeout });
    return { earthquakes: response.data.result };
  } catch (err) {
    console.error(`Error fetching earthquake data: ${err.message}`);
    if (retryCount < 10) {
      console.log(`Retrying request (attempt ${retryCount + 1})...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      return getEarthquakeData(timeout, retryCount + 1);
    } else {
      console.error('Failed to fetch earthquake data after 10 attempts, throwing error');
      throw err;
    }
  }
};
/*
Module({ on: 'text', fromMe: false }, async (m, mat) => {
  if (intervalId) return;

  intervalId = setInterval(async () => {
    try {
      const { earthquakes } = await getEarthquakeData();
      const latestEarthquake = earthquakes[0];
      const { title, mag, date } = latestEarthquake;

      if (
        mag >= 3.0 &&
        (!lastEarthquake || (lastEarthquake.title !== title || lastEarthquake.mag !== mag || lastEarthquake.date !== date))
      ) {
        const info = `🌍 *YENİ DEPREM TESPİT EDİLDİ!*\n\n📍 Konum: *${title}*\n🌟 Büyüklük: *${mag}*\n⏰ Zaman: *${new Date(date).toLocaleString('tr-TR', { hour12: false })}*`;

        console.log(`[${new Date().toISOString()}] Yeni deprem algılandı: ${title}, M${mag}, ${new Date(date).toLocaleString('tr-TR')}`);

        try {
          await m.client.sendMessage("120363417442983144@newsletter", { text: info });
        } catch (err) {
          console.error(`[${new Date().toISOString()}] Mesaj gönderilemedi: ${err.message}`);
        }

        lastEarthquake = { title, mag, date };
        await fs.writeFile(lastEarthquakeFilePath, JSON.stringify(lastEarthquake));
      }

    } catch (err) {
      console.error(`Error processing earthquake data: ${err.message}`);
      try {
        await m.send(`❌ *HATA*: ${err.message}`);
      } catch (sendErr) {
        console.error(`Error sending error message: ${sendErr.message}`);
      }
    }
  }, CHECK_INTERVAL);
});
*/
const formatKandilliDate = (dateTime) => {
  if (!dateTime) return 'Veri yok';
  const [datePart, timePart] = dateTime.split(' ');
  const [year, month, day] = datePart.split('-');
  return `${day}.${month}.${year} ${timePart}`;
};
const normalize = (text = '') =>
  text
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
const listAllEarthquakes = async (m, { limit, region } = {}) => {
  try {
    let url = 'https://api.orhanaydogdu.com.tr/deprem/kandilli/live';
    if (limit && Number.isInteger(limit)) url += `?limit=${limit}`;
    const response = await axios.get(url);
    const { metadata, result: earthquakes } = response.data;
    let message = `🌍 *SON DEPREMLER:*\n\n`;
    if (metadata) {
      message += `📅 Zaman: *${formatKandilliDate(metadata.date_starts)}*\n`;
      message += `🧮 Toplam Deprem Sayısı: *${metadata.count}*\n`;
    }
    let filtered = earthquakes;
    if (region) {
      const key = normalize(region);
      filtered = earthquakes.filter((eq) =>
        normalize(eq.title || '').includes(key)
      );
      message += `\n📍 Şehir filtresi: *${region}*\n`;
    }
    message += `📊 Gösterilen deprem sayısı: *${filtered.length}*\n\n`;
    if (!filtered.length) {
      await m.send(message + '⚠️ Eşleşen deprem kaydı bulunamadı.\n');
      return;
    }
    filtered.forEach((earthquake, index) => {
      const time = formatKandilliDate(earthquake.date_time);
      message += `${index + 1}. 📍 Konum: *${earthquake.title}*\n`;
      message += `🌟 Büyüklük: *${earthquake.mag}*\n`;
      message += `⏰ Zaman: *${time}*\n\n`;
    });
    await m.send(message);
  } catch (err) {
    await m.send(`❌ HATA: ${err.message}`);
  }
};

Module({
  pattern: 'sondepremler ?(.*)',
  fromMe: false,
  desc: 'Türkiye genelinde gerçekleşen son depremleri listeler.',
  use: 'utility',
}, async (m, match) => {
  const rawArgs = (match && match[1] ? match[1] : '').trim();
  const args = rawArgs.split(/\s+/).filter(Boolean);
  let limit = null;
  let region = null;
  args.forEach((arg) => {
    if (/^\d+$/.test(arg)) {
      limit = parseInt(arg, 10);
    } else {
      region = arg;
    }
  });
  await listAllEarthquakes(m, { limit, region });
});
//CREATED BY MASK SER
//EDITED BY @WindAndro
const {Module} = require('../main')
const {MODE} = require('../config')
var x = MODE == 'public'?false:true
var list = '```' + `╔════════════════
║ 📸 FOTOĞRAF DÜZENLEME KOMUTLARI 🎨
╚═══════════════ Herhangi bir fotoğrafa yanıt vererek kullanabilirsiniz.
╔════════════════
║
║ Komutlar
╔════════════════
║ 𝟷) .𝙱𝙻𝚄𝚁 🌫️
║ 𝟸) .𝙿𝙸𝚇𝙴𝙻𝙰𝚃𝙴 🎨
║ 𝟹) .𝚁𝙰𝙸𝙽𝙱𝙾𝚆 🌈
║ 𝟺) .𝙷𝙾𝚁𝙽𝚈 🔥
║ 𝟻) .𝙱𝚆 🚿
║ 𝟼) .𝚁𝙴𝙳 ❤️‍🔥
║ 𝟽) .𝙶𝚁𝙴𝙴𝙽 🌿
║ 𝟾) .𝙱𝙻𝚄𝙴 🌑
║ 𝟿) .𝙶𝙰𝚈 🌈
║ 𝟷𝟶) .𝙶𝙻𝙰𝚂𝚂 👓
║ 𝟷𝟷) .𝚆𝙰𝚂𝚃𝙴𝙳 💦
║ 𝟷𝟸) .𝙿𝙰𝚂𝚂𝙴𝙳 💋
║ 𝟷𝟹) .𝙹𝙰𝙸𝙻 🎭
║ 𝟷𝟺) .𝙲𝙾𝙼𝚁𝙰𝙳𝙴 💬
║ 𝟷𝟻) .𝙸𝙽𝚅𝙴𝚁𝚃 🎤
║ 𝟷𝟼) .𝟸𝙸𝙽𝚅𝙴𝚁𝚃 🎶
║ 𝟷𝟾) .𝙶𝙾𝙻𝙳𝙴𝙽 🌟
║ 𝟷𝟿) .𝚂𝙸𝙼𝙿𝙲𝙰𝚁𝙳 🌀
║ 𝟷𝟾) .𝚃𝙷𝚁𝙴𝚂𝙷𝙾𝙻𝙳 🎉
╚════════════════ ` + '```';

// Efekt uygulama fonksiyonu
async function applyEffect(message, effect) {
  if (!message.reply_message) return await message.sendReply("❗️ *Bir fotoğrafa yanıt vererek yazınız.*");
  const imageUrl = await message.reply_message.download();
  const { link } = await upload(imageUrl);
  return await message.sendMessage(await skbuffer(`https://some-random-api.ml/canvas/${effect}?avatar=${link}`), 'image');
}

Module({
  pattern: "editör",
  fromMe: x,
  desc: "Fotoğraf düzenleme araçlarını getirir."
}, async(message, match) => {
await message.sendReply(list);
});

Module({
  pattern: 'blur ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Fotoğrafı bulanıklaştırır.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'blur');
});

Module({
  pattern: 'rainbow ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Yuvarlak gökkuşağı efekti.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'lgbt');
});

Module({
  pattern: 'pixelate ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Fotoğrafı pikselleştirir.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'pixelate');
});

Module({
  pattern: 'horny ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Ateşli kart üretir.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'horny');
});

Module({
  pattern: 'bw ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Siyah-beyaz efekti uygular.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'greyscale');
});

Module({
  pattern: 'red ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Kırmızı filtre uygular.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'red');
});

Module({
  pattern: 'green ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Yeşil filtre uygular.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'green');
});

Module({
  pattern: 'blue ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Mavi filtre uygular.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'blue');
});

Module({
  pattern: 'gay ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Gay efekti uygular.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'gay');
});

Module({
  pattern: 'glass ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Cam efekti uygular.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'glass');
});

Module({
  pattern: 'wasted ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'GTA Wasted efekti uygular.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'wasted');
});

Module({
  pattern: 'passed ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'GTA Mission passed efekti uygular.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'passed');
});

Module({
  pattern: 'jail ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Hapishane efekti uygular.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'jail');
});

Module({
  pattern: 'comrade ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Arkadaş efekti uygular.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'comrade');
});

Module({
  pattern: 'invert ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Ters çevirme efekti uygular.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'invert');
});

Module({
  pattern: '2invert ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Ters çevirme efektinin farklı bir şeklini uygular.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'invertgreyacale');
});

Module({
  pattern: 'golden ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Altın rengini uygular.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'sepia');
});

Module({
  pattern: 'simpcard ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Sim kartı uygular.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'simpcard');
});

Module({
  pattern: 'threshold ?(.*)',
  fromMe: x,
  dontAddCommandList: true,
  desc: 'Eşik filtresi uygular.',
  type: 'misc',
}, async (message, match) => {
  await applyEffect(message, 'threshold');
});

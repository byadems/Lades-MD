const { Module } = require('../main');
const { mentionjid } = require('./utils');
const { getString } = require('./utils/lang');
const Lang = getString('group');

Module({
    pattern: 'testgay ?(.*)',
    fromMe: false,
    use: 'group',
    desc: 'Etiketlediğiniz üyenin gaylik yüzdesini ölçer.'
}, async (message, match) => {
    const user = message.mention?.[0] || message.reply_message?.jid
    if (!user) return await message.sendReply(Lang.NEED_USER)
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND)
    const calculate = `üyesinin *Gay* olma ihtimalini hesaplıyorum... 🧐`;
    const randomNumber = Math.floor(Math.random() * 100) + 1;
    const result = `🏳️‍🌈 Senin *Gaylik* yüzden: *%${randomNumber}!*`;
    await message.client.sendMessage(message.jid, {
        text: mentionjid(user) + calculate,
        mentions: [user]
    })
    await message.send(result)
});

Module({
    pattern: 'testlez ?(.*)',
    fromMe: false,
    use: 'group',
    desc: 'Etiketlediğiniz üyenin lezlik yüzdesini ölçer.'
}, async (message, match) => {
    const user = message.mention?.[0] || message.reply_message?.jid
    if (!user) return await message.sendReply(Lang.NEED_USER)
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND)
    const randomNumber = Math.floor(Math.random() * 100) + 1;
    const result = `👩🏻‍❤️‍👩🏼 Senin *Lezlik* yüzden: *%${randomNumber}!*`;
    const calculate = `üyesinin *Lez* olma ihtimalini hesaplıyorum... 🧐`;
    await message.client.sendMessage(message.jid, {
        text: mentionjid(user) + calculate,
        mentions: [user]
    })
    await message.send(result)
});

Module({
    pattern: 'testprenses ?(.*)',
    fromMe: false,
    use: 'group',
    desc: 'Etiketlediğiniz üyenin prenseslik seviyesini ölçer.',
}, async (message, match) => {
    const user = message.mention?.[0] || message.reply_message?.jid
    if (!user) return await message.sendReply(Lang.NEED_USER)
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND)
    const calculate = `üyesinin *Prenses* olma ihtimalini hesaplıyorum... 🧐`;
    const randomNumber = Math.floor(Math.random() * 100) + 1;
    const result = `🤭 Senin *Prenseslik* yüzden: *%${randomNumber}!* 👸🏻`;
    await message.client.sendMessage(message.jid, {
        text: mentionjid(user) + calculate,
        mentions: [user]
    })
    await message.send(result)
});

Module({
    pattern: 'testregl ?(.*)',
    fromMe: false,
    use: 'group',
    desc: 'Etiketlediğiniz üyenin Regl olma ihtimalini ölçer.',
}, async (message, match) => {
    const user = message.mention?.[0] || message.reply_message?.jid
    if (!user) return await message.sendReply(Lang.NEED_USER)
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND)
    const calculate = `üyesinin *Regl* olma ihtimalini hesaplıyorum... 🧐`;
    const randomNumber = Math.floor(Math.random() * 100) + 1;
    const result = `🩸 Senin *Regl* yüzden: *%${randomNumber}!* 😆`;
    await message.client.sendMessage(message.jid, {
        text: mentionjid(user) + calculate,
        mentions: [user]
    })
    await message.send(result)
});

Module({
  pattern: 'aşkölç ?(.*)',
  fromMe: false,
  use: 'group',
  desc: 'İki kişi arasındaki aşk yüzdesini ölçer.',
}, async (message, match) => {
  if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND)
  const percentage = Math.floor(Math.random() * 101)
  const mentioned = message.mention || []
  if (mentioned.length > 0) {
    if (mentioned.length < 2) {
      return await message.sendReply('❗️ 2 isim yazmalısınız!')
    }
    const [u1, u2] = mentioned
    const text =
      `🔥 ${mentionjid(u1)}ve ${mentionjid(u2)}` +
      `arasındaki aşk yüzdesi: *%${percentage}!* ❤️‍🔥`
    return await message.client.sendMessage(message.jid, {
      text,
      mentions: [u1, u2],
    })
  }
  const parts = (match[1] || '').trim().split(/ +/).slice(0, 2)
  if (parts.length !== 2) {
    return await message.sendReply('❗️ 2 isim yazmalısınız!')
  }
  const [name1, name2] = parts
  const result =
    `🔥 *${name1}* ve *${name2}* ` +
    `arasındaki aşk yüzdesi: *%${percentage}!* ❤️‍🔥`
  await message.send(result)
})
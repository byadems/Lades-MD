const { Module } = require("../main");
const { mentionjid } = require("./utils");
const { getString } = require("./utils/lang");

const Lang = getString("group");

const getTargetUser = (message) => message.mention?.[0] || message.reply_message?.jid;
const randomPercent = () => Math.floor(Math.random() * 100) + 1;

async function runSingleRateCommand(message, { introText, resultText }) {
  if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);

  const user = getTargetUser(message);
  if (!user) return await message.sendReply(Lang.NEED_USER);

  await message.client.sendMessage(message.jid, {
    text: `${mentionjid(user)} ${introText}`,
    mentions: [user],
  });

  return await message.send(resultText(randomPercent()));
}

Module(
  {
    pattern: "testgay ?(.*)",
    fromMe: false,
    use: "group",
    desc: "Etiketlediğiniz üyenin gaylik yüzdesini ölçer.",
  },
  async (message) => {
    await runSingleRateCommand(message, {
      introText: "üyesinin *Gay* olma ihtimalini hesaplıyorum... 🧐",
      resultText: (percent) => `🏳️‍🌈 Senin *Gaylik* yüzden: *%${percent}!*`,
    });
  }
);

Module(
  {
    pattern: "testlez ?(.*)",
    fromMe: false,
    use: "group",
    desc: "Etiketlediğiniz üyenin lezlik yüzdesini ölçer.",
  },
  async (message) => {
    await runSingleRateCommand(message, {
      introText: "üyesinin *Lez* olma ihtimalini hesaplıyorum... 🧐",
      resultText: (percent) => `👩🏻‍❤️‍👩🏼 Senin *Lezlik* yüzden: *%${percent}!*`,
    });
  }
);

Module(
  {
    pattern: "testprenses ?(.*)",
    fromMe: false,
    use: "group",
    desc: "Etiketlediğiniz üyenin prenseslik seviyesini ölçer.",
  },
  async (message) => {
    await runSingleRateCommand(message, {
      introText: "üyesinin *Prenses* olma ihtimalini hesaplıyorum... 🧐",
      resultText: (percent) => `🤭 Senin *Prenseslik* yüzden: *%${percent}!* 👸🏻`,
    });
  }
);

Module(
  {
    pattern: "testregl ?(.*)",
    fromMe: false,
    use: "group",
    desc: "Etiketlediğiniz üyenin Regl olma ihtimalini ölçer.",
  },
  async (message) => {
    await runSingleRateCommand(message, {
      introText: "üyesinin *Regl* olma ihtimalini hesaplıyorum... 🧐",
      resultText: (percent) => `🩸 Senin *Regl* yüzden: *%${percent}!* 😆`,
    });
  }
);

Module(
  {
    pattern: "testinanç ?(.*)",
    fromMe: false,
    use: "group",
    desc: "Etiketlediğiniz üyenin inanç seviyesini ölçer.",
  },
  async (message) => {
    await runSingleRateCommand(message, {
      introText: "üyesinin *İnanç* seviyesini hesaplıyorum... 🧐",
      resultText: (percent) => `🛐 Senin *İnanç* yüzden: *%${percent}!*`,
    });
  }
);

Module(
  {
    pattern: "aşkölç ?(.*)",
    fromMe: false,
    use: "group",
    desc: "İki kişi arasındaki aşk yüzdesini ölçer.",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);

    const percentage = Math.floor(Math.random() * 101);
    const mentioned = message.mention || [];

    if (mentioned.length > 0) {
      if (mentioned.length < 2) {
        return await message.sendReply("❗️ 2 isim yazmalısınız!");
      }

      const [u1, u2] = mentioned;
      return await message.client.sendMessage(message.jid, {
        text:
          `🔥 ${mentionjid(u1)} ve ${mentionjid(u2)} ` +
          `arasındaki aşk yüzdesi: *%${percentage}!* ❤️‍🔥`,
        mentions: [u1, u2],
      });
    }

    const parts = (match[1] || "").trim().split(/ +/).slice(0, 2);
    if (parts.length !== 2) {
      return await message.sendReply("❗️ 2 isim yazmalısınız!");
    }

    const [name1, name2] = parts;
    return await message.send(
      `🔥 *${name1}* ve *${name2}* arasındaki aşk yüzdesi: *%${percentage}!* ❤️‍🔥`
    );
  }
);

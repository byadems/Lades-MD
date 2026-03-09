const { Module } = require("../main");

Module(
  {
    pattern: "reload",
    fromMe: true,
    excludeFromCommands: true,
  },
  async (m) => {
    await m.sendReply("_✨ Bot yeniden başlatılıyor..._");
    process.exit(0);
  }
);

Module(
  {
    pattern: "reboot",
    fromMe: true,
    excludeFromCommands: true,
  },
  async (m) => {
    await m.sendReply("_✨ Bot yeniden başlatılıyor..._");
    process.exit(0);
  }
);

Module(
  {
    pattern: "restart",
    fromMe: true,
    desc: "Botu yeniden başlatır",
    use: "system",
  },
  async (m) => {
    await m.sendReply("_✨ Bot yeniden başlatılıyor..._");
    process.exit(0);
  }
);

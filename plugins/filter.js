const { Module } = require("../main");
const { ADMIN_ACCESS, HANDLERS } = require("../config");
const { isAdmin, filter } = require("./utils");

const handler = HANDLERS !== "false" ? HANDLERS.split("")[0] : "";

Module(
  {
    pattern: "filter ?(.*)",
    fromMe: false,
    desc: "Create auto-reply filters. Usage: .filter trigger | response | scope(optional) | options(optional)",
    usage:
      ".filter hello | Hi there! | chat\n.filter help | I can help you | global\n.filter bye | Goodbye! | group | exact",
    use: "utility",
  },
  async (message, match) => {
    if (match[0].includes("filters")) return;
    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;
    const input = match[1]?.trim();
    if (!input) {
      return await message.sendReply(
        `*📝 Filtre Komutları:*\n\n` +
          `• \`${handler}filter trigger | response\` - Create chat filter\n` +
          `• \`${handler}filter trigger | response | global\` - Create global filter\n` +
          `• \`${handler}filter trigger | response | group\` - Create group-only filter\n` +
          `• \`${handler}filter trigger | response | dm\` - Create DM-only filter\n` +
          `• \`${handler}filter trigger | response | chat | exact\` - Exact match only\n` +
          `• \`${handler}filter trigger | response | chat | case\` - Case sensitive\n` +
          `• \`${handler}filters\` - List all filters\n` +
          `• \`${handler}delfilter trigger\` - Delete filter\n` +
          `• \`${handler}togglefilter trigger\` - Enable/disable filter\n\n` +
          `*Scopes:*\n` +
          `• \`chat\` - Current chat only (default)\n` +
          `• \`global\` - All chats\n` +
          `• \`group\` - All groups\n` +
          `• \`dm\` - All DMs\n\n` +
          `*Options:*\n` +
          `• \`exact\` - Exact word match only\n` +
          `• \`case\` - Case sensitive matching`
      );
    }

    const parts = input.split("|").map((p) => p.trim());
    if (parts.length < 2) {
      return await message.sendReply(
        "_Format: tetikleyici | yanıt | kapsam(isteğe bağlı) | seçenekler(isteğe bağlı)_"
      );
    }

    const trigger = parts[0];
    const response = parts[1];
    const scope = parts[2] || "chat";
    const options = parts[3] || "";

    if (!trigger || !response) {
      return await message.sendReply(
        "_Hem tetikleyici hem de yanıt gereklidir!_"
      );
    }

    if (!["chat", "global", "group", "dm"].includes(scope)) {
      return await message.sendReply(
        "_Geçersiz kapsam! Şunları kullanın: chat, global, group veya dm_"
      );
    }

    const filterOptions = {
      caseSensitive: options.includes("case"),
      exactMatch: options.includes("exact"),
    };

    try {
      await filter.set(
        trigger,
        response,
        message.jid,
        scope,
        message.sender,
        filterOptions
      );

      const scopeText =
        scope === "chat"
          ? "this chat"
          : scope === "global"
          ? "all chats"
          : `all ${scope}s`;
      const optionsText = [];
      if (filterOptions.exactMatch) optionsText.push("exact match");
      if (filterOptions.caseSensitive) optionsText.push("case sensitive");
      const optionsStr = optionsText.length
        ? ` (${optionsText.join(", ")})`
        : "";

      await message.sendReply(
        `✅ *Filtre Oluşturuldu!*\n\n` +
          `*Trigger:* ${trigger}\n` +
          `*Response:* ${response}\n` +
          `*Scope:* ${scopeText}${optionsStr}`
      );
    } catch (error) {
      console.error("Filter creation error:", error);
      await message.sendReply("_Filtre oluşturulamadı!_");
    }
  }
);

Module(
  {
    pattern: "filters ?(.*)",
    fromMe: false,
    desc: "List all filters",
    usage: ".filters\n.filters global\n.filters group",
    use: "utility",
  },
  async (message, match) => {
    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;

    const scope = match[1]?.trim().toLowerCase();
    let filters;

    try {
      if (scope && ["global", "group", "dm"].includes(scope)) {
        filters = await filter.getByScope(scope);
      } else {
        filters = await filter.get(message.jid);
      }

      if (!filters || filters.length === 0) {
        return await message.sendReply("_Filtre bulunamadı!_");
      }

      let msg = `*📝 Active Filters:*\n\n`;

      filters.forEach((f, index) => {
        const scopeEmoji =
          {
            chat: "💬",
            global: "🌍",
            group: "👥",
            dm: "📱",
          }[f.scope] || "💬";

        const options = [];
        if (f.exactMatch) options.push("exact");
        if (f.caseSensitive) options.push("case");
        const optionsStr = options.length ? ` [${options.join(", ")}]` : "";

        msg += `${index + 1}. ${scopeEmoji} *${f.trigger}*${optionsStr}\n`;
        msg += `   ↳ _${f.response.substring(0, 50)}${
          f.response.length > 50 ? "..." : ""
        }_\n`;
        msg += `   _Scope: ${f.scope}${f.enabled ? "" : " (disabled)"}_\n\n`;
      });

      await message.sendReply(msg);
    } catch (error) {
      console.error("Filter listing error:", error);
      await message.sendReply("_Filtreler alınamadı!_");
    }
  }
);

Module(
  {
    pattern: "delfilter ?(.*)",
    fromMe: false,
    desc: "Delete a filter",
    usage: ".delfilter trigger\n.delfilter trigger global",
    use: "utility",
  },
  async (message, match) => {
    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;

    const input = match[1]?.trim();
    if (!input) {
      return await message.sendReply(
        "_Silinecek filtre tetikleyicisini belirtin!_\n_Kullanım: .delfilter tetikleyici_"
      );
    }

    const parts = input.split(" ");
    const trigger = parts[0];
    const scope = parts[1] || "chat";

    if (!["chat", "global", "group", "dm"].includes(scope)) {
      return await message.sendReply(
        "_Geçersiz kapsam! Şunları kullanın: chat, global, group veya dm_"
      );
    }

    try {
      const deleted = await filter.delete(trigger, message.jid, scope);

      if (deleted > 0) {
        await message.sendReply(
          `✅ _Filter "${trigger}" deleted successfully!_`
        );
      } else {
        await message.sendReply(`❌ _Filter "${trigger}" not found!_`);
      }
    } catch (error) {
      console.error("Filter deletion error:", error);
      await message.sendReply("_Filtre silinemedi!_");
    }
  }
);

Module(
  {
    pattern: "togglefilter ?(.*)",
    fromMe: false,
    desc: "Enable/disable a filter",
    usage: ".togglefilter trigger\n.togglefilter trigger global",
    use: "utility",
  },
  async (message, match) => {
    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;

    const input = match[1]?.trim();
    if (!input) {
      return await message.sendReply(
        "_Değiştirilecek filtre tetikleyicisini belirtin!_\n_Kullanım: .togglefilter tetikleyici_"
      );
    }

    const parts = input.split(" ");
    const trigger = parts[0];
    const scope = parts[1] || "chat";

    if (!["chat", "global", "group", "dm"].includes(scope)) {
      return await message.sendReply(
        "_Geçersiz kapsam! Şunları kullanın: chat, global, group veya dm_"
      );
    }

    try {
      const currentFilter = await filter.get(message.jid, trigger);
      if (!currentFilter) {
        return await message.sendReply(`❌ _Filter "${trigger}" not found!_`);
      }

      const newStatus = !currentFilter.enabled;
      const toggled = await filter.toggle(
        trigger,
        message.jid,
        scope,
        newStatus
      );

      if (toggled) {
        await message.sendReply(
          `✅ _Filter "${trigger}" ${
            newStatus ? "enabled" : "disabled"
          } successfully!_`
        );
      } else {
        await message.sendReply(`❌ _Failed to toggle filter "${trigger}"!_`);
      }
    } catch (error) {
      console.error("Filter toggle error:", error);
      await message.sendReply("_Filtre değiştirilemedi!_");
    }
  }
);

Module(
  {
    pattern: "testfilter ?(.*)",
    fromMe: false,
    desc: "Test if a message would trigger any filters",
    usage: ".testfilter hello world",
    use: "utility",
  },
  async (message, match) => {
    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;

    const testText = match[1]?.trim();
    if (!testText) {
      return await message.sendReply(
        "_Filtrelere karşı test edilecek metni girin!_\n_Kullanım: .testfilter merhaba dünya_"
      );
    }

    try {
      const matchedFilter = await filter.checkMatch(testText, message.jid);

      if (matchedFilter) {
        await message.sendReply(
          `✅ *Filtre Eşleşmesi Bulundu!*\n\n` +
            `*Trigger:* ${matchedFilter.trigger}\n` +
            `*Response:* ${matchedFilter.response}\n` +
            `*Scope:* ${matchedFilter.scope}\n` +
            `*Options:* ${matchedFilter.exactMatch ? "exact " : ""}${
              matchedFilter.caseSensitive
                ? "case-sensitive"
                : "case-insensitive"
            }`
        );
      } else {
        await message.sendReply(
          `❌ _No filters would be triggered by: "${testText}"_`
        );
      }
    } catch (error) {
      console.error("Filter test error:", error);
      await message.sendReply("_Filtre test edilemedi!_");
    }
  }
);

Module(
  {
    pattern: "filterhelp",
    fromMe: false,
    desc: "Detailed help for filter system",
    use: "utility",
  },
  async (message) => {
    const helpText =
      `*🔧 Filter System Help*\n\n` +
      `*What are filters?*\n` +
      `Filters are auto-reply triggers that respond to specific words or phrases automatically.\n\n` +
      `*📝 Creating Filters:*\n` +
      `\`${handler}filter hello | Hi there!\`\n` +
      `• Creates a chat-specific filter\n` +
      `• When someone says "hello", bot replies "Hi there!"\n\n` +
      `*🌍 Filter Scopes:*\n` +
      `• \`chat\` - Only works in current chat\n` +
      `• \`global\` - Works in all chats\n` +
      `• \`group\` - Works in all groups only\n` +
      `• \`dm\` - Works in all DMs only\n\n` +
      `*⚙️ Filter Options:*\n` +
      `• \`exact\` - Only exact word matches\n` +
      `• \`case\` - Case sensitive matching\n\n` +
      `*📋 Examples:*\n` +
      `\`${handler}filter bot | I'm here! | chat\`\n` +
      `\`${handler}filter help | Contact admin | global\`\n` +
      `\`${handler}filter Hello | Hi! | group | exact\`\n` +
      `\`${handler}filter PASSWORD | Shh! | dm | case\`\n\n` +
      `*🔧 Management:*\n` +
      `• \`${handler}filters\` - List all filters\n` +
      `• \`${handler}delfilter trigger\` - Delete filter\n` +
      `• \`${handler}togglefilter trigger\` - Enable/disable\n` +
      `• \`${handler}testfilter text\` - Test matching\n\n` +
      `*💡 Tips:*\n` +
      `• Filters are checked for every message\n` +
      `• Global filters work everywhere\n` +
      `• Use exact match for precise triggers\n` +
      `• Case sensitive is useful for passwords/codes`;

    await message.sendReply(helpText);
  }
);

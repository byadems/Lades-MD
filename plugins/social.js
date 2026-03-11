const { Module } = require("../main");
const {
  pinterestSearch,
  downloadGram,
  pinterestDl,
  tiktok,
  igStalk,
  fb,
} = require("./utils");
const nexray = require("./utils/nexray");
const botConfig = require("../config");
const axios = require("axios");
const isFromMe = botConfig.MODE === "public" ? false : true;

async function checkRedirect(url) {
  let split_url = url.split("/");
  if (split_url.includes("share")) {
    let res = await axios.get(url);
    return res.request.res.responseUrl;
  }
  return url;
}
Module(
  {
    pattern: "insta ?(.*)",
    fromMe: isFromMe,
    desc: "Instagram gönderi/Reels/TV indirici - çoklu bağlantı destekler",
    usage: "insta bağlantı(lar)ı veya bağlantıyı yanıtlayın",
    use: "download",
  },
  async (message, match) => {
    let mediaLinks = match[1] || message.reply_message?.text;
    if (mediaLinks.startsWith("ll")) return;
    if (!mediaLinks)
      return await message.sendReply("_*⚠️ Instagram bağlantı(lar)ı gerekli*_");

    // extract all urls from the text
    const allUrls = mediaLinks.match(/\bhttps?:\/\/\S+/gi) || [];
    if (!allUrls.length)
      return await message.sendReply("_*⚠️ Instagram bağlantı(lar)ı gerekli*_");

    // filter and validate instagram urls
    const instagramUrls = [];
    const instagramRegex =
      /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|s|reel|tv)\/[\w-]+/i;

    for (let url of allUrls) {
      if (url.includes("gist") || url.includes("youtu") || url.startsWith("ll"))
        continue;

      url = await checkRedirect(url);

      if (url.includes("stories")) continue;

      if (!url.includes("instagram.com")) continue;

      if (instagramRegex.test(url)) {
        const mediaId = url.match(/\/([\w-]+)\/?$/)?.[1];
        if (mediaId && mediaId.length > 20) continue; // skip private accounts

        instagramUrls.push(url);
      }
    }

    if (!instagramUrls.length)
      return await message.sendReply("_⚠️ Geçerli Instagram bağlantı(lar)ı gerekli_");

    try {
      const allMediaUrls = [];
      const quotedMessage = message.reply_message
        ? message.quoted
        : message.data;

      // download from all urls
      for (const url of instagramUrls) {
        try {
          let downloadResult = await downloadGram(url);
          if (!downloadResult?.length) {
            downloadResult = await nexray.downloadInstagram(url);
          }
          if (downloadResult && downloadResult.length) {
            allMediaUrls.push(...downloadResult);
          }
        } catch (err) {
          try {
            const fallback = await nexray.downloadInstagram(url);
            if (fallback?.length) allMediaUrls.push(...fallback);
          } catch (_) {
            console.error("İndirme hatası:", url, err?.message);
          }
        }
      }

      if (!allMediaUrls.length)
        return await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_"
        );

      // send as single media or album
      if (allMediaUrls.length === 1) {
        return await message.sendMessage(
          { url: allMediaUrls[0] },
          /\.(jpg|jpeg|png|webp|heic)(\?|$)/i.test(allMediaUrls[0])
            ? "image"
            : "video",
          {
            quoted: quotedMessage,
          }
        );
      }

      // send as album
      const albumObject = allMediaUrls.map((mediaUrl) => {
        return /\.(jpg|jpeg|png|webp|heic)(\?|$)/i.test(mediaUrl)
          ? { image: mediaUrl }
          : { video: mediaUrl };
      });
      albumObject[0].caption = `_İndirme tamamlandı! (${allMediaUrls.length} öğe)_`;
      return await message.client.albumMessage(
        message.jid,
        albumObject,
        message.data
      );
    } catch (err) {
      console.error("Instagram komut hatası:", err?.message || err);
      return await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_"
      );
    }
  }
);

Module(
  {
    pattern: "fb ?(.*)",
    fromMe: isFromMe,
    desc: "Facebook video indirici",
    usage: "fb bağlantısı veya bağlantıyı yanıtlayın",
    use: "download",
  },
  async (message, match) => {
    let videoLink = !message.reply_message?.message
      ? match[1]
      : message.reply_message.message;

    if (/\bhttps?:\/\/\S+/gi.test(videoLink)) {
      videoLink = videoLink.match(/\bhttps?:\/\/\S+/gi)[0];
    }
    if (!videoLink) return await message.sendReply("_⚠️ Facebook bağlantısı gerekli_");
    try {
      let result = await fb(videoLink);
      if (!result?.url) {
        result = await nexray.downloadFacebook(videoLink);
      }
      if (result?.url) {
        return await message.sendReply({ url: result.url }, "video");
      }
    } catch (e) {
      try {
        const fallback = await nexray.downloadFacebook(videoLink);
        if (fallback?.url) {
          return await message.sendReply({ url: fallback.url }, "video");
        }
      } catch (_) {}
      console.error("Facebook indirme hatası:", e.message);
    }
    return await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_"
    );
  }
);

Module(
  {
    pattern: "ig ?(.*)",
    fromMe: isFromMe,
    desc: "Instagram'dan hesap bilgilerini alır",
    usage: "ig kullanıcı adı",
    excludeFromCommands: true,
    use: "search",
  },
  async (message, match) => {
    if (!match[1]) return await message.sendReply("_⚠️ Instagram kullanıcı adı gerekli!_");

    if (match[1].startsWith("https") && match[1].includes("instagram")) {
      const usernameRegex = /instagram\.com\/([^/?]+)/i;
      const usernameMatch = match[1].match(usernameRegex);
      match[1] = usernameMatch && usernameMatch[1];
    }

    try {
      var accountInfo = await igStalk(encodeURIComponent(match[1]));
    } catch {
      return await message.sendReply("_⚠️ Sunucu meşgul!_");
    }

    await message.sendMessage({ url: accountInfo.profile_pic }, "image", {
      caption: `_*İsim:*_ ${accountInfo.full_name}\n_*Takipçi:*_ ${
        accountInfo.followers
      }\n_*Takip:*_ ${accountInfo.following}\n_*Biyografi:*_ ${
        accountInfo.bio
      }\n_*Gizli hesap:*_ ${
        accountInfo.is_private ? "Evet" : "Hayır"
      }\n_*Gönderi:*_ ${accountInfo.posts}`,
      quoted: message.data,
    });
  }
);

Module(
  {
    pattern: "story ?(.*)",
    fromMe: isFromMe,
    desc: "Instagram hikaye (story) indirici",
    usage: ".story kullanıcı adı veya bağlantı",
    use: "download",
  },
  async (message, match) => {
    let userIdentifier =
      match[1] !== "" ? match[1] : message.reply_message.text;

    if (
      userIdentifier &&
      (userIdentifier.includes("/reel/") ||
        userIdentifier.includes("/tv/") ||
        userIdentifier.includes("/p/"))
    )
      return;
    if (!userIdentifier)
      return await message.sendReply("_⚠️ Bir Instagram kullanıcı adı veya bağlantısı gerekli!_");

    userIdentifier = !/\bhttps?:\/\/\S+/gi.test(userIdentifier)
      ? `https://instagram.com/stories/${userIdentifier}/`
      : userIdentifier.match(/\bhttps?:\/\/\S+/gi)[0];

    try {
      var storyData = await downloadGram(userIdentifier);
    } catch {
      return await message.sendReply("*_❌ Üzgünüm, sunucu hatası_*");
    }
    if (!storyData || !storyData.length)
      return await message.sendReply("*_❌ Bulunamadı!_*");
    if (storyData.length === 1)
      return await message.sendReply(
        { url: storyData[0] },
        /\.(jpg|jpeg|png|webp)(\?|$)/i.test(storyData[0]) ? "image" : "video"
      );
    userIdentifier = userIdentifier
      .replace("https://instagram.com/stories/", "")
      .split("/")[0];
    let albumObject = storyData.map((storyMediaUrl) => {
      return /\.(jpg|jpeg|png|webp)(\?|$)/i.test(storyMediaUrl)
        ? { image: storyMediaUrl }
        : { video: storyMediaUrl };
    });
    albumObject[0].caption = `_${userIdentifier} hikayeleri_`;
    return await message.client.albumMessage(
      message.jid,
      albumObject,
      message.data
    );
  }
);

Module(
  {
    pattern: "pinterest ?(.*)",
    fromMe: isFromMe,
    desc: "Pinterest indirici",
    usage: ".pinterest arama veya bağlantı",
    use: "download",
  },
  async (message, match) => {
    let userQuery = match[1] !== "" ? match[1] : message.reply_message.text;
    if (userQuery === "g") return;
    if (!userQuery)
      return await message.sendReply("_⚠️ Arama terimi veya video bağlantısı gerekli_");

    if (/\bhttps?:\/\/\S+/gi.test(userQuery)) {
      userQuery = userQuery.match(/\bhttps?:\/\/\S+/gi)[0];
      let pinterestResult;
      let url;
      try {
        pinterestResult = await pinterestDl(userQuery);
        url = pinterestResult?.status && pinterestResult?.result ? pinterestResult.result : null;
        if (!url) url = await nexray.downloadPinterest(userQuery);
      } catch (err) {
        try {
          url = await nexray.downloadPinterest(userQuery);
        } catch (_) {
          console.error("Pinterest indirme hatası:", err?.message || err);
          return await message.sendReply("_❌ Sunucu hatası_");
        }
      }

      if (!url)
        return await message.sendReply("_❌ Bu bağlantı için indirilebilir medya bulunamadı_"
        );
      const quotedMessage = message.reply_message
        ? message.quoted
        : message.data;
      await message.sendMessage({ url }, "video", { quoted: quotedMessage });
    } else {
      let desiredCount = parseInt(userQuery.split(",")[1]) || 5;
      let searchQuery = userQuery.split(",")[0] || userQuery;
      let searchResults;
      try {
        const res = await pinterestSearch(searchQuery, desiredCount);
        if (!res || !res.status || !Array.isArray(res.result)) {
          return await message.sendReply("_❌ Bu sorgu için sonuç bulunamadı_");
        }
        searchResults = res.result;
      } catch (err) {
        console.error("Pinterest arama hatası:", err?.message || err);
        return await message.sendReply("_❌ Pinterest'te arama yaparken sunucu hatası_"
        );
      }

      const toDownload = Math.min(desiredCount, searchResults.length);
      await message.sendReply(
        `_Pinterest'ten ${searchQuery} için ${toDownload} sonuç indiriliyor_`
      );

      const imagesToSend = searchResults
        .slice(0, toDownload)
        .map((url) => ({ image: url }));
      imagesToSend[0].caption = `_Pinterest: ${searchQuery} sonuçları_`;
      try {
        await message.client.albumMessage(
          message.jid,
          imagesToSend,
          message.data
        );
      } catch (error) {
        console.log(
          "Albüm gönderilemedi, tekil gönderim deneniyor:",
          error
        );
        for (const url of searchResults) {
          try {
            await message.sendMessage({ url }, "image");
          } catch (error) {
            console.error(
              "Pinterest öğesi indirilemedi:",
              error?.message || error
            );
          }
        }
      }
    }
  }
);

Module(
  {
    pattern: "twitter ?(.*)",
    fromMe: isFromMe,
    desc: "Twitter/X video indirici",
    usage: ".twitter <bağlantı> veya bağlantıyı yanıtlayın",
    use: "download",
  },
  async (message, match) => {
    let videoLink = match[1] !== "" ? match[1] : message.reply_message?.text;
    if (!videoLink) return await message.sendReply("_⚠️ Bir Twitter/X URL'si gerekli_");
    videoLink = videoLink.match(/\bhttps?:\/\/\S+/gi)?.[0];
    if (!videoLink || !/twitter\.com|x\.com/i.test(videoLink))
      return await message.sendReply("_⚠️ Geçerli bir Twitter/X bağlantısı gerekli_");
    try {
      const result = await nexray.downloadTwitter(videoLink);
      if (result?.url) {
        await message.sendReply({ url: result.url }, "video");
      } else {
        await message.sendReply("_⚠️ Bu bağlantı için indirilebilir medya bulunamadı_");
      }
    } catch (e) {
      console.error("Twitter indirme hatası:", e?.message);
      await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_");
    }
  }
);

Module(
  {
    pattern: "tiktok ?(.*)",
    fromMe: isFromMe,
    desc: "TikTok video indirici",
    usage: ".tiktok yanıtla veya bağlantı",
    use: "download",
  },
  async (message, match) => {
    let videoLink = match[1] !== "" ? match[1] : message.reply_message.text;
    if (!videoLink) return await message.sendReply("_⚠️ Bir TikTok URL'si gerekli_");
    videoLink = videoLink.match(/\bhttps?:\/\/\S+/gi)[0];
    let downloadResult;
    try {
      downloadResult = await tiktok(videoLink);
      if (!downloadResult) {
        const fallback = await nexray.downloadTiktok(videoLink);
        downloadResult = fallback?.url ? { url: fallback.url } : null;
      }
      if (downloadResult) {
        await message.sendReply(downloadResult, "video");
      } else {
        await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_");
      }
    } catch (error) {
      try {
        const fallback = await nexray.downloadTiktok(videoLink);
        if (fallback?.url) {
          await message.sendReply({ url: fallback.url }, "video");
        } else {
          await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_");
        }
      } catch (_) {
        await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_");
      }
    }
  }
);

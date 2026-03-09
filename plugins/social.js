const { Module } = require("../main");
const {
  pinterestSearch,
  downloadGram,
  pinterestDl,
  tiktok,
  igStalk,
  fb,
} = require("./utils");
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
    usage: "insta link(s) or reply to link(s)",
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
          const downloadResult = await downloadGram(url);
          if (downloadResult && downloadResult.length) {
            allMediaUrls.push(...downloadResult);
          }
        } catch (err) {
          console.error("Error downloading from:", url, err?.message);
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
      albumObject[0].caption = `_Download complete! (${allMediaUrls.length} items)_`;
      return await message.client.albumMessage(
        message.jid,
        albumObject,
        message.data
      );
    } catch (err) {
      console.error("Insta command error:", err?.message || err);
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
    usage: "fb link or reply to a link",
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
      const { url } = await fb(videoLink);
      return await message.sendReply({ url }, "video");
    } catch (e) {
      console.error("Facebook download error:", e.message);
      return await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_"
      );
    }
  }
);

Module(
  {
    pattern: "ig ?(.*)",
    fromMe: isFromMe,
    desc: "Instagram'dan hesap bilgilerini alır",
    usage: "ig username",
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
      return await message.sendReply("_✨ Sunucu meşgul!_");
    }

    await message.sendMessage({ url: accountInfo.profile_pic }, "image", {
      caption: `_*Name:*_ ${accountInfo.full_name}\n_*Followers:*_ ${
        accountInfo.followers
      }\n_*Following:*_ ${accountInfo.following}\n_*Bio:*_ ${
        accountInfo.bio
      }\n_*Private account:*_ ${
        accountInfo.is_private ? "Yes" : "No"
      } \n_*Posts:*_ ${accountInfo.posts}`,
      quoted: message.data,
    });
  }
);

Module(
  {
    pattern: "story ?(.*)",
    fromMe: isFromMe,
    desc: "Instagram hikaye (story) indirici",
    usage: ".story username or link",
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
    albumObject[0].caption = `_Stories from ${userIdentifier}_`;
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
    usage: ".pinterest query or link",
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
      try {
        pinterestResult = await pinterestDl(userQuery);
      } catch (err) {
        console.error("pinterestDl error:", err?.message || err);
        return await message.sendReply("_❌ Sunucu hatası_");
      }

      if (
        !pinterestResult ||
        !pinterestResult.status ||
        !pinterestResult.result
      )
        return await message.sendReply("_❌ Bu bağlantı için indirilebilir medya bulunamadı_"
        );

      const url = pinterestResult.result;
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
        console.error("pinterestSearch error:", err?.message || err);
        return await message.sendReply("_❌ Pinterest'te arama yaparken sunucu hatası_"
        );
      }

      const toDownload = Math.min(desiredCount, searchResults.length);
      await message.sendReply(
        `_Downloading ${toDownload} results for ${searchQuery} from Pinterest_`
      );

      const imagesToSend = searchResults
        .slice(0, toDownload)
        .map((url) => ({ image: url }));
      imagesToSend[0].caption = `_Pinterest results for ${searchQuery}_`;
      try {
        await message.client.albumMessage(
          message.jid,
          imagesToSend,
          message.data
        );
      } catch (error) {
        console.log(
          "Album send failed, falling back to individual sends:",
          error
        );
        for (const url of searchResults) {
          try {
            await message.sendMessage({ url }, "image");
          } catch (error) {
            console.error(
              "Error downloading pinterest item:",
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
    pattern: "tiktok ?(.*)",
    fromMe: isFromMe,
    desc: "TikTok video indirici",
    usage: ".tiktok reply or link",
    use: "download",
  },
  async (message, match) => {
    let videoLink = match[1] !== "" ? match[1] : message.reply_message.text;
    if (!videoLink) return await message.sendReply("_⚠️ Bir TikTok URL'si gerekli_");
    videoLink = videoLink.match(/\bhttps?:\/\/\S+/gi)[0];
    let downloadResult;
    try {
      downloadResult = await tiktok(videoLink);
      await message.sendReply(downloadResult, "video");
    } catch (error) {
      return await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_"
      );
    }
  }
);

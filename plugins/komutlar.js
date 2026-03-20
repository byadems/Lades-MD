const { Module, commands } = require('../main');

// Komut adını çıkaran yardımcı fonksiyon
const extractCommandName = (pattern) => {
  const raw = pattern instanceof RegExp ? pattern.source : String(pattern || "");
  const start = raw.search(/[\p{L}\p{N}]/u);
  if (start === -1) return "";
  const cmdPart = raw.slice(start);
  const match = cmdPart.match(/^[\p{L}\p{N}]+/u);
  return match && match[0] ? match[0].trim() : "";
};

// Komut detaylarını bulan yardımcı fonksiyon
const retrieveCommandDetails = (commandName) => {
  const foundCommand = commands.find(
    (cmd) => extractCommandName(cmd.pattern) === commandName
  );
  if (!foundCommand) return null;
  return {
    name: commandName,
    ...foundCommand,
  };
};

Module({
  pattern: 'komut ?(.*)',
  fromMe: false,
  desc: 'Bot komutlarını listeler veya belirtilen komutun detaylarını gösterir.',
  use: 'utility',
  usage: '.komutlar | .komut spotify'
}, async (m, match) => {
  const arg = match[1]?.trim().toLowerCase();

  // Eğer 'lar' yazılmışsa tam listeyi göster
  if (arg === 'lar') {
    return await m.sendReply(
    "📣 *GENEL KOMUTLAR*\n" +
    "🧑 `uzakta`\nSizi AFK (Uzakta) yapar. Etiketlenirseniz Bot sizin yerinize cevap verir.\n\n" +
    "💻 `kontrol`\nBotun çalışıp çalışmadığını kontrol etmenizi sağlar.\n\n" +
    "📶 `ping`\nPing süresini (tepki hızını) ölçer.\n\n" +
    "⏱️ `uptime`\nSistem (OS) ve işlem çalışma süresini gösterir.\n\n" +
    "🕌 `ezan`\nEzan vakitlerini detaylı bir şekilde sağlar.\nÖrnek: .ezan Şehir Adı & Plaka\n\n" +
    "🕵️‍♀️ `sahur`\nAnlık sahur vaktine ne kadar süre kaldığını hesaplar.\n\n" +
    "🕵️‍♂️ `iftar`\nAnlık iftar vaktine ne kadar süre kaldığını hesaplar.\n\n" +
    "☁️ `hava`\nAnlık hava durumu bilgisi verir.\nÖrnek: .hava 21 | .hava Diyarbakır\n\n" +
    "💱 `kur`\nDöviz kuru dönüşümü yapar.\nÖrnek: .kur 1 DOLAR TL\n\n" +
    "🪙 `altın`\nGüncel altın fiyatlarını gösterir. (Kur, Gram, Çeyrek, Yarım, Tam Altın — alış/satış/değişim)\n\n" +
    "🈷️ `çevir`\nÇeviri yapar. (Bir mesaja yanıt vermeniz gerekir)\nÖrnek: .çevir en tr (İngilizceden Türkçeye çevirir.)\n\n" +
    "🈵 `detectlang`\nYanıtlanan mesajın dilini bulmaya çalışır.\n\n" +
    "📲 `true`\nBilinmeyen numara uygulaması TrueCaller'da numara sorgular.\n\n" +
    "📱 `onwa`\nNumaranın WhatsApp'da kayıtlı olup olmadığını sorgular.\nÖrnek: .onwa +90530xxxxxxx\n\n" +
    "🎬 `movie`\nFilm araması yapar.\n\n" +
    "💻 `hackernews`\nHacker haber makalelerini getirir.\n\n" +
    "📲 `waupdate`\nYaklaşan WhatsApp güncelleme haberlerini getirir.\n\n" +
    "📰 `news`\nEn son haberleri getirir. (Dünyadan)\n\n" +
    "📊 `wapoll`\nAnket oluşturur.\nÖrnek: .wapoll Anket başlığı, seçenek1, seçenek2, seçenek3\n\n" +
    "📝 `take`\nÇıkartma/ses dosyalarını değiştirir. Başlık, sanatçı, kapak resmi vb. değişiklik yapar.\n\n" +
    "🖋️ `fancy`\nŞık yazı tipleri oluşturur.\n\n" +
    "🔁 `tekrar`\nYanıtlanan komutu tekrar çalıştırır.\n\n" +
    "📣 `bildir`\nBot hakkında istek, şikayet, hata bildirimi, öneri veya talep iletir.\nÖrnek: .bildir öneri Müzik komutu eklensin\n\n" +
    "🧠 *YAPAY ZEKA KOMUTLARI*\n" +
    "🤖 `yz`\nGemini Yapay Zeka'ya soru sorun.\n\n" +
    "🎨 `yzgörsel`\nMetni görsele dönüştürür.\n\n" +
    "🖌️ `yzdüzenle`\nFotoğrafı talimata göre Yapay Zeka ile düzenler.\n\n" +
    "🎭 `yzanime`\nFotoğrafı anime stiline çevirir.\n\n" +
    "🧩 `soruçöz`\nSınav sorularını Yapay Zeka ile çözer.\n\n" +
    "📸 *MEDYA KOMUTLARI*\n" +
    "🎶 `şarkı`\nYouTube'dan şarkı indirir.\nÖrnek: .şarkı Şarkı Adı\n\n" +
    "🎧 `spotify`\nSpotify'dan şarkı indirir.\nÖrnek: .spotify Şarkı Bağlantısı\n\n" +
    "📹 `video`\nYouTube'dan video indirir.\n\n" +
    "🔽 `ytvideo`\nYouTube'daki videoyu istediğiniz kalitede indirmenizi sağlar.\n\n" +
    "" +
    "📷 `insta`\nInstagram'dan Gönderi/Reel İndirir.\nÖrnek: .insta bağlantı veya bağlantı mesajına yanıtlayın.\n\n" +
    "🔎 `igara`\nInstagram'dan kullanıcı bilgilerini getirir. (Stalk)\nÖrnek: .igara Kullanıcı Adı\n\n" +
    "📘 `fb`\nFacebook'dan gönderi/video indirir.\nÖrnek: .fb bağlantı veya bağlantı mesajına yanıtlayın\n\n" +
    "" +
    "📌 `pinterest`\nPinterest içeriğini indirmeyi sağlar.\nÖrnek: .pinterest bağlantı veya bağlantı mesajına yanıtlayın.\n\n" +
    "🎥 `tiktok`\nTikTok'dan video indirir.\nÖrnek: .tiktok bağlantı veya bağlantı mesajına yanıtlayın.\n\n" +
    "🔎 `ttara`\nTiktok'dan kullanıcı bilgilerini getirir. (Stalk)\nÖrnek:* .ttara Kullanıcı Adı\n\n" +
    "🔈 `ses`\nYazıyı sese çevirir.\n\n" +
    "🎙️ `dinle`\nSes mesajını metne dönüştürür. (Bir ses mesajına yanıtlayarak kullanın)\n\n" +
    "🔎 `bul`\nYapay Zekayı kullanarak şarkının adını bulur.\nÖrnek: .bul (ses dosyasına etiketleyin)\n\n" +
    "🖼️ `görsel`\nGoogle Görsellerden fotoğraf indirir.\n\n" +
    "⬆️ `upload`\nMedya dosyalarını ham URL'den indirip yükler.\n\n" +
    "" +
    "📂 `belge`\nEtiketlenen medyayı dosyaya dönüştürüp gönderir.\n\n" +
    "📄 `pdf`\nFotoğrafları PDF'ye dönüştürür.\nÖrnek: .pdf | .pdf get\n\n" +
    "🖼️ `çıkartma`\nYanıt verdiğiniz fotoğrafı veya videoyu çıkartmaya dönüştürür.\n\n" +
    "🎵 `mp3`\nVideodaki sesi, ses dosyasına dönüştürür.\n\n" +
    "🐢 `slow`\nMüziği yavaşlatır ve tonunu düşürür. (Slowed+reverb sesler için)\n\n" +
    "⚡ `sped`\nMüziği hızlandırır ve tonunu yükseltir. (Speed-up+reverb sesler için)\n\n" +
    "🔊 `basartır`\nBass ayarı yapar.\n\n" +
    "🏞️ `foto`\nÇıkartmayı fotoğrafa dönüştürür.\n\n" +
    "✨ `yazıçıkartma`\nMetni animasyonlu çıkartmaya dönüştürür.\n\n" +
    "🎞️ `mp4`\nAnimasyonlu çıkartmayı video dosyasına dönüştürür.\n\n" +
    "👀 `vv`\nTek seferlik görüntülenebilen medyayı gösterir.\n\n" +
    "🔍 `apsil`\nGörseldeki arka planı yapay zeka kullanarak kaldırır.\n\n" +
    "⬆️ `hd`\nGörsel kalitesini yapay zeka ile artırır/ölçeklendirir.\n\n" +
    "" +
    "✂️ `trim`\nBelirttiğiniz medyanın belirli bir kısmını kesmenizi sağlar.\nÖrnek: .trim 60,120\n\n" +
    "⚫ `siyahvideo`\nVideo görüntüsünü siyah video yapar. (Sese müdahale edilmez)\n\n" +
    "🎬 `birleştir`\nSes ve video dosyasını birleştirir.\n\n" +
    "🎥 `vmix`\nİki video dosyasını birleştirir.\n\n" +
    "🐌 `ağırçekim`\nSes dosyasına ağır çekim efekti uygular.\n\n" +
    "⚙️ `interp`\nVideo'nun kare hızını artırır. (FPS)\n\n" +
    "🔄 `döndür`\nVideoyu döndürür. (Sola/Sağa)\nÖrnek: .rotate left|right|flip\n\n" +
    "🔀 `flip`\nVideoyu terse döndürür.\n\n" +
    "⭕ `oval`\nÇıkartma/fotoğrafı daire olarak kırpmayı sağlar.\n\n" +
    "📽️ `gif`\nVideoyu gif'e dönüştürür. (Sesle birlikte)\n\n" +
    "" +
    "🖼️ `ss`\nBelirtilen sitenin ekran görüntüsünü alır.\n\n" +
    "⏫ `url`\nGörseli imgur.com'a yükler ve bağlantısını paylaşır.\n\n" +
    "🖌️ `editör`\nFotoğraf düzenleme komutlarını listeler.\n\n" +
    "🏅 *SINAV BİLGİLENDİRME KOMUTLARI*\n" +
    "🧠🤖 `soruçöz`\nYapay Zekayı kullanarak sınav sorularını çözer.\n\n" +
    "🎓 `bilgikaçnet`\nÜniversite bölümleri için kaç net yapmak gerektiğini, bölümün tam olarak ne olduğunu, ne iş yaptığını ve iş olanaklarına dair detaylı bilgiler sağlar.\n\n" +
    "⏳ `ykssayaç`\nYKS sınavlarına ne kadar süre kaldığını hesaplar.\n\n" +
    "📅 `kpsssayaç`\nKPSS sınavlarına ne kadar süre kaldığını hesaplar.\n\n" +
    "📜 `msüsayaç`\nMSÜ sınavlarına ne kadar süre kaldığını hesaplar.\n\n" +
    "🏫 `okulsayaç`\nOkulların kapanmasına ne kadar süre kaldığını hesaplar.\n\n" +
    "" +
    "📅 *TARİH, SAAT VE PLANLAMA KOMUTLARI*\n" +
    "🎂 `yaşhesap`\nYaş hesaplar.\nÖrnek: .age 10/01/2021\n\n" +
    "⏳ `gerisayım`\nZaman hesabı yapar. Belirlediğiniz tarihe ne kadar kaldığını söyler.\nÖrnek: .cntd 10/01/2031\n\n" +
    "🌙 `ramazansayaç`\nRamazan ayına ne kadar süre kaldığını hesaplar.\n\n" +
    "⏰ `planla`\nYanıtlanan mesajı belirli bir zamanda gruba veya özele gönderir.\nÖrnek: .planla @üye 2 saat | .planla dm @üye 30 dakika\n\n" +
    "📋 `plandurum`\nPlanlanmış tüm mesajları ve gönderilme zamanlarını listeler.\n\n" +
    "🗑️ `plansil`\nPlanlanan mesajı ID numarasıyla iptal eder.\nÖrnek: .plansil 3\n\n" +
    "🔧 *GRUP YÖNETİM KOMUTLARI*\n" +
    "😈 `at`\nEtiketlenen kişiyi (sürprizli bir şekilde) gruptan çıkarır.\n\n" +
    "❌ `ban`\nEtiketlenen kişiyi gruptan çıkarır.\n\n" +
    "🛡️ `ytetiket`\nTüm yöneticileri etiketlemeyi sağlar. (Olası bir olayda oldukça kullanışlıdır. Aynı zamanda şikayet/talep/öneri için de kullanılabilir)\n\n" +
    "📢 `tagall`\nEtiketlenen mesajı tüm grup üyelerini etiketleyecek şekilde yeniden gönderir. (Duyurular vb. için kullanışlıdır.)\n\n" +
    "👥 `etiket`\nGrubun tüm üyelerini etiketler.\n\n" +
    "🗑️ `msjsil`\nEtiketlenen mesajı herkesten siler.\n\n" +
    "📌 `sabitle`\nYanıtlanan mesajı belirli bir süre için sabitler.\nÖrnek: .sabitle 24s | .sabitle 7g | .sabitle 30g\n\n" +
    "🛑 `filtre`\nFiltre (otomatik yanıtı) ayarı yapar.\n\n" +
    "🚫 `filtresil`\nFiltreyi (otomatik yanıtı) durdurur.\n\n" +
    "👋 `welcome`\nGrup için hoş geldiniz mesajını ayarlar. Eğer mesaj yazmazsanız, ayarlı hoş geldiniz mesajını getirir.\n\n" +
    "👋 `goodbye`\nGrup için görüşürüz mesajını ayarlar. Eğer mesaj yazmazsanız, ayarlı görüşürüz mesajını getirir.\n\n" +
    "✅ `istekler`\nBekleyen katılım isteklerini toplu onaylamayı veya toplu reddetmeyi sağlar.\nÖrnek: .requests approve all ya da reject all\n\n" +
    "💬 `quoted`\nYanıtlanan mesajın yanıtını gösterir. Silinen mesajları geri almak için kullanışlıdır.\n\n" +
    "📈 `mesajlar`\nŞu ana kadar üyelerin gönderdiği mesajların sayısını gösterir. (Sadece Bot'un gruba dahil olduğu andan itibaren)\n\n" +
    "👥 `üyetemizle`\nAktif olmayan üyeleri tarar ve çıkartılmasını sağlar. (Bot'un gruba dahil olduğu zamandan itibaren)\nÖrnek: .üyetemizle 5 gün, .üyetemizle 4 hafta, .üyetemizle 30 gün çıkar\n\n" +
    "🔇 `sohbetkapat`\nGrup sohbetini kapatır. Yalnızca yöneticiler mesaj gönderebilir.\nÖrnek: .mute & .mute 5m vb.\nÖrnek: .mute 1h\nmute 5m\n\n" +
    "🔊 `sohbetaç`\nGrup sohbetini açar ve böylelikle herkes mesaj gönderebilir.\n\n" +
    "🔍 `jid`\nBelirtilen kişinin veya sohbetin JID adres bilgisini verir.\n\n" +
    "🔗 `davetyenile`\nGrubun davet bağlantısını sıfırlar.\n\n" +
    "🏷️ `grupadı`\nGrup başlığını değiştirir.\n\n" +
    "📝 `grupaçıklama`\nGrup açıklamasını değiştirir.\n\n" +
    "🤝 `common`\nİki grup arasındaki ortak katılımcıları alır ve .common kick jid komutuyla onları atar.\n\n" +
    "🔍 `diff`\nİki grup arasındaki katılımcı farklarını gösterir.\n\n" +
    "🔗 `katıl`\nBelirttiğiniz gruba katılmamı sağlar.\nÖrnek: .join https://chat.whatsapp.com/ladesbot\n\n" +
    "📸 `pp`\nEtiketlenen kişinin profil fotoğrafını gönderir.\n\n" +
    "🌐 `grupfoto`\nGrup logosunu değiştirmeyi sağlar.\n\n" +
    "🗒️ `stickcmd`\nÇıkartma komutlarına sabitleme yapar. Ve eğer o çıkartma sizden gönderilmişse, komut olarak çalışır!\nÖrnek: .stickcmd hmm\nUyarı! Sadece çıkartmalarda çalışır.\n\n" +
    "❌ `otoçıkartmasil`\nÇıkartmalarda sabitlenmiş komutları siler.\nÖrnek: .otoçıkartmasil hmm\n\n" +
    "📋 `otoçıkartmalar`\nÇıkartmalarda sabitlenmiş komutları gösterir.\n\n" +
    "🕒 `otosohbetkapat`\nGrubu belirlediğiniz saatte otomatik olarak mesajlaşmaya kapatır. (Hindistan saatine göre)\n\n" +
    "📅 `otosohbetaç`\nGrubu belirlediğiniz saatte otomatik olarak mesajlaşmaya açar. (Hindistan saatine göre)\n\n" +
    "⏲️ `getmute`\nAyarlanmış otomatik açma/kapama olup olmadığını kontrol eder.\n\n" +
    "📝 `düzenle`\nBot'un yazdığı mesajı düzenlemeye yarar.\n\n" +
    "⚠️ `uyar`\nMesajı yanıtlanan kişiyi uyarır. 3 uyarıdan sonra kişi otomatik olarak gruptan çıkarılır.\n\n" +
    "📊 `kaçuyarı`\nBelirtilen kişinin toplam uyarı sayısını gösterir.\n\n" +
    "➖ `uyarısil`\nSeçilen kişinin uyarı sayısını 1 azaltır.\n\n" +
    "🔁 `sıfırlauyarı`\nKişinin uyarı sayısını sıfırlar.\n\n" +
    "⚙️ `uyarılimit`\nGrubun maksimum uyarı limitini ayarlar. (Varsayılan: 3)"
  );
  return;
}

// Eğer 'lar' değilse ama yine de bir argüman varsa detay göster
if (arg) {
  const commandDetails = retrieveCommandDetails(arg);
  if (!commandDetails) {
    return await m.sendReply(
      `_❌ '${arg}' komutu bulunamadı. Komut listesine bakmak için *.komut lar* yazın._`
    );
  }

  let infoMessage = `*📋 ───「 Komut Detayları 」───*\n\n`;
  infoMessage += `• *Komut:* \`${commandDetails.name}\`\n`;
  infoMessage += `• *Açıklama:* ${commandDetails.desc || "Yok"}\n`;
  infoMessage += `• *Sahibi:* ${commandDetails.fromMe ? "Bot Sahibi" : "Herkes"}\n`;
  if (commandDetails.use) infoMessage += `• *Tür:* ${commandDetails.use}\n`;
  if (commandDetails.usage)
    infoMessage += `• *Kullanım:* ${commandDetails.usage}\n`;
  if (commandDetails.warn)
    infoMessage += `• *Uyarı:* ${commandDetails.warn}\n`;

  return await m.sendReply(infoMessage);
}

// Hiçbir şey yazılmamışsa kullanım hatırlatıcısı ver
await m.sendReply(
  "*💬 Kullanım:* \n\n" +
  "• *.komutlar* - Tüm komut listesini gösterir.\n" +
  "• *.komut <isim>* - Belirli bir komutun detaylarını gösterir.\n" +
  "_Örnek: .komut spotify_"
);
});
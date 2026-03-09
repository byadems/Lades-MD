const fs = require('fs');
const path = require('path');

// All remaining English -> Turkish replacements
const replacements = [
  // ========== mention.js ==========
  ['.mention set (reply to message) | .mention set <text> | .mention get | .mention del | .mention help',
   '.mention set (mesajı yanıtlayın) | .mention set <metin> | .mention get | .mention del | .mention help'],
  ['Set mention reply (reply to message or add text)', 'Etiket yanıtını ayarla (mesajı yanıtla veya metin ekle)'],
  ['View current mention reply', 'Mevcut etiket yanıtını görüntüle'],
  ['Delete mention reply', 'Etiket yanıtını sil'],
  ['Show detailed help', 'Ayrıntılı yardımı göster'],
  ['Show help', 'Yardımı göster'],
  ['Set mention reply', 'Etiket yanıtını ayarla'],
  ['*Current Mention Reply:*', '*Mevcut Etiket Yanıtı:*'],
  ['*Type:*', '*Tür:*'],
  ['*Caption:*', '*Başlık:*'],
  ['*Media URL:*', '*Medya URL:*'],
  ['*Set on:*', '*Ayarlandı:*'],
  ['*Content:*', '*İçerik:*'],
  ['Media file', 'Medya dosyası'],
  ['Mention reply set successfully!', 'Etiket yanıtı başarıyla ayarlandı!'],
  ['*Auto Mention Reply Help*', '*Otomatik Etiket Yanıtı Yardım*'],
  ['*What is it?*', '*Nedir?*'],
  ['When someone mentions the bot or sudo users, the bot automatically sends a saved reply message.', 'Birisi botu veya yöneticileri etiketlediğinde, bot otomatik olarak kaydedilmiş yanıtı gönderir.'],
  ['*Commands:* _(Owner only)_', '*Komutlar:* _(Sadece sahip)_'],
  ['Reply to any message to set it as mention reply', 'Etiket yanıtı olarak ayarlamak için herhangi bir mesajı yanıtlayın'],
  ['Set text as mention reply', 'Metni etiket yanıtı olarak ayarla'],
  ['View current mention reply', 'Mevcut etiket yanıtını görüntüle'],
  ['Delete mention reply', 'Etiket yanıtını sil'],
  ['*Supported Types:*', '*Desteklenen Türler:*'],
  ['Text messages', 'Metin mesajları'],
  ['Images _(with captions)_', 'Görseller _(başlıklı)_'],
  ['Videos _(with captions)_', 'Videolar _(başlıklı)_'],
  ['Audio files', 'Ses dosyaları'],
  ['Stickers', 'Çıkartmalar'],
  ['Documents', 'Belgeler'],
  ['*How it works:*', '*Nasıl çalışır:*'],
  ['1. Set a mention reply using the commands above', '1. Yukarıdaki komutları kullanarak etiket yanıtı ayarlayın'],
  ['2. When someone mentions @bot or @sudo in a message', '2. Birisi mesajda botu veya yöneticileri etiketlediğinde'],
  ['3. Bot automatically sends the saved reply', '3. Bot otomatik olarak kaydedilmiş yanıtı gönderir'],
  ['*Examples:*', '*Örnekler:*'],
  ['Reply to an image and type', 'Bir resmi yanıtlayıp şunu yazın'],
  ['to see current reply', 'mevcut yanıtı görmek için'],
  ['to remove reply', 'yanıtı kaldırmak için'],
  ['_Note: Media files are uploaded to cloud storage for reliability._', '_Not: Medya dosyaları güvenilirlik için bulut depolamaya yüklenir._'],
  ['*Available commands:*', '*Mevcut komutlar:*'],

  // ========== chatbot.js ==========
  ['You are a helpful AI assistant named Lades. Be concise, friendly, and informative.', 'Sen Lades adında yardımsever bir yapay zeka asistandısın. Kısa, nazik ve bilgilendirici ol.'],
  ['*_🤖 AI Chatbot Management_*', '*_🤖 YZ Sohbet Botu Yönetimi_*'],
  ['_Current Status:_', '_Mevcut Durum:_'],
  ['"Enabled"', '"Açık"'],
  ['"Disabled"', '"Kapalı"'],
  ['_API Key:_', '_API Anahtarı:_'],
  ['"Configured ✅"', '"Yapılandırıldı ✅"'],
  ['"Missing ❌"', '"Eksik ❌"'],
  ['_Global Groups:_', '_Genel Gruplar:_'],
  ['"Enabled ✅"', '"Açık ✅"'],
  ['"Disabled ❌"', '"Kapalı ❌"'],
  ['_Global DMs:_', '_Genel DM\'ler:_'],
  ['_Current Model:_', '_Mevcut Model:_'],
  ['_Context Messages:_', '_Bağlam Mesajları:_'],
  ['_System Prompt:_', '_Sistem Komutu:_'],
  ['*_Commands:_*', '*_Komutlar:_*'],
  ['_Enable chatbot in this chat_', '_Bu sohbette sohbet botunu aç_'],
  ['_Disable chatbot in this chat_', '_Bu sohbette sohbet botunu kapat_'],
  ['_Enable in all groups_', '_Tüm gruplarda aç_'],
  ['_Enable in all DMs_', '_Tüm DM\'lerde aç_'],
  ['_Disable in all groups_', '_Tüm gruplarda kapat_'],
  ['_Disable in all DMs_', '_Tüm DM\'lerde kapat_'],
  ['_Set system prompt_', '_Sistem komutunu ayarla_'],
  ['_Clear conversation context_', '_AI geçmişini temizle_'],
  ['_Show detailed status_', '_Detaylı durumu göster_'],
  ['*_How it works:_*', '*_Nasıl çalışır:_*'],
  ['_Direct messages to bot trigger AI response_', '_Bota gelen direkt mesajlar YZ yanıtını tetikler_'],
  ['_Mentions (@bot) trigger AI response_', '_Etiketler (@bot) YZ yanıtını tetikler_'],
  ['_Replies to bot messages trigger AI response_', '_Bot mesajlarına yanıtlar YZ yanıtını tetikler_'],
  ['_Reply to images for AI image analysis_', '_Görsellere yanıt vererek YZ görsel analizi yapın_'],
  ['_Maintains conversation context automatically_', '_Konuşma bağlamını otomatik olarak sürdürür_'],
  ['_Auto-switches models on rate limits_', '_Hız sınırlarında otomatik model değiştirir_'],
  ['*_⚠️ Setup Required:_*', '*_⚠️ Kurulum Gerekli:_*'],
  ['_API key is required to use chatbot._', '_Sohbet botunu kullanmak için API anahtarı gereklidir._'],
  ['*_Get your API key:_*', '*_API anahtarınızı alın:_*'],
  ['_Visit: https://aistudio.google.com/app/apikey_', '_Ziyaret edin: https://aistudio.google.com/app/apikey_'],
  ['_Sign in with Google account_', '_Google hesabıyla giriş yapın_'],
  ['_Create API Key_', '_API Anahtarı Oluşturun_'],
  ['*_Set your API key:_*', '*_API anahtarınızı ayarlayın:_*'],
  ['_After setting the key, use', '_Anahtarı ayarladıktan sonra, etkinleştirmek için'],
  ['to enable._', 'kullanın._'],
  ['_Cannot enable chatbot without Gemini API key._', '_Gemini API anahtarı olmadan sohbet botu etkinleştirilemez._'],
  ['*_How to get your API key:_*', '*_API anahtarınızı nasıl alırsınız:_*'],
  ['_Sign in with your Google account_', '_Google hesabınızla giriş yapın_'],
  ['"Create API Key"', '"API Anahtarı Oluştur"'],
  ['_Copy the generated API key_', '_Oluşturulan API anahtarını kopyalayın_'],
  ['*_How to set it:_*', '*_Nasıl ayarlanır:_*'],
  ['_Replace', '_Yerine'],
  ['with your actual API key._', 'gerçek API anahtarınızı yazın._'],
  ['_Chatbot will now respond in all groups_', '_Sohbet botu artık tüm gruplarda yanıt verecek_'],
  ['_Trigger:_', '_Tetikleyici:_'],
  ['_Mentions and replies only_', '_Sadece etiketler ve yanıtlar_'],
  ['to disable._', 'kullanarak kapatın._'],
  ['_Chatbot will now respond in all direct messages_', '_Sohbet botu artık tüm DM\'lerde yanıt verecek_'],
  ['_All messages_', '_Tüm mesajlar_'],
  ['"Group"', '"Grup"'],
  ['"DM"', '"DM"'],
  ['_Chat:_', '_Sohbet:_'],
  ['_Model:_', '_Model:_'],
  ['_Context:_', '_Bağlam:_'],
  ['_Fresh start_', '_Yeni başlangıç_'],
  ['_Now I\'ll respond to direct messages, mentions, and replies!_', '_Artık direkt mesajlara, etiketlere ve yanıtlara cevap vereceğim!_'],
  ['_Chatbot will no longer respond in groups globally_', '_Sohbet botu artık küresel olarak gruplarda yanıt vermeyecek_'],
  ['_Individual group settings are preserved_', '_Bireysel grup ayarları korunur_'],
  ['to re-enable._', 'tekrar etkinleştirin._'],
  ['_Chatbot will no longer respond in DMs globally_', '_Sohbet botu artık küresel olarak DM\'lerde yanıt vermeyecek_'],
  ['_Individual DM settings are preserved_', '_Bireysel DM ayarları korunur_'],
  ['_Chatbot is now disabled in this chat._', '_Sohbet botu bu sohbette kapatıldı._'],
  ['_Conversation context has been cleared._', '_Konuşma bağlamı temizlendi._'],
  ['*_Example:_*', '*_Örnek:_*'],
  ['_New Prompt:_', '_Yeni Komut:_'],
  ['_This will apply to all new conversations._', '_Bu tüm yeni konuşmalara uygulanacak._'],
  ['_Conversation histories have been reset for all', '_Konuşma geçmişleri tüm '],
  ['groups', 'gruplar'],
  ['_Next messages will start fresh conversations._', '_Sonraki mesajlar yeni konuşmalar başlatacak._'],
  ['_Conversation history has been reset._', '_Konuşma geçmişi sıfırlandı._'],
  ['_Next message will start a fresh conversation._', '_Sonraki mesaj yeni bir konuşma başlatacak._'],
  ['*_🤖 Chatbot Status_*', '*_🤖 Sohbet Botu Durumu_*'],
  ['_Status:_', '_Durum:_'],
  ['_Enabled via:_', '_Şununla etkin:_'],
  ['Individual setting', 'Bireysel ayar'],
  ['Global groups setting', 'Küresel grup ayarı'],
  ['Global DMs setting', 'Küresel DM ayarı'],
  ['_Model Fallback Level:_', '_Model Yedek Seviyesi:_'],
  ['*_Available Models:_*', '*_Kullanılabilir Modeller:_*'],
  ['← Current', '← Mevcut'],
  ['_Use', '_Kullanmak için'],
  ['to see available commands._', 'mevcut komutları görmek için._'],
  ['What do you see in this image?', 'Bu görselde ne görüyorsun?'],
  ['Analyze these images for me.', 'Bu görselleri benim için analiz et.'],
  ['_❌ GEMINI_API_KEY not configured. Please set it using', '_❌ GEMINI_API_KEY yapılandırılmadı. Ayarlamak için şunu kullanın:'],
  ['_❌ Received unexpected response from AI. Please try again._', '_❌ YZ\'den beklenmeyen bir yanıt alındı. Lütfen tekrar deneyin._'],
  ['_⚠️ Rate limit reached. Switched to backup model. Please try again._', '_⚠️ Oran sınırına ulaşıldı. Yedek modele geçildi. Lütfen tekrar deneyin._'],
  ['_❌ All models have reached their rate limits. Please try again later._', '_❌ Tüm modeller hız sınırına ulaştı. Lütfen daha sonra tekrar deneyin._'],
  ['"Unknown error"', '"Bilinmeyen hata"'],
  ['_❌ Network error. Please check your connection and try again._', '_❌ Ağ hatası. Bağlantınızı kontrol edip tekrar deneyin._'],
  ['Received empty response from AI.', 'YZ\'den boş bir yanıt alındı.'],

  // ========== warn.js ==========
  ['No reason provided', 'Sebep belirtilmedi'],
  ['- User:', '- Kullanıcı:'],
  ['- Reason:', '- Sebep:'],
  ['- Warnings:', '- Uyarılar:'],
  ['(LIMIT EXCEEDED)', '(SINIR AŞILDI)'],
  ['- Action:', '- İşlem:'],
  ['Removed from group', 'Gruptan çıkarıldı'],
  ['_User has been kicked for exceeding the warning limit._', '_Kullanıcı uyarı sınırını aştığı için atıldı._'],
  ['- Error:', '- Hata:'],
  ['Failed to kick user', 'Kullanıcı atılamadı'],
  ['_Please manually remove the user or check my admin permissions._', '_Lütfen kullanıcıyı elle çıkarın veya yönetici izinlerimi kontrol edin._'],
  ['- Remaining:', '- Kalan:'],
  ['_Next warning will result in a kick!_', '_Sonraki uyarı atılmayla sonuçlanacak!_'],
  ['more warnings before kick._', 'uyarı daha kaldı._'],
  ['- Status:', '- Durum:'],
  ['Clean record', 'Temiz sicil'],
  ['- Total Warnings:', '- Toplam Uyarılar:'],
  ['Warning History', 'Uyarı Geçmişi'],
  ['_By:', '_Uyaran:'],
  ['_Date:', '_Tarih:'],
  ['... and', '... ve'],
  ['more warnings', 'daha fazla uyarı'],
  ['_User has exceeded the warning limit!_', '_Kullanıcı uyarı sınırını aştı!_'],
  ['No warnings to remove', 'Kaldırılacak uyarı yok'],
  ['- Removed:', '- Kaldırıldı:'],
  ['1 warning', '1 uyarı'],
  ['warning(s)', 'uyarı'],
  ['Still has warnings', 'Hâlâ uyarıları var'],
  ['No warnings to reset', 'Sıfırlanacak uyarı yok'],
  ['- No users have warnings in this group.', '- Bu grupta hiçbir kullanıcının uyarısı yok.'],
  ['_Everyone is following the rules!_', '_Herkes kurallara uyuyor!_'],
  ['Group Warning List', 'Grup Uyarı Listesi'],
  ['- Warning Limit:', '- Uyarı Sınırı:'],
  ['LIMIT EXCEEDED', 'SINIR AŞILDI'],
  ['FINAL WARNING', 'SON UYARI'],
  ['remaining', 'kalan'],
  ['_Latest:', '_Son:'],
  ['_Total warned users:', '_Toplam uyarılan kullanıcı:'],
  ['for detailed history_', 'için detaylı geçmişi görebilirsiniz_'],
  ['- Please provide a number between 1 and 20.', '- Lütfen 1 ile 20 arasında bir sayı girin.'],
  ['- Current limit:', '- Mevcut sınır:'],
  ['*Usage:*', '*Kullanım:*'],
  ['- New limit:', '- Yeni sınır:'],
  ['warnings', 'uyarı'],
  ['- Previous limit:', '- Önceki sınır:'],
  ['_Users will now be kicked after', '_Kullanıcılar artık'],
  ['warnings._', 'uyarı sonrasında atılacak._'],
  ['Group Warning Statistics', 'Grup Uyarı İstatistikleri'],
  ['- Total Warned Users:', '- Toplam Uyarılan Kullanıcı:'],
  ['- Total Warnings Issued:', '- Verilen Toplam Uyarı:'],
  ['*User Status:*', '*Kullanıcı Durumu:*'],
  ['At Limit:', 'Sınırda:'],
  ['Near Limit:', 'Sınıra Yakın:'],
  ['Safe:', 'Güvende:'],
  ['to see detailed list_', 'detaylı listeyi görmek için_'],
  ['- Check warnings', '- Uyarıları kontrol et'],
  ['- Remove one warning', '- Bir uyarıyı kaldır'],
  ['- Remove all warnings', '- Tüm uyarıları kaldır'],
  ['- List all warned users', '- Tüm uyarılanları listele'],

  // ========== media.js ==========
  ['Give me videos', 'Bana videolar verin'],
  ['.find reply to a music', '.find bir müziğe yanıt verin'],

  // ========== manage.js ==========
  ['settings configuration menu', 'ayarlar yapılandırma menüsü'],
  ['Sending unauthorized link', 'İzinsiz bağlantı gönderme'],
  ['_Usage:_', '_Kullanım:_'],
  ['Links not allowed!', 'Bağlantılara izin verilmiyor!'],

  // ========== youtube.js ==========
  ['YouTube Search Results', 'YouTube Arama Sonuçları'],
  ['to download audio', 'ses indirmek için'],
  ['see video details', 'video detaylarını görüntüle'],
  ['Select Video Quality', 'Video Kalitesini Seçin'],

  // ========== social.js usage ==========
  ['insta link(s) or reply to link(s)', 'insta bağlantı(lar)ı veya bağlantıyı yanıtlayın'],
  ['fb link or reply to a link', 'fb bağlantısı veya bağlantıyı yanıtlayın'],
  ['ig username', 'ig kullanıcı adı'],
  ['.story username or link', '.story kullanıcı adı veya bağlantı'],
  ['.pinterest query or link', '.pinterest arama veya bağlantı'],
  ['.tiktok reply or link', '.tiktok yanıtla veya bağlantı'],

  // ========== group.js usage ==========
  ['.clear (clears the current chat)', '.clear (mevcut sohbeti temizler)'],
  ['.add 919876543210', '.add 905554443322'],
  ['.promote @mention or reply', '.promote @etiket veya yanıtla'],
  ['.requests approve all or reject all', '.requests approve all veya reject all'],

  // ========== commands.js help text ==========
  ['_Show help menu_', '_Yardım menüsünü göster_'],
  ['_Enable/disable in current chat_', '_Bu sohbette aç/kapat_'],
  ['_Enable/disable in all groups_', '_Tüm gruplarda aç/kapat_'],
  ['_Enable/disable in all DMs_', '_Tüm DM\'lerde aç/kapat_'],
  ['_Set system prompt_', '_Sistem komutunu ayarla_'],
  ['_Clear conversation context_', '_AI geçmişini temizle_'],
  ['_Reply to images for AI image analysis_', '_Görsellere yanıtla YZ resim analizi_'],

  // ========== afk.js ==========
  ['_Reason:_', '_Sebep:_'],
  ['_AFK for:_', '_AFK süresi:_'],
  ['_Last seen:_', '_Son görülme:_'],
  ['_Messages received:_', '_Alınan mesajlar:_'],
  ['_New reason:_', '_Yeni sebep:_'],
  ['_I\'ll auto-reply when someone messages or mentions you._', '_Biri size mesaj attığında veya sizi etiketlediğinde otomatik yanıt vereceğim._'],
  ['_Since:_', '_Bu zamandan beri:_'],
  ['I am currently away from keyboard', 'Şu anda klavyeden uzaktayım'],

  // ========== generic/shared ==========
  ['_sends to original chat_', '_orijinal sohbete gönderir_'],
  ['_sends to first sudo_', '_ilk yöneticiye gönderir_'],
  ['_sends to custom JID_', '_belirtilen JID\'e gönderir_'],
  ['_disables anti-delete_', '_mesaj silme engelini kapatır_'],
];

function getFiles(dir, filesList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory() && !['node_modules', 'lang'].includes(file)) {
      getFiles(filePath, filesList);
    } else if (filePath.endsWith('.js')) {
      filesList.push(filePath);
    }
  }
  return filesList;
}

// Include both plugins and config.js
const allFiles = [
  ...getFiles(path.join(__dirname, 'plugins')),
  path.join(__dirname, 'config.js')
];
let changedFiles = 0;

allFiles.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  for (const [eng, tur] of replacements) {
    content = content.split(eng).join(tur);
  }

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    changedFiles++;
    console.log(`Updated: ${file}`);
  }
});

console.log(`\nDone. Modified ${changedFiles} files.`);

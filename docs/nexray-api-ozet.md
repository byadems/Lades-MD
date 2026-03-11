# Nexray API (api.nexray.web.id) – Bot İçin Özet

## Mevcut Kullanım
- **ytplay** – Şarkı komutunda yedek indirme (`plugins/youtube.js`)
- **ytmp4** – ytv komutunda yedek video indirme (`plugins/youtube.js`)
- **spotify** – Spotify komutunda yedek indirme (`plugins/youtube.js`, `plugins/autodl.js`)
- **instagram** – insta komutunda ve autodl'de yedek (`plugins/social.js`, `plugins/autodl.js`)
- **tiktok** – tiktok komutunda ve autodl'de yedek (`plugins/social.js`, `plugins/autodl.js`)
- **facebook** – fb komutunda ve autodl'de yedek (`plugins/social.js`, `plugins/autodl.js`)
- **pinterest** – pinterest komutunda ve autodl'de yedek (`plugins/social.js`, `plugins/autodl.js`)
- **twitter** – twitter komutu ve autodl (`plugins/social.js`, `plugins/autodl.js`)
- **colorize** – renklendir komutu (`plugins/media.js`)
- **gptimage** – yzdüzenle komutu: Görsel + metin talimatı ile GPT Vision düzenleme (`plugins/media.js`)
- **deepimg** – aigörsel komutu: Metinden görsel oluşturma (`plugins/media.js`)

---

## Bot İçin Yararlı Kategoriler ve Endpoint'ler

### 1. Downloader (İndirici) – Yüksek Öncelik
| Endpoint | Açıklama | Bot Uyumu |
|----------|----------|-----------|
| `/downloader/ytplay` | YouTube ses (mevcut) | ✅ Kullanılıyor |
| `/downloader/ytplayvid` | YouTube video | video komutu yedek |
| `/downloader/ytmp3` | YouTube MP3 | şarkı yedek alternatifi |
| `/downloader/ytmp4` | YouTube MP4 | video yedek alternatifi |
| `/downloader/instagram` | Instagram indirme | insta komutu yedek |
| `/downloader/tiktok` | TikTok indirme | autodl TikTok yedek |
| `/downloader/facebook` | Facebook video | autodl FB yedek |
| `/downloader/spotify` | Spotify indirme | spotify komutu yedek |
| `/downloader/pinterest` | Pinterest indirme | pinterest yedek |
| `/downloader/twitter` | Twitter/X video | twitter indirme |
| `/downloader/threads` | Threads indirme | yeni özellik |
| `/downloader/soundcloud` | SoundCloud | yeni özellik |
| `/downloader/capcut` | CapCut şablon | yeni özellik |

### 2. AI – Sohbet / Metin
| Endpoint | Açıklama | Bot Uyumu |
|----------|----------|-----------|
| `/ai/chatgpt` | ChatGPT | chatbot alternatifi |
| `/ai/gemini` | Gemini | chatbot alternatifi |
| `/ai/claude` | Claude | chatbot alternatifi |
| `/ai/deepseek` | DeepSeek | chatbot alternatifi |
| `/ai/grammarcheck` | Dilbilgisi kontrolü | yeni komut |
| `/ai/gemini-tts` | Metin okuma (TTS) | TTS alternatifi |

### 3. Search (Arama)
| Endpoint | Açıklama | Bot Uyumu |
|----------|----------|-----------|
| `/search/bingimage` | Bing görsel arama | gis alternatifi |
| `/search/github` | GitHub arama | yeni komut |
| `/search/applemusic` | Apple Music arama | yeni komut |

### 4. Tools (Araçlar)
| Endpoint | Açıklama | Bot Uyumu |
|----------|----------|-----------|
| `/tools/cekresi` | Kargo takip (Endonezya) | sınırlı kullanım |
| `/tools/codeconvert` | Kod dönüştürücü | yeni komut |
| `/tools/converter` | Dosya dönüştürücü | converters alternatifi |
| `/tools/colorize` | Siyah-beyaz fotoğrafı renklendirme | media alternatifi |
| `/tools/bypass/cf-turnstile` | Cloudflare bypass | teknik kullanım |

### 5. Maker / Textpro – Görsel Üretimi
| Endpoint | Açıklama | Bot Uyumu |
|----------|----------|-----------|
| `/maker/attp` | ATTP (animasyonlu metin) | fancy/attp alternatifi |
| `/maker/balogo` | Logo oluşturma | yeni komut |
| `/maker/codesnap` | Kod ekran görüntüsü | yeni komut |

### 6. Information
| Endpoint | Açıklama | Bot Uyumu |
|----------|----------|-----------|
| Çeşitli bilgi API'leri | Genel bilgi sorguları | duruma göre |

### 7. Stalker – Sosyal Profil Bilgisi
| Endpoint | Açıklama | Bot Uyumu |
|----------|----------|-----------|
| Instagram/TikTok stalk | Profil bilgisi | igStalk alternatifi |

---

## Önerilen Entegrasyonlar

### Öncelik 1 – Yedek indirme
- **Instagram** – `downloadGram` başarısız olursa Nexray `/downloader/instagram` kullan
- **TikTok** – Mevcut TikTok indirme başarısız olursa Nexray `/downloader/tiktok` kullan
- **Spotify** – `spotifyTrack` + YouTube zinciri başarısız olursa Nexray `/downloader/spotify` kullan
- **YouTube video** – `downloadVideo` başarısız olursa Nexray `/downloader/ytmp4` veya `ytplayvid` kullan

### Öncelik 2 – Yeni özellikler
- **Grammar check** – `.düzelt <metin>` – Dilbilgisi kontrolü
- **Colorize** – Siyah-beyaz fotoğrafı renklendirme
- **Code snap** – Kod bloğundan görsel oluşturma

### Öncelik 3 – Chatbot
- Mevcut API maliyetliyse Nexray AI endpoint'leri alternatif olarak kullanılabilir (API key gerekebilir)

---

## API Kullanım Notları
- Base URL: `https://api.nexray.web.id`
- Örnek: `GET https://api.nexray.web.id/downloader/ytplay?q=şarkı+adı`
- Her endpoint için parametreler farklı olabilir; dokümantasyondan kontrol edin
- Rate limit ve API key gereksinimleri dokümantasyonda belirtilir

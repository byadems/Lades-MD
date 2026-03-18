# Lades-MD Kapsamlı Stabilite Analiz Raporu

**Tarih:** Haziran 2025  
**Kapsam:** Tüm core modüller, plugin'ler, utility ve DB katmanı

---

## 1. KRİTİK BUGLAR (Crash / Data Loss Riski)

### 1.1 `manage.js:250` — `variables` tanımsız (ReferenceError)

**Dosya:** `plugins/manage.js` satır 250  
**Sorun:** `değişkenler` komutu `variables.find(...)` çağırıyor ama `variables` hiçbir yerde tanımlanmamış. Bu komut her çağrıldığında `ReferenceError` fırlatır.

```js
// Satır 250 — BUG
if (!variables.find((v) => v.key === key)) {
```

**Düzeltme:** Ya `BotVariable.findAll()` ile DB'den çekilmeli, ya da bu filtre tamamen kaldırılmalı.

**Önem:** 🔴 Kritik — komut kullanılamaz durumda.

---

### 1.2 `group.js:92` — Hâlâ `var` ile destructuring (scope leak)

**Dosya:** `plugins/group.js` satır 92  
**Sorun:** `ban` komutunda `var { participants, subject }` kullanılıyor. `var` üst scope'a sızar; iç içe async callback'lerde beklenmeyen davranış yaratabilir.

```js
var { participants, subject } = await message.client.groupMetadata(message.jid);
```

**Düzeltme:** `const` olarak değiştirilmeli.

**Önem:** 🟡 Orta — potansiyel race condition.

---

### 1.3 `manage.js:1463` — Hardcoded grup JID'e mesaj gönderme

**Dosya:** `plugins/manage.js` satır 1463  
**Sorun:** Auto-delete link tespitinde `120363258254647790@g.us` adresine bildirim gönderiliyor. Bu JID bot sahibine ait bir grupmuş gibi görünüyor ama:
- Bot bu grupta değilse hata fırlatır
- Her kullanıcı için bu gruba mesaj gider (gizlilik sorunu)

```js
await message.client.sendMessage("120363258254647790@g.us", { text: infoMessage });
```

**Düzeltme:** Bu JID env variable (`ADMIN_GROUP_JID`) olarak yapılandırılmalı veya tamamen kaldırılmalı.

**Önem:** 🔴 Kritik — gizlilik ve hata riski.

---

### 1.4 `earthquake.js:32` — Sınırsız retry (10 deneme, 50sn+ blok)

**Dosya:** `plugins/earthquake.js` satır 32  
**Sorun:** `getEarthquakeData` 10 kez retry yapıyor, her biri 5sn bekliyor. API down ise toplam 50+ saniye bloke olur.

```js
if (retryCount < 10) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  return getEarthquakeData(timeout, retryCount + 1);
}
```

**Düzeltme:** Retry sayısı 3'e indirilmeli, exponential backoff eklenmeli.

**Önem:** 🟡 Orta — komut yanıt süresini uzatır.

---

## 2. STABİLİTE SORUNLARI

### 2.1 `manage.js` — `var` kullanımı yaygın (22+ instance)

Dosya genelinde hâlâ 22 adet `var` kullanımı mevcut. Özellikle:
- Satır 619, 633, 634, 661, 675, 676, 703, 715, 716, 739, 751, 752, 774, 786, 787, 1071, 1076, 1110, 1114, 1407, 1678

Bunların çoğu `var db = await ...get()`, `var status = ...`, `var { subject } = ...` kalıplarında. Hepsi `const` veya `let` olmalı.

**Önem:** 🟡 Orta — scope leak riski.

---

### 2.2 `group.js` — 38 adet `var` kullanımı

`group.js` dosyası `var` konusunda en kötü durumda. Özellikle:
- `var { participants, subject }` pattern'ı birçok komutta tekrarlanıyor
- `var users`, `var init`, `var initt`, `var user` gibi değişkenler

**Önem:** 🟡 Orta.

---

### 2.3 `converters.js` — 24 adet `var` kullanımı

**Önem:** 🟡 Orta.

---

### 2.4 `media.js` — 18 adet `var` kullanımı

**Önem:** 🟡 Orta.

---

### 2.5 `warn.js:14` — Handler prefix hesaplaması standardize edilmemiş

```js
const handler = HANDLERS !== "false" ? HANDLERS.split("")[0] : "";
```

Bu, `config.HANDLER_PREFIX` yerine eski yöntemle hesaplanıyor. `warn.js`, `filter.js`, `updater.js` dosyalarında da aynı pattern var.

**Etkilenen dosyalar:**
- `plugins/warn.js:14`
- `plugins/filter.js:5`
- `plugins/updater.js:10`

**Düzeltme:** `config.HANDLER_PREFIX` kullanılmalı.

**Önem:** 🟢 Düşük — işlevsel sorun yok ama tutarsızlık.

---

### 2.6 `commands.js:15` — `isPrivateMode` statik hesaplanıyor

```js
const isPrivateMode = MODE === "private";
```

Bu değer modül yüklendiğinde bir kez hesaplanıyor. Runtime'da `.mod public` ile mod değiştirildiğinde bu değer güncellenmez. `config.isPrivate` getter kullanılmalı.

**Önem:** 🟡 Orta — mod değişikliği restart gerektirir.

---

### 2.7 `earthquake.js:9` — Dosya tabanlı state (`lastEarthquake.txt`)

```js
const LAST_EARTHQUAKE_FILE_PATH = path.join(__dirname, "lastEarthquake.txt");
```

Plugin dizinine yazma yapıyor. Containerized ortamlarda (read-only filesystem) hata verebilir. `TEMP_DIR` veya DB kullanılmalı.

**Önem:** 🟢 Düşük.

---

## 3. HATA YÖNETİMİ EKSİKLİKLERİ

### 3.1 Sessiz catch blokları

Birçok yerde `catch (_) {}` veya `catch {}` boş bırakılmış. Bunlar debug'ı zorlaştırır:

| Dosya | Satır | Bağlam |
|-------|-------|--------|
| `helpers.js` | 117 | `pingHostname` — fetch hatası yutulur |
| `helpers.js` | 204 | temp cleanup — dosya silme hatası |
| `helpers.js` | 206 | temp cleanup — dizin okuma hatası |
| `sse-guard.js` | 37 | URL parse hatası |
| `sse-guard.js` | 110, 213 | dispatch/close hataları |
| `manage.js` | 1440, 1488 | `groupInviteCode` hatası |

**Düzeltme:** En azından `logger.trace` veya yorum eklenmeli.

**Önem:** 🟢 Düşük — debug zorlaştırıcı.

---

### 3.2 `chatbot.js` — API key yoksa console.warn ama devam

```js
if (!apiKey) {
  console.warn("⚠️ GEMINI_API_KEY yok, model listesi alınamadı.");
  return;
}
```

Bu doğru yaklaşım ama `logger` yerine `console.warn` kullanılıyor. Tüm dosyada `console.log/warn/error` kullanımı var, `logger` tercih edilmeli.

**Önem:** 🟢 Düşük.

---

### 3.3 `manage.js:1682` — `eval()` kullanımı

```js
let return_val = await eval(`(async () => { ${message.message.replace(">", "")} })()`);
```

Bu bir owner-only eval komutu. `fromMe: !0` ile korunuyor ama:
- Sadece ilk `>` karakteri replace ediliyor, mesajda birden fazla `>` olabilir
- Hata mesajları tüm stack trace'i döndürüyor

**Önem:** 🟡 Orta — güvenlik açısından dikkatli olunmalı.

---

## 4. MİMARİ / TASARIM SORUNLARI

### 4.1 `message-stats.js:49` — Duplicate `sendBanAudio` fonksiyonu

`sendBanAudio` hem `group.js:30` hem `message-stats.js:49`'da tanımlanmış. İki versiyon farklı:
- `group.js`: Yerel dosyadan okur (`utils/sounds/Ban.mp3`)
- `message-stats.js`: URL'den indirir (`dl.sndup.net/bq7y/Ban.mp3`)

**Düzeltme:** Tek bir utility fonksiyonu olarak birleştirilmeli.

**Önem:** 🟡 Orta — bakım yükü.

---

### 4.2 `afk.js:5` — `getVar` import edilip kullanılmıyor

```js
const { setVar, getVar, delVar } = require("./manage");
```

`manage.js` exports'ta `getVar` yok — sadece `setVar` ve `delVar` export ediliyor. Bu import sessizce `undefined` olur.

**Düzeltme:** Import'tan `getVar` kaldırılmalı.

**Önem:** 🟢 Düşük — şu an kullanılmıyor.

---

### 4.3 `converters.js:58` — Statik MODE değişkeni

```js
let MODE = config.MODE, STICKER_DATA = config.STICKER_DATA;
```

Runtime'da mod değişikliği yansımaz.

**Önem:** 🟢 Düşük.

---

### 4.4 `db-cache.js` — `chatCache` ve `userCache` düz `Map` (LRU değil)

`antiDeleteCache` LRU kullanıyor ama `chatCache` ve `userCache` düz `Map`. `pruneMap` ile periyodik temizleme yapılıyor ama bu en eski girişleri değil, Map insertion order'daki ilk girişleri siler — LRU semantiği sağlamıyor.

**Düzeltme:** `chatCache` ve `userCache` de `LRUCache` instance'ı olmalı.

**Önem:** 🟡 Orta — bellek verimliliği.

---

### 4.5 `db-resilience.js` — Session write coalescing veri kaybı riski

```js
if (now - _lastSessionWriteQueuedAt < SESSION_WRITE_COALESCE_MS) {
  return Promise.resolve([[], 0]);
}
```

2 saniye içinde gelen session yazmaları atılıyor. Eğer ilk yazma da queue'da başarısız olursa, ikinci yazma zaten atılmış olduğundan veri kaybı olabilir.

**Önem:** 🟡 Orta — edge case.

---

## 5. PERFORMANS

### 5.1 `manage.js` text handler — Her mesajda antiword + antilink kontrolü

`on: "text"` handler'ı her gelen mesajda:
1. `getCachedAntiwordJids()` — cache TTL 60sn
2. `getCachedAntilinkConfig()` — cache TTL 60sn
3. `linkDetector.detectLinks()` — regex işlemi

Bu, bot yoğunluğuna göre performans darboğazı yaratabilir. Cache TTL'ler yeterli görünüyor ama `linkDetector` her mesajda çalışıyor.

**Önem:** 🟢 Düşük — cache mevcut.

---

### 5.2 `group.js` ban komutu — Sıralı kick, rate limit yok

`ban herkes` komutu tüm üyeleri 1sn arayla sırayla atıyor. Büyük gruplarda (>500 üye) 8+ dakika sürebilir ve WhatsApp rate limiting'e takılabilir.

**Önem:** 🟢 Düşük — kasıtlı tasarım.

---

## 6. GENEL KOD KALİTESİ

### 6.1 `console.log/warn/error` vs `logger` tutarsızlığı

Birçok plugin `console.log/warn/error` kullanırken core modüller `logger` (pino) kullanıyor. Tutarlılık için tüm plugin'ler `logger` kullanmalı.

**Etkilenen dosyalar:** `chatbot.js`, `group.js`, `earthquake.js`, `message-stats.js`, `afk.js`, `converters.js`

---

### 6.2 `process.exit()` kullanımı

6 farklı yerde `process.exit()` çağrılıyor:
- `restart.js:12` — kasıtlı (PM2 restart)
- `group.js:12` — Baileys yüklenemezse (modül yükleme sırasında)
- `group-updates.js:170, 209` — zamanlı mute/unmute sonrası
- `external-plugin.js:196` — plugin güncelleme sonrası
- `updater.js:155, 206` — güncelleme sonrası

`group.js:12`'deki `process.exit(1)` en riskli olanı — Baileys import hatası tüm botu öldürür. Graceful degradation tercih edilmeli.

---

## 7. ÖNCELİKLENDİRİLMİŞ AKSİYON LİSTESİ

| # | Öncelik | Aksiyon | Dosya |
|---|---------|---------|-------|
| 1 | 🔴 Kritik | `variables` ReferenceError düzelt | `manage.js:250` |
| 2 | 🔴 Kritik | Hardcoded grup JID'i env var yap | `manage.js:1463` |
| 3 | 🟡 Orta | Kalan `var` → `const/let` dönüşümü | `manage.js`, `group.js`, `converters.js`, `media.js` |
| 4 | 🟡 Orta | Handler prefix standardizasyonu | `warn.js`, `filter.js`, `updater.js` |
| 5 | 🟡 Orta | `isPrivateMode` → `config.isPrivate` | `commands.js:15` |
| 6 | 🟡 Orta | `sendBanAudio` duplicate kaldır | `group.js`, `message-stats.js` |
| 7 | 🟡 Orta | `chatCache`/`userCache` → LRU | `db-cache.js` |
| 8 | 🟢 Düşük | Sessiz catch bloklarına trace log ekle | Çeşitli |
| 9 | 🟢 Düşük | `console.log` → `logger` standardizasyonu | Plugin'ler |
| 10 | 🟢 Düşük | Earthquake retry azalt (10→3) | `earthquake.js` |

---

## ÖZET

- **2 Kritik Bug** tespit edildi (ReferenceError + hardcoded JID)
- **8 Orta Seviye** stabilite/tasarım sorunu
- **5+ Düşük Seviye** iyileştirme fırsatı
- Core modüller (`db-resilience.js`, `db-cache.js`, `auth-health.js`, `sse-guard.js`) **genel olarak sağlam** — iyi yapılandırılmış, timeout/backoff/cache mekanizmaları mevcut
- Plugin katmanı daha fazla dikkat gerektiriyor — özellikle `manage.js` ve `group.js`

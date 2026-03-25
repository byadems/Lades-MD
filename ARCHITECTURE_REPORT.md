# 🏗️ Lades-MD Sistem Mimarisi ve Güvenilirlik Raporu

Bu rapor, sistemin %99.9 uptime hedefiyle kesintisiz çalışması amacıyla yapılan teknik iyileştirmeleri, alınan kararları ve geleceğe yönelik stratejileri içerir.

## 1. Hata Yönetimi ve Güvenilirlik

### Kök Neden Analizi ve Sorunlar
- **Sorun:** Bot asenkron işlemler sırasında (örn. API çağrıları veya dosya indirme) hata fırlattığında `unhandledRejection` ve `uncaughtException` süreçleri ele alınmıyor, process'in dengesiz bir state'e geçmesine sebep oluyordu.
- **Risk Seviyesi:** High Impact, High Probability.
- **Çözüm:** `index.js` içerisinde global `uncaughtException` ve `unhandledRejection` listener'ları eklendi. Yapılandırılmış loglama (Pino) üzerinden yakalanan hatalar `fatal` seviyesinde loglandı. Node.js process'i PM2 üzerinden otomatik yeniden başlatılabilecek şekilde `guardedExit` mekanizması korundu.

### Memory Leak Tespiti ve Çözümler
- Mevcut durumda `v8` `--expose-gc` kullanılarak bellek sızıntıları kontrol altında tutuluyor.
- `HEAP_WARN_THRESHOLD_MB` aşıldığında Baileys store (eski mesajlar) temizleniyor ve `global.gc()` manuel tetiklenerek bellek optimize ediliyor.

## 2. Kaynak Yönetimi ve Performans

### Circuit Breaker ve Exponential Backoff
- Dış servislere (Nexray API vb.) yapılan istekler, zaman zaman ağ hataları veya rate limit (Usage Limit exceeded) sebepleriyle başarısız oluyordu.
- **Uygulanan Çözüm:** `plugins/utils/circuit-breaker.js` oluşturuldu. `withRetry` (Exponential backoff ve jitter destekli) ve `CircuitBreaker` pattern'leri yazıldı.
- `nexray.js` ve `ai-tts.js` içerisindeki API çağrılarına implemente edildi. Bu sayede API çökmelerinde bekleme süresi ortadan kalkıp fail-fast davranışı sağlandı.

### Veritabanı ve Connection Pool
- `core/db-resilience.js` ve `config.js` üzerinden `PG_POOL_MAX` ve `PG_POOL_MIN` değerleriyle pool size'ları hali hazırda optimize edilmiştir.
- SQLite için `PRAGMA journal_mode=WAL` etkin, Postgres için de savepoint rollback'leri kontrol altına alınmıştır.

## 3. Monitoring ve Alerting

### Health Check ve Metrik Endpointleri
- `/health` ve `/metrics` HTTP endpoint'leri `index.js` içerisine eklendi.
- **KPI'lar:**
  - Memory kullanımı (Heap, RSS)
  - Process uptime
  - Aktif WhatsApp session sayısı
  - Event loop gecikme metrikleri (`eventLoopLag`)
- Bu metrikler JSON formatında sunulmaktadır. Prometheus veya UptimeKuma gibi araçlarla kolayca izlenebilir.

## 4. Deployment ve Zero-Downtime

### PM2 Graceful Reload
- PM2'nin uygulamayı yeniden başlatırken sıfır kesinti (zero-downtime) sağlaması için `ecosystem.config.js` güncellendi.
- `wait_ready: true` parametresi eklendi ve `index.js` içerisinde başlatma işlemleri tamamlandıktan sonra `process.send("ready")` komutu gönderilerek trafik kaybı önlendi.

## 5. Test Senaryoları (Chaos & Stress)
Sistemin dayanıklılığını test etmek için önerilen adımlar:
1. **Network Chaos Testi:** `api.nexray.web.id`'yi `hosts` dosyası üzerinden localhost'a yönlendirerek Circuit Breaker'ın "OPEN" state'ine geçtiği doğrulanmalı.
2. **Stress Testi:** `/metrics` endpoint'ine saniyede 1000 istek atılarak Event Loop p99 metriklerinin limitin üzerine (3000ms+) çıkıp çıkmadığı ve watchdog'un nasıl tepki verdiği gözlenmeli.

---
**Not:** Obfuscate edilmiş çekirdek (core) dosyalara, mimarinin stabil çalışması için dokunulmamış, çevresel plugin ve yardımcı servislerde (utils) modern SOLID / Design Pattern uygulamaları tatbik edilmiştir.

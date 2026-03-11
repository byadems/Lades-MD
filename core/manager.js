const { WhatsAppBot } = require("./bot");
const { logger, SESSION } = require('../config');
const { sequelize } = require("./database");
const { CustomAuthState } = require("./auth");
const { flushQueueOnShutdown, stopFlushTimer } = require("./store");

class BotManager {
    constructor() {
        this.bots = new Map(); 
    }

    async initializeBots() {
        logger.info({ sessions: SESSION }, `Tüm yapılandırılmış botlar başlatılıyor.`);
        await CustomAuthState.deleteGarbageSessions(SESSION);        
        for (const sessionId of SESSION) {
            try {
                logger.info({ session: sessionId }, `Oturum için bot başlatılıyor.`);
                const bot = new WhatsAppBot(sessionId);
                await bot.initialize(); 
                if (bot.sock) { 
                    this.bots.set(sessionId, bot);
                    logger.info({ session: sessionId }, `Bot başlatma planlandı. Bağlantı durumu takip edilecek.`);
                } else {
                    logger.error({ session: sessionId }, `Oturum için bot nesnesi başlatılamadı (sock null).`);
                }
            } catch (error) {

                logger.error({ session: sessionId, err: error }, `BotManager'da bot başlatma başarısız`);
            }
        }
    }

    getBot(sessionId) {
        return this.bots.get(sessionId);
    }

    async sendMessage(sessionId, jid, message) {
        const bot = this.getBot(sessionId);
        if (!bot) {
            throw new Error(`Oturum için bot bulunamadı veya başlatılamadı: ${sessionId}`);
        }
        return await bot.sendMessage(jid, message);
    }

    async shutdown() {
        logger.info('Tüm botlar kapatılıyor...');

    try {
      stopFlushTimer();
      await flushQueueOnShutdown();
    } catch (err) {
      logger.error({ err }, "Kapatma sırasında mesaj kuyruğu boşaltılamadı");
    }

    try {
      logger.info("Kapatmadan önce tüm oturum verileri kaydediliyor...");
      await CustomAuthState.saveAllSessions();
      logger.info("Tüm oturum verileri başarıyla kaydedildi");
    } catch (error) {
      logger.error({ err: error }, "Kapatma sırasında oturumlar kaydedilemedi");
    }

        for (const [sessionId, bot] of this.bots.entries()) {
            try {
                await bot.disconnect(false); 
                logger.info({ session: sessionId }, `Bot başarıyla bağlantıyı kesti.`);
            } catch (error) {
                logger.error({ session: sessionId, err: error }, `Bot bağlantısı kesilirken hata.`);
            }
        }
        this.bots.clear(); 

        try {
            CustomAuthState.stopPeriodicSave();
            logger.info('Kimlik doğrulama periyodik kayıt zamanlayıcısı durduruldu');
        } catch (error) {
            logger.error({ err: error }, 'Periyodik kayıt zamanlayıcısı durdurulamadı');
        }

        try {
            const Schedule = require('./schedulers');
            await Schedule.cleanup();
            logger.info('Zamanlanmış görevler temizlendi');
        } catch (error) {
            logger.error({ err: error }, 'Zamanlanmış görevler temizlenirken hata');
        }

        if (sequelize) {
            try {
                await sequelize.close();
                logger.info('Veritabanı bağlantısı kapatıldı.');
            } catch (error) {
                logger.error({ err: error }, 'Veritabanı bağlantısı kapatılamadı.');
            }
        }
    }
}

module.exports = { BotManager };

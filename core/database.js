const { DataTypes } = require('sequelize');
const { logger, sequelize } = require('../config');
const { withRetry, DatabaseError } = require('../plugins/utils/resilience');

const WhatsappSession = sequelize.define('WhatsappSession', {
    sessionId: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    sessionData: {
        type: DataTypes.TEXT,
        allowNull: true,
        get() {
            const rawValue = this.getDataValue('sessionData');
            try {
                return rawValue ? JSON.parse(rawValue) : null;
            } catch (e) {
                logger.error({ session: this.getDataValue('sessionId'), err: e }, `Oturum verisi veritabanından ayrıştırılamadı`);
                return null;
            }
        },
        set(value) {
            try {
                this.setDataValue('sessionData', value ? JSON.stringify(value) : null);
            } catch (e) {
                logger.error({ session: this.getDataValue('sessionId') || (value && value.sessionIdFromPayload), err: e }, `Oturum verisi veritabanı için dizgeleştirilemedi`);
                this.setDataValue('sessionData', null);
            }
        }
    }
});

const BotVariable = sequelize.define('BotVariable', {
    key: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
        unique: true,
        comment: 'Bot değişkeninin adı (örn. HANDLERS, BOT_NAME)'
    },
    value: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Bot değişkeninin değeri'
    },

}, {
    tableName: 'bot_variables',
    timestamps: true
});

async function initializeDatabase() {
    const init = async () => {
        try {
            await sequelize.authenticate();
            logger.info('Veritabanı bağlantısı kuruldu.');
            await WhatsappSession.sync();
            logger.info('WhatsappSession tablosu eşlendi.');
            await BotVariable.sync();
            logger.info('BotVariable tablosu eşlendi.');
        } catch (error) {
            throw new DatabaseError(`Veritabanı başlatılamadı: ${error.message}`, { original: error });
        }
    };

    try {
        await withRetry(init, {
            maxRetries: 5,
            baseDelay: 2000,
            onRetry: (err, attempt, delay) => {
                logger.warn(`Veritabanı bağlantısı tekrar deneniyor (Deneme: ${attempt}, Bekleme: ${delay}ms): ${err.message}`);
            }
        });
    } catch (error) {
        logger.error('Veritabanı başlatma hatası (Tüm denemeler başarısız):', error);
        throw error;
    }
}

async function migrateSudoToLID(client) {
    const config = require('../config');
    
    if (config.SUDO && config.SUDO.trim() && !config.SUDO_MAP) {
        try {
            const phoneNumbers = config.SUDO.split(',').map(n => n.trim()).filter(n => n);
            const lids = [];
            
            logger.info(`${phoneNumbers.length} SUDO telefon numarası LID’lere taşınıyor...`);
            
            for (const phone of phoneNumbers) {
                try {
                    const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
                    const lid = await client.signalRepository.lidMapping.getLIDForPN(jid);
                    
                    if (lid) {
                        lids.push(lid);
                        logger.info(`Taşındı: ${phone} -> ${lid}`);
                    } else {
                        logger.warn(`${phone} için LID alınamadı, atlanıyor`);
                    }
                } catch (e) {
                    logger.error(`${phone} taşınırken hata:`, e.message);
                }
            }
            
            if (lids.length > 0) {
                await BotVariable.upsert({
                    key: 'SUDO_MAP',
                    value: JSON.stringify(lids)
                });

                config.SUDO_MAP = JSON.stringify(lids);
                logger.info(`${lids.length} SUDO kaydı SUDO_MAP'e taşındı`);
            }
        } catch (error) {
            logger.error('SUDO taşıma hatası:', error);
        }
    }
}

module.exports = {
    sequelize,
    WhatsappSession,
    BotVariable,
    initializeDatabase,
    migrateSudoToLID
};
# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Lades-MD is a WhatsApp bot built on Node.js (CommonJS) using the Baileys library. Plugin system under `plugins/`, core modules under `core/`, Sequelize ORM for database (SQLite locally, PostgreSQL in cloud).

### Running the bot

- Start: `npm start` (wraps `pm2 start ecosystem.config.js --attach`)
- Or directly: `node index.js`
- PM2 management: `pm2 status`, `pm2 logs lades-md`, `pm2 restart lades-md`, `pm2 stop lades-md`
- Health check: `curl http://localhost:3000/health` → returns `OK`

### Required environment variables

- `SESSION` — WhatsApp session string (e.g. `LDS~abc123`). Generate at lades.site
- `DATABASE_URL` — PostgreSQL connection URL (if unset, defaults to local SQLite `./bot.db`)
- `SUDO` — Admin phone number(s)
- `GEMINI_API_KEY` — Required for chatbot/ai/yz commands (get from aistudio.google.com)
- `GROQ_API_KEY` — Required for voice transcription (dinle command)

### Key gotchas

- Some core files (`core/auth.js`, `core/bot.js`, `core/handler.js`, `core/store.js`, `core/schedulers.js`) are obfuscated and must not be modified.
- `DIS_PM` defaults to `true` in config.js — set `DIS_PM=false` env var to allow DM commands.
- The `punycode` deprecation warning is cosmetic noise from a transitive dependency.
- `GEMINI_API_KEY` warning in stderr is non-critical; only affects chatbot plugin.
- No lint, test, or formatting tooling configured in this project.
- PM2 is required globally (`npm install -g pm2`).
- System dependency `webp` (cwebp/dwebp) is needed for sticker functionality.
- Runtime-generated plugin files (e.g. `temel.js`, `sosyal.js`, `yapayzeka.js`) are created by the bot during initialization — they are not tracked in git and should not be committed.
- `SUPPRESS_DECRYPTION_LOGS` (default: true) — "No session found to decrypt" / "transaction failed, rolling back" gibi Baileys loglarını trace seviyesine indirir. `SUPPRESS_DECRYPTION_LOGS=false` ile tam log alınır.

### WhatsApp session troubleshooting

- SESSION tokens can become invalid quickly. If bot logs `SESSION LOGGED OUT` or `PreKeyError: Invalid PreKey ID`, generate a fresh token.
- Always clear **all** linked devices in WhatsApp settings before generating a new session.
- High `device:N` numbers (>10) indicate many sessions have been created; clear linked devices to reset.
- Bot can send startup messages but fail to receive commands — this is a pre-key synchronization issue requiring a fresh session.

### Performance tuning (Northflank 0.2 vCPU / 512MB RAM / Supabase 5GB/month)

All parameters are overridable via environment variables:

| Parameter | Value | Env var override |
|---|---|---|
| Node heap limit | 384MB | `NODE_OPTIONS=--max-old-space-size=N` |
| PM2 memory restart | 350MB | Edit `ecosystem.config.js` |
| PG connection pool | max 3, min 1 | `PG_POOL_MAX`, `PG_POOL_MIN` |
| DB write buffer flush | 30 min | `PG_BUFFER_FLUSH_MS` |
| DB write buffer max | 300 items | `PG_BUFFER_MAX` |
| In-memory cache limit | 2000 entries | `MAX_CACHE_SIZE` |
| AntiDelete cache | 200 entries (memory-only) | `ANTIDELETE_MAX` |
| UserStats flush | 15 min | `STATS_FLUSH_INTERVAL` |

The `db-cache.js` layer caches Chat/User/UserStats in-memory and AntiDeleteCache never hits the DB, reducing Supabase egress by ~95%.

### API dependencies

- **Nexray** (`api.nexray.web.id`): Instagram (v1+v2 fallback), TikTok, Twitter, Pinterest, Spotify, YouTube, Colorize, DeepImg. No API key needed.
- **Ezan/Sahur/Iftar**: 3-tier fallback — eMushaf → İmsakiyem → AlAdhan.
- **OpenWeatherMap**, **ExchangeRate API**: Hardcoded keys in code.
- **Gemini API**: Requires `GEMINI_API_KEY` for chatbot/ai commands.
- **Groq/OpenAI**: Requires `GROQ_API_KEY` for voice transcription.

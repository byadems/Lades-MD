const parseMb = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const profileName = (process.env.MEMORY_PROFILE || "stability").toLowerCase();

const memoryProfiles = {
  stability: {
    heapLimitMb: parseMb(process.env.HEAP_LIMIT_MB, 320),
    pm2RestartLimitMb: parseMb(process.env.PM2_RESTART_LIMIT_MB, 380),
  },
  performance: {
    heapLimitMb: parseMb(process.env.HEAP_LIMIT_MB, 384),
    pm2RestartLimitMb: parseMb(process.env.PM2_RESTART_LIMIT_MB, 480),
  },
};

const selectedProfile = memoryProfiles[profileName] || memoryProfiles.stability;
const heapLimitMb = selectedProfile.heapLimitMb;
const pm2RestartLimitMb = Math.max(selectedProfile.pm2RestartLimitMb, heapLimitMb + 40);

module.exports = {
  apps: [
    {
      name: "lades-md",
      script: "index.js",
      node_args: `--max-old-space-size=${heapLimitMb} --expose-gc`,
      max_memory_restart: `${pm2RestartLimitMb}M`,
      restart_delay: 5000,
      max_restarts: 15,
      min_uptime: "30s",
      kill_timeout: 10000,
      env: {
        MEMORY_PROFILE: profileName,
        HEAP_LIMIT_MB: String(heapLimitMb),
        PM2_RESTART_LIMIT_MB: String(pm2RestartLimitMb),
        NODE_OPTIONS: `--max-old-space-size=${heapLimitMb}`,
      },
    },
  ],
};

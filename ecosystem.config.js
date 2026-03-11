module.exports = {
  apps: [
    {
      name: "lades-md",
      script: "index.js",
      node_args: "--max-old-space-size=512 --expose-gc",
      max_memory_restart: "450M",
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: "30s",
      kill_timeout: 10000,
      env: {
        NODE_OPTIONS: "--max-old-space-size=512",
      },
    },
  ],
};

module.exports = {
  apps: [
    {
      name: "lades-md",
      script: "index.js",
      node_args: "--max-old-space-size=384 --expose-gc",
      max_memory_restart: "350M",
      restart_delay: 5000,
      max_restarts: 15,
      min_uptime: "30s",
      kill_timeout: 10000,
      env: {
        NODE_OPTIONS: "--max-old-space-size=384",
      },
    },
  ],
};

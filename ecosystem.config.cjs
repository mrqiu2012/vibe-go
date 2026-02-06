/**
 * PM2 进程守护配置
 * 使用: pnpm build && pm2 start ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: "vibego-server",
      cwd: "./apps/server",
      script: "dist/index.js",
      interpreter: "node",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {},
      env_production: { NODE_ENV: "production" },
      error_file: "../../logs/vibego-server-error.log",
      out_file: "../../logs/vibego-server-out.log",
      time: true,
      merge_logs: true,
    },
  ],
};

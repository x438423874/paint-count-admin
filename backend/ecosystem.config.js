module.exports = {
  apps: [
    {
      name: 'soybean-admin-nest-backend',
      script: './dist/apps/base-system/src/main.js',
      autorestart: true,
      // 单实例：定时任务（孤儿文件清理/车辆对账）与 winston 日志轮转均不支持多进程并发，
      // cluster 模式会导致任务重复执行与日志丢失。需要扩容时须先给定时任务加 Redis 分布式锁。
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      args: '',
      env: {
        NODE_ENV: 'production',
        // 应用读取的是 APP_PORT（libs/config/src/app.config.ts），此前误写为 PORT 未生效
        APP_PORT: '9528',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/app-err.log',
      out_file: 'logs/app-out.log',
      merge_logs: true,
    },
  ],
};

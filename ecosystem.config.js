module.exports = {
  apps: [
    {
      name: 'heysprech-api',
      script: './src/server.ts',
      interpreter: 'bun',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        SMTP_HOST: process.env.SMTP_HOST,
        EMAIL_FROM: process.env.EMAIL_FROM,
        SUBSCRIPTION_ACTION_URL: process.env.SUBSCRIPTION_ACTION_URL,
        REDIS_HOST: process.env.REDIS_HOST || 'localhost',
        REDIS_PORT: process.env.REDIS_PORT || 6379
      },
      max_memory_restart: '1G',
      exp_backoff_restart_delay: 100,
      time: true,
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true
    }
  ]
}

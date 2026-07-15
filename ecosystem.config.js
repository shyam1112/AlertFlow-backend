module.exports = {
  apps: [
    {
      name: 'alertflow-backend',
      script: 'index.js',

      // Single instance — scale up to 'max' for multi-core if needed
      instances: 1,
      exec_mode: 'fork',

      // Restart the process if it crashes; don't watch files in production
      autorestart: true,
      watch: false,

      // Restart if memory exceeds 1 GB
      max_memory_restart: '1G',

      // Restart delay on crash (ms)
      restart_delay: 3000,

      // Absolute log paths so they work regardless of where PM2 is invoked from
      out_file: __dirname + '/logs/pm2-out.log',
      error_file: __dirname + '/logs/pm2-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Environment variables for each mode.
      // Secrets (DB_URL, EMAIL_PASS, JWT_SECRET, etc.) are NOT here —
      // they are loaded from .env on the server by index.js (via dotenv).
      // Run with: pm2 start ecosystem.config.js --env production
      env_production: {
        NODE_ENV: 'production',
        PORT: 3021,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3021,
      },
    },
  ],
};

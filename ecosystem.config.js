module.exports = {
  apps: [
    {
      name: 'alertflow-backend',
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env_production: {
        NODE_ENV: 'production',
        // All other env vars (PORT, HOST, DB_URL, etc.) must be set
        // in the server environment or in a .env file loaded separately.
        // DO NOT hard-code secrets here — this file is committed to git.
      },
      env_development: {
        NODE_ENV: 'development',
      },
    },
  ],
};

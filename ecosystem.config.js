module.exports = {
  apps: [{
    name: 'teacher-docs',
    script: 'server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    // Logging
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Advanced settings
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=1024',
    
    // Monitoring
    monitoring: false,
    
    // Auto restart
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s',
    
    // Graceful shutdown
    kill_timeout: 5000,
    
    // Environment variables
    env_file: '.env'
  }],

  deploy: {
    production: {
      user: 'deploy',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:username/teacher-document-system.git',
      path: '/var/www/teacher-docs',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && npm run init-db && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};
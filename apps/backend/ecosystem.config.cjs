// PM2 do backend piloto do G-Monitor. Le .env manualmente (app nao usa dotenv,
// espera env vars ja no processo — padrao 12-factor).
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const env = {};
  const content = fs.readFileSync(file, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

module.exports = {
  apps: [
    {
      name: 'gmonitor-backend-pilot',
      script: './dist/index.js',
      cwd: __dirname,
      env: loadEnv(path.join(__dirname, '.env')),
      autorestart: true,
      max_restarts: 10,
    },
  ],
};

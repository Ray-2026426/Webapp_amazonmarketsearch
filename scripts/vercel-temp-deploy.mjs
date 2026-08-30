import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readDotEnvLocal() {
  const file = join(process.cwd(), '.env.local');
  const env = {};
  const text = readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    env[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return env;
}

const localEnv = readDotEnvLocal();
const required = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_CLOUD_EMAIL', 'SUPABASE_CLOUD_PASSWORD'];
for (const key of required) {
  if (!localEnv[key]) {
    console.error(`Missing ${key} in .env.local`);
    process.exit(1);
  }
}

const args = [
  'vercel',
  'deploy',
  '--temporary',
  '--yes',
  '--archive',
  'tgz',
  '--env',
  `SUPABASE_URL=${localEnv.SUPABASE_URL}`,
  '--env',
  `SUPABASE_PUBLISHABLE_KEY=${localEnv.SUPABASE_PUBLISHABLE_KEY}`,
  '--env',
  `SUPABASE_CLOUD_EMAIL=${localEnv.SUPABASE_CLOUD_EMAIL}`,
  '--env',
  `SUPABASE_CLOUD_PASSWORD=${localEnv.SUPABASE_CLOUD_PASSWORD}`,
];

const child = spawn('npx', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    npm_config_cache: join(process.cwd(), '.npm-cache'),
    XDG_DATA_HOME: join(process.cwd(), '.vercel-local', 'data'),
    XDG_CONFIG_HOME: join(process.cwd(), '.vercel-local', 'config'),
    XDG_CACHE_HOME: join(process.cwd(), '.vercel-local', 'cache'),
    VERCEL_TELEMETRY_DISABLED: '1',
  },
});

child.on('exit', (code) => process.exit(code ?? 1));

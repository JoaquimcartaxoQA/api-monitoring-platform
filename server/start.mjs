import { resolve } from 'node:path';
import { isAbsolute } from 'node:path';
import pg from 'pg';
import { createMonitor } from './monitor.mjs';
import { createAudit } from './audit.mjs';

const env = process.env;
const dev = env.MONITOR_LOCAL_HTTP === '1';
const origins = (env.MONITOR_ORIGINS ?? '').split(',').filter(Boolean);
if (!env.DATABASE_URL || !env.MONITOR_LOG_ROOT || !origins.length ||
    (!dev && (!isAbsolute(env.MONITOR_LOG_ROOT) || origins.some(origin => !origin.startsWith('https://')))) ||
    origins.some(origin => {
      const parsed = new URL(origin);
      return parsed.origin !== origin || (dev && !['127.0.0.1','localhost'].includes(parsed.hostname));
    })) throw new Error('Revise a configuração de banco, logs e origens conforme o README.');

const operations = JSON.parse(env.MONITOR_OPERATIONS ?? '{}');
if (!operations || Array.isArray(operations) || typeof operations !== 'object' ||
    Object.values(operations).some(route => typeof route !== 'string' ||
      !/^\/[A-Za-z0-9_/{}/.-]{0,119}$/.test(route))) throw new Error('Catálogo de operações inválido.');

const pool = new pg.Pool({connectionString:env.DATABASE_URL, connectionTimeoutMillis:5000, statement_timeout:5000});
pool.on('error', () => console.error('Conexão de auditoria indisponível.'));
try {
  const audit = await createAudit(pool);
  const server = createMonitor({
    root:resolve(env.MONITOR_LOG_ROOT), operations, origins,
    user:env.MONITOR_USER, passwordHash:env.MONITOR_PASSWORD_HASH, audit:audit.record, secure:!dev
  });
  const timer = setInterval(() => audit.prune().catch(() => console.error('Expurgo de auditoria falhou.')), 3_600_000);
  const port = Number(env.MONITOR_PORT ?? 8787);
  server.listen(port,'127.0.0.1', () => console.log('Backend disponível em 127.0.0.1:' + port));
  function stop() {
    clearInterval(timer);
    server.close(() => void pool.end());
  }
  process.once('SIGINT',stop);
  process.once('SIGTERM',stop);
} catch {
  await pool.end();
  console.error('Não foi possível iniciar o monitor. Verifique o banco e a configuração.');
  process.exitCode = 1;
}

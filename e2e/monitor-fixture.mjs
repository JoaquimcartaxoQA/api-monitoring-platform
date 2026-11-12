import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMonitor, hashPassword } from '../server/monitor.mjs';

const root = await mkdtemp(join(tmpdir(), 'monitor-playwright-'));
const timestamp = new Date().toISOString();
await writeFile(join(root, timestamp.slice(0, 10) + '.jsonl'),
  JSON.stringify({ timestamp, operation: 'demo.health', method: 'GET', status: 200 }) + '\n');
const server = createMonitor({
  root, user: 'qa', passwordHash: await hashPassword('qa-monitor-e2e'),
  operations: { 'demo.health': '/health' }, origins: ['http://127.0.0.1:15175'],
  secure: false, audit: async () => {},
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    server.close();
    server.closeAllConnections();
    await rm(root, { recursive: true, force: true });
  });
}
server.listen(8787, '127.0.0.1');

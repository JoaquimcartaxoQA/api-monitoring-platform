import { open, readdir, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { constants } from 'node:fs';

export const isRequestId = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const dayMs = 86_400_000;
const methods = new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
const byteLimit = 16 * 1024 * 1024;
const eventLimit = 50_000;

function project(record, day, operations) {
  if (!record || typeof record.timestamp !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.timestamp) ||
    !record.timestamp.startsWith(day) || !Number.isFinite(Date.parse(record.timestamp)) ||
    !methods.has(record.method) || !Number.isInteger(record.status) ||
    record.status < 100 || record.status > 599) return null;
  const durationMs = Number.isInteger(record.durationMs) && record.durationMs >= 0 && record.durationMs <= 600_000
    ? record.durationMs : null;
  const operation = Object.hasOwn(operations, record.operation) ? record.operation : null;
  const log = {
    timestamp: record.timestamp,
    operation: operation ?? 'uncatalogued',
    method: record.method,
    status: record.status,
    ...(isRequestId(record.requestId) ? {requestId:record.requestId.toLowerCase()} : {}),
    ...(durationMs !== null ? {durationMs} : {})
  };
  return {
    timestamp: record.timestamp,
    method: record.method,
    status: record.status,
    endpoint: operation ? operations[operation] : '(rota não catalogada)',
    requestId: isRequestId(record.requestId) ? record.requestId.toLowerCase() : null,
    durationMs,
    log
  };
}

export async function readLogs(root, operations, now = Date.now()) {
  const directory = await realpath(root);
  const days = new Set(Array.from({length:7}, (_, i) => new Date(now - i * dayMs).toISOString().slice(0,10)));
  const files = await readdir(directory, {withFileTypes:true});
  const items = [];
  let completionOrder = 0;
  let remaining = byteLimit;
  let malformed = 0;
  for (const entry of files) {
    const day = entry.name.slice(0,10);
    if (!days.has(day) || entry.name !== day + '.jsonl' || !entry.isFile()) continue;
    const path = join(directory, entry.name);
    try {
      const resolved = await realpath(path);
      if (resolved !== path || dirname(resolved) !== directory) continue;
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > remaining) throw new Error('log_limit');
        remaining -= info.size;
        const data = Buffer.alloc(info.size);
        let offset = 0;
        while (offset < data.length) {
          const {bytesRead} = await handle.read(data, offset, data.length - offset, offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        const lines = data.subarray(0, offset).toString('utf8').split('\n');
        lines.pop(); // O produtor pode estar escrevendo a última linha.
        for (const line of lines) {
          if (!line.trim()) continue;
          let row = null;
          try { row = project(JSON.parse(line), day, operations); } catch { /* registro inválido */ }
          if (row) items.push({...row, completionOrder:completionOrder++});
          else malformed++;
          if (items.length > eventLimit) throw new Error('event_limit');
        }
      } finally { await handle.close(); }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  items.sort((a,b) => b.timestamp.localeCompare(a.timestamp) || b.completionOrder - a.completionOrder);
  return {items:items.map(({completionOrder,...item}) => item), malformed};
}

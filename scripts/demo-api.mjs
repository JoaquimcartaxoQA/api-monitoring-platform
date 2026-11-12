import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

if (process.env.MONITOR_LOCAL_HTTP !== '1' || !process.env.MONITOR_DEMO_LOG_ROOT) {
  throw new Error('Configure MONITOR_LOCAL_HTTP=1 e MONITOR_DEMO_LOG_ROOT para a demonstração local.');
}
const root = resolve(process.env.MONITOR_DEMO_LOG_ROOT);
await mkdir(root,{recursive:true});

createServer(async (req,res) => {
  res.setHeader('Content-Type','application/json');
  if (req.method !== 'GET' || req.url !== '/health') {
    res.writeHead(404).end(JSON.stringify({error:'not_found'}));
    return;
  }
  const requestId = randomUUID();
  const timestamp = new Date().toISOString();
  const file = join(root,timestamp.slice(0,10) + '.jsonl');
  try {
    await appendFile(file, JSON.stringify({timestamp,requestId,operation:'demo.health',method:'GET',status:200}) + '\n');
    res.setHeader('X-Request-Id',requestId);
    res.end(JSON.stringify({status:'ok',requestId}));
  } catch { res.writeHead(503).end(JSON.stringify({error:'log_unavailable'})); }
}).listen(8790,'127.0.0.1',() => console.log('API sintética disponível em 127.0.0.1:8790'));

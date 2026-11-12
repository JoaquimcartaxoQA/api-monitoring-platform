import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { createAudit } from '../server/audit.mjs';

test('PostgreSQL persiste auditoria e expurga eventos com mais de 90 dias', {
  skip: !process.env.MONITOR_TEST_DATABASE_URL
}, async t => {
  const pool = new pg.Pool({connectionString:process.env.MONITOR_TEST_DATABASE_URL});
  t.after(() => pool.end());
  const audit = await createAudit(pool);
  const old = await pool.query("INSERT INTO audit_logs (event, occurred_at) VALUES ('login_failure', now() - interval '91 days') RETURNING id");
  const recent = await audit.record('login_success');
  assert.equal(recent.rowCount, 1);
  await audit.prune();
  assert.equal((await pool.query('SELECT id FROM audit_logs WHERE id = $1',[old.rows[0].id])).rowCount,0);
  assert.ok((await pool.query("SELECT id FROM audit_logs WHERE event='login_success'")).rowCount >= 1);
});

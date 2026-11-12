export async function createAudit(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      event text NOT NULL CHECK (event IN ('login_success','login_failure','logout')),
      occurred_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS audit_logs_occurred_at_idx ON audit_logs (occurred_at);
  `);
  const prune = () => pool.query("DELETE FROM audit_logs WHERE occurred_at < now() - interval '90 days'");
  await prune();
  return {
    prune,
    record: event => pool.query('INSERT INTO audit_logs (event) VALUES ($1)', [event])
  };
}

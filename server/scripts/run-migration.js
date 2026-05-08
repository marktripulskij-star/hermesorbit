// Apply a SQL migration file to the Supabase Postgres directly.
// Usage: node scripts/run-migration.js <path-to-migration.sql>
//        (or with no arg, runs the latest file in migrations/)
//
// Reads .env for SUPABASE_DB_* vars. Uses pg with SSL.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = path.join(__dirname, '..')

// Manually parse .env (same approach as index.js)
try {
  const envFile = fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (key && !process.env[key]) process.env[key] = val
  }
} catch (e) {
  console.error('Could not read .env:', e.message)
  process.exit(1)
}

// Pick the migration file
let migrationPath = process.argv[2]
if (!migrationPath) {
  const dir = path.join(SERVER_DIR, 'migrations')
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  if (!files.length) { console.error('No migration files found.'); process.exit(1) }
  migrationPath = path.join(dir, files[files.length - 1])
}
const migrationName = path.basename(migrationPath)
const sql = fs.readFileSync(migrationPath, 'utf8')

console.log(`▶ Migration: ${migrationName}`)
console.log(`  ${sql.length.toLocaleString()} chars · ${sql.split('\n').length} lines`)
console.log(`  Host: ${process.env.SUPABASE_DB_HOST}`)
console.log()

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT) || 5432,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false },
  statement_timeout: 60_000,
  connectionTimeoutMillis: 8000,
})
await client.connect()
console.log(`  ✓ Connected to ${process.env.SUPABASE_DB_HOST}`)

const start = Date.now()
try {
  console.log('  Running migration as single transaction…')

  await client.query('BEGIN')
  await client.query(sql)
  await client.query('COMMIT')

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`  ✓ Migration applied in ${elapsed}s`)
  console.log()

  // Verify schema
  console.log('▶ Verifying schema…')
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' ORDER BY table_name
  `)
  console.log(`  Tables (${tables.rowCount}):`)
  for (const r of tables.rows) console.log(`    - ${r.table_name}`)

  const policies = await client.query(`
    SELECT tablename, COUNT(*) as policy_count
    FROM pg_policies WHERE schemaname='public'
    GROUP BY tablename ORDER BY tablename
  `)
  console.log(`  RLS policies (${policies.rowCount} tables):`)
  for (const r of policies.rows) console.log(`    - ${r.tablename}: ${r.policy_count} policies`)

  const fns = await client.query(`
    SELECT routine_name FROM information_schema.routines
    WHERE routine_schema='public' AND routine_type='FUNCTION'
    ORDER BY routine_name
  `)
  console.log(`  Functions (${fns.rowCount}):`)
  for (const r of fns.rows) console.log(`    - ${r.routine_name}()`)

  console.log()
  console.log('✓ Migration complete.')
} catch (e) {
  console.error('  ✗ Migration FAILED:', e.message)
  try { await client.query('ROLLBACK') } catch {}
  process.exit(1)
} finally {
  await client.end()
}

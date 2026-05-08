// Create the two Supabase Storage buckets needed by the app + apply RLS.
// Idempotent — safe to re-run.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
for (const line of envFile.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eq = trimmed.indexOf('=')
  if (eq === -1) continue
  const key = trimmed.slice(0, eq).trim()
  const val = trimmed.slice(eq + 1).trim()
  if (key && !process.env[key]) process.env[key] = val
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const BUCKETS = [
  {
    name: 'brand-assets',
    public: false,
    fileSizeLimit: 25_000_000,                    // 25MB per file (PDFs, logos, product photos)
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf', 'text/plain', 'text/markdown'],
  },
  {
    name: 'generated-ads',
    public: true,
    fileSizeLimit: 15_000_000,                    // 15MB per generated image
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  },
]

console.log('▶ Setting up storage buckets…\n')

for (const cfg of BUCKETS) {
  // Check if bucket exists
  const { data: existing } = await supabase.storage.getBucket(cfg.name)
  if (existing) {
    // Update if exists (idempotent)
    const { error: upErr } = await supabase.storage.updateBucket(cfg.name, {
      public: cfg.public,
      fileSizeLimit: cfg.fileSizeLimit,
      allowedMimeTypes: cfg.allowedMimeTypes,
    })
    if (upErr) console.log(`  ⚠ updating ${cfg.name}: ${upErr.message}`)
    else console.log(`  ↺ ${cfg.name} (${cfg.public ? 'public' : 'private'}) — updated`)
  } else {
    const { error } = await supabase.storage.createBucket(cfg.name, {
      public: cfg.public,
      fileSizeLimit: cfg.fileSizeLimit,
      allowedMimeTypes: cfg.allowedMimeTypes,
    })
    if (error) {
      console.log(`  ✗ ${cfg.name}: ${error.message}`)
    } else {
      console.log(`  ✓ ${cfg.name} (${cfg.public ? 'public' : 'private'}) — created`)
    }
  }
}

// Apply RLS policies for storage.objects via direct SQL.
// Each user can only read/write objects in their own project's folder.
// Folder convention: <bucket>/<user_id>/<project_id>/<filename>
console.log('\n▶ Applying storage RLS policies…')

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT) || 5432,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
})
await client.connect()

const policySql = `
-- Brand assets: private. User can only read/write objects whose first folder is their user_id.
DROP POLICY IF EXISTS "user reads own brand assets" ON storage.objects;
CREATE POLICY "user reads own brand assets" ON storage.objects FOR SELECT
  USING (bucket_id = 'brand-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "user writes own brand assets" ON storage.objects;
CREATE POLICY "user writes own brand assets" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'brand-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "user updates own brand assets" ON storage.objects;
CREATE POLICY "user updates own brand assets" ON storage.objects FOR UPDATE
  USING (bucket_id = 'brand-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "user deletes own brand assets" ON storage.objects;
CREATE POLICY "user deletes own brand assets" ON storage.objects FOR DELETE
  USING (bucket_id = 'brand-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Generated ads: public read; only authenticated users can write into their own folder.
DROP POLICY IF EXISTS "anyone reads generated ads" ON storage.objects;
CREATE POLICY "anyone reads generated ads" ON storage.objects FOR SELECT
  USING (bucket_id = 'generated-ads');

DROP POLICY IF EXISTS "user writes own generated ads" ON storage.objects;
CREATE POLICY "user writes own generated ads" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'generated-ads' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "user deletes own generated ads" ON storage.objects;
CREATE POLICY "user deletes own generated ads" ON storage.objects FOR DELETE
  USING (bucket_id = 'generated-ads' AND auth.uid()::text = (storage.foldername(name))[1]);
`
try {
  await client.query(policySql)
  console.log('  ✓ Storage RLS policies applied')
} catch (e) {
  console.error('  ✗', e.message)
}

// Verify
const { data: buckets } = await supabase.storage.listBuckets()
console.log('\n▶ Final state:')
for (const b of buckets) console.log(`  - ${b.name} (${b.public ? 'public' : 'private'})`)

await client.end()
console.log('\n✓ Storage setup complete.')

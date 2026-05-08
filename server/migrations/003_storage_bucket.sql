-- Ensure the `generated-ads` Storage bucket exists.
-- Idempotent — does nothing if the bucket is already there.
--
-- This bucket holds AI-generated ad PNGs uploaded by saveGeneratedPng.
-- Public so that browser <img src="..."> works without auth (URLs are
-- unguessable UUIDs, so this is acceptable).
--
-- Previously generated images lived on Railway's local filesystem and were
-- wiped on every redeploy — every saved imageUrl on prior ads turned into a
-- 404. Moving to Supabase Storage makes them durable.

INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-ads', 'generated-ads', true)
ON CONFLICT (id) DO NOTHING;

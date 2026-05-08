// Supabase clients for server-side use.
//   - supabaseAdmin: full-power, uses service_role key, bypasses RLS. Use for
//     server-side writes/reads where we've already verified the user.
//   - supabaseClient(token): user-scoped client built from a request's JWT.
//     Use only when we want RLS to enforce access (rare — most server work
//     should use admin since we verify auth at the middleware layer).
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY

if (!url || !serviceKey || !anonKey) {
  console.error('[supabase] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY in env')
}

// Admin client — bypasses RLS. Treat carefully.
export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Build a per-request client tied to a user's JWT (RLS-enforced).
export function supabaseAsUser(accessToken) {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

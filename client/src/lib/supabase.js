// Client-side Supabase singleton.
// Vite injects env vars prefixed with VITE_ (configured in .env file).
//
// Usage:
//   import { supabase } from './lib/supabase'
//   const { data, error } = await supabase.auth.signInWithPassword({ email, password })
//
// For API calls to our Express server, attach the access token:
//   const session = await supabase.auth.getSession()
//   fetch('/api/...', { headers: { Authorization: `Bearer ${session.data.session.access_token}` } })
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.error('[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in env')
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,    // for magic-link / email confirm flows
  },
})

// Convenience: get the current access token (or null).
export async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || null
}

// API base URL. In dev it's empty (Vite proxy forwards /api/* to localhost:3001).
// In a split prod deployment (client on Vercel, server on Railway) set
// VITE_API_URL=https://api.ultemir.com so fetch calls hit the right host.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

// Resolve a /api/... path to a full URL when API_BASE is set.
// Pass-through for non-relative URLs (e.g. saved generated-image URLs that
// already include the API host).
function resolveApiUrl(input) {
  if (typeof input !== 'string') return input
  if (!API_BASE) return input
  if (/^https?:\/\//i.test(input)) return input  // already absolute
  if (input.startsWith('/api/')) return API_BASE + input
  return input
}

// Convenience: authenticated fetch — automatically attaches the JWT.
// If the server returns 401, the JWT is stale (e.g. session was revoked
// server-side). Force a sign-out so AuthGate flips back to the login screen
// instead of leaving the UI in a half-broken state.
export async function authedFetch(url, opts = {}) {
  const token = await getAccessToken()
  const headers = { ...(opts.headers || {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(resolveApiUrl(url), { ...opts, headers })
  if (res.status === 401 && token) {
    console.warn('[authedFetch] 401 with token — signing out (stale session).')
    try { await supabase.auth.signOut() } catch {}
  }
  return res
}

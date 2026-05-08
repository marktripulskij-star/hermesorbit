// Express middleware to verify a Supabase JWT and attach the user to req.
//
// Usage:
//   app.post('/api/projects', requireAuth, async (req, res) => {
//     const userId = req.user.id
//     ...
//   })
//
// Frontend sends `Authorization: Bearer <access_token>` from the Supabase session.
import { supabaseAdmin } from './supabase.js'

// Verify a Supabase JWT by hitting the project's /auth/v1/user endpoint
// directly. We bypass @supabase/auth-js's getUser(jwt) because that wrapper
// turns every non-2xx response into "Auth session missing!" — which masks the
// real error (session_not_found, bad_jwt, expired). The direct fetch is also
// a hair faster and gives actionable messages in the log.
async function verifyJwt(token) {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_ANON_KEY,
    },
  })
  if (!r.ok) {
    let body = ''
    try { body = await r.text() } catch {}
    return { user: null, status: r.status, error: body }
  }
  return { user: await r.json(), status: 200, error: null }
}

export async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) return res.status(401).json({ error: 'Missing Authorization header' })

    const { user, status, error } = await verifyJwt(token)
    if (!user) {
      console.log(`[requireAuth] ${req.method} ${req.path} → ${status} ${(error || '').slice(0, 200)}`)
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    req.user = user
    req.accessToken = token
    next()
  } catch (e) {
    console.error('[requireAuth]', e.message)
    res.status(500).json({ error: 'Auth check failed' })
  }
}

// Optional auth — attaches req.user if a valid token is present, otherwise continues anonymously.
export async function optionalAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) return next()
    const { user } = await verifyJwt(token)
    if (user) {
      req.user = user
      req.accessToken = token
    }
    next()
  } catch (_) { next() }
}

// Helper: verify user owns a given project. Returns the project row or sends 403.
export async function requireProjectOwnership(req, res, projectId) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', req.user.id)
    .single()
  if (error || !data) {
    res.status(403).json({ error: 'Project not found or not yours' })
    return null
  }
  return data
}

// Project-scoped sessions: every authenticated session-bearing endpoint
// receives a sessionId that MUST equal a project.id owned by req.user.id.
// This wrapper does that check and 4xx's on failure. Returns true to
// continue, false to abort (response already sent).
//
//   const ok = await requireSessionOwnership(req, res, sessionId)
//   if (!ok) return
export async function requireSessionOwnership(req, res, sessionId) {
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId required' })
    return false
  }
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', req.user.id)
    .maybeSingle()
  if (error || !data) {
    res.status(403).json({ error: 'Session not found or not yours' })
    return false
  }
  return true
}

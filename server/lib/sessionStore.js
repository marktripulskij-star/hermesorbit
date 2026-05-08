// Persistent session store backed by Supabase (projects.session_state JSONB).
//
// Replaces the previous local-disk implementation (sessions.json), which got
// wiped on every Railway redeploy. The session shape is unchanged; this module
// just swaps the storage backend.
//
// The sessionId passed in is always equal to a project's UUID (enforced by
// requireSessionOwnership middleware), so we read/write `projects` rows
// directly.
//
// Save model: write-through. `saveSession` updates the in-memory cache AND
// awaits the Supabase write before resolving, so by the time an endpoint
// returns 200 to the client the data is durable. The previous version
// debounced the DB write by 400ms and returned instantly; that lost user
// data whenever the server cold-started inside the debounce window (Railway
// idle eviction, Vercel serverless lifecycle, OOM, redeploy). All callers
// here are discrete user actions (upload doc, generate brief, save ad copy)
// — none fire fast enough to need debouncing, so the simpler write-through
// path is strictly safer with no UX cost.
import { supabaseAdmin } from './supabase.js'

const cache = new Map() // projectId → session object

const EMPTY_SESSION = () => ({
  documents: [],
  concepts: [],
  chatHistory: [],
  brandColors: [],
  brandImages: [],
  brandName: '',
  brandBrief: null,
  angles: [],
  ads: {},
  websiteContent: null,
  manualOffers: [],
})

// Fill in any missing fields with defaults and normalize legacy data.
// Mirrors the defensive checks the old in-memory getSession did.
function normalize(s) {
  const out = { ...EMPTY_SESSION(), ...(s || {}) }
  if (!Array.isArray(out.documents)) out.documents = []
  if (!Array.isArray(out.concepts)) out.concepts = []
  if (!Array.isArray(out.chatHistory)) out.chatHistory = []
  if (!Array.isArray(out.brandColors)) out.brandColors = []
  if (!Array.isArray(out.brandImages)) out.brandImages = []
  if (typeof out.brandName !== 'string') out.brandName = ''
  if (out.brandBrief === undefined) out.brandBrief = null
  if (!Array.isArray(out.angles)) out.angles = []
  if (!out.ads || typeof out.ads !== 'object') out.ads = {}
  if (out.websiteContent === undefined) out.websiteContent = null
  if (!Array.isArray(out.manualOffers)) out.manualOffers = []
  // Normalize funnelStage on every load so legacy 'TOFU'/'MOFU'/'BOFU' work
  out.angles = out.angles.map((a, i) => ({
    ...a,
    id: typeof a.id === 'number' ? a.id : i + 1,
    funnelStage: String(a.funnelStage || 'tofu').toLowerCase().replace(/[^a-z]/g, '')
      .replace('topoffunnel', 'tofu').replace('middleoffunnel', 'mofu').replace('bottomoffunnel', 'bofu')
      || 'tofu',
  }))
  return out
}

// Fetch a session from Supabase (or cache). Returns a normalized session
// object. If the project row exists but session_state is null/empty, returns
// an empty session. If the project doesn't exist, returns an empty session
// too — callers should have already enforced ownership upstream.
export async function getSession(projectId) {
  if (cache.has(projectId)) return cache.get(projectId)

  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('session_state')
    .eq('id', projectId)
    .maybeSingle()

  if (error) {
    console.error('[sessionStore] load failed for', projectId, error.message)
    // Fall back to empty session rather than crashing the request
    const empty = normalize(null)
    cache.set(projectId, empty)
    return empty
  }

  const session = normalize(data?.session_state)
  cache.set(projectId, session)
  return session
}

// Write the session back to Supabase synchronously. Cache update is immediate
// AND the DB write is awaited before this resolves — by the time the caller's
// `await` returns, the data is durable. Throws on DB error so the endpoint
// surfaces a 500 instead of falsely returning 200 on a failed write.
export async function saveSession(projectId, session) {
  const { error } = await supabaseAdmin
    .from('projects')
    .update({ session_state: session })
    .eq('id', projectId)
  if (error) {
    console.error('[sessionStore] save failed for', projectId, error.message)
    throw new Error(`Session save failed: ${error.message}`)
  }
  cache.set(projectId, session)
}

// Back-compat alias — older code paths called this when they wanted a
// guaranteed durable write. `saveSession` is now durable by default, so this
// just delegates.
export const saveSessionNow = saveSession

// No-op kept for back-compat with the shutdown handler that used to flush
// the debounce queue. Now that saves are write-through there's nothing to
// flush, but removing the export would break any caller still importing it.
export async function flushAllPending() {}

// Drop the cache entry — call after deleting a project, or any time
// out-of-band writes might have happened.
export function invalidateSession(projectId) {
  cache.delete(projectId)
}

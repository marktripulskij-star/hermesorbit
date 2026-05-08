// Admin gating. Source of truth for "is this user an admin."
//
// Resolution order (any match grants admin):
//   1. ADMIN_EMAIL env var (single)
//   2. ADMIN_EMAILS env var (comma-separated list)
//
// Set at least one to access /admin and the /api/admin/* endpoints. With no
// env set, no user is an admin (returns 403). Case-insensitive.

function buildAdminSet() {
  const set = new Set()
  if (process.env.ADMIN_EMAIL) set.add(process.env.ADMIN_EMAIL.toLowerCase())
  if (process.env.ADMIN_EMAILS) {
    for (const e of process.env.ADMIN_EMAILS.split(',')) {
      const trimmed = e.trim().toLowerCase()
      if (trimmed) set.add(trimmed)
    }
  }
  return set
}

const ADMIN_EMAILS = buildAdminSet()

export function isAdminEmail(email) {
  if (!email) return false
  return ADMIN_EMAILS.has(String(email).toLowerCase())
}

// Use in an endpoint to short-circuit non-admin requests with 403.
// Returns true if the request may proceed, false if a 403 was sent.
//
//   if (!requireAdmin(req, res)) return
export function requireAdmin(req, res) {
  if (!isAdminEmail(req.user?.email)) {
    res.status(403).json({ error: 'Admin only' })
    return false
  }
  return true
}

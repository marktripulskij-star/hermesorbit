// Mirror of server/lib/credits.js — keep these in sync.
// Used by the UI to show credit costs next to buttons + dropdowns.

export const CREDIT_COSTS = {
  'brand-brief':         4,
  'brand-brief-adjust':  1,
  'website-scrape':      0,
  'angles':              4,
  'generate-ad-copy':    3,
  'generate-hooks':      1,
  'regenerate-prompt':   1,
  'ad-adjust':           1,
  'rip-ad':              5,
  'image-low':           1,
  'image-medium':        3,
  'image-high':          8,
}

export const TOPUP_PACKS = {
  topup_100:  { credits: 100,  priceUsd: 9,  label: '100 credits' },
  topup_500:  { credits: 500,  priceUsd: 39, label: '500 credits' },
  topup_1500: { credits: 1500, priceUsd: 99, label: '1500 credits' },
}

export const PLAN_LIMITS = {
  free:     { credits: 30,     projects: 1,   label: 'Free trial', priceUsd: 0 },
  solo:     { credits: 200,    projects: 1,   label: 'Solo',       priceUsd: 19 },
  operator: { credits: 600,    projects: 3,   label: 'Operator',   priceUsd: 49 },
  studio:   { credits: 2000,   projects: 15,  label: 'Studio',     priceUsd: 149 },
  scale:    { credits: 999999, projects: 999, label: 'Scale',      priceUsd: null },
  starter:  { credits: 200,    projects: 1,   label: 'Solo',       priceUsd: 19 },
  pro:      { credits: 600,    projects: 3,   label: 'Operator',   priceUsd: 49 },
}

export function getPlanLimits(planKey) {
  return PLAN_LIMITS[planKey] || PLAN_LIMITS.free
}

export function imageActionForQuality(quality) {
  if (quality === 'low') return 'image-low'
  if (quality === 'high') return 'image-high'
  return 'image-medium'
}

// "12 days" / "3 hours" / "now" formatting for credits_reset_at
export function fmtResetIn(resetAtIso) {
  if (!resetAtIso) return ''
  const ms = new Date(resetAtIso).getTime() - Date.now()
  if (ms <= 0) return 'now'
  const days = Math.floor(ms / 86400000)
  if (days >= 2) return `${days}d`
  if (days === 1) return '1d'
  const hours = Math.floor(ms / 3600000)
  if (hours >= 2) return `${hours}h`
  return '<1h'
}

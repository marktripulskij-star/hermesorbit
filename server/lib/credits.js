// Single source of truth for credit costs + plan limits.
// Every credit-costing endpoint reads CREDIT_COSTS by action key and
// passes the value to chargeCredits() before doing the work. Mirror this
// exact map on the client (`client/src/lib/credits.js`) so the UI shows
// matching numbers next to buttons.
//
// 1 credit ≈ $0.025 in real model COGS by design — see LAUNCH.md.

import { supabaseAdmin } from './supabase.js'

export const CREDIT_COSTS = {
  // Brief + research
  'brand-brief':         4,
  'brand-brief-adjust':  1,   // Haiku rewrite
  'website-scrape':      0,   // free
  'angles':              4,

  // Ad copy generation (Sonnet draft + Haiku critique + art-director)
  'generate-ad-copy':    3,
  'generate-hooks':      1,   // 10 Sonnet hooks
  'regenerate-prompt':   1,   // craftImagePrompt only
  'ad-adjust':           1,   // Haiku rewrite of an ad

  // Rip Concept: Sonnet+vision deep-analyze a source ad (image + copy) and
  // adapt the concept to the user's brand. Charged once per rip; the image
  // generation cost on top is the standard image-low/medium/high tier.
  'rip-ad':              5,   // analyze (vision) + adapt + critique + art-director

  // Image generation by quality (matches OPENAI_IMAGE_QUALITY tiers)
  'image-low':           1,
  'image-medium':        3,
  'image-high':          8,
}

// One-time top-up packs purchased outside a subscription. Credits are
// added to the user's balance immediately on Stripe webhook confirmation.
// Pricing is markup-favorable vs the monthly tiers: people pay slightly
// more per credit on top-ups so the monthly tiers stay attractive.
export const TOPUP_PACKS = {
  topup_100:  { credits: 100,  priceUsd: 9,  label: '100 credits',  cents: 900 },
  topup_500:  { credits: 500,  priceUsd: 39, label: '500 credits',  cents: 3900 },
  topup_1500: { credits: 1500, priceUsd: 99, label: '1500 credits', cents: 9900 },
}

// Plan → monthly credit budget + project limit.
// Names match the published landing page (Solo / Operator / Studio / Scale)
// plus the implicit Free trial that auto-creates on signup (handle_new_user
// trigger in 001_initial_schema.sql).
export const PLAN_LIMITS = {
  free:     { credits: 30,    projects: 1,            label: 'Free trial', priceUsd: 0 },
  solo:     { credits: 200,   projects: 1,            label: 'Solo',       priceUsd: 19 },
  operator: { credits: 600,   projects: 3,            label: 'Operator',   priceUsd: 49 },
  studio:   { credits: 2000,  projects: 15,           label: 'Studio',     priceUsd: 149 },
  scale:    { credits: 999999,projects: 999,          label: 'Scale',      priceUsd: null /* custom */ },
  // Legacy aliases that may exist on old profile rows — treat as free
  starter:  { credits: 200,   projects: 1,            label: 'Solo',       priceUsd: 19 },
  pro:      { credits: 600,   projects: 3,            label: 'Operator',   priceUsd: 49 },
}

export function getPlanLimits(planKey) {
  return PLAN_LIMITS[planKey] || PLAN_LIMITS.free
}

// Map an image quality string ('low' | 'medium' | 'high') to its action key.
export function imageActionForQuality(quality) {
  if (quality === 'low') return 'image-low'
  if (quality === 'high') return 'image-high'
  return 'image-medium'  // default
}

// Atomic credit deduction wrapper around the Postgres function deduct_credits.
// Throws on insufficient balance with a structured error that endpoints can
// catch and convert to 402 Payment Required.
//
//   await chargeCredits({ userId, action: 'angles', projectId, realCostUsd: 0.07 })
//
// Returns the new balance.
export async function chargeCredits({
  userId, action, projectId = null, realCostUsd = null, metadata = null, creditsOverride = null,
}) {
  const credits = creditsOverride != null ? creditsOverride : CREDIT_COSTS[action]
  if (credits == null) throw new Error(`Unknown credit action: ${action}`)
  if (credits === 0) return null  // free actions (e.g. website scrape)

  const { data, error } = await supabaseAdmin.rpc('deduct_credits', {
    p_user_id: userId,
    p_project_id: projectId,
    p_action: action,
    p_credits: credits,
    p_real_cost: realCostUsd,
    p_metadata: metadata,
  })

  if (error) {
    // Postgres custom errcodes from the migration:
    //   P0001 = profile not found
    //   P0002 = insufficient credits
    if (error.code === 'P0002') {
      const insuff = new Error(error.message)
      insuff.statusCode = 402
      insuff.code = 'INSUFFICIENT_CREDITS'
      insuff.required = credits
      throw insuff
    }
    throw error
  }
  return data  // new balance
}

// Wraps an endpoint handler with a credit-charging step BEFORE the work.
// On insufficient credits → 402 with { error, required, action }.
// Returns true to continue, false if a 4xx response was already sent.
//
// Side-effect: stores the charge details on `req.creditCharge` so the
// endpoint can call `refundLastCharge(req)` from a catch block to reverse
// the deduction if the work then fails.
export async function requireCredits(req, res, action, opts = {}) {
  const credits = opts.creditsOverride != null ? opts.creditsOverride : CREDIT_COSTS[action]
  try {
    const newBalance = await chargeCredits({
      userId: req.user.id,
      action,
      projectId: opts.projectId || null,
      realCostUsd: opts.realCostUsd || null,
      metadata: opts.metadata || null,
      creditsOverride: opts.creditsOverride,
    })
    req.creditBalance = newBalance
    req.creditCharge = {
      action,
      credits,
      projectId: opts.projectId || null,
      metadata: opts.metadata || null,
    }
    return true
  } catch (e) {
    if (e.statusCode === 402) {
      res.status(402).json({
        error: 'Insufficient credits',
        action,
        required: credits,
        message: e.message,
      })
      return false
    }
    console.error('[requireCredits]', e.message)
    res.status(500).json({ error: 'Credit check failed' })
    return false
  }
}

// Reverse a prior charge. Implemented by calling deduct_credits with a
// NEGATIVE amount — the same SQL function then increments the user's
// balance and writes a ledger row tagged "refund:<action>". Returns the new
// balance, or null if nothing was refunded. Never throws — refunds are
// best-effort cleanup; we don't want to mask the original error.
export async function refundCredits({ userId, action, projectId = null, metadata = null, credits }) {
  if (credits == null) {
    console.error(`[refundCredits] credits required`)
    return null
  }
  if (credits === 0) return null
  try {
    const { data, error } = await supabaseAdmin.rpc('deduct_credits', {
      p_user_id: userId,
      p_project_id: projectId,
      p_action: `refund:${action}`,
      p_credits: -credits,
      p_real_cost: null,
      p_metadata: metadata,
    })
    if (error) {
      console.error('[refundCredits] supabase error:', error.message)
      return null
    }
    console.log(`[refundCredits] +${credits} cr to ${userId} (action=${action})`)
    return data
  } catch (e) {
    console.error('[refundCredits] threw:', e.message)
    return null
  }
}

// Convenience: refund the charge captured on req by requireCredits.
// Idempotent — safe to call even if no charge was recorded, or if already
// refunded for this request (clears req.creditCharge after refunding).
export async function refundLastCharge(req) {
  const c = req?.creditCharge
  if (!c) return null
  req.creditCharge = null  // prevent double-refund within one request
  return refundCredits({
    userId: req.user.id,
    action: c.action,
    projectId: c.projectId,
    metadata: c.metadata,
    credits: c.credits,
  })
}

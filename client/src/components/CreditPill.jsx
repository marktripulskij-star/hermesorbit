// Header credit pill — replaces the legacy UsagePill (dollar tracker).
// Shows "214 cr · 12d" by default. Click → expanded popover with plan badge,
// reset date, recent ledger, top-up CTA.

import React, { useState, useEffect, useRef } from 'react'
import { useMe } from '../lib/MeContext.jsx'
import { authedFetch } from '../lib/supabase.js'
import { fmtResetIn } from '../lib/credits.js'

// Render an action key from the credit_ledger as a human-readable label.
// Server-side actions are stored as raw strings like "image-medium" or
// "topup:topup_100" — this maps them to display strings.
function fmtAction(action) {
  if (!action) return '—'
  if (action.startsWith('topup:')) {
    const key = action.slice('topup:'.length)
    const m = key.match(/(\d+)/)
    return m ? `Top-up · ${m[1]} cr` : 'Top-up'
  }
  if (action.startsWith('renewal:')) {
    return 'Plan renewal'
  }
  const map = {
    'brand-brief':         'Brand brief',
    'brand-brief-adjust':  'Brief adjust',
    'angles':              'Discover angles',
    'generate-ad-copy':    'Ad copy',
    'generate-hooks':      'Hook candidates',
    'regenerate-prompt':   'Regen image prompt',
    'ad-adjust':           'Ad adjust',
    'image-low':           'Image · low',
    'image-medium':        'Image · medium',
    'image-high':          'Image · high',
  }
  return map[action] || action
}

export default function CreditPill() {
  const { me, loading, refresh, setOutOfCreditsModal } = useMe()
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState(null)
  const ref = useRef(null)

  // Outside click closes
  useEffect(() => {
    if (!open) return
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // Lazy-load credit history when popover opens
  useEffect(() => {
    if (!open || history) return
    authedFetch('/api/me/credit-history?limit=10')
      .then(r => r.ok ? r.json() : null)
      .then(j => j && setHistory(j.entries || []))
      .catch(() => {})
  }, [open, history])

  if (loading || !me) {
    return (
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 11.5,
        color: 'var(--text-4)',
      }}>—</div>
    )
  }

  const { credits, plan } = me
  const remaining = credits.remaining
  const tone = remaining <= 10 ? 'danger' : remaining <= 50 ? 'warn' : 'accent'
  const toneColor = tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--accent)'
  const resetIn = fmtResetIn(credits.resetAt)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Plan, credits, and recent activity"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '5px 11px',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 999,
          fontFamily: 'var(--font-mono)',
          fontSize: 12, fontWeight: 500,
          color: 'var(--text-2)',
          cursor: 'pointer',
          letterSpacing: '0.02em',
          transition: 'border-color 120ms',
        }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--border-strong)'}
        onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
      >
        <span style={{
          width: 6, height: 6, borderRadius: 999, background: toneColor,
          boxShadow: `0 0 0 4px color-mix(in oklab, ${toneColor} 18%, transparent)`,
        }} />
        <span style={{ color: toneColor, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {remaining}
        </span>
        <span style={{ color: 'var(--text-3)' }}>cr</span>
        {resetIn && (
          <>
            <span style={{ color: 'var(--text-4)' }}>·</span>
            <span style={{ color: 'var(--text-4)' }}>{resetIn}</span>
          </>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 38, zIndex: 50,
          minWidth: 320,
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          borderRadius: 10, padding: 14,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}>
          {/* Plan + credits header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <div style={{
                fontSize: 10.5, fontWeight: 600, color: 'var(--text-4)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3,
              }}>Plan</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  background: 'var(--accent-dim)',
                  border: '1px solid var(--accent-dim-strong)',
                  borderRadius: 999,
                  fontSize: 11, fontWeight: 600,
                  color: 'var(--accent)',
                }}>
                  {plan.label}
                </span>
                {plan.priceUsd != null && plan.priceUsd > 0 && (
                  <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                    ${plan.priceUsd}/mo
                  </span>
                )}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 22, fontWeight: 600,
                color: toneColor,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
              }}>{remaining}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-4)', marginTop: 3 }}>
                of {plan.monthlyCredits} cr
              </div>
            </div>
          </div>

          {/* Reset date */}
          {credits.resetAt && (
            <div style={{
              padding: '6px 10px', marginBottom: 10,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: 11.5, color: 'var(--text-3)',
              fontFamily: 'var(--font-mono)',
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>Resets in</span>
              <span style={{ color: 'var(--text-2)' }}>
                {resetIn} ({new Date(credits.resetAt).toLocaleDateString()})
              </span>
            </div>
          )}

          {/* Recent activity */}
          <div style={{
            fontSize: 10.5, fontWeight: 600, color: 'var(--text-4)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
            marginBottom: 6,
          }}>Recent activity</div>

          {!history ? (
            <div style={{ fontSize: 11.5, color: 'var(--text-4)', padding: '6px 0' }}>Loading…</div>
          ) : history.length === 0 ? (
            <div style={{ fontSize: 11.5, color: 'var(--text-4)', padding: '6px 0' }}>No activity yet.</div>
          ) : (
            <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {history.map(e => {
                // credits_used > 0 = spend (debit), < 0 = grant (credit).
                // Display: "−N" muted for spends, "+N" lime for grants.
                const isGrant = e.credits_used < 0
                const amount = Math.abs(e.credits_used)
                return (
                  <div key={e.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    fontSize: 11, padding: '4px 8px',
                    background: 'var(--surface)', borderRadius: 4,
                  }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)', color: 'var(--text-3)',
                    }}>
                      {new Date(e.ts).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span style={{ color: 'var(--text-2)', flex: 1, textAlign: 'left', paddingLeft: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fmtAction(e.action)}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontWeight: 600,
                      color: isGrant ? 'var(--accent)' : 'var(--text-2)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {isGrant ? '+' : '−'}{amount}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => { setOpen(false); setOutOfCreditsModal({ message: 'Top up or upgrade to keep generating', required: 0 }) }}
              style={{
                flex: 1,
                background: 'var(--accent)',
                color: 'var(--accent-on)',
                border: 'none', borderRadius: 6,
                padding: '7px 12px',
                fontSize: 12, fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >Top up / Upgrade</button>
            <button
              onClick={() => refresh()}
              title="Refresh balance"
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-3)',
                borderRadius: 6, padding: '7px 12px',
                fontSize: 12, cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >↻</button>
          </div>

          {/* Manage billing — only shown if user has a Stripe customer */}
          {me.stripeCustomerId && (
            <button
              onClick={async () => {
                try {
                  const r = await authedFetch('/api/billing/portal', { method: 'POST' })
                  const j = await r.json()
                  if (j.url) window.location.href = j.url
                } catch {}
              }}
              style={{
                marginTop: 8, width: '100%',
                background: 'transparent', border: 'none',
                color: 'var(--text-3)', fontSize: 11.5,
                fontFamily: 'var(--font-mono)',
                padding: '4px 0', cursor: 'pointer',
                textDecoration: 'underline',
                textUnderlineOffset: 2,
              }}
            >Manage billing →</button>
          )}
        </div>
      )}
    </div>
  )
}

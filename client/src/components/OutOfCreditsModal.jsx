// Renders when MeContext.outOfCreditsModal is non-null. Two flavors:
//   1. Insufficient credits ({required, action, message})
//   2. Project limit reached ({code: 'PROJECT_LIMIT_REACHED', limit, currentCount, planLabel})
//
// Top-up packs hit /api/billing/checkout (mode=payment).
// Upgrade plan opens the PricingModal.

import React, { useState } from 'react'
import { useMe } from '../lib/MeContext.jsx'
import { authedFetch } from '../lib/supabase.js'
import { TOPUP_PACKS } from '../lib/credits.js'
import { Btn } from './ui/index.jsx'
import PricingModal from './PricingModal.jsx'

const PACK_KEYS = ['topup_100', 'topup_500', 'topup_1500']

export default function OutOfCreditsModal() {
  const { outOfCreditsModal: m, closeOutOfCredits, me } = useMe()
  const [pricingOpen, setPricingOpen] = useState(false)
  const [busy, setBusy] = useState(null)  // pack key currently submitting
  const [err, setErr] = useState(null)

  if (!m && !pricingOpen) return null

  const isProjectLimit = m?.code === 'PROJECT_LIMIT_REACHED'
  const planLabel = me?.plan?.label || 'your plan'

  async function startTopup(packKey) {
    setBusy(packKey); setErr(null)
    try {
      const r = await authedFetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'topup', packKey }),
      })
      const j = await r.json()
      if (!r.ok || !j.url) throw new Error(j.error || `HTTP ${r.status}`)
      window.location.href = j.url
    } catch (e) {
      setErr(e.message)
      setBusy(null)
    }
  }

  function openUpgrade() {
    closeOutOfCredits()
    setPricingOpen(true)
  }

  return (
    <>
      {m && (
        <div
          onClick={closeOutOfCredits}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.7)',
            display: 'grid', placeItems: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 460,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12, padding: 28,
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                {isProjectLimit ? 'Project limit reached' : 'Out of credits'}
              </h2>
              <button
                onClick={closeOutOfCredits}
                style={{
                  background: 'transparent', border: 'none', padding: 4,
                  color: 'var(--text-3)', fontSize: 14, cursor: 'pointer',
                }}
              >✕</button>
            </div>

            <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 18 }}>
              {isProjectLimit
                ? `You're using ${m.currentCount} of ${m.limit} brands on ${planLabel}. Upgrade to add more.`
                : m.required > 0
                  ? `This action needs ${m.required} credits. You have ${me?.credits?.remaining ?? 0}.`
                  : `Top up or upgrade to keep generating.`}
            </p>

            {err && (
              <div style={{
                marginBottom: 14, padding: '8px 12px',
                background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)',
                borderRadius: 6, fontSize: 12, color: 'var(--danger)',
              }}>{err}</div>
            )}

            {!isProjectLimit && (
              <div style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 8, padding: 14, marginBottom: 18,
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, color: 'var(--text-4)',
                  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
                }}>Top-up packs</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {PACK_KEYS.map(key => {
                    const pack = TOPUP_PACKS[key]
                    const isBusy = busy === key
                    return (
                      <button
                        key={key}
                        onClick={() => !busy && startTopup(key)}
                        disabled={busy != null}
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 6, padding: '10px 6px',
                          color: 'var(--text-2)',
                          cursor: busy ? 'not-allowed' : 'pointer',
                          opacity: busy && !isBusy ? 0.45 : 1,
                          fontFamily: 'inherit',
                          transition: 'border-color 120ms',
                        }}
                        onMouseEnter={(e) => !busy && (e.currentTarget.style.borderColor = 'var(--accent)')}
                        onMouseLeave={(e) => !busy && (e.currentTarget.style.borderColor = 'var(--border)')}
                      >
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>
                          {pack.credits}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>credits</div>
                        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6, fontWeight: 500 }}>
                          {isBusy ? '…' : `$${pack.priceUsd}`}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="primary" size="md" onClick={openUpgrade} style={{ flex: 1 }}>
                Upgrade plan
              </Btn>
              <Btn variant="soft" size="md" onClick={closeOutOfCredits}>
                Close
              </Btn>
            </div>

            {!isProjectLimit && me?.credits?.resetAt && (
              <div style={{
                marginTop: 14, fontSize: 11.5, color: 'var(--text-4)',
                textAlign: 'center', fontFamily: 'var(--font-mono)',
              }}>
                Credits reset {new Date(me.credits.resetAt).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>
      )}

      <PricingModal open={pricingOpen} onClose={() => setPricingOpen(false)} />
    </>
  )
}

// Plan picker modal — shown when user clicks "Upgrade plan" anywhere.
// Three monthly tiers (Solo / Operator / Studio) plus a "Talk to founder"
// row for Scale (custom pricing). Click → POST /api/billing/checkout →
// redirect to Stripe-hosted checkout.

import React, { useState } from 'react'
import { authedFetch } from '../lib/supabase.js'
import { useMe } from '../lib/MeContext.jsx'
import { Btn } from './ui/index.jsx'

const TIERS = [
  {
    key: 'solo', name: 'Solo', priceUsd: 19, credits: 200,
    tag: 'For 1 brand, 1 founder',
    features: ['1 brand', '200 credits / mo', 'All 20 formats', 'Image + copy generation'],
  },
  {
    key: 'operator', name: 'Operator', priceUsd: 49, credits: 600, popular: true,
    tag: 'Most teams pick this',
    features: ['3 brands', '600 credits / mo', 'Everything in Solo', 'Priority queue'],
  },
  {
    key: 'studio', name: 'Studio', priceUsd: 149, credits: 2000,
    tag: 'Agencies, 3-15 brands',
    features: ['15 brands', '2000 credits / mo', 'Everything in Operator', 'Webhooks (soon)'],
  },
]

export default function PricingModal({ open, onClose }) {
  const { me } = useMe()
  const [busy, setBusy] = useState(null)  // tier key currently submitting
  const [err, setErr] = useState(null)

  if (!open) return null

  const currentPlan = me?.plan?.key

  async function startCheckout(planKey) {
    setBusy(planKey); setErr(null)
    try {
      const r = await authedFetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'subscription', planKey }),
      })
      const j = await r.json()
      if (!r.ok || !j.url) throw new Error(j.error || `HTTP ${r.status}`)
      window.location.href = j.url  // hand off to Stripe-hosted checkout
    } catch (e) {
      setErr(e.message)
      setBusy(null)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 110,
        background: 'rgba(0,0,0,0.78)',
        display: 'grid', placeItems: 'center',
        padding: 20, overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 920,
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 14, padding: 32,
          boxShadow: '0 20px 80px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em' }}>
              Choose a plan
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
              Cancel or change anytime. Test mode — no real card charged.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', padding: 6,
              color: 'var(--text-3)', fontSize: 16, cursor: 'pointer',
            }}
          >✕</button>
        </div>

        {err && (
          <div style={{
            marginBottom: 16, padding: '10px 14px',
            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)',
            borderRadius: 8, fontSize: 13, color: 'var(--danger)',
          }}>{err}</div>
        )}

        <div style={{
          display: 'grid', gap: 14,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}>
          {TIERS.map(t => {
            const isCurrent = currentPlan === t.key
            const isBusy = busy === t.key
            return (
              <div
                key={t.key}
                style={{
                  position: 'relative',
                  background: 'var(--surface)',
                  border: t.popular ? '1px solid var(--accent)' : '1px solid var(--border)',
                  borderRadius: 12, padding: 22,
                  display: 'flex', flexDirection: 'column', gap: 14,
                }}
              >
                {t.popular && (
                  <span style={{
                    position: 'absolute', top: -10, left: 18,
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                    padding: '3px 10px', borderRadius: 999,
                    background: 'var(--accent)', color: 'var(--accent-on)',
                    textTransform: 'uppercase',
                  }}>Popular</span>
                )}

                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                    <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                      {t.name}
                    </h3>
                    {isCurrent && (
                      <span style={{
                        fontSize: 9.5, fontWeight: 600, letterSpacing: '0.05em',
                        padding: '1px 6px', borderRadius: 999,
                        background: 'var(--accent-dim)', color: 'var(--accent)',
                        border: '1px solid var(--accent-dim-strong)',
                        textTransform: 'uppercase',
                      }}>Current</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{t.tag}</div>
                </div>

                <div>
                  <span style={{
                    fontSize: 32, fontWeight: 700, color: 'var(--text)',
                    fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                  }}>${t.priceUsd}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-3)', marginLeft: 4 }}>/mo</span>
                </div>

                <ul style={{
                  listStyle: 'none', padding: 0, margin: 0,
                  display: 'flex', flexDirection: 'column', gap: 6,
                }}>
                  {t.features.map(f => (
                    <li key={f} style={{
                      fontSize: 12.5, color: 'var(--text-2)',
                      paddingLeft: 16, position: 'relative', lineHeight: 1.4,
                    }}>
                      <span style={{
                        position: 'absolute', left: 0, color: 'var(--accent)',
                      }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                <Btn
                  variant={t.popular || isCurrent ? 'primary' : 'secondary'}
                  size="md"
                  onClick={() => !isCurrent && !isBusy && startCheckout(t.key)}
                  disabled={isCurrent || isBusy || busy != null}
                  style={{ width: '100%', marginTop: 'auto' }}
                >
                  {isCurrent ? 'Current plan' : isBusy ? 'Redirecting…' : 'Choose ' + t.name}
                </Btn>
              </div>
            )
          })}
        </div>

        <p style={{ marginTop: 18, fontSize: 11.5, color: 'var(--text-4)', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
          Secured by Stripe. Cancel from the customer portal anytime.
        </p>
      </div>
    </div>
  )
}

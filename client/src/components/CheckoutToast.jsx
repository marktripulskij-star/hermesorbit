// Small bottom-right toast that shows after a Stripe checkout return.
// Driven entirely by MeContext.checkoutToast — no props.

import React from 'react'
import { useMe } from '../lib/MeContext.jsx'

export default function CheckoutToast() {
  const { checkoutToast } = useMe()
  if (!checkoutToast) return null

  const colors = {
    success: { bg: 'var(--accent-dim)', border: 'var(--accent)', text: 'var(--accent)' },
    info:    { bg: 'var(--surface-2)', border: 'var(--border)', text: 'var(--text-2)' },
    error:   { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.4)', text: 'var(--danger)' },
  }
  const c = colors[checkoutToast.kind] || colors.info

  return (
    <div
      style={{
        position: 'fixed', right: 20, bottom: 20, zIndex: 200,
        background: c.bg, color: c.text,
        border: `1px solid ${c.border}`,
        borderRadius: 8, padding: '10px 16px',
        fontSize: 13, fontWeight: 500,
        boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
      }}
    >
      {checkoutToast.kind === 'success' ? '✓ ' : ''}
      {checkoutToast.text}
    </div>
  )
}

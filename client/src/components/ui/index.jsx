// Ultemir design-system primitives — anchor for all new app UI.
// Mirrors marketing/components.jsx exactly so app + landing feel one-system.
// Use these instead of raw <button>/<div> when building new screens.

import React, { useState } from 'react'

// ── Btn ────────────────────────────────────────────────────────────────────
export function Btn({ variant = 'primary', size = 'md', icon, children, style, ...rest }) {
  const sz = {
    sm: { h: 32, px: 12, fs: 13, gap: 6 },
    md: { h: 40, px: 16, fs: 14, gap: 8 },
    lg: { h: 48, px: 22, fs: 15, gap: 10 },
  }[size]
  const variants = {
    primary:   { background: 'var(--accent)', color: 'var(--accent-on)', borderColor: 'transparent' },
    secondary: { background: 'transparent', color: 'var(--accent)', borderColor: 'var(--accent)' },
    ghost:     { background: 'transparent', color: 'var(--text)', borderColor: 'transparent' },
    soft:      { background: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' },
    danger:    { background: 'transparent', color: 'var(--danger)', borderColor: 'rgba(248,113,113,0.4)' },
  }
  const v = variants[variant]
  return (
    <button
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        gap: sz.gap, height: sz.h, padding: `0 ${sz.px}px`,
        borderRadius: 8, fontSize: sz.fs, fontWeight: 600,
        letterSpacing: '-0.01em', whiteSpace: 'nowrap',
        transition: 'all 120ms ease', border: '1px solid', cursor: 'pointer',
        fontFamily: 'inherit',
        ...v,
        ...style,
      }}
      onMouseEnter={(e) => {
        if (variant === 'primary') e.currentTarget.style.background = 'var(--accent-2)'
        else if (variant === 'secondary') e.currentTarget.style.background = 'var(--accent-dim)'
        else if (variant === 'ghost') e.currentTarget.style.color = 'var(--accent)'
        else if (variant === 'soft') e.currentTarget.style.borderColor = 'var(--border-strong)'
        else if (variant === 'danger') e.currentTarget.style.background = 'rgba(248,113,113,0.08)'
      }}
      onMouseLeave={(e) => {
        Object.assign(e.currentTarget.style, v, { ...style })
      }}
      {...rest}
    >
      {children}{icon}
    </button>
  )
}

// ── Card ───────────────────────────────────────────────────────────────────
export function Card({ children, hoverGlow = false, padding = 18, style, ...rest }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding,
        transition: 'border-color 160ms ease',
        ...(hoverGlow && hover ? {
          borderColor: 'color-mix(in oklab, var(--accent) 50%, var(--border))',
        } : {}),
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  )
}

// ── Eyebrow (mono section label with optional leading number) ──────────────
export function Eyebrow({ children, num }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 500,
      color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em',
    }}>
      {num != null && (
        <span style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
          {String(num).padStart(2, '0')}
        </span>
      )}
      <span style={{ height: 1, width: 22, background: 'var(--border-strong)' }} />
      {children}
    </div>
  )
}

// ── FunnelBadge ────────────────────────────────────────────────────────────
export function FunnelBadge({ stage }) {
  const map = {
    TOFU: { c: '#4ade80', label: 'TOFU' },
    MOFU: { c: '#facc15', label: 'MOFU' },
    BOFU: { c: '#f87171', label: 'BOFU' },
    tofu: { c: '#4ade80', label: 'TOFU' },
    mofu: { c: '#facc15', label: 'MOFU' },
    bofu: { c: '#f87171', label: 'BOFU' },
  }
  const it = map[stage] || map.TOFU
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 8px', borderRadius: 999,
      fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600,
      letterSpacing: '0.04em',
      background: `color-mix(in oklab, ${it.c} 14%, transparent)`,
      color: it.c,
      border: `1px solid color-mix(in oklab, ${it.c} 30%, transparent)`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 999, background: it.c }} />
      {it.label}
    </span>
  )
}

// ── ScoreChip ──────────────────────────────────────────────────────────────
export function ScoreChip({ label, score }) {
  const c = score >= 9 ? 'var(--success)' : score >= 7 ? 'var(--warn)' : 'var(--danger)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 8px', borderRadius: 6,
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
      fontSize: 11.5,
    }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{
        fontFamily: 'var(--font-mono)', fontWeight: 600, color: c,
        fontVariantNumeric: 'tabular-nums',
      }}>{score}<span style={{ color: 'var(--text-4)' }}>/10</span></span>
    </span>
  )
}

// ── StatusPill (online/processing/etc dots) ────────────────────────────────
export function StatusPill({ children, tone = 'accent' }) {
  const c = tone === 'accent' ? 'var(--accent)' : tone === 'success' ? 'var(--success)' : tone === 'warn' ? 'var(--warn)' : 'var(--danger)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '4px 10px', borderRadius: 999,
      background: 'var(--surface)', border: '1px solid var(--border)',
      fontSize: 11.5, color: 'var(--text-2)',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: 999, background: c,
        boxShadow: `0 0 0 4px color-mix(in oklab, ${c} 18%, transparent)`,
      }} />
      {children}
    </span>
  )
}

// ── Kbd (keyboard shortcut hint) ───────────────────────────────────────────
export function Kbd({ children }) {
  return (
    <kbd style={{
      fontFamily: 'var(--font-mono)', fontSize: 11,
      padding: '2px 6px', borderRadius: 4,
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      color: 'var(--text-4)',
    }}>{children}</kbd>
  )
}

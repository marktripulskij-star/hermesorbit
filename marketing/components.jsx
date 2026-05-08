// components.jsx — shared primitives for Ultemir landing

const { useState, useEffect, useRef, useMemo } = React;

// ── Logo ────────────────────────────────────────────────────────────────
function Logo({ size = 22, withWord = true }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, lineHeight: 1 }}>
      <img src="assets/logo.png" alt="Ultemir"
        width={size} height={size}
        style={{ width: size, height: size, display: 'block', objectFit: 'contain' }} />
      {withWord && (
        <span style={{
          fontSize: size * 0.78, fontWeight: 600, letterSpacing: '-0.02em',
          color: 'var(--text)'
        }}>Ultemir</span>
      )}
    </span>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────
function Btn({ variant = 'primary', children, size = 'md', icon, href, ...rest }) {
  const sz = {
    sm: { h: 32, px: 12, fs: 13, gap: 6 },
    md: { h: 40, px: 16, fs: 14, gap: 8 },
    lg: { h: 48, px: 22, fs: 15, gap: 10 },
  }[size];
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: sz.gap, height: sz.h, padding: `0 ${sz.px}px`,
    borderRadius: 8, fontSize: sz.fs, fontWeight: 600,
    letterSpacing: '-0.01em', whiteSpace: 'nowrap',
    transition: 'all 120ms ease', border: '1px solid transparent',
    cursor: 'pointer',
    textDecoration: 'none',  // for when rendered as <a>
  };
  const styles = {
    primary: { ...base, background: 'var(--accent)', color: 'var(--accent-on)' },
    secondary: { ...base, background: 'transparent', color: 'var(--accent)', borderColor: 'var(--accent)' },
    ghost: { ...base, background: 'transparent', color: 'var(--text)' },
    soft: { ...base, background: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' },
  };
  // Polymorphic: <a> when href provided, <button> otherwise.
  const Tag = href ? 'a' : 'button';
  const tagProps = href ? { href, ...rest } : rest;
  return (
    <Tag style={styles[variant]} {...tagProps}
      onMouseEnter={(e) => {
        if (variant === 'primary') e.currentTarget.style.background = 'var(--accent-2)';
        if (variant === 'secondary') e.currentTarget.style.background = 'var(--accent-dim)';
        if (variant === 'ghost') e.currentTarget.style.color = 'var(--accent)';
        if (variant === 'soft') e.currentTarget.style.borderColor = 'var(--border-strong)';
      }}
      onMouseLeave={(e) => {
        Object.assign(e.currentTarget.style, styles[variant]);
      }}
    >
      {children}{icon}
    </Tag>
  );
}

// ── Eyebrow / section labels ─────────────────────────────────────────────
function Eyebrow({ children, num }) {
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
  );
}

// ── Funnel badge (TOFU/MOFU/BOFU) ───────────────────────────────────────
function FunnelBadge({ stage }) {
  const map = {
    TOFU: { c: '#4ade80', label: 'TOFU' },
    MOFU: { c: '#facc15', label: 'MOFU' },
    BOFU: { c: '#f87171', label: 'BOFU' },
  };
  const it = map[stage];
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
  );
}

// ── Score chip ───────────────────────────────────────────────────────────
function ScoreChip({ label, score }) {
  const c = score >= 9 ? '#4ade80' : score >= 7 ? '#facc15' : '#f87171';
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
  );
}

// ── "Mock ad" — a realistic-feeling ad image placeholder ────────────────
// Renders a generated-ad-looking visual: gradient background, mock product
// silhouette, a headline overlay. No real photography.
function MockAd({ palette = 'sage', headline, sub, format = 'square', size = 280, fluid = false }) {
  const palettes = {
    sage:   { bg: 'linear-gradient(135deg,#dfe7d8 0%,#9fb38f 100%)', tone: '#3a4a32', prod: '#e8efe1' },
    blush:  { bg: 'linear-gradient(135deg,#f4dcd0 0%,#d49a85 100%)', tone: '#5a2e22', prod: '#fbeae0' },
    sand:   { bg: 'linear-gradient(135deg,#f0e6d2 0%,#c9b487 100%)', tone: '#3a2e18', prod: '#f7eed8' },
    night:  { bg: 'linear-gradient(140deg,#1c2030 0%,#3a3145 100%)', tone: '#dfd5e8', prod: '#26273a' },
    citrus: { bg: 'linear-gradient(135deg,#f6efb6 0%,#cfd86b 100%)', tone: '#2a3014', prod: '#fbf7d0' },
    rose:   { bg: 'linear-gradient(135deg,#f7d8da 0%,#c87a82 100%)', tone: '#4a1a22', prod: '#fbe6e8' },
    cream:  { bg: 'linear-gradient(135deg,#fbf3e7 0%,#e6d2ad 100%)', tone: '#3a2c14', prod: '#fdf8eb' },
    moss:   { bg: 'linear-gradient(135deg,#cfd9bd 0%,#7a8c5c 100%)', tone: '#1f2a14', prod: '#dde6cb' },
  };
  const p = palettes[palette] || palettes.sage;
  const dims = format === 'portrait' ? { w: size, h: size * 1.25, ar: '1 / 1.25' }
             : format === 'landscape' ? { w: size * 1.5, h: size, ar: '1.5 / 1' }
             : { w: size, h: size, ar: '1 / 1' };

  const sizing = fluid
    ? { width: '100%', aspectRatio: dims.ar, maxWidth: dims.w }
    : { width: dims.w, height: dims.h };

  return (
    <div style={{
      ...sizing,
      borderRadius: 12,
      position: 'relative', overflow: 'hidden',
      background: p.bg, color: p.tone, flexShrink: 0,
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
    }}>
      {/* Soft vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(120% 80% at 50% 110%, rgba(0,0,0,0.18), transparent 60%)',
      }} />

      {/* Mock product: a bottle silhouette, vector */}
      <svg viewBox="0 0 200 240" style={{
        position: 'absolute', left: '50%', top: '52%',
        transform: 'translate(-50%, -50%)',
        width: '46%', height: 'auto',
        filter: 'drop-shadow(0 12px 20px rgba(0,0,0,0.18))',
      }}>
        {/* Cap */}
        <rect x="78" y="14" width="44" height="22" rx="3" fill={p.tone} opacity="0.85" />
        <rect x="74" y="32" width="52" height="10" rx="2" fill={p.tone} opacity="0.7" />
        {/* Neck */}
        <rect x="86" y="40" width="28" height="20" fill={p.prod} />
        {/* Bottle body */}
        <path d="M60 60 Q60 56 64 56 H136 Q140 56 140 60 V210 Q140 224 126 224 H74 Q60 224 60 210 Z"
              fill={p.prod} />
        {/* Label */}
        <rect x="72" y="110" width="56" height="80" fill="rgba(255,255,255,0.65)" rx="2" />
        <rect x="80" y="124" width="40" height="3" fill={p.tone} opacity="0.6" />
        <rect x="80" y="132" width="28" height="2" fill={p.tone} opacity="0.4" />
        <rect x="80" y="160" width="40" height="2" fill={p.tone} opacity="0.4" />
        <rect x="80" y="166" width="34" height="2" fill={p.tone} opacity="0.4" />
        <rect x="80" y="172" width="38" height="2" fill={p.tone} opacity="0.4" />
        {/* "M" mark for Maren */}
        <text x="100" y="148" textAnchor="middle"
          style={{ font: '700 12px Geist, sans-serif', fill: p.tone, opacity: 0.9 }}>
          MAREN
        </text>
      </svg>

      {/* Headline overlay, top */}
      {headline && (
        <div style={{
          position: 'absolute', left: 16, right: 16, top: 16,
          fontSize: 'clamp(15px, 2.2cqw + 12px, 22px)', fontWeight: 700, letterSpacing: '-0.02em',
          lineHeight: 1.05, textWrap: 'balance',
        }}>
          {headline}
        </div>
      )}
      {sub && (
        <div style={{
          position: 'absolute', left: 16, right: 16, bottom: 16,
          fontSize: 11.5, opacity: 0.78, letterSpacing: '-0.005em',
          fontWeight: 500,
        }}>
          {sub}
        </div>
      )}

      {/* Tiny "Sponsored" tag */}
      <div style={{
        position: 'absolute', right: 12, top: 12,
        fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
        background: 'rgba(0,0,0,0.18)', color: p.tone,
        padding: '3px 6px', borderRadius: 4, letterSpacing: '0.06em',
        opacity: headline ? 0 : 0.55,
      }}>
        SPONSORED
      </div>
    </div>
  );
}

// ── Surface card ─────────────────────────────────────────────────────────
function Card({ children, style, hoverGlow, ...rest }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        transition: 'border-color 160ms ease, transform 160ms ease',
        ...(hoverGlow && hover ? {
          borderColor: 'color-mix(in oklab, var(--accent) 50%, var(--border))',
        } : {}),
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

// Export to window
Object.assign(window, {
  Logo, Btn, Eyebrow, FunnelBadge, ScoreChip, MockAd, Card,
});

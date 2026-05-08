// Admin page — gated by me.isAdmin. Pulls /api/admin/users (totals + per-user
// breakdown), /api/admin/cost-breakdown (where COGS is going), and lets the
// admin grant/revoke credits, change plans, and view individual ledgers.
//
// Route: #/admin (handled by Router.jsx).

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { authedFetch } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { useMe } from '../lib/MeContext.jsx'
import { Btn } from './ui/index.jsx'

const fmtUsd = (n) => `$${Number(n || 0).toFixed(2)}`
const fmtUsd4 = (n) => `$${Number(n || 0).toFixed(4)}`
const fmtPct = (n) => `${Number(n || 0).toFixed(1)}%`
const fmtInt = (n) => Number(n || 0).toLocaleString()
const fmtDate = (d) => {
  if (!d) return '—'
  const ms = Date.now() - new Date(d).getTime()
  const days = Math.floor(ms / 86400000)
  if (days < 0) return new Date(d).toLocaleDateString()
  if (days === 0) {
    const hours = Math.floor(ms / 3600000)
    if (hours < 1) return 'just now'
    return `${hours}h ago`
  }
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export default function AdminPage() {
  const { user, signOut } = useAuth()
  const { me } = useMe()
  const [data, setData] = useState(null)
  const [breakdown, setBreakdown] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState('all')
  const [sortBy, setSortBy] = useState('lastActivity')  // 'lastActivity'|'revenue'|'cogs'|'margin'|'utilization'|'created'
  const [selectedUserId, setSelectedUserId] = useState(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [a, b] = await Promise.all([
        authedFetch('/api/admin/users').then(r => r.ok ? r.json() : Promise.reject(new Error(`users: HTTP ${r.status}`))),
        authedFetch('/api/admin/cost-breakdown').then(r => r.ok ? r.json() : Promise.reject(new Error(`breakdown: HTTP ${r.status}`))),
      ])
      setData(a)
      setBreakdown(b)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Gate: non-admin users get a polite 403.
  if (me && !me.isAdmin) {
    return (
      <div style={{
        minHeight: '100vh', background: 'var(--bg)',
        display: 'grid', placeItems: 'center', padding: 32,
      }}>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <h1 style={{ fontSize: 20, color: 'var(--text)', marginBottom: 8 }}>Admin only</h1>
          <p style={{ color: 'var(--text-3)', fontSize: 14, marginBottom: 16 }}>
            This page is for the team. If you need to be granted access, ping the owner.
          </p>
          <a href="#/" style={{ color: 'var(--accent)', fontSize: 13.5 }}>← Back to your brands</a>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="#/" style={{ color: 'var(--text-3)', fontSize: 13, textDecoration: 'none' }}>
            ← Brands
          </a>
          <span style={{ color: 'var(--text-4)' }}>/</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Admin</span>
          {data?.monthStart && (
            <span style={{
              fontSize: 11, color: 'var(--text-4)', fontFamily: 'var(--font-mono)',
              padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 4,
            }}>
              MTD · {new Date(data.monthStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{user?.email}</span>
          <Btn variant="soft" size="sm" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Btn>
          <Btn variant="soft" size="sm" onClick={signOut}>Log out</Btn>
        </div>
      </header>

      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 24px 80px' }}>
        {error && (
          <div style={{
            marginBottom: 18, padding: '10px 14px',
            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)',
            borderRadius: 8, fontSize: 13, color: 'var(--danger)',
          }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {loading && !data && <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>}

        {data && (
          <>
            <TotalsRow totals={data.totals} />
            <PricingCalculator data={data} />
            <CostBreakdown breakdown={breakdown} />

            <div style={{ marginTop: 32 }}>
              <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                marginBottom: 12,
              }}>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
                  Users <span style={{ color: 'var(--text-4)', fontWeight: 400, fontSize: 13 }}>· {data.users.length} total · {data.totals.activeUsers} active this month</span>
                </h2>
              </div>

              <FiltersBar
                search={search} setSearch={setSearch}
                planFilter={planFilter} setPlanFilter={setPlanFilter}
                sortBy={sortBy} setSortBy={setSortBy}
              />

              <UserTable
                users={data.users}
                search={search}
                planFilter={planFilter}
                sortBy={sortBy}
                onSelect={setSelectedUserId}
                selectedId={selectedUserId}
              />
            </div>
          </>
        )}

        {selectedUserId && data && (
          <UserDetail
            userId={selectedUserId}
            user={data.users.find(u => u.id === selectedUserId)}
            onClose={() => setSelectedUserId(null)}
            onChanged={refresh}
          />
        )}
      </main>
    </div>
  )
}

// ── Totals row ──────────────────────────────────────────────────────────────
function TotalsRow({ totals }) {
  const stats = [
    { label: 'Revenue MTD',   value: fmtUsd(totals.revenueUsd),     accent: 'var(--accent)' },
    { label: 'Stripe fees',   value: fmtUsd(totals.stripeFeeUsd),   accent: 'var(--text-3)' },
    { label: 'COGS (real)',   value: fmtUsd4(totals.cogsActualUsd), accent: 'var(--text-3)' },
    { label: 'Net revenue',   value: fmtUsd(totals.netRevenueUsd),  accent: 'var(--text)' },
    { label: 'Gross profit',  value: fmtUsd(totals.grossProfitUsd), accent: totals.grossProfitUsd >= 0 ? 'var(--accent)' : 'var(--danger)' },
    { label: 'Margin',        value: fmtPct(totals.grossMarginPct), accent: totals.grossMarginPct >= 50 ? 'var(--accent)' : 'var(--warn, #f59e0b)' },
    { label: 'Active users',  value: fmtInt(totals.activeUsers),    accent: 'var(--text)' },
    { label: 'API calls',     value: fmtInt(totals.callsThisMonth), accent: 'var(--text)' },
  ]
  return (
    <div style={{
      display: 'grid', gap: 10,
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      marginBottom: 24,
    }}>
      {stats.map(s => (
        <div key={s.label} style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '12px 14px',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>
            {s.label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, color: s.accent, letterSpacing: '-0.02em', fontFamily: 'var(--font-mono)' }}>
            {s.value}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Pricing what-if calculator ──────────────────────────────────────────────
function PricingCalculator({ data }) {
  const STRIPE_PCT = 0.029
  const STRIPE_FLAT = 0.30
  const plans = data.plans
  const planKeys = ['solo', 'operator', 'studio']

  // Default override prices = current prices.
  const [overrides, setOverrides] = useState(() => Object.fromEntries(
    planKeys.map(k => [k, plans[k].priceUsd])
  ))

  // Compute per-plan stats from real users.
  const perPlan = useMemo(() => {
    const m = {}
    for (const k of planKeys) m[k] = { users: 0, totalCogs: 0, totalCredits: 0 }
    for (const u of data.users) {
      if (m[u.plan]) {
        m[u.plan].users += 1
        m[u.plan].totalCogs += u.cogsActualUsd
        m[u.plan].totalCredits += u.creditsConsumed
      }
    }
    return m
  }, [data])

  function calc(planKey, priceOverride) {
    const limits = plans[planKey]
    const stat = perPlan[planKey]
    const avgCogs = stat.users > 0 ? stat.totalCogs / stat.users : 0
    const avgCredits = stat.users > 0 ? stat.totalCredits / stat.users : 0
    const utilizationPct = limits.credits > 0 ? (avgCredits / limits.credits) * 100 : 0
    // Theoretical max COGS at 100% utilization, using real $/credit ratio
    const realCogsPerCredit = avgCredits > 0 ? avgCogs / avgCredits : 0.025
    const maxCogs = limits.credits * realCogsPerCredit

    const priceCurrent = limits.priceUsd
    const priceProposed = Number(priceOverride)

    const m = (price, cogs) => {
      if (!price || price <= 0) return 0
      const stripe = price * STRIPE_PCT + STRIPE_FLAT
      return ((price - stripe - cogs) / price) * 100
    }
    return {
      avgCogs, avgCredits, utilizationPct, maxCogs, realCogsPerCredit,
      priceCurrent, priceProposed,
      marginAtAvgCurrent:  m(priceCurrent,  avgCogs),
      marginAtAvgProposed: m(priceProposed, avgCogs),
      marginAtMaxCurrent:  m(priceCurrent,  maxCogs),
      marginAtMaxProposed: m(priceProposed, maxCogs),
    }
  }

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: 18, marginBottom: 24,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>What-if pricing</h2>
        <span style={{ fontSize: 11, color: 'var(--text-4)' }}>Drag price → see margin impact at avg + max utilization (real data)</span>
      </div>
      <div style={{
        display: 'grid', gap: 12, marginTop: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      }}>
        {planKeys.map(k => {
          const c = calc(k, overrides[k])
          return (
            <div key={k} style={{
              border: '1px solid var(--border)', borderRadius: 8, padding: 14,
              background: 'var(--bg)',
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8,
              }}>
                <strong style={{ fontSize: 14, color: 'var(--text)' }}>{plans[k].label}</strong>
                <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
                  {perPlan[k].users} {perPlan[k].users === 1 ? 'user' : 'users'} · {plans[k].credits} cr/mo
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <input
                  type="range" min="0" max="200" step="1"
                  value={overrides[k]}
                  onChange={e => setOverrides(prev => ({ ...prev, [k]: Number(e.target.value) }))}
                  style={{ flex: 1 }}
                />
                <input
                  type="number" min="0" max="999"
                  value={overrides[k]}
                  onChange={e => setOverrides(prev => ({ ...prev, [k]: Number(e.target.value) }))}
                  style={{
                    width: 70, padding: '4px 8px',
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 6, color: 'var(--text)', fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                  }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-4)' }}>USD</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', display: 'grid', gap: 4 }}>
                <Row label="Current price" value={fmtUsd(c.priceCurrent)} />
                <Row label="Proposed price" value={fmtUsd(c.priceProposed)} highlight={c.priceProposed !== c.priceCurrent} />
                <Row label="Avg utilization" value={fmtPct(c.utilizationPct)} />
                <Row label="Avg COGS / user" value={fmtUsd4(c.avgCogs)} />
                <Row label="$ / credit (real)" value={fmtUsd4(c.realCogsPerCredit)} />
                <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
                <Row label="Margin (avg use)"
                  value={fmtPct(c.marginAtAvgProposed)}
                  sub={c.priceCurrent !== c.priceProposed ? `was ${fmtPct(c.marginAtAvgCurrent)}` : null}
                  color={c.marginAtAvgProposed >= 50 ? 'var(--accent)' : 'var(--warn, #f59e0b)'}
                />
                <Row label="Margin (max use)"
                  value={fmtPct(c.marginAtMaxProposed)}
                  sub={c.priceCurrent !== c.priceProposed ? `was ${fmtPct(c.marginAtMaxCurrent)}` : null}
                  color={c.marginAtMaxProposed >= 50 ? 'var(--accent)' : 'var(--warn, #f59e0b)'}
                />
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 10, lineHeight: 1.5 }}>
        Avg = real average from this month's users on that plan. Max = theoretical 100% credit utilization at the real $/credit rate.
        {Object.values(perPlan).every(p => p.users === 0) && ' No paid users yet — averages will populate as people use the product.'}
      </div>
    </div>
  )
}

function Row({ label, value, sub, color, highlight }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ color: highlight ? 'var(--accent)' : 'var(--text-4)' }}>{label}</span>
      <span style={{
        color: color || (highlight ? 'var(--accent)' : 'var(--text)'),
        fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 500,
      }}>
        {value}{sub && <span style={{ color: 'var(--text-4)', marginLeft: 6, fontWeight: 400 }}>· {sub}</span>}
      </span>
    </div>
  )
}

// ── Cost breakdown ──────────────────────────────────────────────────────────
function CostBreakdown({ breakdown }) {
  if (!breakdown) return null
  const top = breakdown.actions.slice(0, 12)
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: 18, marginBottom: 24,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Cost breakdown</h2>
        <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
          Total {fmtUsd4(breakdown.totals.cogsUsd)} · {fmtInt(breakdown.totals.calls)} calls · {fmtUsd4(breakdown.totals.avgCogsPerCreditUsd)}/credit avg
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <Th>Action</Th>
            <Th align="right">Calls</Th>
            <Th align="right">Credits</Th>
            <Th align="right">COGS</Th>
            <Th align="right">$/call</Th>
            <Th align="right">% of COGS</Th>
            <Th>{''}</Th>
          </tr>
        </thead>
        <tbody>
          {top.map(a => (
            <tr key={a.action} style={{ borderBottom: '1px solid var(--border)' }}>
              <Td><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{a.action}</span></Td>
              <Td align="right">{fmtInt(a.calls)}</Td>
              <Td align="right">{fmtInt(a.credits)}</Td>
              <Td align="right">{fmtUsd4(a.cogsUsd)}</Td>
              <Td align="right">{fmtUsd4(a.avgCogsPerCallUsd)}</Td>
              <Td align="right">{fmtPct(a.shareOfCogsPct)}</Td>
              <Td>
                <div style={{
                  width: '100%', maxWidth: 100, height: 6, background: 'var(--border)',
                  borderRadius: 3, overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${Math.min(a.shareOfCogsPct, 100)}%`, height: '100%',
                    background: 'var(--accent)',
                  }} />
                </div>
              </Td>
            </tr>
          ))}
          {top.length === 0 && (
            <tr><Td colSpan={7} style={{ color: 'var(--text-4)', textAlign: 'center', padding: 24 }}>
              No usage logged this month yet.
            </Td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

const Th = ({ children, align = 'left' }) => (
  <th style={{
    textAlign: align, padding: '8px 10px', fontWeight: 500,
    color: 'var(--text-4)', fontSize: 11, letterSpacing: '0.04em',
    textTransform: 'uppercase',
  }}>{children}</th>
)
const Td = ({ children, align = 'left', colSpan, style }) => (
  <td colSpan={colSpan} style={{ padding: '8px 10px', textAlign: align, color: 'var(--text)', ...style }}>
    {children}
  </td>
)

// ── Filters bar ─────────────────────────────────────────────────────────────
function FiltersBar({ search, setSearch, planFilter, setPlanFilter, sortBy, setSortBy }) {
  const planOpts = ['all', 'free', 'solo', 'operator', 'studio', 'scale']
  const sortOpts = [
    { v: 'lastActivity', label: 'Last active' },
    { v: 'revenue',      label: 'Revenue' },
    { v: 'cogs',         label: 'COGS' },
    { v: 'margin',       label: 'Margin' },
    { v: 'utilization',  label: 'Utilization' },
    { v: 'created',      label: 'Signup date' },
  ]
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        placeholder="Search email…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          flex: '1 1 200px', maxWidth: 280,
          padding: '8px 12px', background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 6,
          color: 'var(--text)', fontSize: 13, fontFamily: 'inherit',
        }}
      />
      <select value={planFilter} onChange={e => setPlanFilter(e.target.value)} style={selStyle}>
        {planOpts.map(p => <option key={p} value={p}>{p === 'all' ? 'All plans' : p}</option>)}
      </select>
      <span style={{ fontSize: 11, color: 'var(--text-4)' }}>Sort by</span>
      <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={selStyle}>
        {sortOpts.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
      </select>
    </div>
  )
}
const selStyle = {
  padding: '8px 10px', background: 'var(--surface)',
  border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', fontSize: 13, fontFamily: 'inherit',
}

// ── User table ──────────────────────────────────────────────────────────────
function UserTable({ users, search, planFilter, sortBy, onSelect, selectedId }) {
  const filtered = useMemo(() => {
    let list = users
    if (search) {
      const s = search.toLowerCase()
      list = list.filter(u => (u.email || '').toLowerCase().includes(s))
    }
    if (planFilter !== 'all') list = list.filter(u => u.plan === planFilter)
    const cmp = {
      lastActivity: (a, b) => (b.lastActivityTs || 0) - (a.lastActivityTs || 0),
      revenue:      (a, b) => b.revenueUsd - a.revenueUsd,
      cogs:         (a, b) => b.cogsActualUsd - a.cogsActualUsd,
      margin:       (a, b) => b.grossMarginPct - a.grossMarginPct,
      utilization:  (a, b) => b.utilizationPct - a.utilizationPct,
      created:      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    }[sortBy] || ((a, b) => 0)
    return [...list].sort(cmp)
  }, [users, search, planFilter, sortBy])

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, overflow: 'hidden',
    }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
              <Th>Email</Th>
              <Th>Plan</Th>
              <Th align="right">Credits</Th>
              <Th align="right">Used MTD</Th>
              <Th align="right">Util</Th>
              <Th align="right">Revenue</Th>
              <Th align="right">COGS</Th>
              <Th align="right">Margin</Th>
              <Th align="right">Projects</Th>
              <Th align="right">Last active</Th>
              <Th align="right">Joined</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id}
                onClick={() => onSelect(u.id)}
                style={{
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: selectedId === u.id ? 'rgba(132,204,22,0.06)' : 'transparent',
                }}
                onMouseEnter={e => { if (selectedId !== u.id) e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                onMouseLeave={e => { if (selectedId !== u.id) e.currentTarget.style.background = 'transparent' }}
              >
                <Td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--text)' }}>{u.email}</span>
                    {u.isAdmin && <span style={{
                      fontSize: 10, padding: '1px 5px', borderRadius: 3,
                      background: 'var(--accent-dim, rgba(132,204,22,0.15))', color: 'var(--accent)',
                    }}>admin</span>}
                  </div>
                </Td>
                <Td><PlanPill plan={u.plan} label={u.planLabel} /></Td>
                <Td align="right" style={{ fontFamily: 'var(--font-mono)' }}>{fmtInt(u.creditsRemaining)}</Td>
                <Td align="right" style={{ fontFamily: 'var(--font-mono)' }}>{fmtInt(u.creditsConsumed)}</Td>
                <Td align="right" style={{ fontFamily: 'var(--font-mono)', color: u.utilizationPct > 80 ? 'var(--warn, #f59e0b)' : 'var(--text)' }}>
                  {fmtPct(u.utilizationPct)}
                </Td>
                <Td align="right" style={{ fontFamily: 'var(--font-mono)' }}>{fmtUsd(u.revenueUsd)}</Td>
                <Td align="right" style={{ fontFamily: 'var(--font-mono)' }}>{fmtUsd4(u.cogsActualUsd)}</Td>
                <Td align="right" style={{
                  fontFamily: 'var(--font-mono)',
                  color: u.revenueUsd === 0 ? 'var(--text-4)' : (u.grossMarginPct >= 50 ? 'var(--accent)' : 'var(--warn, #f59e0b)'),
                }}>
                  {u.revenueUsd === 0 ? '—' : fmtPct(u.grossMarginPct)}
                </Td>
                <Td align="right" style={{ fontFamily: 'var(--font-mono)' }}>{u.projectCount}</Td>
                <Td align="right" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{fmtDate(u.lastActivityTs)}</Td>
                <Td align="right" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{fmtDate(u.createdAt)}</Td>
                <Td>
                  <button onClick={e => { e.stopPropagation(); onSelect(u.id) }} style={{
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--text-3)', borderRadius: 6, fontSize: 11, padding: '4px 8px',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>Open</button>
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><Td colSpan={12} style={{ color: 'var(--text-4)', textAlign: 'center', padding: 32 }}>
                No users match these filters.
              </Td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PlanPill({ plan, label }) {
  const colors = {
    free:     { bg: 'rgba(148,163,184,0.12)', fg: 'var(--text-3)' },
    solo:     { bg: 'rgba(132,204,22,0.12)', fg: 'var(--accent)' },
    operator: { bg: 'rgba(99,102,241,0.14)', fg: '#a5b4fc' },
    studio:   { bg: 'rgba(236,72,153,0.14)', fg: '#f9a8d4' },
    scale:    { bg: 'rgba(234,179,8,0.14)',  fg: '#fbbf24' },
  }[plan] || { bg: 'rgba(148,163,184,0.12)', fg: 'var(--text-3)' }
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 4,
      background: colors.bg, color: colors.fg,
      fontWeight: 500, letterSpacing: '0.02em',
    }}>{label || plan}</span>
  )
}

// ── User detail (slide-in panel) ────────────────────────────────────────────
function UserDetail({ userId, user, onClose, onChanged }) {
  const [ledger, setLedger] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [grantAmt, setGrantAmt] = useState('')
  const [grantReason, setGrantReason] = useState('')
  const [granting, setGranting] = useState(false)
  const [planChange, setPlanChange] = useState(user?.plan || 'free')
  const [planSaving, setPlanSaving] = useState(false)
  const [toast, setToast] = useState(null)

  const fetchLedger = useCallback(async () => {
    setLoading(true)
    try {
      const r = await authedFetch(`/api/admin/users/${userId}/ledger?limit=200`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setLedger(j.entries)
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [userId])

  useEffect(() => { fetchLedger() }, [fetchLedger])
  useEffect(() => { setPlanChange(user?.plan || 'free') }, [user?.plan])

  // ESC closes
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function grant(amount) {
    if (!amount) return
    setGranting(true)
    setToast(null)
    try {
      const r = await authedFetch(`/api/admin/users/${userId}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credits: Number(amount), reason: grantReason || 'manual' }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setToast({ kind: 'ok', text: `${amount > 0 ? '+' : ''}${amount} credits → balance ${j.newBalance}` })
      setGrantAmt('')
      setGrantReason('')
      onChanged()       // refresh top-level data
      fetchLedger()     // refresh ledger
    } catch (e) {
      setToast({ kind: 'err', text: e.message })
    } finally {
      setGranting(false)
    }
  }

  async function changePlan() {
    if (planChange === user?.plan) return
    if (!confirm(`Change ${user.email} from ${user.plan} → ${planChange}?\n\nThis updates the plan key only — credits stay at the current balance. Use Grant Credits to add more if needed.`)) return
    setPlanSaving(true)
    setToast(null)
    try {
      const r = await authedFetch(`/api/admin/users/${userId}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planChange }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setToast({ kind: 'ok', text: `Plan changed to ${planChange}` })
      onChanged()
      fetchLedger()
    } catch (e) {
      setToast({ kind: 'err', text: e.message })
    } finally {
      setPlanSaving(false)
    }
  }

  if (!user) return null

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40,
      }} />
      {/* Panel */}
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(560px, 100vw)',
        background: 'var(--bg)', borderLeft: '1px solid var(--border)',
        zIndex: 50, overflowY: 'auto', boxShadow: '-12px 0 40px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{user.email}</div>
            <div style={{ fontSize: 11, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>{user.id}</div>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--text-3)',
            fontSize: 18, cursor: 'pointer',
          }}>✕</button>
        </div>

        <div style={{ padding: 20, display: 'grid', gap: 18 }}>
          {toast && (
            <div style={{
              padding: '8px 12px', borderRadius: 6, fontSize: 12.5,
              background: toast.kind === 'ok' ? 'rgba(132,204,22,0.1)' : 'rgba(248,113,113,0.1)',
              color: toast.kind === 'ok' ? 'var(--accent)' : 'var(--danger)',
              border: `1px solid ${toast.kind === 'ok' ? 'rgba(132,204,22,0.3)' : 'rgba(248,113,113,0.3)'}`,
            }}>{toast.text}</div>
          )}

          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Stat label="Plan" value={<PlanPill plan={user.plan} label={user.planLabel} />} />
            <Stat label="Credits left" value={fmtInt(user.creditsRemaining)} />
            <Stat label="Used MTD" value={fmtInt(user.creditsConsumed)} />
            <Stat label="Utilization" value={fmtPct(user.utilizationPct)} />
            <Stat label="Revenue" value={fmtUsd(user.revenueUsd)} />
            <Stat label="COGS" value={fmtUsd4(user.cogsActualUsd)} />
            <Stat label="Margin" value={user.revenueUsd === 0 ? '—' : fmtPct(user.grossMarginPct)} />
            <Stat label="Calls MTD" value={fmtInt(user.callsThisMonth)} />
            <Stat label="Projects" value={`${user.projectCount} / ${user.projectLimit}`} />
            <Stat label="Joined" value={fmtDate(user.createdAt)} />
            <Stat label="Last active" value={fmtDate(user.lastActivityTs)} />
            <Stat label="Stripe id" value={
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                {user.stripeCustomerId ? user.stripeCustomerId.slice(0, 16) + '…' : '—'}
              </span>
            } />
          </div>

          {/* Grant credits */}
          <Section title="Grant or revoke credits" subtitle="Positive = grant. Negative = revoke. Logged with your email + reason.">
            <div style={{ display: 'grid', gap: 8 }}>
              <input
                placeholder="Amount (e.g. 100 or -50)"
                type="number"
                value={grantAmt}
                onChange={e => setGrantAmt(e.target.value)}
                style={inputStyle}
              />
              <input
                placeholder="Reason (e.g. support credit, refund, demo)"
                value={grantReason}
                onChange={e => setGrantReason(e.target.value)}
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[10, 50, 100, 500, 1000].map(n => (
                  <button key={n} onClick={() => grant(n)} disabled={granting} style={chipBtnStyle}>+{n}</button>
                ))}
                <button onClick={() => grant(Number(grantAmt))} disabled={granting || !grantAmt}
                  style={{ ...chipBtnStyle, background: 'var(--accent)', color: 'var(--accent-on)', borderColor: 'var(--accent)' }}>
                  {granting ? 'Working…' : 'Apply'}
                </button>
              </div>
            </div>
          </Section>

          {/* Change plan */}
          <Section title="Change plan" subtitle="Updates the plan key. Credit balance is unchanged — adjust separately if needed.">
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={planChange} onChange={e => setPlanChange(e.target.value)} style={{ ...selStyle, flex: 1 }}>
                {['free', 'solo', 'operator', 'studio', 'scale'].map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <Btn variant="primary" size="sm"
                onClick={changePlan}
                disabled={planSaving || planChange === user.plan}>
                {planSaving ? 'Saving…' : 'Apply'}
              </Btn>
            </div>
          </Section>

          {/* Action breakdown for this user MTD */}
          {user.byAction && Object.keys(user.byAction).length > 0 && (
            <Section title="Activity by action (MTD)">
              <div style={{ display: 'grid', gap: 4 }}>
                {Object.entries(user.byAction).sort((a, b) => b[1].cogs - a[1].cogs).map(([action, v]) => (
                  <div key={action} style={{
                    display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 12,
                    padding: '6px 0', borderBottom: '1px solid var(--border)',
                    fontSize: 12, fontFamily: 'var(--font-mono)',
                  }}>
                    <span style={{ color: 'var(--text)' }}>{action}</span>
                    <span style={{ color: 'var(--text-3)' }}>{v.calls} calls</span>
                    <span style={{ color: 'var(--text-3)' }}>{v.credits} cr</span>
                    <span style={{ color: 'var(--text)', minWidth: 70, textAlign: 'right' }}>{fmtUsd4(v.cogs)}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Projects */}
          {user.projects && user.projects.length > 0 && (
            <Section title={`Projects (${user.projectCount})`}>
              <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
                {user.projects.map(p => (
                  <div key={p.id} style={{
                    display: 'flex', justifyContent: 'space-between', padding: '4px 0',
                    borderBottom: '1px solid var(--border)',
                  }}>
                    <span style={{ color: 'var(--text)' }}>{p.name}</span>
                    <span style={{ color: 'var(--text-4)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {fmtDate(p.updatedAt)}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Ledger */}
          <Section title="Credit ledger" subtitle={loading ? 'Loading…' : `${ledger?.length || 0} entries`}>
            {err && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</div>}
            {ledger && (
              <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg)' }}>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <Th>When</Th>
                      <Th>Action</Th>
                      <Th align="right">Credits</Th>
                      <Th align="right">$ COGS</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map(e => (
                      <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <Td><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>{fmtDate(e.ts)}</span></Td>
                        <Td><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{e.action}</span></Td>
                        <Td align="right" style={{ fontFamily: 'var(--font-mono)', color: e.credits_used < 0 ? 'var(--accent)' : 'var(--text)' }}>
                          {e.credits_used > 0 ? '−' : e.credits_used < 0 ? '+' : ''}{Math.abs(e.credits_used)}
                        </Td>
                        <Td align="right" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                          {e.real_cost_usd ? fmtUsd4(e.real_cost_usd) : '—'}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      </aside>
    </>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '8px 10px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{value}</div>
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', letterSpacing: '0.02em' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

const inputStyle = {
  padding: '8px 10px', background: 'var(--surface)',
  border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', fontSize: 13, fontFamily: 'inherit',
  width: '100%',
}
const chipBtnStyle = {
  padding: '6px 12px', background: 'var(--surface)',
  border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', fontSize: 12, cursor: 'pointer',
  fontFamily: 'inherit',
}

// Project list dashboard — landing surface after login.
// Grid of brand cards + "+ New brand" tile. Click → switches into workspace.
// Per design brief 5.4: lime hover glow, subtle metadata, tight density.

import React, { useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { useProjects } from '../lib/ProjectsContext.jsx'
import { useMe } from '../lib/MeContext.jsx'
import { Btn, Card } from './ui/index.jsx'
import OnboardingWizard from './OnboardingWizard.jsx'

export default function ProjectList() {
  const { user, signOut } = useAuth()
  const { me, setOutOfCreditsModal } = useMe()
  const { projects, loading, error, deleteProject, switchTo } = useProjects()
  const [wizardOpen, setWizardOpen] = useState(false)

  function openWizard() {
    // If user is at project limit, surface the upgrade modal instead.
    if (me?.projects && me.projects.count >= me.projects.limit) {
      setOutOfCreditsModal({
        code: 'PROJECT_LIMIT_REACHED',
        currentCount: me.projects.count,
        limit: me.projects.limit,
        planLabel: me.plan?.label,
      })
      return
    }
    setWizardOpen(true)
  }

  async function onDelete(p) {
    if (!confirm(`Delete "${p.name}"? All docs, angles, and ads in this project will be removed.`)) return
    try { await deleteProject(p.id) } catch (e) { alert(`Delete failed: ${e.message}`) }
  }

  const fmtDate = (d) => {
    if (!d) return '—'
    const ms = Date.now() - new Date(d).getTime()
    const days = Math.floor(ms / 86400000)
    if (days === 0) return 'today'
    if (days === 1) return 'yesterday'
    if (days < 30) return `${days}d ago`
    if (days < 365) return `${Math.floor(days / 30)}mo ago`
    return `${Math.floor(days / 365)}y ago`
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 32px', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'var(--accent)', color: 'var(--accent-on)',
            display: 'grid', placeItems: 'center',
            fontWeight: 800, fontSize: 16, letterSpacing: '-0.04em',
          }}>U</div>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em' }}>Ultemir</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {me?.isAdmin && (
            <a href="#/admin" style={{
              fontSize: 12.5, color: 'var(--accent)', textDecoration: 'none',
              padding: '4px 10px', border: '1px solid var(--accent)', borderRadius: 6,
              fontWeight: 500,
            }}>Admin</a>
          )}
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{user?.email}</span>
          <Btn variant="soft" size="sm" onClick={signOut}>Log out</Btn>
        </div>
      </header>

      {/* Body */}
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px 80px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em' }}>
              Your brands
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-3)', marginTop: 4 }}>
              Each brand is its own project. Docs, angles, and ads stay scoped.
            </p>
          </div>
          <span style={{ fontSize: 12.5, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
            {me?.projects ? `${me.projects.count} / ${me.projects.limit}` : `${projects.length}`} {(me?.projects?.limit ?? projects.length) === 1 ? 'brand' : 'brands'}
            {me?.plan?.label ? ` · ${me.plan.label}` : ''}
          </span>
        </div>

        {error && (
          <div style={{
            marginBottom: 20, padding: '10px 14px',
            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)',
            borderRadius: 8, fontSize: 13, color: 'var(--danger)',
          }}>{error}</div>
        )}

        {loading ? (
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 12,
            color: 'var(--text-4)', letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>Loading…</div>
        ) : (
          <div style={{
            display: 'grid', gap: 16,
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          }}>
            {projects.map(p => (
              <ProjectCard
                key={p.id}
                project={p}
                fmtDate={fmtDate}
                onOpen={() => switchTo(p.id)}
                onDelete={() => onDelete(p)}
              />
            ))}

            {/* New brand tile — opens the onboarding wizard */}
            {(() => {
              const atLimit = me?.projects && me.projects.count >= me.projects.limit
              return (
                <button
                  onClick={openWizard}
                  style={{
                    background: 'transparent',
                    border: '1px dashed var(--border-strong)',
                    borderRadius: 12,
                    padding: 18, minHeight: 132,
                    color: atLimit ? 'var(--text-4)' : 'var(--text-3)',
                    fontSize: 14, fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
                    transition: 'all 160ms ease',
                    fontFamily: 'inherit',
                    opacity: atLimit ? 0.6 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (atLimit) {
                      e.currentTarget.style.borderColor = 'var(--warn)'
                      e.currentTarget.style.color = 'var(--warn)'
                    } else {
                      e.currentTarget.style.borderColor = 'var(--accent)'
                      e.currentTarget.style.color = 'var(--accent)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-strong)'
                    e.currentTarget.style.color = atLimit ? 'var(--text-4)' : 'var(--text-3)'
                  }}
                >
                  <span style={{ fontSize: 22, fontWeight: 300, lineHeight: 1 }}>{atLimit ? '⤴' : '+'}</span>
                  <span>{atLimit ? 'Upgrade for more brands' : 'New brand'}</span>
                </button>
              )
            })()}
          </div>
        )}

        {!loading && projects.length === 0 && (
          <div style={{ marginTop: 32, padding: 32, textAlign: 'center' }}>
            <p style={{ color: 'var(--text-3)', fontSize: 14, marginBottom: 16 }}>
              No brands yet. We'll set up your first one in 5 quick steps.
            </p>
            <Btn variant="primary" size="md" onClick={openWizard}>
              Create your first brand →
            </Btn>
          </div>
        )}
      </main>

      {wizardOpen && (
        <OnboardingWizard
          onClose={() => setWizardOpen(false)}
          onComplete={(projectId) => {
            setWizardOpen(false)
            switchTo(projectId)
          }}
        />
      )}
    </div>
  )
}

function ProjectCard({ project: p, fmtDate, onOpen, onDelete }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 18,
        minHeight: 132,
        cursor: 'pointer',
        transition: 'border-color 160ms ease',
        borderColor: hover ? 'color-mix(in oklab, var(--accent) 50%, var(--border))' : 'var(--border)',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}
      onClick={onOpen}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: 'var(--accent-dim)',
            color: 'var(--accent)',
            display: 'grid', placeItems: 'center',
            fontWeight: 700, fontSize: 13, letterSpacing: '-0.02em',
            border: '1px solid var(--accent-dim-strong)',
          }}>{p.name.slice(0, 1).toUpperCase()}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
            {p.name}
          </div>
        </div>
        {p.brand_name && p.brand_name !== p.name && (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{p.brand_name}</div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-4)' }}>
          {fmtDate(p.updated_at)}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          style={{
            background: 'transparent', border: 'none', padding: 4,
            color: 'var(--text-4)', cursor: 'pointer', fontSize: 13,
            opacity: hover ? 1 : 0, transition: 'opacity 160ms',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-4)' }}
          title="Delete project"
        >✕</button>
      </div>
    </div>
  )
}

// Workspace: the existing single-page app, scoped to currentProject.
// Each project has its own isolated session — we use `currentProject.id`
// as the sessionId for every API call. Switching projects fully remounts
// `<App />` (via the React `key` prop) so all in-memory state resets to
// the new project's data.
//
// Tab switcher across the top: "Ad Studio" (the existing flow) vs
// "Rip Concept" (a separate surface that takes a source ad and adapts it
// to this brand). Tab state lives in the URL hash so the active tab is
// shareable / refresh-stable: `#/p/<id>` → studio, `#/p/<id>/rip` → rip.

import React, { useEffect, useState } from 'react'
import App from '../App.jsx'
import RipPage from './RipPage.jsx'
import { useProjects } from '../lib/ProjectsContext.jsx'

function readTab() {
  return /^#\/p\/[^/]+\/rip\b/i.test(window.location.hash || '') ? 'rip' : 'studio'
}

export default function Workspace() {
  const { currentProject, switchTo } = useProjects()
  const [tab, setTab] = useState(readTab())

  useEffect(() => {
    const onHash = () => setTab(readTab())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (!currentProject) return null  // Router handles the no-project case

  function goTab(next) {
    if (next === tab) return
    window.location.hash = next === 'rip' ? `#/p/${currentProject.id}/rip` : `#/p/${currentProject.id}`
  }

  return (
    <div>
      {/* Project bar with tabs */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 24px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        fontSize: 12.5,
      }}>
        <button
          onClick={() => switchTo(null)}
          style={{
            background: 'transparent', border: 'none', padding: '4px 8px',
            color: 'var(--text-3)', fontSize: 12.5, cursor: 'pointer',
            fontFamily: 'inherit', borderRadius: 4,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
        >← All brands</button>
        <span style={{ color: 'var(--text-4)' }}>/</span>
        <span style={{ color: 'var(--text)', fontWeight: 500 }}>{currentProject.name}</span>

        {/* Tabs */}
        <div style={{ marginLeft: 18, display: 'flex', gap: 2 }}>
          <TabBtn active={tab === 'studio'} onClick={() => goTab('studio')}>Ad Studio</TabBtn>
          <TabBtn active={tab === 'rip'} onClick={() => goTab('rip')}>
            <span style={{ marginRight: 4 }}>✨</span>Rip Concept
          </TabBtn>
        </div>
      </div>

      {/* Tab content. `key` forces a full remount when the user switches
          projects so all in-flight state resets per-project. */}
      {tab === 'rip' ? (
        <RipPage key={currentProject.id + ':rip'} sessionId={currentProject.id} />
      ) : (
        <App key={currentProject.id} sessionId={currentProject.id} />
      )}
    </div>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: 'transparent',
      border: 'none',
      borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
      padding: '8px 12px',
      color: active ? 'var(--text)' : 'var(--text-3)',
      fontWeight: active ? 600 : 500,
      fontSize: 13,
      cursor: 'pointer',
      fontFamily: 'inherit',
      transition: 'color 120ms',
      marginBottom: -8,  // align with parent border-bottom
    }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--text)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-3)' }}
    >{children}</button>
  )
}

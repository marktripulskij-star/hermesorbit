// Tiny hash-based router: ProjectList vs Workspace, driven by ProjectsContext.
// Special hash #/admin renders the admin page (gated by me.isAdmin in-page).

import React, { useEffect, useState } from 'react'
import { useProjects } from '../lib/ProjectsContext.jsx'
import ProjectList from './ProjectList.jsx'
import Workspace from './Workspace.jsx'
import AdminPage from './AdminPage.jsx'

function readAdminHash() {
  return /^#\/admin\b/i.test(window.location.hash || '')
}

export default function Router() {
  const { currentProjectId, currentProject, loading, projects } = useProjects()
  const [isAdminHash, setIsAdminHash] = useState(readAdminHash())

  useEffect(() => {
    const onHash = () => setIsAdminHash(readAdminHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (isAdminHash) return <AdminPage />

  // While the projects list is still loading, render a minimal splash so we
  // don't flash the empty list and then immediately bounce into a workspace.
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'grid', placeItems: 'center',
        background: 'var(--bg)',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 12,
          color: 'var(--text-4)', letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>Loading…</div>
      </div>
    )
  }

  // Hash points at a project and we own it → workspace.
  if (currentProjectId && currentProject) return <Workspace />

  // Hash points at a project we don't own → ProjectsContext bounces to '#/'.
  // In that brief flicker, render the list.
  return <ProjectList />
}

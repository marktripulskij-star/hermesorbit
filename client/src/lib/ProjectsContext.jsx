// Projects context — list, create, switch, rename, delete.
//
// Routing convention (hash-based):
//   #/                → ProjectList (currentProjectId = null)
//   #/p/<projectId>   → Workspace  (currentProjectId set)
//
// We chose hash routing over react-router because we only have two surfaces.
// If we ever grow past that, swap this for a real router and ProjectsContext
// stays the same.

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { authedFetch } from './supabase.js'
import { useAuth } from './AuthContext.jsx'
import { useMe } from './MeContext.jsx'

const ProjectsContext = createContext(null)

function readHash() {
  const m = (window.location.hash || '').match(/^#\/p\/([0-9a-f-]{8,})/i)
  return m ? m[1] : null
}

export function ProjectsProvider({ children }) {
  const { session } = useAuth()
  const { refresh: refreshMe, checkPaymentRequired } = useMe()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [currentProjectId, setCurrentProjectId] = useState(readHash())
  const [error, setError] = useState(null)

  // Sync currentProjectId with the URL hash both ways.
  useEffect(() => {
    const onHash = () => setCurrentProjectId(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const refresh = useCallback(async () => {
    if (!session) { setProjects([]); setLoading(false); return }
    setError(null)
    try {
      const r = await authedFetch('/api/projects')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setProjects(j.projects || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { refresh() }, [refresh])

  // Validate currentProjectId against the loaded list — drop if user no
  // longer owns it (e.g. they pasted a stale URL or deleted the project).
  useEffect(() => {
    if (!currentProjectId) return
    if (loading) return
    if (projects.find(p => p.id === currentProjectId)) return
    // Not found → bounce to list.
    window.location.hash = '#/'
  }, [currentProjectId, projects, loading])

  async function createProject(name) {
    setError(null)
    const r = await authedFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    // 402 = project limit reached — opens the OutOfCreditsModal automatically.
    if (await checkPaymentRequired(r)) {
      throw new Error('Project limit reached')
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      const msg = j.error || `HTTP ${r.status}`
      setError(msg)
      throw new Error(msg)
    }
    const { project } = await r.json()
    setProjects(prev => [project, ...prev])
    refreshMe()  // sync project count + limit display
    return project
  }


  async function renameProject(id, name) {
    const r = await authedFetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const { project } = await r.json()
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...project } : p))
    return project
  }

  async function deleteProject(id) {
    const r = await authedFetch(`/api/projects/${id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    setProjects(prev => prev.filter(p => p.id !== id))
    if (currentProjectId === id) window.location.hash = '#/'
    refreshMe()  // free up a project slot in the count
  }

  function switchTo(id) {
    window.location.hash = id ? `#/p/${id}` : '#/'
  }

  const currentProject = projects.find(p => p.id === currentProjectId) || null

  const value = {
    projects, loading, error,
    currentProjectId, currentProject,
    refresh, createProject, renameProject, deleteProject, switchTo,
  }
  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>
}

export function useProjects() {
  const ctx = useContext(ProjectsContext)
  if (!ctx) throw new Error('useProjects must be used inside <ProjectsProvider>')
  return ctx
}

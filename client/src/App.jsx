import React, { useState, useEffect, useRef, Component } from 'react'
import DocumentPanel from './components/DocumentPanel.jsx'
import BrandPanel from './components/BrandPanel.jsx'
import BriefCard from './components/BriefCard.jsx'
import AngleGrid from './components/AngleGrid.jsx'
import AdBuilder from './components/AdBuilder.jsx'
import { useAuth } from './lib/AuthContext.jsx'
import { useMe } from './lib/MeContext.jsx'
import { authedFetch } from './lib/supabase.js'
import { parallelLimit } from './lib/concurrency.js'
import CreditPill from './components/CreditPill.jsx'
import './App.css'

function UserMenu() {
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])
  if (!user) return null
  const initial = (user.email || '?').slice(0, 1).toUpperCase()
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={user.email}
        style={{
          width: 30, height: 30, borderRadius: 999,
          background: 'var(--accent)', color: 'var(--accent-on)',
          border: '1px solid var(--accent-2)',
          fontWeight: 700, fontSize: 13, cursor: 'pointer',
          display: 'grid', placeItems: 'center',
        }}
      >{initial}</button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 38, zIndex: 50,
          minWidth: 220,
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          borderRadius: 10, padding: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ padding: '6px 8px 10px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              Signed in as
            </div>
            <div style={{ fontSize: 13, color: 'var(--text)', wordBreak: 'break-all' }}>{user.email}</div>
          </div>
          <button
            onClick={() => { setOpen(false); signOut() }}
            style={{
              marginTop: 6, width: '100%', textAlign: 'left',
              padding: '8px 10px', borderRadius: 6,
              background: 'transparent', color: 'var(--text-2)',
              border: '1px solid transparent', fontSize: 13, cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.color = 'var(--danger)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-2)' }}
          >Log out</button>
        </div>
      )}
    </div>
  )
}

function UsagePill() {
  const [usage, setUsage] = useState(null)
  const [open, setOpen] = useState(false)
  const refresh = () => authedFetch('/api/usage').then(r => r.ok ? r.json() : null).then(setUsage).catch(() => {})

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 15000)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus) }
  }, [])

  const fmt = (n) => `$${(n || 0).toFixed(n < 0.1 ? 4 : 2)}`

  if (!usage) return null

  return (
    <div className="usage-pill-wrap">
      <button className="usage-pill" onClick={() => setOpen(o => !o)} title="Click for breakdown">
        💰 {fmt(usage.today.cost)} today
        <span className="usage-pill-sub">· {fmt(usage.total.cost)} total</span>
      </button>
      {open && (
        <div className="usage-popover">
          <div className="usage-popover-header">
            <strong>Estimated AI spend</strong>
            <button className="usage-close" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="usage-row"><span>Today</span><span>{fmt(usage.today.cost)} · {usage.today.calls} calls</span></div>
          <div className="usage-row"><span>Last 24h</span><span>{fmt(usage.last24h.cost)} · {usage.last24h.calls} calls</span></div>
          <div className="usage-row"><span>Lifetime</span><span>{fmt(usage.total.cost)} · {usage.total.calls} calls</span></div>

          <div className="usage-h">By model</div>
          {Object.entries(usage.byModel).length === 0 && <div className="usage-empty">No usage yet.</div>}
          {Object.entries(usage.byModel).map(([m, v]) => (
            <div key={m} className="usage-row">
              <span>{m}</span>
              <span>
                {fmt(v.cost)} ·{' '}
                {v.images > 0 ? `${v.images} img` : `${(v.input/1000).toFixed(1)}k in / ${(v.output/1000).toFixed(1)}k out`}
              </span>
            </div>
          ))}

          <div className="usage-h">By source</div>
          {Object.entries(usage.bySource).map(([s, v]) => (
            <div key={s} className="usage-row">
              <span>{s}</span><span>{fmt(v.cost)} · {v.calls}×</span>
            </div>
          ))}

          {usage.recent?.length > 0 && (
            <details className="usage-recent">
              <summary>Recent {usage.recent.length} calls</summary>
              {usage.recent.map((e, i) => (
                <div key={i} className="usage-recent-row">
                  <span className="usage-recent-time">{new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="usage-recent-source">{e.source}</span>
                  <span className="usage-recent-cost">{fmt(e.cost)}</span>
                </div>
              ))}
            </details>
          )}

          <div className="usage-footer">
            <button className="usage-reset" onClick={async () => {
              if (!confirm('Reset all usage tracking? This deletes the local ledger.')) return
              await authedFetch('/api/usage/reset', { method: 'POST' })
              refresh()
            }}>Reset ledger</button>
            <span className="usage-disclaimer">Estimates only. May differ from billing.</span>
          </div>
        </div>
      )}
    </div>
  )
}

class SectionBoundary extends Component {
  state = { error: null, info: null }
  static getDerivedStateFromError(e) { return { error: e } }
  componentDidCatch(e, info) {
    console.error('[SectionBoundary CAUGHT]:', e.message)
    console.error('[Stack]:', e.stack)
    console.error('[Component stack]:', info?.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', top: 60, left: 20, right: 20, zIndex: 99999,
          padding: 20, background: '#ff0066', border: '4px solid yellow', borderRadius: 10,
          color: 'white', fontSize: 14, fontFamily: 'monospace'
        }}>
          <strong>🚨 CAUGHT ERROR:</strong><br />
          {this.state.error.message}<br />
          <pre style={{ fontSize: 11, marginTop: 8, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
            {this.state.error.stack?.slice(0, 800)}
          </pre>
          <button style={{ marginTop: 8, cursor: 'pointer', padding: '4px 12px' }} onClick={() => this.setState({ error: null })}>Dismiss</button>
        </div>
      )
    }
    return this.props.children
  }
}

const SESSION_KEY = 'adgen_session_id'
const uniqueStrings = (values) => [...new Set((values || []).filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean))]
const mergeActiveOffers = (manualOffers, brandBrief) => uniqueStrings([
  ...(manualOffers || []),
  ...(brandBrief?.currentOffers || []),
])

// `propSessionId` (optional): supplied by Workspace as `currentProject.id`,
// making each project its own isolated workspace. When omitted, falls back
// to the legacy global localStorage session — used only when App is rendered
// outside of a project (development / standalone preview).
//
// To swap projects cleanly, the parent (Workspace) renders App with
// `key={currentProject.id}` so React fully remounts and resets all state.
export default function App({ sessionId: propSessionId }) {
  const usingProjectScope = !!propSessionId
  // Pulled in for credit refresh after each costing action + 402 handling.
  const { refresh: refreshMe, checkPaymentRequired, hasCreditsFor } = useMe()
  const [sessionId, setSessionId] = useState(() =>
    propSessionId || localStorage.getItem(SESSION_KEY) || null
  )
  const [documents, setDocuments] = useState([])
  const [brandColors, setBrandColors] = useState([])
  const [brandImages, setBrandImages] = useState([])
  const [selectedProductNames, setSelectedProductNames] = useState([])
  const [manualOffers, setManualOffers] = useState([])
  const [activeOffers, setActiveOffers] = useState([])
  const [selectedOfferNames, setSelectedOfferNames] = useState([])
  const [brandName, setBrandName] = useState('')
  const [brandBrief, setBrandBrief] = useState(null)
  const [angles, setAngles] = useState([])
  const [ads, setAds] = useState({})
  const [formats, setFormats] = useState([])

  const [generatingBrief, setGeneratingBrief] = useState(false)
  const [generatingAngles, setGeneratingAngles] = useState(false)
  const [error, setError] = useState(null)

  const [selectedAngles, setSelectedAngles] = useState(new Set())
  const [selectedFormats, setSelectedFormats] = useState({}) // { angleId: formatId }

  // Per-angle generation stage for the batch flow:
  //   undefined | 'generating-copy' | 'generating-image' | 'done' | 'error'
  const [adStages, setAdStages] = useState({})
  const [adErrors, setAdErrors] = useState({})  // { angleId: string }
  const [expandedAngles, setExpandedAngles] = useState(new Set())  // angleIds w/ AdBuilder open
  const [batchGenerating, setBatchGenerating] = useState(false)

  // Per-angle image settings used by the batch flow. Defaults to square /
  // medium for every angle. Per-angle so user can tweak some without
  // tweaking all (e.g. high-quality the BOFU offer ads, low-quality drafts
  // for TOFU concepts). Inside the AdBuilder there's a separate per-ad
  // quality/size selector for fine control after generation.
  const [imageSettings, setImageSettings] = useState({})  // { angleId: { size, quality } }
  const setImageSetting = (angleId, key, value) => {
    setImageSettings(prev => ({
      ...prev,
      [angleId]: { ...(prev[angleId] || { size: '1024x1024', quality: 'medium' }), [key]: value },
    }))
  }
  const getImageSetting = (angleId) => imageSettings[angleId] || { size: '1024x1024', quality: 'medium' }

  // When angles arrive (or reload), pre-fill selectedFormats with each angle's
  // top suggestedFormatIds[0] — but never overwrite a user's manual pick.
  useEffect(() => {
    if (!angles.length) return
    setSelectedFormats(prev => {
      const next = { ...prev }
      let changed = false
      for (const a of angles) {
        if (!next[a.id] && a.suggestedFormatIds?.length > 0) {
          next[a.id] = a.suggestedFormatIds[0]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [angles])

  // Sync adStages with already-generated ads on session hydrate, so cards
  // come back in the right state after a refresh. Distinguish between:
  //   - copy + image present  → 'done'
  //   - copy present, image missing or errored → 'error' (shows Retry)
  // so previously-failed ads don't get papered over as success on reload.
  useEffect(() => {
    if (!angles.length || !Object.keys(ads).length) return
    setAdStages(prev => {
      const next = { ...prev }
      const errs = { ...adErrors }
      let changed = false
      for (const a of angles) {
        if (next[a.id]) continue  // don't overwrite live state
        const fid = selectedFormats[a.id]
        if (!fid) continue
        const ad = ads[`${a.id}_${fid}`]
        if (!ad) continue
        if (ad.imageUrl && !ad.imageError) {
          next[a.id] = 'done'
          changed = true
        } else if (ad.imageError || !ad.imageUrl) {
          next[a.id] = 'error'
          if (!errs[a.id]) errs[a.id] = ad.imageError ? `Image: ${ad.imageError}` : 'Image: not generated'
          changed = true
        }
      }
      if (changed) setAdErrors(errs)
      return changed ? next : prev
    })
  }, [angles, ads, selectedFormats])

  const toggleExpand = (angleId) => {
    setExpandedAngles(prev => {
      const next = new Set(prev)
      if (next.has(angleId)) next.delete(angleId); else next.add(angleId)
      return next
    })
  }
  const [generatingCopy, setGeneratingCopy] = useState({}) // { adKey: bool }
  const [generatingImage, setGeneratingImage] = useState({}) // { adKey: bool }
  const [imageStatuses, setImageStatuses] = useState({}) // { adKey: string }

  // Load formats on mount
  useEffect(() => {
    authedFetch('/api/ad-formats').then(r => r.ok ? r.json() : []).then(setFormats).catch(() => {})
  }, [])

  // Restore session on mount
  useEffect(() => {
    if (!sessionId) return
    authedFetch(`/api/session/${sessionId}`)
      .then(r => r.json())
      .then(data => {
        setDocuments(data.documents || [])
        setBrandColors(data.brandColors || [])
        setBrandImages(data.brandImages || [])
        setSelectedProductNames(data.selectedProductNames || (data.selectedProductName ? [data.selectedProductName] : []))
        setManualOffers(data.manualOffers || [])
        setActiveOffers(data.activeOffers || mergeActiveOffers(data.manualOffers, data.brandBrief))
        setSelectedOfferNames(data.selectedOfferNames || [])
        setBrandName(data.brandName || '')
        setBrandBrief(data.brandBrief || null)
        setAngles(data.angles || [])
        setAds(data.ads || {})
      })
      .catch(() => {})
  }, [])

  const ensureSession = (sid) => {
    // In project scope the sessionId is fixed (= currentProject.id) and
    // gets created lazily by the first POST that hits the server. No
    // localStorage write, no state change needed.
    if (usingProjectScope) return
    if (!sessionId) {
      localStorage.setItem(SESSION_KEY, sid)
      setSessionId(sid)
    }
  }

  const handleDocumentsChange = (newDocs, sid) => {
    setDocuments(newDocs)
    if (sid) ensureSession(sid)
  }

  const generateBrief = async () => {
    setGeneratingBrief(true)
    setError(null)
    try {
      const res = await authedFetch('/api/brand-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      if (await checkPaymentRequired(res)) return
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setBrandBrief(data.brandBrief)
      setActiveOffers(mergeActiveOffers(manualOffers, data.brandBrief))
      refreshMe()
    } catch (e) { setError(e.message) }
    finally { setGeneratingBrief(false) }
  }

  const generateAngles = async () => {
    setGeneratingAngles(true)
    setError(null)
    setSelectedAngles(new Set())
    setSelectedFormats({})
    try {
      const res = await authedFetch('/api/generate-angles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      if (await checkPaymentRequired(res)) return
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAngles(data.angles)
      refreshMe()
    } catch (e) { setError(e.message) }
    finally { setGeneratingAngles(false) }
  }

  const toggleAngle = (id) => {
    setSelectedAngles(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAllAngles = () => setSelectedAngles(new Set(angles.map(a => a.id)))
  const clearAllAngles = () => setSelectedAngles(new Set())

  const setFormat = (angleId, formatId) => {
    setSelectedFormats(prev => ({ ...prev, [angleId]: formatId }))
  }

  const generateCopy = async (angleId, chosenHook = null) => {
    const formatId = selectedFormats[angleId]
    if (!formatId) return
    const adKey = `${angleId}_${formatId}`
    setGeneratingCopy(prev => ({ ...prev, [adKey]: true }))
    setError(null)
    try {
      const res = await authedFetch('/api/generate-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, angleId, formatId, chosenHook }),
      })
      if (await checkPaymentRequired(res)) return
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAds(prev => ({ ...prev, [adKey]: data.copy }))
      refreshMe()
    } catch (e) { setError(e.message) }
    finally { setGeneratingCopy(prev => ({ ...prev, [adKey]: false })) }
  }

  const generateImage = async (angleId, formatId, opts = {}) => {
    const adKey = `${angleId}_${formatId}`
    setGeneratingImage(prev => ({ ...prev, [adKey]: true }))
    setImageStatuses(prev => ({ ...prev, [adKey]: 'queued' }))
    setError(null)
    try {
      const res = await authedFetch('/api/generate-ad-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, adKey, size: opts.size, quality: opts.quality }),
      })
      if (await checkPaymentRequired(res)) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'status') {
              setImageStatuses(prev => ({ ...prev, [adKey]: event.status }))
            } else if (event.type === 'result') {
              setAds(prev => ({ ...prev, [adKey]: { ...prev[adKey], imageUrl: event.imageUrl, imageError: event.error } }))
            }
          } catch (_) {}
        }
      }
    } catch (e) { setError(e.message) }
    finally {
      setGeneratingImage(prev => ({ ...prev, [adKey]: false }))
      setImageStatuses(prev => ({ ...prev, [adKey]: null }))
      refreshMe()
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Batch generation: copy → image for one angle, end-to-end.
  // Used by runBatch() below. Tracks per-angle stage in adStages so the
  // angle card UI can show progress without polling globals.
  // ──────────────────────────────────────────────────────────────────
  const generateAdSequence = async (angleId, opts = {}) => {
    const formatId = selectedFormats[angleId]
    if (!formatId) {
      setAdErrors(prev => ({ ...prev, [angleId]: 'No format selected' }))
      setAdStages(prev => ({ ...prev, [angleId]: 'error' }))
      return
    }
    const adKey = `${angleId}_${formatId}`
    // Pull the angle's image settings (defaults applied by getImageSetting).
    // Caller can still override via opts if needed.
    const settings = getImageSetting(angleId)
    const size = opts.size || settings.size
    const quality = opts.quality || settings.quality
    setAdErrors(prev => ({ ...prev, [angleId]: null }))
    setAdStages(prev => ({ ...prev, [angleId]: 'generating-copy' }))

    // Step 1: copy
    try {
      const r = await authedFetch('/api/generate-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, angleId, formatId, chosenHook: null }),
      })
      if (await checkPaymentRequired(r)) {
        // 402 — out of credits / project limit. Stop the sequence with a clean error.
        setAdErrors(prev => ({ ...prev, [angleId]: 'Out of credits' }))
        setAdStages(prev => ({ ...prev, [angleId]: 'error' }))
        return
      }
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      setAds(prev => ({ ...prev, [adKey]: data.copy }))
      refreshMe()
    } catch (e) {
      setAdErrors(prev => ({ ...prev, [angleId]: `Copy: ${e.message}` }))
      setAdStages(prev => ({ ...prev, [angleId]: 'error' }))
      return
    }

    // Step 2: image (SSE — same shape as the existing generateImage)
    setAdStages(prev => ({ ...prev, [angleId]: 'generating-image' }))
    setImageStatuses(prev => ({ ...prev, [adKey]: 'queued' }))
    let imageResultError = null
    let imageResultUrl = null
    try {
      const res = await authedFetch('/api/generate-ad-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, adKey, size, quality }),
      })
      if (await checkPaymentRequired(res)) {
        setAdErrors(prev => ({ ...prev, [angleId]: 'Out of credits (image)' }))
        setAdStages(prev => ({ ...prev, [angleId]: 'error' }))
        setImageStatuses(prev => ({ ...prev, [adKey]: null }))
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'status') {
              setImageStatuses(prev => ({ ...prev, [adKey]: event.status }))
            } else if (event.type === 'result') {
              imageResultError = event.error || null
              imageResultUrl = event.imageUrl || null
              setAds(prev => ({ ...prev, [adKey]: { ...prev[adKey], imageUrl: event.imageUrl, imageError: event.error } }))
            }
          } catch (_) {}
        }
      }
    } catch (e) {
      setAdErrors(prev => ({ ...prev, [angleId]: `Image: ${e.message}` }))
      setAdStages(prev => ({ ...prev, [angleId]: 'error' }))
      setImageStatuses(prev => ({ ...prev, [adKey]: null }))
      return
    }
    setImageStatuses(prev => ({ ...prev, [adKey]: null }))
    if (imageResultError || !imageResultUrl) {
      setAdErrors(prev => ({ ...prev, [angleId]: `Image: ${imageResultError || 'no image returned'}` }))
      setAdStages(prev => ({ ...prev, [angleId]: 'error' }))
      refreshMe()
      return
    }
    setAdStages(prev => ({ ...prev, [angleId]: 'done' }))
    refreshMe()
  }

  // Run a batch of angle ids in parallel (concurrency 5).
  // Skips angles that are already done or in flight. Angles missing a format
  // pick get flagged as errors (not silently dropped) so the user sees a
  // Retry/error pill on the card instead of a card that looks ungenerated.
  const runBatch = async (angleIds) => {
    const targets = []
    const missingFormat = []
    for (const id of angleIds) {
      const stage = adStages[id]
      if (stage === 'done' || stage === 'generating-copy' || stage === 'generating-image') continue
      if (!selectedFormats[id]) {
        missingFormat.push(id)
        continue
      }
      targets.push(id)
    }
    if (missingFormat.length) {
      setAdErrors(prev => {
        const next = { ...prev }
        for (const id of missingFormat) next[id] = 'Pick a format first'
        return next
      })
      setAdStages(prev => {
        const next = { ...prev }
        for (const id of missingFormat) next[id] = 'error'
        return next
      })
    }
    if (!targets.length) return
    setBatchGenerating(true)
    setError(null)
    try {
      await parallelLimit(
        targets.map(angleId => () => generateAdSequence(angleId)),
        5,
      )
    } finally {
      setBatchGenerating(false)
    }
  }

  const selectedAngleList = angles.filter(a => selectedAngles.has(a.id))

  return (
    <div className="app-layout" translate="no" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false">
      <header className="app-header">
        <div className="header-title">
          <img className="logo" src="/hermes-logo.png" alt="" />
          <span>Hermes</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <CreditPill />
          <UserMenu />
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <strong>Error:</strong> {error}
          <button className="close-btn" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="app-body">
        <aside className="sidebar">
          <DocumentPanel
            sessionId={sessionId}
            documents={documents}
            onChange={handleDocumentsChange}
          />
          <div className="sidebar-divider" />
          <BrandPanel
            sessionId={sessionId}
            brandColors={brandColors}
            brandImages={brandImages}
            selectedProductNames={selectedProductNames}
            brandBrief={brandBrief}
            manualOffers={manualOffers}
            activeOffers={activeOffers}
            selectedOfferNames={selectedOfferNames}
            brandName={brandName}
            onChange={(colors, images, nextSelectedProductNames) => {
              setBrandColors(colors)
              setBrandImages(images)
              if (nextSelectedProductNames !== undefined) setSelectedProductNames(nextSelectedProductNames || [])
            }}
            onSelectedProductsChange={setSelectedProductNames}
            onOffersChange={({ manualOffers: nextManualOffers, activeOffers: nextActiveOffers, selectedOfferNames: nextSelectedOfferNames, brandBrief: nextBrandBrief }) => {
              if (nextManualOffers !== undefined) setManualOffers(nextManualOffers || [])
              if (nextActiveOffers !== undefined) setActiveOffers(nextActiveOffers || [])
              if (nextSelectedOfferNames !== undefined) setSelectedOfferNames(nextSelectedOfferNames || [])
              if (nextBrandBrief !== undefined) setBrandBrief(nextBrandBrief || null)
            }}
            onBrandNameChange={setBrandName}
            onSessionCreated={ensureSession}
          />
        </aside>

        <main className="main-content">

          {/* Step 1: Brand Brief */}
          <section className="flow-section">
            <div className="flow-section-header">
              <div className="flow-step-label">Step 1</div>
              <h2 className="flow-section-title">Brand Brief</h2>
              <p className="flow-section-sub">Extract the product, avatars, pains, and proof points from your documents.</p>
              <button
                className="btn-primary"
                onClick={generateBrief}
                disabled={generatingBrief || !documents.length}
              >
                {generatingBrief ? 'Extracting…' : brandBrief ? '↺ Re-extract Brief' : '⚡ Extract Brand Brief'}
              </button>
            </div>
            {brandBrief && (
              <BriefCard
                brief={brandBrief}
                sessionId={sessionId}
                onBriefUpdated={setBrandBrief}
              />
            )}
          </section>

          {/* Step 2: Angles */}
          {brandBrief && (
            <section className="flow-section">
              <div className="flow-section-header">
                <div className="flow-step-label">Step 2</div>
                <h2 className="flow-section-title">Discover Angles</h2>
                <p className="flow-section-sub">20 unique testing angles across TOFU, MOFU, and BOFU. Select the ones worth running.</p>
                <button
                  className="btn-primary"
                  onClick={generateAngles}
                  disabled={generatingAngles}
                >
                  {generatingAngles ? 'Generating 20 angles…' : angles.length ? '↺ Regenerate Angles' : '⚡ Discover Angles'}
                </button>
              </div>
              {angles.length > 0 && (
                <SectionBoundary>
                  <AngleGrid
                    angles={angles}
                    formats={formats}
                    selected={selectedAngles}
                    onToggle={toggleAngle}
                    onSelectAll={selectAllAngles}
                    onClearAll={clearAllAngles}
                    selectedFormats={selectedFormats}
                    onFormatChange={setFormat}
                    imageSettings={imageSettings}
                    onImageSettingChange={setImageSetting}
                    ads={ads}
                    adStages={adStages}
                    adErrors={adErrors}
                    batchGenerating={batchGenerating}
                    onRunBatch={runBatch}
                    expandedAngles={expandedAngles}
                    onToggleExpand={toggleExpand}
                    sessionId={sessionId}
                    generatingCopy={generatingCopy}
                    generatingImage={generatingImage}
                    imageStatuses={imageStatuses}
                    onGenerateCopy={generateCopy}
                    onGenerateImage={generateImage}
                    onAdUpdate={(k, patch) => setAds(prev => ({ ...prev, [k]: { ...(prev[k] || {}), ...patch } }))}
                    brandName={brandName}
                    onClearAllAds={async () => {
                      const res = await authedFetch(`/api/ads/${sessionId}`, { method: 'DELETE' })
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}))
                        throw new Error(err.error || `Clear failed (${res.status})`)
                      }
                      // Wipe all ad-related local state so the grid resets cleanly
                      setAds({})
                      setAdStages({})
                      setAdErrors({})
                      setExpandedAngles(new Set())
                    }}
                  />
                </SectionBoundary>
              )}
            </section>
          )}

          {/* Empty state */}
          {!brandBrief && !generatingBrief && (
            <div className="empty-state">
              <div className="empty-icon">✦</div>
              <p>Upload your brand documents, then extract a brand brief to get started.</p>
            </div>
          )}

        </main>
      </div>
    </div>
  )
}

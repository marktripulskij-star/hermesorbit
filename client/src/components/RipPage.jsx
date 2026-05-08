// Rip Concept page — separate workspace section.
//
// Flow:
//   1. User uploads a source ad image + pastes its copy (headline/description/
//      CTA optional). One "Rip this ad" button.
//   2. Server streams SSE through 5 stages: analyzing → adapting → critiquing
//      → art-directing → image gen.
//   3. As each stage completes, the right side reveals: concept analysis,
//      then generated copy with scores, then the final image.
//
// The result is a complete, durably-saved ad in `session.ads[adKey]` with
// `source: 'rip'` and the original analysis preserved in `sourceMeta`.

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { getAccessToken } from '../lib/supabase.js'
import { useMe } from '../lib/MeContext.jsx'
import { Btn } from './ui/index.jsx'

// Single-column under this width (narrow laptops, tablets, phones).
const NARROW_PX = 980

const QUALITIES = [
  { value: 'low',    label: 'Low · 1 cr' },
  { value: 'medium', label: 'Medium · 3 cr' },
  { value: 'high',   label: 'High · 8 cr' },
]
const QUALITY_COST = { low: 1, medium: 3, high: 8 }
const RIP_BASE_COST = 5

const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']

function resolveApiUrl(input) {
  const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
  if (!base) return input
  if (/^https?:\/\//i.test(input)) return input
  if (input.startsWith('/api/')) return base + input
  return input
}

export default function RipPage({ sessionId }) {
  const { refresh: refreshMe, checkPaymentRequired } = useMe()

  // Form state
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [primaryText, setPrimaryText] = useState('')
  const [headline, setHeadline] = useState('')
  const [description, setDescription] = useState('')
  const [ctaButton, setCtaButton] = useState('')
  const [quality, setQuality] = useState('medium')

  // Run state
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState(null)        // current stage label
  const [stageHistory, setStageHistory] = useState([]) // [{ stage, label, ts }]
  const [analysis, setAnalysis] = useState(null)
  const [generatedAd, setGeneratedAd] = useState(null) // { headline, primaryText, ... }
  const [generatedImageUrl, setGeneratedImageUrl] = useState(null)
  const [imageError, setImageError] = useState(null)
  const [imageProvider, setImageProvider] = useState(null)
  const [error, setError] = useState(null)
  const [imageStatus, setImageStatus] = useState(null) // last "status" event (queued, in_progress…)
  const [streamReachedImage, setStreamReachedImage] = useState(false) // got an 'image' event of any shape
  const [streamCompleted, setStreamCompleted] = useState(false)       // got 'done' event

  // Narrow layout detection — single-column when too cramped for two columns.
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' && window.innerWidth < NARROW_PX)
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW_PX)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const fileInputRef = useRef(null)

  function reset() {
    setStage(null); setStageHistory([])
    setAnalysis(null); setGeneratedAd(null); setGeneratedImageUrl(null)
    setImageError(null); setImageProvider(null); setError(null); setImageStatus(null)
    setStreamReachedImage(false); setStreamCompleted(false)
  }

  function handleFile(file) {
    if (!file) return
    if (!ALLOWED_MIMES.includes(file.type)) {
      setError(`Unsupported format: ${file.type}. Use PNG, JPEG, or WebP.`)
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('Image is over 20 MB.')
      return
    }
    setError(null)
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (e) => setImagePreview(e.target.result)
    reader.readAsDataURL(file)
  }

  const onDrop = useCallback((e) => {
    e.preventDefault()
    e.currentTarget.style.borderColor = 'var(--border-strong)'
    handleFile(e.dataTransfer.files?.[0])
  }, [])
  const onDragOver = (e) => {
    e.preventDefault()
    e.currentTarget.style.borderColor = 'var(--accent)'
  }
  const onDragLeave = (e) => {
    e.preventDefault()
    e.currentTarget.style.borderColor = 'var(--border-strong)'
  }

  const totalCost = RIP_BASE_COST + (QUALITY_COST[quality] || 3)
  const canRun = imageFile && !running

  async function ripIt() {
    if (!canRun) return
    reset()
    setRunning(true)
    try {
      const token = await getAccessToken()
      const fd = new FormData()
      fd.append('image', imageFile)
      fd.append('sessionId', sessionId)
      if (primaryText.trim()) fd.append('primaryText', primaryText.trim())
      if (headline.trim())    fd.append('headline', headline.trim())
      if (description.trim()) fd.append('description', description.trim())
      if (ctaButton.trim())   fd.append('ctaButton', ctaButton.trim())
      fd.append('quality', quality)
      fd.append('size', '1024x1024')

      const res = await fetch(resolveApiUrl('/api/rip-ad'), {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })

      if (res.status === 402) {
        const body = await res.json().catch(() => ({}))
        if (await checkPaymentRequired(res)) return
        throw new Error(body.error || 'Out of credits')
      }
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `HTTP ${res.status}`)
      }

      // Stream SSE
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
          let event
          try { event = JSON.parse(line.slice(6)) } catch { continue }
          handleEvent(event)
        }
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setRunning(false)
      setStage(null)
      refreshMe()
    }
  }

  function handleEvent(event) {
    // Log every SSE event for debugging — visible in browser console
    if (typeof window !== 'undefined' && window.console) console.log('[rip-ad SSE]', event)
    if (event.type === 'stage') {
      setStage(event.label)
      setStageHistory(h => [...h, { stage: event.stage, label: event.label, ts: Date.now() }])
    } else if (event.type === 'analysis') {
      setAnalysis(event.analysis)
    } else if (event.type === 'copy') {
      setGeneratedAd(event.copy)
    } else if (event.type === 'status') {
      setImageStatus(event.status)
    } else if (event.type === 'image') {
      setStreamReachedImage(true)
      if (event.error) setImageError(event.error)
      else {
        setGeneratedImageUrl(event.imageUrl)
        if (event.providerUsed) setImageProvider(event.providerUsed)
      }
    } else if (event.type === 'error') {
      setError(event.error)
    } else if (event.type === 'done') {
      setStage(null)
      setStreamCompleted(true)
    }
  }

  return (
    <div style={{
      maxWidth: 1500, margin: '0 auto', padding: '24px 32px 80px',
    }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Rip a concept
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-3)', maxWidth: 800 }}>
          Upload an ad you want to model — image and copy. The AI deeply analyzes WHY it works
          (structure, hook pattern, emotional trigger, visual register), then writes a new ad
          for your brand using the same DNA. No prompt engineering. One click.
        </p>
      </div>

      {error && (
        <div style={{
          marginBottom: 16, padding: '10px 14px',
          background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)',
          borderRadius: 8, fontSize: 13, color: 'var(--danger)',
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div style={{
        display: 'grid', gap: 24, alignItems: 'start',
        gridTemplateColumns: narrow ? '1fr' : 'minmax(360px, 420px) 1fr',
      }}>
        {/* ── LEFT (or top on narrow): Form ────────────────────────────── */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 18,
        }}>
          <Section title="Source ad image" required>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
              style={{
                border: '1px dashed var(--border-strong)', borderRadius: 10,
                padding: 14, minHeight: 200, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg)', transition: 'border-color 160ms',
              }}
            >
              {imagePreview ? (
                <div style={{ position: 'relative', width: '100%' }}>
                  <img src={imagePreview} alt="source ad" style={{
                    width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 6,
                  }} />
                  <button onClick={(e) => {
                    e.stopPropagation()
                    setImageFile(null); setImagePreview(null)
                  }} style={{
                    position: 'absolute', top: 6, right: 6,
                    background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none',
                    borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer',
                  }}>✕ Replace</button>
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                  <div style={{ fontSize: 24, marginBottom: 4 }}>🖼</div>
                  <div style={{ fontSize: 13 }}>Drop an image or click to browse</div>
                  <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>PNG · JPEG · WebP · max 20 MB</div>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => handleFile(e.target.files?.[0])}
              style={{ display: 'none' }}
            />
          </Section>

          <Section title="Primary text (copy / body — optional)">
            <textarea
              value={primaryText}
              onChange={(e) => setPrimaryText(e.target.value)}
              rows={6}
              placeholder="Paste the body copy if you have it. Skip for image-only ads — the AI will analyze the visual."
              data-gramm="false"
              style={textareaStyle}
            />
          </Section>

          <Section title="Headline (optional)">
            <input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="If the source ad has a headline"
              style={inputStyle}
            />
          </Section>

          <Section title="Description (optional)">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Sub-line or qualifier"
              style={inputStyle}
            />
          </Section>

          <Section title="CTA button text (optional)">
            <input
              value={ctaButton}
              onChange={(e) => setCtaButton(e.target.value)}
              placeholder="e.g. Shop Now"
              style={inputStyle}
            />
          </Section>

          <Section title="Image quality for the new ad">
            <select value={quality} onChange={(e) => setQuality(e.target.value)} style={{ ...inputStyle, padding: '8px 10px' }}>
              {QUALITIES.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
            </select>
          </Section>

          <div style={{ marginTop: 14 }}>
            <Btn
              variant="primary"
              size="md"
              onClick={ripIt}
              disabled={!canRun}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {running ? 'Ripping…' : `✨ Rip this ad · ${totalCost} cr`}
            </Btn>
            {!imageFile && !running && (
              <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 6, textAlign: 'center' }}>
                Upload an image to start. Copy is optional.
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Pipeline + result ─────────────────────────────────── */}
        <div style={{ display: 'grid', gap: 14 }}>
          {!running && !analysis && !generatedAd && !generatedImageUrl && (
            <EmptyState />
          )}

          {(running || stageHistory.length > 0) && (
            <PipelineStrip
              running={running}
              currentStage={stage}
              history={stageHistory}
              imageStatus={imageStatus}
            />
          )}

          {analysis && <AnalysisCard analysis={analysis} />}

          {generatedAd && (
            <GeneratedAdCard
              ad={generatedAd}
              imageUrl={generatedImageUrl}
              imageError={imageError}
              imageProvider={imageProvider}
              imageStatus={imageStatus}
              running={running}
              streamReachedImage={streamReachedImage}
              streamCompleted={streamCompleted}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Empty state ─────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px dashed var(--border-strong)',
      borderRadius: 12, padding: 36, textAlign: 'center',
    }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        Find an ad you wish was yours
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-3)', maxWidth: 460, margin: '0 auto', lineHeight: 1.5 }}>
        Screenshot any high-performing ad you've seen — competitor, your idol, your swipe file —
        upload the image, paste the copy. The AI will analyze the structural DNA and rewrite it for
        your brand using the brief, voice, and assets in this project.
      </div>
    </div>
  )
}

// ── Pipeline strip ──────────────────────────────────────────────────────────
function PipelineStrip({ running, currentStage, history, imageStatus }) {
  const stages = [
    { key: 'analyzing',       label: 'Analyzing source ad' },
    { key: 'adapting',        label: 'Adapting concept to brand' },
    { key: 'critiquing',      label: 'Critique & sharpen' },
    { key: 'art_directing',   label: 'Art-directing image' },
    { key: 'generating_image',label: 'Rendering image' },
  ]
  const seenStages = new Set(history.map(h => h.stage))
  const liveStage = history[history.length - 1]?.stage

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: 14,
    }}>
      <div style={{
        fontSize: 11, color: 'var(--text-4)', textTransform: 'uppercase',
        letterSpacing: '0.04em', marginBottom: 8,
      }}>Pipeline</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {stages.map(s => {
          const done = seenStages.has(s.key) && (s.key !== liveStage || !running)
          const live = running && s.key === liveStage
          const pending = !done && !live
          return (
            <div key={s.key} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              fontSize: 12.5,
              color: done ? 'var(--text)' : live ? 'var(--accent)' : 'var(--text-4)',
            }}>
              <span style={{
                display: 'inline-block', width: 14, height: 14, borderRadius: '50%',
                background: done ? 'var(--accent)' : live ? 'var(--accent-dim, rgba(132,204,22,0.3))' : 'transparent',
                border: pending ? '1px solid var(--border-strong)' : 'none',
                color: 'var(--accent-on)', fontSize: 9, lineHeight: '14px',
                textAlign: 'center', fontWeight: 700,
              }}>{done ? '✓' : ''}</span>
              <span>{s.label}</span>
              {live && <Spinner />}
              {live && s.key === 'generating_image' && imageStatus && (
                <span style={{ fontSize: 11, color: 'var(--text-4)' }}>· {imageStatus}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <span style={{
      width: 10, height: 10, borderRadius: '50%',
      border: '1.5px solid var(--accent-dim, rgba(132,204,22,0.3))',
      borderTopColor: 'var(--accent)',
      animation: 'rip-spin 700ms linear infinite',
      display: 'inline-block',
    }}>
      <style>{`@keyframes rip-spin { to { transform: rotate(360deg) } }`}</style>
    </span>
  )
}

// ── Analysis card ───────────────────────────────────────────────────────────
function AnalysisCard({ analysis }) {
  const [expanded, setExpanded] = useState(false)
  const concept = analysis.concept || {}
  const adType = analysis.ad_type || {}
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>What makes this ad work</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          {adType.format && <Pill>{adType.format}</Pill>}
          {adType.funnel_stage && <Pill>{adType.funnel_stage.toUpperCase()}</Pill>}
          {adType.is_native_long_form && <Pill>native</Pill>}
        </div>
      </div>

      <div style={{
        fontSize: 13.5, color: 'var(--text)', lineHeight: 1.55, marginBottom: 8,
        fontStyle: 'italic',
      }}>"{concept.one_line || '—'}"</div>

      <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.55, marginBottom: 10 }}>
        {concept.why_it_works}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {concept.emotional_trigger && (
          <Pill tone="accent">trigger: {concept.emotional_trigger}</Pill>
        )}
        {analysis.copy?.hook_pattern && (
          <Pill>hook: {analysis.copy.hook_pattern.split(' ').slice(0, 4).join(' ')}…</Pill>
        )}
      </div>

      {concept.structural_dna && (
        <div style={{
          fontSize: 12, color: 'var(--text-3)', padding: '8px 10px',
          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
          fontFamily: 'var(--font-mono)', lineHeight: 1.5, marginBottom: 8,
        }}>
          <strong style={{ color: 'var(--text)', fontWeight: 500 }}>DNA: </strong>
          {concept.structural_dna}
        </div>
      )}

      <button onClick={() => setExpanded(e => !e)} style={{
        background: 'transparent', border: 'none', color: 'var(--accent)',
        fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'inherit',
      }}>{expanded ? '− Hide details' : '+ Full breakdown'}</button>

      {expanded && (
        <div style={{
          marginTop: 10, padding: 10, background: 'var(--bg)',
          border: '1px solid var(--border)', borderRadius: 6,
          fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6,
          maxHeight: 400, overflowY: 'auto',
        }}>
          <DetailField label="Image — what stops scroll"  value={analysis.image?.what_makes_it_stop_scroll} />
          <DetailField label="Image — visual register"    value={analysis.image?.visual_register} />
          <DetailField label="Image — composition"        value={analysis.image?.composition} />
          <DetailField label="Image — lighting"           value={analysis.image?.lighting} />
          <DetailField label="Image — text overlay"       value={analysis.image?.text_overlay} />
          <DetailField label="Copy — hook line"           value={analysis.copy?.hook_line} mono />
          <DetailField label="Copy — narrative arc"       value={analysis.copy?.narrative_arc} />
          <DetailField label="Copy — mass desire"         value={analysis.copy?.mass_desire_tapped} />
          <DetailField label="Copy — hidden problem"      value={analysis.copy?.hidden_problem} />
          <DetailField label="Copy — real solution"       value={analysis.copy?.real_solution} />
          <DetailField label="Copy — voice register"      value={analysis.copy?.voice_register} />
          <DetailField label="Copy — CTA approach"        value={analysis.copy?.cta_approach} />
          <DetailField label="Concept — must preserve"    value={concept.what_must_be_preserved} />
          <DetailField label="Concept — must adapt"       value={concept.what_must_be_adapted} />
          <DetailField label="Concept — best avatar fit"  value={concept.best_fit_avatar_traits} />
        </div>
      )}
    </div>
  )
}

function DetailField({ label, value, mono }) {
  if (!value) return null
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.04em',
        textTransform: 'uppercase', marginBottom: 2,
      }}>{label}</div>
      <div style={{
        color: 'var(--text)', lineHeight: 1.5,
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
      }}>{value}</div>
    </div>
  )
}

function Pill({ children, tone }) {
  const colors = tone === 'accent'
    ? { bg: 'var(--accent-dim, rgba(132,204,22,0.15))', fg: 'var(--accent)' }
    : { bg: 'rgba(148,163,184,0.12)', fg: 'var(--text-3)' }
  return (
    <span style={{
      fontSize: 10.5, padding: '2px 7px', borderRadius: 4,
      background: colors.bg, color: colors.fg,
      fontWeight: 500, letterSpacing: '0.02em', whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

// ── Generated ad card ───────────────────────────────────────────────────────
function GeneratedAdCard({ ad, imageUrl, imageError, imageProvider, imageStatus, running, streamReachedImage, streamCompleted }) {
  const [copied, setCopied] = useState(null)
  const copy = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  // After the stream is done (or stopped running), if no 'image' event ever
  // arrived, surface that explicitly so the user isn't left with a vanished
  // column. This catches network blips, server crashes mid-stream, and bugs
  // we haven't predicted.
  const streamEndedWithoutImage = !running && !imageUrl && !imageError && !streamReachedImage

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Your ripped ad</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          {ad.scores && Object.entries(ad.scores).map(([k, v]) => (
            <Pill key={k} tone={v >= 9 ? 'accent' : null}>{k} {v}</Pill>
          ))}
        </div>
      </div>

      {(() => {
        const showImageCol = imageUrl || imageError || running || streamEndedWithoutImage
        return (
          <div style={{
            display: 'grid', gap: 18,
            gridTemplateColumns: showImageCol ? '300px 1fr' : '1fr',
          }}>
            {showImageCol && (
              <div>
                {imageUrl ? (
                  <div>
                    <img src={imageUrl} alt="generated ad" style={{
                      width: '100%', maxWidth: 300, borderRadius: 6,
                      border: '1px solid var(--border)',
                    }} />
                    {imageProvider && (
                      <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 4 }}>
                        Image via {imageProvider} (fallback)
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <a href={imageUrl} download={`ripped-ad.png`} style={downloadBtn}>⬇ Download</a>
                      <a href={imageUrl} target="_blank" rel="noreferrer" style={downloadBtn}>↗ Full size</a>
                    </div>
                  </div>
                ) : imageError ? (
                  <div style={{
                    padding: 14, borderRadius: 6,
                    background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)',
                    fontSize: 12, color: 'var(--danger)', maxWidth: 300,
                  }}>
                    <strong>Image error.</strong> {imageError}
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                      Copy is saved. You can generate the image manually from the Ad Studio tab.
                    </div>
                  </div>
                ) : streamEndedWithoutImage ? (
                  <div style={{
                    padding: 14, borderRadius: 6,
                    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
                    fontSize: 12, color: 'var(--warn, #f59e0b)', maxWidth: 300,
                  }}>
                    <strong>Image step ended without a result.</strong>
                    <div style={{ marginTop: 6, color: 'var(--text-3)' }}>
                      The connection closed before the image rendered (likely a proxy timeout — image gen can take 30-60s).
                      Your copy is saved. Open the Ad Studio tab and generate the image manually, or try ripping again.
                    </div>
                  </div>
                ) : running ? (
                  <div style={{
                    width: '100%', maxWidth: 300, height: 300,
                    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-4)', fontSize: 12.5, textAlign: 'center', padding: 18, gap: 6,
                  }}>
                    <Spinner />
                    <div>Rendering image…</div>
                    {imageStatus && <span style={{ fontSize: 11 }}>{imageStatus}</span>}
                  </div>
                ) : null}
              </div>
            )}

            {/* Copy column */}
            <div style={{ display: 'grid', gap: 10 }}>
              <CopyField label="Headline" value={ad.headline} onCopy={copy} copied={copied} />
              <CopyField label="Primary text" value={ad.primaryText} onCopy={copy} copied={copied} multiline />
              <CopyField label="Description" value={ad.description} onCopy={copy} copied={copied} />
              <CopyField label="CTA" value={ad.ctaButton} onCopy={copy} copied={copied} />
              {ad.critique && (
                <div style={{
                  fontSize: 11, color: 'var(--text-4)', fontStyle: 'italic',
                  padding: '6px 10px', background: 'var(--bg)', borderRadius: 4,
                }}>{ad.critique}</div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function CopyField({ label, value, onCopy, copied, multiline }) {
  if (!value) return null
  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 3,
      }}>
        <span style={{
          fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>{label}</span>
        <button onClick={() => onCopy(value, label)} style={{
          background: 'transparent', border: 'none', color: 'var(--text-4)',
          fontSize: 10.5, cursor: 'pointer', padding: 0, fontFamily: 'inherit',
        }}>
          {copied === label ? '✓ copied' : 'copy'}
        </button>
      </div>
      <div style={{
        fontSize: multiline ? 13 : 14,
        fontWeight: multiline ? 400 : 500,
        color: 'var(--text)',
        lineHeight: multiline ? 1.55 : 1.4,
        whiteSpace: multiline ? 'pre-wrap' : 'normal',
        padding: '8px 10px', background: 'var(--bg)',
        border: '1px solid var(--border)', borderRadius: 6,
      }}>{value}</div>
    </div>
  )
}

// ── Layout helpers ──────────────────────────────────────────────────────────
function Section({ title, required, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.04em',
        textTransform: 'uppercase', marginBottom: 5,
      }}>
        {title}
        {required && <span style={{ color: 'var(--accent)', marginLeft: 4 }}>*</span>}
      </div>
      {children}
    </div>
  )
}

const cardStyle = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 12, padding: 16,
}
const inputStyle = {
  width: '100%', padding: '8px 10px',
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', fontSize: 13, fontFamily: 'inherit',
}
const textareaStyle = {
  ...inputStyle, resize: 'vertical', minHeight: 100,
  fontFamily: 'inherit', lineHeight: 1.5,
}
const downloadBtn = {
  fontSize: 11, padding: '4px 10px', borderRadius: 4,
  background: 'var(--bg)', border: '1px solid var(--border)',
  color: 'var(--text-3)', textDecoration: 'none',
  fontFamily: 'inherit',
}

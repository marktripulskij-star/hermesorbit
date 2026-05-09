// 5-step onboarding wizard, per DESIGN-BRIEF.md §5.3:
//   1. Name your brand        — POST /api/projects (creates the project)
//   2. Paste your website     — POST /api/scrape-colors SSE
//   3. Upload brand assets    — POST /api/brand-assets (logo + product)
//   4. Optional extras        — POST /api/documents + /api/manual-offers
//   5. We're learning…        — POST /api/brand-brief → POST /api/generate-angles
// Then onComplete(projectId) to open the workspace.
//
// Steps 2-4 are skippable (small "Skip" link). Step 1 is required (must
// have a project name to create the project). Step 5 runs automatically.
// Errors at any step show inline + a retry button — partial state is
// preserved so the user doesn't restart.

import React, { useEffect, useRef, useState } from 'react'
import { authedFetch } from '../lib/supabase.js'
import { useProjects } from '../lib/ProjectsContext.jsx'
import { useMe } from '../lib/MeContext.jsx'
import { Btn, Card } from './ui/index.jsx'
import './OnboardingWizard.css'

const STEPS = [
  { key: 'name',     label: 'Name your brand' },
  { key: 'website',  label: 'Paste your website' },
  { key: 'assets',   label: 'Upload brand assets' },
  { key: 'extras',   label: 'Anything else?' },
  { key: 'building', label: "We're learning your brand…" },
]

export default function OnboardingWizard({ onComplete, onClose }) {
  const { createProject } = useProjects()
  const { refresh: refreshMe, checkPaymentRequired } = useMe()

  const [step, setStep] = useState('name')
  const [projectId, setProjectId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // Step 1 — name
  const [name, setName] = useState('')

  // Step 2 — website
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [scrapeProgress, setScrapeProgress] = useState([])
  const [scrapeSummary, setScrapeSummary] = useState(null)

  // Step 3 — assets
  const [logoFile, setLogoFile] = useState(null)
  const [productFile, setProductFile] = useState(null)

  // Step 4 — extras
  const [docFiles, setDocFiles] = useState([])
  const [manualOffers, setManualOffers] = useState('')

  // Step 5 — building
  const [buildLog, setBuildLog] = useState([])

  const stepIndex = STEPS.findIndex(s => s.key === step)

  function advance() { setErr(null); setStep(STEPS[stepIndex + 1].key) }
  function back() { setErr(null); if (stepIndex > 0) setStep(STEPS[stepIndex - 1].key) }

  // ── Step 1: name + create project ─────────────────────────────────────
  async function submitName(e) {
    e?.preventDefault?.()
    if (!name.trim()) return
    setBusy(true); setErr(null)
    try {
      const p = await createProject(name.trim())
      setProjectId(p.id)
      advance()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  // ── Step 2: website scrape (SSE) ──────────────────────────────────────
  async function startScrape() {
    if (!websiteUrl.trim() || !projectId) return
    setBusy(true); setErr(null); setScrapeProgress([]); setScrapeSummary(null)
    try {
      const r = await authedFetch('/api/scrape-colors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: projectId, url: websiteUrl.trim() }),
      })
      if (!r.ok) throw new Error(`Scrape failed: HTTP ${r.status}`)
      const reader = r.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'progress') {
              setScrapeProgress(prev => [...prev, ev.message])
            } else if (ev.type === 'done') {
              // Server shape: { type:'done', content:{pagesScraped, productCount, priceCount, offerCount}, brandColors, ... }
              const c = ev.content || {}
              setScrapeSummary({
                pages: c.pagesScraped ?? 1,
                products: c.productCount ?? 0,
                prices: c.priceCount ?? 0,
                offers: c.offerCount ?? 0,
                colors: (ev.brandColors || []).length,
              })
            } else if (ev.type === 'error') {
              setErr(ev.error)
            }
          } catch {}
        }
      }
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  // ── Step 3: asset uploads ─────────────────────────────────────────────
  // Upload logo and product as TWO separate POSTs, each with an explicit
  // `forceType`. Server respects forceType instead of running its fragile
  // filename/metadata heuristic that routinely mislabels logo as product
  // (and vice-versa). This is the fix for: (a) the model inventing wrong
  // products in generated ads, (b) logo showing up tagged as "Product"
  // in the brand assets sidebar.
  async function uploadOne(file, type) {
    const form = new FormData()
    form.append('sessionId', projectId)
    form.append('forceType', type)
    form.append('files', file)
    const r = await authedFetch('/api/brand-assets', { method: 'POST', body: form })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      throw new Error(j.error || `HTTP ${r.status}`)
    }
  }

  async function uploadAssets() {
    setBusy(true); setErr(null)
    try {
      if (!logoFile && !productFile) { advance(); return }
      if (logoFile)    await uploadOne(logoFile, 'logo')
      if (productFile) await uploadOne(productFile, 'product')
      advance()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  // ── Step 4: extras (docs + offers) ────────────────────────────────────
  async function uploadExtras() {
    setBusy(true); setErr(null)
    try {
      // Docs
      if (docFiles.length > 0) {
        const form = new FormData()
        form.append('sessionId', projectId)
        for (const f of docFiles) form.append('files', f)
        const r = await authedFetch('/api/documents', { method: 'POST', body: form })
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j.error || `HTTP ${r.status}`)
        }
      }
      // Offers
      const offers = manualOffers.split('\n').map(s => s.trim()).filter(Boolean)
      if (offers.length > 0) {
        const r2 = await authedFetch('/api/manual-offers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: projectId, offers }),
        })
        if (!r2.ok) {
          const j = await r2.json().catch(() => ({}))
          throw new Error(j.error || `HTTP ${r2.status}`)
        }
      }
      advance()  // → 'building'
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  // ── Step 5: building ──────────────────────────────────────────────────
  // Auto-runs on entry to this step. Calls brief → angles in sequence.
  const ranBuilding = useRef(false)
  useEffect(() => {
    if (step !== 'building') return
    if (ranBuilding.current) return
    ranBuilding.current = true
    runBuilding()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  async function runBuilding() {
    setBusy(true); setErr(null); setBuildLog([])

    // Brief
    setBuildLog(l => [...l, 'Reading your brand inputs…'])
    try {
      const r = await authedFetch('/api/brand-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: projectId }),
      })
      if (await checkPaymentRequired(r)) { setBusy(false); ranBuilding.current = false; return }
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `Brief: HTTP ${r.status}`)
      }
      const brief = await r.json()
      const avatars = brief?.brandBrief?.avatars?.length || 0
      setBuildLog(l => [...l, `✓ Brief built — ${avatars} avatars surfaced`])
    } catch (e) {
      setErr(`Brief failed: ${e.message}`)
      setBusy(false)
      ranBuilding.current = false
      return
    }

    // Angles
    setBuildLog(l => [...l, 'Generating 20 testing angles…'])
    try {
      const r = await authedFetch('/api/generate-angles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: projectId }),
      })
      if (await checkPaymentRequired(r)) { setBusy(false); ranBuilding.current = false; return }
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `Angles: HTTP ${r.status}`)
      }
      const data = await r.json()
      const n = data?.angles?.length || 0
      setBuildLog(l => [...l, `✓ ${n} angles ready`])
    } catch (e) {
      setErr(`Angles failed: ${e.message}`)
      setBusy(false)
      ranBuilding.current = false
      return
    }

    setBuildLog(l => [...l, 'Done. Opening your workspace…'])
    refreshMe()
    setBusy(false)
    setTimeout(() => onComplete?.(projectId), 800)
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <Header step={step} stepIndex={stepIndex} total={STEPS.length} onClose={onClose} />

        {step === 'name' && (
          <StepName name={name} setName={setName} busy={busy} err={err} onSubmit={submitName} />
        )}

        {step === 'website' && (
          <StepWebsite
            url={websiteUrl} setUrl={setWebsiteUrl}
            busy={busy} err={err}
            progress={scrapeProgress} summary={scrapeSummary}
            onScrape={startScrape}
            onSkip={advance} onContinue={advance}
            canContinue={!!scrapeSummary && !busy}
          />
        )}

        {step === 'assets' && (
          <StepAssets
            logoFile={logoFile} setLogoFile={setLogoFile}
            productFile={productFile} setProductFile={setProductFile}
            busy={busy} err={err}
            onContinue={uploadAssets} onSkip={advance} onBack={back}
          />
        )}

        {step === 'extras' && (
          <StepExtras
            docFiles={docFiles} setDocFiles={setDocFiles}
            manualOffers={manualOffers} setManualOffers={setManualOffers}
            busy={busy} err={err}
            onContinue={uploadExtras} onSkip={() => setStep('building')} onBack={back}
          />
        )}

        {step === 'building' && (
          <StepBuilding
            log={buildLog} err={err}
            onRetry={() => { ranBuilding.current = false; runBuilding() }}
          />
        )}
      </div>
    </div>
  )
}

// ── Header ──────────────────────────────────────────────────────────────
function Header({ step, stepIndex, total, onClose }) {
  const label = STEPS[stepIndex].label
  return (
    <div className="onboarding-head">
      <div className="onboarding-brand">
        <img className="onboarding-mark" src="/hermes-logo.png" alt="" />
        <span className="onboarding-name">Hermes</span>
      </div>
      <div className="onboarding-step-meta">
        <span className="onboarding-step-num">Step {stepIndex + 1} of {total}</span>
        {onClose && step !== 'building' && (
          <button className="onboarding-close" onClick={onClose} title="Close" aria-label="Close">✕</button>
        )}
      </div>
      <div className="onboarding-progress">
        {STEPS.map((s, i) => (
          <span key={s.key} className={`onboarding-progress-dot ${i <= stepIndex ? 'active' : ''}`} />
        ))}
      </div>
      <h2 className="onboarding-title">{label}</h2>
    </div>
  )
}

// ── Step 1 ──────────────────────────────────────────────────────────────
function StepName({ name, setName, busy, err, onSubmit }) {
  return (
    <form onSubmit={onSubmit} className="onboarding-body">
      <p className="onboarding-helper">You can have unlimited brands later — each is its own project.</p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Bodivelle"
        className="onboarding-input"
        disabled={busy}
      />
      {err && <ErrorRow err={err} />}
      <ActionRow>
        <Btn variant="primary" size="md" type="submit" disabled={busy || !name.trim()} style={{ flex: 1 }}>
          {busy ? 'Creating…' : 'Continue'}
        </Btn>
      </ActionRow>
    </form>
  )
}

// ── Step 2 ──────────────────────────────────────────────────────────────
function StepWebsite({ url, setUrl, busy, err, progress, summary, onScrape, onSkip, onContinue, canContinue }) {
  return (
    <div className="onboarding-body">
      <p className="onboarding-helper">We'll crawl your homepage and key landing pages, pull pricing, offers, and brand colors. Takes ~10-30s.</p>
      <div className="onboarding-input-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://yourbrand.com"
          className="onboarding-input"
          disabled={busy || !!summary}
        />
        {!summary && (
          <Btn variant="primary" size="md" onClick={onScrape} disabled={busy || !url.trim()}>
            {busy ? 'Crawling…' : 'Crawl'}
          </Btn>
        )}
      </div>

      {progress.length > 0 && (
        <div className="onboarding-progress-feed">
          {progress.slice(-6).map((p, i) => (
            <div key={i} className="onboarding-progress-line">→ {p}</div>
          ))}
        </div>
      )}

      {summary && (
        <div className="onboarding-summary">
          ✓ {summary.pages} pages · {summary.products} products · {summary.prices} prices · {summary.offers} offers · {summary.colors} colors
        </div>
      )}

      {err && <ErrorRow err={err} />}

      <ActionRow>
        <button onClick={onSkip} className="onboarding-skip" type="button">Skip — I'll add it later</button>
        <Btn
          variant="primary"
          size="md"
          onClick={onContinue}
          disabled={!canContinue}
          style={{ flex: 1, maxWidth: 200 }}
        >
          Continue
        </Btn>
      </ActionRow>
    </div>
  )
}

// ── Step 3 ──────────────────────────────────────────────────────────────
function StepAssets({ logoFile, setLogoFile, productFile, setProductFile, busy, err, onContinue, onSkip, onBack }) {
  return (
    <div className="onboarding-body">
      <p className="onboarding-helper">Drop your logo and a product photo so generated ads match your real brand. Auto-classified.</p>
      <div className="onboarding-dropzones">
        <FileDrop
          label="Logo"
          file={logoFile}
          onChange={setLogoFile}
          accept="image/png,image/jpeg,image/webp"
          hint="PNG with transparency works best"
        />
        <FileDrop
          label="Product photo"
          file={productFile}
          onChange={setProductFile}
          accept="image/png,image/jpeg,image/webp"
          hint="A clean shot of the product / packaging"
        />
      </div>
      {err && <ErrorRow err={err} />}
      <ActionRow>
        <button onClick={onBack} className="onboarding-skip" type="button">← Back</button>
        <button onClick={onSkip} className="onboarding-skip" type="button">Skip</button>
        <Btn
          variant="primary"
          size="md"
          onClick={onContinue}
          disabled={busy}
          style={{ flex: 1, maxWidth: 200 }}
        >
          {busy ? 'Uploading…' : 'Continue'}
        </Btn>
      </ActionRow>
    </div>
  )
}

// ── Step 4 ──────────────────────────────────────────────────────────────
function StepExtras({ docFiles, setDocFiles, manualOffers, setManualOffers, busy, err, onContinue, onSkip, onBack }) {
  return (
    <div className="onboarding-body">
      <p className="onboarding-helper">Anything you give us makes the ads better. Skip if you're in a rush.</p>

      <div className="onboarding-section-label">Brand documents (PDF / TXT)</div>
      <FileMultiDrop
        files={docFiles}
        onChange={setDocFiles}
        accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
        hint="Brand guidelines, research, founder docs"
      />

      <div className="onboarding-section-label" style={{ marginTop: 18 }}>Active offers (one per line)</div>
      <textarea
        value={manualOffers}
        onChange={(e) => setManualOffers(e.target.value)}
        placeholder={'Buy 1 Get 1 Free — $39\nFree shipping on $50+'}
        rows={4}
        className="onboarding-input"
        style={{ resize: 'vertical' }}
        disabled={busy}
      />

      {err && <ErrorRow err={err} />}

      <ActionRow>
        <button onClick={onBack} className="onboarding-skip" type="button">← Back</button>
        <button onClick={onSkip} className="onboarding-skip" type="button">Skip</button>
        <Btn
          variant="primary"
          size="md"
          onClick={onContinue}
          disabled={busy}
          style={{ flex: 1, maxWidth: 200 }}
        >
          {busy ? 'Uploading…' : 'Build my brand'}
        </Btn>
      </ActionRow>
    </div>
  )
}

// ── Step 5 ──────────────────────────────────────────────────────────────
function StepBuilding({ log, err, onRetry }) {
  return (
    <div className="onboarding-body onboarding-building">
      <div className="onboarding-spinner" />
      <p className="onboarding-helper" style={{ marginTop: 14 }}>~30-60 seconds. Building brief + 20 angles.</p>
      <div className="onboarding-build-log">
        {log.map((line, i) => (
          <div key={i} className="onboarding-build-line">{line}</div>
        ))}
      </div>
      {err && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14, alignItems: 'center' }}>
          <ErrorRow err={err} />
          <Btn variant="secondary" size="sm" onClick={onRetry}>Retry</Btn>
        </div>
      )}
    </div>
  )
}

// ── Tiny shared bits ────────────────────────────────────────────────────
function ActionRow({ children }) {
  return <div className="onboarding-action-row">{children}</div>
}

function ErrorRow({ err }) {
  return (
    <div className="onboarding-error">
      {err}
    </div>
  )
}

function FileDrop({ label, file, onChange, accept, hint }) {
  const inputRef = useRef(null)
  const [drag, setDrag] = useState(false)
  return (
    <div
      className={`onboarding-drop ${drag ? 'drag' : ''} ${file ? 'has-file' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragEnter={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onChange(f)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onChange(f) }}
        style={{ display: 'none' }}
      />
      <div className="onboarding-drop-label">{label}</div>
      {file ? (
        <div className="onboarding-drop-file">{file.name}</div>
      ) : (
        <>
          <div className="onboarding-drop-hint">Drop or click</div>
          {hint && <div className="onboarding-drop-sub">{hint}</div>}
        </>
      )}
    </div>
  )
}

function FileMultiDrop({ files, onChange, accept, hint }) {
  const inputRef = useRef(null)
  return (
    <div
      className="onboarding-drop onboarding-drop-multi"
      onClick={() => inputRef.current?.click()}
      onDragEnter={(e) => e.preventDefault()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const fs = Array.from(e.dataTransfer.files || [])
        if (fs.length) onChange([...files, ...fs])
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        onChange={(e) => { const fs = Array.from(e.target.files || []); if (fs.length) onChange([...files, ...fs]) }}
        style={{ display: 'none' }}
      />
      {files.length === 0 ? (
        <div className="onboarding-drop-hint">Drop files or click — {hint}</div>
      ) : (
        <div className="onboarding-drop-files">
          {files.map((f, i) => (
            <span key={i} className="onboarding-drop-tag">
              {f.name}
              <button
                onClick={(e) => { e.stopPropagation(); onChange(files.filter((_, j) => j !== i)) }}
                style={{ marginLeft: 6, background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer' }}
              >✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

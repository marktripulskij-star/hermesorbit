import React, { useState, useEffect } from 'react'
import { authedFetch } from '../lib/supabase.js'
import { useMe } from '../lib/MeContext.jsx'
import AdAdjustPanel from './AdAdjustPanel.jsx'
import './AdBuilder.css'

const FUNNEL_LABEL = { tofu: 'TOFU', mofu: 'MOFU', bofu: 'BOFU' }
const FUNNEL_COLOR = { tofu: 'funnel-tofu', mofu: 'funnel-mofu', bofu: 'funnel-bofu' }
const STATUS_LABEL = { queued: 'Queued…', in_progress: 'Generating image…' }

// Fallback list — replaced from /api/meta-ctas on mount
const DEFAULT_CTAS = [
  'Shop Now', 'Learn More', 'Sign Up', 'Subscribe', 'Order Now',
  'Get Offer', 'Download', 'Book Now', 'Apply Now', 'Contact Us',
  'See Menu', 'Watch More', 'Listen Now', 'Send Message', 'Get Quote',
]

function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false)
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(value || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {}
  }
  return (
    <button
      type="button"
      className={`copy-btn ${copied ? 'copied' : ''}`}
      onClick={handle}
      title={`Copy ${label}`}
    >
      {copied ? '✓ Copied' : '⧉ Copy'}
    </button>
  )
}

export default function AdBuilder({
  angle, formats, selectedFormatId, onFormatChange,
  ad, onGenerateCopy, generatingCopy,
  onGenerateImage, generatingImage, imageStatus,
  sessionId, adKey, angleId, onAdUpdate,
}) {
  const { refresh: refreshMe, checkPaymentRequired } = useMe()
  const [editedCopy, setEditedCopy] = useState(null)
  const [collapsed, setCollapsed] = useState(false)
  const [expandedImage, setExpandedImage] = useState(false)
  const [regeneratingPrompt, setRegeneratingPrompt] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [ctaOptions, setCtaOptions] = useState(DEFAULT_CTAS)
  const [imageSize, setImageSize] = useState(ad?.imageSize || '1024x1024')
  const [imageQuality, setImageQuality] = useState(ad?.imageQuality || 'medium')
  const [timing, setTiming] = useState(null)

  // Hook separation state
  const [hookCandidates, setHookCandidates] = useState(null)
  const [loadingHooks, setLoadingHooks] = useState(false)
  const [hookError, setHookError] = useState(null)
  const [customHook, setCustomHook] = useState('')

  useEffect(() => {
    authedFetch('/api/meta-ctas').then(r => r.ok ? r.json() : null).then(c => c && setCtaOptions(c)).catch(() => {})
    authedFetch('/api/usage/timing').then(r => r.ok ? r.json() : null).then(t => t && setTiming(t)).catch(() => {})
  }, [])

  // Refresh timing after each successful image gen so estimates calibrate over time
  useEffect(() => {
    if (!generatingImage && ad?.imageUrl) {
      authedFetch('/api/usage/timing').then(r => r.ok ? r.json() : null).then(t => t && setTiming(t)).catch(() => {})
    }
  }, [generatingImage, ad?.imageUrl])

  const format = formats.find(f => f.id === selectedFormatId)

  const grouped = {
    tofu: formats.filter(f => f.funnel === 'tofu'),
    mofu: formats.filter(f => f.funnel === 'mofu'),
    bofu: formats.filter(f => f.funnel === 'bofu'),
  }

  const displayCopy = editedCopy !== null ? editedCopy : ad

  const handleCopyGenerated = () => {
    // Open the hook picker first — user picks before body is generated
    setEditedCopy(null)
    setHookCandidates(null)
    setHookError(null)
    setCustomHook('')
    fetchHookCandidates()
  }

  const fetchHookCandidates = async () => {
    if (!selectedFormatId) return
    setLoadingHooks(true)
    setHookError(null)
    try {
      const r = await authedFetch('/api/generate-hooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, angleId, formatId: selectedFormatId }),
      })
      if (await checkPaymentRequired(r)) return
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      setHookCandidates(data.hooks || [])
      refreshMe()
    } catch (e) {
      setHookError(e.message)
    } finally {
      setLoadingHooks(false)
    }
  }

  const pickHook = (hook) => {
    setHookCandidates(null) // close picker
    onGenerateCopy(hook)
  }

  const skipHookPicker = () => {
    setHookCandidates(null)
    onGenerateCopy(null)
  }

  const updateField = (field, value) => {
    setEditedCopy(prev => ({ ...(prev !== null ? prev : ad), [field]: value }))
  }

  const handleRegeneratePrompt = async () => {
    if (!adKey) return
    setRegeneratingPrompt(true)
    try {
      const res = await authedFetch('/api/regenerate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, adKey, currentPrompt: displayCopy?.imagePrompt }),
      })
      if (await checkPaymentRequired(res)) return
      const data = await res.json()
      if (data.imagePrompt) {
        updateField('imagePrompt', data.imagePrompt)
        onAdUpdate?.(adKey, { imagePrompt: data.imagePrompt })
      }
      refreshMe()
    } catch (_) {}
    finally { setRegeneratingPrompt(false) }
  }

  const stage = angle.funnelStage || 'tofu'

  return (
    <div className="ad-builder-card" translate="no">
      {/* Angle header — clickable to collapse */}
      <div className="ad-builder-header" onClick={() => setCollapsed(c => !c)} style={{ cursor: 'pointer' }}>
        <span className={`funnel-badge ${FUNNEL_COLOR[stage] || 'funnel-tofu'}`}>
          {FUNNEL_LABEL[stage] || stage.toUpperCase()}
        </span>
        <div className="ad-builder-angle-info">
          <span className="ad-builder-avatar">{angle.avatar}</span>
          <span className="ad-builder-pain">{angle.pain}</span>
        </div>
        <span className="collapse-toggle">{collapsed ? '▾' : '▴'}</span>
      </div>

      {!collapsed && (
        <>
          {/* Format selector */}
          <div className="ad-format-row">
            <label className="ad-format-label">Format</label>
            <select
              className="ad-format-select"
              value={selectedFormatId || ''}
              onChange={e => onFormatChange(e.target.value)}
            >
              <option value="">— pick a format —</option>
              <optgroup label="TOFU — Awareness">
                {grouped.tofu.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </optgroup>
              <optgroup label="MOFU — Consideration">
                {grouped.mofu.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </optgroup>
              <optgroup label="BOFU — Conversion">
                {grouped.bofu.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </optgroup>
            </select>
            {format ? (
              <span className="format-need-badge">
                {format.needsProduct ? '📦 Product shot' : '🏞 No product needed'}
              </span>
            ) : null}
          </div>

          <div className="format-description-wrap">
            {format ? <p className="format-description">{format.description}</p> : null}
          </div>

          <div className="generate-copy-row">
            <button
              className="btn-primary btn-generate-copy"
              onClick={handleCopyGenerated}
              disabled={!selectedFormatId || generatingCopy || loadingHooks}
            >
              {loadingHooks ? 'Generating hooks…' : generatingCopy ? 'Writing copy…' : ad ? '↺ Regenerate Copy · 3 cr' : '⚡ Generate Copy · 3 cr'}
            </button>
            {!selectedFormatId ? <span className="format-hint">← Pick a format first</span> : null}
          </div>

          {/* Hook picker — appears between hook fetch and body generation */}
          {(hookCandidates || hookError) && !generatingCopy && (
            <div className="hook-picker">
              <div className="hook-picker-header">
                <strong>Pick your hook</strong>
                <span className="hook-picker-sub">The first sentence is the most important line in any ad. Pick the one that makes you NEED the next sentence.</span>
              </div>
              {hookError && <div className="hook-picker-error">⚠ {hookError}</div>}
              {hookCandidates && hookCandidates.length > 0 && (
                <div className="hook-picker-list">
                  {hookCandidates.map((h, i) => (
                    <button key={i} className="hook-candidate" onClick={() => pickHook(h)}>
                      <span className="hook-candidate-num">{i + 1}</span>
                      <span className="hook-candidate-text">{h}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="hook-picker-custom">
                <input
                  type="text"
                  className="hook-custom-input"
                  placeholder="Or write your own hook…"
                  value={customHook}
                  onChange={e => setCustomHook(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && customHook.trim()) pickHook(customHook.trim()) }}
                />
                <button
                  className="btn-secondary"
                  onClick={() => customHook.trim() && pickHook(customHook.trim())}
                  disabled={!customHook.trim()}
                >Use this</button>
              </div>
              <div className="hook-picker-actions">
                <button className="hook-link-btn" onClick={fetchHookCandidates} disabled={loadingHooks}>
                  ↺ Generate 10 new hooks
                </button>
                <button className="hook-link-btn" onClick={skipHookPicker}>
                  Skip — let AI pick →
                </button>
                <button className="hook-link-btn" onClick={() => { setHookCandidates(null); setHookError(null) }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Generated copy */}
          {displayCopy ? (
            <div className="ad-copy-output">
              {(displayCopy.scores || displayCopy.headline) ? (
                <div className="ad-scores" title={displayCopy.critique || ''}>
                  {displayCopy.scores ? (
                    <>
                      <span className="ad-scores-label">Self-critique:</span>
                      {Object.entries(displayCopy.scores).map(([k, v]) => (
                        <span key={k} className={`ad-score-chip score-${v >= 9 ? 'high' : v >= 7 ? 'mid' : 'low'}`}>
                          {k} {v}/10
                        </span>
                      ))}
                      {displayCopy.critique ? (
                        <details className="ad-critique-details">
                          <summary>why?</summary>
                          <p className="ad-critique-text">{displayCopy.critique}</p>
                        </details>
                      ) : null}
                    </>
                  ) : null}
                  <button
                    type="button"
                    className={`ad-adjust-trigger ${adjustOpen ? 'open' : ''}`}
                    onClick={() => setAdjustOpen(o => !o)}
                    title="Refine this ad's copy with AI"
                  >
                    ✨ Adjust
                  </button>
                </div>
              ) : null}

              {adjustOpen && (
                <AdAdjustPanel
                  sessionId={sessionId}
                  adKey={adKey}
                  currentCopy={displayCopy}
                  onClose={() => setAdjustOpen(false)}
                  onApplied={(updated) => {
                    // Sync local edit buffer + global ads state so every UI
                    // reflection (textareas, char counts, etc.) updates.
                    setEditedCopy(prev => ({ ...(prev !== null ? prev : ad), ...updated }))
                    onAdUpdate?.(adKey, {
                      headline: updated.headline,
                      primaryText: updated.primaryText,
                      description: updated.description,
                      ctaButton: updated.ctaButton,
                    })
                  }}
                />
              )}
              <div className="copy-field">
                <div className="copy-field-label">
                  Headline <span className="copy-char-count">{displayCopy.headline?.length || 0}/40</span>
                  <CopyButton value={displayCopy.headline} label="headline" />
                </div>
                <textarea
                  className="copy-textarea copy-headline"
                  value={displayCopy.headline || ''}
                  onChange={e => updateField('headline', e.target.value)}
                  rows={1}
                  data-gramm="false"
                />
              </div>

              <div className="copy-field">
                <div className="copy-field-label">
                  Primary Text <span className="copy-char-count">{displayCopy.primaryText?.length || 0} chars</span>
                  <CopyButton value={displayCopy.primaryText} label="primary text" />
                </div>
                <textarea
                  className="copy-textarea copy-primary"
                  value={displayCopy.primaryText || ''}
                  onChange={e => updateField('primaryText', e.target.value)}
                  rows={8}
                  data-gramm="false"
                />
              </div>

              <div className="copy-two-col">
                <div className="copy-field">
                  <div className="copy-field-label">
                    Description <span className="copy-char-count">{displayCopy.description?.length || 0}/30</span>
                    <CopyButton value={displayCopy.description} label="description" />
                  </div>
                  <textarea
                    className="copy-textarea"
                    value={displayCopy.description || ''}
                    onChange={e => updateField('description', e.target.value)}
                    rows={1}
                    data-gramm="false"
                  />
                </div>
                <div className="copy-field">
                  <div className="copy-field-label">
                    CTA Button
                    <CopyButton value={displayCopy.ctaButton} label="CTA" />
                  </div>
                  <select
                    className="copy-input cta-select"
                    value={displayCopy.ctaButton || 'Shop Now'}
                    onChange={e => updateField('ctaButton', e.target.value)}
                  >
                    {ctaOptions.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Image prompt — always visible, editable, regeneratable */}
              <div className="copy-field">
                <div className="copy-field-label">
                  Image Prompt
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={handleRegeneratePrompt}
                    disabled={regeneratingPrompt}
                    title="Regenerate prompt only"
                  >
                    {regeneratingPrompt ? 'Regenerating…' : '↺ Regen Prompt'}
                  </button>
                  <CopyButton value={displayCopy.imagePrompt} label="prompt" />
                </div>
                <textarea
                  className="copy-textarea copy-prompt"
                  value={displayCopy.imagePrompt || ''}
                  onChange={e => updateField('imagePrompt', e.target.value)}
                  rows={4}
                  data-gramm="false"
                  placeholder="Describe the image. Edit freely before generating."
                />
              </div>

              {/* Image generation settings */}
              <div className="image-settings-row">
                <label className="image-setting">
                  <span>Aspect</span>
                  <select
                    value={imageSize}
                    onChange={e => setImageSize(e.target.value)}
                    disabled={generatingImage}
                  >
                    <option value="1024x1024">Square 1:1</option>
                    <option value="1024x1536">Portrait 2:3 (Story/Reel)</option>
                    <option value="1536x1024">Landscape 3:2</option>
                  </select>
                </label>
                <label className="image-setting">
                  <span>Quality</span>
                  <select
                    value={imageQuality}
                    onChange={e => setImageQuality(e.target.value)}
                    disabled={generatingImage}
                  >
                    <option value="low">Low — {timing ? `~${timing.low.avgSec}s` : '~8s'} · 1 cr</option>
                    <option value="medium">Medium — {timing ? `~${timing.medium.avgSec}s` : '~22s'} · 3 cr</option>
                    <option value="high">High — {timing ? `~${timing.high.avgSec}s` : '~55s'} · 8 cr</option>
                  </select>
                </label>
              </div>
              <div className="image-timing-note">
                {timing && timing[imageQuality]?.isDefault === false
                  ? `Based on your last ${timing[imageQuality].n} gen${timing[imageQuality].n === 1 ? '' : 's'}: avg ${timing[imageQuality].avgSec}s, 90% finish under ${timing[imageQuality].p90Sec}s. Not glitching — High can take up to ~${timing[imageQuality].p90Sec}s.`
                  : `Estimates: Low ~5-12s · Medium ~15-30s · High up to ~60-90s. The browser isn't frozen — High really takes a minute.`}
              </div>

              {/* Image generation */}
              <div className="image-gen-row">
                <button
                  className="btn-secondary"
                  onClick={() => onGenerateImage({ size: imageSize, quality: imageQuality })}
                  disabled={generatingImage || !displayCopy.imagePrompt}
                >
                  {generatingImage
                    ? (STATUS_LABEL[imageStatus] || 'Generating…')
                    : (() => {
                        const cost = imageQuality === 'low' ? 1 : imageQuality === 'high' ? 8 : 3
                        return displayCopy.imageUrl
                          ? `↺ Regenerate Image · ${cost} cr`
                          : `🖼 Generate Image · ${cost} cr`
                      })()}
                </button>
                {format?.needsProduct && !displayCopy.imageUrl && !generatingImage ? (
                  <span className="product-ref-note">📦 Will use your product photo as reference</span>
                ) : null}
              </div>

              {displayCopy.imageUrl ? (
                <div className="ad-image-block">
                  <div
                    className={`ad-image-thumb ${expandedImage ? 'expanded' : ''}`}
                    onClick={() => setExpandedImage(e => !e)}
                  >
                    <img src={displayCopy.imageUrl} alt="Generated ad" />
                    <span className="ad-image-hint">{expandedImage ? 'Click to shrink' : 'Click to expand'}</span>
                  </div>
                  <div className="ad-image-actions">
                    <a
                      href={displayCopy.imageUrl}
                      download={`ad-${adKey || 'image'}.jpg`}
                      target="_blank"
                      rel="noreferrer"
                      className="copy-btn"
                    >
                      ⬇ Download
                    </a>
                    <a
                      href={displayCopy.imageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="copy-btn"
                    >
                      ↗ Open full size
                    </a>
                  </div>
                </div>
              ) : null}
              {displayCopy.imageError ? (
                <div className="ad-image-error">Image failed: {displayCopy.imageError}</div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

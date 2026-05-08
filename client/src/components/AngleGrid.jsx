import React, { useState } from 'react'
import AdBuilder from './AdBuilder.jsx'
import { downloadAllImages, exportCopyAsPdf } from '../lib/export.js'
import './AngleGrid.css'

const FUNNEL_LABEL = { tofu: 'Top of Funnel', mofu: 'Mid Funnel', bofu: 'Bottom of Funnel' }
const FUNNEL_SHORT = { tofu: 'TOFU', mofu: 'MOFU', bofu: 'BOFU' }
const FUNNEL_COLOR = { tofu: 'funnel-tofu', mofu: 'funnel-mofu', bofu: 'funnel-bofu' }

const STAGE_LABEL = {
  'generating-copy': 'Writing copy…',
  'generating-image': 'Rendering image…',
  done: 'Ready',
  error: 'Error',
}

// Compact aspect + quality options shown on each angle card.
const ASPECTS = [
  { value: '1024x1024', label: '1:1' },
  { value: '1024x1536', label: '2:3' },   // story / reel
  { value: '1536x1024', label: '3:2' },   // landscape
]
const QUALITIES = [
  { value: 'low',    label: 'Low · 1 cr' },
  { value: 'medium', label: 'Medium · 3 cr' },
  { value: 'high',   label: 'High · 8 cr' },
]
// 3 cr (copy) + image quality cost = total per ad in batch
const IMAGE_COST = { low: 1, medium: 3, high: 8 }
const COPY_COST = 3

export default function AngleGrid({
  // angles + format catalog
  angles, formats = [],
  // selection (checkbox)
  selected, onToggle, onSelectAll, onClearAll,
  // format pick per angle
  selectedFormats, onFormatChange,
  // image settings per angle (size + quality)
  imageSettings, onImageSettingChange,
  // batch generation
  ads, adStages, adErrors, batchGenerating, onRunBatch,
  // expand
  expandedAngles, onToggleExpand,
  // re-used: the AdBuilder needs all these passthroughs
  sessionId,
  generatingCopy, generatingImage, imageStatuses,
  onGenerateCopy, onGenerateImage,
  onAdUpdate,
  // export
  brandName = '',
  // clear all ads
  onClearAllAds,
}) {
  const [filter, setFilter] = useState('all')
  const [exporting, setExporting] = useState(null)   // 'images' | 'copy' | null
  const [exportMsg, setExportMsg] = useState(null)   // { kind: 'success'|'error', text }
  const [clearing, setClearing] = useState(false)

  // Lookups
  const formatById = {}; for (const f of formats) formatById[f.id] = f
  const visible = filter === 'all' ? angles : angles.filter(a => a.funnelStage === filter)
  const counts = { tofu: 0, mofu: 0, bofu: 0 }
  angles.forEach(a => { if (counts[a.funnelStage] !== undefined) counts[a.funnelStage]++ })

  // Batch progress (across whole list, not just visible)
  const stages = adStages || {}
  const total = Object.values(stages).length
  const doneCount = Object.values(stages).filter(s => s === 'done').length
  const inFlight = Object.values(stages).filter(s => s === 'generating-copy' || s === 'generating-image').length
  const errored = Object.values(stages).filter(s => s === 'error').length

  // Batch button enable: ≥1 selected, none currently generating
  const selectedIds = Array.from(selected || [])
  const canBatch = selectedIds.length > 0 && !batchGenerating

  // Total credit cost = sum over selected angles of (copy + image-quality)
  const batchCreditTotal = selectedIds.reduce((sum, id) => {
    const q = imageSettings?.[id]?.quality || 'medium'
    return sum + COPY_COST + (IMAGE_COST[q] || 3)
  }, 0)

  // Export availability: count ads ready for image-zip (imageUrl present)
  // and ads ready for copy-pdf (any copy fields present).
  const adValues = Object.values(ads || {})
  const imageReadyCount = adValues.filter(a => a?.imageUrl).length
  const copyReadyCount = adValues.filter(a => a?.headline || a?.primaryText).length

  const handleDownloadImages = async () => {
    setExporting('images')
    setExportMsg(null)
    try {
      const { downloaded, failed } = await downloadAllImages(ads, angles, formats, brandName)
      setExportMsg({
        kind: failed > 0 ? 'warn' : 'success',
        text: failed > 0
          ? `Downloaded ${downloaded} images · ${failed} failed`
          : `Downloaded ${downloaded} image${downloaded === 1 ? '' : 's'}`,
      })
    } catch (e) {
      setExportMsg({ kind: 'error', text: e.message || 'Download failed' })
    } finally {
      setExporting(null)
      setTimeout(() => setExportMsg(null), 4000)
    }
  }

  const handleExportPdf = () => {
    setExporting('copy')
    setExportMsg(null)
    try {
      const { written } = exportCopyAsPdf(ads, angles, formats, brandName)
      setExportMsg({
        kind: 'success',
        text: `Exported ${written} ad${written === 1 ? '' : 's'} as PDF`,
      })
    } catch (e) {
      setExportMsg({ kind: 'error', text: e.message || 'Export failed' })
    } finally {
      setExporting(null)
      setTimeout(() => setExportMsg(null), 4000)
    }
  }

  const handleClearAllAds = async () => {
    const adCount = adValues.length
    if (adCount === 0) return
    const confirmed = window.confirm(
      `Delete all ${adCount} ad${adCount === 1 ? '' : 's'}?\n\n` +
      `This clears every generated ad in this brand. Angles, brand brief, and uploaded images stay intact. ` +
      `You can regenerate fresh ads from the same angles afterward.\n\nThis cannot be undone.`
    )
    if (!confirmed) return
    setClearing(true)
    setExportMsg(null)
    try {
      await onClearAllAds?.()
      setExportMsg({ kind: 'success', text: `Cleared ${adCount} ad${adCount === 1 ? '' : 's'}` })
    } catch (e) {
      setExportMsg({ kind: 'error', text: e.message || 'Clear failed' })
    } finally {
      setClearing(false)
      setTimeout(() => setExportMsg(null), 4000)
    }
  }

  return (
    <div className="angle-grid-wrap">
      <div className="angle-filter-row">
        <div className="angle-filter-bar">
          {['all', 'tofu', 'mofu', 'bofu'].map(f => (
            <button
              key={f}
              className={`filter-btn ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all'
                ? `All (${angles.length})`
                : `${FUNNEL_SHORT[f]} — ${FUNNEL_LABEL[f]} (${counts[f]})`}
            </button>
          ))}
        </div>
        <div className="angle-select-actions">
          <button className="select-action-btn" onClick={onSelectAll}>Select all</button>
          {selected && selected.size > 0 && (
            <>
              <span className="angle-selected-count">{selected.size} selected</span>
              <button className="select-action-btn" onClick={onClearAll}>Clear</button>
            </>
          )}
        </div>
      </div>

      {/* Batch action + progress strip */}
      {(canBatch || batchGenerating || total > 0) && (
        <div className="angle-batch-bar">
          <div className="angle-batch-left">
            {batchGenerating
              ? <span className="angle-batch-spin">⟳</span>
              : <span className="angle-batch-spark">✨</span>}
            <span className="angle-batch-status">
              {batchGenerating
                ? `Generating · ${doneCount}/${total} done · ${inFlight} in flight${errored ? ` · ${errored} errored` : ''}`
                : total > 0
                  ? `${doneCount}/${total} ads ready${errored ? ` · ${errored} errored` : ''}`
                  : `${selectedIds.length} angles selected`}
            </span>
          </div>
          <div className="angle-batch-right">
            <button
              className="angle-batch-btn"
              onClick={() => onRunBatch && onRunBatch(selectedIds)}
              disabled={!canBatch}
            >
              {batchGenerating
                ? 'Generating…'
                : `Generate ${selectedIds.length} ad${selectedIds.length === 1 ? '' : 's'}${batchCreditTotal > 0 ? ` · ${batchCreditTotal} cr` : ''}`}
            </button>
          </div>
        </div>
      )}

      {/* Export bar — visible when there's anything to export */}
      {(imageReadyCount > 0 || copyReadyCount > 0) && (
        <div className="angle-export-bar">
          <div className="angle-export-left">
            <span className="angle-export-icon">📦</span>
            <span className="angle-export-status">
              Ready to export
              {exportMsg && (
                <span className={`angle-export-msg angle-export-msg-${exportMsg.kind}`}>
                  · {exportMsg.text}
                </span>
              )}
            </span>
          </div>
          <div className="angle-export-right">
            <button
              className="angle-export-btn"
              onClick={handleDownloadImages}
              disabled={imageReadyCount === 0 || exporting !== null}
              title={imageReadyCount === 0 ? 'No images yet' : `Download ${imageReadyCount} images as ZIP`}
            >
              {exporting === 'images'
                ? 'Zipping…'
                : `🖼 Download ${imageReadyCount} image${imageReadyCount === 1 ? '' : 's'}`}
            </button>
            <button
              className="angle-export-btn"
              onClick={handleExportPdf}
              disabled={copyReadyCount === 0 || exporting !== null}
              title={copyReadyCount === 0 ? 'No copy yet' : `Export ${copyReadyCount} ads' copy as PDF`}
            >
              {exporting === 'copy'
                ? 'Building PDF…'
                : `📝 Export ${copyReadyCount} ad${copyReadyCount === 1 ? '' : 's'} (PDF)`}
            </button>
            <button
              className="angle-export-btn angle-export-btn-danger"
              onClick={handleClearAllAds}
              disabled={adValues.length === 0 || clearing || exporting !== null || batchGenerating}
              title={
                adValues.length === 0
                  ? 'No ads to clear'
                  : batchGenerating
                    ? 'Wait for generation to finish'
                    : `Delete all ${adValues.length} ads (keeps angles)`
              }
            >
              {clearing ? 'Clearing…' : `🗑 Clear all ${adValues.length} ad${adValues.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {visible.length === 0 && (
        <div className="angle-empty">No angles in this funnel stage yet.</div>
      )}

      <div className="angle-grid">
        {visible.map(angle => {
          const isSelected = selected?.has(angle.id) || false
          const stage = angle.funnelStage || 'tofu'
          const formatId = selectedFormats?.[angle.id] || ''
          const isSuggestion = angle.suggestedFormatIds?.[0] === formatId
          const adKey = formatId ? `${angle.id}_${formatId}` : null
          const ad = adKey ? (ads?.[adKey] || null) : null
          const adStage = stages[angle.id]
          const expanded = expandedAngles?.has(angle.id) || false
          const isGenerating = adStage === 'generating-copy' || adStage === 'generating-image'
          const error = adErrors?.[angle.id]

          return (
            <div
              key={angle.id}
              className={`angle-card ${isSelected ? 'selected' : ''} ${expanded ? 'expanded' : ''} ${adStage ? `stage-${adStage}` : ''}`}
            >
              {/* Header — clickable for selection */}
              <div
                className="angle-card-top"
                onClick={(e) => {
                  // Don't toggle selection when clicking on dropdowns/buttons
                  if (e.target.closest('.angle-format-select')) return
                  if (e.target.closest('.angle-card-actions')) return
                  onToggle && onToggle(angle.id)
                }}
              >
                <span className={`funnel-badge ${FUNNEL_COLOR[stage] || 'funnel-tofu'}`}>
                  {FUNNEL_SHORT[stage] || stage.toUpperCase()}
                </span>
                {adStage && (
                  <span className={`angle-stage-pill stage-${adStage}`}>
                    {adStage === 'generating-copy' || adStage === 'generating-image'
                      ? <span className="angle-stage-dot" />
                      : null}
                    {STAGE_LABEL[adStage] || adStage}
                  </span>
                )}
                <div className={`angle-check ${isSelected ? 'checked' : ''}`}>
                  {isSelected ? '✓' : ''}
                </div>
              </div>

              {/* Compact body */}
              {!expanded && (
                <>
                  <p className="angle-avatar">{angle.avatar}</p>
                  <p className="angle-pain">{angle.pain}</p>
                  <p className="angle-insight">"{angle.insightLine}"</p>

                  {/* Format selector */}
                  <div className="angle-format-row">
                    <label className="angle-format-label">Format</label>
                    <div className="angle-format-select-wrap">
                      <select
                        className="angle-format-select"
                        value={formatId}
                        onChange={(e) => onFormatChange && onFormatChange(angle.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <option value="">— Pick a format —</option>
                        <optgroup label="Top of funnel">
                          {formats.filter(f => f.funnel === 'tofu').map(f =>
                            <option key={f.id} value={f.id}>{f.name}</option>)}
                        </optgroup>
                        <optgroup label="Mid funnel">
                          {formats.filter(f => f.funnel === 'mofu').map(f =>
                            <option key={f.id} value={f.id}>{f.name}</option>)}
                        </optgroup>
                        <optgroup label="Bottom funnel">
                          {formats.filter(f => f.funnel === 'bofu').map(f =>
                            <option key={f.id} value={f.id}>{f.name}</option>)}
                        </optgroup>
                      </select>
                      {isSuggestion && formatId && (
                        <span className="angle-suggested-tag" title="This is the AI's top format pick for this angle">✨ suggested</span>
                      )}
                    </div>
                  </div>

                  {/* Generation overlay / preview */}
                  {isGenerating && (
                    <div className="angle-gen-strip">
                      <span className="angle-gen-spinner" />
                      <span>{adStage === 'generating-copy' ? 'Writing copy…' : 'Rendering image…'}</span>
                    </div>
                  )}

                  {error && (
                    <div className="angle-error-strip">{error}</div>
                  )}

                  {adStage === 'done' && ad && (
                    <div className="angle-result-strip">
                      {ad.imageUrl ? (
                        <img className="angle-result-thumb" src={ad.imageUrl} alt="Generated ad" />
                      ) : (
                        <div className="angle-result-placeholder">No image yet</div>
                      )}
                      <div className="angle-result-meta">
                        {ad.headline && <div className="angle-result-headline">{ad.headline}</div>}
                        {ad.scores && (
                          <div className="angle-result-scores">
                            {Object.entries(ad.scores).map(([k, v]) => (
                              <span key={k} className={`angle-mini-score ${v >= 9 ? 'good' : v >= 7 ? 'ok' : 'bad'}`}>
                                {k} {v}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Card actions — image-settings selectors on the left,
                      action button on the right. Selectors stay disabled
                      during generation (they only matter on next click). */}
                  <div className="angle-card-actions">
                    <div className="angle-img-settings">
                      <select
                        className="angle-img-select"
                        value={(imageSettings?.[angle.id]?.size) || '1024x1024'}
                        onChange={(e) => onImageSettingChange && onImageSettingChange(angle.id, 'size', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        disabled={isGenerating}
                        title="Aspect ratio"
                      >
                        {ASPECTS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                      </select>
                      <select
                        className="angle-img-select quality"
                        value={(imageSettings?.[angle.id]?.quality) || 'medium'}
                        onChange={(e) => onImageSettingChange && onImageSettingChange(angle.id, 'quality', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        disabled={isGenerating}
                        title="Image quality"
                      >
                        {QUALITIES.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
                      </select>
                    </div>
                    {adStage === 'done' ? (
                      <button
                        className="angle-card-action-btn primary"
                        onClick={(e) => { e.stopPropagation(); onToggleExpand && onToggleExpand(angle.id) }}
                      >
                        Open ad ↗
                      </button>
                    ) : adStage === 'error' ? (
                      <button
                        className="angle-card-action-btn"
                        onClick={(e) => { e.stopPropagation(); onRunBatch && onRunBatch([angle.id]) }}
                      >Retry</button>
                    ) : !isGenerating && formatId ? (
                      <button
                        className="angle-card-action-btn"
                        onClick={(e) => { e.stopPropagation(); onRunBatch && onRunBatch([angle.id]) }}
                      >Generate this one</button>
                    ) : null}
                  </div>
                </>
              )}

              {/* Expanded body — full AdBuilder for fine editing */}
              {expanded && (
                <div className="angle-card-expanded">
                  <div className="angle-expanded-head">
                    <div>
                      <p className="angle-avatar">{angle.avatar}</p>
                      <p className="angle-insight">"{angle.insightLine}"</p>
                    </div>
                    <button
                      className="angle-card-action-btn"
                      onClick={(e) => { e.stopPropagation(); onToggleExpand && onToggleExpand(angle.id) }}
                    >✕ Close</button>
                  </div>
                  <AdBuilder
                    angle={angle}
                    formats={formats}
                    selectedFormatId={formatId}
                    onFormatChange={(fid) => onFormatChange && onFormatChange(angle.id, fid)}
                    ad={ad}
                    adKey={adKey}
                    sessionId={sessionId}
                    onAdUpdate={onAdUpdate}
                    onGenerateCopy={(chosenHook) => onGenerateCopy && onGenerateCopy(angle.id, chosenHook)}
                    angleId={angle.id}
                    generatingCopy={adKey ? (generatingCopy?.[adKey] || false) : false}
                    onGenerateImage={(opts) => onGenerateImage && onGenerateImage(angle.id, formatId, opts)}
                    generatingImage={adKey ? (generatingImage?.[adKey] || false) : false}
                    imageStatus={adKey ? (imageStatuses?.[adKey] || null) : null}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

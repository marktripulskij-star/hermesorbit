import React, { useState } from 'react'
import './ConceptGrid.css'

const STATUS_LABEL = { queued: 'Queued…', in_progress: 'Generating…', canceled: 'Cancelled' }

function ConceptCard({ concept, imageResult, imageStatus, selected, onToggle, generatingImages }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`concept-card ${selected ? 'selected' : ''}`}>
      <div className="card-select-row">
        <label className="checkbox-wrap">
          <input type="checkbox" checked={selected} onChange={onToggle} />
          <span className="checkbox-label">#{concept.id}</span>
        </label>
        <span className="angle-tag">{concept.angle}</span>
      </div>

      <h3 className="card-headline">{concept.headline}</h3>

      {imageResult && !imageResult.error && (
        <div className="card-image-wrap">
          <img src={imageResult.imageUrl} alt={concept.headline} className="card-image" />
          <a href={imageResult.imageUrl} target="_blank" rel="noreferrer" className="img-download">↗ Full size</a>
        </div>
      )}
      {imageResult?.error && (
        <div className="card-img-error">Image error: {imageResult.error}</div>
      )}
      {generatingImages && selected && !imageResult && (
        <div className="card-img-loading">
          <span className="spinner" />
          {STATUS_LABEL[imageStatus] || 'Waiting…'}
        </div>
      )}

      <p className="card-hook">{concept.hook}</p>

      {expanded && (
        <>
          <p className="card-body">{concept.body}</p>
          <div className="card-meta">
            <span className="meta-chip">🎯 {concept.targetAvatar}</span>
            <span className="meta-chip cta-chip">→ {concept.cta}</span>
          </div>
          {concept.adLayout && (
            <details className="prompt-details">
              <summary>Ad layout & design</summary>
              <p className="prompt-text">{concept.adLayout}</p>
            </details>
          )}
          <details className="prompt-details">
            <summary>Image prompt</summary>
            <p className="prompt-text">{concept.imagePrompt}</p>
          </details>
        </>
      )}

      <button className="expand-btn" onClick={() => setExpanded(e => !e)}>
        {expanded ? '▲ Less' : '▼ More'}
      </button>
    </div>
  )
}

export default function ConceptGrid({ concepts, imageResults, imageStatuses, selected, onToggleSelect, generatingImages }) {
  if (!concepts.length) return null

  return (
    <div className="concept-grid">
      {concepts.map(c => (
        <ConceptCard
          key={c.id}
          concept={c}
          imageResult={imageResults[c.id]}
          imageStatus={imageStatuses?.[c.id]}
          selected={selected.has(c.id)}
          onToggle={() => onToggleSelect(c.id)}
          generatingImages={generatingImages}
        />
      ))}
    </div>
  )
}

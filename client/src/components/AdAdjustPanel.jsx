// Inline chat panel for refining a generated ad's copy with AI.
// Mirrors the brief Adjust pattern: textarea + suggested instructions +
// Apply button. Calls POST /api/ads/adjust → Haiku rewrites the four
// copy fields, panel calls onApplied(updatedCopy) so the parent can
// update both local editedCopy and global ads[adKey].
//
// Props:
//   sessionId, adKey       — server identifiers
//   currentCopy            — current displayed copy (incl. local edits)
//   onApplied(newCopy)     — called when AI returns; parent refreshes UI
//
// The panel toggles open/closed via a button passed to the parent. We
// expose <AdAdjustPanel.Toggle/> for the trigger button so AdBuilder can
// place it inline next to the Self-critique row, while the panel itself
// renders below.

import React, { useState } from 'react'
import { authedFetch } from '../lib/supabase.js'
import { useMe } from '../lib/MeContext.jsx'
import './AdAdjustPanel.css'

const SUGGESTIONS = [
  'Make the headline punchier',
  'Shorten the primary text',
  'Make the CTA more urgent',
  'Rewrite in second person',
  'Add specificity — names, numbers, real details',
]

export default function AdAdjustPanel({ sessionId, adKey, currentCopy, onApplied, onClose }) {
  const { refresh: refreshMe, checkPaymentRequired } = useMe()
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function submit() {
    const trimmed = instruction.trim()
    if (!trimmed || !sessionId || !adKey) return
    setBusy(true); setErr(null)
    try {
      const r = await authedFetch('/api/ads/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          adKey,
          instruction: trimmed,
          currentCopy: currentCopy ? {
            headline: currentCopy.headline,
            primaryText: currentCopy.primaryText,
            description: currentCopy.description,
            ctaButton: currentCopy.ctaButton,
          } : null,
        }),
      })
      if (await checkPaymentRequired(r)) return
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      const j = await r.json()
      onApplied && onApplied(j.ad)
      setInstruction('')
      refreshMe()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ad-adjust-panel">
      <div className="ad-adjust-head">
        <span className="ad-adjust-label">✨ Adjust this ad</span>
        {onClose && (
          <button className="ad-adjust-close" onClick={onClose} title="Close" aria-label="Close">✕</button>
        )}
      </div>
      <textarea
        className="ad-adjust-input"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="e.g. Make the headline shorter and add a price to the description."
        rows={3}
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
        }}
      />
      <div className="ad-adjust-suggestions">
        {SUGGESTIONS.map(s => (
          <button
            key={s}
            type="button"
            className="ad-adjust-suggestion"
            onClick={() => setInstruction(s)}
            disabled={busy}
          >{s}</button>
        ))}
      </div>
      {err && <div className="ad-adjust-err">{err}</div>}
      <div className="ad-adjust-row">
        <button
          className="ad-adjust-submit"
          onClick={submit}
          disabled={busy || !instruction.trim()}
        >
          {busy ? 'Adjusting…' : 'Apply'}
        </button>
        <span className="ad-adjust-hint">⌘+Enter to apply · ~$0.005/edit · doesn't regen image</span>
      </div>
    </div>
  )
}

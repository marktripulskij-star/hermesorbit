import React, { useState } from 'react'
import { authedFetch } from '../lib/supabase.js'
import { useMe } from '../lib/MeContext.jsx'
import './BriefCard.css'

const SUGGESTIONS = [
  'The price is wrong, fix it to $39 bundle',
  'Add an avatar of someone in their 50s',
  'The brand voice is too corporate, make it punchier',
  'Add 3 more market gaps I might be missing',
]

// Renders the brand brief. Defensive against schema drift — handles both:
//   v1: brandVoice: string,        proofPoints: string[]
//   v2: brandVoice: {summary,...}, proofPoints: [{claim, source}]
//        + marketGaps[], inferredCompetitors[]
export default function BriefCard({ brief, sessionId, onBriefUpdated }) {
  const { refresh: refreshMe, checkPaymentRequired } = useMe()
  const [expanded, setExpanded] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function submitAdjust() {
    const i = instruction.trim()
    if (!i) return
    setBusy(true); setErr(null)
    try {
      const r = await authedFetch('/api/brand-brief/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, instruction: i }),
      })
      if (await checkPaymentRequired(r)) return
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      const j = await r.json()
      onBriefUpdated && onBriefUpdated(j.brandBrief)
      setInstruction('')
      setAdjustOpen(false)
      refreshMe()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  // Normalize voice
  const voiceSummary = typeof brief.brandVoice === 'string'
    ? brief.brandVoice
    : (brief.brandVoice?.summary || '')
  const voiceSays = brief.brandVoice?.saysLike || []
  const voiceNever = brief.brandVoice?.neverSaysLike || []

  // Normalize proofPoints
  const proofs = (brief.proofPoints || []).map(p =>
    typeof p === 'string' ? { claim: p, source: null } : p
  )

  return (
    <div className="brief-card">
      <div className="brief-top">
        <div className="brief-product-line">
          <span className="brief-product-name">{brief.product?.name}</span>
          {brief.product?.price && <span className="brief-chip">{brief.product.price}</span>}
          {brief.product?.category && <span className="brief-chip">{brief.product.category}</span>}
        </div>
        <p className="brief-differentiator">{brief.product?.keyDifferentiator}</p>
        <div className="brief-actions">
          <button className="brief-expand-btn" onClick={() => setExpanded(e => !e)}>
            {expanded ? '▲ Less' : '▼ Full brief'}
          </button>
          <button
            className={`brief-adjust-btn ${adjustOpen ? 'open' : ''}`}
            onClick={() => setAdjustOpen(o => !o)}
            title="Refine the brief with AI"
          >
            ✨ Adjust
          </button>
        </div>

        {adjustOpen && (
          <div className="brief-adjust-panel">
            <label className="brief-adjust-label">
              Tell the AI what to change
            </label>
            <textarea
              className="brief-adjust-input"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. The bundle on the homepage is $39, not $59. Update the price."
              rows={3}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitAdjust()
              }}
            />
            <div className="brief-adjust-suggestions">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  className="brief-adjust-suggestion"
                  onClick={() => setInstruction(s)}
                  disabled={busy}
                >{s}</button>
              ))}
            </div>
            {err && <div className="brief-adjust-err">{err}</div>}
            <div className="brief-adjust-row">
              <button
                className="brief-adjust-submit"
                onClick={submitAdjust}
                disabled={busy || !instruction.trim()}
              >
                {busy ? 'Adjusting…' : 'Apply'}
              </button>
              <span className="brief-adjust-hint">⌘+Enter to apply · ~$0.005/edit</span>
            </div>
          </div>
        )}
      </div>

      {expanded && (
        <div className="brief-body">
          {brief.avatars?.length > 0 && (
            <div className="brief-section">
              <div className="brief-section-label">
                Avatars <span className="brief-count">{brief.avatars.length}</span>
              </div>
              {brief.avatars.map((a, i) => (
                <div key={i} className="brief-avatar">
                  <div className="brief-avatar-head">
                    <span className="brief-avatar-name">{a.name}</span>
                    {a.source === 'inferred' && <span className="brief-tag-inferred">inferred</span>}
                  </div>
                  {a.demographics && <span className="brief-avatar-demo">{a.demographics}</span>}
                  <span className="brief-avatar-desire">Wants: {a.topDesire}</span>
                  <span className="brief-avatar-fear">Fears: {a.topFear}</span>
                  {a.currentSituation && <span className="brief-avatar-sit">{a.currentSituation}</span>}
                </div>
              ))}
            </div>
          )}

          <div className="brief-two-col">
            {brief.corePains?.length > 0 && (
              <div className="brief-section">
                <div className="brief-section-label">
                  Core Pains <span className="brief-count">{brief.corePains.length}</span>
                </div>
                <ul className="brief-list">
                  {brief.corePains.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}
            {brief.coreDesires?.length > 0 && (
              <div className="brief-section">
                <div className="brief-section-label">
                  Core Desires <span className="brief-count">{brief.coreDesires.length}</span>
                </div>
                <ul className="brief-list">
                  {brief.coreDesires.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            )}
          </div>

          {proofs.length > 0 && (
            <div className="brief-section">
              <div className="brief-section-label">
                Proof Points <span className="brief-count">{proofs.length}</span>
              </div>
              <ul className="brief-list">
                {proofs.map((p, i) => (
                  <li key={i}>
                    {p.claim}
                    {p.source === 'inferred' && <span className="brief-tag-inferred">inferred</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {brief.competitorGaps?.length > 0 && (
            <div className="brief-section">
              <div className="brief-section-label">
                Competitor Gaps <span className="brief-count">{brief.competitorGaps.length}</span>
              </div>
              <ul className="brief-list">
                {brief.competitorGaps.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            </div>
          )}

          {brief.marketGaps?.length > 0 && (
            <div className="brief-section">
              <div className="brief-section-label">
                Market Gaps <span className="brief-count">{brief.marketGaps.length}</span>
              </div>
              <ul className="brief-list">
                {brief.marketGaps.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            </div>
          )}

          {brief.inferredCompetitors?.length > 0 && (
            <div className="brief-section">
              <div className="brief-section-label">
                Likely Competitors <span className="brief-count">{brief.inferredCompetitors.length}</span>
              </div>
              <ul className="brief-list">
                {brief.inferredCompetitors.map((c, i) => (
                  <li key={i}>
                    <strong className="brief-competitor-name">{c.name}</strong>
                    {c.differentiation ? ` — ${c.differentiation}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {brief.currentOffers?.length > 0 && (
            <div className="brief-section">
              <div className="brief-section-label">
                Active Offers <span className="brief-count">{brief.currentOffers.length}</span>
              </div>
              <ul className="brief-list">
                {brief.currentOffers.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </div>
          )}

          {voiceSummary && (
            <div className="brief-section">
              <div className="brief-section-label">Brand Voice</div>
              <p className="brief-voice">{voiceSummary}</p>
              {(voiceSays.length > 0 || voiceNever.length > 0) && (
                <div className="brief-voice-grid">
                  {voiceSays.length > 0 && (
                    <div>
                      <div className="brief-voice-sublabel">Says like</div>
                      <ul className="brief-list">
                        {voiceSays.map((s, i) => <li key={i}>"{s}"</li>)}
                      </ul>
                    </div>
                  )}
                  {voiceNever.length > 0 && (
                    <div>
                      <div className="brief-voice-sublabel">Never says</div>
                      <ul className="brief-list">
                        {voiceNever.map((s, i) => <li key={i}>"{s}"</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

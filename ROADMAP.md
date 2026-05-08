# Ad Studio — Roadmap

> Living strategic plan. Updated as priorities shift. Companion to `FEATURES.md` (which captures *current* state).
> North star: become the best AI ad generator. Output quality first, UI rebuild last.

## North Star
- HYPER-good copy on every ad: headline, primary text, description, CTA
- HYPER-good images that one-shot (text rendered, brand-faithful, ad-conversion-grade)
- Public SaaS launch eventually — every architectural choice must respect margins

## Current state — honest read
- Output is *acceptable* but generic. Angles feel surface-level. Copy is correct but rarely breakthrough.
- Root cause: brand brief is one shallow GPT-4o pass. The Schwartz framework calls for 6 separate research passes — we run 1.
- Image quality is now solid (gpt-image-2 + dedicated art-director call). Not the bottleneck.
- UI is intentionally rough. **Defer UI rebuild until the engine is consistently great.**

---

## Tier 1 — Output quality (do these first; biggest impact)

### 1.1 Schwartz research pipeline (multi-pass brief)
**Status:** not started
**Why:** every angle is currently rooted in summary, not evidence. Real DR copy is rooted in actual customer language, real competitor positions, and validated mass desire.
**What to build:** brief generation becomes 6 sequential steps, each persisting its own JSON in the session.
1. Awareness research — distribution across Schwartz's 5 stages, evidence-based
2. Competitor research — 5+ competitors, their hooks/offers/positioning gaps
3. Avatar deep-dive — 3 avatars with day-in-life, language patterns, specific fears/desires
4. Mass desire extraction — pulled from forum/Reddit/review data
5. Mass desire validation — score each desire by frequency + intensity
6. Master research doc — compiled brief with cross-references

Cost: **~$1.00-1.50 per brand, ONE-TIME** (cached forever unless user redoes).
Mitigation: use gpt-4o-mini for compile/extraction passes (10× cheaper). Tiered toggle in UI: Basic ($0.30) vs Deep ($1.50).

### 1.2 Hook separation (generate-then-pick) ✅ SHIPPED 2026-05-01
**Status:** shipped. Sonnet for hook generation (creativity matters here, not cost).
**What was built:** `generateHookCandidates()` in `server/index.js` produces 10 distinct hooks across different patterns (contrarian, shocking moment, authority shock, ultra-specific detail, casual confession, statistical surprise, etc.) and emotional registers. New `/api/generate-hooks` endpoint. AdBuilder inline "Pick your hook" picker appears after clicking Generate Copy — user picks one of 10, writes their own, or skips. Chosen hook locked verbatim into body via system prompt; stored on ad as `chosenHook`.
**Actual cost:** ~$0.015/click on Generate Copy added.

### 1.3 Self-critique + revise loop ✅ SHIPPED 2026-04-30
**Status:** shipped. Uses Claude Haiku 4.5 for critique pass.
**What was built:** `critiqueAndReviseCopy()` in `server/index.js`. Runs after Sonnet drafts the copy, before art-director image prompt. Scores ad on hook/mechanism/voice/cta (1-10), rewrites sections scoring <8, returns revised copy + scores + critique. Image prompt now generated from revised copy. Scores shown as colored chips (green ≥9, yellow 7-8, red <7) at top of AdBuilder copy section, with collapsible "why?" critique text.
**Actual cost:** ~$0.02-0.05/ad added (Haiku is cheap enough that it's basically free).

### 1.4 Facebook Ad Library competitor ingestion
**Status:** not started
**Why:** angles are generic because the model has no idea what's already out there. Real ad strategy is differentiation.
**What to build:** scraper for `facebook.com/ads/library`. User pastes competitor name → we pull their last 50 active ads (text + visual thumbnails) → feed into angle generation as "differentiate from these" + "match this aesthetic ceiling."
Cost: ~$0.05/competitor analyzed (mostly fetch + one summary Claude call).
ROI: difference between generic and breakthrough.

---

## Tier 2 — Usability wins (after T1)

### 2.1 Batch generation
"Generate copy for all selected angles" button → parallel Claude calls (Promise.all) for all selected angles.
"Generate images for all ads" → parallel image gen.
Saves 10-50 manual clicks per session.

### 2.2 Variation mode
For any ad, "Generate 3 variations" → 3 different hooks/openers, same angle + format. Side-by-side comparison view. Star the winner.

### 2.3 Ad history + favorites
Don't wipe on regenerate. Each `ad` becomes a list of versions. Star/favorite mechanism. UI shows version count + lets you revert.

### 2.4 CSV export
One-click export of all ads to a CSV with Meta Ads Manager column headers. Headline, Primary Text, Description, CTA Button, Image URL — done.

### 2.5 Brand brief inline editing
Currently the brief is read-only JSON. Make every field editable so user can override the model. Persists back to session.

---

## Tier 3 — Quality polish (after T2)

- **Customer review scraping** — Trustpilot, Amazon, BBB. Real customer language → much better proof points and avatar voice.
- **Reference ad upload + visual style analysis** — user uploads 3 reference ads, model matches that aesthetic in the prompt.
- **Multi-aspect parallel generation** — one click → 1:1 + 4:5 + 9:16 + 16:9 from same prompt. For brands running across all placements.
- **Image-prompt revision loop** — after image generates, ask Claude "rate text legibility 1-10, suggest fix" → option to regenerate prompt with the fix applied.
- **Brand voice consistency check** — Claude scores each generated ad against the brand voice profile. Flags drift.
- **Multi-user collab** — sessions become shared, multiple editors.

---

## Cost discipline (read before building anything)

Every new feature must justify its cost in this framework:

| Cost class | Per ad | Strategy |
|---|---|---|
| Sonnet 4.6 | $0.05-0.10 | Use for *creative writing* and *critical reasoning*. Don't waste on extraction/scoring. |
| GPT-4o | $0.02-0.05 | Use for *structured JSON extraction*. Reliable, cheap. |
| GPT-4o-mini | $0.005-0.01 | Use for *summarization, compilation, simple text tasks*. 10× cheaper than 4o. |
| Claude Haiku | ~$0.01 | Use for *scoring, classification, critique*. 5× cheaper than Sonnet. |
| gpt-image-2 medium | ~$0.05 | Use for *final ad images*. Best text rendering. |
| gpt-image-1-mini medium | ~$0.008 | Use for *draft mode / iteration*. |

**Rule of thumb:** match the model to the task. Don't pay Sonnet rates for what Haiku does fine.

---

## Recommended order of attack
1. **Self-critique loop** (1.3) — smallest change, biggest measurable lift. Ship in 1 session.
2. **Hook separation** (1.2) — together with 1.3 this addresses 80% of "copy is good not great." 1 session.
3. **Research pipeline** (1.1) — biggest lift but multi-day effort. The moat-builder.
4. **FB Ad Library scraper** (1.4) — once research pipeline exists, this slots in as another data source.
5. **Tier 2 usability** — only after Tier 1 ships. Don't optimize the dashboard for a mediocre engine.
6. **Tier 3 polish** — when output is consistently great and you're ready to differentiate on depth.

---

## Updates to this doc
Append to a "Changes" section below as priorities shift, items ship, or new ideas arrive. Don't delete completed items — move them to a "Shipped" section so we keep history.

## Changes
- 2026-04-30: Initial roadmap drafted.

## Shipped (move items here when complete)
- **2026-05-01 — Tier 1.2: Hook separation.** New `/api/generate-hooks` endpoint generates 10 distinct hook candidates (Sonnet, $0.015/call). AdBuilder shows inline picker; selected hook is locked verbatim into the body. Custom-hook input + skip option included. Every ad's first sentence is now deliberate, not a byproduct.
- **2026-04-30 — De-templating.** Replaced rigid `copyStructure` paragraph templates in all 20 AD_FORMATS with high-level `intent` (strategic + emotional purpose). Same for `imagePrompt` → `visualDirection` (mood only). System prompt explicitly bans generic "Para 1: Hook. Para 2: Pain..." structures and tells Claude to design the shape per angle. Eliminates the formulaic feel — two ads on different angles using the same format now look structurally different.
- **2026-04-30 — Tier 1.3: Self-critique + revise loop.** Claude Haiku scores every generated ad on 4 axes, rewrites weak sections, image prompt regenerated from final copy. Scores surfaced in UI as colored chips. ~$0.02-0.05/ad added. Output quality jump immediately visible.

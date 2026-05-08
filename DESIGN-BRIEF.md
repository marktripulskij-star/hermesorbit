# Ultemir — Claude Design Brief

> Paste this entire doc into Claude Design's chat to seed context. Then design screen-by-screen.

---

## 1. The product in one paragraph

Ultemir is an AI ad generator for DTC brands. Users upload their brand docs and website, we crawl + analyze it, build a deep brand brief, surface 20 testing angles rooted in real customer language, and let users generate Meta ad copy + images in seconds. Each ad gets self-critiqued by a second AI pass before delivery. Output is consistently strong direct-response work — the kind a senior performance marketer would actually run, not generic "transform your life" filler. Multi-project (a user has many brands), credit-based pricing, B2B SaaS desktop-first.

## 2. Brand identity

- **Name:** Ultemir
- **Domain:** ultemir.com
- **Logo:** Electric-lime "U" with a rising arrow, on near-black background. Conveys: performance, growth, conversion energy.
- **Palette:**
  - Background: `#0a0a0a` (near-black, primary canvas)
  - Surface: `#161616` (cards, panels)
  - Surface elevated: `#1f1f1f` (modals, popovers)
  - **Primary accent: `#c5ff3d` (electric lime)** — buttons, focus, brand highlights
  - Secondary accent: `#a5e62a` (darker lime, hover states)
  - Accent dim: `rgba(197, 255, 61, 0.12)` for chips, badges, hover backgrounds
  - Text primary: `#f5f5f5`
  - Text muted: `#888`
  - Border: `#2a2a2a`
  - Success: `#4ade80` · Warning: `#facc15` · Danger: `#f87171`
- **Typography:**
  - Sans: Inter (or system) for UI, data, body
  - Mono: SF Mono / JetBrains Mono for numbers, codes, costs
  - No serifs
- **Voice (UI copy):** direct, confident, performance-marketer to performance-marketer. No fluff. "Generate" not "Let's create." "Out of credits" not "Oops, looks like you've run out." Numbers and specifics > hedge words.
- **Visual feel:** dense but readable, terminal-meets-Notion, every pixel earns its place. NOT sleek-and-airy. NOT corporate. Closer to Linear / Raycast / Framer than Mailchimp.

## 3. Users (B2B desktop-first)

- **Primary:** Indie DTC founders + in-house performance marketers running Meta ads. Run 5-50 ads/week. Need volume + quality.
- **Secondary:** Small agency owners managing 3-15 brands. Need multi-tenant org structure (post-launch).
- **Tertiary:** Freelance copywriters using Ultemir as a research/draft tool.

All desktop-first. Mobile is read-only at most for v1.

## 4. Information architecture

```
Marketing site (ultemir.com)
 ├─ /                  Hero, founder story, demo, format library, pricing, FAQ, sign up
 ├─ /pricing           Tier comparison
 ├─ /privacy, /terms   Legal
 └─ /login, /signup    Auth (could be in-app)

App (app.ultemir.com)
 ├─ /                  Project list (dashboard)
 ├─ /onboarding        First-time wizard (inline overlay on first project)
 ├─ /p/:slug           Workspace (project detail — the main work surface)
 │   ├─ Brief tab      Brand brief view + editor
 │   ├─ Angles tab     20 angles, filter, multi-select
 │   ├─ Build tab      Ad builder (the existing functionality, cleaned)
 │   └─ Library tab    All generated ads in this project, filter/sort/star
 ├─ /settings          Account, billing, credit history
 └─ /logout
```

## 5. Screens — what to design

### 5.1 Landing page (`ultemir.com`)

**Purpose:** convert performance marketers + DTC founders into trial signups.

Sections, top to bottom:
1. **Nav** — logo (lime "U" arrow), links: Features · Pricing · Login · "Start free trial" (lime button)
2. **Hero** — fullscreen, dark.
   - One-line headline: punchy, specific. (e.g. "Generate the Meta ads your competitors wish they could.")
   - Sub: 1-2 lines, what it actually does
   - Primary CTA: "Start free — 30 credits, no card"
   - Hero visual: animated demo loop showing the workflow OR a stack of generated ads with text overlays already rendered (proves the text-rendering quality)
3. **Founder story** — face photo, 3-4 short paragraphs in first person. Why I built this, what I tried, what's broken about existing tools, what makes Ultemir different. Personal and specific.
4. **How it works** — 3 steps with screenshots: 1) Drop in your docs + website 2) We build the brief, surface 20 angles 3) Generate dozens of ads with one click
5. **Format library showcase** — 20 formats as visual cards. Funnel-grouped (TOFU/MOFU/BOFU). Each card: name + 1-line description. Static, scrollable carousel feel.
6. **Sample ads** — 6-8 actual generated ads displayed at 1024×1024. The work speaks for itself.
7. **Pricing** — 4 tiers as a comparison table (see 5.4)
8. **FAQ** — 6-8 questions. "How does it work?" "Will it sound like my brand?" "What does it cost per ad?" "Can I edit?" etc.
9. **Final CTA** — repeat hero CTA
10. **Footer** — minimal

### 5.2 Auth screens (signup, login, reset password)

Minimal, dark-themed, centered card. Logo at top. Email + password (or magic link). Social: Google. Bottom link: "← Back to ultemir.com." Error states inline (red tint to input border + message below).

### 5.3 Onboarding wizard (first project create)

Triggered after signup if user has 0 projects. **Full-screen modal overlay**, dismissible only on completion.

**Step 1/5: Name your brand**
- Single input, large, centered. "What's the brand called?"
- Helper text: "You can have unlimited brands — each is its own project."
- Continue button (lime, disabled until input)

**Step 2/5: Paste your website**
- Large URL input
- Live progress as we crawl: "Fetching homepage… → Found 14 products → Scraping /about… → Extracting brand colors…"
- Progress bar with each step ticking
- Optional skip button (small, muted)

**Step 3/5: Upload your brand assets**
- Two drop zones side-by-side: "Logo" and "Product photo"
- Drag-drop or click. Auto-classified after upload.
- Color swatches surface as we extract
- Optional skip

**Step 4/5: Anything else? (optional)**
- Drag-drop for brand docs (PDFs, brand guidelines)
- Textarea for "Active offers" — paste current promos
- Helper: "Anything you give us makes the ads better. Skip if you're in a rush."

**Step 5/5: We're learning your brand…**
- Loading state with live status: "Analyzing 14 products… Finding your avatars… Extracting your voice… Generating 20 testing angles…"
- Estimated time: ~60-90s
- On complete: "Ready. You used 8 credits. Let's build your first ad."
- CTA: "Open workspace →"

**Tone:** confident, fast, magical. Not "Welcome to Ultemir, here's how to use our amazing tool." More like: "Drop your stuff in, we'll handle the rest."

### 5.4 Project list (`app.ultemir.com/`)

Header bar (fixed):
- Left: logo + "Ultemir"
- Center: empty (or breadcrumb when in a project)
- Right: credit pill ("214 credits · resets in 12d") + avatar dropdown (Settings / Logout)

Body:
- "Your brands" heading
- Grid of project cards:
  - Each card: brand logo thumbnail, brand name, last updated, # ads generated, # angles
  - Hover: subtle lime border glow
  - Click: opens workspace
- "+ New brand" card at end of grid (dashed border, lime "+")
- Empty state: large illustration, "No brands yet. Let's build your first."

### 5.5 Workspace (`/p/:slug`)

This is the main work surface. Replaces the current single-page UI.

**Layout:**
- Left sidebar (240px, collapsible to 60px):
  - Project name at top (with switcher dropdown to other projects)
  - Tab nav: Brief · Angles · Build · Library
  - Bottom: "Settings" link + small credit indicator
- Main content area: tab content fills remaining width

**Tab: Brief**
- Read view of the brand brief: product, currentOffers, avatars (3 cards), corePains list, coreDesires list, proofPoints, competitorGaps, brandVoice
- Each section editable inline (click to edit)
- Top right: "↺ Re-extract brief" button (uses credits, with confirm)
- Below: collapsible "Source data" section showing the website crawl results, uploaded docs, manual offers (read-only inspector)

**Tab: Angles**
- Header: "20 angles" + filter chips: All · TOFU(8) · MOFU(7) · BOFU(5)
- Right side: "Select all visible" / "Clear" / count badge
- Grid: angle cards (3 per row)
  - Card: funnel badge, avatar tag, pain (1-2 lines), italic insight quote, checkbox
  - Selected state: lime border + lime check
- Bottom action bar (sticky, only visible if ≥1 selected):
  - "X angles selected"
  - **"Generate all"** button (lime, primary) — opens Build tab
  - Estimated cost: "~36 credits"
- Top: "↺ Regenerate angles" button (top-right, uses credits)

**Tab: Build**
- Two-pane layout
- Left pane (320px): list of selected angles as compact rows. Click to focus one. Shows status per angle: ⚪ not started · 🟡 generating · ✅ done · 🔴 needs attention
- Right pane: ad builder for the focused angle
  - Format selector at top (grouped dropdown)
  - "Generate copy" button (or "↺ Regenerate")
  - Once copy is generated:
    - **Score chips at top**: hook 9/10, mechanism 8/10, voice 9/10, cta 9/10 (green/yellow/red coded)
    - "why?" expandable shows critique
    - Headline field (inline editable, char count, copy btn, ✨ AI-edit btn)
    - Primary text field (same)
    - Description (same)
    - CTA dropdown (Meta whitelist)
    - Image prompt field (always visible, editable, ✨ AI-edit, ↺ Regen prompt)
    - Image settings row: aspect (Square / Portrait / Landscape) + quality (Low / Medium / High with cost + time inline)
    - "Generate image" button (or "↺ Regenerate image")
    - Once image: thumbnail (220×220) with click-to-expand, download button, "Open full" link
- Bottom action bar:
  - **"Generate all selected"** (mass generate) — fires copy + image for every selected angle in parallel batches
  - Live progress: "3 of 8 done… 2 generating… 3 queued"
- Per-angle "★ favorite" toggle to save winners

**Tab: Library**
- All ads generated in this project
- Filter row: format, funnel stage, score (≥8 / all), starred only
- Sort: newest / oldest / highest scored
- Grid view of ad cards (image thumbnail + headline + score + format badge)
- Card hover: copy headline / open full / star / delete
- Click card: opens detail view (modal) with full copy + image, edit options
- Multi-select for bulk export ("Export selected as CSV" — Meta Ads Manager format)
- Empty state: "No ads yet. Build some in the Build tab."

### 5.6 Side-by-side comparison view (sub-screen)

Triggered from Library: select 2 ads → "Compare." Modal/full-screen overlay.
- Two columns, identical layout
- Each column: ad image at top, copy below, scores, format badge
- Bottom: "Pick winner" buttons under each. Picking one stars it + closes modal.
- Sized like Meta feed for realistic comparison.

### 5.7 AI-edit chat (component, not screen)

Inline popover triggered by ✨ next to any copy field.
- Small chat interface: "What should I change?"
- Suggested prompts: "make it punchier" · "shorter" · "more conversational" · "add urgency"
- User types or clicks suggestion → AI rewrites just that field → preview appears → "Accept" / "Try again" / "Cancel"
- Cheap (Haiku, ~1 credit per edit)

### 5.8 Settings (`/settings`)

Sub-tabs:
- **Account** — email, password change, delete account
- **Billing** — current plan, change plan, payment method, billing history (downloadable receipts)
- **Credits** — credits remaining, reset date, ledger of last 50 actions (date · action · credits used)
- **API** (post-launch tier) — API keys

### 5.9 Out-of-credits state (overlay)

When user attempts a paid action with insufficient credits:
- Inline tooltip on the disabled button: "Out of credits — top up or upgrade"
- Modal on click: "You're out of credits."
- Two CTAs: "Top up (100 cr for $9 / 500 for $39 / 1500 for $99)" or "Upgrade plan"
- Footer: shows credits resetting in N days if on a paid plan

## 6. Components (design as a system)

- **Button primary** — solid lime on black text, bold, slight letter-spacing. Hover: darker lime. Disabled: grey.
- **Button secondary** — transparent w/ lime border + lime text. Hover: lime-dim background.
- **Button danger** — transparent w/ red-300 border + red-300 text.
- **Input / textarea** — dark surface, lime focus border, char count badge top-right
- **Dropdown / select** — same input style with custom chevron
- **Score chip** — pill, color coded (green ≥9, yellow 7-8, red <7), monospace
- **Funnel badge** — small pill (TOFU green, MOFU yellow, BOFU red — semantic, not brand)
- **Card** — surface bg, 1px border, 12px radius, 18px padding, hover: lime border glow
- **Modal** — center, surface-elevated bg, 80vh max, dismissible
- **Toast** — bottom-right, surface-elevated, auto-dismiss 3s, success green / error red
- **Empty state** — minimal illustration + 1-line message + primary CTA
- **Progress bar** — thin lime, animated fill
- **Spinner** — lime circle, 16px / 24px / 32px sizes
- **Avatar / image upload** — drag-drop dashed border, lime on dragover

## 7. Critical interactions

- **Live crawl progress** during onboarding — server streams via SSE, UI shows step-by-step ticks
- **Mass generation progress** — shows N of M done with per-angle status, runs in parallel
- **Inline editing** — click any field to edit, esc/blur to save, no separate edit mode
- **Drag-drop file upload** — both for brand assets and PDFs
- **Copy-to-clipboard** — every text field has a copy button, brief "Copied!" state
- **Keyboard shortcuts (post-launch but design for them)**:
  - `cmd+k` → command palette / project switcher
  - `cmd+enter` → primary action of current screen
  - `cmd+/` → AI-edit popover

## 8. States to design (don't skip)

- **Loading** — every action that takes >500ms needs a loading state with descriptive text
- **Empty** — every list view needs an empty state
- **Error** — graceful error UI with retry, never raw error strings to user
- **Out of credits** — see 5.9
- **First-time user** — onboarding wizard handles this; otherwise no project = empty dashboard with single CTA
- **Generating in background** — workspace shows live progress chips per angle being built

## 9. UI copy tone

- "Generate" not "Let's create"
- "Out of credits" not "Oops!"
- "We're learning your brand" not "Please wait while we process your information"
- Numbers > adjectives. "32 ads generated" > "lots of ads."
- Confident, never cute. Direct, never bossy.

## 10. Inspiration / aesthetic anchors

- **Linear** for density + keyboard-first feel
- **Raycast** for the dark-canvas / accent-energy / monospace numbers vibe
- **Framer** for the marketing site polish
- **Vercel dashboard** for the project-list pattern
- NOT: Mailchimp, HubSpot, MailerLite (too soft), Canva (too consumer), Notion (too plain)

---

## How to use this brief in Claude Design

1. Open Claude Design (design.anthropic.com)
2. Drop your logo PNG in to anchor the brand
3. Paste this entire doc into the chat
4. Start designing in this order:
   1. Project list (5.4) — establishes nav + header system
   2. Workspace shell (5.5) — sidebar + tab pattern
   3. Workspace > Build tab (5.5) — the core working interface
   4. Workspace > Library tab (5.5)
   5. Onboarding wizard (5.3) — uses everything else as established
   6. Settings (5.8)
   7. Auth (5.2)
   8. Marketing landing (5.1) — different visual register, lighter / more aspirational
5. As each screen finishes, hand off to Claude Code, I wire it to the existing API.
6. Iterate on details in code (faster than re-running Claude Design).

## Open questions (decide before/while designing)

- [ ] Marketing site — same dark/lime palette, or lighter/cleaner like a typical SaaS? Recommend: dark/lime everywhere, brand consistency wins.
- [ ] Project list view default — grid (recommended) or list?
- [ ] Workspace tabs — top tabs vs sidebar tabs? Brief is sidebar-tabs above, but top-tabs might fit denser screens better.
- [ ] Logo treatment in nav — full lime "U+arrow" mark or just wordmark? Recommend: mark only at small sizes, mark + "Ultemir" wordmark at large sizes.

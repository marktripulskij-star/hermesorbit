# Ultomir — Launch Plan

> Living strategic plan for taking the engine to a paid public SaaS.
> Companion to `FEATURES.md` (current state) and `ROADMAP.md` (engine improvements).
> Updated as decisions get made and phases ship.

## North star
- **Brand:** Ultemir
- **Domain:** ultemir.com (owned)
- **Logo:** electric-lime "U" with rising arrow on near-black background (provided by founder)
- **Brand palette (locked):**
  - Background: `#0a0a0a`
  - Surface: `#161616` / `#1f1f1f`
  - Primary accent: `#c5ff3d` (electric lime — from logo)
  - Secondary accent: `#a5e62a` (darker lime for hover)
  - Text: `#f5f5f5`
  - Muted: `#888`
  - Border: `#2a2a2a`
  - Status: success `#4ade80`, warning `#facc15`, danger `#f87171`
- **Brand voice:** direct-response, conversion-driven, no-fluff. Performance marketers talking to performance marketers.
- **Positioning:** the AI ad generator that makes ads worth running. Quality > volume.
- **Founder narrative:** Cyrus's story drives the landing page (frustration with generic AI ad tools, built the one that actually works).

## Decisions locked
1. **Output quality is shippable.** Engine improvements happen post-launch unless they directly fix the variance issue.
2. **Replace the dollar tracker with credits.** No more raw $ exposed to users. Higgsfield-style credit math.
3. **Multi-project architecture.** A user has many brands; each brand is a project; each project owns its docs, scraped data, brand brief, angles, ads.
4. **UI is getting fully rebuilt.** Current UI is dev-grade; final UI will be designed (likely via Claude Design) once the data model is locked.
5. **Two engine wins to ship before launch refactor:** Hook separation (T1.2) + Image-coherence critique. Both ~1 session each.

---

## Credit system

### Real per-action COGS (from observed usage data)
| Action | Real cost (USD) |
|---|---|
| Brand brief generation | $0.05–$0.15 (varies with doc volume) |
| Discover 20 angles | $0.05–$0.10 |
| Generate ad copy (Sonnet draft + Haiku critique + Sonnet art-director) | ~$0.07 |
| Image gen — low (draft) 1024×1024 | ~$0.012 |
| Image gen — medium (production) 1024×1024 | ~$0.06–$0.08 |
| Image gen — high (premium) 1024×1024 | ~$0.13–$0.20 |
| Regenerate prompt only (no image) | ~$0.03 |
| Website crawl | <$0.01 (essentially free) |

### Credit definition
**1 credit ≈ $0.025 in COGS.** Pricing target: 3-7× markup at the credit level.

### Action → credit pricing
| Action | Credits | Notes |
|---|---|---|
| Brand brief (per project) | **4 cr** | One-time per project |
| Discover angles (per project) | **4 cr** | Re-runs cost the same |
| Website crawl | **free** | Cost is negligible, makes user love product |
| Generate ad copy (no image) | **3 cr** | Includes critique + revise + art-director prompt |
| Image — Low (draft mode) | **1 cr** | For iterating on prompts cheaply |
| Image — Medium (production) | **3 cr** | The default, gets text rendered well |
| Image — High (premium) | **8 cr** | For hero images / final assets |
| Regenerate prompt only | **1 cr** | Cheap iteration |

**Typical full ad: 3 cr (copy) + 3 cr (medium image) = 6 cr/ad.**
**Iteration mode: 3 cr (copy) + 1 cr (low draft) + 8 cr (high final) = 12 cr/ad.**

### Pricing tiers
| Tier | Price | Credits/mo | ~Ads/mo (6 cr ea) | Projects | Other |
|---|---|---|---|---|---|
| **Free Trial** | $0 (no card) | 30 | ~5 ads | 1 | All formats; expires at month end |
| **Starter** | $19/mo | 200 | ~33 ads | 3 | All formats |
| **Pro** | $49/mo | 600 | ~100 ads | unlimited | Priority queue |
| **Scale** | $129/mo | 2,000 | ~330 ads | unlimited | Priority queue, future API access |
| **Enterprise** | custom | custom | — | — | SSO, custom contract |

### Margin math
Assuming **50% utilization** (industry-standard SaaS):
- Starter: ~$2.50 COGS → $16.50 profit → **87% margin**
- Pro: ~$7.50 COGS → $41.50 profit → **85% margin**
- Scale: ~$25 COGS → $104 profit → **81% margin**

At **100% utilization** (worst case):
- Starter: $5 → 74% margin
- Pro: $15 → 69% margin
- Scale: $50 → 61% margin

All tiers stay >60% margin even maxed out. Healthy.

### Credit overages
- No automatic overage billing in v1 (avoid bill-shock complaints).
- When credits run out, gen buttons grey out with "Out of credits — top up or upgrade" CTA.
- "Top-up packs" available: 100 cr for $9, 500 cr for $39, 1500 cr for $99 (lower per-credit price than monthly to incentivize upgrades).

---

## Data model (this drives everything)

```
User (id, email, plan, credits_remaining, credits_reset_at, stripe_customer_id, created_at)
└── Project (id, user_id, name, slug, created_at)
    ├── Documents (id, project_id, name, storage_path, extracted_text, mime_type)
    ├── BrandColors[]
    ├── BrandImages (id, project_id, type, storage_path, dataUrl, higgsfield_url)
    ├── BrandName
    ├── BrandBrief (jsonb)
    ├── WebsiteContent (jsonb — homepage, pages, products, allPrices, allOffers)
    ├── ManualOffers (text[])
    ├── Angles (id, project_id, avatar, desire, pain, hookDirection, funnelStage, insightLine)
    └── Ads (id, project_id, angle_id, format_id, headline, primary_text, description, cta_button,
            image_prompt, image_url, image_size, image_quality, scores jsonb, critique, generated_at)

CreditLedger (id, user_id, project_id, action, credits_used, real_cost_usd, generated_id, ts)
```

### Storage strategy
- **Postgres (Supabase or Neon):** all relational data above
- **Supabase Storage (or S3):** uploaded brand images, generated ad images, document files
- **No more `sessions.json` on local disk.** Everything user-scoped and persisted.

---

## Phased launch sequence

### Phase 0 — Engine wins (1-2 days, do RIGHT NOW)
- [ ] Ship hook separation (T1.2): generate 10 hook candidates → user picks → write body
- [ ] Ship image-coherence critique: vision-call after image gen scores reference fidelity, retries on low score (would have caught the wrong-product bug automatically)

### Phase 1 — Foundation (3-4 days)
- [ ] Supabase project setup (Postgres + Auth + Storage buckets)
- [ ] Define + migrate schema (above data model)
- [ ] Migrate `sessions.json` into Supabase tables (write a one-time importer)
- [ ] Add `@supabase/supabase-js` to client + server
- [ ] Auth flow: signup, login, password reset, email verification (Supabase handles 95% of this)
- [ ] Multi-project model in app: project list view, create-project, switch-project
- [ ] All existing endpoints get rewritten to be project-scoped + user-authed (middleware checks ownership)

### Phase 2 — Credit system (2 days)
- [ ] `credit_ledger` table + write helper that atomically: checks balance → deducts → logs
- [ ] Wrap every paid endpoint with credit check + deduct (returns 402 Payment Required when out)
- [ ] Replace UsagePill (dollar tracker) with **credit pill**: "X credits remaining · resets in Y days"
- [ ] Stripe integration: subscription products + webhook for credit grants on renewal
- [ ] Top-up flow: one-click purchase of credit packs
- [ ] Credit-out UX: greyed buttons with "Out of credits → upgrade / top up" CTA

### Phase 3 — Onboarding flow (1-2 days)
The current "upload docs → scrape → brief → angles → ads" flow is dev UX. Real onboarding:
1. **Sign up** → land on empty Project list
2. **Create your first project** wizard:
   - Step 1: Name your brand
   - Step 2: Paste your website URL → we scrape it live, show progress
   - Step 3: Upload product photo + logo (drag-drop) — auto-classified
   - Step 4: Optional: upload any brand docs / paste current promo offers
   - Step 5: We auto-generate brand brief + 20 angles in the background, show "We're learning your brand…" loader
3. **First ad coaching screen**: pick any angle → pick a format → "Generate copy + image" CTA
4. **First successful ad** → reveal the full workspace + project navigation

This needs to feel like magic, not like work. The free trial credits are spent inside this flow.

### Phase 4 — UI rebuild (3-5 days, partly in Claude Design)
- [ ] Project list / dashboard view
- [ ] Project detail view (the "workspace" — current single page becomes the project page)
- [ ] Ad grid / library view (see all ads in a project, filter by status/format/funnel/score)
- [ ] Onboarding wizard (Phase 3 made visual)
- [ ] Settings (account, billing, credit history)
- [ ] Mobile considered (B2B desktop-first but don't break mobile)
- [ ] Loading states everywhere — no more "is it broken?" moments

Where Claude Design fits: design the project list + workspace + ad library in Claude Design, hand off to Claude Code, wire to the API.

### Phase 5 — Landing page (1-2 days)
ultemir.com → marketing site, app at app.ultemir.com (or ultemir.com/app).
Sections:
- Hero with one-line value prop + CTA
- Founder story (your actual story — frustration, build, what it does differently)
- Demo: live "watch an ad get built in 60s" loop
- Format library (the 20 formats as visual cards)
- Pricing
- FAQ
- Social proof (once beta users exist)
- Sign up

Stack: Next.js or Astro for SEO. Hosted on Vercel.

### Phase 6 — Production hardening (2 days)
- [ ] Hosting: client on Vercel, server on Railway or Fly.io
- [ ] DNS: ultemir.com → marketing site, app.ultemir.com → app, api.ultemir.com → server
- [ ] SSL via Cloudflare or hosting provider
- [ ] Error recovery on every API endpoint (graceful retry, user-facing messages)
- [ ] Rate limiting (`express-rate-limit`) — per-user IP caps
- [ ] Transactional email (Resend): signup confirm, password reset, payment receipt, monthly credit reset
- [ ] Privacy + Terms (Termly or hand-written)
- [ ] Sentry or similar for error monitoring
- [ ] Backup strategy for Postgres

### Phase 7 — Beta launch (1 week)
- Invite ~20-30 brand owners you know personally
- Watch logs daily, fix what breaks
- Iterate pricing/conversion based on real signups
- Collect testimonials for landing page

### Phase 8 — Public launch
- Product Hunt (Tuesday or Wednesday for max traffic)
- X/Twitter announcement w/ demo video
- Your network email blast
- Targeted reach-out to indie DTC founders

---

## Total realistic timeline
- Phase 0: 1-2 days
- Phase 1-2: 5-6 days (foundation + credit system)
- Phase 3-4: 4-7 days (onboarding + UI rebuild)
- Phase 5: 1-2 days (landing)
- Phase 6: 2 days (production hardening)
- Phase 7: 1 week (beta)

**~3 weeks of focused work to public launch.** Friends-and-family beta sooner (~10 days from now).

---

## Step 1 (right now)

**Ship the two optional engine wins** (Hook separation + Image-coherence critique) so the engine is locked before we touch infra. ~1-2 days. After that the engine is "done" and we don't go back.

THEN Step 2 is Supabase setup + auth + multi-project data model. That's the foundation everything else builds on.

DO NOT start the UI rebuild before the data model is solid. We'd just throw the work away.

---

## Open questions to answer before Phase 1
- [ ] Auth provider: Supabase Auth (free, integrated) vs Clerk (slicker UX, $25/mo) → recommend **Supabase Auth** for v1 to keep stack simple
- [ ] Backend hosting: Railway vs Fly.io vs Render → recommend **Railway** for ease of Postgres + Express in one place
- [ ] Marketing site: in-app under `/` vs separate Next.js project → recommend **separate** (better SEO, easier to iterate marketing without redeploying app)
- [ ] Landing page domain: ultemir.com (marketing) + app.ultemir.com (product), or single-domain → recommend **subdomain split** for SEO and analytics separation

---

## Design brief (for Claude Design)
See `DESIGN-BRIEF.md` in project root. Comprehensive spec covering: brand identity, all 9 screens, component library, interactions, states, UI copy tone, aesthetic anchors. Designed to be pasted directly into Claude Design as context.

## Native ad blueprint (long-form)
Used when `format.isNative === true` (currently: confession, indictment, founder_story).
Every beat below must appear in the body copy. Beats are strategic, not paragraph slots — the model decides rhythm.

1. Hook / Headline · 2. Lead × 3 · 3. Storyline · 4. Identification · 5. Symptoms · 6. Fear / Worst Case · 7. Failed solutions (sequencing) · 8. Real life consequences · 9. Vindication + Loss aversion · 10. Mechanism Problem (Differentiate) · 11. Mechanism Solution (Differentiate) · 12. Organic Product Intro · 13. Differentiation · 14. Social Proof · 15. Risk Reversal · 16. Urgency · 17. Scarcity · 18. CTA · 19. PS · 20. PPS

Codified in `server/index.js` as `NATIVE_AD_BLUEPRINT`. Injected into the system prompt only when the format is native.

## Capitalization rules (locked)
- Headline + description: sentence case. NOT Title Case, NOT ALL CAPS.
- Body: natural prose. ALL CAPS allowed only for 1-2 words of visceral emphasis (rare).
- The ad should never feel like it's shouting.

## Changelog
- 2026-05-01: Brand corrected (Ultemir / ultemir.com). Logo received — electric lime + black palette locked. Native ad blueprint codified from founder's structure (20 beats). Long-form formats (confession, indictment, founder_story) flagged `isNative: true`. CSS variables in `client/src/index.css` updated to brand palette.
- 2026-04-30: Plan drafted. Brand locked: Ultemir. Domain: ultemir.com. Phase 0 = ship hook sep + coherence critique RIGHT NOW.

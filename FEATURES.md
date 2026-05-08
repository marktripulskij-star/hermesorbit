# Ad Studio — Features Spec

Living doc. Source-of-truth for the app's surface area. Update on every feature add/remove/rename.
Optimized for LLM context (terse, structured, no prose). When rebuilding or porting, this is the contract.

## Required env vars

### `server/.env`
| Var | Required | Default | Purpose |
|---|---|---|---|
| `ADMIN_EMAIL` | recommended | — | Email of the user who can access `/admin` and `/api/admin/*`. With neither this nor `ADMIN_EMAILS` set, nobody is an admin (every admin endpoint returns 403). |
| `ADMIN_EMAILS` | optional | — | Comma-separated list of admin emails. Useful for multiple team members. Combined with `ADMIN_EMAIL` if both are set |
| `ANTHROPIC_API_KEY` | yes | — | Claude calls (copy + image-prompt art director) |
| `STRIPE_SECRET_KEY` | yes (Phase 2+) | — | `sk_test_…` for dev / `sk_live_…` for prod |
| `STRIPE_WEBHOOK_SECRET` | yes (Phase 2+) | — | `whsec_…` from `stripe listen` (dev) or webhook endpoint config (prod) |
| `STRIPE_PRICE_SOLO` | yes (Phase 2+) | — | Stripe price ID for the Solo monthly subscription. Run `node server/scripts/setup-stripe.js` to create + print |
| `STRIPE_PRICE_OPERATOR` | yes (Phase 2+) | — | Same — Operator monthly |
| `STRIPE_PRICE_STUDIO` | yes (Phase 2+) | — | Same — Studio monthly |
| `STRIPE_PRICE_TOPUP_100` | yes (Phase 2+) | — | One-time 100-credit pack |
| `STRIPE_PRICE_TOPUP_500` | yes (Phase 2+) | — | One-time 500-credit pack |
| `STRIPE_PRICE_TOPUP_1500` | yes (Phase 2+) | — | One-time 1500-credit pack |
| `APP_URL` | no | `http://localhost:3000` | Where Stripe redirects after checkout (success/cancel) |
| `PUBLIC_API_URL` | no (yes in prod split-deploy) | — | Public origin of the API server (e.g. `https://api.ultemir.com`). Used to mint absolute URLs for generated images so they load when the client is on a different domain |
| `CORS_ORIGINS` | no (yes in prod) | — | Comma-separated allow-list (`https://app.ultemir.com,https://ultemir.com`). When unset, CORS reflects any origin (dev-friendly) |
| `RATE_LIMIT_PER_MIN` | no | `200` | Per-IP cap on `/api/*`. Stripe webhook is exempt |
| `NODE_ENV` | no | — | Set to `production` to suppress error stack traces in 500 responses |
| `OPENAI_API_KEY` | yes | — | GPT-4o (brief, angles), gpt-image-1 (image gen) |
| `HIGGSFIELD_CLIENT_ID` | yes | — | Higgsfield file storage for brand image uploads (and image gen if `IMAGE_MODEL=higgsfield`) |
| `HIGGSFIELD_CLIENT_SECRET` | yes | — | Pairs with HIGGSFIELD_CLIENT_ID |
| `SUPABASE_URL` | yes (Phase 1+) | — | Project URL from Supabase dashboard |
| `SUPABASE_ANON_KEY` | yes (Phase 1+) | — | Public anon key — for issuing user-scoped tokens |
| `SUPABASE_SERVICE_ROLE_KEY` | yes (Phase 1+) | — | Admin key, bypasses RLS. Server-only, NEVER ship to client. |
| `PORT` | no | 3001 | Express port |
| `IMAGE_MODEL` | no | `openai` | Provider switch: `openai` \| `gemini` (or `nano-banana` / `nanobanana`) \| `higgsfield` |

### `client/.env` (or Vercel env vars in prod)
| Var | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | yes (Phase 1+) | Same as server's `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | yes (Phase 1+) | Same as server's `SUPABASE_ANON_KEY`. Public-safe (RLS protects). |
| `VITE_API_URL` | no (yes in prod) | API origin (e.g. `https://api.ultemir.com`). Empty in dev → Vite proxy forwards `/api/*` → `localhost:3001`. Set in Vercel env for prod |
| `OPENAI_IMAGE_MODEL` | no | `gpt-image-2` | OpenAI image model identifier. Options: `gpt-image-2` (recommended default), `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini` (cheap draft mode), `chatgpt-image-latest` |
| `OPENAI_IMAGE_QUALITY` | no | `medium` | `low` \| `medium` \| `high`. Output token count scales: ~272 / ~1056 / ~4160 |
| `GEMINI_IMAGE_MODEL` | no | `gemini-2.5-flash-image-preview` | Google Gemini image model identifier (Nano Banana family). Update when Google ships a new name. |
| `GEMINI_API_KEY` | only if IMAGE_MODEL=gemini | — | Google AI Studio key |

## Repo layout
- `client/` — Vite + React app (port 3000+, the actual product)
- `server/` — Express + Node ESM (port 3001, API + temp landing static)
- `marketing/` — Claude Design output for the landing page (HTML + JSX, served via CDN React + Babel-standalone). Will deploy to ultemir.com via Vercel/Cloudflare Pages.
- `marketing/Ultemir Landing.html` — entry point. Imports `components.jsx`, `sections.jsx`, `main.jsx`, `tweaks-panel.jsx`. Assets in `marketing/assets/` (logo, founder photo).
- `client/src/components/ui/index.jsx` — shared design-system primitives (Btn, Card, Eyebrow, FunnelBadge, ScoreChip, StatusPill, Kbd) — mirrors marketing/components.jsx so app + landing feel one-system.

## Stack
- Client: React 18 + Vite. Dev port 3000+ (Vite picks next free). Prod build deploys to Vercel via `client/vercel.json`.
- Server: Express + Node ESM. Port 3001 (or `PORT` env). Static files served from `server/public/`. Prod ships as a Docker image (`server/Dockerfile`) — recommended host: Railway. Health check at `GET /health`.
- Vite proxies `/api/*` → `localhost:3001` in dev.
- In a split prod deployment (client at `app.ultemir.com`, server at `api.ultemir.com`), `VITE_API_URL` env tells the client to fetch absolute API URLs; `authedFetch` resolves any `/api/...` path through it. Server returns absolute generated-image URLs in prod via `PUBLIC_API_URL`.
- Persistence: **Supabase Postgres** for everything durable — users/profiles/projects/credit ledger, plus the full per-project session state stored as JSONB on `projects.session_state` (documents, brand brief, brand images, scraped website content, angles, ads). Server uses service-role key (bypasses RLS); client uses anon key (RLS-enforced). Reads/writes go through `server/lib/sessionStore.js` (`getSession` / `saveSession` / `invalidateSession`) with an in-memory write-through cache. **`saveSession` is fully synchronous (write-through to Supabase before resolving)** — endpoints only return 200 once the data is durable, so a server cold-start / redeploy / OOM can't drop a save. (Earlier versions debounced the DB write by 400ms in the background; that lost user data when the server got recycled mid-window. All callers are discrete user actions — none fire fast enough for debouncing to matter, so write-through is strictly safer.)
- The previous on-disk `server/sessions.json` was removed — it was wiped on every Railway redeploy and silently lost user data. Migration `002_session_state.sql` adds the JSONB column.
- Server filesystem layout:
  - `server/uploads/` — multer dest for raw uploaded files (20MB limit, configured via `multer({ dest: ..., limits: { fileSize: 20*1024*1024 } })`)
  - `server/public/generated/` — gpt-image-1 PNG outputs, served at `/api/generated/<uuid>.png`
  - `server/.env` — manually parsed at boot (dotenvx workarounds removed)
- Express config: env-driven CORS allow-list (`CORS_ORIGINS`, falls back to "any" when unset for dev), `express.json({ limit: '20mb' })`, `express-rate-limit` on `/api/*` (200/min/IP default; webhook exempt), `trust proxy` enabled for Railway/Fly. `GET /health` responds 200 for host-level health checks. Global error handler logs full errors server-side and returns generic messages in prod (`NODE_ENV=production`).
- Models in use:
  - **Claude Sonnet 4.6** — ad copywriting + image-prompt art-director call
  - **GPT-4o** — structured JSON extraction (brief, angles); `response_format: json_object`
  - **gpt-image-1** — ad image generation (renders text legibly)
  - Higgsfield Flux Kontext — image generation fallback (`IMAGE_MODEL=higgsfield`)
  - Higgsfield file storage — host uploaded brand images for use as image-gen reference URLs
- Other deps: cheerio (scraper), pdfjs-dist (PDF text), sharp (color extraction + image type detection), multer (upload), pypdf (none — PDFs handled by pdfjs-dist), OpenAI SDK, Anthropic SDK.

## Session schema (`projects.session_state` JSONB)
```
{
  documents: [{ name, path, mimetype, originalname, size }],
  brandColors: [{ hex, r, g, b, name }],
  brandImages: [{ name, type:'logo'|'product'|'lifestyle', dataUrl, colors, higgsfieldUrl }],
  brandName: string,
  brandBrief: { product, currentOffers[], avatars[], corePains[], coreDesires[], proofPoints[], competitorGaps[], brandVoice } | null,
  websiteContent: {
    sourceUrl, platform:'shopify'|'unknown',
    homepage: { url, title, metaDescription, headings[], buttonsAndCtas[], prices[], offerSignals[], bodyExcerpt },
    pages: [{ url, title, headings[], buttonsAndCtas[], prices[], offerSignals[], bodyExcerpt }],
    products: [{ title, vendor, productType, handle, url, tags, description, variants[{title,price,compareAtPrice,available,sku}], priceRange, onSale, firstImage }] | null,
    allPrices[], allOffers[]
  } | null,
  manualOffers: [string],
  angles: [{ id:number, avatar, desire, pain, hookDirection, funnelStage:'tofu'|'mofu'|'bofu', insightLine, suggestedFormatIds:string[] /* 1-3 format ids ordered best-first; server-validated to match angle's funnel + exist in AD_FORMATS */ }],
  ads: { [angleId_formatId]: { headline, primaryText, description, ctaButton, imagePrompt, imageUrl, imageError, imageSize, imageQuality, scores: {hook, mechanism, voice, cta}, critique, chosenHook, angleId, formatId, generatedAt } },
  // Legacy fields still present (initialized but unused by current UI):
  concepts: [],
  chatHistory: []
}
```
Migration on read: `getSession()` normalizes funnelStage to lowercase on every load and ensures all expected fields exist (idempotent — handles old sessions).

## Backend endpoints

**🔒 Auth contract (2026-05-02):** every `/api/*` endpoint except the static `/api/generated/*` requires `Authorization: Bearer <jwt>`. Every session-scoped endpoint additionally requires the supplied `sessionId` (= `project.id`) to be owned by the authenticated user. Helpers in `server/lib/auth.js`: `requireAuth` (middleware), `requireSessionOwnership(req, res, sessionId)` (call inside handler — returns false + sends 4xx on failure). Public exceptions: `GET /landing` (marketing) and `GET /api/generated/*` (image static — UUIDs are unguessable).

| Method | Path | Purpose | Streams |
|---|---|---|---|
| POST | /api/documents | **🔒+session.** Upload PDF/TXT brand docs (multer multipart, field=`files`). Extracts text via pdfjs-dist; returns sessionId+documents | no |
| DELETE | /api/documents/:sessionId/:name | **🔒+session.** Remove doc | no |
| POST | /api/brand-name | **🔒+session.** Save brand name | no |
| POST | /api/brand-assets | **🔒+session.** Upload brand images. Body field `forceType` (`logo` \| `product` \| `lifestyle`) bypasses auto-classification — used by the onboarding wizard which knows which file is which from its dedicated drop zones. When omitted, falls back to `guessAssetType()` heuristic (filename keywords + sharp metadata). Uploads to Higgsfield for reference-image URL; extracts dominant colors | no |
| GET | /api/brand-assets/:sessionId | **🔒+session.** List brand colors + images | no |
| PATCH | /api/brand-assets/:sessionId/:name/type | **🔒+session.** Manually set logo/product/lifestyle | no |
| DELETE | /api/brand-assets/:sessionId/:name | **🔒+session.** Remove a brand image | no |
| POST | /api/scrape-colors | **🔒+session.** Multi-page crawl of a brand site. Detects Shopify (`/products.json`), scores + scrapes top internal pages, extracts colors/prices/offers. **Streams SSE progress** → final `done` event with summary | yes (SSE) |
| GET | /api/website-content/:sessionId | **🔒+session.** Returns full scraped `websiteContent` + `manualOffers` for inspector UI | no |
| POST | /api/manual-offers | **🔒+session.** Replace `session.manualOffers` with array of strings | no |
| POST | /api/brand-brief | **🔒+session.** GPT-4o extracts structured brief from any subset of {docs, scraped site, manual offers}. **Requires at least one source — accepts docs-only OR website-only OR offers-only.** Two-tier pricing context: offer-page prices (preferred) vs raw catalog prices (labeled). Schema v2 demands ≥5 avatars (incl. inferred), ≥10 pains, ≥10 desires, ≥8 proofPoints (each tagged `evidence`/`inferred`), ≥5 competitorGaps + new `marketGaps[]` + new `inferredCompetitors[{name, differentiation}]` + brandVoice as `{summary, saysLike[], neverSaysLike[]}` | no |
| POST | /api/brand-brief/adjust | **🔒+session.** Body: `{sessionId, instruction}`. Claude Haiku rewrites the brief based on a free-text instruction (price correction, add/remove avatars, voice tweak, etc.). Returns full updated brief. ~$0.005/edit | no |
| POST | /api/ads/adjust | **🔒+session.** Body: `{sessionId, adKey, instruction, currentCopy?}`. Haiku rewrites a single ad's four copy fields (headline, primaryText, description, ctaButton) based on a free-text instruction. `currentCopy` (optional) lets the client pass in-progress local edits so unsaved tweaks aren't lost. Locked hook (`chosenHook`) is preserved verbatim as the opening sentence. CTA snapped to META_CTAS. Image is NOT regenerated — user can re-run image gen separately if they want one. ~$0.005/edit | no |
| POST | /api/generate-angles | **🔒+session.** GPT-4o generates exactly 20 angles (8 TOFU / 7 MOFU / 5 BOFU). For each angle, also picks 1-3 best-fit format ids from `AD_FORMATS` as `suggestedFormatIds` (ordered best-first; server validates: must match angle's funnel + must exist). If validation strips every suggestion, falls back to first 3 catalog formats matching the funnel — guarantees every angle has ≥1 default so the batch generator can't silently skip it. Normalizes funnelStage to lowercase | no |
| GET | /api/ad-formats | **🔒 requireAuth.** Returns 20 hardcoded ad formats: `{id, name, funnel, needsProduct, description}` | no |
| GET | /api/meta-ctas | **🔒 requireAuth.** Returns 15-item Meta CTA whitelist | no |
| POST | /api/generate-hooks | **🔒+session.** Sonnet generates **10 distinct hook candidates** for an angle × format. User picks one before body generation. Body: `{sessionId, angleId, formatId}` → `{hooks: string[]}` | no |
| POST | /api/generate-ad | **🔒+session.** Three-step: (1) Claude Sonnet writes draft copy with Schwartz framework — accepts optional `chosenHook` that locks the first sentence verbatim; (2) Claude Haiku self-critiques on 4 axes (hook/mechanism/voice/cta), scores 1-10, rewrites weakest sections; (3) `craftImagePrompt()` runs on the FINAL revised copy. CTA snapped to META_CTAS. Returns scores + critique + chosenHook on the ad object | no |
| POST | /api/regenerate-prompt | **🔒+session.** Re-runs `craftImagePrompt()` for an existing ad (preserves copy) | no |
| POST | /api/generate-ad-image | **🔒+session.** Uses `IMAGE_MODEL` env (default `openai`/gpt-image-2, or `higgsfield` / `gemini`). Saves PNG to Supabase Storage, returns signed URL. **Streams SSE status.** **Safety-fallback:** when the primary provider is `openai` and it returns a content-moderation rejection (matches `/safety|sexual|content[_ ]policy|moderation/i`), automatically retries the same prompt on Higgsfield (if credentials present), then Gemini (if `GEMINI_API_KEY` set), in that order. The `result` SSE event includes `providerUsed` when a fallback succeeded; the saved ad gets `imageProvider` so the UI can label which model produced it. Rate limits, network errors, and other failure modes do NOT trigger the fallback (would just amplify the underlying issue). Common trigger: intimate-apparel / body / health brands where gpt-image-2's safety filter false-positives | yes (SSE) |
| POST | /api/rip-ad | **🔒+session.** "Rip Concept" — multipart upload (`image` file + `primaryText`/`headline`/`description`/`ctaButton`/`size`/`quality` form fields). Charges `rip-ad` (5 cr) up front; image charge is taken inside the image step so it can be refunded independently. Pipeline: Sonnet+vision deep-analyzes the source ad → adapts the concept to the brand → critique+revise (Haiku) → art-director image prompt (Sonnet) → image gen with the same OpenAI→Higgsfield safety-fallback chain as `/api/generate-ad-image`. **Streams SSE** events: `stage` (analyzing/adapting/critiquing/art_directing/generating_image), `analysis` (full structured analysis JSON), `copy` (final adapted copy with adKey + scores), `status` (image-gen status text), `image` (final imageUrl or error), `done`. Saved as `session.ads[adKey]` with `source: 'rip'` and `sourceMeta` preserving the original copy + full analysis | yes (SSE) |
| GET | /api/generated/* | Static-served generated images | no |
| GET | /landing | Serves marketing landing page from `marketing/` (temp; will move to its own deployment) | no |
| GET | /api/session/:sessionId | **🔒+session.** Returns session state for hydration on page load | no |
| GET | /api/projects | **🔒 requireAuth.** List the signed-in user's projects (id, name, slug, brand_name, created_at, updated_at), newest first | no |
| POST | /api/projects | **🔒 requireAuth + plan limit.** Create. Body: `{name}`. Auto-slugs. Returns 402 with `{code:'PROJECT_LIMIT_REACHED', currentCount, limit, planLabel}` if at plan project limit | no |
| GET | /api/me | **🔒 requireAuth.** Returns `{user, plan{key,label,priceUsd,monthlyCredits,projectLimit}, credits{remaining,resetAt}, projects{count,limit}, creditCosts}`. Single source of truth for the credit pill, profile popover, and any UI that needs to know "can the user afford this action" | no |
| GET | /api/me/credit-history | **🔒 requireAuth.** Last 50 credit ledger entries for current user | no |
| GET | /api/admin/margin | **🔒 requireAuth + `requireAdmin`** (admin set: `ADMIN_EMAIL` + `ADMIN_EMAILS` env). Per-user this-month margin rollup: revenue, Stripe fees, actual COGS, utilization %, gross margin % | no |
| GET | /api/admin/users | **🔒 requireAdmin.** Comprehensive user list for the admin page: all profiles + this-month credit_ledger aggregations + project list per user. Each user row includes plan, credits remaining/consumed, utilization %, COGS, calls, last activity, project list, per-action breakdown. Totals row includes activeUsers, callsThisMonth, netRevenueUsd, grossProfitUsd. Returns `plans`, `creditCosts`, `pricing` so the admin page can compute what-if scenarios | no |
| GET | /api/admin/users/:id/ledger | **🔒 requireAdmin.** Last 200 (cap 500 via `?limit=`) credit_ledger entries for a single user. Shows action / credits_used / real_cost_usd / ts / metadata | no |
| POST | /api/admin/users/:id/credits | **🔒 requireAdmin.** Body: `{credits: int, reason: string}`. Positive grants, negative revokes (won't allow balance below 0). Logged as `admin-grant:<reason>` or `admin-revoke:<reason>` in credit_ledger with metadata `{adminEmail, reason, granted}`. Magnitude capped at 100,000 per call | no |
| PATCH | /api/admin/users/:id/plan | **🔒 requireAdmin.** Body: `{plan: 'free'\|'solo'\|'operator'\|'studio'\|'scale'}`. Updates profiles.plan only — does NOT reset credits_remaining (use /credits endpoint for that). Writes audit row `admin-plan-change:<plan>` to credit_ledger | no |
| GET | /api/admin/cost-breakdown | **🔒 requireAdmin.** Sum of this-month credit_ledger grouped by action: credits, cogsUsd, calls, avgCogsPerCall, shareOfCogs %. Sorted by COGS descending. Useful for "where is my money going" — shows e.g. that `image-medium` is 60% of total spend | no |
| POST | /api/billing/checkout | **🔒 requireAuth.** Body: `{type:'subscription', planKey:'solo'\|'operator'\|'studio'}` OR `{type:'topup', packKey:'topup_100'\|'topup_500'\|'topup_1500'}`. Creates Stripe Checkout session (mode=subscription or mode=payment). Auto-creates the user's Stripe customer if missing. Returns `{url}`; client redirects | no |
| POST | /api/billing/portal | **🔒 requireAuth.** Returns `{url}` for Stripe Customer Portal — manage subscription, update card, cancel. 400 if user has no Stripe customer yet (must check out at least once) | no |
| POST | /api/billing/webhook | **Stripe-only — registered with `express.raw` BEFORE `express.json`** so signature can be verified against the raw body. Handles `checkout.session.completed` (top-ups → +credits), `invoice.paid` (subscription renewal/initial → reset credits to plan amount, push reset_at +30 days, set plan), `customer.subscription.updated` (plan change → update plan key only), `customer.subscription.deleted` (cancellation → drop to free) | no |
| GET | /api/projects/:id | **🔒 requireAuth.** Fetch one full project row (uses `requireProjectOwnership`) | no |
| PATCH | /api/projects/:id | **🔒 requireAuth.** Rename. Body: `{name}` | no |
| DELETE | /api/projects/:id | **🔒 requireAuth.** Delete. FK cascade removes documents, brand_images, angles, ads | no |
| GET | /api/usage | **🔒 requireAuth.** Returns cost/token rollup: total, today, last24h, byModel, bySource, recent[20], pricing config | no |
| POST | /api/usage/reset | **🔒 requireAuth.** Clears the usage ledger | no |
| GET | /api/usage/timing | **🔒 requireAuth.** Image-gen duration stats by quality (low/medium/high). Returns observed avg/p50/p90 seconds based on actual gens, or sensible defaults if no data yet. UI uses this to show real time estimates next to quality dropdown options. | no |

### Legacy endpoints (not used by current UI, preserved for compatibility)
| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | /api/generate-concepts | **🔒+session.** Old concept generation flow (Claude) | Replaced by `/api/generate-ad` |
| POST | /api/generate-images | **🔒+session.** Old batch image generation, SSE | Replaced by per-ad `/api/generate-ad-image` |
| POST | /api/chat | **🔒+session.** Conversational refinement endpoint | UI removed; endpoint still live |

## Credit system (2026-05-02 → live, sans Stripe)

**Source of truth:** `server/lib/credits.js` (mirror at `client/src/lib/credits.js`). Schema in `001_initial_schema.sql`: `profiles` (credits_remaining, plan, credits_reset_at), `credit_ledger` (append-only), `deduct_credits()` SQL function (atomic: SELECT FOR UPDATE → check → UPDATE → INSERT ledger row → returns new balance).

### CREDIT_COSTS map
| Action key | Credits | What it covers |
|---|---|---|
| `brand-brief` | 4 | GPT-4o brief extraction |
| `brand-brief-adjust` | 1 | Haiku rewrite of brief |
| `website-scrape` | 0 | Free |
| `angles` | 4 | GPT-4o 20 angles + format suggestions |
| `generate-ad-copy` | 3 | Sonnet draft + Haiku critique + art-director prompt |
| `generate-hooks` | 1 | 10 hook candidates (Sonnet) |
| `regenerate-prompt` | 1 | Re-runs `craftImagePrompt()` only |
| `ad-adjust` | 1 | Haiku rewrite of one ad |
| `image-low` | 1 | gpt-image-2 low-quality |
| `image-medium` | 3 | gpt-image-2 medium-quality (default) |
| `image-high` | 8 | gpt-image-2 high-quality |

### PLAN_LIMITS (from `server/lib/credits.js`)
| key | label | $/mo | monthly credits | project limit |
|---|---|---|---|---|
| `free` | Free trial | 0 | 30 (one-time on signup) | 1 |
| `solo` | Solo | 19 | 200 | 1 |
| `operator` | Operator | 49 | 600 | 3 |
| `studio` | Studio | 149 | 2000 | 15 |
| `scale` | Scale | custom | unlimited | 999 |

**1 credit ≈ $0.025 in real model COGS by design.** Markup per credit: Solo 3.8×, Operator 3.3×, Studio 3.0×.

### Helpers
- `chargeCredits({userId, action, projectId?, realCostUsd?, metadata?})` — calls `deduct_credits` SQL fn. Throws `INSUFFICIENT_CREDITS` (402) on shortfall.
- `requireCredits(req, res, action, opts)` — endpoint-level wrapper. Charges, attaches `req.creditBalance`, sends 402 with `{required, action}` on shortfall, sends 500 on other errors. Returns `true` to continue, `false` if response already sent.
- `imageActionForQuality(quality)` — maps `'low' | 'medium' | 'high'` to the image-{tier} action key.

### Stripe billing (added 2026-05-02)

`server/lib/stripe.js` exports: `getStripe()` (lazy singleton, pinned to `apiVersion: '2024-06-20'`), `priceForPlan(key)` / `priceForTopup(key)` / `planKeyForPrice(id)` / `topupKeyForPrice(id)` (env-driven id ↔ key lookups), `getOrCreateCustomer(profile, supabaseAdmin)` (idempotent, persists `stripe_customer_id` on the profile).

`server/scripts/setup-stripe.js` is an idempotent setup script. Run once after `STRIPE_SECRET_KEY` is in env: it finds-or-creates 6 products (3 monthly subscriptions + 3 one-time top-up packs), each tagged with a `metadata.ultemir_key`, then creates the matching Price under each. Re-running is safe — it looks up existing products by metadata. Outputs the env lines to paste into `server/.env`.

**Webhook flow:** `/api/billing/webhook` is mounted with `express.raw` BEFORE the global `express.json()` so the raw bytes are intact for signature verification. After verifying, the handler routes by `event.type`:
- `checkout.session.completed` (mode='payment' only) → `handleTopupCompleted` → adds the pack's credits to the user's balance + logs a negative-`credits_used` ledger row (convention: positive = spend, negative = grant).
- `invoice.paid` → `handleInvoicePaid` → fetches the subscription, resolves `planKey` from price ID, REPLACES `credits_remaining` with the plan's monthly amount, pushes `credits_reset_at` +30 days, sets `plan` on profile, logs `renewal:<planKey>` in ledger.
- `customer.subscription.updated` → `handleSubscriptionUpdated` → updates `plan` only (credits adjust on next invoice).
- `customer.subscription.deleted` → `handleSubscriptionDeleted` → drops to `plan='free'`.

User mapping uses `profiles.stripe_customer_id` first; falls back to `metadata.supabase_user_id` (we attach this on every checkout for resilience).

### Stripe local dev setup (one-time)

```bash
# 1. Get a Stripe test key from dashboard.stripe.com (Developers → API keys)
echo "STRIPE_SECRET_KEY=sk_test_..." >> server/.env

# 2. Create the products
node server/scripts/setup-stripe.js
# Paste the 6 STRIPE_PRICE_* lines it prints into server/.env

# 3. Forward webhooks to local server (separate terminal, install Stripe CLI first)
stripe listen --forward-to localhost:3001/api/billing/webhook
# Copy the printed `whsec_...` and add as STRIPE_WEBHOOK_SECRET=... in server/.env

# 4. Restart server
```

After this, click `Top up / Upgrade` in the credit pill → go through Stripe checkout (test card `4242 4242 4242 4242`, any future date, any CVC) → on success, the webhook fires + the pill ticks up.

Every credit-costing endpoint follows the pattern: `requireAuth → requireSessionOwnership → requireCredits(...) → do work`. Order matters: auth check is cheapest (already has user from JWT verify), ownership check is one DB read, credit deduct is one stored-proc call.

## Constants
- `META_CTAS`: Shop Now, Learn More, Sign Up, Subscribe, Order Now, Get Offer, Download, Book Now, Apply Now, Contact Us, See Menu, Watch More, Listen Now, Send Message, Get Quote
- `AD_FORMATS` (20 hardcoded in `server/index.js`): TOFU(7) confession, indictment, pattern_interrupt, real_talk, open_loop, ugc_raw, lifestyle_native; MOFU(8) mechanism, testimonial, social_proof, comparison, objection, result_stack, before_after, founder_story; BOFU(5) deal_stack, limited_time, review_product, bundle_bogo, specificity_callout
- Each format: `{id, name, funnel, needsProduct, copyLength: 'minimal'|'short'|'medium'|'long', isNative?: boolean, description, intent (1-3 sentences describing the format's strategic + emotional purpose, NOT a paragraph-by-paragraph template), visualDirection (1-2 sentences on visual mood/register, not composition specifics)}`. The `/api/ad-formats` endpoint exposes only the public fields (`id, name, funnel, needsProduct, description`).
- **`isNative: true` formats** (currently: `confession`, `indictment`, `founder_story`) trigger injection of the `NATIVE_AD_BLUEPRINT` constant into the copy-gen system prompt. The blueprint requires 20 strategic beats: hook, lead×3, storyline, identification, symptoms, fear, failed solutions, consequences, vindication+loss aversion, mechanism problem, mechanism solution, organic product intro, differentiation, social proof, risk reversal, urgency, scarcity, CTA, PS, PPS. `max_tokens` bumped to 6000 for native formats (vs 3000 default).
- **De-templated.** The model designs structure organically per angle from the intent + brief — no fixed para-by-para layouts. System prompt explicitly bans generic "Para 1: Hook. Para 2: Pain..." structures.
- Awareness mapping (Schwartz): TOFU→problem-aware, MOFU→solution-aware, BOFU→product/most-aware

---

## Components

### Router `client/src/components/Router.jsx`
Thin top-level router (rendered inside `AuthGate`). Reads `currentProjectId` from `useProjects()`. While `loading`: splash. If hash matches `#/admin`: renders `<AdminPage />` (page does its own `me.isAdmin` gate). If id is set and the project exists in the list: renders `<Workspace />`. Else: renders `<ProjectList />`. Hash-based — no react-router dependency.

### AdminPage `client/src/components/AdminPage.jsx`
Admin dashboard at `#/admin`. Gated client-side by `me.isAdmin` (set by `/api/me` based on `server/lib/admin.js` — hardcoded owner email + `ADMIN_EMAIL` / `ADMIN_EMAILS` env). All endpoints are independently re-gated server-side via `requireAdmin`.

Sections (top to bottom):
1. **Header** — `← Brands` link, "Admin" label, MTD date pill, Refresh button, Log out.
2. **Totals row** — 8 stat cards: Revenue MTD, Stripe fees, COGS, Net revenue, Gross profit, Margin %, Active users, API calls. Margin tinted lime (≥50%) or amber (<50%).
3. **What-if pricing calculator** — for each paid plan (Solo / Operator / Studio): slider + number input for proposed price, plus computed margin at "avg utilization" (based on real users' actual COGS) AND "max utilization" (theoretical 100% credit burn at the real $/credit ratio). Shows current vs proposed side-by-side. Falls back to 200/600/2000-credit pricing assumption when no users exist on that plan yet.
4. **Cost breakdown** — table of all credit_ledger actions this month sorted by COGS descending. Columns: action / calls / credits / COGS / $/call / % of COGS + a horizontal bar showing share-of-spend. First-glance answer to "where is my money going."
5. **User table** — search by email, filter by plan, sort by Last active / Revenue / COGS / Margin / Utilization / Signup. Columns include credits remaining, used MTD, utilization (amber if >80%), revenue, COGS, margin (lime if ≥50%, amber otherwise; "—" for free-tier users with $0 revenue), project count, last active, joined.
6. **User detail panel** (slide-in right drawer, ESC to close) — opens on row click:
   - Stats grid (12 cells): Plan, Credits left, Used MTD, Utilization, Revenue, COGS, Margin, Calls MTD, Projects, Joined, Last active, Stripe id (truncated).
   - **Grant or revoke credits** — amount input + reason input + quick-grant chips (+10, +50, +100, +500, +1000) + Apply. Negative amounts revoke. Logs to credit_ledger with admin email.
   - **Change plan** — dropdown (free/solo/operator/studio/scale) + Apply (with confirmation). Doesn't reset credits.
   - **Activity by action (MTD)** — per-action breakdown for this user: action / calls / credits / cogs.
   - **Projects** — list of the user's projects with last-updated timestamps.
   - **Credit ledger** — last 200 entries (when / action / credits / COGS).

Helper components: `Stat`, `Section`, `PlanPill` (color-coded per plan), `Row`, `Th`/`Td`, `FiltersBar`. Format helpers `fmtUsd` / `fmtUsd4` / `fmtPct` / `fmtInt` / `fmtDate` (relative — "today" / "3d ago" / "2mo ago"). Uses existing `Btn` from `ui/index.jsx`. The admin link in `ProjectList` header (lime accent border, "Admin" label) only renders when `me.isAdmin` is true.

### Admin auth `server/lib/admin.js`
`isAdminEmail(email)` checks against a Set built from: `ADMIN_EMAIL` env (single) + `ADMIN_EMAILS` env (comma-separated). Case-insensitive. With neither set, `isAdminEmail` always returns false and every admin endpoint returns 403. `requireAdmin(req, res)` is the endpoint helper — sends 403 + returns false if non-admin, returns true otherwise. Used by all `/api/admin/*` endpoints.

### OnboardingWizard `client/src/components/OnboardingWizard.jsx`
5-step full-screen wizard shown when the user clicks `+ New brand` (or the empty-state CTA on first visit). Each step is a dedicated sub-component inside the same file:
1. **Name your brand** — single input, calls `createProject(name)` from `useProjects()`. On success, advances to step 2 and stores the new `projectId` for subsequent calls.
2. **Paste your website** — URL input + lime "Crawl" button. Streams `/api/scrape-colors` SSE → live "→ stage" lines feed + final summary tile (`✓ 5 pages · 14 products · 12 prices · 3 offers · 6 colors`). Skip allowed.
3. **Upload brand assets** — Logo + Product drop zones side-by-side (drag-drop or click). Multipart `/api/brand-assets` upload with both files in one POST. Skip allowed.
4. **Anything else?** — drag-drop multi-file for PDF/TXT brand docs (POST `/api/documents`) + textarea for active offers one-per-line (POST `/api/manual-offers`). Both optional. Skip jumps straight to building.
5. **We're learning your brand…** — auto-runs on entry: POST `/api/brand-brief` → POST `/api/generate-angles`, with a live build log appending status as it goes. On completion (~30-60s), calls `onComplete(projectId)` after a brief pause, which `ProjectList` uses to switch into the workspace.

Errors at any step display inline with a Retry button; partial state is preserved so the user doesn't restart. The Close button is hidden during the building step (no aborting mid-flight). Project is created at step 1 — if the user closes mid-wizard, the half-set-up project remains in their list and they can finish manually in the workspace. Burns 8 credits total (4 brief + 4 angles); 402 from either step opens the OutOfCreditsModal via `checkPaymentRequired()`. Project-limit check happens before opening the wizard (in `ProjectList.openWizard`).

### ProjectList `client/src/components/ProjectList.jsx`
Landing dashboard after login. Header: lime "U" mark + "Ultemir" + user email + Log out (`Btn variant=soft`). Body: `Your brands` heading + `X / Y brands · <plan>` count + grid of `ProjectCard`s + a "+ New brand" tile (dashed border, lime hover). Tile click opens the `OnboardingWizard` (5-step full-screen). At project limit: tile shows "⤴ Upgrade for more brands" + clicking opens the project-limit-reached modal. Empty state (no projects yet): replaces the grid with a primary "Create your first brand →" CTA that opens the wizard. Card hover: lime border glow + reveals delete `✕`. Click card → switch into workspace. Delete confirms before calling `deleteProject`.

### Workspace `client/src/components/Workspace.jsx`
Wraps the existing `<App />` shell. Adds a slim breadcrumb bar above it: `← All brands / <project name>` plus **two tabs: "Ad Studio" (default) and "✨ Rip Concept"**. Tab state lives in the URL hash so it's shareable + refresh-stable: `#/p/<id>` → studio, `#/p/<id>/rip` → rip concept page. Click `← All brands` calls `switchTo(null)`. Each tab gets its own component remount-keyed on project id (so all in-flight state resets per-project): Studio renders `<App key={projectId} sessionId={projectId} />`; Rip renders `<RipPage key={projectId + ':rip'} sessionId={projectId} />`. The hash regex in `ProjectsContext.readHash` already accepts the `/rip` suffix because the project-id capture group stops at the first non-hex/dash char, so `currentProjectId` resolves correctly on either tab.

### RipPage `client/src/components/RipPage.jsx`
Standalone "Rip Concept" surface inside the workspace. The pitch: paste a high-performing ad you wish was yours — image + copy — and the AI extracts its **transferable concept** (structural and emotional DNA) and rewrites it as a complete new ad for THIS brand using the project's existing brief, brand assets, and voice. One-click. ~30-60s end-to-end.

**Form (left, sticky):**
- Image drop zone (PNG / JPEG / WebP, max 20 MB). Drag-drop or click to browse. Preview with Replace button. (Required)
- Primary text textarea (required) — paste the source ad's body copy
- Headline / Description / CTA inputs (optional)
- Image quality dropdown (low / medium / high — same credit tiers as Studio)
- "Rip this ad · {N} cr" primary button. Disabled until image + primary text exist + not running. Cost = 5 base + image quality (1/3/8) = 6 / 8 / 13 cr typical.

**Result column (right, scrolling):**
- Empty state ("Find an ad you wish was yours") if no run yet.
- **Pipeline strip** — 5 stages: analyzing → adapting → critiquing → art-directing → generating image. Stages tick to ✓ as the SSE stream advances; live stage shows a lime spinner. Image stage shows the latest image-gen status text inline.
- **Analysis card** — appears as soon as the analysis SSE event lands. Shows: format / funnel-stage / native pills, a one-line concept summary in italics, "why it works" reasoning, emotional-trigger pill, hook-pattern pill, structural DNA in mono. "+ Full breakdown" toggle reveals the full per-field detail (image: composition/lighting/text-overlay/visual-register; copy: hook/arc/mass-desire/hidden-problem/voice; concept: must-preserve/must-adapt/best-fit-avatar).
- **Generated ad card** — appears when the `copy` SSE event lands (before image is done). Score chips along the top (hook / mechanism / voice / cta from the existing critique step). Image column on the left (300px) shows the generated image once it lands, or a loading box, or an error pill. Image provider noted if a fallback was used. Download / Open full size buttons. Copy column on the right shows headline / primary text / description / CTA each with its own copy-to-clipboard button. Critique line shown below.

**Streaming model:** native fetch + ReadableStream + SSE parsing (same shape as the existing `generateImage` flow). Auth is via `Authorization: Bearer ${token}` header — `getAccessToken()` from supabase, then plain fetch with FormData (authedFetch can't carry multipart with the same ergonomics). Handles 402 via `checkPaymentRequired()` from MeContext; refreshes credits via `refreshMe()` after run.

The whole flow reuses the existing pipeline once the analysis lands: `adaptConceptToBrand` returns the same `{headline, primaryText, description, ctaButton, imagePrompt}` shape that `critiqueAndReviseCopy` and `craftImagePrompt` already accept, with synthesized `angle` and `format` objects derived from the analysis (`format` matches an `AD_FORMATS` entry when the analysis classifies one we know, otherwise a "rip-custom" synthetic format with `intent` = the analysis's why_it_works + structural DNA + must-preserve guidance, `visualDirection` = visual register + composition + lighting). Image gen uses the same `runProvider` + safety-fallback-chain pattern from `/api/generate-ad-image`. Saved as `session.ads[adKey]` with `source: 'rip'` so the Studio's existing UI can render or filter ripped ads later.

### ProjectsProvider `client/src/lib/ProjectsContext.jsx`
React context wrapping project state. Exposes `{ projects, loading, error, currentProjectId, currentProject, refresh, createProject, renameProject, deleteProject, switchTo }` via `useProjects()`. Hash routing: `#/` ↔ list, `#/p/<id>` ↔ workspace. Subscribes to `hashchange`. Validates `currentProjectId` against the loaded list — bounces to `#/` if the id isn't owned (stale URL or deleted project).

### AuthProvider `client/src/lib/AuthContext.jsx`
React context wrapping Supabase Auth. Exposes `{ session, user, loading, error, signIn, signUp, signOut }` via `useAuth()`. Subscribes to `supabase.auth.onAuthStateChange` so login/logout flips the gate automatically. Email + password v1; signup uses `emailRedirectTo: window.location.origin`.

### AuthGate `client/src/components/AuthGate.jsx`
Wrapper used in `main.jsx`. While `loading`: renders a small "Loading…" splash. If no `session`: renders `<AuthPage />`. Else renders children (i.e. `<App />`).

### AuthPage `client/src/components/AuthPage.jsx`
Centered single-card login/signup screen on `var(--bg)`. Uses `Btn` + `Card` from the design system. Toggles between Sign in / Create account. Shows server error inline (red tint) and signup confirmation hint (lime tint) when email confirmation is required. No router — single-screen toggle.

### App `client/src/App.jsx`
Top-level shell. Two-column layout: sidebar (DocumentPanel + BrandPanel) + main flow (Step 1 brief → Step 2 angles + ads in one grid; **Step 3 was collapsed into Step 2** in 2026-05-02).
- Accepts an optional `sessionId` prop. When provided (project mode — Workspace passes `currentProject.id`), `usingProjectScope` is true and the App skips localStorage entirely, using the prop directly for every API call. When omitted (legacy / standalone preview), falls back to localStorage `adgen_session_id`.
- `ensureSession()` is a no-op in project scope (the sessionId is fixed = project.id, server creates the session row lazily on first POST).
- Parent should swap App via `key={projectId}` to force a full remount when switching projects so state resets cleanly.
- Header: logo + "Ad Studio" + **UsagePill** (live cost counter) + **UserMenu** (signed-in avatar + logout dropdown), all top right
- `UserMenu` (in-file, exported nowhere): lime-circle avatar (first initial of email) → click opens popover with `Signed in as <email>` + `Log out` button. Closes on outside click. Renders nothing if no user.
- Loads `/api/ad-formats` + `/api/session/:id` on mount
- Holds: sessionId (localStorage `adgen_session_id`), documents, brandColors, brandImages, brandName, brandBrief, angles, ads, formats, selectedAngles (Set), selectedFormats (per angle), generatingCopy (per adKey), generatingImage (per adKey), imageStatuses (per adKey), error
- `SectionBoundary` (in-file class) wraps Step 3 + each AdBuilder. Catches render errors, displays fixed-position pink/yellow overlay with stack trace
- Anti-extension hardening: root div has `translate="no" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false"`. `index.html` also has `<html lang="en" translate="no">` + `<meta name="google" content="notranslate">`
- Step 1 — Brand Brief
  - btn `Extract Brand Brief` → POST /api/brand-brief; disabled if no documents or running
  - Renders BriefCard if `brandBrief` exists
- Step 2 — Discover Angles (gated on brandBrief)
  - btn `Discover Angles` → POST /api/generate-angles. Clears selectedAngles + selectedFormats on each run
  - Renders AngleGrid if angles exist
- Step 3 — Build Ads (gated on `selectedAngleList.length > 0 && formats.length > 0`)
  - For each selected angle: SectionBoundary > AdBuilder
- Empty state when no brief
- Error banner at top, dismissable

### DocumentPanel `client/src/components/DocumentPanel.jsx`
Sidebar — brand documents.
- Drag/drop or click to upload PDF/TXT brand docs → POST /api/upload
- Lists docs with name + size, delete btn per doc
- On first upload, captures `sessionId` from response and bubbles up via `onSessionCreated`

### BrandPanel `client/src/components/BrandPanel.jsx`
Sidebar — brand assets, website crawl, manual offers, inspector.
- Brand name input + Save btn → POST /api/brand-name
- Image upload (drag/click) → POST /api/brand-assets. Auto-types via sharp (alpha → logo, square small → logo, default → product/lifestyle)
- Per-image: type segmented control [**Logo** | **Product**] (text labels, lime when active). Legacy `lifestyle`-tagged images render with Product active. Server still accepts `lifestyle` on the PATCH endpoint for backward compat. `✓ ref` badge if Higgsfield URL exists, color swatches, delete btn → DELETE
- Toast notifications (3s)
- **Crawl Brand Site** section
  - URL input + arrow btn → SSE stream from POST /api/scrape-colors
  - Live progress line: shows current step ("Fetching homepage…", "Shopify catalog found: 14 products", "Scraping 3/5: /pages/about", etc.)
  - Green summary line on done: `✓ N pages · N products · N prices · N offers · N colors [platform]`
  - **🔍 Inspect scraped data** btn → toggles ScrapedDataInspector, fetches GET /api/website-content/:sessionId on first open
- **Active Offers (manual)** section
  - Help text: "Paste current promos the crawler may have missed (Kaching bundles, subscribe & save, etc.). One per line."
  - Textarea + Save btn → POST /api/manual-offers (replaces array). Manual offers take priority over scraped offers in brief + image prompts
- Brand Palette: deduped color swatches with hex labels

### ScrapedDataInspector `client/src/components/BrandPanel.jsx` (in-file)
Collapsible inspector showing what the crawler actually pulled.
- Detects + warns about legacy single-page scrape format (pre multi-page rewrite). Re-scrape needed.
- Sections (rich format): Source · All Offer Signals · All Prices · Shopify Catalog (per-product cards w/ price range, sale flag, variants, description) · Homepage (title, meta, expandable headings/CTAs/body) · Other Pages Crawled (per-page expandable: prices, offers, headings, body excerpt) · Manual Offers
- Bottom: `<details>` toggle showing **Raw JSON dump** (5000 char cap) for debugging

### BriefCard `client/src/components/BriefCard.jsx`
Collapsible display of `brandBrief` JSON. Defensive renderer — handles both v1 schema (string voice, string proofPoints) and v2 schema (object voice with saysLike/neverSaysLike, proofPoints with `evidence`/`inferred` tags). Shows: product chip line, avatars (with `inferred` tag where applicable), corePains, coreDesires, proofPoints (tagged), competitorGaps, **marketGaps**, **Likely Competitors** (inferredCompetitors with one-line differentiation), currentOffers, brandVoice + says-like / never-says-like grid. Counts shown next to each section label.
- **`✨ Adjust` button** next to `▼ Full brief` — opens an inline panel with a textarea + 4 suggested instructions ("The price is wrong, fix it to $39 bundle", etc.). Submitting POSTs to `/api/brand-brief/adjust`; the response replaces the brief in App state via `onBriefUpdated` callback. ⌘+Enter shortcut to apply.

### AngleGrid `client/src/components/AngleGrid.jsx`
**Combined Step 2 + Step 3 surface.** Renders 20 angle cards as a grid; each card is also where you generate, preview, and edit the ad. Step 3 (separate AdBuilder list) was removed in this slice — everything happens in the angle grid.
- Filter chips: All / TOFU / MOFU / BOFU
- `Select all` / `Clear` btns + selected count badge (existing)
- **Sticky batch bar** (top of grid): shows when ≥1 selected OR mid-batch OR any ads exist. Status text: `N angles selected` (idle) / `Generating · X/Y done · Z in flight · W errored` (mid-run) / `X/Y ads ready` (after run). Primary "Generate N ads" button fires `runBatch(selectedIds)`.
- **Per-card image settings:** two compact mono-styled `<select>`s on the action row — aspect (1:1 / 2:3 / 3:2) and quality (Low / Medium / High). Default 1:1 + Medium for every angle. Disabled during generation. Read by `generateAdSequence` so each batch ad uses its angle's settings; user can mix per-angle (e.g. high-quality the BOFU angles, default the rest). State lives in `App.imageSettings: { [angleId]: { size, quality } }`.
- **Per-card UI states (driven by `adStages[angle.id]`):**
  - Idle: angle info + format dropdown + checkbox + "Generate this one" button
  - `generating-copy`: yellow stage pill ("Writing copy…") + spinner strip
  - `generating-image`: yellow stage pill ("Rendering image…") + spinner strip
  - `done`: green stage pill ("Ready") + image thumbnail + headline preview + score chips + "Open ad ↗" button
  - `error`: red stage pill + inline error message + "Retry" button
- **Format dropdown per card** (replaces chip row): grouped optgroups TOFU/MOFU/BOFU. When `selectedFormats[angle.id] === suggestedFormatIds[0]`, a small `✨ suggested` tag appears next to the dropdown.
- **Expand-on-click:** "Open ad ↗" toggles `expandedAngles[angle.id]`. Expanded cards span the full grid row and render `<AdBuilder>` inline (full editor: copy fields, scores, image prompt, regenerate buttons, hook picker for re-runs).
- App-level effect auto-fills `selectedFormats[angle.id] = suggestedFormatIds[0]` when angles arrive (never clobbers manual picks). Server guarantees `suggestedFormatIds` is non-empty for every angle, so auto-fill always lands.
- App-level effect syncs `adStages` with already-loaded `ads` on session hydrate. Distinguishes success vs. failure on reload: ads with `imageUrl` present and no `imageError` → `'done'`; ads with `imageError` or missing `imageUrl` → `'error'` (fills `adErrors[id]` so the card surfaces a Retry button instead of papering over a previously-failed image as success).
- `runBatch` no longer silently drops angles with missing format picks. Any selected angle without `selectedFormats[id]` is flagged with `adErrors[id] = 'Pick a format first'` and `adStages[id] = 'error'` so the card shows the Retry/error pill. (Server-side suggestedFormatIds fallback means this should be rare in practice; this is a belt-and-suspenders catch.)
- Image-generation failures during batch flow set `adStages[id] = 'error'` (not `'done'`). When the SSE result event carries an `error` field or no `imageUrl`, `generateAdSequence` writes the message to `adErrors[id]` and routes to error state. Previously: failed images silently set `'done'` and the card showed "No image yet" with no Retry path.

### AdAdjustPanel `client/src/components/AdAdjustPanel.jsx`
Inline AI chat panel for refining an existing ad's copy. Mirrors brief Adjust pattern: textarea + 5 suggested instructions ("Make the headline punchier", "Shorten the primary text", "Make the CTA more urgent", "Rewrite in second person", "Add specificity"). Submits to `POST /api/ads/adjust` with `currentCopy` (the displayed values, including local edits). On response, calls `onApplied(updatedCopy)` so AdBuilder syncs both `editedCopy` and `onAdUpdate(adKey, …)` immediately. ⌘+Enter shortcut. Image is NOT regenerated. Trigger button (`✨ Adjust`) is rendered inside AdBuilder's score row, lime accent when open.

### AdBuilder `client/src/components/AdBuilder.jsx`
One ad card per selected angle.
- **Header row** (clickable to collapse): funnel badge, avatar, pain, ▴/▾ collapse toggle
- **Format selector** (dropdown): grouped optgroups TOFU/MOFU/BOFU. Shows `📦 Product shot` or `🏞 No product needed` badge once picked. Description shown in stable wrapper div
- **Generate Copy btn**: opens hook picker first (10 candidates from `/api/generate-hooks`); user picks one OR writes their own OR clicks "Skip — let AI pick" → body generation runs with that hook locked verbatim. Disabled until format picked.
- **Headline field** (textarea): char count `N/40`, copy-to-clipboard btn
- **Primary text field** (textarea): char count, copy btn, 8 rows
- **Description field** (textarea): char count `N/30`, copy btn
- **CTA field** (`<select>`): dropdown of META_CTAS, copy btn (no free text)
- **Image Prompt field** (textarea, always visible): 4 rows, editable, copy btn, **`↺ Regen Prompt` btn** → POST /api/regenerate-prompt (uses `craftImagePrompt()` art-director call). Cheap; no image gen
- **Image settings row** (above Generate Image): two dropdowns
  - Aspect: Square 1:1 (`1024x1024`) / Portrait 2:3 (`1024x1536` — story/reel) / Landscape 3:2 (`1536x1024`)
  - Quality: Low (~$0.01) / Medium (~$0.05) / High (~$0.15)
  - Per-ad state, persisted on the ad object server-side after each generation
- **Generate Image btn**: SSE → POST /api/generate-ad-image with `{sessionId, adKey, size, quality}`. Shows status text per SSE event ("Queued…", "Generating image…")
- Image render: 220×220 thumbnail, click to expand to full size. Buttons below: ⬇ Download (downloads with filename `ad-<adKey>.jpg`), ↗ Open full size
- Image error display if generation fails
- All textareas/inputs have `data-gramm="false"` to disable Grammarly DOM mutation
- **`✨ Adjust` button** lives in the Self-critique row. Click → toggles inline `<AdAdjustPanel>` (lime-accent border) above the headline field. Lets the user say "make the headline punchier" / "shorten the primary text" / "make the CTA more urgent" → Haiku rewrites just those fields → UI reflects immediately (both `editedCopy` and the global `ads[adKey]` are synced). Image is NOT regenerated; user can hit ↺ Regen Prompt → Generate Image if they want a new image. Locked hook is preserved verbatim. ~$0.005/edit. ⌘+Enter shortcut.

### ErrorBoundary `client/src/components/ErrorBoundary.jsx`
Root-level boundary in `main.jsx`. Catches uncaught render errors → full-page fallback with reload btn. Logs `error.message` + `componentStack` to console.

### SectionBoundary `client/src/App.jsx` (in-file)
Per-section error boundary used around Step 3 + each AdBuilder. Renders fixed-position pink/yellow error overlay with stack trace + Dismiss btn. Logs full error/component stack.

### PricingModal `client/src/components/PricingModal.jsx`
3-tier plan picker (Solo / Operator / Studio), shown when user clicks `Upgrade plan` anywhere. Each tier card: name, popular tag (Operator), price, monthly credits, 4 features, "Choose <tier>" CTA. Current plan disabled with "Current plan" pill. Click → POST `/api/billing/checkout` → redirect to Stripe-hosted checkout. Cancel/back uses APP_URL/?checkout=cancel.

### CheckoutToast `client/src/components/CheckoutToast.jsx`
Bottom-right toast that fades in when MeContext detects `?checkout=success` or `?checkout=cancel` URL params. On success: poll `/api/me` 5× over 7.5s to give the webhook time to fire, then show "Plan updated." for 3s. On cancel: "Checkout cancelled." for 2.5s. URL param stripped via `history.replaceState` so a refresh doesn't replay.

### CreditPill `client/src/components/CreditPill.jsx`
**Replaces UsagePill in 2026-05-02.** Header pill showing remaining credits + reset countdown (e.g. `214 cr · 12d`). Color tone: lime (>50), yellow (10-50), red (≤10). Click → expanded popover with: plan badge ("Operator"), monthly credits / used breakdown, reset date, last 10 ledger entries (action · credits · timestamp), top-up + refresh buttons. Lazy-loads `/api/me/credit-history` on first open.

### MeProvider `client/src/lib/MeContext.jsx`
React context wrapping the `/api/me` profile (plan + credits + project count + creditCosts map). Exposes `useMe()`: `{me, loading, refresh, hasCreditsFor(action), checkPaymentRequired(response), outOfCreditsModal, setOutOfCreditsModal, closeOutOfCredits}`. Refetched on window focus + after every credit-costing action so the pill ticks down in real time. `checkPaymentRequired(response)` is the canonical way every credit-costing fetch handles 402 — pass the Response, returns true if it was 402 (modal opened, caller should bail), false otherwise.

### OutOfCreditsModal `client/src/components/OutOfCreditsModal.jsx`
Full-screen modal that opens whenever `MeContext.outOfCreditsModal` is non-null. Two flavors: insufficient credits (`{required, action}`) shows top-up packs (100/$9, 500/$39, 1500/$99) — clicking a pack hits `/api/billing/checkout` with `type:'topup'` and redirects. Project-limit-reached (`{code:'PROJECT_LIMIT_REACHED', currentCount, limit, planLabel}`) shows upgrade messaging only. Both have `Upgrade plan` CTA → opens `PricingModal`. Rendered once at the app root in `main.jsx`.

### Legacy: UsagePill `client/src/App.jsx` (in-file, REMOVED FROM HEADER)
The old dollar-based pill. Code remains in `App.jsx` but is no longer rendered. Will be deleted in a cleanup pass.
- Polls `/api/usage` on mount, every 15s, and on window focus
- Click to expand popover: Today / Last 24h / Lifetime · By model · By source · Recent 20 calls (timestamp, source, cost) · Reset ledger btn (POST /api/usage/reset, with confirm) · "Estimates only" disclaimer
- All costs computed server-side from `PRICING` config + Anthropic/OpenAI usage tokens; gpt-image-1 / Higgsfield charged at fixed `perImage` rate

### Legacy / unused components (present in repo, NOT imported by App)
- `ChatPanel.jsx` + `ChatPanel.css` — chat refinement UI from old flow. Calls `/api/chat`. Safe to delete when porting.
- `ConceptGrid.jsx` + `ConceptGrid.css` — old concept-card grid. Calls `/api/generate-concepts` + `/api/generate-images`. Safe to delete when porting.
- The legacy `concepts` and `chatHistory` fields in the session schema are tied to these components.

---

## Key flows

### Upload → Brief → Angles → Ads
1. Upload PDFs (DocumentPanel) → session created with sessionId in localStorage
2. (Optional) Upload logo/product images (BrandPanel) → auto-uploaded to Higgsfield for reference URL
3. (Optional) Crawl website (BrandPanel) → multi-page scrape + Shopify catalog → stored in session.websiteContent
4. (Optional) Paste manual offers
5. Click `Extract Brand Brief` → GPT-4o ingests docs + websiteContent + manualOffers → produces structured brief (incl. currentOffers field)
6. Click `Discover Angles` → GPT-4o generates 20 angles
7. Select angles, pick format per angle, click `Generate Copy` → Claude two-call (copy + art-director image prompt)
8. Click `Generate Image` → gpt-image-1 renders w/ text overlays → saved to disk, returned as URL

### Image prompt structure (output of `craftImagePrompt`)
1. Aspect-ratio + style header line
2. Hero subject paragraph (camera angle, materials, framing — Hasselblad photographer language)
3. Lighting/color/mood paragraph
4. Explicit `TEXT OVERLAY:` section (position, exact text in quotes, typography, hex colors, hierarchy — uses brand palette + manual offers)

### Multi-page crawler (`scrapeWebsite`)
1. `browserFetch(url)` w/ full Chrome headers
2. `tryShopifyCatalog(url)` → `/products.json?limit=50` if available
3. `extractInternalLinks($, url)` → score links (products+12, about+10, story+9, faq+7, ingredients+8, blog-3) → top 5 (excluding homepage path)
4. Per-page: `scrapeOnePage` extracts title, meta, headings, buttons, body, prices ($X.XX regex), offer signals (`% off`, `free shipping`, `BOGO`, `bundle`, `risk-free`, `money-back`, etc.)
5. Aggregate prices/offers across all pages + catalog
6. Color extraction from inline + linked CSS via `extractColorsFromCss`
7. Reports progress at each step via `onProgress(stage, message)`

---

## Image model switching
`IMAGE_MODEL` env var on server selects provider. Model identifier within each provider is itself configurable, so when API model names change (e.g. gpt-image-1 → gpt-image-2) you just update the env var — no code change.
- `openai` (default) — uses `OPENAI_IMAGE_MODEL` (default `gpt-image-2`) and `OPENAI_IMAGE_QUALITY` (default `medium`). When user has uploaded a logo and/or product image, automatically uses `images.edit` endpoint and passes those as **multi-reference inputs** so the generated ad uses the actual product label/wordmark, not a hallucinated one. When no references uploaded, falls back to `images.generate` (text-only). Returns base64, saved to `server/public/generated/`, served at `/api/generated/<uuid>.png`. Real token usage extracted from response.
- `gemini` (aliases: `nano-banana`, `nanobanana`) — uses `GEMINI_IMAGE_MODEL` (default `gemini-2.5-flash-image-preview`). REST call to `generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` with `responseModalities: ['IMAGE']`. Requires `GEMINI_API_KEY`. Faster + cheaper, weaker text rendering historically.
- `higgsfield` — Flux Kontext via Higgsfield API; supports reference image URL from uploaded product photo; auth via `HIGGSFIELD_CLIENT_ID:HIGGSFIELD_CLIENT_SECRET`; polls every 3s up to 6min. Bad text rendering; effectively legacy.

## Usage tracking
- Ledger at `server/usage.json` (append-only, capped at 5000 most recent entries)
- `PRICING` constant at top of `server/index.js` — single source of truth, edit when rates change
- Every Anthropic/OpenAI/image call wrapped with `logUsage({...})`
- Tracked sources: `generate-concepts`, `chat`, `brand-brief`, `generate-angles`, `generate-ad`, `critique-revise`, `craft-image-prompt`, `generate-ad-image`
- **Three pricing types supported:**
  - `text` — input/output tokens × rate (Claude, GPT-4o)
  - `image-tokens` — separate rates for textInput, imageInput, imageOutput tokens (OpenAI image models). Captures real `usage.input_tokens_details` from OpenAI image API responses
  - `flat` — fixed `perImage` cost (Gemini Nano Banana, Higgsfield)
- Tracked models: `claude-sonnet-4-6`, `gpt-4o`, `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`, `chatgpt-image-latest`, `gemini-image`, `higgsfield-flux`
- **Approx per-image cost at 1024×1024 medium**: gpt-image-2 ~$0.032 · gpt-image-1.5 ~$0.034 · gpt-image-1 ~$0.042 · gpt-image-1-mini ~$0.008 · gemini ~$0.039 · higgsfield ~$0.040
- Honest about being **estimates** — UI explicitly says so

## Server helper functions worth knowing about
- `generateHookCandidates({angle, format, awareness, brandVoice, brandBrief, sessionId})` — Sonnet generates 10 distinct hooks (different patterns / emotional registers / lengths). Returns `string[]` of length ≤10. Powers the hook picker UI.
- `craftImagePrompt({copy, angle, format, session, brandName, colorContext, hasProductImage})` — the elite art-director call; reused by both `/api/generate-ad` (auto after copy) and `/api/regenerate-prompt`
- `critiqueAndReviseCopy({copy, angle, format, awareness, brandVoice, sessionId})` — Haiku-based critique pass. Returns `{revised, scores, critique}`. Runs between draft and image-prompt steps. Snaps revised CTA to META_CTAS.
- `scrapeWebsite(url, onProgress)` — multi-page crawler with SSE progress callback
- `tryShopifyCatalog(baseUrl)` — fetches `/products.json?limit=50` if site is Shopify
- `extractInternalLinks($, baseUrl)` + `scoreLink(url)` — discovery + ranking for crawl targets
- `scrapeOnePage(url)` — fetches+parses one page, captures cheerio instance for color reuse
- `extractColorsFromCss(cssText)` — hex/rgb regex matching with brightness filtering
- `generateImageOpenAI(prompt, onStatus, sessionId, {size, quality, referenceImages})` / `generateImageGemini(prompt, onStatus, sessionId)` / `generateImageHighgsfield(prompt, imageUrl, onStatus, sessionId)` — the three image backends; provider chosen via `IMAGE_MODEL` env. OpenAI auto-switches between `images.generate` and `images.edit` based on whether reference images are provided.
- `saveGeneratedPng(b64)` — shared helper; writes PNG to `server/public/generated/<uuid>.png`, returns served URL
- `decodeDataUrl(dataUrl, name)` — decodes a `data:image/...;base64,...` string into `{buffer, mime, name}` for use as reference image input
- `uploadToHighgsfield(buffer, mimeType)` — uploads a buffer to Higgsfield storage, returns public URL (used so brand product images can be passed as reference URLs to image gen)
- `extractDominantColors(buffer, count)` — sharp-based k-means dominant color extraction for uploaded brand images
- `guessAssetType(filename, buffer)` — async, uses sharp metadata (hasAlpha → logo, SVG → logo, small square → logo) to classify uploaded brand image
- `extractText(file)` — pdfjs-dist for PDFs, raw read for txt/md
- `buildDocumentContext(documents)` — concats document text for prompt injection

---

## How to update this doc
Append on every feature change:
- New endpoint → add row to **Backend endpoints** + describe in flows
- New button → add bullet under the relevant Component section
- New session field → update **Session schema**
- Renamed thing → search-replace + note in changelog (below)

Keep entries one-line where possible. Tables and bullets only. No prose paragraphs.

## Changelog (most recent first)
- **Refund-on-failure, JSON parse retry, image format gate (2026-05-03).** Three robustness fixes after first external-tester feedback. **(1) Credits refunded on generation failure.** `requireCredits()` now stamps `req.creditCharge` with `{action, credits, projectId, metadata}` whenever it succeeds. New `refundCredits()` and `refundLastCharge(req)` in `server/lib/credits.js` reverse the deduction by calling `deduct_credits(p_credits = -N, p_action = 'refund:<original>')` — same atomic SQL function, negative amount, `refund:<action>` ledger row. Wired into the catch block of every credit-charged endpoint: `/api/brand-brief`, `/api/brand-brief/adjust`, `/api/ads/adjust`, `/api/generate-angles`, `/api/generate-hooks`, `/api/generate-ad`, `/api/regenerate-prompt`, `/api/generate-ad-image` (SSE). User-facing error messages now end with "Credits refunded." Eliminates the bug where a JSON parse failure or OpenAI safety rejection would burn credits without producing output. **(2) JSON parse retry harness.** New `withJsonRetry(label, callFn)` helper wraps any LLM-returning-JSON pattern: runs `callFn(0)`, parses with `parseModelJson`; on parse failure runs `callFn(1)` once more with the prompt stiffened ("CRITICAL: previous response was unparseable. Output ONLY the JSON object, all string values properly escaped"). Each attempt logs usage so cost tracking is honest. Applied at all 5 credit-costing parse sites: `brand-brief`, `brand-brief-adjust`, `ads-adjust`, `generate-angles`, `generate-ad copy`, `generate-hooks` (inside `generateHookCandidates`), `critique-revise`. `parseModelJson` itself also got a small upgrade — tries array-shape `[...]` extraction before object-shape `{...}` so hook-array responses survive prose preambles. Eliminates the "Copy: Colon expected at position 5686" failure mode reported on the Eczema-Eradicator angle. **(3) Image upload format gate.** New `ALLOWED_IMAGE_MIMES` set (`image/png`, `image/jpeg`, `image/webp`) validated at the top of `/api/brand-assets` POST before any processing — rejects with `400 UNSUPPORTED_IMAGE_FORMAT` and a clear message naming the offending file + extension. Cleans up multer temp files on rejection. Frontend file pickers (`OnboardingWizard.jsx` × 2, `BrandPanel.jsx`) tightened from `accept="image/*"` to `accept="image/png,image/jpeg,image/webp"` so the OS dialog won't even let users select AVIF/HEIC/GIF. Eliminates the "400 Invalid file 'image[0]': unsupported mimetype ('image/avif')" failure that surfaces silently 5 minutes later at image gen time. **Bonus: cost labels on AdBuilder Generate Copy + Generate Image buttons** ("⚡ Generate Copy · 3 cr", "🖼 Generate Image · 3 cr" — derives image cost from `imageQuality` so it matches Low/Medium/High pricing live). Matches the bundled-cost pattern AngleGrid already uses for batch generation, fixes the tester complaint that single-ad gen looked cheaper than it was.
- **Session state persistence moved to Supabase (2026-05-02).** Critical data-loss fix. Session state (documents, brand brief, brand images, scraped website content, manual offers, brand colors, angles, ads, concepts, chat history) was being saved to `server/sessions.json` on local disk — wiped on every Railway redeploy, silently destroying user project data. New migration `002_session_state.sql` adds `projects.session_state JSONB DEFAULT '{}'`. New `server/lib/sessionStore.js` exports async `getSession(projectId)` / `saveSession(projectId, session)` / `invalidateSession(projectId)` with an in-memory write-through cache; reads/writes the JSONB column via `supabaseAdmin`. `server/index.js` lost its disk-store block (`SESSIONS_FILE`, `loadSessions`, `saveSessions`, the `sessions` Map, the local `getSession` function); 22 `getSession(...)` call sites await the new async getter; 17 `saveSessions()` call sites became `await saveSession(sessionId, session)`. Three endpoints that only had `req.params.sessionId` in scope (`DELETE /api/documents/:sessionId/:name`, `DELETE /api/brand-assets/:sessionId/:name`, `PATCH /api/brand-assets/:sessionId/:name/type`) now hoist a `const sessionId = req.params.sessionId` so the call sites stay uniform. `DELETE /api/projects/:id` now calls `invalidateSession(project.id)` after the row is deleted to drop the cache entry. Pre-existing relational tables (`documents`, `brand_images`, `angles`, `ads`) were never wired up in code and remain unused — left in place; if cross-project analytics is ever needed, the JSONB is queryable too. Pre-fix data in any user's old `sessions.json` is gone.
- **Onboarding upload type fix + credit pill polish (2026-05-02).** Three bug fixes after first prod smoke test. **(1) Wrong product in generated ads:** root cause was `OnboardingWizard.uploadAssets()` batching logo + product into one `/api/brand-assets` POST and letting the server's `guessAssetType()` heuristic classify them. The heuristic frequently swapped them (logo → "product", product → "logo"), so when image-gen looked for the product reference it found the logo, dropped it, and let the model invent a stand-in product. Fix: wizard now calls `/api/brand-assets` twice — once per file — with an explicit `forceType` body field. Server respects `forceType` when present (`logo` / `product` / `lifestyle`), falling back to the heuristic only when omitted (e.g. legacy `BrandPanel` uploads). **(2) Logo tagged "Product" in sidebar:** same root cause, same fix. **(3) `−−100` for top-ups in Recent Activity:** the credit_ledger uses positive `credits_used` for spends and negative for grants (top-ups + plan renewals), but `CreditPill` always prefixed `−` causing double-minuses for grants. Fix: render `+N` lime for grants, `−N` muted for spends. Also added `fmtAction()` to humanize raw action keys (`topup:topup_100` → `Top-up · 100 cr`, `image-medium` → `Image · medium`, `renewal:operator` → `Plan renewal`, etc.). **No backend or schema changes** — only `OnboardingWizard.jsx`, `CreditPill.jsx`, and a single conditional in `/api/brand-assets`.
- **Production deployment prep (2026-05-02).** Server: env-driven CORS allow-list (`CORS_ORIGINS`); `express-rate-limit` on `/api/*` (200/min/IP, webhook exempt); `trust proxy` for Railway/Fly; absolute generated-image URLs via `PUBLIC_API_URL` (relative in dev); global error handler that suppresses stack traces under `NODE_ENV=production`; `GET /health` for host health checks. Client: `authedFetch` honors `VITE_API_URL` so prod can hit a different API origin (empty in dev → relative paths via Vite proxy). New: `server/Dockerfile` (Node 22-slim, multi-step health check), `server/.dockerignore`, `client/vercel.json` (Vite framework + SPA rewrite). New `DEPLOY.md` end-to-end guide: GitHub push → Railway server deploy → Vercel client deploy → DNS at registrar (`app.ultemir.com` + `api.ultemir.com`) → Stripe webhook URL update → Supabase Auth redirect URLs → smoke test → going-live with Stripe. Known limitation documented: Railway containers are ephemeral, generated PNGs lost on restart — flagged for follow-up move to Supabase Storage.
- **Onboarding wizard live (2026-05-02).** New `OnboardingWizard.jsx` + CSS. 5 steps: name → website (live SSE crawl with progress feed + summary tile) → assets (logo + product drop zones, multipart upload) → extras (drag-drop docs + offers textarea) → building (auto-runs brief + angles, ~30-60s). Errors are recoverable per-step (retry button, partial state preserved). Project is created at step 1, so half-set-up projects remain visible in the list if the user closes mid-flow. Burns 8 cr (4 brief + 4 angles). `ProjectList` updated: `+ New brand` tile + empty-state CTA both open the wizard; old inline create form removed; project-limit check now happens in `openWizard` before launching. Replaces the dev-grade "click + → enter name → land in empty workspace" flow with the magical multi-step described in DESIGN-BRIEF.md §5.3.
- **Stripe billing live (2026-05-02).** Subscriptions (Solo $19 / Operator $49 / Studio $149 monthly) + one-time top-up packs (100/$9, 500/$39, 1500/$99). New `server/lib/stripe.js` with lazy client, env-driven price-id lookups, get-or-create customer helper. New idempotent setup script `server/scripts/setup-stripe.js` — finds-or-creates 6 products by `metadata.ultemir_key`, prints env lines to paste into `.env`. New endpoints: `POST /api/billing/checkout` (subscription OR topup → Stripe-hosted Checkout URL), `POST /api/billing/portal` (Stripe Customer Portal for cancel/swap/card update), `POST /api/billing/webhook` (mounted with `express.raw` BEFORE global `express.json` so signatures verify). Webhook handles: `checkout.session.completed` (top-ups → +credits + ledger entry), `invoice.paid` (renewal → set plan + reset credits to plan amount + push reset_at +30d), `customer.subscription.updated` (plan change → update plan key only), `customer.subscription.deleted` (cancellation → drop to free). User-id resolution uses `profiles.stripe_customer_id` first, falls back to `metadata.supabase_user_id` we stamp on every checkout session. **Frontend:** new `PricingModal` (3-tier plan picker w/ Operator marked popular, current-plan disabled state). New `CheckoutToast` (bottom-right toast on `?checkout=success/cancel` return URL — polls `/api/me` 5× to catch the webhook race). `OutOfCreditsModal` top-up buttons now hit `/api/billing/checkout` directly + redirect; "Upgrade plan" CTA opens `PricingModal`. `CreditPill` gets a "Manage billing →" link that hits `/api/billing/portal` (only shown if user has a Stripe customer). Setup notes added to FEATURES.md — `STRIPE_SECRET_KEY` + `stripe listen` + run setup script + paste price IDs.
- **Credit system end-to-end + admin margin dashboard (2026-05-02).** Backend: new `server/lib/credits.js` defining `CREDIT_COSTS` (action → credits) and `PLAN_LIMITS` (plan → credits + project limit + price). Helpers: `chargeCredits()` calls the atomic `deduct_credits` SQL function (no race conditions); `requireCredits(req, res, action)` is the endpoint wrapper that 402s on shortfall. Wired into every paid endpoint: `/api/brand-brief` (4 cr), `/api/brand-brief/adjust` (1 cr), `/api/generate-angles` (4 cr), `/api/generate-hooks` (1 cr), `/api/generate-ad` (3 cr copy), `/api/regenerate-prompt` (1 cr), `/api/ads/adjust` (1 cr), `/api/generate-ad-image` (1/3/8 cr by quality). New endpoints: `GET /api/me` (profile + plan + credits + project count + creditCosts map — single source of truth for the UI), `GET /api/me/credit-history` (last 50 ledger entries), `GET /api/admin/margin` (gated to `ADMIN_EMAIL` env — joins profiles + this-month credit_ledger to compute per-user revenue/Stripe-fee/COGS/utilization/gross margin %). `POST /api/projects` enforces `project_limit` per plan (Solo=1, Operator=3, Studio=15, Scale=999) — 402 with `code: 'PROJECT_LIMIT_REACHED'` otherwise. **Frontend:** new `MeProvider` (`client/src/lib/MeContext.jsx`) wraps everything below `AuthGate`; exposes `useMe()` with `checkPaymentRequired(response)` — the canonical way every credit-costing fetch handles 402. New `CreditPill` (`client/src/components/CreditPill.jsx`) replaces `UsagePill` in the header — shows `214 cr · 12d` with tone (lime/yellow/red), click for plan + reset + recent activity popover. New `OutOfCreditsModal` (`client/src/components/OutOfCreditsModal.jsx`) auto-opens on 402, has top-up pack buttons (Stripe-pending) + Upgrade CTA. AdBuilder + AngleGrid quality selectors swap dollar text for credit text (`Low · 1 cr` etc.). AngleGrid batch button shows total batch cost (`Generate 8 ads · 56 cr`). Project list shows `2 / 3 brands · Operator`; "+New brand" tile turns into "Upgrade for more brands" when at limit. Every credit-costing fetch in `App.jsx`, `AdBuilder.jsx`, `AdAdjustPanel.jsx`, `BriefCard.jsx` calls `checkPaymentRequired()` first + `refreshMe()` on success so the pill ticks down. `ProjectsContext.createProject` 402-handles + refreshes. **No Stripe yet** — Top up + Upgrade buttons are placeholders for the next slice.
- **Full API auth + session ownership (2026-05-02).** Every `/api/*` endpoint (except static `/api/generated/*` and marketing `/landing`) now requires `Authorization: Bearer <jwt>` via `requireAuth`. Session-scoped endpoints additionally call new helper `requireSessionOwnership(req, res, sessionId)` in `server/lib/auth.js`, which queries `projects` and verifies the supplied `sessionId` (= project.id) belongs to `req.user.id` — sends 403 if not. Locked: documents (POST/DELETE), brand-name, brand-assets (POST/GET/PATCH/DELETE), scrape-colors (SSE), website-content (GET), manual-offers, brand-brief (+adjust), generate-angles, generate-hooks, generate-ad, regenerate-prompt, generate-ad-image (SSE), ads/adjust, session/:id, ad-formats, meta-ctas, plus the three legacy routes. Client side: every `fetch('/api/...')` call across `App.jsx`, `AdBuilder.jsx`, `BrandPanel.jsx`, `DocumentPanel.jsx`, `BriefCard.jsx`, `AdAdjustPanel.jsx`, `ChatPanel.jsx` swapped to `authedFetch` so the JWT auto-attaches. Verified: no-token = 401 across the API; only `/api/generated/*` and `/landing` remain open.
- **Project-scoped sessions (2026-05-02).** Each project is now its own isolated workspace — fixes the multi-brand bug where docs/angles/ads from project A leaked into project B because App read a single global sessionId from localStorage. Implementation: App accepts an optional `sessionId` prop with localStorage fallback. Workspace passes `currentProject.id` as the sessionId AND uses `key={currentProject.id}` so React fully remounts App on project switch (resets all in-memory state). The server's existing `getSession()` lazily creates the session row keyed by whatever sessionId is passed — projectId works as the session key with zero schema changes. Old global localStorage `adgen_session_id` is now orphaned (still in `sessions.json` but unreachable from any project) — acceptable for the test phase.
- **AI chat to adjust generated ads (2026-05-02).** New `POST /api/ads/adjust` endpoint (Claude Haiku, ~$0.005/edit) takes a free-text instruction + the current ad's 4 copy fields and returns rewritten versions. Preserves locked hook (`chosenHook`) verbatim, snaps CTA to META_CTAS whitelist defensively. Accepts optional `currentCopy` from client so in-progress local edits aren't lost. New `AdAdjustPanel` component (`client/src/components/AdAdjustPanel.jsx` + CSS) — inline chat panel mirroring brief Adjust: textarea + 5 suggested instructions + ⌘+Enter shortcut. Wired into `AdBuilder.jsx` via `✨ Adjust` button on the score row. On apply, synchronizes both `editedCopy` (local AdBuilder state) and `onAdUpdate(adKey, ...)` (global ads state) so all downstream UI updates instantly. Image is NOT regenerated; user can fire image gen separately if they want one.
- **Per-card aspect + quality selectors on angle cards (2026-05-02).** Two compact mono-styled selects on each angle card's action row (aspect: 1:1 / 2:3 / 3:2, quality: Low / Medium / High). Default 1:1 + Medium. Disabled during generation. New `App.imageSettings` state + `setImageSetting(angleId, key, value)` helper; `generateAdSequence` reads per-angle settings via `getImageSetting()`. Inside an expanded card, the existing AdBuilder selectors still work for fine post-gen control.
- **Step 2 + Step 3 collapsed into one batch surface (2026-05-02).** New flow: select angles → click "Generate N ads" → all ads run in parallel (concurrency 5) with live per-card progress → done cards show image thumbnail + headline + scores → click to expand the full AdBuilder inline for editing. Step 3 (separate AdBuilder list) is gone. New `client/src/lib/concurrency.js` (small `parallelLimit` helper). New App state: `adStages` (idle/generating-copy/generating-image/done/error per angle), `adErrors`, `expandedAngles` (Set), `batchGenerating`. New `generateAdSequence(angleId)` runs copy→image end-to-end for one angle (skips hook picker — `chosenHook: null`). New `runBatch(angleIds)` parallel-limits 5 sequences. AngleGrid rewritten: format dropdown per card with `✨ suggested` tag when matching `suggestedFormatIds[0]`, sticky batch bar at grid top with progress text + Generate button, per-card stage pill, in-line gen spinner, result strip with thumbnail/headline/score chips, "Open ad ↗" expand button. Expanded cards span the full grid row and render existing `<AdBuilder>` for fine-grained edits. Session-hydrate effect restores `done` state on cards that already have ads in `ads`. No backend changes — `/api/generate-ad` and `/api/generate-ad-image` reused as-is.
- **Product-reference always attached + format-aware integration rules (2026-05-02).** Bug: previously the product image was only attached to OpenAI image-gen when `format.needsProduct === true`. For narrative TOFU formats (`confession`, `indictment`, `pattern_interrupt`, `real_talk`, etc.) flagged `needsProduct: false`, the product was silently dropped from the reference set — so the model invented a generic product or omitted it. The logo, which had no such gate, always appeared. Result: ads with logo but no product. Fix: product reference is now ALWAYS attached when uploaded, regardless of format. The `needsProduct` flag now controls **prominence and requirement**, not inclusion: `true` → product MUST appear as visual hero, anchored exactly to reference (Uvora-bottle quality); `false` → product is OPTIONAL, model decides based on format intent (a confession essay shouldn't have a product hero shot — would break the format), but if the model chooses to include it (e.g. subtle in-hand shot), the reference is there so it matches the real product instead of being invented. Treats legacy `lifestyle`-typed images as product. `craftImagePrompt` updated accordingly + the contradictory "no product photo reference" note that fired for narrative formats is removed.
- **Layer 1 — Suggested formats per angle (2026-05-02).** Angle generator now picks 1-3 best-fit `suggestedFormatIds` per angle alongside the existing fields. AD_FORMATS catalog (id + funnel + name + description) is included in the prompt; system prompt explains how to choose (funnel match required, intent fit, avoid `needsProduct=true` for angles without product hook). Server validates the model's output: drops unknown ids, drops ids whose funnel ≠ angle.funnelStage, caps at 3. AngleGrid renders chips below each card — "Suggested" mono-label + chips, top pick lime-styled, backups muted; hover tooltip = format description. App-level `useEffect` pre-fills `selectedFormats[angle.id] = suggestedFormatIds[0]` when angles arrive (never clobbers user picks). Removes 20 manual format picks from the workflow when the user accepts the model's recommendations. Layer 2 (batch generation w/ live progress) and Layer 3 (copy-only vs copy+image cost split) deferred to later sessions.
- **Brief v2 + Adjust + tolerant model JSON parsing (2026-05-02).** Three coordinated wins: **(a)** New `parseModelJson()` helper in `server/index.js` wraps every model JSON.parse with a try-then-jsonrepair fallback (handles unescaped quotes, trailing commas, control chars). All 7 model JSON.parse sites swapped — the user-reported "Expected ',' or '}' at position 1438" copy-gen crash is now self-healing. Logs `[parseModelJson] ...: jsonrepair fixed malformed output` when repair was needed so we can monitor model regressions. **(b)** `POST /api/brand-brief` now accepts any subset of {docs, website, manual offers} — was incorrectly hard-blocking on docs-required. Pricing context restructured into two trust tiers: "Prices visible on offer / landing pages" (PREFERRED — bundle-app overrides) vs "Raw Shopify catalog" (labeled as may-not-match). System prompt expanded with depth bar: ≥5 avatars (some inferred), ≥10 pains, ≥10 desires, ≥8 proofPoints (tagged evidence/inferred), ≥5 competitorGaps + new `marketGaps[]` + new `inferredCompetitors[]` + brandVoice as `{summary, saysLike, neverSaysLike}`. `/api/generate-angles` prompt updated to consume the new fields — at least 4 of 20 angles must explicitly target a competitorGap or marketGap; angles distributed across all 5-7 avatars (no single avatar > 5 angles). `BriefCard.jsx` rewritten to render both v1 and v2 schemas defensively + new sections (Market Gaps, Likely Competitors, says/never-says grid). **(c)** New `POST /api/brand-brief/adjust` endpoint — Claude Haiku rewrites brief based on free-text user instruction (~$0.005/edit). New `✨ Adjust` button on `BriefCard` opens inline panel with textarea + 4 suggested edits + ⌘+Enter shortcut. Brand-asset type selector also tightened: text "Logo" / "Product" instead of icons; "Lifestyle" removed from UI (server still accepts for backward compat).
- **Phase 1 — Project model live.** Five new endpoints behind `requireAuth`: `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`. Server uses `supabaseAdmin` (service-role) and manually scopes by `req.user.id`; ownership-checked routes use `requireProjectOwnership`. Auto-slug helper enforces `UNIQUE(user_id, slug)` with `-N` suffix on collision. Client adds `ProjectsProvider` + hash-based `Router` (`#/` = list, `#/p/<id>` = workspace) — no react-router dep added. New `ProjectList` dashboard (brand grid + inline create + delete with confirm), new `Workspace` wrapper that slips a breadcrumb bar above the existing `<App />`. **Existing AdBuilder/AngleGrid/etc. NOT yet project-scoped** — next slice migrates the session model so docs/angles/ads land in Postgres against `project_id` instead of `sessions.json` against `session_id`. Server-side stale-JWT failure now logs the real Supabase error (was being masked by `auth-js`'s "Auth session missing!" wrapper); client-side `authedFetch` auto-signs-out on 401.
- **Phase 1 — `requireAuth` proof on `/api/usage*`.** First three endpoints behind the auth wall: `GET /api/usage`, `POST /api/usage/reset`, `GET /api/usage/timing`. Server now imports `requireAuth` from `server/lib/auth.js`. Client callers (`UsagePill.refresh`, the reset btn, AdBuilder's two `/api/usage/timing` fetches) swapped from raw `fetch` → `authedFetch` from `client/src/lib/supabase.js` (auto-attaches `Authorization: Bearer <jwt>`). **Env-load fix:** extracted server `.env` parsing into `server/lib/load-env.js` and side-effect-imported it as the FIRST import in `server/index.js`, so transitive imports (`lib/supabase.js`) see vars at evaluation time. Curl-verified: no-token → 401, bogus-token → 401, open endpoints (`/api/ad-formats`) → 200. Pattern is now ready to project-scope every other endpoint.
- **Phase 1 — Auth gate live.** Whole app now sits behind a Supabase-Auth gate. New `AuthProvider` (`client/src/lib/AuthContext.jsx`) wraps the tree from `main.jsx`; `AuthGate` (`client/src/components/AuthGate.jsx`) shows `AuthPage` when no session and renders the existing `<App />` once signed in. `AuthPage` (`client/src/components/AuthPage.jsx`) is a centered login/signup card built on `Btn` + `Card` design primitives; email + password v1 (OAuth + magic-link deferred). Header gets a new `UserMenu` next to `UsagePill`: lime-circle avatar → popover with email + Log out. Server endpoints are NOT yet `requireAuth`-wrapped; existing dev loop continues to work after sign-in. **Storage buckets created:** `brand-assets` (private, 25MB, image/PDF/text mimes) + `generated-ads` (public, 15MB, image mimes), both with per-user-folder RLS policies (path convention: `<bucket>/<user_id>/<project_id>/<filename>`).
- **Phase 1 foundation laid (auth + DB).** Supabase project provisioned (URL + anon + service-role keys in env). `@supabase/supabase-js` installed on both server + client. Created `server/lib/supabase.js` (admin + user-scoped clients), `server/lib/auth.js` (`requireAuth` middleware, `optionalAuth`, `requireProjectOwnership` helper), `client/src/lib/supabase.js` (singleton + `authedFetch` helper). Schema migration written at `server/migrations/001_initial_schema.sql` — covers profiles (extends auth.users), projects, documents, brand_images, angles, ads, credit_ledger; auto-create-profile trigger on signup with 30 free credits; atomic `deduct_credits()` SQL function (no race conditions); RLS policies on every table; auto-`updated_at` triggers on projects+ads. **Migration awaiting one-time paste in Supabase SQL editor.**
- **Design system locked + landing page wired in.** Pulled the Claude Design bundle (Ultemir Landing) into `marketing/` at project root. Served at `/landing` via Express static (temporary — will deploy separately to ultemir.com). Updated `client/src/index.css` with full design-system token set (--bg, --surface, --surface-2, --border, --border-strong, --text/2/3/4, --accent/2/dim/on, --success/warn/danger, density variants, light theme override). Loaded Geist + Geist Mono via Google Fonts. Created shared UI primitives at `client/src/components/ui/index.jsx` (Btn, Card, Eyebrow, FunnelBadge, ScoreChip, StatusPill, Kbd) mirroring the marketing components — these become the building blocks of every new app screen built in Phase 1.
- **Hook separation shipped (Roadmap T1.2 ✅)**: new `/api/generate-hooks` endpoint produces 10 distinct candidates (Sonnet, ~$0.015/call). New "Pick your hook" inline UI in AdBuilder — appears between Generate Copy click and body generation. User picks a hook or writes their own; chosen hook is locked verbatim into the body via the system prompt. Stored on the ad as `chosenHook`. Buttons "↺ Generate 10 new hooks", "Skip — let AI pick", and "Cancel" all wired up.
- **Native ad blueprint codified**: founder-supplied 20-beat long-form direct-response structure (Hook → Lead×3 → Storyline → Identification → Symptoms → Fear → Failed solutions → Consequences → Vindication+Loss aversion → Mechanism Problem → Mechanism Solution → Organic Product Intro → Differentiation → Social Proof → Risk Reversal → Urgency → Scarcity → CTA → PS → PPS). Injected as `NATIVE_AD_BLUEPRINT` only when `format.isNative === true`. Long formats (confession, indictment, founder_story) flagged native. Capitalization rules locked: sentence case for headlines/descriptions, no Title Case, no all-caps shouting.
- **Brand palette migrated** to Ultemir (electric lime `#c5ff3d` + near-black `#0a0a0a`). CSS variables in `client/src/index.css` swapped from purple to brand palette. Added `.btn-primary` (lime-on-black) and `.btn-secondary` (ghost lime) base styles.
- **Reference-image bug fix**: switched OpenAI image gen from `new File()` (Node-unreliable) to SDK's `toFile()` helper. References (logo + product) now actually reach the API — they were silently being dropped before. Added server-side diagnostic logging that surfaces every brandImage's type/dataUrl status when generating, and which references got attached. The art-director prompt now explicitly anchors to "reference image 1/2" with hard rules instead of describing the product abstractly (which was overriding the reference).
- **Image gen timing tracking**: every image gen now logs `durationMs` + `quality` + `size` to the usage ledger. New `/api/usage/timing` endpoint computes observed avg/p50/p90 per quality. AdBuilder dropdown shows real estimates ("Low — ~8s · ~$0.01") and a hint line that auto-calibrates after each gen. Helps users not think the browser is glitching during a 60s High gen.
- **De-templated AD_FORMATS**: replaced rigid `copyStructure` paragraph-by-paragraph templates with high-level `intent` field (strategic/emotional purpose). Replaced generic `imagePrompt` seed strings with `visualDirection` (mood/register only, not composition). System prompt now explicitly bans templated structures and tells the model to DESIGN the shape per angle. Two ads using the same format on different angles will now look structurally different.
- **Reference-aware image generation**: OpenAI image gen now uses `images.edit` with multi-reference inputs when user has uploaded logo and/or product photo. The art-director prompt is now reference-aware — explicitly instructs the model to (1) replicate the product reference exactly, (2) use the logo reference as the actual logo placement, (3) NOT generate competing brand wordmarks elsewhere in the composition. Fixes the "Uvora wordmark + duplicate PureLivera logo" duplication bug.
- Self-critique + revise loop in `/api/generate-ad` (Roadmap T1.3 ✅): Claude Haiku scores draft on 4 axes, rewrites weak sections, image prompt is generated from revised copy. Scores + critique surfaced as colored chips in AdBuilder. Added `claude-haiku-4-5` and `gpt-4o-mini` to PRICING.
- Per-ad aspect-ratio + quality selectors in AdBuilder (Square/Portrait/Landscape × Low/Medium/High); persisted on ad object server-side; estimated cost shown inline in the dropdown labels
- Token-accurate image cost tracking: PRICING now supports three types (`text`, `image-tokens`, `flat`); OpenAI image gen captures real `usage.input_tokens_details` for precise per-image billing across all OpenAI image variants (gpt-image-2 ~$0.032, mini ~$0.008, etc.)
- Default OpenAI image model bumped to `gpt-image-2` (cheaper than v1 with same text-rendering quality); `OPENAI_IMAGE_QUALITY` env (low/medium/high) added
- Image provider abstraction: added Gemini (Nano Banana) backend; OpenAI model name now configurable via `OPENAI_IMAGE_MODEL` env (so `gpt-image-2` works without code change); `IMAGE_MODEL=gemini` switches to Google; `saveGeneratedPng()` shared helper
- Usage tracking: PRICING config, append-only `server/usage.json` ledger, every model call instrumented with `logUsage()`, GET/POST `/api/usage` endpoints, header UsagePill component (live cost popover)
- FEATURES.md audit: corrected `/api/upload` → `/api/documents`, added legacy endpoints (`/api/generate-concepts`, `/api/generate-images`, `/api/chat`), added legacy components section (ChatPanel, ConceptGrid), documented server helper functions (`craftImagePrompt`, `scrapeWebsite`, `tryShopifyCatalog`, etc.), expanded AD_FORMATS internal field schema, added server filesystem layout
- ScrapedDataInspector: legacy-format detection + raw JSON fallback
- /api/website-content/:sessionId GET endpoint
- Manual offers feature (textarea + /api/manual-offers + integration into brief & image prompt)
- Multi-page crawler with Shopify /products.json detection + SSE progress
- Two-call ad generation: copy then dedicated art-director image prompt (`craftImagePrompt`)
- gpt-image-1 default with Higgsfield as IMAGE_MODEL=higgsfield fallback
- META_CTAS whitelist + dropdown CTA picker
- Schwartz/Breakthrough Advertising copy framework, awareness-mapped per funnel
- Per-card AdBuilderBoundary error boundary, anti-extension attributes
- Image rendered as 220px thumbnail w/ expand + download
- Image prompt always visible + ↺ Regen Prompt
- Copy-to-clipboard buttons on every field
- Collapsible AdBuilder cards
- 20 hardcoded ad formats library
- 20 angles with 8/7/5 funnel split, normalized funnelStage on session load

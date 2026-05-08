# Handoff Checklist

This codebase contains **no committed credentials**. Every secret lives in `server/.env` (gitignored — never tracked). To take this over, you'll create your own accounts on every external service the app uses, drop your own keys into `server/.env`, and deploy under your own infrastructure.

Walk through this top-to-bottom.

---

## 1. What's already clean

- `.env` files are in `.gitignore` and have never been committed (verified with `git log --all -- '**/.env'` returning nothing).
- The only key-shaped strings in tracked files (`sk_test_…`, `whsec_…`, `eyJhbGc…`) are placeholder examples in [DEPLOY.md](DEPLOY.md) and [FEATURES.md](FEATURES.md), not real values.
- Admin gating in [server/lib/admin.js](server/lib/admin.js) is now fully env-driven — no hardcoded email. Set `ADMIN_EMAIL=you@example.com` to grant yourself admin access.

## 2. External services to create (in this order)

Each one is free or has a free tier. You'll get keys from each and drop them into `server/.env`.

| Service | What it's for | Where to set up |
|---|---|---|
| **Supabase** | Auth + Postgres + Storage (project state, user accounts, generated images) | https://supabase.com → New project. Then run the SQL migrations in [server/migrations/](server/migrations/) on your project. |
| **Anthropic** | Claude Sonnet (copy gen, art-director, vision analysis) and Haiku (critique, ad-adjust) | https://console.anthropic.com |
| **OpenAI** | gpt-image-2 (image gen) and GPT-4o (brand brief, angles) | https://platform.openai.com |
| **Higgsfield** *(optional but recommended)* | Image-gen fallback when OpenAI rejects on safety. Free tier available | https://higgsfield.ai |
| **Gemini** *(optional)* | Second image-gen fallback. Free tier on AI Studio | https://aistudio.google.com |
| **Stripe** *(only if you want paid subscriptions)* | Payments. Test-mode keys work for everything except real money | https://dashboard.stripe.com |
| **Railway** *(or Fly.io / Render)* | Hosts the Node server (`server/`). Auto-deploys from your GitHub fork | https://railway.com |
| **Vercel** | Hosts the Vite SPA (`client/`) and the marketing landing (`marketing/`). Auto-deploys | https://vercel.com |

## 3. Set up `server/.env`

Copy [server/.env.example](server/.env.example) to `server/.env` and fill in YOUR values. The full set of env vars is documented in [FEATURES.md](FEATURES.md) under "Environment variables". Minimum to run locally:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
ADMIN_EMAIL=you@example.com
PORT=3001
```

Add Stripe / Higgsfield / Gemini as you wire those up later. The full deploy guide is in [DEPLOY.md](DEPLOY.md) with every step from "fork the repo" to "production webhook live."

## 4. Don't run with the previous owner's keys

Even though no keys are committed, if the previous owner ever shared their `.env` with you, **assume those keys are still active on their account** and don't use them — you'd be billing through their card. Generate fresh keys on every service above.

## 5. Search-and-replace branding (optional but recommended)

The marketing landing, legal pages, and a few comments still reference the previous brand. Run these find-and-replaces if you're rebranding:

- **`Ultemir`** → your brand name (appears in `marketing/`, `client/src/components/ProjectList.jsx`, `index.html`, etc.)
- **`ultemir.com`** → your domain
- **`cyrusvakil@ultemir.com`** → your contact email (in `marketing/privacy.html`, `marketing/terms.html`, `marketing/sections.jsx`)

Quick way to see all hits:
```bash
grep -rn "Ultemir\|ultemir\|cyrusvakil" --include="*.html" --include="*.jsx" --include="*.js" --include="*.md" .
```

If you skip this, the app still works — it just shows the previous brand to users.

## 6. The legal pages need YOUR review

[marketing/privacy.html](marketing/privacy.html) and [marketing/terms.html](marketing/terms.html) are templates that name the previous owner. Before launching publicly:
- Update the company name, contact email, and jurisdiction
- Have a lawyer (or a legal-template service like Termly / Iubenda) review them — what's there is a starting point, not legal advice you can ship as-is

## 7. Verify before going live

Once your env is set up and you've deployed:

- [ ] Sign up as your admin email → "Admin" link appears in the header
- [ ] Visit `/#/admin` → totals load (will be zeros until you have users)
- [ ] Create a brand → upload a doc → generate brief, angles, an ad. Each step should debit credits and the credit pill should tick down.
- [ ] In Supabase Storage, create the `generated-ads` and `brand-images` buckets if the app errors on image upload (the migration creates them; double-check)
- [ ] In Stripe, set up products + prices that match `STRIPE_PRICE_*` env names. Webhook URL = `https://<your-server-host>/api/stripe/webhook`. See [DEPLOY.md](DEPLOY.md#step-5-stripe-webhook-setup).

## 8. Things to know

- **Costs:** With the design defaults, 1 credit ≈ $0.025 in real model spend. The `/admin` page shows your real numbers from the credit ledger.
- **Image-gen safety fallback:** OpenAI rejects body / intimate-apparel / health prompts as "safety violations" — the system auto-falls-back to Higgsfield (and then Gemini) if those keys are set. Without fallbacks, those brands will fail.
- **Nothing in `marketing/` is required to run the app.** It's a separate landing page deploy. You can delete the folder if you don't want a marketing site.

## 9. Post-handoff cleanup for the previous owner

If you're the previous owner reading this: revoke your keys on each service after you confirm your friend has their own working setup. Keys to rotate or delete:
- Anthropic, OpenAI, Higgsfield, Gemini API keys
- Stripe restricted keys + webhook signing secret
- Supabase service-role key + database password
- Any `.env` file you may have shared via DM / email

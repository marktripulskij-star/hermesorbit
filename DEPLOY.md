# Production deployment

End-to-end guide for taking Ultemir from `localhost` to `app.ultemir.com`. Assumes you own the domain and have GitHub access.

**Hosting decisions (recommended):**
- Client: **Vercel** (free tier fine for now)
- Server: **Railway** ($5/mo Hobby — has hours-based pricing)
- DNS: **Cloudflare** (proxied) or your registrar's DNS
- Domains:
  - `ultemir.com` → marketing landing page (Phase 5, separate)
  - `app.ultemir.com` → React client (this guide)
  - `api.ultemir.com` → Express server (this guide)

> Estimated time: **30–45 min** end-to-end if you have all accounts ready.

---

## Step 1 — Push to GitHub

If the repo isn't on GitHub yet:

```bash
cd "/Users/cyrusvakil/ai image project"
git init
git add -A
git commit -m "Initial production-ready commit"
gh repo create ultemir --private --source=. --push
```

> Make sure `server/.env` and `client/.env` are NOT committed — there's a `.gitignore` rule. Double-check with `git status` before you push.

---

## Step 2 — Deploy the server to Railway

1. Go to https://railway.app → New Project → **"Deploy from GitHub repo"** → pick the `ultemir` repo.
2. Railway will see the `server/Dockerfile` and use it. **Set the service's "Root Directory" to `server`** in service settings, otherwise it'll try to build from the repo root.
3. Add environment variables (Service → Variables → Raw Editor — paste all at once):

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
HIGGSFIELD_CLIENT_ID=...
HIGGSFIELD_CLIENT_SECRET=...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
SUPABASE_DB_HOST=...
SUPABASE_DB_PORT=5432
SUPABASE_DB_USER=postgres
SUPABASE_DB_PASSWORD=...
SUPABASE_DB_NAME=postgres
ADMIN_EMAIL=you@example.com           # email of the user who can access /admin
STRIPE_SECRET_KEY=sk_test_...           # or sk_live_ when ready
STRIPE_PRICE_SOLO=price_...
STRIPE_PRICE_OPERATOR=price_...
STRIPE_PRICE_STUDIO=price_...
STRIPE_PRICE_TOPUP_100=price_...
STRIPE_PRICE_TOPUP_500=price_...
STRIPE_PRICE_TOPUP_1500=price_...
STRIPE_WEBHOOK_SECRET=whsec_...         # see Step 5 — set after first deploy
APP_URL=https://app.ultemir.com
PUBLIC_API_URL=https://api.ultemir.com
CORS_ORIGINS=https://app.ultemir.com,https://ultemir.com
NODE_ENV=production
RATE_LIMIT_PER_MIN=200
```

4. Settings → Networking → **Generate Domain** (for now). You'll get a `*.up.railway.app` URL — visit it + `/health`, should return `{ok:true}`.
5. Once the custom domain is added (Step 4), update `PUBLIC_API_URL`.

**Known limitation — generated images are ephemeral.** Railway containers restart periodically (deploys, OOM, etc.) and `public/generated/*.png` is lost when they do. Until we move generated images to Supabase Storage, regenerate images that 404. (Tracked as a follow-up.)

---

## Step 3 — Deploy the client to Vercel

1. Go to https://vercel.com → **Add New → Project** → import the `ultemir` repo.
2. **Set the "Root Directory" to `client`** in project settings.
3. Framework preset: Vite (auto-detected via `vercel.json`).
4. Environment variables (Project Settings → Environment Variables):

```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
VITE_API_URL=https://api.ultemir.com
```

5. Deploy. You'll get a `*.vercel.app` URL — visit it. The auth screen should render (won't be able to log in yet because we haven't updated Supabase redirects — Step 6).

---

## Step 4 — DNS (point your domain to the deployments)

In your DNS provider (Cloudflare recommended):

```
app.ultemir.com   CNAME   cname.vercel-dns.com.
api.ultemir.com   CNAME   <your-railway-service>.up.railway.app
```

(`ultemir.com` apex → Phase 5 — landing page deployment.)

In **Vercel** → Project → Settings → Domains → add `app.ultemir.com`. It'll show pending verification, then verify within ~5 min.

In **Railway** → Service → Settings → Networking → Custom Domain → add `api.ultemir.com`.

Once both verify, hit `https://api.ultemir.com/health` and `https://app.ultemir.com` to confirm.

---

## Step 5 — Update the Stripe webhook to production

The local `stripe listen` command is dev-only. For prod, register a webhook in the Stripe dashboard:

1. https://dashboard.stripe.com/test/webhooks (or `/webhooks` for live mode) → **Add endpoint**.
2. Endpoint URL: `https://api.ultemir.com/api/billing/webhook`
3. Events to listen for:
   - `checkout.session.completed`
   - `invoice.paid`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Click "Add endpoint", then click into it → **Signing secret** → reveal → copy.
5. In Railway, update `STRIPE_WEBHOOK_SECRET` to this new value (replacing the local `whsec_…` from `stripe listen`). Service auto-redeploys.

> Test it: in Stripe dashboard → click into the webhook endpoint → "Send test webhook" → pick `invoice.paid` → check Railway logs for `[webhook] invoice.paid`.

---

## Step 6 — Update Supabase Auth redirects

By default Supabase sends signup confirmation emails with `http://localhost:3000` redirect URLs. In prod those need to point at `app.ultemir.com`.

1. Supabase dashboard → Authentication → URL Configuration.
2. **Site URL**: `https://app.ultemir.com`
3. **Redirect URLs** (allow-list, add both during cutover):
   - `https://app.ultemir.com/**`
   - `https://app.ultemir.com`
   - (Keep `http://localhost:3000/**` while you still test locally.)

Save.

> Optional: Authentication → Email Templates → customize the signup-confirmation email to match the brand. Leave default for now if you're shipping fast.

---

## Step 7 — Smoke test the full flow

On `https://app.ultemir.com`:

1. **Sign up** with a new email → confirm email link points at `app.ultemir.com` (not localhost).
2. **Onboarding wizard** runs through brief → angles end-to-end.
3. **Generate copy + image** for an angle. Confirm the image renders (URL should be `https://api.ultemir.com/api/generated/...`).
4. **Click Top up** → Stripe Checkout (test card `4242 4242 4242 4242`) → land back at `app.ultemir.com/?checkout=success` → credits tick up.
5. **Manage billing** → Stripe Customer Portal opens → cancel subscription → check Railway logs for the `customer.subscription.deleted` webhook firing.

If all 5 work, you're live.

---

## Step 8 — Going live with Stripe (when ready for real payments)

When ready to accept real money (after beta), swap from `sk_test_*` to `sk_live_*`:

1. Re-run `node server/scripts/setup-stripe.js` **with the live key in `STRIPE_SECRET_KEY`**. This creates new live-mode products + price IDs (Stripe test/live data is fully separate).
2. Update Railway env vars:
   - `STRIPE_SECRET_KEY` → live key
   - All 6 `STRIPE_PRICE_*` → live price IDs
3. Register a new webhook in https://dashboard.stripe.com/webhooks (live mode) — same URL + events as test. Update `STRIPE_WEBHOOK_SECRET` to the new live signing secret.
4. **Test once with a real card** — buy your own $9 top-up. Refund yourself from the Stripe dashboard.

---

## What's deferred (not blocking launch)

- **Sentry / error monitoring** — wire up `@sentry/node` after first beta error you can't reproduce.
- **Resend / transactional emails** — Supabase sends signup/reset emails by default; add Resend when you want branded receipts + monthly summary emails.
- **Privacy + Terms pages** — required for prod. Either Termly (auto-generated, ~free) or hand-write. Link from the auth screen footer.
- **Move generated images to Supabase Storage** — fixes the Railway ephemeral-storage issue. Buckets are already provisioned (`generated-ads` is public).
- **Postgres backups** — Supabase Pro tier ($25/mo) auto-backs-up daily. Free tier doesn't. Upgrade before any non-test data matters.
- **Logging — structured + searchable** — Railway has built-in log search. Sufficient for now.

---

## Quick rollback

If something breaks after a deploy:

- **Server (Railway):** Service → Deployments → click any green deploy → "Redeploy" rolls back to that exact image.
- **Client (Vercel):** Deployments tab → "..." next to any prior deploy → "Promote to Production".

Both take <30s.

---

## Local dev still works

None of the prod config changes break local dev:

- `CORS_ORIGINS` unset → server reflects any origin (dev-friendly).
- `PUBLIC_API_URL` unset → image URLs stay relative (Vite proxy handles them).
- `VITE_API_URL` unset → client fetches stay relative (Vite proxy handles them).
- `NODE_ENV` unset → error handler returns full messages (dev-friendly).

So the same code runs in both — env flips behavior.

// Side-effect import — parses server/.env into process.env BEFORE any other
// import that reads env at evaluation time (e.g. lib/supabase.js).
import './lib/load-env.js'

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI, { toFile } from 'openai'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import sharp from 'sharp'
import { requireAuth, requireProjectOwnership, requireSessionOwnership } from './lib/auth.js'
import { supabaseAdmin } from './lib/supabase.js'
import { getSession, saveSession, invalidateSession, flushAllPending } from './lib/sessionStore.js'
import {
  CREDIT_COSTS, PLAN_LIMITS, TOPUP_PACKS, getPlanLimits,
  imageActionForQuality, requireCredits, refundLastCharge,
  refundCredits, chargeCredits,
} from './lib/credits.js'
import { isAdminEmail, requireAdmin } from './lib/admin.js'
import {
  getStripe, priceForPlan, priceForTopup,
  planKeyForPrice, topupKeyForPrice, getOrCreateCustomer,
} from './lib/stripe.js'
import { jsonrepair } from 'jsonrepair'
import rateLimit from 'express-rate-limit'
import { createRequire } from 'module'
const _require = createRequire(import.meta.url)
const cheerio = _require('cheerio')

// Tolerant JSON parser for model output. Sonnet/Haiku occasionally emit
// unescaped quotes, trailing commas, or stray prose around the JSON. We try:
//   1) Plain JSON.parse on the raw text
//   2) Strip ```json fences then parse
//   3) Extract first {...} block then parse
//   4) jsonrepair as last resort (handles unescaped quotes, control chars, etc.)
// Logs to stderr when a repair was needed so we can monitor model regressions.
function parseModelJson(raw, { sourceLabel = 'model' } = {}) {
  if (typeof raw !== 'string') throw new Error(`${sourceLabel}: expected string, got ${typeof raw}`)
  try { return JSON.parse(raw) } catch {}
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  // Try array first if the response looks like one — some endpoints expect [..]
  try { return JSON.parse(s) } catch {}
  const arrayMatch = s.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]) } catch {}
  }
  const objectMatch = s.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    s = objectMatch[0]
    try { return JSON.parse(s) } catch {}
  }
  // jsonrepair handles: unescaped quotes inside strings, trailing commas,
  // unquoted keys, single quotes, newlines in strings, comments.
  try {
    const repaired = jsonrepair(s)
    const out = JSON.parse(repaired)
    console.warn(`[parseModelJson] ${sourceLabel}: jsonrepair fixed malformed output (len=${raw.length})`)
    return out
  } catch (e) {
    console.error(`[parseModelJson] ${sourceLabel}: unrecoverable. Raw[0..400]=`, raw.slice(0, 400))
    throw e
  }
}

// Run an LLM call that returns JSON, with parse-failure retry.
// `call(attempt)` should perform the model request and return the raw text.
// `attempt` starts at 0; on retry the helper passes 1 so the caller can
// stiffen the prompt ("Return ONLY valid JSON, no prose"). Each attempt is
// a real API call — retries cost money, which is correct for cost tracking
// (logUsage runs inside `call`).
//
// Throws the last error if all attempts fail; endpoints catch and refund
// credits in that case.
async function withJsonRetry(label, call, { maxRetries = 1 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let raw
    try {
      raw = await call(attempt)
    } catch (e) {
      lastErr = e
      console.warn(`[${label}] model call attempt ${attempt + 1} failed: ${e.message}`)
      continue
    }
    try {
      const parsed = parseModelJson(raw, {
        sourceLabel: attempt > 0 ? `${label} (retry ${attempt})` : label,
      })
      if (attempt > 0) console.log(`[${label}] retry succeeded on attempt ${attempt + 1}`)
      return parsed
    } catch (e) {
      lastErr = e
      console.warn(`[${label}] parse attempt ${attempt + 1} failed: ${e.message}`)
    }
  }
  throw lastErr || new Error(`${label}: all attempts failed`)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Point pdfjs-dist at its bundled worker so it runs in-process
pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(
  __dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
)
const app = express()
const PORT = process.env.PORT || 3001

// CORS allow-list. In dev (no env var) we accept any origin so localhost
// preview ports work freely. In prod set CORS_ORIGINS to a comma-separated
// list (e.g. "https://app.ultemir.com,https://ultemir.com"). Anything else
// gets rejected by Express.
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean)

app.use(cors({
  origin: corsOrigins.length === 0
    ? true                                            // dev: reflect any origin
    : (origin, cb) => {
        if (!origin) return cb(null, true)            // server-to-server / curl
        if (corsOrigins.includes(origin)) return cb(null, true)
        cb(new Error(`CORS: ${origin} not allowed`))
      },
  credentials: true,
}))

// Trust the proxy in front (Railway / Fly / Vercel) so req.ip resolves
// correctly for rate-limit keys instead of always being the proxy's IP.
app.set('trust proxy', 1)

// Rate limit /api/* — generous default. Stripe webhook is exempt because
// Stripe can send bursts and is signature-verified anyway.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,                                // 1 minute
  limit: parseInt(process.env.RATE_LIMIT_PER_MIN) || 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path === '/api/billing/webhook',
  message: { error: 'Too many requests, slow down.' },
})
app.use('/api/', apiLimiter)

// ──────────────────────────────────────────────────────────────────────────
// Stripe webhook — MUST be registered BEFORE express.json() because the
// signature check requires the raw request body. Express runs middleware
// in declaration order, so registering this route here means the raw-body
// middleware fires for /api/billing/webhook and json fires for everything
// else. Webhook handler is defined further down in this file via
// `webhookHandler` so it has access to all the imports + helpers.
// ──────────────────────────────────────────────────────────────────────────
app.post(
  '/api/billing/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => webhookHandler(req, res),
)

app.use(express.json({ limit: '20mb' }))

// Serve generated images written to public/generated/
app.use('/api/generated', express.static(path.join(__dirname, 'public', 'generated'), {
  maxAge: '1d',
}))

// Serve the marketing landing page (Claude Design output) at /landing
// Temporary — will deploy to its own domain (ultemir.com) for production.
app.use('/landing', express.static(path.join(__dirname, '..', 'marketing')))
app.get('/landing', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'marketing', 'index.html'))
})

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Higgsfield API — auth key is "clientId:clientSecret"
const HIGGSFIELD_BASE = 'https://platform.higgsfield.ai'
const higgsfieldKey = `${process.env.HIGGSFIELD_CLIENT_ID}:${process.env.HIGGSFIELD_CLIENT_SECRET}`
const higgsfieldHeaders = {
  'Authorization': `Key ${higgsfieldKey}`,
  'Content-Type': 'application/json',
}

// Upload a buffer to Higgsfield's file storage, returns public URL
async function uploadToHighgsfield(buffer, mimeType = 'image/jpeg') {
  const urlRes = await fetch(`${HIGGSFIELD_BASE}/files/generate-upload-url`, {
    method: 'POST',
    headers: higgsfieldHeaders,
    body: JSON.stringify({ content_type: mimeType }),
  })
  if (!urlRes.ok) throw new Error(`Higgsfield upload URL failed: ${await urlRes.text()}`)
  const { public_url, upload_url } = await urlRes.json()
  const putRes = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: buffer,
  })
  if (!putRes.ok) throw new Error(`Higgsfield file PUT failed: ${putRes.status}`)
  return public_url
}

// Save base64 PNG buffer to disk and return a served URL
// Save a generated PNG. Uploads to the Supabase Storage `generated-ads`
// bucket (public) and returns the resulting public URL. Path convention:
//   generated-ads/<userId>/<projectId>/ad-<uuid>.png
//
// We previously wrote to server/public/generated/ on local disk, but
// Railway's filesystem is ephemeral — every redeploy wiped the PNGs and
// every saved imageUrl on prior ads turned into a 404. Supabase Storage
// is durable across redeploys.
//
// The userId/projectId scope keeps files attributable for cleanup later
// (e.g. when a project is deleted) and keeps file paths organized for
// debugging in the dashboard.
async function saveGeneratedPng(b64, { userId = null, projectId = null } = {}) {
  const buffer = Buffer.from(b64, 'base64')
  const filename = `ad-${crypto.randomUUID()}.png`
  // Path scope: <userId>/<projectId>/<filename>. Falls back to "_anon" when
  // either is missing (shouldn't happen — every credit-charged endpoint has
  // both — but defensive).
  const u = userId || '_anon'
  const p = projectId || '_unscoped'
  const objectPath = `${u}/${p}/${filename}`

  const { error } = await supabaseAdmin.storage
    .from('generated-ads')
    .upload(objectPath, buffer, {
      contentType: 'image/png',
      upsert: false,
    })
  if (error) {
    console.error('[saveGeneratedPng] storage upload failed:', error.message)
    throw new Error(`Image upload failed: ${error.message}`)
  }

  const { data: urlData } = supabaseAdmin.storage
    .from('generated-ads')
    .getPublicUrl(objectPath)
  return urlData.publicUrl
}

// Decode a "data:image/png;base64,..." URL into a {buffer, mime, name} record for use as reference image
function decodeDataUrl(dataUrl, name = 'ref.png') {
  if (!dataUrl) return null
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!m) return null
  return { buffer: Buffer.from(m[2], 'base64'), mime: m[1], name }
}

// Generate via OpenAI image model. Defaults to gpt-image-2.
// If reference images are provided, uses images.edit (multi-reference support);
// otherwise uses images.generate (text-only).
async function generateImageOpenAI(prompt, onStatus = null, sessionId = null, { size, quality, referenceImages = [], userId = null } = {}) {
  onStatus?.('in_progress')
  const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2'
  const finalQuality = quality || process.env.OPENAI_IMAGE_QUALITY || 'medium'
  const finalSize = size || '1024x1024'

  const startedAt = Date.now()
  let response
  if (referenceImages.length > 0) {
    // Use edit endpoint with the SDK's toFile() helper — required for Node compat.
    // `new File()` works in browsers but is unreliable in some Node versions.
    const files = await Promise.all(
      referenceImages.map(r => toFile(r.buffer, r.name, { type: r.mime || 'image/png' }))
    )
    console.log(`[image-gen] ${model} edit · ${referenceImages.length} ref(s):`,
      referenceImages.map(r => `${r.name} (${(r.buffer.length / 1024).toFixed(1)}kb, ${r.mime})`).join(', '),
      `· size=${finalSize} quality=${finalQuality}`)
    response = await openai.images.edit({
      model,
      image: files.length === 1 ? files[0] : files,
      prompt: prompt.slice(0, 4000),
      size: finalSize,
      quality: finalQuality,
      n: 1,
    })
  } else {
    console.log(`[image-gen] ${model} generate (no refs) · size=${finalSize} quality=${finalQuality}`)
    response = await openai.images.generate({
      model,
      prompt: prompt.slice(0, 4000),
      size: finalSize,
      quality: finalQuality,
      n: 1,
    })
  }
  const elapsedMs = Date.now() - startedAt
  console.log(`[image-gen] complete in ${(elapsedMs / 1000).toFixed(1)}s`)

  const b64 = response.data[0].b64_json
  if (!b64) throw new Error('OpenAI returned no image data')
  const url = await saveGeneratedPng(b64, { userId, projectId: sessionId })

  // Capture real token usage if the API returned it
  const usage = response.usage || {}
  const inputDetails = usage.input_tokens_details || {}
  logUsage({
    model,
    source: 'generate-ad-image',
    images: 1,
    textInputTokens: inputDetails.text_tokens || usage.input_tokens || 0,
    imageInputTokens: inputDetails.image_tokens || 0,
    imageOutputTokens: usage.output_tokens || 0,
    durationMs: elapsedMs,
    quality: finalQuality,
    size: finalSize,
    sessionId,
  })
  return url
}

// Generate via Google Gemini image model (Nano Banana family).
// Model identifier set via GEMINI_IMAGE_MODEL env var (e.g. "gemini-2.5-flash-image-preview" or whatever the current one is).
async function generateImageGemini(prompt, onStatus = null, sessionId = null, { userId = null } = {}) {
  onStatus?.('in_progress')
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image-preview'
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in server/.env')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const body = {
    contents: [{ parts: [{ text: prompt.slice(0, 4000) }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  }

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`Gemini ${r.status}: ${txt.slice(0, 400)}`)
  }
  const data = await r.json()
  // Find the inline image data in the response
  const parts = data?.candidates?.[0]?.content?.parts || []
  const imagePart = parts.find(p => p.inlineData?.data || p.inline_data?.data)
  const b64 = imagePart?.inlineData?.data || imagePart?.inline_data?.data
  if (!b64) {
    const textPart = parts.find(p => p.text)
    throw new Error(`Gemini returned no image. ${textPart ? 'Text reply: ' + textPart.text.slice(0, 200) : ''}`)
  }
  const out = await saveGeneratedPng(b64, { userId, projectId: sessionId })
  logUsage({ model: 'gemini-image', source: 'generate-ad-image', images: 1, sessionId })
  return out
}

async function generateImageHighgsfield(prompt, imageUrl = null, onStatus = null, sessionId = null) {
  const body = { prompt, aspect_ratio: '1:1', safety_tolerance: 2 }
  if (imageUrl) body.image_url = imageUrl

  // Submit job
  const submitRes = await fetch(`${HIGGSFIELD_BASE}/flux-pro/kontext/max/text-to-image`, {
    method: 'POST',
    headers: higgsfieldHeaders,
    body: JSON.stringify(body),
  })
  if (!submitRes.ok) {
    const err = await submitRes.text()
    throw new Error(`Higgsfield submit failed (${submitRes.status}): ${err}`)
  }
  const { request_id, status_url } = await submitRes.json()

  // Poll until done (max 6 minutes)
  const deadline = Date.now() + 360_000
  let lastStatus = null
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000))
    const pollRes = await fetch(status_url, { headers: higgsfieldHeaders })
    if (!pollRes.ok) continue
    const data = await pollRes.json()
    console.log('[Higgsfield poll]', JSON.stringify(data).slice(0, 300))
    if (data.status !== lastStatus) {
      lastStatus = data.status
      onStatus?.(data.status)
    }
    if (data.status === 'completed') {
      logUsage({ model: 'higgsfield-flux', source: 'generate-ad-image', images: 1, sessionId })
      return (
        data.images?.[0]?.url ||
        data.output?.images?.[0]?.url ||
        data.output?.[0]?.url ||
        data.output?.[0] ||
        data.result?.images?.[0]?.url ||
        data.sample
      )
    }
    if (data.status === 'failed' || data.status === 'nsfw') {
      throw new Error(`Higgsfield generation ${data.status}: ${data.error || ''}`)
    }
  }
  throw new Error('Higgsfield timed out after 6 minutes')
}

const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 20 * 1024 * 1024 },
})

// ── Usage tracking ────────────────────────────────────────────────────────────
// Public rates — UPDATE WHEN PROVIDERS CHANGE THEM. Single source of truth.
// Three pricing types:
//   'text'         — input/output text tokens
//   'image-tokens' — text input + image input + image output tokens (OpenAI image models)
//   'flat'         — fixed cost per image (Gemini, Higgsfield)
const PRICING = {
  // Text/chat models
  'claude-sonnet-4-6':    { type: 'text', input: 3.00 / 1e6, output: 15.00 / 1e6 },
  'claude-haiku-4-5':     { type: 'text', input: 1.00 / 1e6, output:  5.00 / 1e6 },
  'gpt-4o':               { type: 'text', input: 2.50 / 1e6, output: 10.00 / 1e6 },
  'gpt-4o-mini':          { type: 'text', input: 0.15 / 1e6, output:  0.60 / 1e6 },

  // OpenAI image models — token-based per OpenAI public pricing page.
  // Output token counts approx by quality at 1024×1024: low~272, medium~1056, high~4160.
  'gpt-image-2':          { type: 'image-tokens', textInput: 5.00 / 1e6, imageInput: 8.00  / 1e6, imageOutput: 30.00 / 1e6 },
  'gpt-image-1.5':        { type: 'image-tokens', textInput: 5.00 / 1e6, imageInput: 8.00  / 1e6, imageOutput: 32.00 / 1e6 },
  'gpt-image-1':          { type: 'image-tokens', textInput: 5.00 / 1e6, imageInput: 10.00 / 1e6, imageOutput: 40.00 / 1e6 },
  'gpt-image-1-mini':     { type: 'image-tokens', textInput: 2.00 / 1e6, imageInput: 2.50  / 1e6, imageOutput: 8.00  / 1e6 },
  'chatgpt-image-latest': { type: 'image-tokens', textInput: 5.00 / 1e6, imageInput: 8.00  / 1e6, imageOutput: 32.00 / 1e6 },

  // Flat-rate providers
  'gemini-image':         { type: 'flat', perImage: 0.039 }, // Nano Banana family — verify on Google AI Studio
  'higgsfield-flux':      { type: 'flat', perImage: 0.04 },
}

const USAGE_FILE = path.join(__dirname, 'usage.json')

function readUsage() {
  try {
    return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'))
  } catch {
    return { entries: [] }
  }
}

function writeUsage(u) {
  fs.writeFileSync(USAGE_FILE, JSON.stringify(u), 'utf8')
}

// Append a usage entry. Handles all three pricing types.
function logUsage({
  model, source, sessionId,
  inputTokens = 0, outputTokens = 0,                    // text models
  imageInputTokens = 0, imageOutputTokens = 0, textInputTokens = 0, // image-tokens models
  images = 0,                                           // flat-rate models
  durationMs = 0, quality = null, size = null,          // generation timing (image gen only)
}) {
  const p = PRICING[model]
  let cost = 0
  if (p) {
    if (p.type === 'flat') {
      cost = p.perImage * (images || 1)
    } else if (p.type === 'image-tokens') {
      cost =
        (textInputTokens || inputTokens || 0) * p.textInput +
        (imageInputTokens || 0) * p.imageInput +
        (imageOutputTokens || outputTokens || 0) * p.imageOutput
    } else {
      // 'text' — default
      cost = inputTokens * p.input + outputTokens * p.output
    }
  }
  const entry = {
    ts: Date.now(),
    model,
    source,
    inputTokens,
    outputTokens,
    imageInputTokens,
    imageOutputTokens,
    textInputTokens,
    images,
    cost,
    durationMs,
    quality,
    size,
    sessionId: sessionId || null,
  }
  const u = readUsage()
  u.entries.push(entry)
  if (u.entries.length > 5000) u.entries = u.entries.slice(-5000)
  writeUsage(u)
  return entry
}

// Session state is persisted in Supabase (projects.session_state JSONB).
// See lib/sessionStore.js for the implementation. getSession/saveSession are
// imported from there.

// ── Long-Form Native Ad Blueprint ─────────────────────────────────────────────
// User-supplied direct-response native ad structure. Used by formats marked
// `isNative: true` (the long-form story-driven formats). Every beat below MUST
// appear in the final copy; the model decides the rhythm/length/order based on
// the angle. This is a strategic blueprint, NOT a paragraph template — beats
// can be a sentence or several paragraphs, can interleave, can be implicit.
const NATIVE_AD_BLUEPRINT = `LONG-FORM NATIVE AD STRUCTURE — every beat below must be present in the primaryText.
Order is the ideal flow but you may interleave or sequence as the story demands.
Each beat is a strategic target, NOT a rigid paragraph slot — let it breathe naturally.

1. HOOK / HEADLINE — first sentence stops the scroll. Specific, visceral, can only be about THIS person.
2. LEAD x3 — three opening "leads" that deepen the hook. Each pulls the reader further in. Variations of the hook from different angles.
3. STORYLINE — the narrative anchor. A specific moment, person, or scene that frames the whole ad.
4. IDENTIFICATION — the reader recognizes themselves. "If this sounds like you…"
5. SYMPTOMS — concrete, specific symptoms of the problem. Sensory. Not "I felt bad" — "I unbuttoned my jeans under my desk by 2pm."
6. FEAR / WORST CASE SCENARIO — what happens if they don't address this. Make the cost real.
7. FAILED SOLUTIONS (sequencing) — what they've tried, in order, and why each one fell short. Validates their journey.
8. REAL LIFE CONSEQUENCES — concrete daily-life impact. Moments lost. Time wasted. Relationships strained.
9. FEELINGS: VINDICATION + LOSS AVERSION — "you were right that something was off" + "what you'll lose by not acting"
10. MECHANISM PROBLEM / ROOT CAUSE (Differentiate) — the Hidden Problem. The REAL cause that explains why obvious solutions fail. This is the differentiation.
11. MECHANISM SOLUTION (Differentiate) — the Real Solution. Why THIS approach works when others don't. Tied directly to the root cause.
12. ORGANIC PRODUCT INTRO — product appears naturally as the embodiment of the right mechanism. NOT a pitch — a recommendation.
13. DIFFERENTIATION — why this specific product, not the category. What's unique about how it's built.
14. SOCIAL PROOF — real numbers, specific testimonials, before/after results. Credibility.
15. RISK REVERSAL — guarantee, free returns, money-back, trial period. Lower the activation cost.
16. URGENCY — why now. Real reason if possible. Honest beats fake.
17. SCARCITY — limited availability or limited offer. Real if possible.
18. CTA — specific action. Match Meta CTA whitelist.
19. PS — postscript that reinforces the hook or names the most powerful benefit one more time.
20. PPS — second postscript that re-states risk reversal or urgency. Final scroll-stopper.

CRITICAL:
- This is NOT a paragraph template. You decide whether each beat is a sentence, a paragraph, or three paragraphs.
- Beats can interleave (e.g. symptoms can pop up inside the storyline).
- The reader should feel they're reading a story, not checking off a list.
- No labels, no headers, no "PS:" written literally unless the format calls for it (PS/PPS at the bottom IS literal — those are the only allowed labels).
- Capitalization: sentence case for body. Title Case is allowed sparingly for emphasis. NEVER ALL CAPS except for one or two words for visceral emphasis. Never SHOUT.`

// ── Ad Format Library ─────────────────────────────────────────────────────────
// IMPORTANT: formats describe INTENT and VISUAL REGISTER, not templates.
// The model designs the structure organically per angle. We tell it WHAT the
// format is going for emotionally and strategically — not how to lay it out.
const AD_FORMATS = [
  // TOFU
  {
    id: 'confession', name: 'The Confession', funnel: 'tofu', needsProduct: false, copyLength: 'long', isNative: true,
    description: '"I used to [painful thing]… I thought it was normal." First-person revelation.',
    intent: `Reads like a personal essay shared by a friend at 2am, not an ad. The reader should feel the writer was THEM six months ago — same pain, same resignation. Vulnerability earns trust; the brand only appears when the writer is ready to share what worked. Long-form native — follow the native ad blueprint.`,
    visualDirection: `Editorial, intimate, magazine-quality. A real-feeling person in a real moment. Should NOT look like an ad. No product visible.`,
  },
  {
    id: 'indictment', name: 'Industry Indictment', funnel: 'tofu', needsProduct: false, copyLength: 'long', isNative: true,
    description: '"[Industry] has been lying to you about [X]." Expose the broken system, position as the alternative.',
    intent: `The reader leaves the ad genuinely angry at the category — and pre-trusting your brand as the only one telling the truth. Tone is investigative journalism: evidence-led, sober, damning. Long-form native — follow the native ad blueprint with the storyline rooted in the indictment.`,
    visualDirection: `Documentary, investigative, slightly tense. Could lean typographic — a damning statistic as the visual anchor works well.`,
  },
  {
    id: 'pattern_interrupt', name: 'Pattern Interrupt', funnel: 'tofu', needsProduct: false, copyLength: 'short',
    description: 'Shocking stat or counterintuitive fact that stops the scroll immediately.',
    intent: `The headline is the entire weapon — a single fact so counterintuitive the reader cannot scroll past. Body copy is brief: enough to validate the claim and connect it to the product. Brevity is the format; if you write more than 150 words, you've broken it.`,
    visualDirection: `Bold, minimalist, typographic. The number or stat is the hero. Zero clutter.`,
  },
  {
    id: 'real_talk', name: 'Real Talk', funnel: 'tofu', needsProduct: false, copyLength: 'medium',
    description: 'Speaks the avatar\'s exact unspoken inner monologue — the thing they think but never say.',
    intent: `Speak the avatar's internal monologue back to them so precisely they feel exposed. The reader's reaction should be: "How did they know I think that?" Validation comes first, before any pitch — the brand earns the right to suggest a path forward only after demonstrating it understands. Direct, warm, second-person.`,
    visualDirection: `Direct, intimate, unfiltered. A real person whose face says they understand. Natural light, no staging. No product.`,
  },
  {
    id: 'open_loop', name: 'Open Loop', funnel: 'tofu', needsProduct: false, copyLength: 'short',
    description: 'Curiosity gap in the headline — the copy resolves it, the landing page closes the sale.',
    intent: `Pure curiosity gap. The headline opens a loop the reader cannot leave unresolved. Body deepens the loop without closing it; the click is the only resolution. Discipline: do NOT spoil the answer in the body, or the click never happens.`,
    visualDirection: `Aspirational with an element of mystery. Soft focus, partially revealed. Creates a visual question.`,
  },
  {
    id: 'ugc_raw', name: 'UGC Raw', funnel: 'tofu', needsProduct: false, copyLength: 'medium',
    description: 'Looks and sounds like an organic social post from a real customer. Zero ad energy.',
    intent: `Indistinguishable from a friend's organic Instagram caption. Conversational, slightly imperfect, with the small stumbles real humans make. If it sounds polished or rehearsed, the format is broken. The brand mention should land like a recommendation, not an endorsement deal.`,
    visualDirection: `Phone-camera authentic. Slightly off composition, natural light, candid. Anti-ad aesthetic — looks like a real post.`,
  },
  {
    id: 'lifestyle_native', name: 'Lifestyle Native', funnel: 'tofu', needsProduct: false, copyLength: 'minimal',
    description: 'Aspirational image does the heavy lifting. Minimal copy, maximum scroll-stop.',
    intent: `The image carries the entire ad. Copy is identity-driven and minimal — a single line of desire, the life the avatar wants. No mechanism, no proof, no education. Pure aspiration. If the copy is doing more than 30% of the work, it's overwriting.`,
    visualDirection: `Editorial, aspirational, magazine-cover quality. The image IS the ad. Beautiful light, perfect composition, the life they want.`,
  },
  // MOFU
  {
    id: 'mechanism', name: 'The Mechanism', funnel: 'mofu', needsProduct: false, copyLength: 'medium',
    description: '"Here\'s WHY [common solutions] don\'t work." Educates on the real problem, positions product as the only logical solution.',
    intent: `Make the reader feel smarter for reading it. Show them WHY the obvious solutions everyone tries fail at the level of mechanism — the underlying biology / chemistry / behavior they didn't know about. Then position the product as the only thing actually built around the right mechanism. Educational tone, not pitchy. Earns the click by teaching.`,
    visualDirection: `Clear and informative. Could lean explainer-aesthetic. Modern, trustworthy. Product can appear in context.`,
  },
  {
    id: 'testimonial', name: 'Testimonial Feature', funnel: 'mofu', needsProduct: false, copyLength: 'short',
    description: 'Single powerful customer quote as the anchor. Social proof does the selling.',
    intent: `One real customer's quote does all the work. Brand voice fades into the background. The reader should imagine themselves saying the same thing six months from now. Quote must be specific (numbers, sensory details, real life moments) — never vague praise like "I love it."`,
    visualDirection: `Warm, credible lifestyle. A person who could plausibly be the customer. High trust, not overly polished.`,
  },
  {
    id: 'social_proof', name: 'Social Proof Snowball', funnel: 'mofu', needsProduct: false, copyLength: 'medium',
    description: 'Open with volume of proof, build momentum through shared experience, close with the product.',
    intent: `Volume creates inevitability. Open with the number, then surface a few short voices that show the spectrum of who's saying it, then name the underlying desire they all share. Product appears as what made it possible — humble, not boastful. The reader feels they're joining a movement, not buying a product.`,
    visualDirection: `Community-feeling. Multiple real people OR one aspirational person who represents the group. Inclusive, warm.`,
  },
  {
    id: 'comparison', name: 'Old Way vs. New Way', funnel: 'mofu', needsProduct: false, copyLength: 'short',
    description: 'Sharp contrast between the painful old approach and the relief of the new one.',
    intent: `Sharp dichotomy. The reader instinctively maps themselves onto the painful old way and feels the relief of crossing over. The contrast IS the persuasion — make both sides specific and sensory, not generic. The product is the bridge in one sentence.`,
    visualDirection: `Split or strong-contrast composition. Old side muted, new side luminous. Emotional difference visible at a glance.`,
  },
  {
    id: 'objection', name: 'Objection Killer', funnel: 'mofu', needsProduct: true, copyLength: 'medium',
    description: '"But does it work if I\'m [specific situation]?" Directly addresses the #1 reason they haven\'t bought.',
    intent: `Address the single biggest reason this avatar hasn't bought yet. Acknowledge the doubt by name, in their words. Resolve with HOW it works for their specific case — never just "yes it does." Risk reversal (guarantee, free returns, trial) closes. The reader leaves with their objection neutralized.`,
    visualDirection: `Product in real-use scenario that visibly proves the objection wrong. Authentic, believable.`,
  },
  {
    id: 'result_stack', name: 'Result Stack', funnel: 'mofu', needsProduct: true, copyLength: 'medium',
    description: 'Stack multiple specific outcomes to build overwhelming value and desire.',
    intent: `Rapid-fire stack of specific outcomes. Each one is a small proof. By the end the reader is overwhelmed by what's actually possible. Specificity beats hyperbole — "fits into jeans by 2pm" beats "feel amazing." Don't use the same shape every time; the order and grouping should match the avatar's hierarchy of pain.`,
    visualDirection: `Premium product photography. Could carry visual callouts for the most resonant outcomes.`,
  },
  {
    id: 'before_after', name: 'Before / After', funnel: 'mofu', needsProduct: false, copyLength: 'medium',
    description: 'Vivid contrast between the before state and the after state, product as the bridge.',
    intent: `Two vivid moments — the painful before and the radiant after — written with the same level of sensory detail on both sides. The reader sees themselves in the before. The product is the bridge in one sentence. Don't moralize, don't oversell the after — let the contrast persuade.`,
    visualDirection: `Split or transformation visual. Same person, same framing, lighting/energy shift conveys the change.`,
  },
  {
    id: 'founder_story', name: 'Founder Story', funnel: 'mofu', needsProduct: false, copyLength: 'long', isNative: true,
    description: '"Why I built this." Personal origin story that creates trust and emotional investment in the brand.',
    intent: `The founder is the avatar — same pain, same failed attempts, built this because nothing existed. Personal, vulnerable, never corporate. Long-form native — follow the native ad blueprint with the founder as the storyteller.`,
    visualDirection: `Documentary, real-people-real-care. Founder or team in a real setting, not a corporate set.`,
  },
  // BOFU
  {
    id: 'deal_stack', name: 'Deal Stack', funnel: 'bofu', needsProduct: true, copyLength: 'short',
    description: 'The offer IS the headline. Value stack + urgency + clear CTA. No fluff.',
    intent: `The offer is the entire ad. Lead with price or discount. Stack value (product + bonuses + guarantees). Pure conversion — no lifestyle softening, no storytelling. The reader should be able to do the math instantly: this saves me $X and includes Y. Ends with urgency.`,
    visualDirection: `Clean, bright product photography. Premium styling. Offer text integrated as a graphic element.`,
  },
  {
    id: 'limited_time', name: 'Limited Time', funnel: 'bofu', needsProduct: true, copyLength: 'minimal',
    description: 'Pure urgency. Short, direct, specific deadline drives the conversion.',
    intent: `Maximum urgency, minimum words. The reader should feel they will literally lose this if they don't click now. Real deadline beats fake scarcity — if the reason it ends is honest (launch sale ends, restock pricing returns), say so. Without honesty, urgency reads as manipulation.`,
    visualDirection: `Bold, high-energy product visual. Urgency conveyed through design tension. Sale badge / countdown element OK.`,
  },
  {
    id: 'review_product', name: 'Review + Product', funnel: 'bofu', needsProduct: true, copyLength: 'short',
    description: '5-star review quote + product visual. Social proof at the moment of purchase decision.',
    intent: `Star rating + powerful customer quote + product visual = social proof at the exact moment of decision. The quote must carry specific results (numbers, situations, sensory details), not vague praise. Then a tight product description for first-time viewers, total review volume for trust, and the CTA.`,
    visualDirection: `Premium product photography. Stars or rating count integrated as design element. Trustworthy and conversion-optimized.`,
  },
  {
    id: 'bundle_bogo', name: 'Bundle / BOGO', funnel: 'bofu', needsProduct: true, copyLength: 'short',
    description: 'Bundle or buy-one-get-one offer with clear value stack. Products multiple must be visible.',
    intent: `Bundle or BOGO with crystal-clear value math. The reader should mentally calculate the savings and feel they'd be losing money to NOT bundle. Name what's included, anchor against the standalone total, surface who specifically should bundle, close with urgency if real.`,
    visualDirection: `Multiple products arranged beautifully together. Flat-lay or styled lifestyle. Communicates completeness.`,
  },
  {
    id: 'specificity_callout', name: 'Specificity Callout', funnel: 'bofu', needsProduct: false, copyLength: 'medium',
    description: 'Hyper-specific avatar callout. "If you\'re [exact person], this is finally for you."',
    intent: `Hyper-specific avatar match. Name details so granular that the right person feels electric and the wrong person self-selects out. The reader's reaction should be "FINALLY this is for me." Show the failed previous attempts (proves understanding), then explain why this is different specifically for them.`,
    visualDirection: `Person who is unmistakably the target avatar — exact age, situation, style. The right person feels seen instantly.`,
  },
]

// ── Color extraction from image buffer ────────────────────────────────────────
async function extractDominantColors(buffer, count = 6) {
  const { data, info } = await sharp(buffer)
    .resize(120, 120, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pixels = []
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    // Skip near-white and near-black
    const brightness = (r + g + b) / 3
    if (brightness > 240 || brightness < 15) continue
    pixels.push([r, g, b])
  }

  if (!pixels.length) return []

  // Simple k-means clustering for dominant colors
  let centroids = pixels.filter((_, i) => i % Math.floor(pixels.length / count) === 0).slice(0, count)
  for (let iter = 0; iter < 8; iter++) {
    const clusters = centroids.map(() => ({ sum: [0, 0, 0], count: 0 }))
    for (const [r, g, b] of pixels) {
      let best = 0, bestDist = Infinity
      centroids.forEach(([cr, cg, cb], ci) => {
        const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
        if (d < bestDist) { bestDist = d; best = ci }
      })
      clusters[best].sum[0] += r; clusters[best].sum[1] += g; clusters[best].sum[2] += b
      clusters[best].count++
    }
    centroids = clusters.map(({ sum, count }) =>
      count > 0 ? sum.map(v => Math.round(v / count)) : [128, 128, 128]
    )
  }

  return centroids.map(([r, g, b]) => {
    const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    const name = luminance > 0.7 ? 'light' : luminance < 0.3 ? 'dark' : 'mid'
    return { hex, r, g, b, name }
  }).filter((c, i, arr) => {
    // Deduplicate similar colors
    return !arr.slice(0, i).some(prev =>
      Math.abs(prev.r - c.r) < 30 && Math.abs(prev.g - c.g) < 30 && Math.abs(prev.b - c.b) < 30
    )
  })
}

// ── Scrape website for colors AND content (multi-page crawl with Shopify detection) ──
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
}

function browserFetch(url, timeout = 15000) {
  return fetch(url, { headers: BROWSER_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(timeout) })
}

// If the site is a Shopify store, /products.json gives the entire catalog with prices
async function tryShopifyCatalog(baseUrl) {
  try {
    const u = new URL('/products.json?limit=50', baseUrl).href
    const r = await browserFetch(u, 12000)
    if (!r.ok) return null
    const ct = r.headers.get('content-type') || ''
    if (!ct.includes('json')) return null
    const data = await r.json()
    if (!data || !Array.isArray(data.products) || !data.products.length) return null
    return data.products.map(p => {
      const variants = (p.variants || []).map(v => ({
        title: v.title,
        price: v.price,
        compareAtPrice: v.compare_at_price,
        available: v.available,
        sku: v.sku,
      }))
      // Strip HTML from body for compactness
      const bodyText = (p.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800)
      return {
        title: p.title,
        vendor: p.vendor,
        productType: p.product_type,
        handle: p.handle,
        url: new URL(`/products/${p.handle}`, baseUrl).href,
        tags: p.tags,
        description: bodyText,
        variants,
        priceRange: variants.length ? {
          min: Math.min(...variants.map(v => parseFloat(v.price) || Infinity)),
          max: Math.max(...variants.map(v => parseFloat(v.price) || 0)),
        } : null,
        onSale: variants.some(v => v.compareAtPrice && parseFloat(v.compareAtPrice) > parseFloat(v.price)),
        firstImage: p.images?.[0]?.src || null,
      }
    })
  } catch {
    return null
  }
}

// Score an internal link by relevance for brand context
function scoreLink(url) {
  const p = url.toLowerCase()
  let score = 0
  if (/\/products?\//.test(p)) score += 12
  if (/\/collections?\//.test(p)) score += 8
  if (/\/about/.test(p)) score += 10
  if (/\/our[-_]?story|\/story/.test(p)) score += 9
  if (/\/faq|\/help/.test(p)) score += 7
  if (/\/how[-_]?it[-_]?works/.test(p)) score += 9
  if (/\/ingredients|\/science|\/technology/.test(p)) score += 8
  if (/\/reviews?|\/testimonials/.test(p)) score += 6
  if (/\/shop\b|\/all[-_]?products/.test(p)) score += 5
  if (/\/contact/.test(p)) score += 2
  if (/\/blog|\/journal|\/news/.test(p)) score -= 3
  if (/\/tag|\/author|\/category/.test(p)) score -= 5
  return score
}

function extractInternalLinks($, baseUrl) {
  let origin
  try { origin = new URL(baseUrl).origin } catch { return [] }
  const links = new Set()
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return
    try {
      const u = new URL(href, baseUrl)
      if (u.origin !== origin) return
      const path = u.pathname.toLowerCase()
      if (/(cart|checkout|login|register|account|policy|terms|privacy|shipping-policy|refund|legal|sitemap|search|cdn|admin)/.test(path)) return
      if (/\.(pdf|jpg|jpeg|png|gif|svg|webp|css|js|xml|ico|woff2?)(?:$|\?)/.test(path)) return
      // Strip fragment + tracking
      u.hash = ''
      links.add(u.href)
    } catch (_) {}
  })
  return [...links]
}

// Scrape a single page. Returns parsed content + the cheerio instance for color reuse.
async function scrapeOnePage(url) {
  const r = await browserFetch(url, 15000)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const html = await r.text()
  const $ = cheerio.load(html)
  const title = $('title').first().text().trim()
  const metaDesc = $('meta[name="description"]').attr('content')
    || $('meta[property="og:description"]').attr('content') || ''

  // Color/CSS extraction needs the raw doc — capture inline styles BEFORE stripping
  const inlineCss = $('style').map((_, el) => $(el).text()).get().join(' ')
    + ' ' + $('[style]').map((_, el) => $(el).attr('style')).get().join(' ')
  const linkedCss = []
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href')
    if (href) try { linkedCss.push(new URL(href, url).href) } catch {}
  })

  $('script, style, noscript, svg, iframe, link, head').remove()
  const headings = $('h1, h2, h3').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 25)
  const buttons = $('button, a.btn, [class*="cta"], [class*="button"]').map((_, el) => $(el).text().trim()).get()
    .filter(t => t && t.length < 60).slice(0, 15)
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
  const prices = [...new Set(bodyText.match(/\$\s?\d{1,5}(?:\.\d{2})?/g) || [])]
  const offerSignals = [...new Set(bodyText.match(/\b(\d{1,2}%\s*off|save\s+\$?\d+|free\s+shipping|buy\s+\d+\s*get\s+\d+|bogo|limited\s+time|today\s+only|while\s+supplies\s+last|launch\s+sale|bundle|kit|subscribe\s+(?:and|&)\s+save|risk[- ]?free|money[- ]?back|guarantee)\b[^.]{0,80}/gi) || [])]

  return {
    url,
    title,
    metaDescription: metaDesc,
    headings,
    buttonsAndCtas: [...new Set(buttons)],
    prices,
    offerSignals,
    bodyExcerpt: bodyText.slice(0, 4000),
    _inlineCss: inlineCss,
    _linkedCss: linkedCss,
    _$: $,
  }
}

async function fetchExternalCss(urls) {
  if (!urls.length) return ''
  const slice = urls.slice(0, 3)
  const results = await Promise.allSettled(slice.map(async u => {
    try {
      const r = await browserFetch(u, 8000)
      if (r.ok) return await r.text()
    } catch {}
    return ''
  }))
  return results.map(r => r.status === 'fulfilled' ? r.value : '').join(' ')
}

function extractColorsFromCss(cssText) {
  const colorSet = new Set()
  const hexRe = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g
  const rgbRe = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g
  let m
  while ((m = hexRe.exec(cssText)) !== null) {
    let h = m[1]
    if (h.length === 3) h = h.split('').map(c => c + c).join('')
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
    const brightness = (r + g + b) / 3
    if (brightness > 240 || brightness < 15) continue
    colorSet.add('#' + h.toLowerCase())
  }
  while ((m = rgbRe.exec(cssText)) !== null) {
    const [r, g, b] = [+m[1], +m[2], +m[3]]
    const brightness = (r + g + b) / 3
    if (brightness > 240 || brightness < 15) continue
    colorSet.add('#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''))
  }
  return [...colorSet].slice(0, 12).map(hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return { hex, r, g, b, name: luminance > 0.7 ? 'light' : luminance < 0.3 ? 'dark' : 'mid' }
  })
}

// Multi-page scraper. Calls onProgress(stage, message) so callers can stream status.
async function scrapeWebsite(url, onProgress = () => {}) {
  onProgress('homepage', `Fetching ${new URL(url).hostname}…`)
  const home = await scrapeOnePage(url)

  onProgress('platform', 'Detecting platform…')
  const shopifyProducts = await tryShopifyCatalog(url)
  const platform = shopifyProducts ? 'shopify' : 'unknown'
  if (shopifyProducts) {
    onProgress('platform', `Shopify catalog found: ${shopifyProducts.length} products`)
  } else {
    onProgress('platform', `Platform: generic site`)
  }

  onProgress('discover', 'Discovering internal pages…')
  const links = extractInternalLinks(home._$, url)
    .map(l => ({ url: l, score: scoreLink(l) }))
    .filter(l => l.score > 0)
    .sort((a, b) => b.score - a.score)
  const homePath = (() => { try { return new URL(url).pathname } catch { return '/' } })()
  const toScrape = links.filter(l => {
    try { return new URL(l.url).pathname !== homePath } catch { return false }
  }).slice(0, 5)
  onProgress('discover', `Found ${links.length} relevant pages, will scrape top ${toScrape.length}`)

  const pages = []
  for (let i = 0; i < toScrape.length; i++) {
    const pageUrl = toScrape[i].url
    let pathLabel = pageUrl
    try { pathLabel = new URL(pageUrl).pathname } catch {}
    onProgress('pages', `Scraping ${i + 1}/${toScrape.length}: ${pathLabel}`)
    try {
      const p = await scrapeOnePage(pageUrl)
      pages.push(p)
    } catch (e) {
      onProgress('pages', `  ↳ skipped (${e.message})`)
    }
  }

  onProgress('colors', 'Extracting brand colors from CSS…')
  const externalCss = await fetchExternalCss(home._linkedCss)
  const colors = extractColorsFromCss(home._inlineCss + ' ' + externalCss)

  // Strip the cheerio refs and CSS from public output
  const stripPriv = ({ _$, _inlineCss, _linkedCss, ...rest }) => rest
  const cleanHome = stripPriv(home)
  const cleanPages = pages.map(stripPriv)

  // Aggregate prices/offers across all pages and the catalog
  const catalogPrices = (shopifyProducts || []).flatMap(p => p.variants.map(v => `$${v.price}`))
  const allPrices = [...new Set([...cleanHome.prices, ...cleanPages.flatMap(p => p.prices), ...catalogPrices])]
  const allOffers = [...new Set([...cleanHome.offerSignals, ...cleanPages.flatMap(p => p.offerSignals)])]

  onProgress('done', `Scraped ${1 + cleanPages.length} pages, ${shopifyProducts?.length || 0} catalog products, ${colors.length} colors`)

  const content = {
    sourceUrl: url,
    platform,
    homepage: cleanHome,
    pages: cleanPages,
    products: shopifyProducts || null,
    allPrices,
    allOffers,
  }

  return { colors, content }
}

async function extractText(file) {
  const buf = fs.readFileSync(file.path)
  if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
    const uint8 = new Uint8Array(buf)
    const doc = await pdfjsLib.getDocument({
      data: uint8,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
    }).promise
    let text = ''
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      text += content.items.map(item => item.str).join(' ') + '\n'
    }
    return text
  }
  return buf.toString('utf8')
}

// Upload documents
app.post('/api/documents', requireAuth, upload.array('files'), async (req, res) => {
  const sessionId = req.body.sessionId
  if (!await requireSessionOwnership(req, res, sessionId)) return
  const session = await getSession(sessionId)

  try {
    for (const file of req.files) {
      const text = await extractText(file)
      session.documents.push({ name: file.originalname, text: text.trim() })
      fs.unlinkSync(file.path)
    }
    await saveSession(sessionId, session)
    res.json({ sessionId, documents: session.documents.map(d => d.name) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Remove a document
app.delete('/api/documents/:sessionId/:name', requireAuth, async (req, res) => {
  const sessionId = req.params.sessionId
  if (!await requireSessionOwnership(req, res, sessionId)) return
  const session = await getSession(sessionId)
  session.documents = session.documents.filter(d => d.name !== req.params.name)
  await saveSession(sessionId, session)
  res.json({ documents: session.documents.map(d => d.name) })
})

// ── Brand asset endpoints ─────────────────────────────────────────────────────

// Allowed mime types for brand images. OpenAI's gpt-image-2 / images.edit
// only accepts these three; AVIF/HEIC/GIF break the downstream image-gen call
// hours later. Reject at upload time with a clear message instead.
const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])
const ALLOWED_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

function imageFileLooksValid(file) {
  const mime = (file.mimetype || '').toLowerCase()
  if (ALLOWED_IMAGE_MIMES.has(mime)) return true
  // Some browsers / file managers misreport mime — fall back to extension.
  const lowerName = (file.originalname || '').toLowerCase()
  const dotIdx = lowerName.lastIndexOf('.')
  if (dotIdx > 0 && ALLOWED_IMAGE_EXTS.has(lowerName.slice(dotIdx))) return true
  return false
}

// Upload brand images (logo, product photos, lifestyle)
app.post('/api/brand-assets', requireAuth, upload.array('files'), async (req, res) => {
  try {
    const sessionId = req.body.sessionId
    if (!await requireSessionOwnership(req, res, sessionId)) return
    const session = await getSession(sessionId)

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files received' })
    }

    // Validate every file BEFORE any processing — clean up the multer temp
    // files for rejected uploads and bail with one clear error.
    for (const file of req.files) {
      if (!imageFileLooksValid(file)) {
        for (const f of req.files) {
          try { fs.unlinkSync(f.path) } catch (_) {}
        }
        const got = file.mimetype || (file.originalname || '').split('.').pop() || 'unknown'
        return res.status(400).json({
          error: `Unsupported image format on "${file.originalname}" (${got}). Use PNG, JPG, or WebP.`,
          code: 'UNSUPPORTED_IMAGE_FORMAT',
          rejectedFile: file.originalname,
        })
      }
    }

    // Optional explicit type for the uploaded files. When the client knows
    // what each file is (e.g. the onboarding wizard with separate "Logo"
    // and "Product photo" drop zones), it should send `forceType=logo` or
    // `forceType=product` so the server doesn't have to guess via
    // guessAssetType() — the heuristic is fragile and routinely mislabels.
    const forceType = ['logo', 'product', 'lifestyle'].includes(req.body.forceType)
      ? req.body.forceType
      : null

    const added = []
    for (const file of req.files) {
      const buf = fs.readFileSync(file.path)
      const mime = file.mimetype || 'image/jpeg'

      let colors = []
      try { colors = await extractDominantColors(buf) } catch (_) {}

      // Upload to Higgsfield so we have a public URL for image-to-image generation
      let higgsfieldUrl = null
      try { higgsfieldUrl = await uploadToHighgsfield(buf, mime) } catch (e) {
        console.warn('Higgsfield upload skipped:', e.message)
      }

      const b64 = buf.toString('base64')
      const dataUrl = `data:${mime};base64,${b64}`

      const asset = {
        name: file.originalname,
        dataUrl,
        higgsfieldUrl,
        colors,
        type: forceType || await guessAssetType(file.originalname, buf),
      }
      session.brandImages.push(asset)
      for (const c of colors) {
        if (!session.brandColors.some(bc =>
          Math.abs(bc.r - c.r) < 30 && Math.abs(bc.g - c.g) < 30 && Math.abs(bc.b - c.b) < 30
        )) session.brandColors.push(c)
      }
      added.push({ name: file.originalname, colors, type: asset.type, dataUrl, higgsfieldUrl })
      try { fs.unlinkSync(file.path) } catch (_) {}
    }
    await saveSession(sessionId, session)
    res.json({
      sessionId,
      added,
      brandColors: session.brandColors,
      brandImages: session.brandImages.map(a => ({ name: a.name, type: a.type, colors: a.colors, dataUrl: a.dataUrl, higgsfieldUrl: a.higgsfieldUrl || null }))
    })
  } catch (e) {
    console.error('brand-assets error:', e)
    res.status(500).json({ error: e.message || 'Failed to process image' })
  }
})

async function guessAssetType(name, buffer) {
  const n = name.toLowerCase()
  // Filename keywords are most reliable when present
  if (n.includes('logo') || n.includes('icon') || n.includes('brand')) return 'logo'
  if (n.includes('lifestyle') || n.includes('model') || n.includes('campaign')) return 'product'
  if (n.includes('product') || n.includes('item') || n.includes('shot')) return 'product'
  // Use image metadata for files with generic names
  try {
    const meta = await sharp(buffer).metadata()
    if (meta.hasAlpha) return 'logo'        // transparent bg = almost always logo
    if (meta.format === 'svg') return 'logo'
    if (meta.width && meta.height) {
      const ratio = meta.width / meta.height
      const maxDim = Math.max(meta.width, meta.height)
      // Small square image = logo; tall/wide photo = product/lifestyle
      if (ratio > 0.7 && ratio < 1.4 && maxDim <= 800) return 'logo'
    }
  } catch (_) {}
  return 'product'
}

// Remove a brand image
app.delete('/api/brand-assets/:sessionId/:name', requireAuth, async (req, res) => {
  const sessionId = req.params.sessionId
  if (!await requireSessionOwnership(req, res, sessionId)) return
  const session = await getSession(sessionId)
  session.brandImages = session.brandImages.filter(a => a.name !== req.params.name)
  // Recompute palette from remaining images
  session.brandColors = []
  for (const asset of session.brandImages) {
    for (const c of asset.colors) {
      if (!session.brandColors.some(bc =>
        Math.abs(bc.r - c.r) < 30 && Math.abs(bc.g - c.g) < 30 && Math.abs(bc.b - c.b) < 30
      )) session.brandColors.push(c)
    }
  }
  await saveSession(sessionId, session)
  res.json({ brandColors: session.brandColors, brandImages: session.brandImages.map(a => ({ name: a.name, type: a.type, colors: a.colors, dataUrl: a.dataUrl, higgsfieldUrl: a.higgsfieldUrl || null })) })
})

// Update the type of a brand image (logo / product / lifestyle)
app.patch('/api/brand-assets/:sessionId/:name/type', requireAuth, async (req, res) => {
  const sessionId = req.params.sessionId
  if (!await requireSessionOwnership(req, res, sessionId)) return
  const { type } = req.body
  if (!['logo', 'product', 'lifestyle'].includes(type)) {
    return res.status(400).json({ error: 'type must be logo, product, or lifestyle' })
  }
  const session = await getSession(sessionId)
  const asset = session.brandImages.find(a => a.name === req.params.name)
  if (!asset) return res.status(404).json({ error: 'Asset not found' })
  asset.type = type
  await saveSession(sessionId, session)
  res.json({ ok: true, type })
})

// Set brand name
app.post('/api/brand-name', requireAuth, async (req, res) => {
  const { sessionId, brandName } = req.body
  if (!await requireSessionOwnership(req, res, sessionId)) return
  const session = await getSession(sessionId)
  session.brandName = (brandName || '').trim()
  await saveSession(sessionId, session)
  res.json({ ok: true, brandName: session.brandName })
})

// Scrape website (multi-page) — streams progress via SSE
app.post('/api/scrape-colors', requireAuth, async (req, res) => {
  const { sessionId, url } = req.body
  if (!url) return res.status(400).json({ error: 'url required' })
  if (!await requireSessionOwnership(req, res, sessionId)) return
  const session = await getSession(sessionId)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)

  try {
    const { colors, content } = await scrapeWebsite(url, (stage, message) => {
      send({ type: 'progress', stage, message })
    })
    for (const c of colors) {
      if (!session.brandColors.some(bc =>
        Math.abs(bc.r - c.r) < 30 && Math.abs(bc.g - c.g) < 30 && Math.abs(bc.b - c.b) < 30
      )) session.brandColors.push(c)
    }
    session.websiteContent = content
    await saveSession(sessionId, session)
    send({
      type: 'done',
      scraped: colors,
      brandColors: session.brandColors,
      content: {
        platform: content.platform,
        pagesScraped: 1 + (content.pages?.length || 0),
        productCount: content.products?.length || 0,
        priceCount: content.allPrices?.length || 0,
        offerCount: content.allOffers?.length || 0,
      },
    })
  } catch (e) {
    send({ type: 'error', error: e.message })
  }
  res.end()
})

// Get brand assets for session
app.get('/api/brand-assets/:sessionId', requireAuth, async (req, res) => {
  if (!await requireSessionOwnership(req, res, req.params.sessionId)) return
  const session = await getSession(req.params.sessionId)
  res.json({
    brandColors: session.brandColors,
    brandImages: session.brandImages.map(a => ({ name: a.name, type: a.type, colors: a.colors, dataUrl: a.dataUrl, higgsfieldUrl: a.higgsfieldUrl || null }))
  })
})

function buildDocumentContext(documents) {
  return documents
    .map(d => `=== ${d.name} ===\n${d.text.slice(0, 4000)}`)
    .join('\n\n')
}

// Generate ad concepts
app.post('/api/generate-concepts', requireAuth, async (req, res) => {
  if (!await requireSessionOwnership(req, res, req.body.sessionId)) return
  const { sessionId, count = 5 } = req.body
  const session = await getSession(sessionId)

  if (!session.documents.length) {
    return res.status(400).json({ error: 'No documents uploaded yet.' })
  }

  const context = buildDocumentContext(session.documents)

  const brandNameContext = session.brandName
    ? `\nBRAND NAME: "${session.brandName}" — use this name in headlines and CTAs where appropriate.\n`
    : ''

  const brandColorContext = session.brandColors.length
    ? `\nBRAND COLOR PALETTE (use these EXACT hex codes in every image prompt — background, text overlays, accents must match):\n${session.brandColors.map(c => `  ${c.hex} (${c.name} tone)`).join('\n')}\n`
    : ''

  const brandImageContext = session.brandImages.length
    ? `\nBRAND ASSETS AVAILABLE FOR IMAGE GENERATION:\n${session.brandImages.map(a => `  - ${a.name} (${a.type})`).join('\n')}\nA product image IS attached as a visual reference — your image prompts should describe the actual product visible in the composition, plus the brand colors above.\n`
    : ''

  const systemPrompt = `You are a world-class direct-response advertising creative director with 20+ years running 8-figure DTC campaigns. You combine deep consumer psychology with elite visual design instincts.

COPYWRITING FRAMEWORKS YOU USE:
- PAS: Problem → Agitate → Solution (expose the pain, twist the knife, deliver the relief)
- AIDA: Attention → Interest → Desire → Action
- Before/After/Bridge: where they are now → where they want to be → this product is the bridge
- Social proof snowball: open with numbers, close with transformation
- Pattern interrupt: lead with the thing they've never heard said out loud

WHAT MAKES A HIGH-CONVERTING HEADLINE:
- Calls out the avatar by name or pain (not "women" — "women over 45 who…")
- Makes a specific, believable claim (not "amazing" — "wire-free but actually supportive")
- Uses contrast, specificity, and emotional charge
- Under 10 words. Every word earns its place.

VISUAL AD DESIGN PRINCIPLES YOU APPLY:
Typography hierarchy:
  - Hero headline: Bold, 60-80pt equivalent, sans-serif or condensed serif, high contrast
  - Subhead: 24-32pt, lighter weight, max 1 line
  - Body/callouts: 14-16pt, clean sans-serif, ample line height
  - Never more than 2 font families. Serif for premium/luxury. Sans for modern/clean.

Layout zones for high-converting ads:
  - TOP ZONE: Brand name + positioning tagline (small, upper left or centered)
  - HERO ZONE: Large headline + product or emotion-forward visual (center/left)
  - PROOF ZONE: Icons + feature callouts OR testimonial quote + star rating
  - ANCHOR ZONE: Color swatches / CTA / trust badge / "Designed for real women"

Icon/callout design:
  - Circular icon badges with thin outline, 40-50px, paired with BOLD ALL-CAPS label + 1-line description
  - 3-4 icons max, arranged vertically left side or horizontally across bottom
  - Icons should be simple line art: leaf=natural, arrows=stretch, droplet=moisture, shield=protection

Color + mood:
  - Warm neutrals (blush, cream, taupe, dusty rose) = feminine, approachable, premium
  - High contrast dark overlay on light product = makes text pop without being harsh
  - Gradient backgrounds (light top, slightly deeper bottom) add depth without distraction
  - Avoid pure white or pure black backgrounds — they read clinical

Product photography direction:
  - Hero product: floating, slight shadow, 3/4 angle, soft key light from upper-left
  - Lifestyle: real woman (40-60yo), authentic expression, not stock-photo smiling
  - Environment: marble countertop, soft draped fabric, morning window light — aspirational but real

Always respond with valid JSON only — no markdown, no extra text.`

  const userPrompt = `Study these brand documents deeply. Extract every insight about avatars, pain points, proof points, competitors, and brand voice. Then create ${count} DISTINCT, HIGH-CONVERTING ad concepts — each using a DIFFERENT copywriting framework and visual approach.

BRAND DOCUMENTS:
${context}
${brandNameContext}${brandColorContext}${brandImageContext}

RULES:
- Each concept must use a DIFFERENT angle (no two the same framework)
- Headlines must be specific and emotionally charged — no generic claims
- Image prompts must describe a COMPLETE AD CREATIVE LAYOUT — not just a photo. Include: where the headline appears, what typography style, what icons/callouts are visible, product placement, background color/texture, model if present, and all visible design elements. Think "describe this ad to a designer who will recreate it exactly."
- The ad creative in the image prompt should look like a finished, print-ready Facebook/Instagram ad — similar to premium DTC lingerie/apparel brands

Return a JSON array of exactly ${count} objects. Each object must have:
- "id": number (1-${count})
- "headline": string (specific, charged, under 10 words — calls out avatar pain or desire)
- "hook": string (1-2 sentence scroll-stopper opening, uses chosen framework, names the pain or desire explicitly)
- "body": string (2-3 sentences: proof, mechanism, transformation — concrete and specific)
- "cta": string (action-forward, 3-6 words, creates urgency or curiosity)
- "angle": string (the specific framework: e.g. "PAS — chronic wire pain", "social proof snowball", "before/after/bridge — identity", "pattern interrupt — body betrayal")
- "targetAvatar": string (detailed: age, situation, core emotion, what they've tried before)
- "adLayout": string (the visual design concept: layout zones, color palette, typography style, what icons/callouts appear, product presentation, mood — 2-3 sentences)
- "imagePrompt": string (150-200 words describing the COMPLETE designed ad creative as if briefing an art director. CRITICAL: Use the exact brand hex colors provided in backgrounds, typography, and accents — name the specific colors. Include: background color/texture using brand palette, headline text and font style placement, subheadline, product position and lighting, icon callouts with their labels, brand name placement, color swatches row if relevant, model description if used, overall mood and polish level. This prompt goes directly to an AI image generator to create the full ad.)

Return ONLY the JSON array, nothing else.`

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })
    logUsage({ model: 'claude-sonnet-4-6', source: 'generate-concepts', inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens, sessionId })

    const concepts = parseModelJson(message.content[0].text, { sourceLabel: 'generate-concepts' })
    session.concepts = concepts
    session.chatHistory = []
    await saveSession(sessionId, session)
    res.json({ concepts })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Generate images for concepts (batch — parallel)
app.post('/api/generate-images', requireAuth, async (req, res) => {
  if (!await requireSessionOwnership(req, res, req.body.sessionId)) return
  const { sessionId, conceptIds } = req.body
  const session = await getSession(sessionId)

  const targets = conceptIds
    ? session.concepts.filter(c => conceptIds.includes(c.id))
    : session.concepts

  if (!targets.length) {
    return res.status(400).json({ error: 'No concepts to generate images for.' })
  }

  // Prefer product image as reference; fall back to any image with a Higgsfield URL
  const productAsset = session.brandImages.find(a => a.type === 'product' && a.higgsfieldUrl)
    || session.brandImages.find(a => a.higgsfieldUrl)
  const referenceImageUrl = productAsset?.higgsfieldUrl || null

  // Stream results back as Server-Sent Events so the client gets per-image updates
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)

  send({ type: 'start', total: targets.length, referenceImage: productAsset?.name || null })

  await Promise.allSettled(
    targets.map(async (concept) => {
      send({ type: 'status', id: concept.id, status: 'queued' })
      try {
        const imageUrl = await generateImageHighgsfield(
          concept.imagePrompt,
          referenceImageUrl,
          (status) => send({ type: 'status', id: concept.id, status })
        )
        send({ type: 'result', id: concept.id, imageUrl })
      } catch (e) {
        send({ type: 'result', id: concept.id, error: e.message || 'Generation failed' })
      }
    })
  )

  send({ type: 'done' })
  res.end()
})

// Chat to refine concepts
app.post('/api/chat', requireAuth, async (req, res) => {
  if (!await requireSessionOwnership(req, res, req.body.sessionId)) return
  const { sessionId, message } = req.body
  const session = await getSession(sessionId)

  const context = buildDocumentContext(session.documents)
  const conceptsJson = JSON.stringify(session.concepts, null, 2)

  const systemPrompt = `You are an expert advertising creative director helping refine ad concepts.
You have access to the brand documents and current ad concepts below.

BRAND DOCUMENTS:
${context}

CURRENT AD CONCEPTS:
${conceptsJson}

Help the user refine, adjust, or create new concepts based on their feedback.
When the user asks you to update or replace concepts, respond with the full updated concepts array as JSON inside a <concepts> tag, followed by a plain-text explanation.
If no concept changes are needed, just respond conversationally.`

  session.chatHistory.push({ role: 'user', content: message })

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: session.chatHistory,
    })
    logUsage({ model: 'claude-sonnet-4-6', source: 'chat', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, sessionId })

    const reply = response.content[0].text
    session.chatHistory.push({ role: 'assistant', content: reply })

    // Extract updated concepts if present
    const conceptsMatch = reply.match(/<concepts>([\s\S]*?)<\/concepts>/)
    let updatedConcepts = null
    let displayText = reply

    if (conceptsMatch) {
      try {
        updatedConcepts = parseModelJson(conceptsMatch[1], { sourceLabel: 'chat-revise concepts' })
        session.concepts = updatedConcepts
        displayText = reply.replace(/<concepts>[\s\S]*?<\/concepts>/, '').trim()
      } catch (_) {}
    }

    await saveSession(sessionId, session)
    res.json({ reply: displayText, updatedConcepts })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Extract structured brand brief from uploaded documents
app.post('/api/brand-brief', requireAuth, async (req, res) => {
  const { sessionId } = req.body
  if (!await requireSessionOwnership(req, res, sessionId)) return
  if (!await requireCredits(req, res, 'brand-brief', { projectId: sessionId })) return
  const session = await getSession(sessionId)

  // Need at least one source: docs OR scraped website OR manual offers/brand name.
  // Anything less and there's no signal for the model to work from.
  const hasDocs = !!session.documents?.length
  const hasWebsite = !!session.websiteContent
  const hasManual = !!session.manualOffers?.length
  if (!hasDocs && !hasWebsite && !hasManual) {
    return res.status(400).json({
      error: 'Need at least one source. Upload documents OR crawl your brand site OR paste manual offers.'
    })
  }

  const context = hasDocs ? buildDocumentContext(session.documents) : '(no foundational documents uploaded)'
  const brandNameHint = session.brandName ? `Brand name: "${session.brandName}"` : ''

  // Manual offers (user-pasted Kaching/Rebuy deals the scraper missed)
  const manualOffersSection = session.manualOffers?.length
    ? `\n\nMANUAL OFFERS (user-confirmed live promotions — TRUST THESE OVER any scraped data):\n${session.manualOffers.map(o => `• ${o}`).join('\n')}`
    : ''

  // Include scraped website content (multi-page crawl with catalog/offers) if available
  const wc = session.websiteContent
  let websiteSection = ''
  if (wc) {
    const home = wc.homepage || {}
    const pages = wc.pages || []
    const products = wc.products || []
    const pageBlocks = pages.map(p => `--- ${p.url} ---
Title: ${p.title || ''}
Headings: ${(p.headings || []).slice(0, 8).join(' | ')}
Prices visible on this page: ${(p.prices || []).join(', ') || '(none)'}
Body excerpt: ${(p.bodyExcerpt || '').slice(0, 1500)}`).join('\n\n')

    // Pricing context, restructured into two TIERS so the model knows which to trust:
    //   Tier 1 (highest): prices visible on the homepage + landing pages — what the
    //                     customer actually sees, includes bundle-app overrides.
    //   Tier 2 (raw):     Shopify catalog priceRange — underlying SKU price, often
    //                     wrong because bundle apps modify the displayed price.
    // Manual offers (above) override everything when present.
    const homepagePrices = home.prices || []
    const otherPagePrices = pages.flatMap(p => p.prices || [])
    const offerPrices = [...new Set([...homepagePrices, ...otherPagePrices])]
    const catalogBlock = products.length
      ? `\n\nRAW SHOPIFY CATALOG (${products.length} products — these are SKU prices and may NOT match what the customer actually sees if the brand uses bundle apps; PREFER offer-page prices above):\n` + products.slice(0, 20).map(p => {
          const price = p.priceRange ? (p.priceRange.min === p.priceRange.max ? `$${p.priceRange.min}` : `$${p.priceRange.min}–$${p.priceRange.max}`) : 'n/a'
          return `• ${p.title} — ${price} (catalog)${p.onSale ? ' [ON SALE]' : ''}${p.productType ? ` [${p.productType}]` : ''}\n  ${(p.description || '').slice(0, 250)}`
        }).join('\n')
      : ''

    websiteSection = `\n\nSCRAPED WEBSITE (${wc.sourceUrl}, platform: ${wc.platform}):

HOMEPAGE — what the customer sees first:
Title: ${home.title || ''}
Meta description: ${home.metaDescription || ''}
Top headings: ${(home.headings || []).slice(0, 12).join(' | ')}
CTAs seen: ${(home.buttonsAndCtas || []).slice(0, 10).join(' | ')}
Prices visible on homepage: ${homepagePrices.join(', ') || '(none detected)'}
Body excerpt: ${(home.bodyExcerpt || '').slice(0, 2500)}

PRICES VISIBLE ON OFFER / LANDING PAGES (highest-trust source for pricing — this is what the customer actually sees, including any bundle-app discounts): ${offerPrices.join(', ') || '(none detected)'}
ALL OFFER / DEAL SIGNALS DETECTED: ${(wc.allOffers || []).slice(0, 15).join(' | ')}
${catalogBlock}

OTHER PAGES SCRAPED (${pages.length}):
${pageBlocks}`
  }

  try {
   const brief = await withJsonRetry('brand-brief', async () => {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 6000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You build a deep, evidence-rich brand brief that becomes the context engine for ALL downstream ad generation (angles, copy, image prompts). Output quality is paramount — a shallow brief = generic angles = mid ads.

Sources you'll receive (any subset, in this priority order):
1. MANUAL OFFERS — user-confirmed live promos. Highest trust for pricing/deals.
2. SCRAPED WEBSITE — homepage, landing pages, Shopify catalog. Pricing has TWO tiers:
   - "Prices visible on offer / landing pages" — what the customer actually sees. PREFER these. Includes bundle-app pricing.
   - "Raw Shopify catalog" — underlying SKU prices. Often wrong because bundle apps override the displayed price. Only use if no offer-page price is detected.
3. BRAND DOCUMENTS — research, voice, avatar work. Highest trust for psychology and voice.

DEPTH BAR (non-negotiable):
- Avatars: 5-7 distinct ones. The docs may name 3 — INFER 2-4 more from the product category, the offers, the tone of the website. Each avatar should feel like a different person, not a different label on the same person.
- corePains: ≥ 10 specific pains. Don't write "weight gain" — write "the bloat that makes jeans not button by 4pm." Use customer language when documents provide it; infer when they don't.
- coreDesires: ≥ 10 desires. Mass-market when possible (status, control, ease, certainty, attractiveness).
- proofPoints: ≥ 8. Pull from docs/site if stated; infer category-typical proof patterns when not. Tag each as evidence vs inferred so downstream uses them honestly.
- competitorGaps: ≥ 5 specific positioning gaps. What is the brand's category over-saying? What's missing? Where is the mass conversation tired?
- marketGaps: 3-5 macro gaps in the broader market the brand could OWN — emotional territory, ingredient claim, ritual, audience segment that's underserved.
- inferredCompetitors: 4-7 likely category competitors with a one-line differentiation read on each. Reason from the product category, the offers, and the pricing tier.
- brandVoice: a 2-3 sentence voice profile WITH 3-5 example phrases the brand would and would NOT say.

If documents are absent, do NOT refuse — infer from the website + category. If website is absent, infer from documents + category. If both, cross-reference and reconcile.

NEVER fabricate specific data points (testimonials, claimed studies, exact percentages) you don't see in the inputs. Mark inferences as inferences.

Return valid JSON only. No prose, no markdown fences.`,
        },
        {
          role: 'user',
          content: `${brandNameHint}\n\nBRAND DOCUMENTS:\n${context}${websiteSection}${manualOffersSection}\n\nReturn this exact JSON structure:\n{\n  "product": { "name": string, "category": string, "price": string|null, "keyDifferentiator": string, "mechanism": string },\n  "currentOffers": [string],\n  "avatars": [{ "name": string, "demographics": string, "topDesire": string, "topFear": string, "currentSituation": string, "source": "documents" | "inferred" }],\n  "corePains": [string],\n  "coreDesires": [string],\n  "proofPoints": [{ "claim": string, "source": "evidence" | "inferred" }],\n  "competitorGaps": [string],\n  "marketGaps": [string],\n  "inferredCompetitors": [{ "name": string, "differentiation": string }],\n  "brandVoice": { "summary": string, "saysLike": [string], "neverSaysLike": [string] }\n}\n\nFor "price" in product: prefer offer-page prices over catalog prices. If only catalog is available, prefix with "catalog: $X". Use null only if there's truly no signal.`
        }
      ]
    })
    logUsage({ model: 'gpt-4o', source: 'brand-brief', inputTokens: completion.usage.prompt_tokens, outputTokens: completion.usage.completion_tokens, sessionId })
    return completion.choices[0].message.content
   })
    session.brandBrief = brief
    await saveSession(sessionId, session)
    res.json({ brandBrief: brief })
  } catch (e) {
    console.error('[brand-brief failed]', e.message)
    await refundLastCharge(req)
    res.status(500).json({ error: `Brief generation failed: ${e.message}. Credits refunded.` })
  }
})

// Conversational adjust — Haiku rewrites the brief based on a free-text
// instruction from the user. Cheap (~$0.005/edit). Use cases:
//   - "the price on the homepage is actually $39, fix it"
//   - "add an avatar of a 50-year-old man with chronic back pain"
//   - "the brand voice is too corporate, make it punchier"
//   - "remove the 'eco-conscious' avatar, that's not who buys this"
// Body: { sessionId, instruction }
app.post('/api/brand-brief/adjust', requireAuth, async (req, res) => {
  const { sessionId, instruction } = req.body
  if (!await requireSessionOwnership(req, res, sessionId)) return
  if (!await requireCredits(req, res, 'brand-brief-adjust', { projectId: sessionId })) return
  const session = await getSession(sessionId)
  if (!session.brandBrief) return res.status(400).json({ error: 'Generate a brief first.' })
  if (!instruction || !instruction.trim()) return res.status(400).json({ error: 'Instruction required.' })

  try {
   const updated = await withJsonRetry('brand-brief-adjust', async (attempt) => {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 6000,
      messages: [{
        role: 'user',
        content: `You are editing a brand brief based on a user instruction. Return the FULL updated brief as valid JSON — same shape as input, with the instruction applied.

CURRENT BRIEF:
${JSON.stringify(session.brandBrief, null, 2)}

USER INSTRUCTION:
${instruction.trim()}

Rules:
- Return the COMPLETE brief, not a diff. Preserve every field that wasn't touched by the instruction.
- Keep the same JSON shape as the input. If the input has avatars[].source, keep that.
- If the user is correcting a fact (price, offer, etc.), apply the correction confidently.
- If the user is asking to add or remove items (avatars, pains, etc.), do it.
- If the user is asking for stylistic changes (voice, tone), rewrite affected fields.
- Never invent specific testimonials/studies the user didn't provide.
- No prose, no markdown fences. JSON only.${attempt > 0 ? '\n- CRITICAL: previous response was unparseable. Output ONLY the JSON object, all string values properly escaped, every internal double-quote backslash-escaped.' : ''}`
      }]
    })
    logUsage({
      model: 'claude-haiku-4-5',
      source: 'brand-brief-adjust',
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      sessionId,
    })
    return message.content[0].text
   })
    session.brandBrief = updated
    await saveSession(sessionId, session)
    res.json({ brandBrief: updated })
  } catch (e) {
    console.error('[brand-brief-adjust failed]', e.message)
    await refundLastCharge(req)
    res.status(500).json({ error: `Brief adjust failed: ${e.message}. Credits refunded.` })
  }
})

// Conversational adjust for a single generated ad. Same pattern as the
// brief Adjust: Haiku takes the current ad + a free-text instruction and
// returns the updated copy fields. Image is NOT regenerated here — the
// user can hit ↺ Regen Prompt → Generate Image inside AdBuilder if they
// want a new image to match. Cost: ~$0.005/edit.
//
// Use cases:
//   - "make the headline punchier"
//   - "shorten the primary text by half"
//   - "the CTA should be more urgent"
//   - "rewrite in second person"
//   - "the description is missing a price — add $39"
//
// Body: { sessionId, adKey, instruction, currentCopy? }
// `currentCopy` (optional): {headline, primaryText, description, ctaButton} —
// the user's in-progress local edits. If provided, the model edits THESE
// instead of the server-saved version, so unsaved tweaks aren't lost.
// Updates session.ads[adKey] in place. Preserves: scores, critique,
// chosenHook, imageUrl, imagePrompt, imageSize/Quality, generatedAt.
// Updates: headline, primaryText, description, ctaButton.
app.post('/api/ads/adjust', requireAuth, async (req, res) => {
  const { sessionId, adKey, instruction, currentCopy } = req.body
  if (!await requireSessionOwnership(req, res, sessionId)) return
  if (!await requireCredits(req, res, 'ad-adjust', { projectId: sessionId, metadata: { adKey } })) return
  const session = await getSession(sessionId)
  const ad = session.ads?.[adKey]
  if (!ad) return res.status(400).json({ error: 'Ad not found. Generate copy first.' })
  if (!instruction || !instruction.trim()) return res.status(400).json({ error: 'Instruction required.' })

  // Look up the format + angle for context
  const format = AD_FORMATS.find(f => f.id === ad.formatId) || null
  const angle = (session.angles || []).find(a => a.id === ad.angleId) || null

  // Editable subset only — pass the original four fields, get four fields back.
  // Prefer the client-supplied currentCopy (live local edits), fall back to
  // the server-saved version if the client didn't send any.
  const src = currentCopy && typeof currentCopy === 'object' ? currentCopy : ad
  const editable = {
    headline: src.headline || ad.headline || '',
    primaryText: src.primaryText || ad.primaryText || '',
    description: src.description || ad.description || '',
    ctaButton: src.ctaButton || ad.ctaButton || '',
  }

  try {
   const updated = await withJsonRetry('ads-adjust', async (attempt) => {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `You are editing a single Meta ad's copy based on a user instruction. Return the FULL updated copy as valid JSON — same four fields as input, with the instruction applied.

CURRENT AD COPY:
${JSON.stringify(editable, null, 2)}

CONTEXT (do NOT change these — for reference only):
- Angle avatar: ${angle?.avatar || '(unknown)'}
- Angle pain: ${angle?.pain || '(unknown)'}
- Angle insight: ${angle?.insightLine || '(unknown)'}
- Format: ${format?.name || '(unknown)'} (${format?.funnel?.toUpperCase() || ''})
- Format intent: ${format?.intent || ''}
${ad.chosenHook ? `- Locked hook (do NOT rewrite): "${ad.chosenHook}"` : ''}

USER INSTRUCTION:
${instruction.trim()}

Rules:
- Return the COMPLETE four fields, not a diff. Preserve fields the instruction doesn't touch.
- Headline ≤ 40 characters. Description ≤ 30 characters. Sentence case for both — never Title Case, never ALL CAPS.
- ctaButton MUST be one of: ${META_CTAS.join(', ')}. If the user asks to change the CTA, snap to the closest match in this list.
- ${ad.chosenHook ? `If a hook is locked, the primary text should still START with that hook verbatim. Don't rewrite the first sentence.` : `You may rewrite freely.`}
- Apply the user's instruction precisely. If they say "punchier", actually make it punchier (shorter, harder verbs, sharper opening). If they say "add urgency", add a real time-bound trigger. Don't no-op.
- Keep voice consistent with the angle. No fluff, no generic AI phrasing.
- No prose around the JSON. No markdown fences. JSON only.${attempt > 0 ? '\n- CRITICAL: previous response was unparseable. Output ONLY the JSON object with all string values properly escaped and every internal double-quote backslash-escaped.' : ''}

Return:
{
  "headline": string,
  "primaryText": string,
  "description": string,
  "ctaButton": string
}`
      }]
    })
    logUsage({
      model: 'claude-haiku-4-5',
      source: 'ads-adjust',
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      sessionId,
    })
    return message.content[0].text
   })

    // Snap CTA to whitelist (defensive — prompt asks for it but model can drift)
    if (!META_CTAS.includes(updated.ctaButton)) {
      updated.ctaButton = ad.ctaButton  // keep original if model returned something invalid
    }

    // Merge updated fields back into the ad, preserve everything else
    session.ads[adKey] = {
      ...ad,
      headline: updated.headline ?? ad.headline,
      primaryText: updated.primaryText ?? ad.primaryText,
      description: updated.description ?? ad.description,
      ctaButton: updated.ctaButton ?? ad.ctaButton,
    }
    await saveSession(sessionId, session)
    res.json({ ad: session.ads[adKey] })
  } catch (e) {
    console.error('[ads-adjust failed]', e.message)
    await refundLastCharge(req)
    res.status(500).json({ error: `Ad adjust failed: ${e.message}. Credits refunded.` })
  }
})

// Generate 20 unique angles from the brand brief
app.post('/api/generate-angles', requireAuth, async (req, res) => {
  const { sessionId } = req.body
  if (!await requireSessionOwnership(req, res, sessionId)) return
  if (!await requireCredits(req, res, 'angles', { projectId: sessionId })) return
  const session = await getSession(sessionId)
  if (!session.brandBrief) return res.status(400).json({ error: 'Generate brand brief first.' })

  const brief = JSON.stringify(session.brandBrief, null, 2)

  // Compact format catalog the model uses to pick suggestedFormatIds per angle.
  // One line per format: id, funnel, name, 1-line intent. Cheap (~600 tokens).
  const formatCatalog = AD_FORMATS.map(f =>
    `- id="${f.id}" funnel=${f.funnel} needsProduct=${f.needsProduct} — ${f.name}: ${f.description}`
  ).join('\n')

  // Pre-built lookup from id → format for validation below
  const formatById = Object.fromEntries(AD_FORMATS.map(f => [f.id, f]))

  try {
   const parsed = await withJsonRetry('generate-angles', async () => {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 8192,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a world-class DTC performance marketer generating ad testing angles.

An ANGLE is a specific desire/pain/insight + avatar pairing that creates a unique emotional hook.

USE EVERY PART OF THE BRIEF. The brief gives you:
- 5-7 avatars (some explicit from docs, some inferred) — distribute angles across ALL of them, not just the top 2-3
- 10+ corePains and 10+ coreDesires — pull from the full set, not the first three
- proofPoints (some marked "evidence", some "inferred") — use evidence-tagged ones for BOFU; inferred ones can shape MOFU mechanism stories but don't fabricate specifics
- competitorGaps + marketGaps — these are the highest-leverage angles. At least 4-6 of your 20 should attack a stated gap explicitly
- inferredCompetitors — name the competitor pattern in the angle when relevant (don't name the brand directly, target the pattern: "what every other [category] brand promises but doesn't deliver")
- brandVoice (saysLike / neverSaysLike) — every angle should be writeable IN this voice without effort

RULES:
- Be SPECIFIC. Not "back pain" — "the throbbing ache under her shoulder blade that starts at 11am and ruins her afternoon"
- No two angles target the same avatar + desire combination
- Cover the full funnel: 8 TOFU, 7 MOFU, 5 BOFU
- Each string under 120 characters. insightLine is one punchy sentence.
- Distribute across the avatars: with 5-7 avatars and 20 angles, no single avatar should claim more than 5 angles.
- AT LEAST 4 angles must explicitly target a competitorGap or marketGap from the brief.

FOR EACH ANGLE, also pick 1-3 best-fit AD FORMATS from the catalog below. Return them as suggestedFormatIds (most-recommended first). The user will use suggestedFormatIds[0] as the default when they batch-generate ads, so order matters.

How to choose formats:
- The format's funnel MUST match the angle's funnelStage (TOFU angle → TOFU format; etc.)
- Pick formats whose intent fits the angle's hookDirection. e.g. an angle about a founder's frustration → "founder_story". An angle that exposes a shady industry pattern → "indictment". An angle about a contrarian insight → "pattern_interrupt" or "real_talk".
- Avoid suggesting "needsProduct=true" formats for angles that don't have a strong product hook.
- 1 suggestion is fine if only one format truly fits. Don't pad.

AD FORMAT CATALOG:
${formatCatalog}

Return JSON object: { "angles": [ array of exactly 20 objects with keys: id, avatar, desire, pain, hookDirection, funnelStage, insightLine, suggestedFormatIds ] }`
        },
        {
          role: 'user',
          content: `BRAND BRIEF:\n${brief}\n\nGenerate exactly 20 unique, specific, testable angles. Distribute across all avatars in the brief. At least 4 angles must explicitly target a competitorGap or marketGap. For each angle, include suggestedFormatIds — 1 to 3 ids from the catalog whose funnel matches the angle's funnelStage.`
        }
      ]
    })
    logUsage({ model: 'gpt-4o', source: 'generate-angles', inputTokens: completion.usage.prompt_tokens, outputTokens: completion.usage.completion_tokens, sessionId })
    return completion.choices[0].message.content
   })
    const raw_angles = parsed.angles || parsed
    // Normalize funnelStage to lowercase and ensure id is a number.
    // Also validate suggestedFormatIds: drop unknown ids + drop ids whose funnel
    // doesn't match the angle's funnel; cap at 3. If validation strips every
    // suggestion, fall back to the first 3 catalog formats matching the funnel
    // — every angle MUST have at least one default so the batch generator can
    // never silently skip it. Final fallback: any 3 formats from the catalog.
    const angles = raw_angles.map((a, i) => {
      const funnelStage = String(a.funnelStage || 'tofu').toLowerCase().replace(/[^a-z]/g, '').replace('topoffunnel', 'tofu').replace('middleoffunnel', 'mofu').replace('bottomoffunnel', 'bofu')
      const rawSuggested = Array.isArray(a.suggestedFormatIds) ? a.suggestedFormatIds : []
      let suggestedFormatIds = rawSuggested
        .filter(id => typeof id === 'string')
        .map(id => id.trim())
        .filter(id => formatById[id] && formatById[id].funnel === funnelStage)
        .slice(0, 3)
      if (suggestedFormatIds.length === 0) {
        suggestedFormatIds = AD_FORMATS
          .filter(f => f.funnel === funnelStage)
          .map(f => f.id)
          .slice(0, 3)
      }
      if (suggestedFormatIds.length === 0) {
        suggestedFormatIds = AD_FORMATS.map(f => f.id).slice(0, 3)
      }
      return {
        ...a,
        id: typeof a.id === 'number' ? a.id : i + 1,
        funnelStage,
        suggestedFormatIds,
      }
    })
    session.angles = angles
    await saveSession(sessionId, session)
    res.json({ angles })
  } catch (e) {
    console.error('[generate-angles failed]', e.message)
    await refundLastCharge(req)
    res.status(500).json({ error: `Angle generation failed: ${e.message}. Credits refunded.` })
  }
})

// Generate full Meta ad copy for a specific angle × format combination
// Meta's official CTA button options. Locked list — copy MUST pick from these.
const META_CTAS = [
  'Shop Now', 'Learn More', 'Sign Up', 'Subscribe', 'Order Now',
  'Get Offer', 'Download', 'Book Now', 'Apply Now', 'Contact Us',
  'See Menu', 'Watch More', 'Listen Now', 'Send Message', 'Get Quote',
]

// Generate 10 hook candidates the user picks from before body gen.
// Cheap and fast — under $0.02, ~3-5s.
app.post('/api/generate-hooks', requireAuth, async (req, res) => {
  const { sessionId, angleId, formatId } = req.body
  if (!await requireSessionOwnership(req, res, sessionId)) return
  if (!await requireCredits(req, res, 'generate-hooks', { projectId: sessionId, metadata: { angleId, formatId } })) return
  const session = await getSession(sessionId)
  const angle = session.angles.find(a => a.id === angleId)
  const format = AD_FORMATS.find(f => f.id === formatId)
  if (!angle || !format) return res.status(400).json({ error: 'Invalid angle or format.' })

  const awarenessByFunnel = {
    tofu: 'PROBLEM-AWARE',
    mofu: 'SOLUTION-AWARE',
    bofu: 'PRODUCT-AWARE / MOST-AWARE',
  }
  const awareness = awarenessByFunnel[angle.funnelStage] || awarenessByFunnel.tofu

  try {
    const hooks = await generateHookCandidates({
      angle, format, awareness,
      brandVoice: session.brandBrief?.brandVoice,
      brandBrief: session.brandBrief,
      sessionId,
    })
    res.json({ hooks })
  } catch (e) {
    console.error('[generate-hooks failed]', e.message)
    await refundLastCharge(req)
    res.status(500).json({ error: `Hook generation failed: ${e.message}. Credits refunded.` })
  }
})

app.post('/api/generate-ad', requireAuth, async (req, res) => {
  if (!await requireSessionOwnership(req, res, req.body.sessionId)) return
  if (!await requireCredits(req, res, 'generate-ad-copy', {
    projectId: req.body.sessionId,
    metadata: { angleId: req.body.angleId, formatId: req.body.formatId },
  })) return
  const { sessionId, angleId, formatId, chosenHook } = req.body
  const session = await getSession(sessionId)

  const angle = session.angles.find(a => a.id === angleId)
  const format = AD_FORMATS.find(f => f.id === formatId)
  if (!angle || !format) return res.status(400).json({ error: 'Invalid angle or format.' })

  const brief = session.brandBrief ? JSON.stringify(session.brandBrief, null, 2) : buildDocumentContext(session.documents)
  const brandName = session.brandName || session.brandBrief?.product?.name || 'the brand'
  const colorContext = session.brandColors.length
    ? `Brand palette: ${session.brandColors.slice(0, 6).map(c => c.hex).join(', ')}`
    : ''
  const hasProductImage = session.brandImages.some(a => a.type === 'product' && a.higgsfieldUrl)
  const productImageNote = hasProductImage && format.needsProduct
    ? 'A product photo IS available and WILL be passed to the image model as a visual reference.'
    : format.needsProduct
      ? 'No product photo uploaded. Write image prompt as pure text-to-image with detailed product description.'
      : 'This is a non-product format. Image prompt must NOT require a product reference image.'

  const adKey = `${angleId}_${formatId}`

  // Awareness-stage default per funnel (Schwartz's framework)
  const awarenessByFunnel = {
    tofu: 'PROBLEM-AWARE (knows the pain, not the solution category — needs to discover the real hidden cause)',
    mofu: 'SOLUTION-AWARE (knows products like this exist, comparing options — needs unique mechanism + proof)',
    bofu: 'PRODUCT-AWARE / MOST-AWARE (knows your brand, on the fence — needs offer urgency, risk reversal, or specific result proof)',
  }
  const awareness = awarenessByFunnel[angle.funnelStage] || awarenessByFunnel.tofu

  try {
   const copy = await withJsonRetry('generate-ad copy', async (attempt) => {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: format.isNative ? 6000 : 3000,
      system: `You are a master direct-response copywriter trained on Eugene Schwartz's Breakthrough Advertising. You write Meta ad copy the way it actually converts — like someone sharing a 2 AM discovery, not like a brand pitching itself.

═══════ THE FRAMEWORK YOU OPERATE BY ═══════

MASS DESIRE → AWARENESS LEVEL → UNIQUE MECHANISM → STORY

You never write "ads." You channel an existing burning desire in the reader, meet them at their exact awareness stage, and reveal a Hidden Problem (the REAL reason their previous solutions failed) plus a Real Solution (why this works when others don't).

═══════ HEADLINE RULES (≤40 chars) ═══════
- Specific over clever. Real numbers, real moments, real avatar language.
- Stops the scroll by being SO specific it can only be about THIS person.
- Patterns that work: contrarian warning ("Stop using biotin"), shocking moment ("My doctor gasped"), authority shock ("The Swiss discovered..."), ultra-specific detail ("I brought a ziplock bag of my own hair").
- BANNED: "Transform your", "Discover", "Introducing", "Unlock", "Quality you can trust", any soft adjective stack.

═══════ PRIMARY TEXT RULES ═══════
- FIRST SENTENCE = the hook. Under 20 words. Must make them NEED the next line.
- Short paragraphs (1-3 sentences). Natural line breaks.
- Specific details: times, names, numbers, sensory moments, physical reactions.
- Conversational. NOT marketing. Read it out loud — does it sound like a friend or a brochure?
- Weave in the Hidden Problem (why obvious solutions fail) and the Real Solution (why THIS works) naturally — never explain them like a textbook.
- NO em dashes. Use commas or periods. NO forum/Reddit-quote blocks. NO structured headers in the body copy.
- Length adapts to format's copyLength: short (~80-120w), medium (~150-250w), long (~400-700w), minimal (~30-60w).

═══════ STRUCTURE: DESIGN IT, DON'T COPY IT ═══════
You will receive an "intent" describing what the format is going for emotionally and strategically. You will NOT receive a paragraph-by-paragraph template. Your job:
- Read the intent. Read the angle. Read the brief.
- DESIGN a structure that serves THIS specific angle on THIS specific format. Not a generic structure that fits the format name.
- Two ads using the same format on different angles should look structurally different — different paragraph counts, different opening moves, different rhythm.
- Generic "Para 1: Hook. Para 2: Pain. Para 3: Solution. Para 4: CTA" structures are BANNED. They produce templated copy. Real direct-response copy follows the natural shape of the story, not a checklist.
- If the intent calls for an essay register, write an essay. If it calls for terse stat-led copy, write that. The intent dictates the shape; angle dictates the substance.

═══════ DESCRIPTION (≤30 chars) ═══════
Sharpens or extends the headline. Often a specific qualifier ("For women 45+") or proof ("Used by 12,000+").

═══════ CTA BUTTON ═══════
You MUST pick exactly one from this Meta list (no other strings allowed):
${META_CTAS.join(' | ')}
Default to "Shop Now" for e-commerce purchase intent. "Learn More" for content/education. "Sign Up" for lead capture. "Get Offer" for promo-heavy BOFU. Match to funnel stage.

═══════ IMAGE PROMPT (fallback — a dedicated art-director call usually replaces this) ═══════
- 120-180 words. Briefing a real photographer, not "create an ad."
- Specify: subject (exact age/situation/styling), composition, lighting type, color palette (use brand hex codes if given), mood, lens/focal length feel, what to AVOID.
- For BOFU formats with deals/offers: describe a clean product-hero composition with negative space where text overlay can be added in post (Canva). DO NOT ask the model to render specific text — text rendering in AI image models is unreliable. Instead say "leave clean negative space in the upper-third for text overlay added in post."
- For before/after: describe BOTH halves clearly with the visual difference between them. Same person, same framing, lighting shift conveys the change.
- Match brand color palette when relevant. Match the avatar's exact demographic.
- ABSOLUTE RULE: NEVER include "Buy Now", "Learn More", "Get Offer", "Shop Now", or any CTA button text inside the image. Meta renders the CTA button natively below the image. No "click here" prompts, no arrow-button elements, no action pills inside the composition.`,
      messages: [{
        role: 'user',
        content: `BRAND BRIEF:
${brief}

BRAND NAME: ${brandName}
${colorContext}
${productImageNote}

ANGLE TO EXECUTE:
Avatar: ${angle.avatar}
Core Mass Desire: ${angle.desire}
Core Pain: ${angle.pain}
Hook Direction: ${angle.hookDirection}
Insight Line (the realization moment): ${angle.insightLine}
Funnel Stage: ${angle.funnelStage.toUpperCase()}
Awareness Level: ${awareness}

AD FORMAT: ${format.name}
Format Description: ${format.description}
Target Copy Length: ${format.copyLength}

WHAT THIS FORMAT IS GOING FOR (intent — design the structure to serve this, do NOT follow a template):
${format.intent}

VISUAL REGISTER FOR THIS FORMAT (mood/tone for the image, not composition specifics):
${format.visualDirection}
${format.isNative ? `\n${NATIVE_AD_BLUEPRINT}\n` : ''}
${chosenHook ? `\n═══════ LOCKED HOOK (the user chose this) ═══════
The first sentence of primaryText MUST be EXACTLY: "${chosenHook.replace(/"/g, '\\"')}"
Do NOT modify this sentence. Do NOT paraphrase. Do NOT extend it. Use it verbatim as the opening line. Then write the rest of the body to deliver on what this hook promises.\n` : ''}
CAPITALIZATION: Headline and description in sentence case (not Title Case, not ALL CAPS). Body in natural prose. ALL CAPS allowed only for one or two words of visceral emphasis (rare). The ad should never feel like it's shouting.

Now write the ad. ${format.isNative
  ? 'This is a long-form native ad — every beat in the blueprint above MUST appear in primaryText. Sequence them so they read as a story, not a checklist. PS and PPS appear at the end as literal labels.'
  : 'DESIGN the structure organically based on the angle, the brief, and the format\'s intent — do not impose a fixed paragraph-by-paragraph template. Two ads using the same format on different angles should look structurally different.'} Hidden Problem and Real Solution must be present in primaryText (woven in, not labeled). ${chosenHook ? 'Hook is LOCKED above — use verbatim.' : 'Hook must be in the first sentence.'} CTA must be from the locked Meta list.

Return valid JSON only:
{
  "headline": string (≤40 chars),
  "primaryText": string,
  "description": string (≤30 chars),
  "ctaButton": string (one of: ${META_CTAS.join(', ')}),
  "imagePrompt": string (120-180 words for Flux/Higgsfield)
}${attempt > 0 ? '\n\nCRITICAL: your previous response was not parseable JSON. Output ONLY the JSON object above with all string values properly escaped. No prose before or after. No markdown fences. Every double-quote inside a string value must be backslash-escaped.' : ''}`
      }]
    })
    logUsage({ model: 'claude-sonnet-4-6', source: 'generate-ad', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, sessionId })
    return response.content[0].text
   })
    // Snap CTA to a valid Meta button if model drifted off the list
    if (!META_CTAS.includes(copy.ctaButton)) {
      const fallback = angle.funnelStage === 'bofu' ? 'Get Offer'
        : angle.funnelStage === 'mofu' ? 'Learn More'
        : 'Shop Now'
      copy.ctaButton = fallback
    }

    // SECOND CALL: brutal self-critique + revise (Haiku, cheap, fast).
    // Scores the draft on 4 axes, rewrites weak sections, returns final copy.
    let scores = null
    let critique = null
    try {
      const reviewed = await critiqueAndReviseCopy({
        copy, angle, format, awareness,
        brandVoice: session.brandBrief?.brandVoice,
        sessionId,
      })
      scores = reviewed.scores
      critique = reviewed.critique
      // Replace draft copy with revised version
      copy.headline    = reviewed.revised.headline
      copy.primaryText = reviewed.revised.primaryText
      copy.description = reviewed.revised.description
      copy.ctaButton   = reviewed.revised.ctaButton
    } catch (e) {
      console.error('[Critique-revise failed, keeping draft]', e.message)
      // Non-fatal — we keep the draft if critique fails
    }

    // THIRD CALL: dedicated art director generates a banger image prompt
    // using the FINAL (revised) copy as context.
    try {
      copy.imagePrompt = await craftImagePrompt({
        copy, angle, format, session, brandName, colorContext, hasProductImage, sessionId
      })
    } catch (e) {
      console.error('[Image prompt gen failed]', e.message)
      // Keep whatever Claude generated in the first call as fallback
    }

    // Attach scores + critique + chosen hook (if any) to the saved ad
    copy.scores = scores
    copy.critique = critique
    if (chosenHook) copy.chosenHook = chosenHook

    session.ads[adKey] = { ...copy, angleId, formatId, generatedAt: Date.now() }
    await saveSession(sessionId, session)
    res.json({ adKey, copy })
  } catch (e) {
    console.error('[generate-ad failed]', e.message)
    await refundLastCharge(req)
    res.status(500).json({ error: `Ad generation failed: ${e.message}. Credits refunded.` })
  }
})

// Generate 10 distinct hook candidates for an angle × format. Hooks are the
// most leveraged line in the ad — we use Sonnet here despite the cost bump.
// User picks one; we then write the body anchored to it.
async function generateHookCandidates({ angle, format, awareness, brandVoice, brandBrief, sessionId }) {
  const briefSnippet = brandBrief ? `Product: ${brandBrief.product?.name || 'unknown'} (${brandBrief.product?.category || ''}). Avatars: ${(brandBrief.avatars || []).map(a => a.name).join(', ')}.` : ''

  const hooks = await withJsonRetry('generate-hooks', async (attempt) => {
   const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: `You generate hooks — the first sentence of a Meta direct-response ad. Hooks are the single most leveraged line in any ad: if the hook fails, the ad doesn't get read.

You'll generate exactly 10 DISTINCT hook candidates for the same angle. Distinct means:
- Different patterns: contrarian warning, shocking moment, authority shock, ultra-specific detail, casual confession, statistical surprise, vivid scene, direct callout, before-state, after-state, etc.
- Different emotional registers: vulnerable / angry / surprised / vindicated / scared / confident / curious
- Different lengths: some 5 words, some 18 words. Not all the same shape.

Hook rules (Schwartz):
- Specific over clever. Real numbers, real moments, real avatar language.
- Stops the scroll by being SO specific it can only be about THIS person.
- Under 20 words. Most should be under 12.
- BANNED: "Transform your", "Discover", "Introducing", "Unlock", "Quality you can trust", any soft adjective stack, any rhetorical question that doesn't actually pose tension.
- Match the awareness level of the reader.

Patterns that consistently work (don't copy these — generate in their family):
- "My doctor gasped when she saw my [thing]"
- "Stop using [common solution]. It's making it worse."
- "I brought a ziplock bag of my own hair to the doctor"
- "The Swiss discovered why American women's [problem] gets worse after 45"
- "I unbuttoned my jeans under my desk by 2pm. Every day."
- "My vet said the [product] I bought is BANNED for a reason"
- "Why your [common solution] is going to your [wrong place], not [right place]"

Output: JSON array of 10 strings. Just the hook text, nothing else.`,
    messages: [{
      role: 'user',
      content: `ANGLE:
Avatar: ${angle.avatar}
Pain: ${angle.pain}
Desire: ${angle.desire}
Hook direction: ${angle.hookDirection}
Insight line (the realization moment): ${angle.insightLine}
Funnel: ${angle.funnelStage.toUpperCase()}
Awareness: ${awareness}

FORMAT: ${format.name} — ${format.description}
BRAND VOICE: ${brandVoice || 'not specified'}
${briefSnippet}

Generate 10 DISTINCT hook candidates. Each one a different pattern / emotional register / length. Return ONLY a JSON array of 10 strings, no preamble.${attempt > 0 ? ' CRITICAL: previous response was unparseable. Output ONLY the JSON array, nothing else.' : ''}`
    }]
   })
   logUsage({
     model: 'claude-sonnet-4-6',
     source: 'generate-hooks',
     inputTokens: response.usage.input_tokens,
     outputTokens: response.usage.output_tokens,
     sessionId,
   })
   return response.content[0].text
  })
  if (!Array.isArray(hooks)) throw new Error('Hook generator did not return an array')
  return hooks.filter(h => typeof h === 'string' && h.trim()).slice(0, 10)
}

// ── Rip Concept ────────────────────────────────────────────────────────────
// "Rip Concept" lets a user paste in a high-performing ad (image + copy) and
// the AI deeply analyzes WHY it works, then adapts the concept's structural
// + emotional DNA to the user's brand. Two-step pipeline:
//   1. analyzeSourceAd — Sonnet+vision returns a structured analysis JSON
//      (format classification, copy structure, image register, transferable
//      "concept" with what-must-be-preserved / what-must-be-adapted)
//   2. adaptConceptToBrand — Sonnet writes a fresh ad in the same pattern
//      using the user's brief + brand assets + voice. Output drops back into
//      the existing critique/art-director/image-gen chain unchanged.

// Sonnet+vision deep analysis. Returns the structured "concept DNA."
// All copy fields are optional — when they're all absent we run image-only
// mode and the prompt instructs the model to populate copy fields with
// "n/a — image only" and lean fully on the visual register for the concept.
async function analyzeSourceAd({
  imageBuffer, imageMime,
  primaryText, headline, description, ctaButton,
  sessionId,
}) {
  const imageB64 = imageBuffer.toString('base64')
  const hasAnyCopy = !!(primaryText || headline || description || ctaButton)
  const sourceCopyBlock = hasAnyCopy
    ? [
        headline    ? `HEADLINE: "${headline}"` : '',
        primaryText ? `PRIMARY TEXT: """${primaryText}"""` : 'PRIMARY TEXT: (not provided)',
        description ? `DESCRIPTION: "${description}"` : '',
        ctaButton   ? `CTA BUTTON: "${ctaButton}"` : '',
      ].filter(Boolean).join('\n')
    : '(NO COPY PROVIDED — image-only analysis. Lean on visual register, format guess, and any in-image typography. For copy.* fields you cannot infer, output "n/a — image only".)'

  const parsed = await withJsonRetry('rip-ad-analyze', async (attempt) => {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: `You are a master direct-response copywriter and creative director, trained on Eugene Schwartz's Breakthrough Advertising, Gary Halbert, David Ogilvy, and the modern Meta-ads playbook (Cole Schafer, Joe Sugarman, Stefan Georgi). You've reverse-engineered tens of thousands of high-performing ads.

You're being shown a successful ad — image + copy. Your job: extract its TRANSFERABLE CONCEPT — the structural and emotional DNA that made it work — so it can be applied to a different brand without losing what made it great.

Your analysis must be RUTHLESSLY SPECIFIC. Generic observations ("uses social proof", "emotional hook") are useless. Name the EXACT psychological mechanism, the EXACT structural pattern, the EXACT visual move. The downstream model will use your output to write a new ad — if your analysis is vague, the new ad will be vague.

Output a single JSON object with this exact shape (no preamble, no markdown fences):

{
  "ad_type": {
    "format": "confession|industry_indictment|pattern_interrupt|real_talk|open_loop|ugc_raw|lifestyle_native|mechanism|testimonial|social_proof|comparison|objection|result_stack|before_after|founder_story|deal_stack|limited_time|review_product|bundle_bogo|specificity_callout|other",
    "funnel_stage": "tofu|mofu|bofu",
    "awareness_level": "unaware|problem_aware|solution_aware|product_aware|most_aware",
    "is_native_long_form": boolean,
    "format_reasoning": "1-2 sentences justifying the classification"
  },
  "image": {
    "subject": "EXACTLY what's in frame — people, products, setting",
    "composition": "framing, angle, focal hierarchy, negative space",
    "lighting": "type, direction, temperature, mood",
    "color_palette": "dominant colors and the emotional read they create",
    "visual_register": "editorial|phone-camera authentic|premium-product|minimalist-typographic|documentary|aspirational-lifestyle|comparison-split|other — be specific",
    "text_overlay": "exact text on the image, position, typography, hierarchy. Or 'none' if absent",
    "product_visibility": "hero|contextual|absent — and HOW it's shown",
    "logo_placement": "where, sized how, OR 'absent'",
    "what_makes_it_stop_scroll": "the SPECIFIC visual reason this stops the scroll. Not 'it's eye-catching' — the exact thing"
  },
  "copy": {
    "hook_line": "the literal first sentence of the primary text",
    "hook_pattern": "curiosity gap|contrarian warning|specific moment|authority shock|confession|stat-led|other — and why it works for THIS audience",
    "narrative_arc": "the structural shape of the body — beat by beat, in order, naming the move at each step (e.g. 'symptoms → vindication → hidden cause reveal → product as embodiment of new mechanism → social proof → CTA')",
    "mass_desire_tapped": "the burning underlying desire the reader has that this speaks to (Schwartz framework — be specific, not 'wants to feel better')",
    "hidden_problem": "the Hidden Problem the ad reveals (the REAL reason their previous solutions failed). If the ad doesn't have one, say 'absent' — not all formats need it",
    "real_solution": "the Real Solution / unique mechanism positioned as the differentiator. Or 'absent'",
    "voice_register": "vulnerable-friend|authoritative-expert|investigative-journalist|terse-stats|aspirational-minimal|conversational-relatable|other — be specific",
    "social_proof_used": "type and placement, or 'absent'",
    "cta_approach": "what the CTA does emotionally and why it's calibrated to this awareness level"
  },
  "concept": {
    "one_line": "in ONE sentence, the transferable concept. Generic answers like 'tells a story' fail this prompt. Real answer: 'reframes the reader's previous failed attempts as evidence they were tricked by the wrong mechanism, then reveals the real one'",
    "why_it_works": "2-3 sentences on the psychological mechanism — what shift happens in the reader's mind, in what order, that makes them want to click",
    "structural_dna": "the EXACT pattern abstracted from the source brand — what the reader sees first, what they feel, what they realize, what they're moved to do, in order. Phrase it generically so it could apply to any brand: '[Reader sees X] → [Feels Y] → [Realizes Z] → [Wants to W]'",
    "emotional_trigger": "envy|fomo|vindication|fear|curiosity|status|belonging|relief|outrage|nostalgia|other",
    "what_must_be_preserved": "the elements that, if removed, break the concept. Specific: 'first-person POV in the opening', 'the moment of physical sensation', 'the contrarian framing of the category'",
    "what_must_be_adapted": "the brand-specific elements that need to change for a new brand. Specific: 'the product, the avatar's exact pain, the proof point, the time-of-day setting'",
    "best_fit_avatar_traits": "what kind of avatar (from a brand brief) this concept will land hardest with — name 2-3 traits"
  }
}`,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: imageMime || 'image/png', data: imageB64 } },
          { type: 'text', text: `Analyze this ad. Image attached. Copy:\n\n${sourceCopyBlock}\n\nReturn the JSON analysis.${attempt > 0 ? '\n\nCRITICAL: previous response was not parseable JSON. Output ONLY the JSON object, all string values properly escaped, no markdown fences.' : ''}` },
        ],
      }],
    })
    logUsage({
      model: 'claude-sonnet-4-6',
      source: 'rip-ad-analyze',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      sessionId,
    })
    return response.content[0].text
  })
  return parsed
}

// Adapt the analyzed concept to the user's brand. Output is the same copy
// shape the rest of the pipeline expects (headline, primaryText,
// description, ctaButton, imagePrompt-placeholder), so critiqueAndReviseCopy
// + craftImagePrompt + image gen can run downstream unchanged.
async function adaptConceptToBrand({
  analysis, session, brandName, sessionId,
}) {
  const brief = session.brandBrief ? JSON.stringify(session.brandBrief, null, 2) : buildDocumentContext(session.documents)
  const colorContext = session.brandColors.length
    ? `Brand palette: ${session.brandColors.slice(0, 6).map(c => c.hex).join(', ')}`
    : ''
  const hasProductImage = session.brandImages?.some(a => a.type === 'product' && (a.dataUrl || a.higgsfieldUrl))
  const hasLogo = session.brandImages?.some(a => a.type === 'logo' && a.dataUrl)
  const productNote = hasProductImage
    ? 'A product photo IS available and WILL be passed to the image model as a visual reference.'
    : 'No product photo uploaded. The image will be pure text-to-image.'

  const awarenessByLevel = {
    unaware:        'UNAWARE (doesn\'t know they have the problem yet — needs the reveal first)',
    problem_aware:  'PROBLEM-AWARE (knows the pain, not the solution category)',
    solution_aware: 'SOLUTION-AWARE (knows products like this exist, comparing options)',
    product_aware:  'PRODUCT-AWARE (knows your brand, on the fence)',
    most_aware:     'MOST-AWARE (familiar, ready to act with right offer)',
  }
  const awareness = awarenessByLevel[analysis.ad_type?.awareness_level] || awarenessByLevel.problem_aware

  const parsed = await withJsonRetry('rip-ad-adapt', async (attempt) => {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: analysis.ad_type?.is_native_long_form ? 6000 : 3000,
      system: `You are a master direct-response copywriter. Another brand ran a high-performing ad. We've reverse-engineered its TRANSFERABLE CONCEPT — the structural and emotional DNA. Your job: write a NEW ad for a different brand using that same concept, executed at the same level of craft.

═══════ THE ABSOLUTE RULES ═══════

1. PRESERVE THE STRUCTURAL DNA EXACTLY. Same emotional beat sequence. Same hook pattern. Same narrative arc. Same voice register.
2. ADAPT THE SUBSTANCE. Different brand, different avatar, different pain, different mechanism, different product. The clothes change; the skeleton stays.
3. DO NOT BLANDLY TRANSLATE. Write it as if you're the original copywriter who happens to now work for THIS brand. Same craft, new context.
4. PRESERVE the elements the analysis flagged as "must_be_preserved". Adapt the elements flagged as "must_be_adapted". Reading the analysis carefully is non-negotiable.
5. PICK THE RIGHT AVATAR from the brief. The analysis tells you what kind of avatar this concept lands hardest with — match it.

═══════ CRAFT STANDARDS (same as our normal ad-gen pipeline) ═══════

HEADLINE (≤40 chars): Specific over clever. Real moments, real numbers, real avatar language. Stops the scroll because it can only be about THIS person. BANNED: "Transform your", "Discover", "Introducing", "Unlock".

PRIMARY TEXT: First sentence is the hook — under 20 words, makes them NEED the next line. Short paragraphs (1-3 sentences). Specific details: times, names, sensory moments. Conversational, not marketing. NO em dashes (use commas/periods). NO Reddit-quote blocks. Length matches the source ad's length register.

DESCRIPTION (≤30 chars): Sharpens or extends the headline. Often a qualifier ("For women 45+") or proof ("Used by 12,000+").

CTA BUTTON: pick exactly ONE from this Meta whitelist:
${META_CTAS.join(' | ')}
Default to "Shop Now" for e-commerce purchase intent. "Learn More" for content/education. "Sign Up" for lead capture. "Get Offer" for promo-heavy BOFU. Match to the awareness level of the source.

IMAGE PROMPT (we'll regenerate this with a dedicated art-director call afterward — for now, write a concise placeholder that captures the source ad's visual register, adapted to this brand's product/avatar). 60-100 words.

═══════ OUTPUT ═══════

Return ONLY this JSON object — no preamble, no markdown fences:

{
  "headline": string (≤40 chars),
  "primaryText": string,
  "description": string (≤30 chars),
  "ctaButton": string (one of the Meta CTAs above),
  "imagePrompt": string (placeholder — 60-100 words),
  "chosenAvatarName": string (which avatar from the brief you matched, or 'inferred' if none fit),
  "preservationNotes": string (1 sentence on which 'must_be_preserved' elements you carried over)
}`,
      messages: [{
        role: 'user',
        content: `═══════ THE BRAND TO ADAPT FOR ═══════
Brand: ${brandName}
${colorContext}
${productNote}
${hasLogo ? 'Brand logo IS available as a reference image.' : ''}

BRAND BRIEF:
${brief}

═══════ THE CONCEPT ANALYSIS (extracted from the source ad) ═══════

${JSON.stringify(analysis, null, 2)}

═══════ THE TASK ═══════

Write a new ad for ${brandName} that uses this exact concept.

Source ad classified as: ${analysis.ad_type?.format} · ${(analysis.ad_type?.funnel_stage || 'tofu').toUpperCase()} · ${analysis.ad_type?.awareness_level} · ${analysis.ad_type?.is_native_long_form ? 'long-form native' : 'standard'}

Awareness target: ${awareness}

The reader must feel the SAME emotional progression the source ad created. Same hook pattern. Same narrative arc. Same voice. Different brand, different product, different avatar pain.

${analysis.ad_type?.is_native_long_form ? `\n${NATIVE_AD_BLUEPRINT}\n\nBecause this is a long-form native ad, every beat in the blueprint above MUST appear in primaryText. Sequence them as the source ad sequences them.\n` : ''}

CAPITALIZATION: sentence case for headline + description (not Title Case, not ALL CAPS). Body in natural prose.

Now write the ad. Return JSON only.${attempt > 0 ? '\n\nCRITICAL: previous response was not parseable JSON. Output ONLY the JSON object, all string values properly escaped, no markdown fences.' : ''}`
      }],
    })
    logUsage({
      model: 'claude-sonnet-4-6',
      source: 'rip-ad-adapt',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      sessionId,
    })
    return response.content[0].text
  })

  // Snap CTA to the Meta whitelist if the model drifted
  if (!META_CTAS.includes(parsed.ctaButton)) {
    const fallback = analysis.ad_type?.funnel_stage === 'bofu' ? 'Get Offer'
      : analysis.ad_type?.funnel_stage === 'mofu' ? 'Learn More'
      : 'Shop Now'
    parsed.ctaButton = fallback
  }
  return parsed
}

// Self-critique + revise pass. Runs after draft copy. Uses Haiku (cheap, fast).
// Scores the ad on 4 axes, identifies the weakest section, rewrites it.
// Returns { revised: {headline, primaryText, description, ctaButton}, scores, critique }
async function critiqueAndReviseCopy({ copy, angle, format, awareness, brandVoice, sessionId }) {
  const parsed = await withJsonRetry('critique-revise', async (attempt) => {
   const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2500,
    system: `You are a brutal performance marketer who has reviewed 50,000+ Meta ads and knows what stops scroll vs what gets ignored.

You're handed a draft ad. Your job:
1. Score it 1-10 on FOUR axes (be ruthless — 7 is "fine", 9 is "exceptional", 10 is reserved for ads that would actually go viral):
   - hook: Does the first sentence make me NEED to read the next? Or is it generic? Specific and visceral wins. Vague and abstract loses.
   - mechanism: Do I understand the Hidden Problem and Real Solution by the end? Does the ad reveal something non-obvious? Generic benefit lists score low.
   - voice: Does this sound like a person sharing a discovery, not a brand pitching? Marketing-speak ("transform", "discover", "introducing") tanks the score.
   - cta: Is the button right for THIS awareness level? "Shop Now" on a TOFU problem-aware ad = wrong. "Learn More" on BOFU offer = wrong.

2. Identify the WEAKEST section by name (headline | primaryText | description | ctaButton).

3. Rewrite that section ONLY — and any other sections that score below 8. Preserve the angle, the unique mechanism, the avatar voice. Don't break what's working. Just sharpen what's weak.

CRITICAL OUTPUT RULES:
- Return ONLY valid JSON, no preamble, no markdown fences.
- "revised" must contain ALL FOUR fields (headline, primaryText, description, ctaButton). For sections you didn't change, copy the original verbatim.
- Honest scores. If the draft is bad, say so. Don't inflate.

Return JSON:
{
  "scores": { "hook": 1-10, "mechanism": 1-10, "voice": 1-10, "cta": 1-10 },
  "critique": "1-2 sentence diagnosis of what was weakest and why",
  "revised": { "headline": string, "primaryText": string, "description": string, "ctaButton": string }
}`,
    messages: [{
      role: 'user',
      content: `ANGLE: ${angle.avatar} | pain: ${angle.pain} | desire: ${angle.desire} | funnel: ${angle.funnelStage.toUpperCase()}
AWARENESS LEVEL: ${awareness}
FORMAT: ${format.name} — ${format.description}
BRAND VOICE: ${brandVoice || 'not specified'}

DRAFT AD TO CRITIQUE AND REVISE:
Headline: "${copy.headline}"
Primary Text: """${copy.primaryText}"""
Description: "${copy.description}"
CTA Button: "${copy.ctaButton}"

Score it. Identify the weakest section. Rewrite weak sections. Return JSON.${attempt > 0 ? ' CRITICAL: previous response was unparseable. Output ONLY the JSON object, all string values properly escaped.' : ''}`
    }]
   })
   logUsage({
     model: 'claude-haiku-4-5',
     source: 'critique-revise',
     inputTokens: response.usage.input_tokens,
     outputTokens: response.usage.output_tokens,
     sessionId,
   })
   return response.content[0].text
  })

  // Sanity: ensure all 4 fields exist in revised, fall back to original if missing
  parsed.revised = {
    headline:    parsed.revised?.headline    || copy.headline,
    primaryText: parsed.revised?.primaryText || copy.primaryText,
    description: parsed.revised?.description || copy.description,
    ctaButton:   parsed.revised?.ctaButton   || copy.ctaButton,
  }
  // Keep CTA on the Meta whitelist
  if (!META_CTAS.includes(parsed.revised.ctaButton)) parsed.revised.ctaButton = copy.ctaButton

  return parsed
}

// Art-director image prompt generator. Reverse-engineers a high-fidelity
// prompt from the finished ad copy, brand context, and format.
async function craftImagePrompt({ copy, angle, format, session, brandName, colorContext, hasProductImage, sessionId = null }) {
  const brief = session.brandBrief ? JSON.stringify(session.brandBrief, null, 2) : ''
  const allOffers = [
    ...(session.manualOffers || []),
    ...(session.brandBrief?.currentOffers || []),
  ].filter((o, i, arr) => o && arr.indexOf(o) === i)
  const offers = allOffers.length
    ? `LIVE PROMOTIONS (incorporate into BOFU ad text overlays): ${allOffers.join(' | ')}`
    : ''
  const palette = session.brandColors.length
    ? session.brandColors.slice(0, 6).map(c => c.hex).join(', ')
    : ''

  // What references will be passed to the image model.
  // ORDER MATTERS — must match the order they're attached in /api/generate-ad-image:
  //   logo first (if uploaded), then product (if uploaded). Both are ALWAYS
  //   attached when present. format.needsProduct controls PROMINENCE, not
  //   inclusion: needsProduct=true → product is the visual hero;
  //   needsProduct=false → product still appears, but contextual/subtle
  //   (in a hand, on a counter, edge of frame) for narrative TOFU formats.
  const hasLogoRef = session.brandImages?.some(a => a.type === 'logo' && a.dataUrl)
  const hasProductRef = session.brandImages?.some(
    a => (a.type === 'product' || a.type === 'lifestyle') && a.dataUrl
  )
  const refList = []
  if (hasLogoRef) refList.push({ index: refList.length + 1, kind: 'LOGO', desc: 'the brand wordmark/logomark image' })
  if (hasProductRef) refList.push({ index: refList.length + 1, kind: 'PRODUCT', desc: 'the actual product packaging/bottle/box/can' })

  // How to integrate the product depends on the format's intent.
  // Product-centric (needsProduct=true): product is the hero, large + clear,
  //   and MUST appear — non-negotiable for these formats.
  // Narrative (needsProduct=false): product is OPTIONAL; the model decides
  //   whether to include it based on what the format genuinely needs. A
  //   confession/indictment essay ad shouldn't have a product hero shot —
  //   it would break the format. But IF the model decides the composition
  //   benefits from a subtle product appearance (in a hand, on a counter),
  //   the reference is attached so it matches the real product.
  const productGuidance = hasProductRef
    ? format.needsProduct
      ? `The product is the VISUAL HERO. Place it as the dominant subject — clear shot, well-lit, label visible and legible. Composition should sell the product on sight. The product MUST appear; this is non-negotiable for ${format.name}.`
      : `This is a NARRATIVE format (${format.name}). Product appearance is OPTIONAL — only include the product if it genuinely serves the format's emotional intent. For pure essay-style ads (confession, indictment) the visual is usually a person, scene, or typographic anchor — NOT a product shot. Forcing a product into these breaks the format and makes the ad feel like an ad. If you DO include the product, integrate it contextually (held in hand, on a counter, edge of frame) and anchor exactly to the reference image so it matches the real product.`
    : ''

  const refsBlock = refList.length
    ? `

═══════ REFERENCE IMAGES ARE BEING PASSED TO THE MODEL ═══════
${refList.map(r => `  Reference image ${r.index}: ${r.kind} — ${r.desc}`).join('\n')}

When you write this prompt, you MUST anchor to those references explicitly. Do NOT describe the product or logo abstractly — the model has the actual images. Your job is to tell it WHERE to place them and HOW to compose around them.

${productGuidance ? `PRODUCT INTEGRATION: ${productGuidance}\n\n` : ''}Hard rules when references are present:
- ${refList.find(r => r.kind === 'PRODUCT') && format.needsProduct
    ? `The product MUST appear. Replace any abstract product description with: "the EXACT product shown in reference image ${refList.find(r => r.kind === 'PRODUCT').index} — replicate it precisely (same shape, same label, same colors, same text on the label). Do NOT redesign the bottle. Do NOT change the product name printed on the label."`
    : refList.find(r => r.kind === 'PRODUCT')
      ? `IF you decide to include the product (optional for this format), it MUST be the EXACT product shown in reference image ${refList.find(r => r.kind === 'PRODUCT').index} — replicate it precisely (same shape, same label, same colors, same text on the label). Do NOT redesign or invent a stand-in. If the format doesn't call for product visibility, omit the product entirely — don't force it.`
      : 'No product reference — describe the product fully if shown.'}
- ${refList.find(r => r.kind === 'LOGO')
    ? `Use "the EXACT logo from reference image ${refList.find(r => r.kind === 'LOGO').index}" wherever the brand logo appears. Place it as a small brand mark (typically corner). Do NOT redraw, restyle, or rewrite the wordmark.`
    : 'No logo reference — omit any brand wordmark unless the product label naturally shows it.'}
- Do NOT generate competing brand text or wordmarks anywhere else in the composition. The only brand text in the image comes from the logo reference and the product label.
- If brand name and product name differ (e.g. brand "PureLivera", product "Uvora"), the logo reference is the brand. The product reference shows the product. Do not duplicate either as additional standalone text.`
    : ''

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: `You are an elite creative director writing image-generation prompts for direct-response Meta ads. Your prompts get shot one-shot by gpt-image-2 — a model that CAN render text legibly. You exploit that selectively, NOT by default. Most of your output should be photography-first; text overlays are reserved for the moments they actually serve the ad.

═══════ ABSOLUTE RULE — NO CTA BUTTON IN THE IMAGE ═══════

Meta renders the CTA button (Shop Now, Learn More, Get Offer, etc.) natively below the image as part of its UI. NEVER render that CTA — or anything styled as a clickable action button — inside the image.

Banned in the image, no exceptions:
- "Buy Now", "Shop Now", "Learn More", "Get Offer", "Subscribe", "Sign Up", "Order Now", or ANY of Meta's CTA whitelist as button-styled text
- Generic "click here", "tap to view", "swipe up", "→" arrow-button elements
- Any pill, rectangle, or rounded element at the bottom of the composition that reads as an action button

Allowed text (when the funnel rules below permit it):
- Prices, discount badges ("30% OFF", "Free Shipping", "Save $40")
- Urgency / scarcity text ("Limited time", "Only 200 left", "Ends Sunday")
- Headline / hook as hero typography
- Mechanism / feature callouts with icon labels
- Brand wordmark / logo
- Before/after labels, comparison checkmark grids

Doubling the CTA inside the image makes the ad feel ad-like, lowers native scroll feel, and crops badly across aspect ratios. The platform handles it. You don't.

═══════ TEXT OVERLAY — RULES BY FUNNEL STAGE ═══════

TOFU (confession, indictment, pattern_interrupt, real_talk, ugc_raw, lifestyle_native, open_loop):
- Default: NO text overlay. The image is the scroll-stop; the copy below converts.
- Exception: typographic-anchored TOFU formats (a damning stat, a single haunting word) — ONE piece of typography only, no logo, no badges.
- Never: prices, urgency, feature bullets, CTA, full headline overlay.

MOFU (mechanism, testimonial, comparison, before_after, social_proof, founder_story-MOFU):
- Optional: headline as visual anchor IF the composition genuinely needs it.
- Allowed: feature/mechanism callouts with icons, before/after labels, ingredient highlights.
- Logo: small, corner placement, only if it strengthens credibility.
- Never: prices, urgency badges, offer text, CTA.

BOFU (deal_stack, specificity_callout, social_proof_snowball, founder_story-BOFU):
- Full overlay license. Prices, "30% off", "free shipping", urgency, scarcity counters, comparison checkmark grids, offer-stack visuals, value bullets.
- Headline as visual hero.
- Brand logo placement.
- BUT STILL: NO CTA button. The Meta CTA renders natively below the image.

═══════ PROMPT STRUCTURE (always follow) ═══════

Line 1 — Aspect ratio + premium style header.
Example: "Square 1:1 premium e-commerce ad. Luxury intimates campaign aesthetic, Skims-meets-Honeylove polish."

Paragraph 1 — HERO SUBJECT, like briefing a Hasselblad photographer:
- Exact subject (product alone, person + product, before/after split, lifestyle scene — match the format)
- Camera angle, framing, distance
- Specific physical details: materials, textures, finishes, body parts visible, expressions
- Background and setting
- Negative space if text needs to overlay

Paragraph 2 — LIGHTING, COLOR, MOOD:
- Lighting direction, quality, temperature ("soft diffused studio light from upper left, gentle shadows, dreamy and feminine")
- Exact color palette using brand hex codes when provided
- Photographic style references (e.g. "shot on Hasselblad, magazine-grade clarity, hyperreal fabric texture, soft focus background")

Section "TEXT OVERLAY:" — INCLUDE THIS SECTION ONLY IF THE FUNNEL STAGE PERMITS IT (per rules above):
- For TOFU: omit this section entirely, OR specify a single typographic anchor if the format is one of the rare typographic TOFU formats.
- For MOFU: optional headline + optional feature/mechanism callouts. Skip the section if the format doesn't need them.
- For BOFU: full text composition — but NEVER a CTA button.
- When you do include text, specify each piece explicitly:
  • position (top-left, bottom-right, etc.)
  • exact text content (in quotes)
  • typography (serif vs sans, weight, all-caps, letter-spacing)
  • color (use brand hex codes)
  • hierarchy (logo, headline, sub-line, feature bullets, prices, urgency)

DO NOT write "create an ad," "marketing image," or other meta-commentary. You're describing the finished frame as if it already exists.

OUTPUT: just the prompt text. No preamble, no JSON, no quotes around it.`,
    messages: [{
      role: 'user',
      content: `BRAND: ${brandName}
${colorContext}
${offers}${refsBlock}
${hasProductRef
  ? format.needsProduct
    ? 'A product photo IS being passed as a visual reference. The product MUST appear in this ad (product-centric format). Anchor your prompt to the actual reference image so the generated product matches exactly. Do NOT describe an abstract or invented product.'
    : 'A product photo IS being passed as a visual reference, but this is a narrative format. Including the product is OPTIONAL — only include it if it genuinely serves the emotional intent of the format. If you DO include it, anchor to the reference image so it matches the real product.'
  : 'No product photo reference — fully describe the product if shown.'}

BRAND BRIEF (for tone, audience, positioning):
${brief}

ANGLE:
Avatar: ${angle.avatar}
Pain: ${angle.pain}
Desire: ${angle.desire}
Funnel: ${angle.funnelStage.toUpperCase()}

FORMAT: ${format.name} — ${format.description}
Visual register (mood/tone only — DESIGN the actual composition fresh, do not copy this language): ${format.visualDirection}

JUST-WRITTEN COPY (for tone reference and OPTIONAL text overlay — see funnel-stage rules):
Headline: "${copy.headline}"
Description: "${copy.description}"
Primary text (for tone reference, do NOT put all of this in the image): "${(copy.primaryText || '').slice(0, 400)}"

NOTE: the CTA button ("${copy.ctaButton}") is rendered NATIVELY by Meta's UI below the image. DO NOT render it in the image. Do not include any button-styled action element inside the composition.

Brand color palette (hex): ${palette || 'none — pick a sophisticated palette appropriate for the avatar and brand voice'}

Now write the prompt.`
    }]
  })
  logUsage({ model: 'claude-sonnet-4-6', source: 'craft-image-prompt', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, sessionId })
  return response.content[0].text.trim()
}

// Regenerate just the image prompt (without re-doing copy). Uses the elite art-director system.
app.post('/api/regenerate-prompt', requireAuth, async (req, res) => {
  if (!await requireSessionOwnership(req, res, req.body.sessionId)) return
  if (!await requireCredits(req, res, 'regenerate-prompt', {
    projectId: req.body.sessionId,
    metadata: { adKey: req.body.adKey },
  })) return
  const { sessionId, adKey } = req.body
  const session = await getSession(sessionId)
  const ad = session.ads[adKey]
  if (!ad) return res.status(400).json({ error: 'Generate ad copy first.' })

  const angle = session.angles.find(a => a.id === ad.angleId)
  const format = AD_FORMATS.find(f => f.id === ad.formatId)
  const brandName = session.brandName || session.brandBrief?.product?.name || 'the brand'
  const colorContext = session.brandColors.length
    ? `Brand palette: ${session.brandColors.slice(0, 6).map(c => c.hex).join(', ')}`
    : ''
  const hasProductImage = session.brandImages.some(a => a.type === 'product' && a.higgsfieldUrl)

  try {
    const newPrompt = await craftImagePrompt({
      copy: ad, angle, format, session, brandName, colorContext, hasProductImage, sessionId
    })
    session.ads[adKey].imagePrompt = newPrompt
    await saveSession(sessionId, session)
    res.json({ imagePrompt: newPrompt })
  } catch (e) {
    console.error('[regenerate-prompt failed]', e.message)
    await refundLastCharge(req)
    res.status(500).json({ error: `Prompt regen failed: ${e.message}. Credits refunded.` })
  }
})

// Generate image for a specific ad (angle × format)
app.post('/api/generate-ad-image', requireAuth, async (req, res) => {
  const { sessionId, adKey, size, quality } = req.body
  if (!await requireSessionOwnership(req, res, sessionId)) return
  // Charge by quality tier — low/medium/high → 1/3/8 cr
  const imageAction = imageActionForQuality(quality)
  if (!await requireCredits(req, res, imageAction, {
    projectId: sessionId,
    metadata: { adKey, size, quality },
  })) return
  const session = await getSession(sessionId)
  const ad = session.ads[adKey]
  if (!ad) return res.status(400).json({ error: 'Generate ad copy first.' })

  const format = AD_FORMATS.find(f => f.id === ad.formatId)
  const needsProduct = format?.needsProduct ?? false

  // Gather reference images from session brandImages.
  // RULE: if the user uploaded it, attach it. Both logo AND product are
  // always included when present. The format's needsProduct flag controls
  // how PROMINENT the product is in the composition (hero shot vs subtle /
  // contextual), NOT whether it appears at all. Treats legacy 'lifestyle'
  // type as product (covers existing tagged data + the recent UI change
  // that no longer offers Lifestyle as a choice).
  const refImagesForOpenAI = []
  const logoAsset = session.brandImages.find(a => a.type === 'logo' && a.dataUrl)
  const productAsset = session.brandImages.find(
    a => (a.type === 'product' || a.type === 'lifestyle') && a.dataUrl
  )

  // Diagnostic: surface what we found so we can debug missing-reference issues
  console.log(`[generate-ad-image] adKey=${adKey} format=${format?.name} needsProduct=${needsProduct}`)
  console.log(`  brandImages in session: ${session.brandImages.length}`)
  for (const a of session.brandImages) {
    console.log(`    - "${a.name}" type=${a.type} dataUrl=${a.dataUrl ? 'yes' : 'NO'} higgs=${a.higgsfieldUrl ? 'yes' : 'no'}`)
  }
  console.log(`  logoAsset: ${logoAsset ? logoAsset.name : 'NONE'}  productAsset: ${productAsset ? productAsset.name : 'NONE'}`)

  if (logoAsset) {
    const ref = decodeDataUrl(logoAsset.dataUrl, 'logo.png')
    if (ref) refImagesForOpenAI.push(ref)
    else console.log('  ⚠ logo dataUrl decode failed')
  }
  if (productAsset) {
    const ref = decodeDataUrl(productAsset.dataUrl, 'product.png')
    if (ref) refImagesForOpenAI.push(ref)
    else console.log('  ⚠ product dataUrl decode failed')
  }
  console.log(`  → passing ${refImagesForOpenAI.length} reference image(s) to OpenAI`)

  // Higgsfield uses URL-based reference (single image only)
  const productAssetForHiggs = needsProduct
    ? (session.brandImages.find(a => a.type === 'product' && a.higgsfieldUrl) || session.brandImages.find(a => a.higgsfieldUrl))
    : null
  const referenceImageUrl = productAssetForHiggs?.higgsfieldUrl || null

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
  send({ type: 'status', status: 'queued', referenceImage: productAsset?.name || null })

  // IMAGE_MODEL=openai (default) | gemini | higgsfield
  const provider = (process.env.IMAGE_MODEL || 'openai').toLowerCase()

  // Run a single provider. Used both for the primary attempt and for safety-
  // rejection fallbacks below.
  const runProvider = async (p) => {
    if (p === 'higgsfield') {
      return generateImageHighgsfield(
        ad.imagePrompt, referenceImageUrl,
        (s) => send({ type: 'status', status: s }), sessionId
      )
    }
    if (p === 'gemini' || p === 'nano-banana' || p === 'nanobanana') {
      return generateImageGemini(
        ad.imagePrompt,
        (s) => send({ type: 'status', status: s }), sessionId,
        { userId: req.user.id }
      )
    }
    return generateImageOpenAI(
      ad.imagePrompt,
      (s) => send({ type: 'status', status: s }), sessionId,
      { size, quality, referenceImages: refImagesForOpenAI, userId: req.user.id }
    )
  }

  // OpenAI's gpt-image-2 has aggressive content moderation that throws 400
  // safety_violations false-positives on body / intimate-apparel / health
  // brands (e.g. "bra", "fit", "comfort"). When we detect that specific
  // failure mode, retry the same prompt on a more lenient provider rather
  // than refunding to a "no image" outcome. Only triggers on safety errors —
  // rate limits, network errors, model errors propagate normally.
  const isSafetyError = (msg) => /safety|sexual|content[_ ]policy|moderation/i.test(msg || '')
  const fallbackChain = []
  if (process.env.HIGGSFIELD_CLIENT_ID && process.env.HIGGSFIELD_CLIENT_SECRET) fallbackChain.push('higgsfield')
  if (process.env.GEMINI_API_KEY) fallbackChain.push('gemini')

  try {
    let imageUrl
    let providerUsed = provider
    try {
      imageUrl = await runProvider(provider)
    } catch (primaryErr) {
      if (provider !== 'openai' || !isSafetyError(primaryErr.message) || fallbackChain.length === 0) {
        throw primaryErr
      }
      console.log(`[image-gen] OpenAI safety rejection — falling back through ${fallbackChain.join(' → ')}`)
      let lastErr = primaryErr
      for (const fb of fallbackChain) {
        try {
          send({ type: 'status', status: `retrying with ${fb} (OpenAI safety filter)` })
          imageUrl = await runProvider(fb)
          providerUsed = fb
          lastErr = null
          break
        } catch (e) {
          lastErr = e
          console.log(`[image-gen] fallback ${fb} also failed: ${e.message}`)
        }
      }
      if (!imageUrl) {
        throw new Error(`OpenAI safety rejection; fallbacks (${fallbackChain.join(', ')}) also failed: ${lastErr?.message || 'unknown'}`)
      }
    }
    // Persist the chosen settings on the ad so the UI remembers across regenerates
    session.ads[adKey].imageSize = size || '1024x1024'
    session.ads[adKey].imageQuality = quality || 'medium'
    if (!session.ads[adKey]) session.ads[adKey] = ad
    session.ads[adKey].imageUrl = imageUrl
    if (providerUsed !== provider) session.ads[adKey].imageProvider = providerUsed
    await saveSession(sessionId, session)
    send({ type: 'result', imageUrl, providerUsed: providerUsed !== provider ? providerUsed : undefined })
  } catch (e) {
    console.error('[Image gen failed]', e.message)
    await refundLastCharge(req)
    send({ type: 'result', error: `${e.message} (credits refunded)` })
  }

  send({ type: 'done' })
  res.end()
})

// ──────────────────────────────────────────────────────────────────────────
// /api/rip-ad — One-click "rip this concept" pipeline.
// Multipart upload: image file + form fields (sessionId, primaryText,
// optional headline/description/ctaButton). Streams SSE updates through
// each stage so the user sees the AI's reasoning unfold.
//
// Pipeline:
//   1. analyzeSourceAd      (Sonnet+vision deep-dive → concept analysis)
//   2. adaptConceptToBrand  (Sonnet writes draft copy in same DNA)
//   3. critiqueAndReviseCopy (Haiku critique + revise)
//   4. craftImagePrompt     (art-director Sonnet)
//   5. generate image       (OpenAI → Higgsfield safety fallback chain)
//
// Costs: rip-ad (5 cr — covers analyze+adapt+critique+art-director) +
// image-low/medium/high. The image charge is taken inside the image gen
// step so we can refund just it on image failure.
// ──────────────────────────────────────────────────────────────────────────
app.post('/api/rip-ad', requireAuth, upload.single('image'), async (req, res) => {
  const { sessionId, primaryText, headline, description, ctaButton, size, quality } = req.body
  if (!await requireSessionOwnership(req, res, sessionId)) return
  if (!req.file) return res.status(400).json({ error: 'Source image is required' })
  if (!ALLOWED_IMAGE_MIMES.has(req.file.mimetype)) {
    fs.unlink(req.file.path, () => {})
    return res.status(400).json({
      error: `Unsupported image format: ${req.file.mimetype}. Use PNG, JPEG, or WebP.`,
      code: 'UNSUPPORTED_IMAGE_FORMAT',
    })
  }
  // Copy is optional. Image-only rips work for visual-led ads (lifestyle
  // native, typographic pattern interrupts, etc.) — analysis just runs in
  // image-only mode.
  const safePrimary    = (primaryText || '').trim()
  const safeHeadline   = (headline    || '').trim()
  const safeDesc       = (description || '').trim()
  const safeCta        = (ctaButton   || '').trim()
  if (!await requireCredits(req, res, 'rip-ad', {
    projectId: sessionId,
    metadata: {
      sourceLen: safePrimary.length,
      hasPrimaryText: !!safePrimary,
      hasHeadline: !!safeHeadline,
      imageOnly: !safePrimary && !safeHeadline && !safeDesc && !safeCta,
    },
  })) {
    fs.unlink(req.file.path, () => {})
    return
  }

  // Stream
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)

  // Always cleanup the upload tempfile
  const cleanup = () => { if (req.file?.path) fs.unlink(req.file.path, () => {}) }

  let session, brandName
  try {
    session = await getSession(sessionId)
    brandName = session.brandName || session.brandBrief?.product?.name || 'the brand'
  } catch (e) {
    cleanup()
    await refundLastCharge(req)
    send({ type: 'error', error: `Session load failed: ${e.message} (credits refunded)` })
    return res.end()
  }

  // ── Step 1: Analyze ─────────────────────────────────────────────────────
  const imageOnly = !safePrimary && !safeHeadline && !safeDesc && !safeCta
  send({ type: 'stage', stage: 'analyzing', label: imageOnly ? 'Reading the source ad — image only' : 'Reading the source ad — image + copy' })
  let analysis
  try {
    const imageBuffer = fs.readFileSync(req.file.path)
    analysis = await analyzeSourceAd({
      imageBuffer,
      imageMime: req.file.mimetype,
      primaryText: safePrimary || null,
      headline:    safeHeadline || null,
      description: safeDesc || null,
      ctaButton:   safeCta || null,
      sessionId,
    })
    send({ type: 'analysis', analysis })
  } catch (e) {
    console.error('[rip-ad analyze]', e.message)
    cleanup()
    await refundLastCharge(req)
    send({ type: 'error', error: `Analysis failed: ${e.message} (credits refunded)` })
    return res.end()
  }

  // ── Step 2: Adapt to brand ──────────────────────────────────────────────
  send({ type: 'stage', stage: 'adapting', label: `Adapting concept for ${brandName}` })
  let copy
  try {
    copy = await adaptConceptToBrand({ analysis, session, brandName, sessionId })
  } catch (e) {
    console.error('[rip-ad adapt]', e.message)
    cleanup()
    await refundLastCharge(req)
    send({ type: 'error', error: `Adaptation failed: ${e.message} (credits refunded)` })
    return res.end()
  }

  // Synthesize an "angle" + "format" object so we can reuse the existing
  // critique + art-director helpers, which expect those shapes. The fields
  // they actually read are funnelStage, avatar, pain, desire, name, intent,
  // visualDirection, copyLength, needsProduct.
  const synthFunnel = analysis.ad_type?.funnel_stage || 'tofu'
  const sourceFormatId = analysis.ad_type?.format
  const matchedFormat = AD_FORMATS.find(f => f.id === sourceFormatId)
  const synthFormat = matchedFormat || {
    id: 'rip-' + (sourceFormatId || 'custom'),
    name: sourceFormatId ? sourceFormatId.replace(/_/g, ' ') : 'Custom Concept',
    funnel: synthFunnel,
    needsProduct: false,
    copyLength: analysis.ad_type?.is_native_long_form ? 'long' : 'medium',
    isNative: !!analysis.ad_type?.is_native_long_form,
    description: analysis.concept?.one_line || 'Ripped concept',
    intent: `${analysis.concept?.why_it_works || ''}\nStructural DNA: ${analysis.concept?.structural_dna || ''}\nPreserve: ${analysis.concept?.what_must_be_preserved || ''}`,
    visualDirection: `${analysis.image?.visual_register || ''}. ${analysis.image?.composition || ''}. ${analysis.image?.lighting || ''}.`,
  }
  // Pull the avatar the adapter chose, falling back to the first avatar in the brief.
  const avatars = session.brandBrief?.avatars || []
  const chosenAvatar = avatars.find(a => a?.name && a.name === copy.chosenAvatarName) || avatars[0] || {
    name: 'Inferred avatar', topDesire: '', topFear: '', currentSituation: '',
  }
  const synthAngle = {
    id: `rip-${Date.now()}`,
    avatar: chosenAvatar.demographics ? `${chosenAvatar.name} (${chosenAvatar.demographics})` : chosenAvatar.name,
    desire: chosenAvatar.topDesire || analysis.copy?.mass_desire_tapped || '',
    pain:   chosenAvatar.topFear   || (session.brandBrief?.corePains?.[0] || ''),
    hookDirection: analysis.copy?.hook_pattern || '',
    insightLine:   analysis.concept?.one_line || '',
    funnelStage:   synthFunnel,
  }
  const awarenessByLevel = {
    unaware:        'UNAWARE',
    problem_aware:  'PROBLEM-AWARE',
    solution_aware: 'SOLUTION-AWARE',
    product_aware:  'PRODUCT-AWARE',
    most_aware:     'MOST-AWARE',
  }
  const awareness = awarenessByLevel[analysis.ad_type?.awareness_level] || 'PROBLEM-AWARE'

  // ── Step 3: Critique + revise ───────────────────────────────────────────
  send({ type: 'stage', stage: 'critiquing', label: 'Quality pass — scoring and sharpening' })
  let scores = null, critique = null
  try {
    const reviewed = await critiqueAndReviseCopy({
      copy, angle: synthAngle, format: synthFormat, awareness,
      brandVoice: session.brandBrief?.brandVoice, sessionId,
    })
    scores = reviewed.scores
    critique = reviewed.critique
    copy.headline    = reviewed.revised.headline
    copy.primaryText = reviewed.revised.primaryText
    copy.description = reviewed.revised.description
    copy.ctaButton   = reviewed.revised.ctaButton
  } catch (e) {
    console.error('[rip-ad critique failed, keeping draft]', e.message)
    // Non-fatal — keep draft
  }

  // ── Step 4: Art-director image prompt ───────────────────────────────────
  send({ type: 'stage', stage: 'art_directing', label: 'Designing the image' })
  const colorContext = session.brandColors.length
    ? `Brand palette: ${session.brandColors.slice(0, 6).map(c => c.hex).join(', ')}`
    : ''
  const hasProductImage = session.brandImages?.some(a => a.type === 'product' && a.higgsfieldUrl)
  try {
    copy.imagePrompt = await craftImagePrompt({
      copy, angle: synthAngle, format: synthFormat, session,
      brandName, colorContext, hasProductImage, sessionId,
    })
  } catch (e) {
    console.error('[rip-ad image prompt failed, using adapt placeholder]', e.message)
    // Keep the placeholder Sonnet generated in the adapt step
  }

  // Persist as an ad with rip metadata, before kicking off image gen, so the
  // copy is durable even if image fails.
  copy.scores = scores
  copy.critique = critique
  copy.source = 'rip'
  copy.sourceMeta = {
    primaryText: safePrimary ? safePrimary.slice(0, 4000) : null,
    headline:    safeHeadline || null,
    description: safeDesc || null,
    ctaButton:   safeCta || null,
    imageOnly,
    analysis,
    rippedAt: Date.now(),
  }
  const adKey = `rip_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
  session.ads[adKey] = { ...copy, angleId: null, formatId: synthFormat.id, generatedAt: Date.now() }
  await saveSession(sessionId, session)
  send({ type: 'copy', adKey, copy: session.ads[adKey] })

  // ── Step 5: Image gen (with safety fallback chain) ──────────────────────
  send({ type: 'stage', stage: 'generating_image', label: 'Rendering image' })
  // Charge image credits separately so the right amount is refunded if
  // ONLY the image step fails (copy still saved).
  const imgQuality = (quality === 'low' || quality === 'high') ? quality : 'medium'
  const imgSize = size || '1024x1024'
  const imageAction = imageActionForQuality(imgQuality)
  // Save the rip-ad credit charge so refundLastCharge later refunds the
  // image charge; we'll re-charge image on top.
  req.creditCharge = null
  // SSE headers were flushed earlier so we CANNOT use `requireCredits` here
  // (it tries to call `res.status(402).json(...)` on the same response, which
  // throws "Cannot set headers" once the stream is open). Charge directly via
  // chargeCredits and surface a 402 as an SSE event the client knows how to
  // handle.
  let imageCharged = false
  try {
    const newBalance = await chargeCredits({
      userId: req.user.id,
      action: imageAction,
      projectId: sessionId,
      metadata: { adKey, size: imgSize, quality: imgQuality, source: 'rip' },
    })
    req.creditBalance = newBalance
    req.creditCharge = {
      action: imageAction,
      credits: CREDIT_COSTS[imageAction],
      projectId: sessionId,
      metadata: { adKey, size: imgSize, quality: imgQuality, source: 'rip' },
    }
    imageCharged = true
  } catch (e) {
    if (e.statusCode === 402) {
      send({ type: 'image', error: `Out of credits for image (${imageAction}, ${e.required || CREDIT_COSTS[imageAction]} cr needed). Copy is saved — top up and generate the image manually from the Studio tab.` })
    } else {
      console.error('[rip-ad image charge]', e.message)
      send({ type: 'image', error: `Credit check failed for image: ${e.message}` })
    }
    cleanup()
    send({ type: 'done', adKey })
    return res.end()
  }

  // Reference images (logo + product, same as /api/generate-ad-image)
  const refImagesForOpenAI = []
  const logoAsset = session.brandImages.find(a => a.type === 'logo' && a.dataUrl)
  const productAsset = session.brandImages.find(a => (a.type === 'product' || a.type === 'lifestyle') && a.dataUrl)
  if (logoAsset) {
    const ref = decodeDataUrl(logoAsset.dataUrl, 'logo.png')
    if (ref) refImagesForOpenAI.push(ref)
  }
  if (productAsset) {
    const ref = decodeDataUrl(productAsset.dataUrl, 'product.png')
    if (ref) refImagesForOpenAI.push(ref)
  }
  const productAssetForHiggs = session.brandImages.find(a => a.higgsfieldUrl)
  const referenceImageUrl = productAssetForHiggs?.higgsfieldUrl || null

  const provider = (process.env.IMAGE_MODEL || 'openai').toLowerCase()
  const runProvider = async (p) => {
    if (p === 'higgsfield') return generateImageHighgsfield(copy.imagePrompt, referenceImageUrl, (s) => send({ type: 'status', status: s }), sessionId)
    if (p === 'gemini' || p === 'nano-banana' || p === 'nanobanana') return generateImageGemini(copy.imagePrompt, (s) => send({ type: 'status', status: s }), sessionId, { userId: req.user.id })
    return generateImageOpenAI(copy.imagePrompt, (s) => send({ type: 'status', status: s }), sessionId, {
      size: imgSize, quality: imgQuality, referenceImages: refImagesForOpenAI, userId: req.user.id,
    })
  }
  const isSafetyError = (msg) => /safety|sexual|content[_ ]policy|moderation/i.test(msg || '')
  const fallbackChain = []
  if (process.env.HIGGSFIELD_CLIENT_ID && process.env.HIGGSFIELD_CLIENT_SECRET) fallbackChain.push('higgsfield')
  if (process.env.GEMINI_API_KEY) fallbackChain.push('gemini')

  let imageUrl = null
  let providerUsed = provider
  try {
    try {
      imageUrl = await runProvider(provider)
    } catch (primaryErr) {
      if (provider !== 'openai' || !isSafetyError(primaryErr.message) || fallbackChain.length === 0) throw primaryErr
      console.log(`[rip-ad image] OpenAI safety rejection — falling back through ${fallbackChain.join(' → ')}`)
      let lastErr = primaryErr
      for (const fb of fallbackChain) {
        try {
          send({ type: 'status', status: `retrying with ${fb} (OpenAI safety filter)` })
          imageUrl = await runProvider(fb)
          providerUsed = fb
          lastErr = null
          break
        } catch (e) { lastErr = e }
      }
      if (!imageUrl) throw new Error(`OpenAI safety rejection; fallbacks (${fallbackChain.join(', ')}) also failed: ${lastErr?.message || 'unknown'}`)
    }
    session.ads[adKey].imageSize = imgSize
    session.ads[adKey].imageQuality = imgQuality
    session.ads[adKey].imageUrl = imageUrl
    if (providerUsed !== provider) session.ads[adKey].imageProvider = providerUsed
    await saveSession(sessionId, session)
    send({ type: 'image', imageUrl, providerUsed: providerUsed !== provider ? providerUsed : undefined })
  } catch (e) {
    console.error('[rip-ad image gen failed]', e.message)
    if (imageCharged) await refundLastCharge(req)  // refund image only — copy charge stays
    send({ type: 'image', error: `${e.message} (image credits refunded)` })
  }

  cleanup()
  send({ type: 'done', adKey })
  res.end()
})

// Expose the format library to the client
app.get('/api/ad-formats', requireAuth, (req, res) => {
  res.json(AD_FORMATS.map(f => ({ id: f.id, name: f.name, funnel: f.funnel, needsProduct: f.needsProduct, description: f.description })))
})

// Meta's official CTA button options
app.get('/api/meta-ctas', requireAuth, (req, res) => {
  res.json(META_CTAS)
})

// ──────────────────────────────────────────────────────────────────────────
// Projects CRUD — every endpoint behind requireAuth.
// All queries use the service-role client (supabaseAdmin) and manually scope
// by req.user.id. RLS is a backstop, not the primary filter.
// ──────────────────────────────────────────────────────────────────────────

function slugifyName(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled'
}

async function uniqueSlug(userId, base) {
  // Append -2, -3, … if collision under same user_id (UNIQUE(user_id, slug)).
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`
    const { data, error } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('user_id', userId)
      .eq('slug', slug)
      .maybeSingle()
    if (error) throw error
    if (!data) return slug
  }
  return `${base}-${Date.now()}`
}

// List the signed-in user's projects (newest first).
app.get('/api/projects', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, name, slug, brand_name, created_at, updated_at')
    .eq('user_id', req.user.id)
    .order('updated_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json({ projects: data })
})

// Create a project. Body: { name }
// Enforces the user's plan project_limit before insert (Solo=1, Operator=3,
// Studio=15, Scale=999). Out-of-limit returns 402 with the limit so the UI
// can surface "Upgrade plan" CTA.
app.post('/api/projects', requireAuth, async (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Name required' })

  // Project limit check
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('plan').eq('id', req.user.id).single()
  const limits = getPlanLimits(profile?.plan)
  const { count } = await supabaseAdmin
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user.id)
  if ((count || 0) >= limits.projects) {
    return res.status(402).json({
      error: 'Project limit reached',
      code: 'PROJECT_LIMIT_REACHED',
      currentCount: count || 0,
      limit: limits.projects,
      plan: profile?.plan,
      planLabel: limits.label,
    })
  }

  const base = slugifyName(name)
  let slug
  try { slug = await uniqueSlug(req.user.id, base) }
  catch (e) { return res.status(500).json({ error: e.message }) }

  const { data, error } = await supabaseAdmin
    .from('projects')
    .insert({ user_id: req.user.id, name, slug })
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ project: data })
})

// Fetch one project (full row).
app.get('/api/projects/:id', requireAuth, async (req, res) => {
  const project = await requireProjectOwnership(req, res, req.params.id)
  if (!project) return
  res.json({ project })
})

// Rename. Body: { name }
app.patch('/api/projects/:id', requireAuth, async (req, res) => {
  const project = await requireProjectOwnership(req, res, req.params.id)
  if (!project) return
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Name required' })
  const { data, error } = await supabaseAdmin
    .from('projects')
    .update({ name })
    .eq('id', project.id)
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ project: data })
})

// Delete (FK cascade removes documents, brand_images, angles, ads).
app.delete('/api/projects/:id', requireAuth, async (req, res) => {
  const project = await requireProjectOwnership(req, res, req.params.id)
  if (!project) return
  const { error } = await supabaseAdmin.from('projects').delete().eq('id', project.id)
  if (error) return res.status(500).json({ error: error.message })
  invalidateSession(project.id)
  res.json({ ok: true })
})

// Clear all ads in a project — keeps angles, brief, brand assets intact.
// Used by the "Clear all ads" button when the user wants to regenerate
// fresh ads under updated angles or new prompt rules without leftover
// stale entries muddying the grid.
app.delete('/api/ads/:sessionId', requireAuth, async (req, res) => {
  const sessionId = req.params.sessionId
  if (!await requireSessionOwnership(req, res, sessionId)) return
  try {
    const session = await getSession(sessionId)
    const cleared = Object.keys(session.ads || {}).length
    session.ads = {}
    await saveSession(sessionId, session)
    res.json({ ok: true, cleared })
  } catch (e) {
    console.error('[clear-ads failed]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────
// /api/me — profile + plan + credits (read by every UI surface that
// shows the credit pill, profile popover, or per-action enable/disable
// state). Returned shape is the contract for client/src/lib/MeContext.
// ──────────────────────────────────────────────────────────────────────────
app.get('/api/me', requireAuth, async (req, res) => {
  const userId = req.user.id

  // Profile row (auto-created on signup by handle_new_user trigger).
  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, plan, credits_remaining, credits_reset_at, stripe_customer_id, created_at')
    .eq('id', userId)
    .single()
  if (pErr || !profile) return res.status(500).json({ error: pErr?.message || 'Profile missing' })

  // Project count (for limit display)
  const { count: projectCount } = await supabaseAdmin
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  const limits = getPlanLimits(profile.plan)

  res.json({
    user: {
      id: profile.id,
      email: profile.email,
    },
    plan: {
      key: profile.plan,
      label: limits.label,
      priceUsd: limits.priceUsd,
      monthlyCredits: limits.credits,
      projectLimit: limits.projects,
    },
    credits: {
      remaining: profile.credits_remaining,
      resetAt: profile.credits_reset_at,
    },
    projects: {
      count: projectCount || 0,
      limit: limits.projects,
    },
    stripeCustomerId: profile.stripe_customer_id || null,
    creditCosts: CREDIT_COSTS,  // sent so the client never has to hardcode
    isAdmin: isAdminEmail(profile.email),
  })
})

app.get('/api/me/credit-history', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200)
  const { data, error } = await supabaseAdmin
    .from('credit_ledger')
    .select('id, project_id, action, credits_used, real_cost_usd, ts, metadata')
    .eq('user_id', req.user.id)
    .order('ts', { ascending: false })
    .limit(limit)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ entries: data || [] })
})

// ──────────────────────────────────────────────────────────────────────────
// /api/admin/margin — admin-gated (req.user.email must match ADMIN_EMAIL
// in env). Returns per-user margin breakdown for the current month: revenue
// (price of plan), actual COGS (sum of real_cost_usd from credit_ledger),
// utilization, gross margin %. Lets us see real economics from day one.
// ──────────────────────────────────────────────────────────────────────────
app.get('/api/admin/margin', requireAuth, async (req, res) => {
  if (!requireAdmin(req, res)) return

  // Pull all profiles + this-month ledger entries
  const monthStart = new Date()
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)

  const [{ data: profiles }, { data: ledger }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, email, plan, credits_remaining, created_at'),
    supabaseAdmin.from('credit_ledger')
      .select('user_id, action, credits_used, real_cost_usd, ts')
      .gte('ts', monthStart.toISOString()),
  ])

  // Group ledger by user
  const byUser = {}
  for (const e of (ledger || [])) {
    const u = byUser[e.user_id] || (byUser[e.user_id] = { credits: 0, cogs: 0, calls: 0 })
    u.credits += e.credits_used || 0
    u.cogs += Number(e.real_cost_usd || 0)
    u.calls += 1
  }

  const STRIPE_PCT = 0.029
  const STRIPE_FLAT = 0.30

  const users = (profiles || []).map(p => {
    const limits = getPlanLimits(p.plan)
    const consumed = byUser[p.id]?.credits || 0
    const cogsActual = byUser[p.id]?.cogs || 0
    const calls = byUser[p.id]?.calls || 0
    const revenue = limits.priceUsd || 0
    const stripeFee = revenue > 0 ? revenue * STRIPE_PCT + STRIPE_FLAT : 0
    const netRevenue = revenue - stripeFee
    const grossMargin = revenue > 0
      ? ((netRevenue - cogsActual) / revenue) * 100
      : 0
    const utilization = limits.credits > 0 ? (consumed / limits.credits) * 100 : 0
    return {
      email: p.email,
      plan: p.plan,
      planLabel: limits.label,
      monthlyCredits: limits.credits,
      creditsConsumed: consumed,
      creditsRemaining: p.credits_remaining,
      utilizationPct: Number(utilization.toFixed(1)),
      revenueUsd: revenue,
      stripeFeeUsd: Number(stripeFee.toFixed(2)),
      cogsActualUsd: Number(cogsActual.toFixed(4)),
      grossMarginPct: Number(grossMargin.toFixed(1)),
      callsThisMonth: calls,
      createdAt: p.created_at,
    }
  })

  // Totals
  const totals = users.reduce((acc, u) => {
    acc.users += 1
    acc.revenueUsd += u.revenueUsd
    acc.stripeFeeUsd += u.stripeFeeUsd
    acc.cogsActualUsd += u.cogsActualUsd
    acc.creditsConsumed += u.creditsConsumed
    return acc
  }, { users: 0, revenueUsd: 0, stripeFeeUsd: 0, cogsActualUsd: 0, creditsConsumed: 0 })
  totals.grossMarginPct = totals.revenueUsd > 0
    ? Number((((totals.revenueUsd - totals.stripeFeeUsd - totals.cogsActualUsd) / totals.revenueUsd) * 100).toFixed(1))
    : 0
  totals.revenueUsd = Number(totals.revenueUsd.toFixed(2))
  totals.stripeFeeUsd = Number(totals.stripeFeeUsd.toFixed(2))
  totals.cogsActualUsd = Number(totals.cogsActualUsd.toFixed(4))

  res.json({
    monthStart: monthStart.toISOString(),
    totals,
    users: users.sort((a, b) => b.revenueUsd - a.revenueUsd),
    note: 'Margins calculated as (revenue - Stripe 2.9%+$0.30 - actual model COGS) / revenue. COGS is real Anthropic/OpenAI spend logged at deduction time.',
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Admin: comprehensive user list. Mirrors /admin/margin's per-user view but
// also includes credit_costs map, this-month action breakdown, and project
// list. Used by the admin page's user table.
// ──────────────────────────────────────────────────────────────────────────
app.get('/api/admin/users', requireAuth, async (req, res) => {
  if (!requireAdmin(req, res)) return

  const monthStart = new Date()
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)

  const [{ data: profiles, error: pErr }, { data: ledger, error: lErr }, { data: projects, error: prjErr }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, email, plan, credits_remaining, credits_reset_at, created_at, stripe_customer_id'),
    supabaseAdmin.from('credit_ledger').select('user_id, action, credits_used, real_cost_usd, ts').gte('ts', monthStart.toISOString()),
    supabaseAdmin.from('projects').select('id, user_id, name, created_at, updated_at'),
  ])
  if (pErr || lErr || prjErr) {
    return res.status(500).json({ error: (pErr || lErr || prjErr).message })
  }

  // Group ledger by user → totals + per-action breakdown + last activity ts
  const ledgerByUser = {}
  for (const e of (ledger || [])) {
    const u = ledgerByUser[e.user_id] || (ledgerByUser[e.user_id] = {
      creditsConsumed: 0, cogs: 0, calls: 0, lastActivity: 0, byAction: {},
    })
    const credits = e.credits_used || 0
    const cost = Number(e.real_cost_usd || 0)
    u.creditsConsumed += credits
    u.cogs += cost
    u.calls += 1
    if (e.ts && new Date(e.ts).getTime() > u.lastActivity) u.lastActivity = new Date(e.ts).getTime()
    if (!u.byAction[e.action]) u.byAction[e.action] = { credits: 0, cogs: 0, calls: 0 }
    u.byAction[e.action].credits += credits
    u.byAction[e.action].cogs += cost
    u.byAction[e.action].calls += 1
  }

  // Group projects by user
  const projectsByUser = {}
  for (const p of (projects || [])) {
    if (!projectsByUser[p.user_id]) projectsByUser[p.user_id] = []
    projectsByUser[p.user_id].push({ id: p.id, name: p.name, createdAt: p.created_at, updatedAt: p.updated_at })
  }

  const STRIPE_PCT = 0.029
  const STRIPE_FLAT = 0.30

  const users = (profiles || []).map(p => {
    const limits = getPlanLimits(p.plan)
    const stats = ledgerByUser[p.id] || { creditsConsumed: 0, cogs: 0, calls: 0, lastActivity: 0, byAction: {} }
    const userProjects = projectsByUser[p.id] || []
    const revenue = limits.priceUsd || 0
    const stripeFee = revenue > 0 ? revenue * STRIPE_PCT + STRIPE_FLAT : 0
    const netRevenue = revenue - stripeFee
    const grossMargin = revenue > 0 ? ((netRevenue - stats.cogs) / revenue) * 100 : 0
    const utilization = limits.credits > 0 ? (stats.creditsConsumed / limits.credits) * 100 : 0
    return {
      id: p.id,
      email: p.email,
      plan: p.plan,
      planLabel: limits.label,
      planPriceUsd: limits.priceUsd,
      monthlyCredits: limits.credits,
      projectLimit: limits.projects,
      creditsRemaining: p.credits_remaining,
      creditsResetAt: p.credits_reset_at,
      stripeCustomerId: p.stripe_customer_id || null,
      isAdmin: isAdminEmail(p.email),
      createdAt: p.created_at,
      // Month stats
      creditsConsumed: stats.creditsConsumed,
      utilizationPct: Number(utilization.toFixed(1)),
      cogsActualUsd: Number(stats.cogs.toFixed(4)),
      callsThisMonth: stats.calls,
      lastActivityTs: stats.lastActivity || null,
      revenueUsd: revenue,
      stripeFeeUsd: Number(stripeFee.toFixed(2)),
      grossMarginPct: Number(grossMargin.toFixed(1)),
      byAction: stats.byAction,
      // Projects
      projectCount: userProjects.length,
      projects: userProjects,
    }
  })

  // Totals
  const totals = users.reduce((acc, u) => {
    acc.users += 1
    if (u.lastActivityTs) acc.activeUsers += 1
    acc.revenueUsd += u.revenueUsd
    acc.stripeFeeUsd += u.stripeFeeUsd
    acc.cogsActualUsd += u.cogsActualUsd
    acc.creditsConsumed += u.creditsConsumed
    acc.creditsRemaining += u.creditsRemaining || 0
    acc.callsThisMonth += u.callsThisMonth
    return acc
  }, { users: 0, activeUsers: 0, revenueUsd: 0, stripeFeeUsd: 0, cogsActualUsd: 0, creditsConsumed: 0, creditsRemaining: 0, callsThisMonth: 0 })
  totals.netRevenueUsd = Number((totals.revenueUsd - totals.stripeFeeUsd).toFixed(2))
  totals.grossProfitUsd = Number((totals.revenueUsd - totals.stripeFeeUsd - totals.cogsActualUsd).toFixed(2))
  totals.grossMarginPct = totals.revenueUsd > 0
    ? Number((((totals.revenueUsd - totals.stripeFeeUsd - totals.cogsActualUsd) / totals.revenueUsd) * 100).toFixed(1))
    : 0
  totals.revenueUsd = Number(totals.revenueUsd.toFixed(2))
  totals.stripeFeeUsd = Number(totals.stripeFeeUsd.toFixed(2))
  totals.cogsActualUsd = Number(totals.cogsActualUsd.toFixed(4))

  res.json({
    monthStart: monthStart.toISOString(),
    totals,
    users: users.sort((a, b) => (b.lastActivityTs || 0) - (a.lastActivityTs || 0)),
    plans: PLAN_LIMITS,
    creditCosts: CREDIT_COSTS,
    pricing: PRICING,
  })
})

// Single user: full credit ledger (last 200 entries) + their profile snapshot.
app.get('/api/admin/users/:id/ledger', requireAuth, async (req, res) => {
  if (!requireAdmin(req, res)) return
  const limit = Math.min(parseInt(req.query.limit) || 200, 500)
  const { data, error } = await supabaseAdmin
    .from('credit_ledger')
    .select('id, project_id, action, credits_used, real_cost_usd, ts, metadata')
    .eq('user_id', req.params.id)
    .order('ts', { ascending: false })
    .limit(limit)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ entries: data || [] })
})

// Grant or revoke credits manually. Body: { credits: int, reason: string }.
// Positive → grants credits (logs as "admin-grant:<reason>"). Negative →
// revokes (logs as "admin-revoke:<reason>"). The ledger row is tagged with
// the admin's email in metadata so the audit trail is complete.
app.post('/api/admin/users/:id/credits', requireAuth, async (req, res) => {
  if (!requireAdmin(req, res)) return
  const { credits, reason } = req.body || {}
  const n = Number(credits)
  if (!Number.isFinite(n) || n === 0) {
    return res.status(400).json({ error: 'credits must be a non-zero number' })
  }
  if (Math.abs(n) > 100000) {
    return res.status(400).json({ error: 'credits magnitude capped at 100,000 per call' })
  }
  const reasonStr = String(reason || '').slice(0, 200) || 'no reason given'
  const action = n > 0 ? `admin-grant:${reasonStr.slice(0, 50)}` : `admin-revoke:${reasonStr.slice(0, 50)}`

  // deduct_credits with negative p_credits adds credits (mirror of refund).
  // Positive p_credits removes them. So flip the sign.
  const sqlAmount = -n
  const { data, error } = await supabaseAdmin.rpc('deduct_credits', {
    p_user_id: req.params.id,
    p_project_id: null,
    p_action: action,
    p_credits: sqlAmount,
    p_real_cost: null,
    p_metadata: { adminEmail: req.user.email, reason: reasonStr, granted: n },
  })
  if (error) {
    if (error.code === 'P0001') return res.status(404).json({ error: 'User not found' })
    if (error.code === 'P0002') return res.status(400).json({ error: 'Revoke would put balance below 0' })
    return res.status(500).json({ error: error.message })
  }
  res.json({ ok: true, newBalance: data, granted: n, reason: reasonStr })
})

// Change a user's plan. Body: { plan: 'free'|'solo'|'operator'|'studio'|'scale' }.
// Just updates the plan key — does NOT reset credits_remaining (that happens
// on the monthly reset cycle / Stripe webhook). For one-off grants, use the
// /credits endpoint above.
app.patch('/api/admin/users/:id/plan', requireAuth, async (req, res) => {
  if (!requireAdmin(req, res)) return
  const { plan } = req.body || {}
  const allowed = ['free', 'solo', 'operator', 'studio', 'scale']
  if (!allowed.includes(plan)) {
    return res.status(400).json({ error: `plan must be one of: ${allowed.join(', ')}` })
  }
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ plan })
    .eq('id', req.params.id)
    .select('id, email, plan')
    .single()
  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'User not found' })

  // Audit row in credit_ledger so the admin action shows up in history.
  await supabaseAdmin.rpc('deduct_credits', {
    p_user_id: req.params.id,
    p_project_id: null,
    p_action: `admin-plan-change:${plan}`,
    p_credits: 0,
    p_real_cost: null,
    p_metadata: { adminEmail: req.user.email, newPlan: plan },
  }).catch(() => {})  // non-fatal — plan was already changed

  res.json({ ok: true, user: data })
})

// Cost breakdown by model + by source for the current month. Helps see
// where COGS is concentrated (e.g. "OpenAI image gen is 70% of spend").
app.get('/api/admin/cost-breakdown', requireAuth, async (req, res) => {
  if (!requireAdmin(req, res)) return
  const monthStart = new Date()
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)

  const { data: ledger, error } = await supabaseAdmin
    .from('credit_ledger')
    .select('action, credits_used, real_cost_usd, ts, metadata')
    .gte('ts', monthStart.toISOString())
  if (error) return res.status(500).json({ error: error.message })

  const byAction = {}
  let totalCogs = 0, totalCredits = 0, totalCalls = 0
  for (const e of (ledger || [])) {
    const credits = e.credits_used || 0
    const cost = Number(e.real_cost_usd || 0)
    totalCogs += cost
    totalCredits += credits
    totalCalls += 1
    if (!byAction[e.action]) byAction[e.action] = { credits: 0, cogs: 0, calls: 0 }
    byAction[e.action].credits += credits
    byAction[e.action].cogs += cost
    byAction[e.action].calls += 1
  }

  const sortedActions = Object.entries(byAction)
    .map(([action, v]) => ({
      action,
      credits: v.credits,
      cogsUsd: Number(v.cogs.toFixed(4)),
      calls: v.calls,
      avgCogsPerCallUsd: v.calls > 0 ? Number((v.cogs / v.calls).toFixed(4)) : 0,
      shareOfCogsPct: totalCogs > 0 ? Number(((v.cogs / totalCogs) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.cogsUsd - a.cogsUsd)

  res.json({
    monthStart: monthStart.toISOString(),
    totals: {
      cogsUsd: Number(totalCogs.toFixed(4)),
      credits: totalCredits,
      calls: totalCalls,
      avgCogsPerCreditUsd: totalCredits > 0 ? Number((totalCogs / totalCredits).toFixed(4)) : 0,
    },
    actions: sortedActions,
  })
})

// Usage / cost tracking — gated behind Supabase Auth.
// (Phase 1 first wired endpoint; sets the pattern for project-scoping the rest.)
app.get('/api/usage', requireAuth, (req, res) => {
  const u = readUsage()
  const now = Date.now()
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const since24h = now - 86_400_000

  const total = { cost: 0, input: 0, output: 0, images: 0, calls: 0 }
  const today = { cost: 0, calls: 0 }
  const last24h = { cost: 0, calls: 0 }
  const byModel = {}
  const bySource = {}

  for (const e of u.entries) {
    total.cost += e.cost
    total.input += e.inputTokens || 0
    total.output += e.outputTokens || 0
    total.images += e.images || 0
    total.calls += 1
    if (e.ts >= todayStart.getTime()) { today.cost += e.cost; today.calls += 1 }
    if (e.ts >= since24h)            { last24h.cost += e.cost; last24h.calls += 1 }

    if (!byModel[e.model]) byModel[e.model] = { cost: 0, calls: 0, input: 0, output: 0, images: 0 }
    byModel[e.model].cost += e.cost
    byModel[e.model].calls += 1
    byModel[e.model].input += e.inputTokens || 0
    byModel[e.model].output += e.outputTokens || 0
    byModel[e.model].images += e.images || 0

    if (!bySource[e.source]) bySource[e.source] = { cost: 0, calls: 0 }
    bySource[e.source].cost += e.cost
    bySource[e.source].calls += 1
  }

  // Last 20 entries for an activity feed
  const recent = u.entries.slice(-20).reverse()

  res.json({
    total, today, last24h, byModel, bySource, recent,
    pricing: PRICING,
    note: 'Estimates based on public rate cards. Real billing may differ.',
  })
})

app.post('/api/usage/reset', requireAuth, (req, res) => {
  writeUsage({ entries: [] })
  res.json({ ok: true })
})

// Observed image-gen durations by quality, computed from the usage ledger.
// Used by the UI to show real estimates next to each quality option.
app.get('/api/usage/timing', requireAuth, (req, res) => {
  const u = readUsage()
  const buckets = { low: [], medium: [], high: [] }
  for (const e of u.entries) {
    if (e.source !== 'generate-ad-image' || !e.durationMs || !e.quality) continue
    if (buckets[e.quality]) buckets[e.quality].push(e.durationMs)
  }
  const stat = (arr) => {
    if (!arr.length) return null
    const sorted = [...arr].sort((a, b) => a - b)
    return {
      n: arr.length,
      avgSec: Math.round(arr.reduce((s, x) => s + x, 0) / arr.length / 1000),
      p50Sec: Math.round(sorted[Math.floor(sorted.length / 2)] / 1000),
      p90Sec: Math.round(sorted[Math.floor(sorted.length * 0.9)] / 1000),
    }
  }
  // Conservative defaults if no data yet (rough OpenAI gpt-image-2 ranges)
  const defaults = {
    low:    { avgSec: 8,  p50Sec: 7,  p90Sec: 12, n: 0, isDefault: true },
    medium: { avgSec: 22, p50Sec: 20, p90Sec: 35, n: 0, isDefault: true },
    high:   { avgSec: 55, p50Sec: 50, p90Sec: 80, n: 0, isDefault: true },
  }
  res.json({
    low:    stat(buckets.low)    || defaults.low,
    medium: stat(buckets.medium) || defaults.medium,
    high:   stat(buckets.high)   || defaults.high,
  })
})

// Get the raw scraped website content + manual offers (for inspection in the UI)
app.get('/api/website-content/:sessionId', requireAuth, async (req, res) => {
  if (!await requireSessionOwnership(req, res, req.params.sessionId)) return
  const session = await getSession(req.params.sessionId)
  res.json({
    websiteContent: session.websiteContent || null,
    manualOffers: session.manualOffers || [],
  })
})

// Manual offers — when the static crawler can't see Kaching/Rebuy/custom-liquid pricing
app.post('/api/manual-offers', requireAuth, async (req, res) => {
  if (!await requireSessionOwnership(req, res, req.body.sessionId)) return
  const { sessionId, offers } = req.body
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })
  if (!Array.isArray(offers)) return res.status(400).json({ error: 'offers must be an array of strings' })
  const session = await getSession(sessionId)
  session.manualOffers = offers.filter(o => typeof o === 'string' && o.trim()).map(o => o.trim())
  await saveSession(sessionId, session)
  res.json({ ok: true, manualOffers: session.manualOffers })
})

// Get session state
app.get('/api/session/:sessionId', requireAuth, async (req, res) => {
  if (!await requireSessionOwnership(req, res, req.params.sessionId)) return
  const session = await getSession(req.params.sessionId)
  res.json({
    documents: session.documents.map(d => d.name),
    brandColors: session.brandColors || [],
    brandImages: (session.brandImages || []).map(a => ({ name: a.name, type: a.type, colors: a.colors, dataUrl: a.dataUrl, higgsfieldUrl: a.higgsfieldUrl || null })),
    brandName: session.brandName || '',
    brandBrief: session.brandBrief || null,
    angles: session.angles || [],
    ads: session.ads || {},
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Stripe billing
// ──────────────────────────────────────────────────────────────────────────

// Where Stripe redirects after checkout. Override via env if frontend is
// deployed somewhere other than the same origin as the API.
const APP_URL = process.env.APP_URL || 'http://localhost:3000'

// POST /api/billing/checkout
// Body (subscription): { type: 'subscription', planKey: 'solo'|'operator'|'studio' }
// Body (top-up):       { type: 'topup', packKey: 'topup_100'|'topup_500'|'topup_1500' }
// Returns: { url } — the Stripe Checkout hosted URL. Client redirects to it.
app.post('/api/billing/checkout', requireAuth, async (req, res) => {
  const { type, planKey, packKey } = req.body
  if (!type) return res.status(400).json({ error: 'type required' })

  // Resolve which Stripe price to charge + what mode to use.
  let priceId, mode, metadata
  if (type === 'subscription') {
    priceId = priceForPlan(planKey)
    if (!priceId) return res.status(400).json({ error: `Unknown plan: ${planKey}` })
    mode = 'subscription'
    metadata = { type: 'subscription', plan_key: planKey }
  } else if (type === 'topup') {
    priceId = priceForTopup(packKey)
    if (!priceId) return res.status(400).json({ error: `Unknown pack: ${packKey}` })
    const pack = TOPUP_PACKS[packKey]
    mode = 'payment'
    metadata = { type: 'topup', pack_key: packKey, credits: String(pack?.credits || 0) }
  } else {
    return res.status(400).json({ error: 'type must be "subscription" or "topup"' })
  }

  // Get-or-create Stripe customer for this user
  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, stripe_customer_id')
    .eq('id', req.user.id)
    .single()
  if (pErr || !profile) return res.status(500).json({ error: 'Profile lookup failed' })

  const customerId = await getOrCreateCustomer(profile, supabaseAdmin)

  try {
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.create({
      mode,
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_URL}/?checkout=success&type=${type}`,
      cancel_url: `${APP_URL}/?checkout=cancel`,
      metadata: { ...metadata, supabase_user_id: req.user.id },
      // Stripe will pass the same metadata back on the resulting subscription
      // object, so the webhook can read it to know which plan.
      subscription_data: mode === 'subscription'
        ? { metadata: { ...metadata, supabase_user_id: req.user.id } }
        : undefined,
    })
    res.json({ url: session.url })
  } catch (e) {
    console.error('[checkout]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/billing/portal
// Returns: { url } — Stripe Customer Portal for managing existing subscription
// (cancel, swap plan, update card). Requires the user to have a customer ID
// (gets created on first checkout).
app.post('/api/billing/portal', requireAuth, async (req, res) => {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', req.user.id)
    .single()
  if (!profile?.stripe_customer_id) {
    return res.status(400).json({ error: 'No Stripe customer yet — start a subscription first' })
  }
  try {
    const stripe = getStripe()
    const portal = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${APP_URL}/`,
    })
    res.json({ url: portal.url })
  } catch (e) {
    console.error('[portal]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────────
// Stripe webhook handler (registered above with express.raw, BEFORE json).
// Events handled:
//   - checkout.session.completed: top-ups (mode=payment) credit immediately;
//       subscriptions are handled via invoice.paid below.
//   - invoice.paid: monthly subscription renewal (and the FIRST charge after
//       subscription create). Sets plan + resets credits to plan's monthly
//       allotment + pushes credits_reset_at out 30 days.
//   - customer.subscription.updated: plan change mid-cycle. Updates plan key.
//   - customer.subscription.deleted: cancellation took effect. Drop to free.
// ──────────────────────────────────────────────────────────────────────────
async function webhookHandler(req, res) {
  const sig = req.headers['stripe-signature']
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET not set — rejecting')
    return res.status(500).send('Webhook secret not configured')
  }

  let event
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, secret)
  } catch (e) {
    console.error('[webhook] Signature verification failed:', e.message)
    return res.status(400).send(`Webhook Error: ${e.message}`)
  }

  console.log(`[webhook] ${event.type} (${event.id})`)

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object
        // Top-ups are mode='payment' (one-time). Subscriptions are
        // mode='subscription' but credits get applied via invoice.paid below.
        if (s.mode === 'payment') {
          await handleTopupCompleted(s)
        }
        break
      }
      case 'invoice.paid': {
        await handleInvoicePaid(event.data.object)
        break
      }
      case 'customer.subscription.updated': {
        await handleSubscriptionUpdated(event.data.object)
        break
      }
      case 'customer.subscription.deleted': {
        await handleSubscriptionDeleted(event.data.object)
        break
      }
      default:
        // Ignore other events — Stripe sends a lot we don't need.
        break
    }
    res.json({ received: true })
  } catch (e) {
    console.error(`[webhook] ${event.type} handler failed:`, e)
    // Return 500 so Stripe retries
    res.status(500).json({ error: e.message })
  }
}

// Look up the Supabase user id from a Stripe customer id, falling back to
// the metadata.supabase_user_id we attached during checkout.
async function userIdFromStripeCustomer(stripeCustomerId, fallbackMetaUserId) {
  if (fallbackMetaUserId) return fallbackMetaUserId
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle()
  return data?.id || null
}

async function handleTopupCompleted(checkoutSession) {
  const { metadata, customer, amount_total } = checkoutSession
  const userId = await userIdFromStripeCustomer(customer, metadata?.supabase_user_id)
  if (!userId) {
    console.error('[webhook topup] cannot resolve user for customer', customer)
    return
  }
  const packKey = metadata?.pack_key
  const pack = TOPUP_PACKS[packKey]
  if (!pack) {
    console.error('[webhook topup] unknown pack_key:', packKey)
    return
  }

  // Add credits to existing balance (top-ups stack on top of monthly pool)
  const { data: prof } = await supabaseAdmin
    .from('profiles').select('credits_remaining').eq('id', userId).single()
  const newBalance = (prof?.credits_remaining || 0) + pack.credits
  await supabaseAdmin
    .from('profiles')
    .update({ credits_remaining: newBalance })
    .eq('id', userId)

  // Log the top-up as a positive entry in the ledger (credits_used is
  // negative for grants — convention).
  await supabaseAdmin.from('credit_ledger').insert({
    user_id: userId,
    action: `topup:${packKey}`,
    credits_used: -pack.credits,
    real_cost_usd: -((amount_total || 0) / 100),
    metadata: { stripe_checkout_id: checkoutSession.id },
  })

  console.log(`[webhook topup] +${pack.credits} cr → user ${userId} (now ${newBalance})`)
}

async function handleInvoicePaid(invoice) {
  // For subscription invoices (and the initial charge), refill the user's
  // credits to the plan's monthly amount. Only handle subscription invoices.
  if (!invoice.subscription) return

  const stripe = getStripe()
  // Re-fetch the subscription to get its current price + metadata
  const sub = await stripe.subscriptions.retrieve(invoice.subscription)
  const priceId = sub.items.data[0]?.price?.id
  const planKey = planKeyForPrice(priceId)
  if (!planKey) {
    console.error('[webhook invoice.paid] unknown price:', priceId)
    return
  }
  const limits = getPlanLimits(planKey)

  const userId = await userIdFromStripeCustomer(invoice.customer, sub.metadata?.supabase_user_id)
  if (!userId) {
    console.error('[webhook invoice.paid] cannot resolve user for customer', invoice.customer)
    return
  }

  // Reset credits + push reset date out 30 days. We REPLACE the balance
  // rather than add, because each invoice is a fresh month — but if the
  // user has any unspent top-ups, we preserve them by adding monthly
  // credits to their existing balance only when it's already zero.
  // Decision: always replace to plan amount on renewal. If users want
  // top-ups not to lapse, top-ups should be tracked separately (later).
  const resetAt = new Date()
  resetAt.setDate(resetAt.getDate() + 30)

  await supabaseAdmin
    .from('profiles')
    .update({
      plan: planKey,
      credits_remaining: limits.credits,
      credits_reset_at: resetAt.toISOString(),
    })
    .eq('id', userId)

  await supabaseAdmin.from('credit_ledger').insert({
    user_id: userId,
    action: `renewal:${planKey}`,
    credits_used: -limits.credits,
    real_cost_usd: -(invoice.amount_paid || 0) / 100,
    metadata: { stripe_invoice_id: invoice.id, stripe_subscription_id: sub.id },
  })

  console.log(`[webhook invoice.paid] user ${userId} → plan=${planKey}, ${limits.credits} cr`)
}

async function handleSubscriptionUpdated(sub) {
  // Plan change mid-cycle. Update plan key only — credits get adjusted on
  // the next invoice.paid (Stripe will issue a prorated invoice for upgrades).
  const priceId = sub.items.data[0]?.price?.id
  const planKey = planKeyForPrice(priceId)
  if (!planKey) return

  const userId = await userIdFromStripeCustomer(sub.customer, sub.metadata?.supabase_user_id)
  if (!userId) return

  await supabaseAdmin
    .from('profiles')
    .update({ plan: planKey })
    .eq('id', userId)

  console.log(`[webhook sub.updated] user ${userId} → plan=${planKey}`)
}

async function handleSubscriptionDeleted(sub) {
  // Cancellation took effect (after period end). Drop to free plan.
  const userId = await userIdFromStripeCustomer(sub.customer, sub.metadata?.supabase_user_id)
  if (!userId) return

  await supabaseAdmin
    .from('profiles')
    .update({ plan: 'free' })
    .eq('id', userId)

  console.log(`[webhook sub.deleted] user ${userId} → free`)
}

// Global error handler — catches anything thrown synchronously / passed to
// next(err) by an Express handler. In prod (NODE_ENV=production) we only
// return a generic message so stack traces don't leak. Always logs the
// real error server-side for debugging.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  console.error(`[unhandled] ${req.method} ${req.path}:`, err)
  const isProd = process.env.NODE_ENV === 'production'
  res.status(err.status || 500).json({
    error: isProd ? 'Internal server error' : (err.message || 'Internal server error'),
  })
})

// Health check — useful for Railway/Fly health monitoring.
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }))

const server = app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))

// Graceful shutdown: flush any pending session saves before the process exits
// so a Railway redeploy doesn't drop the last debounce window of edits.
async function gracefulShutdown(signal) {
  console.log(`[shutdown] ${signal} received — flushing pending saves`)
  try { await flushAllPending() } catch (e) { console.error('[shutdown] flush error:', e.message) }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

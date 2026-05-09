// Export helpers for batch-generated ads.
//
// Two operations:
//   1. downloadAllImages(ads, formats, brandName)
//        → ZIP with one PNG per completed ad, named "<angle-name>__<format>.png"
//   2. exportCopyAsPdf(ads, formats, brandName)
//        → PDF with one labeled block per completed ad (angle / headline /
//          description / primary text / CTA), ready to copy into Meta.
//
// Both are client-side only (no server round-trip beyond fetching the image
// blobs) so they're fast and don't hit Railway. JSZip + jsPDF together add
// ~250KB gzipped to the bundle, but they're tree-shaken away on routes that
// don't import this file.

import JSZip from 'jszip'
import jsPDF from 'jspdf'

// Resolve a possibly-relative image URL to a full URL the browser can fetch.
//   - Absolute URLs (http://, https://) pass through unchanged. Used for
//     Supabase Storage public URLs and any other CDN.
//   - Relative /api/... paths (legacy local-disk image URLs from before the
//     Supabase Storage migration) resolve against VITE_API_URL when set,
//     otherwise stay relative so Vite's dev proxy handles them.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
function resolveImageUrl(input) {
  if (typeof input !== 'string') return input
  if (/^https?:\/\//i.test(input)) return input
  if (API_BASE && input.startsWith('/api/')) return API_BASE + input
  return input
}

// Fetch a public image URL WITHOUT an Authorization header. Important: the
// Supabase Storage public URL responds 200 to any GET, but adding an
// Authorization header (which authedFetch does) triggers a CORS preflight
// that Supabase doesn't whitelist for public buckets — so the request gets
// blocked before it even hits the server. Plain fetch avoids the preflight.
async function fetchImageBlob(url) {
  const res = await fetch(resolveImageUrl(url))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.blob()
}

// Slugify a string for use in a filename. Strips accents, lowercases,
// replaces non-alphanumerics with hyphens, collapses repeats.
function slugify(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'ad'
}

// Today's date as YYYY-MM-DD for filenames
function dateStamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Trigger a browser download of a Blob with a given filename.
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Free the blob URL on next tick — some browsers need the click to land first
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Build a list of {ad, angle, format} bundles for ads that have a finished
// imageUrl. Skips drafts, errored ads, and ads where the angle/format lookups
// fail (defensive — shouldn't happen in normal flows).
function collectFinishedAds(ads, angles, formats) {
  const angleById = new Map(angles.map(a => [a.id, a]))
  const formatById = new Map(formats.map(f => [f.id, f]))
  const bundles = []
  for (const [adKey, ad] of Object.entries(ads || {})) {
    if (!ad?.imageUrl) continue
    const angle = angleById.get(ad.angleId)
    const format = formatById.get(ad.formatId)
    if (!angle || !format) continue
    bundles.push({ adKey, ad, angle, format })
  }
  return bundles
}

// Download all completed ads' images as a single ZIP. Files are named
// "<angle-slug>__<format-slug>.png". Returns { downloaded: N, failed: N }
// after the zip is offered to the user.
export async function downloadAllImages(ads, angles, formats, brandName = '') {
  const bundles = collectFinishedAds(ads, angles, formats)
  if (!bundles.length) {
    throw new Error('No finished ads with images yet.')
  }

  const zip = new JSZip()
  const usedNames = new Set()
  let downloaded = 0
  let failed = 0

  for (const { ad, angle, format } of bundles) {
    // Each PNG keyed by angle+format slug. Disambiguate with -2/-3 if a
    // name collides (e.g. same angle generated twice on the same format).
    let base = `${slugify(angle.avatar || `angle-${angle.id}`)}__${slugify(format.id)}`
    let name = `${base}.png`
    let n = 1
    while (usedNames.has(name)) { n++; name = `${base}-${n}.png` }
    usedNames.add(name)

    try {
      const blob = await fetchImageBlob(ad.imageUrl)
      zip.file(name, blob)
      downloaded++
    } catch (e) {
      console.warn(`[export] image fetch failed for ${name} (${ad.imageUrl}):`, e.message)
      failed++
    }
  }

  if (downloaded === 0) {
    // Diagnose: are these legacy /api/generated/ URLs (Railway-disk-wiped)
    // or Supabase Storage URLs (would mean a real bug)? The hint guides the
    // user to the right next action without bouncing them to dev tools.
    const allLegacy = bundles.every(b => /^\/?api\/generated\//i.test(b.ad.imageUrl || ''))
    const hint = allLegacy
      ? 'These ads were generated before May 4 and their images were lost in a Railway redeploy. Click ↺ Regenerate Image on each ad to re-create them.'
      : 'Open browser console (Cmd+Opt+J) for the underlying error.'
    throw new Error(`All image downloads failed. ${hint}`)
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  const fname = `${slugify(brandName) || 'hermes'}-images-${dateStamp()}.zip`
  triggerDownload(zipBlob, fname)
  return { downloaded, failed }
}

// Build a PDF of all finished ads' copy. One ad per "block" with these
// labeled fields in the requested order:
//   ANGLE → HEADLINE → DESCRIPTION → PRIMARY TEXT → CTA
// Pages break naturally; long primary text wraps and continues on the next
// page when needed. Returns the count of ads written.
export function exportCopyAsPdf(ads, angles, formats, brandName = '') {
  const bundles = collectFinishedAds(ads, angles, formats)
  // Also include ads that have copy but no image — copy export shouldn't
  // require image to be done, only copy. Override the filter:
  const angleById = new Map(angles.map(a => [a.id, a]))
  const formatById = new Map(formats.map(f => [f.id, f]))
  const copyBundles = []
  for (const [adKey, ad] of Object.entries(ads || {})) {
    if (!ad?.headline && !ad?.primaryText) continue  // need at least some copy
    const angle = angleById.get(ad.angleId)
    const format = formatById.get(ad.formatId)
    if (!angle || !format) continue
    copyBundles.push({ adKey, ad, angle, format })
  }

  if (!copyBundles.length) {
    throw new Error('No ad copy generated yet.')
  }

  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 56                    // ~3/4 inch
  const maxW = pageW - margin * 2
  let y = margin

  // ── Header
  doc.setFont('helvetica', 'bold').setFontSize(20)
  doc.text(`${brandName || 'Hermes'} — Ad Copy`, margin, y)
  y += 24
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(120)
  doc.text(`${copyBundles.length} ads · exported ${new Date().toLocaleDateString()}`, margin, y)
  doc.setTextColor(0)
  y += 28

  const ensureSpace = (need) => {
    if (y + need > pageH - margin) {
      doc.addPage()
      y = margin
    }
  }

  const drawSectionLabel = (label) => {
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(110)
    doc.text(label.toUpperCase(), margin, y)
    doc.setTextColor(0)
    y += 12
  }

  const drawWrapped = (text, { size = 11, bold = false } = {}) => {
    if (!text) return
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size)
    const lines = doc.splitTextToSize(String(text), maxW)
    for (const line of lines) {
      ensureSpace(size + 4)
      doc.text(line, margin, y)
      y += size + 4
    }
  }

  for (let i = 0; i < copyBundles.length; i++) {
    const { ad, angle, format } = copyBundles[i]

    ensureSpace(120)

    // Divider between ads
    if (i > 0) {
      doc.setDrawColor(220).setLineWidth(0.5)
      doc.line(margin, y, pageW - margin, y)
      doc.setDrawColor(0)
      y += 18
    }

    // ── ANGLE
    drawSectionLabel('Angle')
    drawWrapped(angle.avatar || `Angle ${angle.id}`, { size: 14, bold: true })
    doc.setTextColor(140).setFont('helvetica', 'normal').setFontSize(9)
    doc.text(`${format.name} · ${(angle.funnelStage || '').toUpperCase()}`, margin, y)
    doc.setTextColor(0)
    y += 18

    // ── HEADLINE
    drawSectionLabel('Headline')
    drawWrapped(ad.headline || '(no headline)', { size: 13, bold: true })
    y += 4

    // ── DESCRIPTION
    drawSectionLabel('Description')
    drawWrapped(ad.description || '(no description)', { size: 11 })
    y += 4

    // ── PRIMARY TEXT
    drawSectionLabel('Primary text')
    drawWrapped(ad.primaryText || '(no primary text)', { size: 11 })
    y += 4

    // ── CTA
    drawSectionLabel('CTA button')
    drawWrapped(ad.ctaButton || '(no CTA)', { size: 11 })
    y += 18
  }

  const fname = `${slugify(brandName) || 'hermes'}-copy-${dateStamp()}.pdf`
  doc.save(fname)
  return { written: copyBundles.length }
}

import React, { useEffect, useRef, useState } from 'react'
import { authedFetch } from '../lib/supabase.js'
import './BrandPanel.css'

// User-facing types: only Logo / Product. Server still accepts 'lifestyle'
// for backward compat — existing 'lifestyle'-tagged images render as Product
// in the UI (treated identically downstream as a non-logo reference image).
const TYPES = ['logo', 'product']
const TYPE_LABEL = { logo: 'Logo', product: 'Product' }

function ScrapedDataInspector({ data }) {
  const wc = data?.websiteContent
  const manual = data?.manualOffers || []

  if (!wc && !manual.length) {
    return <div className="inspector-empty">Nothing scraped yet. Crawl a brand site above to populate this.</div>
  }

  // Detect legacy single-page format (pre multi-page rewrite). Show a hint to re-scrape.
  const isLegacyFormat = wc && !wc.homepage && !wc.platform && (wc.title || wc.bodyExcerpt)
  if (isLegacyFormat) {
    return (
      <div className="inspector-panel">
        <div className="inspector-section">
          <div className="inspector-h">⚠ Legacy scrape data</div>
          <div style={{ color: '#facc15', fontSize: 11, lineHeight: 1.5 }}>
            This session was scraped with the old single-page format. Re-run the crawler to get the full multi-page catalog, prices, and offers.
          </div>
        </div>
        <div className="inspector-section">
          <div className="inspector-h">Raw data</div>
          <pre className="inspector-pre">{JSON.stringify(wc, null, 2).slice(0, 3000)}</pre>
        </div>
        {manual.length > 0 && (
          <div className="inspector-section">
            <div className="inspector-h">Manual Offers ({manual.length})</div>
            <ul className="inspector-list">{manual.map((o, i) => <li key={i}>{o}</li>)}</ul>
          </div>
        )}
      </div>
    )
  }

  const products = wc?.products || []
  const pages = wc?.pages || []
  const home = wc?.homepage

  return (
    <div className="inspector-panel">
      {wc && (
        <>
          <div className="inspector-section">
            <div className="inspector-h">Source</div>
            <div className="inspector-row"><span>URL</span><code>{wc.sourceUrl}</code></div>
            <div className="inspector-row"><span>Platform</span><code>{wc.platform}</code></div>
          </div>

          {wc.allOffers?.length > 0 && (
            <div className="inspector-section">
              <div className="inspector-h">All Offer Signals ({wc.allOffers.length})</div>
              <ul className="inspector-list">
                {wc.allOffers.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </div>
          )}

          {wc.allPrices?.length > 0 && (
            <div className="inspector-section">
              <div className="inspector-h">All Prices Found ({wc.allPrices.length})</div>
              <div className="inspector-chips">
                {wc.allPrices.map((p, i) => <span key={i} className="inspector-chip">{p}</span>)}
              </div>
            </div>
          )}

          {products.length > 0 && (
            <div className="inspector-section">
              <div className="inspector-h">Shopify Catalog ({products.length})</div>
              <div className="inspector-products">
                {products.map((p, i) => {
                  const price = p.priceRange
                    ? (p.priceRange.min === p.priceRange.max ? `$${p.priceRange.min}` : `$${p.priceRange.min}–$${p.priceRange.max}`)
                    : 'n/a'
                  return (
                    <div key={i} className="inspector-product">
                      <div className="inspector-product-head">
                        <strong>{p.title}</strong>
                        <span className="inspector-price">{price}{p.onSale ? ' 🔖 SALE' : ''}</span>
                      </div>
                      {p.productType && <div className="inspector-meta">{p.productType}</div>}
                      {p.variants?.length > 1 && (
                        <div className="inspector-variants">
                          {p.variants.slice(0, 8).map((v, j) => (
                            <span key={j} className="inspector-variant">
                              {v.title}: ${v.price}{v.compareAtPrice ? ` (was $${v.compareAtPrice})` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                      {p.description && <div className="inspector-desc">{p.description.slice(0, 200)}{p.description.length > 200 ? '…' : ''}</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {home && (
            <div className="inspector-section">
              <div className="inspector-h">Homepage</div>
              <div className="inspector-row"><span>Title</span><code>{home.title || '—'}</code></div>
              {home.metaDescription && <div className="inspector-row"><span>Meta</span><code className="inspector-truncate">{home.metaDescription}</code></div>}
              {home.headings?.length > 0 && (
                <details>
                  <summary>{home.headings.length} headings</summary>
                  <ul className="inspector-list">{home.headings.map((h, i) => <li key={i}>{h}</li>)}</ul>
                </details>
              )}
              {home.buttonsAndCtas?.length > 0 && (
                <details>
                  <summary>{home.buttonsAndCtas.length} buttons / CTAs</summary>
                  <div className="inspector-chips">
                    {home.buttonsAndCtas.map((b, i) => <span key={i} className="inspector-chip">{b}</span>)}
                  </div>
                </details>
              )}
              {home.bodyExcerpt && (
                <details>
                  <summary>Body excerpt ({home.bodyExcerpt.length} chars)</summary>
                  <pre className="inspector-pre">{home.bodyExcerpt}</pre>
                </details>
              )}
            </div>
          )}

          {pages.length > 0 && (
            <div className="inspector-section">
              <div className="inspector-h">Other Pages Crawled ({pages.length})</div>
              {pages.map((p, i) => (
                <details key={i} className="inspector-page">
                  <summary>
                    <strong>{p.title || '(untitled)'}</strong>
                    <span className="inspector-meta"> {(() => { try { return new URL(p.url).pathname } catch { return p.url } })()}</span>
                    {p.prices?.length > 0 && <span className="inspector-meta"> · {p.prices.length} prices</span>}
                    {p.offerSignals?.length > 0 && <span className="inspector-meta"> · {p.offerSignals.length} offers</span>}
                  </summary>
                  {p.headings?.length > 0 && <div className="inspector-row-block"><span>Headings:</span> {p.headings.slice(0, 8).join(' · ')}</div>}
                  {p.prices?.length > 0 && <div className="inspector-row-block"><span>Prices:</span> {p.prices.join(', ')}</div>}
                  {p.offerSignals?.length > 0 && (
                    <div className="inspector-row-block">
                      <span>Offers:</span>
                      <ul className="inspector-list">{p.offerSignals.map((o, j) => <li key={j}>{o}</li>)}</ul>
                    </div>
                  )}
                  {p.bodyExcerpt && (
                    <details>
                      <summary>Body excerpt</summary>
                      <pre className="inspector-pre">{p.bodyExcerpt.slice(0, 1500)}</pre>
                    </details>
                  )}
                </details>
              ))}
            </div>
          )}
        </>
      )}

      {manual.length > 0 && (
        <div className="inspector-section">
          <div className="inspector-h">Manual Offers ({manual.length})</div>
          <ul className="inspector-list">{manual.map((o, i) => <li key={i}>{o}</li>)}</ul>
        </div>
      )}

      <div className="inspector-section">
        <details>
          <summary>Raw JSON (debug)</summary>
          <pre className="inspector-pre">{JSON.stringify(data, null, 2).slice(0, 5000)}</pre>
        </details>
      </div>
    </div>
  )
}

export default function BrandPanel({
  sessionId, brandColors, brandImages, selectedProductNames = [], brandBrief,
  manualOffers = [], activeOffers = [], selectedOfferNames = [], brandName,
  onChange, onSelectedProductsChange, onOffersChange, onBrandNameChange, onSessionCreated
}) {
  const imgInputRef = useRef()
  const [uploading, setUploading] = useState(false)
  const [scrapeUrl, setScrapeUrl] = useState('')
  const [scraping, setScraping] = useState(false)
  const [scrapeProgress, setScrapeProgress] = useState('')
  const [scrapeSummary, setScrapeSummary] = useState(null)
  const [manualOffersText, setManualOffersText] = useState('')
  const [savingOffers, setSavingOffers] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectorData, setInspectorData] = useState(null)
  const [loadingInspector, setLoadingInspector] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [nameInput, setNameInput] = useState(brandName || '')
  const [nameSaving, setNameSaving] = useState(false)
  const selectedSet = new Set(selectedProductNames)
  const selectedOfferSet = new Set(selectedOfferNames)

  useEffect(() => {
    setManualOffersText((manualOffers || []).join('\n'))
  }, [manualOffers])

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 3000)
  }

  const uploadImages = async (files) => {
    if (!files.length) return
    setUploading(true)
    setError(null)
    const form = new FormData()
    for (const f of files) form.append('files', f)
    if (sessionId) form.append('sessionId', sessionId)
    try {
      const res = await authedFetch('/api/brand-assets', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (data.sessionId && data.sessionId !== sessionId && onSessionCreated) {
        onSessionCreated(data.sessionId)
      }
      onChange(data.brandColors, data.brandImages, data.selectedProductNames || [])
      showToast(`${data.added.length} image${data.added.length > 1 ? 's' : ''} added`)
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
      if (imgInputRef.current) imgInputRef.current.value = ''
    }
  }

  const scrapeColors = async () => {
    if (!scrapeUrl) return
    if (!sessionId) { setError('Upload a document or image first to start a session.'); return }
    setScraping(true)
    setError(null)
    setScrapeProgress('Starting…')
    setScrapeSummary(null)
    try {
      const res = await authedFetch('/api/scrape-colors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, url: scrapeUrl }),
      })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalDone = null
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6))
            if (evt.type === 'progress') {
              setScrapeProgress(evt.message || '')
            } else if (evt.type === 'done') {
              finalDone = evt
              onChange(evt.brandColors, brandImages)
            } else if (evt.type === 'error') {
              throw new Error(evt.error)
            }
          } catch (parseErr) {
            // ignore malformed lines
          }
        }
      }
      if (finalDone) {
        const c = finalDone.content || {}
        setScrapeSummary({
          pages: c.pagesScraped || 1,
          products: c.productCount || 0,
          prices: c.priceCount || 0,
          offers: c.offerCount || 0,
          platform: c.platform || 'unknown',
          colors: finalDone.scraped?.length || 0,
        })
        showToast(`Scraped ${c.pagesScraped || 1} pages, ${c.productCount || 0} products`)
        setScrapeUrl('')
      }
    } catch (e) {
      setError(e.message)
      setScrapeProgress('')
    } finally {
      setScraping(false)
    }
  }

  const toggleInspector = async () => {
    if (inspectorOpen) { setInspectorOpen(false); return }
    if (!sessionId) { setError('No session yet'); return }
    setLoadingInspector(true)
    setError(null)
    try {
      const r = await authedFetch(`/api/website-content/${sessionId}`)
      const data = await r.json()
      setInspectorData(data)
      setInspectorOpen(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingInspector(false)
    }
  }

  const saveManualOffers = async () => {
    if (!sessionId) { setError('Start a session first'); return }
    setSavingOffers(true)
    setError(null)
    try {
      const lines = manualOffersText.split('\n').map(l => l.trim()).filter(Boolean)
      const res = await authedFetch('/api/manual-offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, offers: lines }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onOffersChange?.({
        manualOffers: data.manualOffers || lines,
        activeOffers: data.activeOffers || [],
        selectedOfferNames: data.selectedOfferNames || [],
        brandBrief: data.brandBrief,
      })
      showToast(`${lines.length} offer${lines.length === 1 ? '' : 's'} saved`)
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingOffers(false)
    }
  }

  const toggleOfferTarget = async (offer) => {
    if (!offer) return
    const previousOfferNames = [...selectedOfferNames]
    const nextOfferNames = selectedOfferSet.has(offer)
      ? selectedOfferNames.filter(o => o !== offer)
      : [...selectedOfferNames, offer]
    onOffersChange?.({ selectedOfferNames: nextOfferNames })
    setError(null)
    if (!sessionId) return
    try {
      const res = await authedFetch('/api/selected-offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, offers: nextOfferNames }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onOffersChange?.({
        activeOffers: data.activeOffers || activeOffers,
        selectedOfferNames: data.selectedOfferNames || [],
      })
    } catch (e) {
      onOffersChange?.({ selectedOfferNames: previousOfferNames })
      setError(e.message)
    }
  }

  const removeImage = async (name) => {
    try {
      const res = await authedFetch(`/api/brand-assets/${sessionId}/${encodeURIComponent(name)}`, { method: 'DELETE' })
      const data = await res.json()
      onChange(data.brandColors, data.brandImages, data.selectedProductNames || [])
    } catch (e) {
      setError(e.message)
    }
  }

  const cycleType = async (img, type) => {
    if (!sessionId) return
    const previousImages = brandImages
    const previousSelectedProductNames = selectedProductNames
    const nextImages = brandImages.map(a => a.name === img.name ? { ...a, type } : a)
    const nextSelectedProductNames = type === 'logo'
      ? selectedProductNames.filter(name => name !== img.name)
      : selectedProductNames
    onChange(brandColors, nextImages, nextSelectedProductNames)
    setError(null)
    try {
      const res = await authedFetch(`/api/brand-assets/${sessionId}/${encodeURIComponent(img.name)}/type`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not update asset type')
      onChange(
        data.brandColors || brandColors,
        data.brandImages || nextImages,
        data.selectedProductNames || nextSelectedProductNames
      )
    } catch (e) {
      onChange(brandColors, previousImages, previousSelectedProductNames)
      setError(e.message)
    }
  }

  const toggleProductTarget = async (img) => {
    if (!img || !(img.type === 'product' || img.type === 'lifestyle')) return
    const previousProductNames = [...selectedProductNames]
    const nextProductNames = selectedSet.has(img.name)
      ? selectedProductNames.filter(name => name !== img.name)
      : [...selectedProductNames, img.name]
    onSelectedProductsChange?.(nextProductNames)
    setError(null)
    if (!sessionId) return
    try {
      const res = await authedFetch('/api/selected-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, productNames: nextProductNames }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSelectedProductsChange?.(data.selectedProductNames || [])
      showToast('Target products updated')
    } catch (e) {
      onSelectedProductsChange?.(previousProductNames)
      setError(e.message)
    }
  }

  const saveBrandName = async () => {
    if (!sessionId) return
    setNameSaving(true)
    try {
      await authedFetch('/api/brand-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, brandName: nameInput }),
      })
      onBrandNameChange?.(nameInput)
      showToast('Brand name saved')
    } catch (e) {
      setError(e.message)
    } finally {
      setNameSaving(false)
    }
  }

  return (
    <div className="brand-panel">
      {/* Brand name */}
      <div className="brand-section-header">
        <span className="brand-section-title">Brand Name</span>
      </div>
      <div className="scrape-row">
        <input
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
          placeholder="e.g. Bodivelle"
          onKeyDown={e => e.key === 'Enter' && saveBrandName()}
        />
        <button
          className="scrape-btn"
          onClick={saveBrandName}
          disabled={nameSaving || !nameInput}
          title="Save brand name"
        >
          {nameSaving ? <span className="spinner" /> : '✓'}
        </button>
      </div>

      {/* Image upload */}
      <div className="brand-section-header" style={{ marginTop: 12 }}>
        <span className="brand-section-title">Brand Assets</span>
        {brandImages.length > 0 && <span className="doc-count">{brandImages.length}</span>}
      </div>

      <div
        className={`brand-drop ${uploading ? 'loading' : ''}`}
        onClick={() => !uploading && imgInputRef.current.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); uploadImages([...e.dataTransfer.files]) }}
      >
        <input
          ref={imgInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={e => uploadImages([...e.target.files])}
        />
        {uploading
          ? <><span className="spinner" />Uploading &amp; extracting colors…</>
          : <>
              <span className="brand-drop-icon">🎨</span>
              <span>Drop logos &amp; product images</span>
              <span className="brand-drop-sub">Colors extracted · tap type badge to change</span>
            </>
        }
      </div>

      {/* Uploaded images */}
      {brandImages.length > 0 && (
        <div className="brand-images">
          {brandImages.map(img => {
            const isProduct = img.type === 'product' || img.type === 'lifestyle'
            const isTarget = selectedSet.has(img.name)
            return (
              <div
                key={img.name}
                className={`brand-img-item ${isTarget ? 'target-active' : ''}`}
              >
                {isProduct && (
                  <label className="target-checkbox" title="Use this product as a target">
                    <input
                      type="checkbox"
                      checked={isTarget}
                      onChange={() => toggleProductTarget(img)}
                    />
                  </label>
                )}
                <img src={img.dataUrl} alt={img.name} className="brand-thumb" />
                <div className="brand-img-info">
                  <div className="brand-type-selector">
                    {TYPES.map(t => {
                      // Treat legacy 'lifestyle' as Product visually
                      const isActive = img.type === t || (t === 'product' && img.type === 'lifestyle')
                      return (
                        <button
                          key={t}
                          className={`type-opt ${isActive ? 'active' : ''}`}
                          onClick={() => cycleType(img, t)}
                        >
                          {TYPE_LABEL[t]}
                        </button>
                      )
                    })}
                  </div>
                  <span className="brand-img-name" title={img.name}>{img.name}</span>
                  <div className="brand-img-colors">
                    {(img.colors || []).slice(0, 5).map(c => (
                      <span key={c.hex} className="mini-swatch" style={{ background: c.hex }} title={c.hex} />
                    ))}
                    {img.higgsfieldUrl && (
                      <span className="ref-indicator" title="Image will be used as reference in generation">✓ ref</span>
                    )}
                    {isTarget && (
                      <span className="ref-indicator target-ref" title="Selected target product">target</span>
                    )}
                  </div>
                </div>
                <button className="brand-img-remove" onClick={() => removeImage(img.name)} title="Remove">✕</button>
              </div>
            )
          })}
        </div>
      )}

      {/* Website scraper — multi-page crawl */}
      <div className="brand-section-header" style={{ marginTop: 12 }}>
        <span className="brand-section-title">Crawl Brand Site</span>
      </div>
      <div className="scrape-row">
        <input
          value={scrapeUrl}
          onChange={e => setScrapeUrl(e.target.value)}
          placeholder="https://yourbrand.com"
          onKeyDown={e => e.key === 'Enter' && scrapeColors()}
        />
        <button className="scrape-btn" onClick={scrapeColors} disabled={scraping || !scrapeUrl}>
          {scraping ? <span className="spinner" /> : '→'}
        </button>
      </div>
      {scraping && scrapeProgress && (
        <div className="scrape-progress">{scrapeProgress}</div>
      )}
      {scrapeSummary && !scraping && (
        <div className="scrape-summary">
          ✓ {scrapeSummary.pages} {scrapeSummary.pages === 1 ? 'page' : 'pages'} · {scrapeSummary.products} products · {scrapeSummary.prices} prices · {scrapeSummary.offers} offers · {scrapeSummary.colors} colors
          <span className="scrape-platform"> [{scrapeSummary.platform}]</span>
        </div>
      )}
      {sessionId && (
        <button className="inspect-btn" onClick={toggleInspector} disabled={loadingInspector}>
          {loadingInspector ? 'Loading…' : inspectorOpen ? '▴ Hide scraped data' : '🔍 Inspect scraped data'}
        </button>
      )}
      {inspectorOpen && inspectorData && <ScrapedDataInspector data={inspectorData} />}

      {/* Offers — manually added + extracted from the brand brief */}
      <div className="brand-section-header" style={{ marginTop: 14 }}>
        <span className="brand-section-title">Active Offers</span>
        {activeOffers.length > 0 && <span className="doc-count">{activeOffers.length}</span>}
      </div>
      <div className="manual-offers-help">
        Check the offers to use in deal-focused ads. Paste new promos below, one per line.
      </div>
      {activeOffers.length > 0 && (
        <div className="active-offer-list">
          {activeOffers.map(offer => {
            const isSelected = selectedOfferSet.has(offer)
            return (
              <label key={offer} className={`active-offer-item ${isSelected ? 'selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleOfferTarget(offer)}
                />
                <span>{offer}</span>
              </label>
            )
          })}
        </div>
      )}
      <textarea
        className="manual-offers-textarea"
        value={manualOffersText}
        onChange={e => setManualOffersText(e.target.value)}
        placeholder={'Buy 2 Get 1 Free on bundles\nSubscribe & save 15%\nFree shipping over $75'}
        rows={3}
        data-gramm="false"
      />
      <button className="manual-offers-save" onClick={saveManualOffers} disabled={savingOffers}>
        {savingOffers ? 'Saving…' : 'Save offers'}
      </button>

      {/* Brand color palette */}
      {brandColors.length > 0 && (
        <>
          <div className="brand-section-header" style={{ marginTop: 12 }}>
            <span className="brand-section-title">Brand Palette</span>
            <span className="doc-count">{brandColors.length}</span>
          </div>
          <div className="color-swatches">
            {brandColors.map(c => (
              <div key={c.hex} className="color-swatch" title={c.hex}>
                <div className="swatch-color" style={{ background: c.hex }} />
                <span className="swatch-hex">{c.hex}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {toast && (
        <div className={`brand-toast ${toast.isError ? 'brand-toast-error' : ''}`}>
          {toast.isError ? '⚠ ' : '✓ '}{toast.msg}
        </div>
      )}

      {error && (
        <div className="brand-error">
          ⚠ {error}
          <button className="brand-error-close" onClick={() => setError(null)}>✕</button>
        </div>
      )}
    </div>
  )
}

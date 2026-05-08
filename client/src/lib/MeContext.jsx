// Profile + plan + credits context.
// Wrap the app under AuthGate (so we know the user is signed in).
// Refetch via `refresh()` after any credit-costing action so the pill ticks.
//
// Shape of `me`:
//   { user: {id, email}, plan: {key, label, monthlyCredits, projectLimit, priceUsd},
//     credits: {remaining, resetAt}, projects: {count, limit}, creditCosts }

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { authedFetch } from './supabase.js'
import { useAuth } from './AuthContext.jsx'

const MeContext = createContext(null)

// Out-of-credits modal trigger — components call `setOutOfCreditsModal(...)`.
// Lives on the context so the modal can be rendered once at the app root.

export function MeProvider({ children }) {
  const { session } = useAuth()
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [outOfCreditsModal, setOutOfCreditsModal] = useState(null)
  // shape: { required, action, message } | { code: 'PROJECT_LIMIT_REACHED', limit, currentCount, planLabel }

  const refresh = useCallback(async () => {
    if (!session) { setMe(null); setLoading(false); return }
    try {
      const r = await authedFetch('/api/me')
      if (!r.ok) { setError(`HTTP ${r.status}`); setLoading(false); return }
      const j = await r.json()
      setMe(j); setError(null)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [session])

  useEffect(() => { refresh() }, [refresh])

  // Re-poll on window focus so a user returning after a few minutes sees a
  // fresh balance (mainly for the eventual case of a Stripe webhook resetting).
  useEffect(() => {
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  // Detect Stripe checkout return URLs (?checkout=success or ?checkout=cancel).
  // On success: refresh /api/me a few times — the webhook may take a beat to
  // fire and update the profile row. Then strip the param so a refresh
  // doesn't re-trigger.
  const [checkoutToast, setCheckoutToast] = useState(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get('checkout')
    if (!status) return

    if (status === 'success') {
      setCheckoutToast({ kind: 'success', text: 'Payment received — credits updating…' })
      // Poll /api/me a few times to catch the webhook's profile update
      let n = 0
      const int = setInterval(() => {
        refresh()
        if (++n >= 5) { clearInterval(int); setCheckoutToast({ kind: 'success', text: 'Plan updated.' }); setTimeout(() => setCheckoutToast(null), 3000) }
      }, 1500)
    } else if (status === 'cancel') {
      setCheckoutToast({ kind: 'info', text: 'Checkout cancelled.' })
      setTimeout(() => setCheckoutToast(null), 2500)
    }

    // Strip the param without reloading
    const url = new URL(window.location.href)
    url.searchParams.delete('checkout')
    url.searchParams.delete('type')
    window.history.replaceState({}, '', url.toString())
  }, [refresh])

  // Inspect a fetch Response: if it's 402 (credits or project-limit), open
  // the modal and return true so the caller knows to bail.
  // Usage:
  //   const r = await authedFetch(...)
  //   if (await checkPaymentRequired(r)) return
  const checkPaymentRequired = useCallback(async (response) => {
    if (response.status !== 402) return false
    try {
      const body = await response.clone().json()
      setOutOfCreditsModal(body)
    } catch {
      setOutOfCreditsModal({ message: 'Out of credits' })
    }
    return true
  }, [])

  // Helper: does the user have enough credits to perform an action right now?
  const hasCreditsFor = useCallback((action) => {
    if (!me) return true  // optimistic — don't block UI before /api/me lands
    const cost = me.creditCosts?.[action]
    if (cost == null || cost === 0) return true
    return me.credits.remaining >= cost
  }, [me])

  const creditsRemaining = me?.credits?.remaining ?? null

  const value = {
    me, loading, error, refresh,
    creditsRemaining,
    hasCreditsFor,
    checkPaymentRequired,
    outOfCreditsModal,
    setOutOfCreditsModal,
    closeOutOfCredits: () => setOutOfCreditsModal(null),
    checkoutToast,
  }
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>
}

export function useMe() {
  const ctx = useContext(MeContext)
  if (!ctx) throw new Error('useMe must be used inside <MeProvider>')
  return ctx
}

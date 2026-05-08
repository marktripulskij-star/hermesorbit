// Stripe client + small helpers.
// Test mode by default — STRIPE_SECRET_KEY should be a sk_test_... key
// during development. The setup-stripe.js script reads env vars to know
// which mode to operate in.

import Stripe from 'stripe'

let _stripe = null
export function getStripe() {
  if (_stripe) return _stripe
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY missing in env')
  }
  _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-06-20',  // pin a version so behavior doesn't drift on Stripe upgrades
  })
  return _stripe
}

// Plan key → Stripe price ID (read from env).
// One Stripe Product per plan, with one recurring monthly Price.
//   STRIPE_PRICE_SOLO=price_...
//   STRIPE_PRICE_OPERATOR=price_...
//   STRIPE_PRICE_STUDIO=price_...
export function priceForPlan(planKey) {
  const map = {
    solo:     process.env.STRIPE_PRICE_SOLO,
    operator: process.env.STRIPE_PRICE_OPERATOR,
    studio:   process.env.STRIPE_PRICE_STUDIO,
  }
  return map[planKey] || null
}

// Top-up key → Stripe price ID (one-time)
export function priceForTopup(packKey) {
  const map = {
    topup_100:  process.env.STRIPE_PRICE_TOPUP_100,
    topup_500:  process.env.STRIPE_PRICE_TOPUP_500,
    topup_1500: process.env.STRIPE_PRICE_TOPUP_1500,
  }
  return map[packKey] || null
}

// Reverse lookup: given a Stripe price ID (from a webhook), find the plan key.
export function planKeyForPrice(priceId) {
  const map = {
    [process.env.STRIPE_PRICE_SOLO]:     'solo',
    [process.env.STRIPE_PRICE_OPERATOR]: 'operator',
    [process.env.STRIPE_PRICE_STUDIO]:   'studio',
  }
  return map[priceId] || null
}

export function topupKeyForPrice(priceId) {
  const map = {
    [process.env.STRIPE_PRICE_TOPUP_100]:  'topup_100',
    [process.env.STRIPE_PRICE_TOPUP_500]:  'topup_500',
    [process.env.STRIPE_PRICE_TOPUP_1500]: 'topup_1500',
  }
  return map[priceId] || null
}

// Get-or-create the Stripe customer for a Supabase user. Stores
// stripe_customer_id on the profile row so we don't create duplicates.
export async function getOrCreateCustomer(profile, supabaseAdmin) {
  if (profile.stripe_customer_id) return profile.stripe_customer_id

  const stripe = getStripe()
  const customer = await stripe.customers.create({
    email: profile.email,
    metadata: { supabase_user_id: profile.id },
  })

  await supabaseAdmin
    .from('profiles')
    .update({ stripe_customer_id: customer.id })
    .eq('id', profile.id)

  return customer.id
}

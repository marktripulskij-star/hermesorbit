// One-time idempotent setup script for Stripe products.
// Reads STRIPE_SECRET_KEY from server/.env, creates/finds the 3 monthly
// subscription plans + 3 one-time top-up packs, then prints the price IDs
// to paste into server/.env.
//
// Run:
//   node server/scripts/setup-stripe.js
//
// Re-run safely: looks up existing products by metadata.ultemir_key first.

import '../lib/load-env.js'
import { getStripe } from '../lib/stripe.js'
import { PLAN_LIMITS, TOPUP_PACKS } from '../lib/credits.js'

const stripe = getStripe()

// Subscriptions (monthly recurring)
const PLAN_PRODUCTS = [
  { key: 'solo',     name: 'Ultemir Solo',     priceUsd: 19,  credits: 200,  envName: 'STRIPE_PRICE_SOLO' },
  { key: 'operator', name: 'Ultemir Operator', priceUsd: 49,  credits: 600,  envName: 'STRIPE_PRICE_OPERATOR' },
  { key: 'studio',   name: 'Ultemir Studio',   priceUsd: 149, credits: 2000, envName: 'STRIPE_PRICE_STUDIO' },
]

// One-time top-up packs
const TOPUP_PRODUCTS = [
  { key: 'topup_100',  name: 'Ultemir 100 credits',  priceUsd: 9,  envName: 'STRIPE_PRICE_TOPUP_100' },
  { key: 'topup_500',  name: 'Ultemir 500 credits',  priceUsd: 39, envName: 'STRIPE_PRICE_TOPUP_500' },
  { key: 'topup_1500', name: 'Ultemir 1500 credits', priceUsd: 99, envName: 'STRIPE_PRICE_TOPUP_1500' },
]

async function findProductByMetadata(ultemirKey) {
  // Stripe product list is paginated; for our small catalog, one page is enough.
  const list = await stripe.products.list({ limit: 100, active: true })
  return list.data.find(p => p.metadata?.ultemir_key === ultemirKey) || null
}

async function findRecurringPrice(productId, unitAmountCents) {
  const list = await stripe.prices.list({ product: productId, active: true, limit: 100 })
  return list.data.find(p =>
    p.unit_amount === unitAmountCents &&
    p.recurring?.interval === 'month'
  ) || null
}

async function findOneTimePrice(productId, unitAmountCents) {
  const list = await stripe.prices.list({ product: productId, active: true, limit: 100 })
  return list.data.find(p =>
    p.unit_amount === unitAmountCents &&
    !p.recurring
  ) || null
}

async function ensureSubscription({ key, name, priceUsd, credits }) {
  const cents = priceUsd * 100

  let product = await findProductByMetadata(key)
  if (!product) {
    product = await stripe.products.create({
      name,
      metadata: { ultemir_key: key, ultemir_credits: String(credits) },
    })
    console.log(`  ✓ Created product: ${name} (${product.id})`)
  } else {
    console.log(`  ↺ Found product: ${name} (${product.id})`)
  }

  let price = await findRecurringPrice(product.id, cents)
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: cents,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { ultemir_key: key, ultemir_credits: String(credits) },
    })
    console.log(`    ✓ Created price: $${priceUsd}/mo (${price.id})`)
  } else {
    console.log(`    ↺ Found price: $${priceUsd}/mo (${price.id})`)
  }
  return price.id
}

async function ensureTopup({ key, name, priceUsd }) {
  const cents = priceUsd * 100

  let product = await findProductByMetadata(key)
  if (!product) {
    product = await stripe.products.create({
      name,
      metadata: { ultemir_key: key },
    })
    console.log(`  ✓ Created product: ${name} (${product.id})`)
  } else {
    console.log(`  ↺ Found product: ${name} (${product.id})`)
  }

  let price = await findOneTimePrice(product.id, cents)
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: cents,
      currency: 'usd',
      metadata: { ultemir_key: key },
    })
    console.log(`    ✓ Created price: $${priceUsd} one-time (${price.id})`)
  } else {
    console.log(`    ↺ Found price: $${priceUsd} one-time (${price.id})`)
  }
  return price.id
}

const envLines = []

console.log('\n▶ Creating/finding monthly subscription plans…\n')
for (const plan of PLAN_PRODUCTS) {
  const priceId = await ensureSubscription(plan)
  envLines.push(`${plan.envName}=${priceId}`)
}

console.log('\n▶ Creating/finding one-time top-up packs…\n')
for (const pack of TOPUP_PRODUCTS) {
  const priceId = await ensureTopup(pack)
  envLines.push(`${pack.envName}=${priceId}`)
}

console.log('\n✓ Stripe setup complete.\n')
console.log('────────────────────────────────────────────')
console.log('Add these lines to server/.env:')
console.log('────────────────────────────────────────────\n')
for (const line of envLines) console.log(line)
console.log('\nThen restart the server.\n')

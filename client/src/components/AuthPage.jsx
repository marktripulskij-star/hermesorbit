// Login + signup screen — single full-bleed dark card on near-black canvas.
// Toggles between modes. Email + password v1; OAuth + magic-link deferred.

import React, { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { Btn, Card } from './ui/index.jsx'

export default function AuthPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('login')   // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [info, setInfo] = useState(null)

  async function onSubmit(e) {
    e.preventDefault()
    setErr(null); setInfo(null); setBusy(true)
    const fn = mode === 'login' ? signIn : signUp
    const { error, data } = await fn({ email: email.trim(), password })
    setBusy(false)
    if (error) { setErr(error.message); return }
    if (mode === 'signup') {
      // If email confirmation is on, no session is returned; tell the user.
      if (!data?.session) {
        setInfo(`Check ${email.trim()} for a confirmation link.`)
      }
    }
    // On login success, AuthGate flips automatically via onAuthStateChange.
  }

  function flip() {
    setErr(null); setInfo(null)
    setMode(mode === 'login' ? 'signup' : 'login')
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid', placeItems: 'center',
      padding: 24,
      background: 'var(--bg)',
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        {/* Brand mark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, justifyContent: 'center' }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'var(--accent)',
            display: 'grid', placeItems: 'center',
            color: 'var(--accent-on)', fontWeight: 800, fontSize: 18,
            letterSpacing: '-0.04em',
          }}>U</div>
          <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em' }}>Ultemir</span>
        </div>

        <Card padding={24}>
          <div style={{ marginBottom: 18 }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
              {mode === 'login' ? 'Sign in' : 'Create your account'}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
              {mode === 'login' ? 'Welcome back.' : '30 free credits. No card.'}
            </p>
          </div>

          <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Email">
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@brand.com"
              />
            </Field>
            <Field label="Password" hint={mode === 'signup' ? 'Min 6 characters.' : null}>
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>

            {err && (
              <div style={{
                fontSize: 12.5, color: 'var(--danger)',
                padding: '8px 10px', borderRadius: 6,
                background: 'rgba(248,113,113,0.08)',
                border: '1px solid rgba(248,113,113,0.3)',
              }}>{err}</div>
            )}
            {info && (
              <div style={{
                fontSize: 12.5, color: 'var(--accent)',
                padding: '8px 10px', borderRadius: 6,
                background: 'var(--accent-dim)',
                border: '1px solid var(--accent-dim-strong)',
              }}>{info}</div>
            )}

            <Btn
              type="submit"
              variant="primary"
              size="md"
              disabled={busy}
              style={{ width: '100%', marginTop: 4 }}
            >
              {busy ? (mode === 'login' ? 'Signing in…' : 'Creating account…') : (mode === 'login' ? 'Sign in' : 'Create account')}
            </Btn>
          </form>

          <div style={{
            marginTop: 18, paddingTop: 16,
            borderTop: '1px solid var(--border)',
            fontSize: 12.5, color: 'var(--text-3)', textAlign: 'center',
          }}>
            {mode === 'login' ? "Don't have an account?" : 'Already have one?'}{' '}
            <button
              type="button"
              onClick={flip}
              style={{
                background: 'none', border: 'none', padding: 0,
                color: 'var(--accent)', fontWeight: 600, fontSize: 12.5,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {mode === 'login' ? 'Sign up' : 'Sign in'}
            </button>
          </div>
        </Card>

        <p style={{ fontSize: 11.5, color: 'var(--text-4)', textAlign: 'center', marginTop: 16 }}>
          By continuing you agree to the Terms.
        </p>
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11.5, color: 'var(--text-4)' }}>{hint}</span>}
    </label>
  )
}

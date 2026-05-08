// Renders <AuthPage /> when no session, splash while loading, children when signed in.

import React from 'react'
import { useAuth } from '../lib/AuthContext'
import AuthPage from './AuthPage.jsx'

export default function AuthGate({ children }) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'grid', placeItems: 'center',
        background: 'var(--bg)',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12, color: 'var(--text-4)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          Loading…
        </div>
      </div>
    )
  }

  if (!session) return <AuthPage />
  return children
}

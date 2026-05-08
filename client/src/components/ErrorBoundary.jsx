import React from 'react'

export default class ErrorBoundary extends React.Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[Root ErrorBoundary] caught:', error.message)
    console.error('Component stack:', info?.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', gap: 16, padding: 40,
          background: '#0f0f11', color: '#e8e8f0', fontFamily: 'monospace'
        }}>
          <div style={{ fontSize: 32 }}>⚠</div>
          <h2 style={{ margin: 0 }}>Something went wrong</h2>
          <pre style={{
            background: '#1a1a1f', border: '1px solid #2e2e36', borderRadius: 8,
            padding: 16, maxWidth: 600, overflow: 'auto', fontSize: 12, color: '#ef4444'
          }}>
            {this.state.error.message}
          </pre>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload() }}
            style={{ background: '#7c6bff', color: 'white', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 600 }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { AuthProvider } from './lib/AuthContext.jsx'
import { MeProvider } from './lib/MeContext.jsx'
import { ProjectsProvider } from './lib/ProjectsContext.jsx'
import AuthGate from './components/AuthGate.jsx'
import Router from './components/Router.jsx'
import OutOfCreditsModal from './components/OutOfCreditsModal.jsx'
import CheckoutToast from './components/CheckoutToast.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <AuthProvider>
      <AuthGate>
        <MeProvider>
          <ProjectsProvider>
            <Router />
            <OutOfCreditsModal />
            <CheckoutToast />
          </ProjectsProvider>
        </MeProvider>
      </AuthGate>
    </AuthProvider>
    {/* Vercel Analytics — auto-disabled in dev, only sends data in prod */}
    <Analytics />
  </ErrorBoundary>
)

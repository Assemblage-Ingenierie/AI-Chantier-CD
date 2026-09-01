import React from 'react';
import { Analytics } from '@vercel/analytics/react';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import AuthGate from './components/auth/AuthGate.jsx';
import InstallPrompt from './components/ui/InstallPrompt.jsx';
import OfflineBanner from './components/ui/OfflineBanner.jsx';

export default function App() {
  return (
    <ErrorBoundary>
      <AuthGate />
      <InstallPrompt />
      <OfflineBanner />
      <Analytics />
    </ErrorBoundary>
  );
}

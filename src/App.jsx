import React from 'react';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import AuthGate from './components/auth/AuthGate.jsx';
import InstallPrompt from './components/ui/InstallPrompt.jsx';

export default function App() {
  return (
    <ErrorBoundary>
      <AuthGate />
      <InstallPrompt />
    </ErrorBoundary>
  );
}

import React from 'react';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import AuthGate from './components/auth/AuthGate.jsx';

export default function App() {
  return (
    <ErrorBoundary>
      <AuthGate />
    </ErrorBoundary>
  );
}

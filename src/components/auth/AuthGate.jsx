import React from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import LoginScreen from './LoginScreen.jsx';
import WaitingScreen from './WaitingScreen.jsx';
import ChantierAI from '../app/ChantierAI.jsx';

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#30323E' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid #E30513', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
    </div>
  );
}

export default function AuthGate() {
  const { authState, session, profile, logout, handleSession } = useAuth();

  if (authState === 'loading') return <Spinner />;
  if (authState === 'loggedout') return <LoginScreen onLogin={handleSession} />;
  if (authState === 'waiting') return <WaitingScreen email={session?.user?.email ?? ''} onLogout={logout} />;
  return <ChantierAI profile={profile} onLogout={logout} />;
}

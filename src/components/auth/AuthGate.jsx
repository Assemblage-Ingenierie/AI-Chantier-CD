import React from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import LoginScreen from './LoginScreen.jsx';
import WaitingScreen from './WaitingScreen.jsx';
import ChantierAI from '../app/ChantierAI.jsx';

export default function AuthGate() {
  const { authState, session, profile, logout, handleSession } = useAuth();

  // Déconnexion explicite ou compte non approuvé — seuls vrais blocages
  if (authState === 'loggedout') return <LoginScreen onLogin={handleSession} />;
  if (authState === 'waiting') return <WaitingScreen email={session?.user?.email ?? ''} onLogout={logout} />;

  // 'loading' ET 'approved' → on affiche l'app immédiatement
  // La vérification Supabase se termine en arrière-plan ; si la session
  // est invalide, authState passera à 'loggedout' et l'écran de login s'affichera.
  return <ChantierAI profile={profile} onLogout={logout} />;
}

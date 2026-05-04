import React, { useState, useEffect } from 'react';
import { getSupabase } from '../../supabase.js';
import { useBrandingLogo } from '../../lib/branding.js';

const BG = '#30323E';
const RED = '#E30513';

export default function LoginScreen({ onLogin }) {
  const logoUrl = useBrandingLogo();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogle = async () => {
    setLoading(true); setMsg('');
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) { setMsg(error.message); setLoading(false); }
    } catch (e) { setMsg(e.message); setLoading(false); }
  };

  const handleMagicLink = async () => {
    if (!email) { setMsg('Entrez votre email.'); return; }
    setLoading(true); setMsg('');
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      setMsg(error ? error.message : 'Lien envoyé ! Vérifiez votre boîte mail.');
    } catch (e) { setMsg(e.message); }
    setLoading(false);
  };

  const handleEmailAuth = async () => {
    if (!email || !password) { setMsg('Email et mot de passe requis.'); return; }
    setLoading(true); setMsg('');
    try {
      const sb = await getSupabase();
      if (mode === 'signup') {
        const { data: signUpData, error } = await sb.auth.signUp({ email, password });
        if (!error && signUpData?.user) {
          // Create profile immediately (needed for admin to see the pending request)
          await sb.from('aichantier_profiles').upsert({
            id:          signUpData.user.id,
            email:       signUpData.user.email || email,
            full_name:   email.split('@')[0],
            is_approved: false,
            role:        'user',
          }, { onConflict: 'id', ignoreDuplicates: true }).throwOnError().catch(() => {});
        }
        setMsg(error ? error.message : "Compte créé ! En attente d'approbation par un administrateur.");
        setLoading(false);
        return;
      }
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { setMsg(error.message); setLoading(false); return; }
      if (data?.session) onLogin(data.session);
    } catch (e) { setMsg(e.message); setLoading(false); }
  };

  const input = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)',
    color: 'white', fontSize: 14, boxSizing: 'border-box', outline: 'none',
  };
  const btn = (bg, color = 'white') => ({
    width: '100%', padding: 11, borderRadius: 8, border: 'none',
    background: bg, color, fontSize: 14, fontWeight: 700,
    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
  });
  const isSuccess = msg.includes('envoyé') || msg.includes('créé');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: BG, padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 360 }}>

        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, marginBottom: 32 }}>
          <img src={logoUrl} alt="Assemblage Ingénierie" style={{ height: 48, objectFit: 'contain' }} />
          <div style={{ color: 'white', fontWeight: 900, fontSize: 18, letterSpacing: -0.5 }}>AI Chantier</div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 4 }}>
          {['login', 'signup'].map(m => (
            <button key={m} onClick={() => { setMode(m); setMsg(''); }}
              style={{ flex: 1, padding: 8, borderRadius: 6, border: 'none', background: mode === m ? RED : 'transparent', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {m === 'login' ? 'Connexion' : 'Créer un compte'}
            </button>
          ))}
        </div>

        {/* Champs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={input} />
          <input type="password" placeholder="Mot de passe" value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleEmailAuth()} style={input} />
          <button onClick={handleEmailAuth} disabled={loading} style={btn(RED)}>
            {loading ? '…' : mode === 'signup' ? 'Créer le compte' : 'Se connecter'}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>ou</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
          </div>

          <button onClick={handleGoogle} disabled={loading} style={btn('white', BG)}>
            G&nbsp;&nbsp;Continuer avec Google
          </button>

          {mode === 'login' && (
            <button onClick={handleMagicLink} disabled={loading}
              style={{ ...btn('transparent'), border: '1px solid rgba(255,255,255,0.2)' }}>
              Envoyer un lien magique
            </button>
          )}
        </div>

        {msg && (
          <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 8, textAlign: 'center', fontSize: 13,
            background: isSuccess ? 'rgba(22,163,74,0.15)' : 'rgba(227,5,19,0.15)',
            color: isSuccess ? '#16A34A' : '#FCA5A5' }}>
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}

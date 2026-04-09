import React from 'react';

export default function WaitingScreen({ email, onLogout }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#30323E', padding: 24, textAlign: 'center' }}>
      <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(227,5,19,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <div style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid #E30513', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
      </div>
      <div style={{ color: 'white', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Accès en attente</div>
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginBottom: 4 }}>{email}</div>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, maxWidth: 280, marginBottom: 28 }}>
        Votre compte doit être approuvé par un administrateur avant d'accéder à l'application.
      </div>
      <button onClick={onLogout}
        style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }}>
        Se déconnecter
      </button>
    </div>
  );
}

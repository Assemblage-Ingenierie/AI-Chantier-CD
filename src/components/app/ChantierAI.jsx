import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import AdminPanel from '../auth/AdminPanel.jsx';

/**
 * Point d'entrée de l'application principale.
 * Migration progressive : Dashboard → VueProjet seront ajoutés ici étape par étape.
 */
export default function ChantierAI({ profile, onLogout }) {
  const [showAdmin, setShowAdmin] = useState(false);
  const [syncStatus, setSyncStatus] = useState('ok'); // 'ok' | 'saving' | 'error'

  const dotColor = syncStatus === 'ok' ? DA.urgGrn : syncStatus === 'saving' ? DA.urgAmb : DA.red;
  const dotLabel = syncStatus === 'saving' ? 'Sauvegarde…' : syncStatus === 'error' ? 'Erreur sync' : 'Sauvegardé';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', maxWidth: 390, margin: '0 auto', fontFamily: "'Inter',system-ui,sans-serif", background: DA.grayXL }}>

      {/* Header */}
      <div style={{ background: DA.black, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 3, height: 20, background: DA.red, borderRadius: 2 }} />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span style={{ color: DA.red, fontWeight: 900, fontSize: 12, fontStyle: 'italic', letterSpacing: -0.5 }}>
              Assembl<span style={{ color: 'white' }}>!</span>age
            </span>
            <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 700, fontSize: 9, fontStyle: 'italic', letterSpacing: -0.3 }}>ingénierie</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {profile?.role === 'admin' && (
            <button onClick={() => setShowAdmin(true)}
              style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }}>
              Admin
            </button>
          )}
          {onLogout && (
            <button onClick={onLogout}
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.5)', fontSize: 10, padding: '3px 7px', borderRadius: 5, cursor: 'pointer' }}>
              Sortir
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: dotColor, transition: 'background 0.3s' }} />
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>{dotLabel}</span>
          </div>
        </div>
      </div>

      {/* Corps — migration en cours, Dashboard ici à l'étape 4 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
        <div style={{ fontWeight: 800, fontSize: 18, color: DA.black, marginBottom: 8 }}>Application en cours de migration</div>
        <div style={{ color: DA.gray, fontSize: 14, maxWidth: 260, lineHeight: 1.5, marginBottom: 24 }}>
          La nouvelle architecture est prête. Le Dashboard sera migré à la prochaine étape.
        </div>
        <div style={{ fontSize: 12, color: DA.gray }}>
          Connecté : {profile?.email || '—'}
          {profile?.role === 'admin' && <span style={{ color: DA.red, fontWeight: 700 }}> · Admin</span>}
        </div>
      </div>

      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </div>
  );
}

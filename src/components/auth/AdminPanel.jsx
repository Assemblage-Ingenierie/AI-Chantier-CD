import React, { useState, useEffect } from 'react';
import { getSupabase } from '../../supabase.js';
import { recoverPhotosFromStorage } from '../../lib/storage.js';
import { DA } from '../../lib/constants.js';

export default function AdminPanel({ onClose, onPendingCountChange }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [recoverResult, setRecoverResult] = useState(null);

  const fetchProfiles = async () => {
    setLoading(true); setErr('');
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.from('aichantier_profiles').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      setProfiles(data);
      onPendingCountChange?.((data || []).filter(p => !p.is_approved).length);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  useEffect(() => { fetchProfiles(); }, []);

  const setApproval = async (id, approved) => {
    const sb = await getSupabase();
    const { error } = await sb.from('aichantier_profiles').update({ is_approved: approved }).eq('id', id);
    if (error) setErr(error.message);
    else fetchProfiles();
  };

  const handleRecover = async () => {
    setRecovering(true); setRecoverResult(null);
    const result = await recoverPhotosFromStorage();
    setRecoverResult(result);
    setRecovering(false);
  };

  const deleteProfile = async (id, email) => {
    if (!window.confirm(`Supprimer définitivement "${email}" ?`)) return;
    const sb = await getSupabase();
    const { error } = await sb.from('aichantier_profiles').delete().eq('id', id);
    if (error) setErr(error.message);
    else fetchProfiles();
  };

const setRole = async (id, role) => {
    const sb = await getSupabase();
    const { error } = await sb.from('aichantier_profiles').update({ role }).eq('id', id);
    if (error) setErr(error.message);
    else fetchProfiles();
  };

  const badge = (ok) => ({
    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
    background: ok ? 'rgba(22,163,74,0.12)' : 'rgba(227,5,19,0.1)',
    color: ok ? DA.urgGrn : DA.red,
  });

  return (
    <div className="modal-overlay-dark">
      <div className="modal-sheet-flex">

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 12px', borderBottom: `1px solid ${DA.border}`, flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: DA.black }}>Administration</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: DA.gray, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>

{/* Récupération photos */}
          <div style={{ padding: '14px 0', borderBottom: `1px solid ${DA.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: DA.black, marginBottom: 6 }}>Récupérer les photos perdues</div>
            <div style={{ fontSize: 12, color: DA.gray, marginBottom: 10 }}>
              Scanne le Storage et recrée les enregistrements manquants. Puis rechargez la page et rouvrez le projet pour voir les photos.
            </div>
            <button onClick={handleRecover} disabled={recovering}
              style={{ fontSize: 12, fontWeight: 700, padding: '7px 16px', borderRadius: 8, border: 'none', background: DA.red, color: 'white', cursor: recovering ? 'default' : 'pointer', opacity: recovering ? 0.6 : 1 }}>
              {recovering ? 'Récupération en cours…' : '🔍 Récupérer les photos'}
            </button>
            {recoverResult && (
              <div style={{ marginTop: 8, fontSize: 12, color: recoverResult.errors.length ? DA.red : DA.urgGrn, fontWeight: 600 }}>
                {recoverResult.recovered} photo(s) récupérée(s)
                {recoverResult.errors.length > 0 && ` — ${recoverResult.errors.length} erreur(s)`}
                {recoverResult.recovered > 0 && ' — rechargez la page puis rouvrez le projet.'}
              </div>
            )}
          </div>

          {loading && <div style={{ padding: 20, textAlign: 'center', color: DA.gray, fontSize: 13 }}>Chargement...</div>}
          {err && <div style={{ padding: 10, color: DA.red, fontSize: 13 }}>{err}</div>}
          {!loading && profiles.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${DA.border}`, gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: DA.black, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.full_name || p.email || p.id.slice(0, 8)}
                </div>
                {p.full_name && (
                  <div style={{ fontSize: 11, color: DA.gray, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</div>
                )}
              </div>
              <span style={badge(p.is_approved)}>{p.is_approved ? 'Approuvé' : 'En attente'}</span>
              <span style={{ fontSize: 11, color: DA.gray, padding: '2px 6px', borderRadius: 8, background: DA.grayXL }}>{p.role || 'user'}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {p.is_approved
                  ? <button onClick={() => setApproval(p.id, false)} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: `1px solid ${DA.border}`, background: 'white', cursor: 'pointer', color: DA.red }}>Révoquer</button>
                  : <button onClick={() => setApproval(p.id, true)} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: 'none', background: DA.urgGrn, color: 'white', cursor: 'pointer' }}>Approuver</button>
                }
                {p.role !== 'admin'
                  ? <button onClick={() => setRole(p.id, 'admin')} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: `1px solid ${DA.border}`, background: 'white', cursor: 'pointer', color: DA.gray }}>→Admin</button>
                  : <button onClick={() => setRole(p.id, 'user')} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: `1px solid ${DA.border}`, background: 'white', cursor: 'pointer', color: DA.gray }}>→User</button>
                }
                <button onClick={() => deleteProfile(p.id, p.email || p.id)}
                  style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: `1px solid #FECDD3`, background: '#FFF1F2', cursor: 'pointer', color: DA.red }}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

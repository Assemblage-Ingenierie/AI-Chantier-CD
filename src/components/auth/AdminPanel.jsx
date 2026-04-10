import React, { useState, useEffect } from 'react';
import { getSupabase } from '../../supabase.js';
import { DA } from '../../lib/constants.js';

export default function AdminPanel({ onClose }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const fetchProfiles = async () => {
    setLoading(true); setErr('');
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      setProfiles(data);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  useEffect(() => { fetchProfiles(); }, []);

  const setApproval = async (id, approved) => {
    const sb = await getSupabase();
    const { error } = await sb.from('profiles').update({ is_approved: approved }).eq('id', id);
    if (error) setErr(error.message);
    else fetchProfiles();
  };

  const setRole = async (id, role) => {
    const sb = await getSupabase();
    const { error } = await sb.from('profiles').update({ role }).eq('id', id);
    if (error) setErr(error.message);
    else fetchProfiles();
  };

  const badge = (ok) => ({
    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
    background: ok ? 'rgba(22,163,74,0.12)' : 'rgba(227,5,19,0.1)',
    color: ok ? DA.urgGrn : DA.red,
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', maxWidth: 390, margin: '0 auto', background: 'white', borderRadius: '16px 16px 0 0', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 12px', borderBottom: `1px solid ${DA.border}`, flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: DA.black }}>Administration</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: DA.gray, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
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
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

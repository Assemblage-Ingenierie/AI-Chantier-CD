import React, { useState, useEffect } from 'react';
import { getSupabase } from '../../supabase.js';
import { recoverPhotosFromStorage, cleanupDuplicatePhotos } from '../../lib/storage.js';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';

// Nom affichable : first/last si présents, sinon ancien full_name (compat), sinon email.
function fullName(p) {
  const fl = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  return fl || p.full_name || '';
}

export default function AdminPanel({ onClose, onPendingCountChange, currentUserId }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [showTools, setShowTools] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoverResult, setRecoverResult] = useState(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState(null);

  const fetchProfiles = async () => {
    setLoading(true); setErr('');
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.from('aichantier_profiles').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setProfiles(data);
      onPendingCountChange?.((data || []).filter(p => !p.is_approved).length);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  useEffect(() => { fetchProfiles(); }, []);
  useEffect(() => { const t = setInterval(fetchProfiles, 20000); return () => clearInterval(t); }, []);

  const setApproval = async (id, approved) => {
    setSavingId(id);
    const sb = await getSupabase();
    const { error } = await sb.from('aichantier_profiles').update({ is_approved: approved }).eq('id', id);
    if (error) setErr(error.message); else await fetchProfiles();
    setSavingId(null);
  };

  const setRole = async (id, role) => {
    setSavingId(id);
    const sb = await getSupabase();
    const { error } = await sb.from('aichantier_profiles').update({ role }).eq('id', id);
    if (error) setErr(error.message); else await fetchProfiles();
    setSavingId(null);
  };

  // Édition d'un champ de profil par l'admin (RLS : UPDATE via is_admin()). Mise à jour optimiste
  // locale → l'affichage se met à jour partout où le profil est lu (initiales « Mes projets », etc.).
  const updateField = async (id, field, value) => {
    const sb = await getSupabase();
    const clean = field === 'initials' ? (value || '').toUpperCase().trim() : (value || '').trim();
    const { error } = await sb.from('aichantier_profiles').update({ [field]: clean || null }).eq('id', id);
    if (error) { setErr(error.message); return; }
    setProfiles(prev => prev.map(p => p.id === id ? { ...p, [field]: clean || null } : p));
  };

  // Champ éditable inline (FONCTION, pas composant → pas de remontage au refresh 20 s, la saisie
  // en cours n'est jamais perdue). Bordure visible = on comprend qu'on peut écrire. Sauve au blur.
  const editCell = (p, field, { placeholder = '', maxLength, style } = {}) => (
    <input defaultValue={p[field] || ''} placeholder={placeholder} maxLength={maxLength}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      onBlur={e => { if ((e.target.value || '').trim() !== (p[field] || '')) updateField(p.id, field, e.target.value); }}
      style={{ width:'100%', boxSizing:'border-box', border:`1px solid ${DA.border}`, borderRadius:6, padding:'5px 7px', fontSize:13, fontFamily:'inherit', background:'white', outline:'none', ...style }}/>
  );

  const deleteProfile = async (id, email) => {
    if (!window.confirm(`Supprimer définitivement le compte « ${email} » ? Cette action est irréversible.`)) return;
    setSavingId(id);
    const sb = await getSupabase();
    const { error } = await sb.from('aichantier_profiles').delete().eq('id', id);
    if (error) setErr(error.message); else await fetchProfiles();
    setSavingId(null);
  };

  const handleRecover = async () => { setRecovering(true); setRecoverResult(null); setRecoverResult(await recoverPhotosFromStorage()); setRecovering(false); };
  const handleCleanup = async () => { setCleaning(true); setCleanResult(null); setCleanResult(await cleanupDuplicatePhotos()); setCleaning(false); };

  const pending  = profiles.filter(p => !p.is_approved);
  const approved = profiles.filter(p => p.is_approved);
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 760;

  // ── Contrôles réutilisés (desktop + mobile) ──
  const RoleSelect = ({ p }) => (
    <select value={p.role === 'admin' ? 'admin' : 'user'} disabled={savingId === p.id}
      onChange={e => setRole(p.id, e.target.value)}
      style={{ fontSize:13, padding:'6px 8px', borderRadius:7, border:`1px solid ${DA.border}`, background:'white', color:DA.black, cursor:'pointer', fontFamily:'inherit' }}>
      <option value="admin">Administrateur</option>
      <option value="user">Utilisateur</option>
    </select>
  );
  const RevokeBtn = ({ p }) => (
    <button onClick={() => setApproval(p.id, false)} disabled={savingId === p.id}
      style={{ fontSize:13, fontWeight:600, padding:'6px 14px', borderRadius:7, border:`1px solid #FCA5A5`, background:'white', color:DA.red, cursor:'pointer', whiteSpace:'nowrap' }}>
      Révoquer
    </button>
  );
  // Suppression définitive du compte — conservée (feature existante), discrète.
  const DeleteBtn = ({ p }) => (
    <button onClick={() => deleteProfile(p.id, p.email || p.id)} disabled={savingId === p.id}
      aria-label="Supprimer le compte" title="Supprimer définitivement le compte"
      style={{ width:34, height:34, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:7, border:`1px solid ${DA.border}`, background:'white', color:DA.grayL, cursor:'pointer' }}>
      <Ic n="del" s={15}/>
    </button>
  );

  return (
    <div className="modal-overlay-dark">
      <div className="modal-sheet-flex" style={{ maxWidth:1100 }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 18px 12px', borderBottom:`1px solid ${DA.border}`, flexShrink:0 }}>
          <div>
            <p style={{ fontWeight:800, fontSize:17, color:DA.black, margin:0 }}>Administration</p>
            <p style={{ fontSize:12, color:DA.grayL, margin:'2px 0 0' }}>Gestion des comptes utilisateurs</p>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <button onClick={fetchProfiles} aria-label="Rafraîchir" title="Rafraîchir"
              style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:600, padding:'7px 12px', borderRadius:8, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, cursor:'pointer' }}>
              <Ic n="rld" s={14}/> {isDesktop && 'Rafraîchir'}
            </button>
            <button onClick={onClose} aria-label="Fermer" style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL, width:40, height:40, display:'flex', alignItems:'center', justifyContent:'center' }}><Ic n="x" s={20}/></button>
          </div>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'16px 18px' }}>

          {err && <div style={{ padding:'8px 12px', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, fontSize:12, color:DA.red, marginBottom:12 }}>{err}</div>}

          {/* ── Demandes en attente ── */}
          {!loading && pending.length > 0 && (
            <div style={{ marginBottom:20 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:DA.red, display:'inline-block' }}/>
                <span style={{ fontSize:13, fontWeight:800, color:DA.red }}>{pending.length} demande{pending.length > 1 ? 's' : ''} en attente</span>
              </div>
              {pending.map(p => (
                <div key={p.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:9, background:'#FFF5F5', border:'1px solid rgba(185,28,28,0.2)', marginBottom:6 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:DA.black, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fullName(p) || p.email}</div>
                    <div style={{ fontSize:11, color:DA.gray, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.email}</div>
                  </div>
                  <button onClick={() => setApproval(p.id, true)} disabled={savingId === p.id}
                    style={{ fontSize:13, fontWeight:700, padding:'7px 16px', borderRadius:7, border:'none', background:DA.urgGrn, color:'white', cursor:'pointer', display:'flex', alignItems:'center', gap:6, whiteSpace:'nowrap' }}>
                    <Ic n="chk" s={14}/> Approuver
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Membres ── */}
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
            <Ic n="usr" s={15}/>
            <span style={{ fontSize:12, fontWeight:800, color:DA.gray, textTransform:'uppercase', letterSpacing:0.6 }}>Membres ({approved.length})</span>
          </div>

          {loading && <div style={{ padding:24, textAlign:'center', color:DA.gray, fontSize:13 }}>Chargement…</div>}

          {/* Desktop : tableau */}
          {!loading && isDesktop && (
            <div style={{ overflowX:'auto', border:`1px solid ${DA.border}`, borderRadius:10 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ background:DA.black }}>
                    {['Prénom', 'Nom', 'Initiales', 'Poste', 'E-mail', 'Statut', ''].map((h, i) => (
                      <th key={i} style={{ textAlign: i >= 5 ? 'right' : 'left', padding:'11px 14px', color:'white', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5, whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {approved.map((p, idx) => (
                    <tr key={p.id} style={{ borderTop: idx === 0 ? 'none' : `1px solid ${DA.grayXL}`, background:'white' }}>
                      <td style={{ padding:'8px 10px' }}>{editCell(p, 'first_name', { placeholder:'Prénom', style:{ fontWeight:700, color:DA.black } })}</td>
                      <td style={{ padding:'8px 10px' }}>{editCell(p, 'last_name', { placeholder:'Nom', style:{ fontWeight:700, color:DA.black } })}</td>
                      <td style={{ padding:'8px 10px' }}>{editCell(p, 'initials', { placeholder:'—', maxLength:4, style:{ fontWeight:800, letterSpacing:1, color:DA.red, textAlign:'center', textTransform:'uppercase', maxWidth:70 } })}</td>
                      <td style={{ padding:'8px 10px' }}>{editCell(p, 'job_title', { placeholder:'Poste', style:{ color:DA.red } })}</td>
                      <td style={{ padding:'11px 14px', color:DA.gray }}>{p.email}</td>
                      <td style={{ padding:'11px 14px', textAlign:'right', whiteSpace:'nowrap' }}>
                        {p.id === currentUserId && <span style={{ fontSize:11, color:DA.grayL, marginRight:8 }}>(vous)</span>}
                        <RoleSelect p={p}/>
                      </td>
                      <td style={{ padding:'11px 14px', textAlign:'right' }}>
                        <div style={{ display:'inline-flex', alignItems:'center', gap:6 }}><RevokeBtn p={p}/><DeleteBtn p={p}/></div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Mobile : cartes empilées */}
          {!loading && !isDesktop && approved.map(p => (
            <div key={p.id} style={{ border:`1px solid ${DA.border}`, borderRadius:10, padding:'12px', marginBottom:8, background:'white' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:7 }}>
                <span style={{ fontSize:12, color:DA.gray, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{p.email}</span>
                {p.id === currentUserId && <span style={{ fontSize:11, color:DA.grayL, flexShrink:0 }}>(vous)</span>}
              </div>
              <div style={{ display:'flex', gap:6, marginBottom:6 }}>
                {editCell(p, 'first_name', { placeholder:'Prénom', style:{ flex:1, fontWeight:700 } })}
                {editCell(p, 'last_name', { placeholder:'Nom', style:{ flex:1, fontWeight:700 } })}
              </div>
              <div style={{ display:'flex', gap:6 }}>
                {editCell(p, 'initials', { placeholder:'Init.', maxLength:4, style:{ width:70, flexShrink:0, textAlign:'center', textTransform:'uppercase', color:DA.red, fontWeight:800 } })}
                {editCell(p, 'job_title', { placeholder:'Poste', style:{ flex:1, color:DA.red } })}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10 }}>
                <RoleSelect p={p}/>
                <div style={{ flex:1 }}/>
                <RevokeBtn p={p}/>
                <DeleteBtn p={p}/>
              </div>
            </div>
          ))}

          {/* ── Outils (repliés par défaut) ── */}
          <div style={{ marginTop:20, borderTop:`1px solid ${DA.border}`, paddingTop:14 }}>
            <button onClick={() => setShowTools(v => !v)}
              style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, fontWeight:800, color:DA.gray, background:'none', border:'none', cursor:'pointer', textTransform:'uppercase', letterSpacing:0.5, padding:0 }}>
              <span style={{ display:'inline-block', transform: showTools ? 'rotate(180deg)' : 'none', transition:'transform 0.15s' }}><Ic n="chv" s={14}/></span>
              Outils de maintenance
            </button>
            {showTools && (
              <div style={{ marginTop:12 }}>
                <p style={{ fontSize:12, color:DA.gray, margin:'0 0 8px' }}>Scanne le Storage et recrée les enregistrements de photos manquants.</p>
                <button onClick={handleRecover} disabled={recovering}
                  style={{ fontSize:12, fontWeight:700, padding:'7px 16px', borderRadius:8, border:'none', background:DA.red, color:'white', cursor:recovering?'default':'pointer', opacity:recovering?0.6:1 }}>
                  {recovering ? 'Récupération…' : 'Récupérer les photos'}
                </button>
                {recoverResult && <div style={{ marginTop:8, fontSize:12, color:recoverResult.errors.length?DA.red:DA.urgGrn, fontWeight:600 }}>{recoverResult.recovered} photo(s) récupérée(s){recoverResult.errors.length > 0 && ` — ${recoverResult.errors.length} erreur(s)`}{recoverResult.recovered > 0 && ' — rechargez la page.'}</div>}

                <p style={{ fontSize:12, color:DA.gray, margin:'14px 0 8px' }}>Supprime les lignes de photos en double (conserve une copie par photo).</p>
                <button onClick={handleCleanup} disabled={cleaning}
                  style={{ fontSize:12, fontWeight:700, padding:'7px 16px', borderRadius:8, border:`1px solid ${DA.red}`, background:'white', color:DA.red, cursor:cleaning?'default':'pointer', opacity:cleaning?0.6:1 }}>
                  {cleaning ? 'Nettoyage…' : 'Nettoyer les photos en double'}
                </button>
                {cleanResult != null && <div style={{ marginTop:8, fontSize:12, color:DA.urgGrn, fontWeight:600 }}>{cleanResult} doublon(s) supprimé(s){cleanResult > 0 ? ' — rechargez la page.' : ''}</div>}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { saveMyProfile, suggestInitials, checkInitialsTaken } from '../../lib/profile.js';

// Fiche incomplète = première connexion depuis la MAJ → le modal s'ouvre automatiquement
// et bloque tant que Prénom / Nom / Initiales ne sont pas remplis (mode forceComplete).
export function isProfileIncomplete(profile) {
  if (!profile) return false; // profil pas encore chargé — ne pas bloquer à tort
  return !(profile.first_name || '').trim() || !(profile.last_name || '').trim() || !(profile.initials || '').trim();
}

// Page « Mon compte » — l'utilisateur édite sa propre fiche (RLS : sa ligne uniquement).
// Volontairement réduite à Prénom / Nom / Initiales : les initiales sont la clé du filtre
// « Mes projets » et du pré-chargement hors-ligne. Le Poste est géré par l'admin.
// Email en lecture seule : il provient de l'authentification, le changer casserait le login.
export default function AccountModal({ profile, session, onClose, onSaved, forceComplete = false }) {
  const uid = session?.user?.id || profile?.id;
  const email = session?.user?.email || profile?.email || '';
  const [f, setF] = useState({
    first_name: profile?.first_name || '',
    last_name:  profile?.last_name  || '',
    initials:   profile?.initials   || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [savedOk, setSavedOk] = useState(false);

  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); setSavedOk(false); setErr(''); };

  // Initiales : suggérées tant que l'utilisateur ne les a pas personnalisées.
  const autoInitials = suggestInitials({ ...f, email });
  const shownInitials = (f.initials || autoInitials).toUpperCase();

  const handleSave = async () => {
    if (!uid) { setErr('Session introuvable — reconnectez-vous.'); return; }
    if (!f.first_name.trim() || !f.last_name.trim()) { setErr('Prénom et nom sont obligatoires.'); return; }
    if (!/^[A-Z0-9]{2,5}$/.test(shownInitials)) { setErr('Initiales : 2 à 5 lettres (ex : TCM).'); return; }
    setSaving(true); setErr('');
    try {
      // Unicité : les initiales identifient l'ingénieur (filtre « Mes projets ») — jamais deux
      // comptes avec les mêmes. Contrôle serveur (RPC) ; sauté si migration pas encore appliquée.
      if (shownInitials !== (profile?.initials || '').toUpperCase()) {
        const taken = await checkInitialsTaken(shownInitials);
        if (taken) { setErr(`Les initiales « ${shownInitials} » sont déjà utilisées par un autre compte.`); setSaving(false); return; }
      }
      const saved = await saveMyProfile(uid, { first_name: f.first_name, last_name: f.last_name, initials: shownInitials });
      setSavedOk(true);
      onSaved?.(saved);
      setTimeout(onClose, 600);
    } catch (e) {
      setErr(e.message || 'Erreur lors de l\'enregistrement.');
    }
    setSaving(false);
  };

  const label = { display:'block', fontSize:11, fontWeight:700, color:DA.gray, marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 };
  const input = { width:'100%', border:`1px solid ${DA.border}`, borderRadius:8, padding:'10px 12px', fontSize:16, outline:'none', boxSizing:'border-box', background:'white' };

  return (
    <div className="modal-overlay-dark">
      <div className="modal-sheet" style={{ padding:20, maxWidth:480 }}>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:9 }}>
            <div style={{ width:38, height:38, borderRadius:'50%', background:DA.red, color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:14, flexShrink:0 }}>
              {shownInitials || <Ic n="usr" s={18}/>}
            </div>
            <p style={{ fontWeight:800, fontSize:16, color:DA.black, margin:0 }}>{forceComplete ? 'Bienvenue ! Complétez votre profil' : 'Mon compte'}</p>
          </div>
          {!forceComplete && (
            <button onClick={onClose} aria-label="Fermer" style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL, width:40, height:40, display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Ic n="x" s={20}/>
            </button>
          )}
        </div>

        {forceComplete && (
          <p style={{ fontSize:12.5, color:DA.gray, margin:'0 0 14px', lineHeight:1.5 }}>
            Vos initiales servent à retrouver <strong>vos projets</strong> et à les rendre disponibles
            <strong> hors ligne</strong> sur cet appareil. Une fois par compte, c'est tout.
          </p>
        )}

        <div style={{ display:'flex', gap:10, marginBottom:12 }}>
          <div style={{ flex:1 }}>
            <label style={label}>Prénom *</label>
            <input value={f.first_name} onChange={e => set('first_name', e.target.value)} placeholder="Prénom" style={input}/>
          </div>
          <div style={{ flex:1 }}>
            <label style={label}>Nom *</label>
            <input value={f.last_name} onChange={e => set('last_name', e.target.value)} placeholder="Nom" style={input}/>
          </div>
        </div>

        <div style={{ marginBottom:12 }}>
          <label style={label}>Initiales * <span style={{ fontWeight:400, textTransform:'none', letterSpacing:0 }}>(2 à 5 lettres, ex : TCM — uniques dans l'agence)</span></label>
          <input value={f.initials} onChange={e => set('initials', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
            placeholder={autoInitials} maxLength={5}
            style={{ ...input, textAlign:'center', letterSpacing:3, fontWeight:800, textTransform:'uppercase', fontSize:18 }}/>
        </div>

        <div style={{ marginBottom:16 }}>
          <label style={label}>E-mail</label>
          <input value={email} disabled readOnly
            style={{ ...input, background:DA.grayXL, color:DA.gray, cursor:'not-allowed' }}/>
          <p style={{ fontSize:11, color:DA.grayL, margin:'5px 2px 0' }}>
            L'e-mail est lié à votre connexion et ne peut pas être modifié ici.
          </p>
        </div>

        {err && <div style={{ padding:'8px 12px', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, fontSize:12, color:DA.red, marginBottom:12 }}>{err}</div>}

        <button onClick={handleSave} disabled={saving}
          style={{ width:'100%', background: savedOk ? DA.urgGrn : DA.red, color:'white', border:'none', borderRadius:12, padding:13, fontSize:14, fontWeight:800, cursor:saving?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
          {saving ? <Ic n="spn" s={15}/> : savedOk ? <Ic n="chk" s={15}/> : null}
          {saving ? 'Enregistrement…' : savedOk ? 'Enregistré' : forceComplete ? 'C\'est parti' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}

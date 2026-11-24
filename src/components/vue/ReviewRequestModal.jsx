import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { buildReviewMail, mailtoUrl, reviewLink, recentReviewers, rememberReviewer } from '../../lib/reviewRequest.js';
import { getMyName } from '../../lib/presence.js';

// « Faire relire » (demande Thomas 24/11) : prépare l'email de demande de relecture dans la
// messagerie de l'appareil (rien n'est envoyé sans l'utilisateur). Un destinataire, un point
// d'attention FACULTATIF, et c'est tout.
export default function ReviewRequestModal({ projet, visiteId, visiteLabel, onClose }) {
  const recents = recentReviewers();
  const [to, setTo] = useState(recents[0] || '');
  const [note, setNote] = useState('');
  const link = reviewLink(window.location.origin, projet.id, visiteId);
  const mail = buildReviewMail({ nom: projet.nom, visiteLabel, link, note, from: getMyName() });
  const ok = /\S+@\S+\.\S+/.test(to);

  const send = () => {
    if (!ok) return;
    rememberReviewer(to);
    // Navigation directe (et non window.open) : marche sur iOS Safari, Android et PC.
    window.location.href = mailtoUrl(to, mail);
    onClose();
  };
  const field = { width:'100%', boxSizing:'border-box', border:`1px solid ${DA.border}`, borderRadius:8, padding:'8px 10px', fontSize:14, fontFamily:'inherit', outline:'none' };

  return (
    <div className="modal-overlay" style={{ zIndex:60 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Faire relire le rapport"
        style={{ background:'white', borderRadius:14, width:'min(440px, calc(100vw - 32px))', padding:18, boxShadow:'0 12px 40px rgba(0,0,0,0.3)', display:'flex', flexDirection:'column', gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <Ic n="ml" s={16}/>
          <span style={{ fontSize:15, fontWeight:800, color:DA.black, flex:1 }}>Faire relire le rapport</span>
          <button onClick={onClose} aria-label="Fermer" style={{ border:'none', background:'#F3F4F6', borderRadius:'50%', width:28, height:28, cursor:'pointer', color:DA.gray }}>×</button>
        </div>
        <label style={{ display:'flex', flexDirection:'column', gap:4, fontSize:12, fontWeight:700, color:DA.gray }}>
          Relecteur (email)
          <input type="email" inputMode="email" autoComplete="email" list="relecteurs" value={to} onChange={e => setTo(e.target.value)}
            placeholder="prenom@assemblage.net" style={field} autoFocus={!to}/>
          <datalist id="relecteurs">{recents.map(r => <option key={r} value={r}/>)}</datalist>
        </label>
        <label style={{ display:'flex', flexDirection:'column', gap:4, fontSize:12, fontWeight:700, color:DA.gray }}>
          Un point dont tu n'es pas sûr ? <span style={{ fontWeight:500, color:DA.grayL }}>(facultatif, mis en avant dans l'email)</span>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
            placeholder="Ex. : le diagnostic de la poutre du porche, je doute du renfort proposé" style={{ ...field, resize:'vertical' }}/>
        </label>
        <div style={{ background:DA.grayXL, border:`1px solid ${DA.border}`, borderRadius:8, padding:'8px 10px', fontSize:11.5, color:DA.gray, lineHeight:1.45, whiteSpace:'pre-wrap', maxHeight:160, overflowY:'auto' }}>
          <strong style={{ color:DA.black }}>{mail.subject}</strong>{'\n\n'}{mail.body}
        </div>
        <button onClick={send} disabled={!ok}
          style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, border:'none', borderRadius:10, padding:'11px 14px', fontSize:14, fontWeight:800, color:'white', background: ok ? DA.red : '#D1D5DB', cursor: ok ? 'pointer' : 'default' }}>
          <Ic n="snd" s={14}/> Préparer l'email
        </button>
        <div style={{ fontSize:11, color:DA.grayL, textAlign:'center', marginTop:-4 }}>L'email s'ouvre dans ta messagerie : tu n'as plus qu'à l'envoyer.</div>
      </div>
    </div>
  );
}

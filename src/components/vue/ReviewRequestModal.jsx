import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { buildReviewMail, mailtoUrl, gmailUrl, reviewLink, recentReviewers, rememberReviewer } from '../../lib/reviewRequest.js';
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
  const [copied, setCopied] = useState(false);
  // Lien à coller dans un chat (demande Thomas 24/11) : ouvre la visite, onglet Rapport.
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); }
    catch {
      // Repli (ancien Safari / contexte non sécurisé) : sélection + copie.
      const ta = document.createElement('textarea'); ta.value = link; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  // Gmail (messagerie d'Assemblage) : nouveau message prérempli dans un nouvel onglet.
  const sendGmail = () => {
    if (!ok) return;
    rememberReviewer(to);
    window.open(gmailUrl(to, mail), '_blank', 'noopener');
    onClose();
  };
  // Autre messagerie (Outlook, Mail…) : lien mailto:, navigation directe (iOS Safari, Android, PC).
  const sendMailto = () => {
    if (!ok) return;
    rememberReviewer(to);
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
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span style={{ fontSize:12, fontWeight:700, color:DA.gray }}>Lien à envoyer (chat, SMS…) : il ouvre le rapport, modifiable</span>
          <div style={{ display:'flex', gap:6 }}>
            <input readOnly value={link} onFocus={e => e.target.select()} aria-label="Lien de relecture" style={{ ...field, fontSize:12, color:DA.gray }}/>
            <button onClick={copy}
              style={{ flexShrink:0, display:'flex', alignItems:'center', gap:5, border:'none', borderRadius:8, padding:'0 12px', fontSize:13, fontWeight:800, color:'white', background: copied ? '#15803D' : DA.black, cursor:'pointer' }}>
              <Ic n={copied ? 'chk' : 'cpy'} s={13}/>{copied ? 'Copié' : 'Copier'}
            </button>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:11, color:DA.grayL }}>
          <span style={{ flex:1, height:1, background:DA.border }}/>ou par email<span style={{ flex:1, height:1, background:DA.border }}/>
        </div>
        <label style={{ display:'flex', flexDirection:'column', gap:4, fontSize:12, fontWeight:700, color:DA.gray }}>
          Relecteur (email)
          <input type="email" inputMode="email" autoComplete="email" list="relecteurs" value={to} onChange={e => setTo(e.target.value)}
            placeholder="prenom@assemblage.net" style={field}/>
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
        <button onClick={sendGmail} disabled={!ok}
          style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, border:'none', borderRadius:10, padding:'11px 14px', fontSize:14, fontWeight:800, color:'white', background: ok ? DA.red : '#D1D5DB', cursor: ok ? 'pointer' : 'default' }}>
          <Ic n="snd" s={14}/> Ouvrir dans Gmail
        </button>
        <div style={{ fontSize:11, color:DA.grayL, textAlign:'center', marginTop:-4 }}>
          Le message s'ouvre prérempli dans Gmail : tu n'as plus qu'à cliquer sur Envoyer.{' '}
          <button onClick={sendMailto} disabled={!ok} style={{ border:'none', background:'none', padding:0, color: ok ? DA.gray : DA.grayL, textDecoration:'underline', fontSize:11, cursor: ok ? 'pointer' : 'default' }}>Autre messagerie</button>
        </div>
      </div>
    </div>
  );
}

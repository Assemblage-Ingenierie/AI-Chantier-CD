import React, { useState, useEffect } from 'react';
import { Ic } from './Icons.jsx';
import { subscribePendingUploads } from '../../lib/photoUploadQueue.js';

// Bandeau global (demande Thomas) : rassure sur le chantier sans réseau.
// - HORS LIGNE  → bandeau ambré + nombre de photos en attente d'envoi.
// - EN LIGNE avec file non vide → bandeau bleu discret « Envoi de N photos… » (spinner),
//   il disparaît dès que la file est vidée (drain auto).
// Lecture seule de l'état existant (navigator.onLine + file IndexedDB) : aucune écriture,
// aucune donnée touchée.
export default function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const unsub = subscribePendingUploads(setPending);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      if (unsub) unsub();
    };
  }, []);

  const offline = !online;
  // Rien à afficher : en ligne ET aucune photo en attente.
  if (!offline && pending === 0) return null;

  const bg = offline ? '#8A5A00' : '#1E3A5F';
  const label = offline
    ? (pending > 0
        ? `Hors ligne — ${pending} photo${pending > 1 ? 's' : ''} en attente d'envoi`
        : 'Hors ligne — tout est sauvegardé sur l’appareil')
    : `Envoi de ${pending} photo${pending > 1 ? 's' : ''}…`;
  const sub = offline ? 'Synchronisation automatique dès le retour du réseau' : null;

  return (
    <div style={{ position:'fixed', top:0, left:0, right:0, zIndex:9998,
      paddingTop:'env(safe-area-inset-top, 0px)', pointerEvents:'none', display:'flex', justifyContent:'center' }}>
      <div style={{ pointerEvents:'auto', margin:'8px 12px', maxWidth:520, width:'100%', boxSizing:'border-box',
        background:bg, color:'white', borderRadius:10, padding:'8px 14px',
        display:'flex', alignItems:'center', gap:10, boxShadow:'0 4px 18px rgba(0,0,0,0.28)' }}>
        <Ic n={offline ? 'wifioff' : 'spn'} s={18}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:700, fontSize:13, lineHeight:1.25 }}>{label}</div>
          {sub && <div style={{ fontSize:11, opacity:0.85, marginTop:1 }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

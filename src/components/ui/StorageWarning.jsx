import React, { useState, useEffect } from 'react';
import { Ic } from './Icons.jsx';
import { isStandalone, isMobile, isIOS, isStoragePersisted } from '../../lib/pwaInstall.js';

// Bandeau d'AVERTISSEMENT « version navigateur non installée » (retour Thomas : rollbacks de
// photos chez Pierre qui utilise le SITE, pas l'app installée). Un onglet Safari/Chrome non
// installé peut voir son stockage EFFACÉ par le téléphone (ITP iOS, pression mémoire) → perte
// de photos/modifs pas encore synchronisées. Ce bandeau n'apparaît QUE quand le risque est RÉEL
// (mobile, non installé, stockage persistant NON accordé) et invite à installer l'app pour
// fiabiliser. Discret et repliable ; masqué pour la session une fois « Compris ».
const DISMISS_KEY = 'aichantier_storage_warn_dismissed';

export default function StorageWarning() {
  const [atRisk, setAtRisk] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showHow, setShowHow] = useState(false);

  useEffect(() => {
    try { if (sessionStorage.getItem(DISMISS_KEY)) { setDismissed(true); return; } } catch {}
    // Seulement pertinent en mobile non installé. Sur desktop / PWA installée → jamais affiché.
    if (isStandalone() || !isMobile()) return;
    let alive = true;
    isStoragePersisted().then(ok => { if (alive && !ok) setAtRisk(true); });
    return () => { alive = false; };
  }, []);

  if (dismissed || !atRisk) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch {}
    setDismissed(true);
  };

  const ios = isIOS();

  return (
    <div style={{ position:'fixed', top:0, left:0, right:0, zIndex:9997,
      paddingTop:'env(safe-area-inset-top, 0px)', pointerEvents:'none', display:'flex', justifyContent:'center' }}>
      <div style={{ pointerEvents:'auto', margin:'8px 12px', maxWidth:520, width:'100%', boxSizing:'border-box',
        background:'#7A1F1F', color:'white', borderRadius:10, padding:'9px 12px',
        boxShadow:'0 4px 18px rgba(0,0,0,0.28)', fontSize:12.5, lineHeight:1.4 }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:9 }}>
          <span style={{ flexShrink:0, marginTop:1 }}><Ic n="alrt" s={16}/></span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:800 }}>Version navigateur — données à risque</div>
            <div style={{ opacity:0.92, marginTop:2 }}>
              Le téléphone peut effacer tes photos/notes non synchronisées. <strong>Installe l'app</strong> pour sécuriser tes données.
            </div>
            {showHow && (
              <div style={{ marginTop:7, background:'rgba(255,255,255,0.1)', borderRadius:8, padding:'8px 10px' }}>
                {ios ? (
                  <ol style={{ margin:0, paddingLeft:16 }}>
                    <li>Ouvre ce site dans <strong>Safari</strong></li>
                    <li>Appuie sur <strong>Partager</strong> (carré + flèche ↑) en bas</li>
                    <li><strong>« Sur l'écran d'accueil »</strong></li>
                  </ol>
                ) : (
                  <ol style={{ margin:0, paddingLeft:16 }}>
                    <li>Menu <strong>⋮</strong> du navigateur (en haut à droite)</li>
                    <li><strong>« Installer l'application »</strong> ou <strong>« Ajouter à l'écran d'accueil »</strong></li>
                  </ol>
                )}
              </div>
            )}
            <div style={{ display:'flex', gap:14, marginTop:7 }}>
              <button onClick={() => setShowHow(v => !v)}
                style={{ background:'none', border:'none', color:'white', textDecoration:'underline', cursor:'pointer', fontSize:12.5, fontWeight:700, padding:0 }}>
                {showHow ? 'Masquer' : 'Comment installer ?'}
              </button>
              <button onClick={dismiss}
                style={{ background:'none', border:'none', color:'rgba(255,255,255,0.75)', cursor:'pointer', fontSize:12.5, fontWeight:700, padding:0 }}>
                Compris
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

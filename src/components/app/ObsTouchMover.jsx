import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { orderZones, effectiveParentId } from '../../lib/zoneGroups.js';

// DÉPLACER UNE OBSERVATION AU DOIGT (téléphone — demande Thomas 16/11 : « supprime le menu
// Zone, tout en glisser-déposer »).
//
// Au téléphone, une zone pleine de photos fait plusieurs écrans : glisser jusqu'à une autre zone
// en faisant défiler serait pénible et imprécis. Donc, dès que le doigt bouge sur la poignée ⠿ :
//   • les zones s'affichent REPLIÉES en bandeaux, toutes sur un écran (défilement auto près des
//     bords s'il y en a beaucoup) ;
//   • la zone d'origine montre ses observations en lignes courtes → réordonner reste possible ;
//   • seul le TITRE suit le doigt ; on lâche sur le bandeau voulu (allumé en rouge).
// Lâcher hors cible = rien ne bouge. L'hôte (VueProjet) applique et propose « Annuler ».
//
// drag = { fromLocId, itemId, titre, x, y } (point de départ du doigt)
// onDone(target | null) ; target = { locId, idx } (idx = insérer AVANT cette observation ;
// null = à la fin de la zone).
const START_PX = 8; // le doigt doit bouger un peu : un simple appui ne déclenche rien

export default function ObsTouchMover({ drag, locs, onDone }) {
  const [active, setActive] = useState(false);
  const [pos, setPos] = useState({ x: drag.x, y: drag.y });
  const [over, setOver] = useState(null);
  const activeRef = useRef(false);
  const overRef = useRef(null);
  const posRef = useRef({ x: drag.x, y: drag.y });
  const scrollRef = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const move = (e) => {
      const t = e.touches?.[0];
      if (!t) return;
      if (!activeRef.current) {
        if (Math.hypot(t.clientX - drag.x, t.clientY - drag.y) < START_PX) return;
        activeRef.current = true;
        setActive(true);
      }
      e.preventDefault(); // pas de défilement de la page pendant le geste
      posRef.current = { x: t.clientX, y: t.clientY };
      setPos(posRef.current);
      const el = document.elementFromPoint(t.clientX, t.clientY)?.closest?.('[data-mdrop-loc]');
      const o = el ? { locId: el.dataset.mdropLoc, idx: el.dataset.mdropIdx != null ? Number(el.dataset.mdropIdx) : null } : null;
      const cur = overRef.current;
      if (!(o && cur && o.locId === cur.locId && o.idx === cur.idx) && !(o === null && cur === null)) { overRef.current = o; setOver(o); }
    };
    const end = () => { doneRef.current?.(activeRef.current ? overRef.current : null); };
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    // Défilement automatique de la liste des zones quand le doigt approche du haut / du bas.
    let raf = 0;
    const tick = () => {
      const sc = scrollRef.current;
      if (activeRef.current && sc) {
        const r = sc.getBoundingClientRect();
        const y = posRef.current.y;
        if (y < r.top + 70) sc.scrollTop -= Math.ceil((r.top + 70 - y) / 6);
        else if (y > r.bottom - 70) sc.scrollTop += Math.ceil((y - (r.bottom - 70)) / 6);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
      cancelAnimationFrame(raf);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;
  const zones = orderZones(locs || []) || [];
  const titre = (drag.titre || '').trim() || 'Observation';
  return createPortal(
    <div role="dialog" aria-label="Déplacer l'observation"
      style={{ position:'fixed', inset:0, zIndex:300, background:'#F5F5F5', display:'flex', flexDirection:'column',
        paddingTop:'env(safe-area-inset-top)', paddingBottom:'env(safe-area-inset-bottom)', touchAction:'none', userSelect:'none', WebkitUserSelect:'none' }}>
      <div style={{ padding:'14px 16px 10px', fontSize:13, color:DA.gray, fontWeight:700, display:'flex', alignItems:'center', gap:8 }}>
        <Ic n="srt" s={15}/> Lâche l&apos;observation sur sa zone
        <span style={{ marginLeft:'auto', fontSize:11.5, fontWeight:600, color:DA.grayL }}>ailleurs = annuler</span>
      </div>
      <div ref={scrollRef} style={{ flex:1, minHeight:0, overflowY:'auto', padding:'0 12px 24px' }}>
        {zones.map(loc => {
          const child = !!effectiveParentId(zones, loc);
          const isFrom = loc.id === drag.fromLocId;
          const on = over && over.locId === loc.id && over.idx == null;
          const items = loc.items || [];
          return (
            <div key={loc.id} style={{ marginLeft: child ? 18 : 0, marginBottom:8 }}>
              <div data-mdrop-loc={loc.id}
                style={{ display:'flex', alignItems:'center', gap:8, padding:'14px 14px', borderRadius:10,
                  background: on ? DA.redL : 'white', border:`2px solid ${on ? DA.red : DA.border}`,
                  boxShadow: on ? '0 4px 14px rgba(0,0,0,0.12)' : '0 1px 3px rgba(0,0,0,0.05)', transition:'background 0.08s, border-color 0.08s' }}>
                <span style={{ flex:1, minWidth:0, fontSize:14.5, fontWeight:800, color: on ? DA.red : DA.black, textTransform:'uppercase', letterSpacing:0.3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {loc.nom || 'Zone sans nom'}
                </span>
                <span style={{ fontSize:12, color:DA.grayL, flexShrink:0 }}>{isFrom ? 'zone actuelle' : `${items.length} obs.`}</span>
              </div>
              {/* Zone d'origine : ses observations en lignes courtes → on peut aussi réordonner. */}
              {isFrom && items.length > 1 && (
                <div style={{ margin:'4px 0 0 14px', display:'flex', flexDirection:'column', gap:3 }}>
                  {items.map((it, j) => {
                    const lineOn = over && over.locId === loc.id && over.idx === j;
                    const me = it.id === drag.itemId;
                    return (
                      <div key={it.id} data-mdrop-loc={loc.id} data-mdrop-idx={j}
                        style={{ padding:'10px 12px', borderRadius:8, fontSize:13.5, background:'white', color: me ? DA.grayL : DA.black,
                          border:`1px solid ${DA.border}`, borderTop: lineOn ? `3px solid ${DA.red}` : `1px solid ${DA.border}`,
                          opacity: me ? 0.5 : 1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {it.titre || 'Observation'}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Le titre suit le doigt */}
      <div aria-hidden="true"
        style={{ position:'fixed', left: Math.max(8, Math.min(pos.x - 20, (typeof window !== 'undefined' ? window.innerWidth : 400) - 228)), top: pos.y - 52,
          width:220, padding:'9px 12px', borderRadius:10, background:DA.black, color:'white', fontSize:13.5, fontWeight:700,
          boxShadow:'0 8px 24px rgba(0,0,0,0.3)', pointerEvents:'none', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', zIndex:301 }}>
        {titre}
      </div>
    </div>,
    document.body
  );
}

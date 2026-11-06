import React, { useMemo, useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from './Icons.jsx';

// « Voir ce qui change » entre une sauvegarde de l'appareil et le projet actuel (retour Thomas
// 06/11 : « à chaque fois j'ai peur que ça m'écrase des trucs »). Liste lisible, élément par
// élément ; seuls les éléments COCHÉS sont remis, rien n'est effacé (lib/backupDiff.js).
//   groups  : [{ projectId, nom, entries }]  (entries = diffBackup)
//   savedAt : date de la sauvegarde
//   onApply(selection) → { ok, added }        selection = [{ projectId, entries }]
const ICON = { project: '📁', visit: '🗓️', zone: '📍', item: '➕', text: '📝', photos: '📷' };
const LABEL = { project: 'Projet', visit: 'Visite', zone: 'Zone', item: 'Observation', text: 'Texte', photos: 'Photos' };

export default function BackupDiffPanel({ groups, savedAt, onApply, onClose }) {
  const [on, setOn] = useState(() => new Set(groups.flatMap(g => g.entries.filter(e => e.on && !e.info).map(e => `${g.projectId}|${e.key}`))));
  const [done, setDone] = useState(null);
  const n = on.size;
  const toggle = (k) => setOn(s => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; });
  const counts = useMemo(() => {
    const c = {};
    for (const g of groups) for (const e of g.entries) if (!e.info) c[e.kind] = (c[e.kind] || 0) + 1;
    return c;
  }, [groups]);
  const apply = () => {
    const selection = groups.map(g => ({ projectId: g.projectId, entries: g.entries.filter(e => on.has(`${g.projectId}|${e.key}`)) })).filter(s => s.entries.length);
    const r = onApply(selection);
    setDone(r?.ok ? `✓ ${r.added} élément${r.added > 1 ? 's' : ''} remis` : 'Impossible');
  };

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:500, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Ce qui change"
        style={{ width:560, maxWidth:'100%', maxHeight:'calc(100vh - 32px)', display:'flex', flexDirection:'column', background:'white', borderRadius:14, boxShadow:'0 12px 40px rgba(0,0,0,0.3)', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'14px 16px 10px', borderBottom:`1px solid ${DA.border}` }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:800, fontSize:15, color:DA.black }}>Ce que contient la sauvegarde</div>
            <div style={{ fontSize:12, color:DA.gray, marginTop:2, lineHeight:1.45 }}>
              Sauvegarde de cet appareil du {new Date(savedAt).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}, comparée à aujourd'hui
              {Object.keys(counts).length > 0 && ` : ${Object.entries(counts).map(([k, v]) => `${v} ${LABEL[k].toLowerCase()}${v > 1 ? 's' : ''}`).join(', ')}`}.
            </div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL, width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <Ic n="x" s={18}/>
          </button>
        </div>

        <div style={{ overflowY:'auto', padding:'8px 16px 12px' }}>
          {groups.map(g => {
            const byVisit = new Map();
            for (const e of g.entries) {
              const k = e.visitLabel || '';
              if (!byVisit.has(k)) byVisit.set(k, []);
              byVisit.get(k).push(e);
            }
            return (
              <div key={g.projectId} style={{ marginBottom:10 }}>
                {groups.length > 1 && <p style={{ fontSize:12, fontWeight:800, color:DA.black, margin:'8px 0 2px' }}>{g.nom || 'Projet'}</p>}
                {[...byVisit.entries()].map(([vLabel, es]) => (
                  <div key={vLabel}>
                    {vLabel && !es.every(e => e.kind === 'visit') && <p style={{ fontSize:11, fontWeight:800, color:DA.gray, textTransform:'uppercase', letterSpacing:0.5, margin:'10px 0 2px' }}>{vLabel}</p>}
                    {es.map(e => {
                      const k = `${g.projectId}|${e.key}`;
                      return (
                        <label key={k} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'8px 0', borderTop:`1px solid ${DA.grayXL}`, cursor: e.info ? 'default' : 'pointer' }}>
                          {e.info
                            ? <span style={{ width:16, flexShrink:0, textAlign:'center', marginTop:1 }}>ℹ️</span>
                            : <input type="checkbox" checked={on.has(k)} disabled={!!done} onChange={() => toggle(k)} style={{ accentColor:DA.red, marginTop:3, flexShrink:0 }}/>}
                          <div style={{ minWidth:0, flex:1 }}>
                            <div style={{ fontSize:13, fontWeight:700, color:DA.black }}>
                              <span style={{ marginRight:5 }}>{ICON[e.kind]}</span>{e.title}
                              {e.locNom && e.kind !== 'zone' && <span style={{ fontWeight:500, color:DA.grayL }}> · {e.locNom}</span>}
                            </div>
                            <div style={{ fontSize:11.5, color:DA.gray, marginTop:2, lineHeight:1.4 }}>{e.detail}</div>
                            {e.kind === 'text' && (
                              <div style={{ marginTop:5, fontSize:11.5, lineHeight:1.45, display:'grid', gap:3 }}>
                                <div><b style={{ color:DA.urgGrn }}>Sauvegarde :</b> {e.before}</div>
                                <div><b style={{ color:DA.gray }}>Aujourd'hui :</b> {e.after}</div>
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div style={{ padding:'10px 16px 14px', borderTop:`1px solid ${DA.border}`, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <span style={{ flex:'1 1 220px', fontSize:11.5, color:DA.gray, lineHeight:1.45 }}>
            Rien n'est effacé : seuls les éléments cochés sont ajoutés au projet. Un texte repris remplace l'actuel, qui reste dans la Corbeille.
          </span>
          {done
            ? <span style={{ fontSize:13, fontWeight:800, color: done.startsWith('✓') ? DA.urgGrn : DA.gray }}>{done}</span>
            : <button onClick={apply} disabled={!n}
                style={{ padding:'9px 14px', borderRadius:9, border:'none', background: n ? DA.red : DA.grayL, color:'white', fontSize:13, fontWeight:800, cursor: n ? 'pointer' : 'default', whiteSpace:'nowrap' }}>
                Remettre la sélection ({n})
              </button>}
        </div>
      </div>
    </div>
  );
}

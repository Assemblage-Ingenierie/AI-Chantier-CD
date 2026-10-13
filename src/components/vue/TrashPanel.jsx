import React, { useEffect, useMemo, useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { listDeletedItems } from '../../lib/recoveryBin.js';
import { listSnapshots, getSnapshot } from '../../lib/backupVault.js';
import { createAnnotScanner, createLostAnnotScanner } from '../../lib/annotRecovery.js';

// CORBEILLE DU PROJET (PC — demande Thomas 13/10/2026) : tout ce qui a été supprimé dans CE
// projet, au même endroit, restaurable en un clic — sans jamais rien écraser :
//   • zones supprimées ou fusionnées (avec leurs observations, plans et annotations) ;
//   • observations supprimées ;
//   • annotations disparues des plans (retrouvées dans les sauvegardes de l'appareil).
// Un élément revenu dans le projet (Annuler, restauration…) disparaît tout seul de la liste.

const fmtDate = (ts) => new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function TrashPanel({ projet, onClose, onRestoreZone, onRestoreObservation, onRestoreLostAnnots, onRestoreZoneAnnotations }) {
  const [bin, setBin] = useState(null);       // entrées zones + observations de CE projet
  const [lost, setLost] = useState(null);     // annotations disparues (zones existantes)
  const [mergeLost, setMergeLost] = useState(null); // annotations de zones fusionnées (ancienne fusion)
  const [done, setDone] = useState({});       // clé → message après restauration
  const multiVisits = (projet.visites || []).length > 1;

  useEffect(() => {
    let alive = true;
    listDeletedItems().then(all => { if (alive) setBin(all.filter(e => e.projectId === projet.id)); }).catch(() => alive && setBin([]));
    (async () => {
      try {
        const lostScan = createLostAnnotScanner(projet);
        const mergeScan = createAnnotScanner([projet]);
        for (const m of await listSnapshots()) {
          if (!alive) return;
          const s = await getSnapshot(m.ts);
          lostScan.add(s); mergeScan.add(s);
        }
        if (alive) { setLost(lostScan.entries()); setMergeLost(mergeScan.entries([projet])); }
      } catch { if (alive) { setLost([]); setMergeLost([]); } }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Ce qui existe AUJOURD'HUI dans le projet → masque ce qui est déjà revenu.
  const present = useMemo(() => {
    const locs = new Set(), items = new Set(), visitNom = new Map();
    (projet.visites || []).forEach((v, i) => {
      visitNom.set(v.id, v.label || `Visite ${i + 1}`);
      for (const l of (v.localisations || [])) {
        if (!l._mergedInto) locs.add(l.id);
        for (const it of (l.items || [])) items.add(it.id);
      }
    });
    return { locs, items, visitNom };
  }, [projet]);
  const planNom = (id) => (projet.planLibrary || []).find(p => p.id === id)?.nom || 'Plan';

  const zones = (bin || []).filter(e => e.kind === 'loc' && !present.locs.has(e.locId));
  const obs = (bin || []).filter(e => e.kind !== 'loc' && e.item?.id && !present.items.has(e.item.id));
  const annots = [...(mergeLost || []).map(e => ({ ...e, _merge: true })), ...(lost || [])];
  const scanning = lost == null || mergeLost == null;
  const empty = bin != null && !scanning && !zones.length && !obs.length && !annots.length;

  const run = (key, fn, entry) => {
    const res = fn ? fn(entry) : { ok: false };
    const added = res?.added;
    setDone(d => ({ ...d, [key]: res?.ok || added
      ? (res.already && !added ? 'Déjà présent' : '✓ Restauré')
      : (res?.reason === 'visite' ? 'Visite introuvable' : 'Impossible') }));
  };

  const where = (e) => [multiVisits ? present.visitNom.get(e.visiteId) : null, e.locNom].filter(Boolean).join(' › ');

  const Row = ({ k, icon, title, sub, onRestore, label = 'Restaurer' }) => (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderTop:`1px solid ${DA.grayXL}` }}>
      <span style={{ flexShrink:0, width:30, height:30, borderRadius:8, background:DA.grayXL, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15 }}>{icon}</span>
      <div style={{ minWidth:0, flex:1 }}>
        <div style={{ fontSize:13, fontWeight:700, color:DA.black, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{title}</div>
        <div style={{ fontSize:11, color:DA.grayL, marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{sub}</div>
      </div>
      {done[k]
        ? <span style={{ flexShrink:0, fontSize:12, fontWeight:700, color: done[k].startsWith('✓') ? DA.urgGrn : DA.gray }}>{done[k]}</span>
        : <button onClick={onRestore}
            style={{ flexShrink:0, padding:'6px 11px', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', border:`1.5px solid ${DA.red}`, background:'white', color:DA.red, whiteSpace:'nowrap' }}>
            {label}
          </button>}
    </div>
  );

  const Section = ({ title, n, children }) => n > 0 && (
    <div style={{ marginBottom:14 }}>
      <p style={{ fontSize:11, fontWeight:800, color:DA.gray, textTransform:'uppercase', letterSpacing:0.6, margin:'0 0 2px' }}>{title} ({n})</p>
      {children}
    </div>
  );

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:400 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Corbeille du projet"
        style={{ position:'absolute', top:58, right:16, width:440, maxWidth:'calc(100vw - 32px)', maxHeight:'calc(100vh - 80px)', display:'flex', flexDirection:'column',
          background:'white', borderRadius:14, boxShadow:'0 12px 40px rgba(0,0,0,0.25)', border:`1px solid ${DA.border}`, overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', gap:9, padding:'14px 16px 10px', borderBottom:`1px solid ${DA.border}` }}>
          <Ic n="del" s={17}/>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:800, fontSize:15, color:DA.black }}>Corbeille</div>
            <div style={{ fontSize:11, color:DA.grayL, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.nom}</div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL, width:34, height:34, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Ic n="x" s={18}/>
          </button>
        </div>

        <div style={{ overflowY:'auto', padding:'12px 16px 14px' }}>
          {bin == null && <p style={{ fontSize:12, color:DA.grayL, margin:0 }}>…</p>}

          <Section title="Zones" n={zones.length}>
            {zones.map(e => (
              <Row key={e.recId} k={e.recId} icon="📍" title={e.locNom || 'Zone'}
                sub={`${e.reason === 'fusion' ? `Regroupée sous « ${e.mergedInto?.nom || 'zone'} »` : 'Supprimée'} · ${(e.loc?.items || []).length} obs. · ${fmtDate(e.ts)}${multiVisits ? ` · ${present.visitNom.get(e.visiteId) || ''}` : ''}`}
                label={e.reason === 'fusion' ? 'Défaire le regroupement' : 'Restaurer'}
                onRestore={() => run(e.recId, onRestoreZone, e)}/>
            ))}
          </Section>

          <Section title="Observations" n={obs.length}>
            {obs.map(e => {
              const photoN = (e.item?.photos || []).filter(p => p && (p.data || p.storage_url)).length;
              return (
                <Row key={e.recId} k={e.recId} icon="📝" title={e.item?.titre || 'Observation sans titre'}
                  sub={`${where(e) || 'Zone'} · ${fmtDate(e.ts)}${photoN ? ` · ${photoN} photo${photoN > 1 ? 's' : ''}` : ''}`}
                  onRestore={() => run(e.recId, onRestoreObservation, e)}/>
              );
            })}
          </Section>

          <Section title="Annotations de plan" n={annots.length}>
            {annots.map(e => {
              const k = e._merge ? `m|${e.srcLocId}` : `a|${e.visiteId}|${e.locId}|${e.planId}`;
              return e._merge ? (
                <Row key={k} k={k} icon="✏️" title={`${e.count} annotation${e.count > 1 ? 's' : ''} de « ${e.srcNom || 'zone'} »`}
                  sub={`Perdues au regroupement sous « ${e.dstNom || 'zone'} » · vues le ${fmtDate(e.ts)}`} label="Remettre"
                  onRestore={() => run(k, onRestoreZoneAnnotations ? (x) => { const r = onRestoreZoneAnnotations([x]); return { ok: !!r?.added, added: r?.added }; } : null, e)}/>
              ) : (
                <Row key={k} k={k} icon="✏️" title={`${e.count} annotation${e.count > 1 ? 's' : ''} effacée${e.count > 1 ? 's' : ''} · ${planNom(e.planId)}`}
                  sub={`${where(e) || 'Zone'} · présentes le ${fmtDate(e.ts)}`} label="Remettre"
                  onRestore={() => run(k, onRestoreLostAnnots, e)}/>
              );
            })}
          </Section>

          {scanning && bin != null && (
            <p style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, color:DA.grayL, margin:'4px 0 0' }}>
              <Ic n="spn" s={12}/> Recherche des annotations effacées dans les sauvegardes de l'appareil…
            </p>
          )}

          {empty && (
            <p style={{ fontSize:12, color:DA.gray, margin:0, lineHeight:1.55 }}>
              La corbeille de ce projet est vide.<br/>
              <span style={{ color:DA.grayL }}>Les zones et observations supprimées, et les annotations effacées des plans, arrivent ici et se restaurent en un clic.</span>
            </p>
          )}

          {!empty && (
            <p style={{ fontSize:11, color:DA.grayL, margin:'6px 0 0', lineHeight:1.5 }}>
              Restaurer ajoute l'élément au projet, sans rien retirer ni écraser.
              {annots.length > 0 && ' Les annotations proviennent des sauvegardes de cet ordinateur.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

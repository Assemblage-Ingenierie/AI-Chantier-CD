import React, { useEffect, useMemo, useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { listDeletedItems } from '../../lib/recoveryBin.js';
import { listSnapshots, getSnapshot } from '../../lib/backupVault.js';
import { createAnnotScanner, createLostAnnotScanner, createLostItemScanner } from '../../lib/annotRecovery.js';
import { getDeletedIds } from '../../lib/tombstones.js';
import { listItemHistory, findOrphanStoragePhotos } from '../../lib/storage.js';
import { itemMetaFromRow } from '../../lib/obsDates.js';
import { ITEM_TEXT_FIELDS } from '../../lib/trash.js';

// CORBEILLE DU PROJET (PC — demande Thomas 13/10/2026) : tout ce qui a été supprimé dans CE
// projet, au même endroit, restaurable en un clic — sans jamais rien écraser :
//   • zones supprimées ou fusionnées (avec leurs observations, plans et annotations) ;
//   • observations supprimées ;
//   • annotations disparues des plans (retrouvées dans les sauvegardes de l'appareil).
// Un élément revenu dans le projet (Annuler, restauration…) disparaît tout seul de la liste.
// + (incident 26/10) versions précédentes du TEXTE des observations (historique tenu par la base,
//   migration 20261026) et photos détachées retrouvées dans le stockage (fichier intact, lien perdu).

// Observation (format app) à partir d'une ligne de l'historique serveur.
const itemFromRow = (r) => ({
  id: r.id, titre: r.titre ?? '', commentaire: r.commentaire ?? '', commentaireAlign: r.commentaire_align ?? 'left',
  suivi: r.suivi ?? 'rien', urgence: r.urgence ?? 'basse', statut: r.statut === 'brouillon' ? 'brouillon' : 'rapport',
  ...itemMetaFromRow(r.meta), photos: [], _photosHydrated: false,
});
const TEXT_DEFAULTS = { titre: '', commentaire: '', commentaireAlign: 'left', suivi: 'rien', urgence: 'basse', statut: 'rapport' };
const textKey = (it) => JSON.stringify(ITEM_TEXT_FIELDS.map(f => (f === 'statut' ? (it?.statut === 'brouillon' ? 'brouillon' : 'rapport') : (it?.[f] ?? TEXT_DEFAULTS[f] ?? null))));
const excerpt = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);

const fmtDate = (ts) => new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function TrashPanel({ projet, onClose, onRestoreZone, onRestoreObservation, onRestoreLostAnnots, onRestoreZoneAnnotations, onRestoreItemText, onRestoreStoragePhotos }) {
  const [bin, setBin] = useState(null);       // entrées zones + observations de CE projet
  const [lost, setLost] = useState(null);     // annotations disparues (zones existantes)
  const [mergeLost, setMergeLost] = useState(null); // annotations de zones fusionnées (ancienne fusion)
  const [lostItems, setLostItems] = useState(null); // observations disparues (sauvegardes de l'appareil)
  const [done, setDone] = useState({});       // clé → message après restauration
  const [hist, setHist] = useState(null);     // versions précédentes (historique serveur)
  const [orphans, setOrphans] = useState(null); // photos détachées : null | 'loading' | [...]
  const multiVisits = (projet.visites || []).length > 1;

  useEffect(() => {
    let alive = true;
    listDeletedItems().then(all => { if (alive) setBin(all.filter(e => e.projectId === projet.id)); }).catch(() => alive && setBin([]));
    listItemHistory(projet.id).then(h => { if (alive) setHist(h); }).catch(() => alive && setHist([]));
    (async () => {
      try {
        const lostScan = createLostAnnotScanner(projet);
        const mergeScan = createAnnotScanner([projet]);
        let tomb = new Set();
        try { tomb = getDeletedIds('item') || new Set(); } catch { /* sans pierres tombales : tout est proposé */ }
        const itemScan = createLostItemScanner(projet, tomb);
        for (const m of await listSnapshots()) {
          if (!alive) return;
          const s = await getSnapshot(m.ts);
          lostScan.add(s); mergeScan.add(s); itemScan.add(s);
        }
        if (alive) { setLost(lostScan.entries()); setMergeLost(mergeScan.entries([projet])); setLostItems(itemScan.entries()); }
      } catch { if (alive) { setLost([]); setMergeLost([]); setLostItems([]); } }
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
  // Observations disparues hors suppression (archiver/réactiver…), retrouvées dans les sauvegardes
  // de l'appareil ; celles déjà proposées par la corbeille (suppression volontaire) n'y sont pas.
  const binItemIds = new Set(obs.map(e => e.item.id));
  const lostObs = (lostItems || []).filter(e => !present.items.has(e.item.id) && !binItemIds.has(e.item.id));
  // Versions précédentes du texte (historique serveur) : seulement celles qui diffèrent du texte
  // actuel, sans doublon, 5 au plus par observation, dans une zone qui existe encore.
  const versions = useMemo(() => {
    const locVisit = new Map(), locNom = new Map(), current = new Map();
    for (const v of (projet.visites || [])) for (const l of (v.localisations || [])) {
      locVisit.set(l.id, v.id); locNom.set(l.id, l.nom);
      for (const it of (l.items || [])) current.set(it.id, it);
    }
    const binIds = new Set(obs.map(e => e.item.id));
    const seen = new Map(), out = [];
    for (const h of (hist || [])) {
      const r = h.old_row || {};
      if (!r.id || !locVisit.has(r.localisation_id)) continue;
      const cur = current.get(r.id);
      if (h.op === 'DELETE' && (cur || binIds.has(r.id))) continue;
      const item = itemFromRow(r);
      const k = textKey(item);
      if (cur && k === textKey(cur)) continue;
      const s = seen.get(r.id) || new Set();
      if (s.has(k) || s.size >= 5) continue;
      s.add(k); seen.set(r.id, s);
      out.push({ key: `h|${h.id}`, op: h.op, ts: h.changed_at, projectId: projet.id, visiteId: locVisit.get(r.localisation_id),
        locId: r.localisation_id, locNom: locNom.get(r.localisation_id), item, curTitre: cur?.titre });
    }
    return out;
  }, [hist, projet, obs]);
  const itemTitre = useMemo(() => {
    const m = new Map();
    for (const v of (projet.visites || [])) for (const l of (v.localisations || [])) for (const it of (l.items || [])) m.set(it.id, it.titre);
    return m;
  }, [projet]);
  const orphanGroups = useMemo(() => {
    if (!Array.isArray(orphans)) return [];
    const g = new Map();
    for (const f of orphans) { if (!g.has(f.itemId)) g.set(f.itemId, []); g.get(f.itemId).push(f); }
    return [...g.entries()].map(([itemId, files]) => ({ itemId, files }));
  }, [orphans]);
  const scanOrphans = async () => { setOrphans('loading'); setOrphans(await findOrphanStoragePhotos(projet)); };
  const runAsync = async (key, fn) => {
    setDone(d => ({ ...d, [key]: '…' }));
    const r = fn ? await fn() : { ok: false };
    setDone(d => ({ ...d, [key]: r?.ok ? `✓ ${r.added} remise${r.added > 1 ? 's' : ''}` : 'Impossible' }));
  };

  const annots = [...(mergeLost || []).map(e => ({ ...e, _merge: true })), ...(lost || [])];
  const scanning = lost == null || mergeLost == null || lostItems == null;
  const empty = bin != null && !scanning && !zones.length && !obs.length && !annots.length && !lostObs.length && !versions.length;

  const run = (key, fn, entry) => {
    const res = fn ? fn(entry) : { ok: false };
    const added = res?.added;
    setDone(d => ({ ...d, [key]: res?.ok || added
      ? (res.already && !added ? 'Déjà présent' : '✓ Restauré')
      : (res?.reason === 'visite' ? 'Visite introuvable' : 'Impossible') }));
  };

  const restoreAllLost = () => { for (const e of lostObs) if (!done[`l|${e.item.id}`]) run(`l|${e.item.id}`, onRestoreObservation, e); };
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

          <Section title="Observations disparues" n={lostObs.length}>
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 0 8px' }}>
              <span style={{ flex:1, fontSize:11.5, color:DA.gray, lineHeight:1.4 }}>Présentes dans les sauvegardes de cet ordinateur mais plus dans le projet (sans avoir été supprimées).</span>
              {lostObs.some(e => !done[`l|${e.item.id}`]) && (
                <button onClick={restoreAllLost}
                  style={{ flexShrink:0, padding:'7px 12px', borderRadius:8, fontSize:12, fontWeight:800, cursor:'pointer', border:'none', background:DA.red, color:'white', whiteSpace:'nowrap' }}>
                  Tout restaurer ({lostObs.filter(e => !done[`l|${e.item.id}`]).length})
                </button>
              )}
            </div>
            {lostObs.map(e => {
              const k = `l|${e.item.id}`;
              const photoN = (e.item?.photos || []).filter(p => p && (p.data || p.storage_url || p._id)).length;
              return (
                <Row key={k} k={k} icon="🩹" title={e.item?.titre || 'Observation sans titre'}
                  sub={`${where(e) || 'Zone'} · sauvegarde du ${fmtDate(e.ts)}${photoN ? ` · ${photoN} photo${photoN > 1 ? 's' : ''}` : ''}`}
                  onRestore={() => run(k, onRestoreObservation, e)}/>
              );
            })}
          </Section>

          <Section title="Versions précédentes du texte" n={versions.length}>
            <p style={{ fontSize:11.5, color:DA.gray, lineHeight:1.4, margin:'4px 0 6px' }}>
              Gardées par le serveur à chaque modification. « Rétablir » remet ce texte ; le texte actuel reste dans l'historique.
            </p>
            {versions.map(e => (
              <Row key={e.key} k={e.key} icon={e.op === 'DELETE' ? '📝' : '🕘'}
                title={e.item.titre || e.curTitre || 'Observation sans titre'}
                sub={`${where(e) || 'Zone'} · ${e.op === 'DELETE' ? 'supprimée' : 'version'} du ${fmtDate(e.ts)}${excerpt(e.item.commentaire) ? ` · « ${excerpt(e.item.commentaire)} »` : ''}`}
                label="Rétablir"
                onRestore={() => run(e.key, onRestoreItemText, e)}/>
            ))}
          </Section>

          {onRestoreStoragePhotos && (
            <div style={{ marginBottom:14 }}>
              <p style={{ fontSize:11, fontWeight:800, color:DA.gray, textTransform:'uppercase', letterSpacing:0.6, margin:'0 0 2px' }}>
                Photos détachées{Array.isArray(orphans) ? ` (${orphans.length})` : ''}
              </p>
              {orphans == null && (
                <button onClick={scanOrphans}
                  style={{ marginTop:4, padding:'6px 11px', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', border:`1.5px solid ${DA.border}`, background:'white', color:DA.black }}>
                  Chercher les photos détachées de ce projet
                </button>
              )}
              {orphans === 'loading' && <p style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, color:DA.grayL, margin:'4px 0 0' }}><Ic n="spn" s={12}/> Recherche dans le stockage…</p>}
              {Array.isArray(orphans) && !orphans.length && <p style={{ fontSize:12, color:DA.grayL, margin:'4px 0 0' }}>Aucune photo détachée : toutes les photos stockées sont reliées.</p>}
              {orphanGroups.map(g => {
                const k = `p|${g.itemId}`;
                return (
                  <div key={k} style={{ padding:'9px 0', borderTop:`1px solid ${DA.grayXL}` }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ minWidth:0, flex:1, fontSize:13, fontWeight:700, color:DA.black, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {itemTitre.get(g.itemId) || 'Observation'} · {g.files.length} photo{g.files.length > 1 ? 's' : ''}
                      </div>
                      {done[k]
                        ? <span style={{ flexShrink:0, fontSize:12, fontWeight:700, color: done[k].startsWith('✓') ? DA.urgGrn : DA.gray }}>{done[k]}</span>
                        : <button onClick={() => runAsync(k, () => onRestoreStoragePhotos(projet.id, g.itemId, g.files))}
                            style={{ flexShrink:0, padding:'6px 11px', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', border:`1.5px solid ${DA.red}`, background:'white', color:DA.red, whiteSpace:'nowrap' }}>
                            Remettre
                          </button>}
                    </div>
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:6 }}>
                      {g.files.map(f => f.url
                        ? <img key={f.path} src={f.url} alt="" loading="lazy" style={{ width:44, height:44, objectFit:'cover', borderRadius:5, background:DA.grayXL }}/>
                        : <span key={f.path} style={{ width:44, height:44, borderRadius:5, background:DA.grayXL }}/>)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

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
              Restaurer ajoute l'élément au projet, sans rien retirer ni écraser{versions.length > 0 && ' (« Rétablir » remplace le texte, l\'ancien reste dans l\'historique)'}.
              {annots.length > 0 && ' Les annotations proviennent des sauvegardes de cet ordinateur.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

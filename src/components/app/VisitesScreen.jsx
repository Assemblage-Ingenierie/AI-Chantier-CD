import React, { useState, useRef, useEffect } from 'react';
import { DA, SUIVI, URGENCE } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { callAIProxy } from '../../lib/aiProxy.js';
import SyncBadge from '../ui/SyncBadge.jsx';
import { useUiScale, uiScaleClass } from '../../lib/uiPrefs.js';
import IngenieursEditor, { splitInitials } from '../ui/IngenieursEditor.jsx';
import { remapParentIds } from '../../lib/zoneGroups.js';
import BulkReportExport from './BulkReportExport.jsx';
import { scanVisitBackups, buildRestoredVisit, markVisitRecovery, loadRecoveryMemo, listVisitVersions, visitSignature } from '../../lib/visitRecovery.js';
import { getDeletedIds } from '../../lib/tombstones.js';

// État de sync d'une visite pour son badge (V2) :
//  - pinned    : épinglée hors-ligne (photos + plans pré-téléchargés)
//  - notloaded : contient des observations dont les photos ne sont pas encore en cache local
//                (elles se téléchargent à l'ouverture — « ne charger que les visites qu'on ouvre »)
//  - synced    : rien à signaler
function visiteSyncState(v, pinned) {
  if (pinned) return 'pinned';
  const items = (v.localisations || []).flatMap(l => l.items || []);
  if (items.length > 0 && !items.every(it => it._photosHydrated)) return 'notloaded';
  return 'synced';
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const VSUMMARY_KEY = '_aivsummaries_v1';
const loadVSummaryCache = () => { try { return JSON.parse(localStorage.getItem(VSUMMARY_KEY) || '{}'); } catch { return {}; } };
const saveVSummaryCache = (o) => { try { localStorage.setItem(VSUMMARY_KEY, JSON.stringify(o)); } catch {}; };

// Récap PERSO détaillé (3-4 phrases, à la demande) — stocké EN LOCAL (par appareil), jamais dans
// le projet ni dans le rapport (demande Thomas : « en perso, pour que moi j'aie mon récap en tête »).
const VRECAP_KEY = '_aivrecap_v1';
const loadVRecapCache = () => { try { return JSON.parse(localStorage.getItem(VRECAP_KEY) || '{}'); } catch { return {}; } };
const saveVRecapCache = (o) => { try { localStorage.setItem(VRECAP_KEY, JSON.stringify(o)); } catch {}; };

export default function VisitesScreen({ projet, onBack, onSelectVisite, onUpdateProjet, syncStatus = 'ok', onRefresh = null, refreshing = false,
  dirty = false, stale = false, visitMode = false, onToggleVisitMode = null, pinnedVisites = new Set(), onPinVisite = null, onUnpinVisite = null, onHydrateVisite = null }) {
  const visites = projet.visites || [];
  // Export groupé de tous les rapports en zip (PC uniquement — demande Thomas).
  const [bulkOpen, setBulkOpen] = useState(false);
  const isPcWide = typeof window !== 'undefined' && window.innerWidth >= 900;
  const uiScale = useUiScale();
  const [pinningId, setPinningId] = useState(null); // visite en cours de pré-téléchargement

  const togglePin = async (e, visiteId) => {
    e.stopPropagation();
    if (pinnedVisites.has(visiteId)) { onUnpinVisite?.(visiteId); return; }
    setPinningId(visiteId);
    try { await onPinVisite?.(projet.id, visiteId); }
    finally { setPinningId(null); }
  };
  const [editingId, setEditingId] = useState(null); // visite en mode édition
  const [dupSourceId, setDupSourceId] = useState(null); // visite à dupliquer (choix photos en attente)
  const [dupLoading, setDupLoading] = useState(false);  // photos de la visite en cours de chargement
  // Visites retrouvées dans les sauvegardes de l'appareil (lib/visitRecovery.js) — incident 26/10.
  const [recovery, setRecovery] = useState([]);
  // Signature : nb d'observations + photos chargées → nouveau scan quand les photos d'une visite arrivent.
  const itemSig = visites.reduce((n, v) => n + (v.localisations || []).reduce((m, l) => m + (l.items || []).reduce((k, it) => k + 1 + (it._photosHydrated ? 1000 * (1 + (it.photos || []).length) : 0), 0), 0), 0);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      scanVisitBackups(projet, { tombItems: getDeletedIds('item'), memo: loadRecoveryMemo() })
        .then(list => { if (alive) setRecovery(list); })
        .catch(() => {});
    }, 1500); // après l'affichage (et l'arrivée du serveur) : jamais bloquant
    return () => { alive = false; clearTimeout(t); };
    // projet lu au moment du scan ; relancé si le projet ou son nombre d'observations change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projet.id, itemSig]);
  // Choix manuel parmi toutes les versions gardées sur l'appareil.
  const [versions, setVersions] = useState(null); // null | { loading } | { count, oldest, visits }
  const openVersions = () => {
    setVersions({ loading: true });
    listVisitVersions(projet.id).then(setVersions).catch(() => setVersions({ count: 0, oldest: null, visits: [] }));
  };
  const restoreVersion = (g, ver) => {
    const when = new Date(ver.ts).toLocaleString('fr-FR');
    if (!window.confirm(`Restaurer « ${g.label} » telle qu'enregistrée le ${when} (${ver.items} obs, ${ver.photos} photos) ?\n\nElle sera ajoutée À CÔTÉ : rien n'est écrasé.`)) return;
    const { visit, droppedPhotos } = buildRestoredVisit(ver.visit, projet, undefined, { item: getDeletedIds('item'), loc: getDeletedIds('loc') });
    onUpdateProjet({ visites: [...visites, { ...visit, label: `${g.label} (restaurée ${new Date(ver.ts).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })})` }] });
    setVersions(null);
    if (droppedPhotos > 0) window.alert(`Visite restaurée. ${droppedPhotos} photo${droppedPhotos > 1 ? 's' : ''} sans lien connu : un administrateur peut les relier via Administration → « Récupérer les photos ».`);
  };
  const restoreVisit = (c) => {
    const when = new Date(c.ts).toLocaleString('fr-FR');
    const msg = `Restaurer « ${c.label} » telle qu'enregistrée sur cet appareil le ${when} (${c.items} observation${c.items > 1 ? 's' : ''}) ?\n\n`
      + (c.exists ? 'Elle sera ajoutée À CÔTÉ de la visite actuelle (« restaurée ») : rien n\'est écrasé.' : 'Elle sera remise dans le projet.');
    if (!window.confirm(msg)) return;
    const { visit, droppedPhotos } = buildRestoredVisit(c.visit, projet, undefined, { item: getDeletedIds('item'), loc: getDeletedIds('loc') });
    onUpdateProjet({ visites: [...visites, visit] });
    markVisitRecovery(c.visitId, c.ts);
    setRecovery(r => r.filter(x => x.visitId !== c.visitId));
    if (droppedPhotos > 0) window.alert(`Visite restaurée. ${droppedPhotos} photo${droppedPhotos > 1 ? 's' : ''} sans lien connu : un administrateur peut les relier via Administration → « Récupérer les photos ».`);
  };
  // Toujours la version À JOUR de la visite (photos hydratées entre-temps), pas un instantané.
  const dupSource = dupSourceId ? (visites.find(v => v.id === dupSourceId) || null) : null;
  const setDupSource = (v) => setDupSourceId(v ? v.id : null);
  const [visitSummaries, setVisitSummaries] = useState(() => loadVSummaryCache());
  const summaryGenRef = useRef(false);
  const [visitRecaps, setVisitRecaps] = useState(() => loadVRecapCache());
  const [recapErr, setRecapErr] = useState({});     // id → message d'erreur (affiché sur la tuile)

  // Récap perso — 100 % LOCAL, sans IA (fiable, instantané, pas de quota). SÉLECTIF (retour Thomas) :
  // on met en avant les urgences + les sujets structure/défauts, et on écarte les rappels
  // administratifs/sécurité génériques (« port du casque » = osef). Coupe propre aux mots.
  const RECAP_SKIP = /(casque|\bepi\b|port du|s[ée]curit|propret|nettoyage|balisage|signal[ée]tique|rappel g[ée]n[ée]ral|g[ée]n[ée]ralit|convocation|prochaine r[ée]union)/i;
  const RECAP_KEY  = /(fissur|mur|dalle|poutre|fondation|b[ée]ton|coul[ée]|[ée]tanch|infiltrat|effondr|d[ée]form|corrosion|armature|ferraill|r[ée]seau|vrd|terrass|sout[èe]n|charpente|plancher|structure|appui|charge|d[ée]sordre|affaiss|reprise|[ée]taiement|acrot|linteau)/i;
  const saveRecap = (id, text) => {
    const next = { ...loadVRecapCache(), [id]: text };
    saveVRecapCache(next);      // cache local immédiat (par appareil)
    setVisitRecaps(next);
    patchVisite(id, { recap: text }); // + persiste SUR la visite (synchro : survit au cache, multi-appareils)
  };
  const genRecap = (v) => {
    if (!v?.id) return;
    setRecapErr(e => { const n = { ...e }; delete n[v.id]; return n; });
    const zones = (v.localisations || []).filter(l => (l.items || []).length);
    const items = zones.flatMap(l => (l.items || []).map(it => ({ zone: l.nom, ...it })));
    if (!items.length) { setRecapErr(e => ({ ...e, [v.id]: 'Aucune observation à résumer' })); return; }
    const urg = items.filter(it => it.urgence === 'haute');
    const both = (it) => `${it.titre || ''} ${stripHtml(it.commentaire || '')}`;
    const isOsef = (it) => it.urgence !== 'haute' && RECAP_SKIP.test(both(it)) && !RECAP_KEY.test(both(it));
    let kept = items.filter(it => !isOsef(it));
    if (!kept.length) kept = items;
    const header = `${zones.length} zone${zones.length > 1 ? 's' : ''}, ${items.length} observation${items.length > 1 ? 's' : ''}${urg.length ? `, ${urg.length} urgente${urg.length > 1 ? 's' : ''}` : ''}.`;

    // SYNTHÈSE LOCALE, DÉTERMINISTE et FIGÉE : 1 puce = idée principale (titre, sinon 1re phrase,
    // coupée proprement aux mots si vraiment longue). Générée UNE fois puis gravée (aucune réécriture
    // IA en arrière-plan — retour Thomas : « ça doit rester gravé dans le marbre, ne plus changer »).
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const firstSentence = (c) => { const m = c.match(/^.*?[.!?](?=\s|$)/); return (m ? m[0] : c).trim(); };
    // Idée principale d'une observation : le titre s'il est informatif ; sinon (ou si le titre est
    // GÉNÉRIQUE, type « Avancement… ») la 1re phrase du commentaire, qui porte la vraie info.
    const idea = (it) => {
      const t = (it.titre || '').trim().replace(/\s+/g, ' ');
      const c = stripHtml(it.commentaire || '').replace(/\s+/g, ' ').trim();
      const cs = c ? firstSentence(c) : '';
      let s = t;
      if (!s || s.length < 4) s = cs;
      else if (cs && /^(avancement|suivi|point|observation|divers|r[ae]s|g[ée]n[ée]ral)\b/i.test(t) && norm(cs) !== norm(t)) s = cs;
      if (s.length > 120) { s = s.slice(0, 120); const sp = s.lastIndexOf(' '); if (sp > 70) s = s.slice(0, sp); s += '…'; }
      return s;
    };
    // 1 puce = 1 observation. On ÉVITE la redondance « Zone — Zone… » (retour Thomas : récap
    // « pas ouf ») : si l'idée nomme déjà la zone, on n'ajoute pas le préfixe de zone.
    const line = (it) => {
      const txt = idea(it);
      if (!txt) return '';
      const zone = (it.zone || '').trim();
      const showZone = zone && !norm(txt).includes(norm(zone));
      return `• ${it.urgence === 'haute' ? '⚠ ' : ''}${showZone ? `${zone} — ` : ''}${txt}`;
    };
    const localBody = kept.map(line).filter(l => l.replace(/[•⚠\s—-]/g, '')).join('\n');
    saveRecap(v.id, `${header}\n${localBody}`);
  };

  // Auto-génère un résumé thématique par visite (ex: "Étanchéité, démolition, SOGED")
  useEffect(() => {
    if (summaryGenRef.current) return;
    const cache = loadVSummaryCache();
    const missing = visites.filter(v => {
      if (!v.id || cache[v.id]) return false;
      const items = (v.localisations || []).flatMap(l => l.items || []);
      return items.some(it => it.titre || it.commentaire);
    });
    if (missing.length === 0) return;
    summaryGenRef.current = true;
    (async () => {
      try {
        const blocks = missing.slice(0, 8).map(v => {
          const items = (v.localisations || []).flatMap(l => l.items || []);
          const lines = items.slice(0, 25).map(it => {
            const txt = stripHtml(it.commentaire || '').slice(0, 80);
            return (it.titre || txt || '').slice(0, 60);
          }).filter(Boolean).join(' / ');
          return `id=${v.id} | ${lines}`;
        }).join('\n---\n');
        const r = await callAIProxy({
          feature: 'visite_summaries',
          messages: [{ role: 'user', content: `Pour chaque visite de chantier, génère un résumé thématique très court (5 à 9 mots, style télégraphique, majuscule initiale, sans point final). Capture les grands thèmes, corps de métier ou sujets principaux. Exemple: "Étanchéité, gros œuvre, suivi démolition SOGED". N'utilise jamais de tiret cadratin ni demi-cadratin (« — » ou « – ») : sépare par des virgules.\nRéponds UNIQUEMENT avec un JSON valide: {"id": "résumé thématique"}\n\n${blocks}` }]
        });
        const raw = r.content?.[0]?.text || '';
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          const newCache = { ...loadVSummaryCache(), ...parsed };
          saveVSummaryCache(newCache);
          setVisitSummaries(s => ({ ...s, ...parsed }));
        }
      } catch {}
    })();
  }, [projet.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatDate = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' })
    : 'Ajouter une date';

  // ── Drag reorder ──────────────────────────────────────────────────────────
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const dragDidMove = useRef(false);
  const listRef     = useRef(null);

  // Touch drag
  const touchRef       = useRef(null);
  const ghostRef       = useRef(null);
  const wrapperRef     = useRef(null);
  const onTouchMoveRef = useRef(null);
  const onTouchEndRef  = useRef(null);

  useEffect(() => {
    onTouchMoveRef.current = onGripTouchMove;
    onTouchEndRef.current  = onGripTouchEnd;
  });
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const move = (e) => onTouchMoveRef.current(e);
    const end  = (e) => onTouchEndRef.current(e);
    el.addEventListener('touchmove',   move, { passive: false });
    el.addEventListener('touchend',    end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchmove',   move);
      el.removeEventListener('touchend',    end);
      el.removeEventListener('touchcancel', end);
    };
  }, []);

  const onGripTouchStart = (e, idx) => {
    const touch = e.touches[0];
    dragDidMove.current = false;
    touchRef.current = { idx, startY: touch.clientY, curOverIdx: idx };
    setDragIdx(idx);
    const row = listRef.current?.children[idx];
    if (row) {
      const clone = row.cloneNode(true);
      clone.style.cssText = `position:fixed;left:${row.getBoundingClientRect().left}px;top:${touch.clientY - row.offsetHeight/2}px;width:${row.offsetWidth}px;opacity:0.85;background:white;boxShadow:0 8px 24px rgba(0,0,0,0.25);borderRadius:8px;zIndex:9998;pointerEvents:none;border:2px solid ${DA.red};`;
      document.body.appendChild(clone);
      ghostRef.current = clone;
    }
  };

  const onGripTouchMove = (e) => {
    if (!touchRef.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    dragDidMove.current = true;
    if (ghostRef.current) {
      const row = listRef.current?.children[touchRef.current.idx];
      if (row) ghostRef.current.style.top = `${touch.clientY - row.offsetHeight/2}px`;
    }
    if (!listRef.current) return;
    const listRect = listRef.current.getBoundingClientRect();
    const relY = touch.clientY - listRect.top;
    let cumH = 0, newOver = visites.length - 1;
    for (let j = 0; j < listRef.current.children.length; j++) {
      const h = listRef.current.children[j].offsetHeight;
      if (relY < cumH + h / 2) { newOver = j; break; }
      cumH += h;
    }
    touchRef.current.curOverIdx = newOver;
    setOverIdx(newOver);
  };

  const onGripTouchEnd = () => {
    if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null; }
    if (!touchRef.current) return;
    const { idx, curOverIdx } = touchRef.current;
    touchRef.current = null;
    if (dragDidMove.current && idx !== curOverIdx) {
      const next = [...visites];
      const [moved] = next.splice(idx, 1);
      next.splice(curOverIdx, 0, moved);
      onUpdateProjet({ visites: next });
    }
    setDragIdx(null); setOverIdx(null);
  };

  const onDragStart = (i) => { setDragIdx(i); dragDidMove.current = false; };
  const onDragEnter = (i) => { setOverIdx(i); dragDidMove.current = true; };
  const onDragEnd   = () => {
    if (dragDidMove.current && dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const next = [...visites];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(overIdx, 0, moved);
      onUpdateProjet({ visites: next });
    }
    setDragIdx(null); setOverIdx(null); dragDidMove.current = false;
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const patchVisite = (visiteId, patch) =>
    onUpdateProjet({ visites: visites.map(v => v.id === visiteId ? { ...v, ...patch } : v) });

  // Clic « Dupliquer » → on demande d'abord AVEC ou SANS les photos (demande Thomas : une
  // nouvelle visite réutilise souvent la trame mais avec de nouvelles photos).
  // Les photos d'une visite pas encore ouverte sur cet appareil ne sont pas chargées
  // (lazy loading) → sans ça, la visite paraissait « sans photo » et la question n'était
  // pas posée (retour Thomas). On les charge d'abord, la boîte attend.
  const duplicateVisite = async (e, sourceId) => {
    e.stopPropagation();
    const source = visites.find(v => v.id === sourceId);
    if (!source) return;
    setDupSource(source);
    if (visiteSyncState(source, false) !== 'notloaded' || !onHydrateVisite) return;
    setDupLoading(true);
    try { await onHydrateVisite(sourceId); } catch { /* hors ligne : on duplique ce qu'on a */ }
    finally { setDupLoading(false); }
  };

  // keepPhotos=false → items conservés (intitulé, commentaire, urgence…) mais SANS photos.
  // On NE navigue PAS dans la copie : on reste sur la liste, la copie s'ouvre en mode édition
  // pour renommer / ajuster les ingénieurs tout de suite (demande Thomas).
  const performDuplicate = (source, keepPhotos) => {
    if (!source) return;
    const newId = crypto.randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    // Duplication SANS photos : les marqueurs VXX (type 'viewpoint') sur les plans pointaient vers
    // les photos supprimées → ils ne correspondent plus à rien. On les retire (+ l'image cuite
    // `exported` qui les montre encore) pour un plan propre (retour Thomas). Les autres annotations
    // (flèches, texte, symboles) sont conservées. Avec photos : on garde tout tel quel.
    const cleanAnn = (ann) => {
      if (!ann) return ann ?? null;
      if (keepPhotos) return { ...ann };
      const paths = (ann.paths || []).filter(p => p.type !== 'viewpoint');
      // eslint-disable-next-line no-unused-vars
      const { exported, ...rest } = ann; // retire le composite cuit → re-rendu sans les VXX
      return { ...rest, paths };
    };
    // Nouveaux id de zones connus d'avance → les sous-zones (« R+4 › M. Albert Thomas ») restent
    // rangées dans la COPIE de leur groupe (remapParentIds), pas dans celui de la visite d'origine.
    const zoneIdMap = new Map((source.localisations || []).map(loc => [loc.id, crypto.randomUUID()]));
    const localisations = remapParentIds((source.localisations || []).map(loc => ({
      ...loc,
      id: zoneIdMap.get(loc.id),
      planAnnotations: cleanAnn(loc.planAnnotations),
      extraPlans: (loc.extraPlans || []).map(ep => ({ ...ep, planAnnotations: cleanAnn(ep.planAnnotations) })),
      items: (loc.items || []).map(item => ({
        ...item,
        id: crypto.randomUUID(),
        // Nouveaux _id stables pour chaque photo → évite doublon d'ID dans le batch upsert Supabase.
        photos: keepPhotos
          ? (item.photos || []).map(ph => ({ ...ph, _id: crypto.randomUUID(), id: undefined }))
          : [],
        // Plans PROPRES aux observations : mêmes marqueurs VXX à nettoyer si sans photos.
        ...(keepPhotos ? {} : { plans: (item.plans || []).map(pl => ({ ...pl, planAnnotations: cleanAnn(pl.planAnnotations) })) }),
      })),
    })), zoneIdMap);
    const newVisite = {
      ...source,
      id: newId,
      label: `${source.label || `Visite ${visites.indexOf(source) + 1}`} (copie)`,
      dateVisite: today,
      rapportPageBreaks: [],
      localisations,
    };
    onUpdateProjet({ visites: [...visites, newVisite] });
    setDupSource(null);
    setEditingId(newId); // reste sur la liste, copie ouverte en édition (renommer / ingénieurs)
  };

  const deleteVisite = (e, visiteId) => {
    e.stopPropagation();
    const v = visites.find(v => v.id === visiteId);
    const obsCount = (v?.localisations || []).flatMap(l => l.items || []).length;
    const msg = obsCount > 0
      ? `Supprimer "${v?.label || 'cette visite'}" et ses ${obsCount} observation${obsCount > 1 ? 's' : ''} ?`
      : `Supprimer "${v?.label || 'cette visite'}" ?`;
    if (!window.confirm(msg)) return;
    onUpdateProjet({ visites: visites.filter(vv => vv.id !== visiteId) });
    markVisitRecovery(visiteId); // supprimée volontairement → le bandeau « visite retrouvée » ne la repropose pas
    if (editingId === visiteId) setEditingId(null);
  };

  const addVisite = () => {
    const newId = crypto.randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    const planLibrary = projet.planLibrary || [];
    const lastVisite = visites[visites.length - 1];
    const zoneIdMap = new Map((lastVisite?.localisations || []).map(loc => [loc.id, crypto.randomUUID()]));
    const localisations = remapParentIds((lastVisite?.localisations || []).map(loc => {
      const libPlan = planLibrary.find(p => p.bg && p.bg === loc.planBg);
      return {
        id: zoneIdMap.get(loc.id),
        nom: loc.nom,
        // Les groupes de zones (R+4 › appartements) sont repris dans la nouvelle visite.
        ...(loc.parentId ? { parentId: loc.parentId } : {}),
        // Dates de suivi de la zone : conservées d'une visite à l'autre.
        ...(loc.dateOuverture ? { dateOuverture: loc.dateOuverture } : {}),
        ...(loc.dateCloture ? { dateCloture: loc.dateCloture } : {}),
        planBg: libPlan?.bg || loc.planBg || null,
        planData: libPlan?.data || loc.planData || null,
        planAnnotations: null,
        items: [],
      };
    }), zoneIdMap);
    const newVisite = {
      id: newId,
      label: `Visite ${visites.length + 1}`,
      dateVisite: today,
      ingenieur: '',
      // Reprend la liste d'intervenants du dernier rapport (demande Thomas : « la liste
      // d'intervenants ne reste pas d'un rapport à l'autre »). Les id sont régénérés pour
      // éviter toute collision avec la visite d'origine. tableauRecap reste vide (auto-régénéré).
      participants: (lastVisite?.participants || []).map(p => ({ ...p, id: crypto.randomUUID() })),
      tableauRecap: [],
      photosParLigne: 2, plansEnFin: false, rapportPageBreaks: [],
      includeTableauRecap: true, includeConclusion: false, conclusion: '',
      localisations,
    };
    onUpdateProjet({ visites: [...visites, newVisite] });
    onSelectVisite(newId);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:DA.grayXL }}>

      {/* Header */}
      {/* Safe-area gérée par l'espaceur global de ChantierAI — pas de padding env() ici */}
      <div style={{ background:DA.black, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:2, padding:'0 6px', minHeight:52 }}>
          <button onClick={onBack} aria-label="Retour au projet" title="Retour au projet"
            style={{ width:44, height:44, flexShrink:0, color:'rgba(255,255,255,0.75)', background:'transparent', border:'none', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
            <span style={{ display:'inline-block', transform:'rotate(90deg)', lineHeight:0 }}><Ic n="chv" s={20}/></span>
          </button>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontWeight:800, fontSize:16, color:'white', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.25 }} spellCheck={false}>{projet.nom}</p>
            {projet.adresse && <p style={{ fontSize:11, color:'rgba(255,255,255,0.4)', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.adresse}</p>}
          </div>
          {(() => {
            // Silencieux quand tout va bien ; en mode visite, la sync est intentionnellement
            // suspendue (le bouton 📴 ci-dessous suffit) sauf en cas d'erreur réelle.
            // Hors-ligne : silencieux aussi — le bandeau hors-ligne global informe déjà.
            if (syncStatus === 'offline') return null;
            if (visitMode && syncStatus !== 'error') return null;
            if (!visitMode && syncStatus === 'ok' && !dirty && !stale) return null;
            const dotColor = syncStatus === 'ok' ? (dirty ? '#FCD34D' : stale ? '#93C5FD' : '#4ADE80') : syncStatus === 'saving' ? '#FCD34D' : '#F87171';
            const dotLabel = syncStatus === 'saving' ? 'Sauvegarde…' : syncStatus === 'error' ? 'Erreur' : dirty ? 'Non sync.' : stale ? 'MàJ dispo' : 'Sauvegardé';
            return (
              <div style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 9px', borderRadius:8, flexShrink:0,
                background: syncStatus==='error' ? 'rgba(239,68,68,0.15)' : syncStatus==='saving' ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.07)',
                border: `1px solid ${syncStatus==='error'?'rgba(239,68,68,0.4)':syncStatus==='saving'?'rgba(251,191,36,0.4)':'rgba(255,255,255,0.12)'}` }}>
                {syncStatus === 'saving' ? <Ic n="spn" s={10}/> : <div style={{ width:6, height:6, borderRadius:'50%', background:dotColor, flexShrink:0 }}/>}
                <span style={{ fontSize:10, fontWeight:700, color: syncStatus==='error'?'#F87171':syncStatus==='saving'?'#FCD34D':'rgba(255,255,255,0.75)', whiteSpace:'nowrap' }}>{dotLabel}</span>
              </div>
            );
          })()}
          {onToggleVisitMode && (
            <button onClick={() => onToggleVisitMode(!visitMode)} aria-label={visitMode ? 'Reprendre la synchronisation' : 'Mode visite hors-ligne'}
              title={visitMode ? 'Sync suspendue pendant la visite — appuyez pour synchroniser et reprendre' : 'Suspendre la sync réseau pendant la visite (travail 100% hors-ligne, sync en fin de visite)'}
              style={{ width:44, height:44, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:8, cursor:'pointer',
                background: visitMode ? 'rgba(4,120,87,0.25)' : 'transparent',
                border: visitMode ? '1px solid rgba(16,185,129,0.6)' : 'none',
                color: visitMode ? '#6EE7B7' : 'rgba(255,255,255,0.75)' }}>
              <Ic n={visitMode ? 'wifioff' : 'wifi'} s={19}/>
            </button>
          )}
          {onRefresh && (
            <button onClick={onRefresh} disabled={refreshing} aria-label="Actualiser" title="Actualiser depuis le serveur"
              style={{ width:44, height:44, flexShrink:0, background:'transparent', border:'none', borderRadius:8, color:'rgba(255,255,255,0.75)', cursor:refreshing?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
              {refreshing ? <Ic n="spn" s={18}/> : <Ic n="rld" s={18}/>}
            </button>
          )}
        </div>
      </div>

      {/* Liste */}
      <div ref={wrapperRef} style={{ flex:1, overflowY:'auto', background:'#E8E8E8' }}>
        <div className={uiScaleClass(uiScale)} style={{ maxWidth:860, margin:'0 auto', padding:'20px 16px 24px', display:'flex', flexDirection:'column', gap:14 }}>

        {/* Titre de section */}
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', padding:'0 4px 6px', borderBottom:`2px solid ${DA.red}`, marginBottom:2 }}>
          <div>
            <p style={{ fontSize:11, fontWeight:700, color:DA.red, textTransform:'uppercase', letterSpacing:1.2, margin:0 }}>Historique des visites</p>
            <p style={{ fontSize:22, fontWeight:900, color:DA.black, margin:'2px 0 0', letterSpacing:-0.5 }}>{visites.length} visite{visites.length !== 1 ? 's' : ''}</p>
          </div>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
            {isPcWide && visites.length > 0 && (
              <button onClick={() => setBulkOpen(true)} title="Télécharger les rapports PDF de toutes les visites dans un fichier zip"
                style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:8, border:`1.5px solid ${DA.red}`, background:'white', color:DA.red, fontSize:12, fontWeight:800, cursor:'pointer' }}>
                <Ic n="dl" s={14}/> Tous les rapports (.zip)
              </button>
            )}
            <p style={{ fontSize:11, color:DA.grayL, margin:0, fontStyle:'italic' }}>
              Glisser pour réorganiser
            </p>
          </div>
        </div>
        {bulkOpen && <BulkReportExport projet={projet} onHydrateVisite={onHydrateVisite} onClose={() => setBulkOpen(false)}/>}

        {/* Visite retrouvée dans les sauvegardes de CET appareil — n'apparaît que s'il y a quelque chose à récupérer. */}
        {recovery.map(c => (
          <div key={c.visitId} style={{ background:'#FFF7ED', border:'1.5px solid #FDBA74', borderRadius:12, padding:'12px 14px', marginBottom:12, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <div style={{ flex:'1 1 220px', minWidth:0 }}>
              <p style={{ margin:0, fontSize:13, fontWeight:800, color:'#9A3412' }}>Visite retrouvée dans les sauvegardes de cet appareil</p>
              <p style={{ margin:'2px 0 0', fontSize:12, color:'#9A3412' }}>
                « {c.label} » du {new Date(c.ts).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })} : {c.items} observation{c.items > 1 ? 's' : ''}
                {[
                  c.missing > 0 && `${c.missing} absente${c.missing > 1 ? 's' : ''} aujourd'hui`,
                  c.textItems > 0 && `${c.textItems} au texte plus complet`,
                  c.photoGain > 0 && `${c.photoGain} photo${c.photoGain > 1 ? 's' : ''} disparue${c.photoGain > 1 ? 's' : ''}`,
                ].filter(Boolean).map(x => `, ${x}`).join('')}.
              </p>
            </div>
            <div style={{ display:'flex', gap:8, flexShrink:0 }}>
              <button onClick={() => restoreVisit(c)}
                style={{ padding:'8px 14px', borderRadius:9, border:'none', background:'#EA580C', color:'white', fontSize:13, fontWeight:800, cursor:'pointer' }}>
                Restaurer
              </button>
              <button onClick={() => { markVisitRecovery(c.visitId, c.ts); setRecovery(r => r.filter(x => x.visitId !== c.visitId)); }}
                style={{ padding:'8px 10px', borderRadius:9, border:'1px solid #FDBA74', background:'white', color:'#9A3412', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                Ignorer
              </button>
            </div>
          </div>
        ))}

        {visites.length === 0 && (
          <div style={{ background:'white', borderRadius:14, padding:'56px 24px', textAlign:'center', border:`1px solid ${DA.border}`, boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
            <div style={{ width:60, height:60, borderRadius:14, background:DA.redL, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px', color:DA.red }}>
              <Ic n="fil" s={30}/>
            </div>
            <p style={{ fontWeight:800, fontSize:17, color:DA.black, margin:'0 0 8px' }}>Aucune visite</p>
            <p style={{ color:DA.gray, fontSize:13, margin:0 }}>Créez la première visite pour commencer.</p>
          </div>
        )}

        <div ref={listRef} style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {visites.map((v, i) => {
            const rawItems   = (v.localisations || []).flatMap(l => l.items || []);
            const obsCount   = rawItems.length;
            const urgCount   = rawItems.filter(it => it.urgence === 'haute').length;
            const zonesCount = (v.localisations || []).length;
            const visitSummary = visitSummaries[v.id] || null;
            const visitRecap = v.recap || visitRecaps[v.id] || null; // synchro (visite) prioritaire, repli cache local
            const urgentItems = rawItems
              .filter(it => it.urgence === 'haute' && it.suivi !== 'fait' && it.titre)
              .slice(0, 2);
            const isDragging = dragIdx === i;
            const isOver     = overIdx === i && dragIdx !== i;
            const isEditing  = editingId === v.id;
            const visiteNum  = i + 1;
            const pinned     = pinnedVisites.has(v.id);
            const vstate     = visiteSyncState(v, pinned);

            return (
              <div key={v.id}
                draggable={!isEditing}
                onDragStart={() => !isEditing && onDragStart(i)}
                onDragEnter={() => dragIdx !== null && onDragEnter(i)}
                onDragEnd={onDragEnd}
                onDragOver={e => e.preventDefault()}
                style={{
                  display:'flex', alignItems:'stretch', gap:0,
                  background: isDragging ? '#f0f0f0' : isOver ? DA.redL : 'white',
                  borderRadius: 14,
                  border: `1px solid ${isOver ? DA.red : DA.border}`,
                  boxShadow: isDragging ? 'none' : '0 2px 12px rgba(0,0,0,0.08)',
                  overflow: 'hidden',
                  opacity: isDragging ? 0.45 : 1,
                  transition:'background 0.08s, opacity 0.08s, box-shadow 0.15s',
                }}>

                {/* Bande latérale colorée avec numéro */}
                <div style={{
                  flexShrink:0,
                  width:60,
                  background:`linear-gradient(180deg, ${DA.red}, #B91C1C)`,
                  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                  color:'white',
                  padding:'10px 0',
                }}>
                  <span style={{ fontSize:9, fontWeight:700, opacity:0.85, letterSpacing:1, textTransform:'uppercase' }}>Visite</span>
                  <span style={{ fontSize:32, fontWeight:900, lineHeight:1, marginTop:2 }}>{visiteNum}</span>
                  <div
                    onTouchStart={e => onGripTouchStart(e, i)}
                    onClick={e => e.stopPropagation()}
                    style={{ marginTop:8, cursor:'grab', color:'rgba(255,255,255,0.55)', touchAction:'none', padding:'4px 6px' }}>
                    <Ic n="grp" s={14}/>
                  </div>
                </div>

                {/* Zone tap → ouvre la visite (cachée en mode édition) */}
                {!isEditing ? (
                  <div onClick={() => onSelectVisite(v.id)}
                    style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'center', gap:10, padding:'16px 16px', cursor:'pointer', minWidth:0 }}>

                    {/* Titre + badge de sync visite. Les états « À télécharger »/« Hors ligne prêt »
                        ne s'affichent plus : le pré-téléchargement des projets de l'ingénieur est
                        automatique (les badges d'erreur/sync restent). */}
                    <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
                      <p style={{ fontWeight:800, fontSize:16, color:DA.black, margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', letterSpacing:-0.3, flex:1, minWidth:0 }}>{v.label || `Visite ${visiteNum}`}</p>
                      {pinningId === v.id
                        ? <SyncBadge state="syncing" label="Téléchargement…" />
                        : (vstate !== 'notloaded' && vstate !== 'pinned') && <SyncBadge state={vstate} />}
                    </div>

                    {/* Meta : date + ingénieur sur une ligne */}
                    <div style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ fontSize:13 }}>📅</span>
                        <span style={{ fontSize:13, color:v.dateVisite ? DA.black : DA.grayL, fontWeight:v.dateVisite ? 600 : 400, fontStyle:v.dateVisite ? 'normal' : 'italic' }}>
                          {formatDate(v.dateVisite)}
                        </span>
                      </div>
                      {v.ingenieur && (
                        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                          <span style={{ color:DA.border, fontSize:13 }}>·</span>
                          <Ic n="usr" s={12} style={{ color:DA.grayL }}/>
                          <span style={{ fontSize:12, color:DA.grayL, fontWeight:600 }}>
                            Ingénieur{splitInitials(v.ingenieur).length > 1 ? 's' : ''} :
                          </span>
                          <span style={{ fontSize:13, color:DA.black, fontWeight:700, letterSpacing:0.5 }}>{splitInitials(v.ingenieur).join(', ') || v.ingenieur}</span>
                        </div>
                      )}
                    </div>

                    {/* Tags */}
                    {(zonesCount > 0 || obsCount > 0 || urgCount > 0) && (
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                        {zonesCount > 0 && (
                          <span style={{ fontSize:11, color:DA.gray, background:DA.grayXL, border:`1px solid ${DA.border}`, borderRadius:6, padding:'3px 9px', display:'inline-flex', alignItems:'center', gap:4, fontWeight:600 }}>
                            <Ic n="pin" s={10}/> {zonesCount} zone{zonesCount > 1 ? 's' : ''}
                          </span>
                        )}
                        {obsCount > 0 && (
                          <span style={{ fontSize:11, color:DA.gray, background:DA.grayXL, border:`1px solid ${DA.border}`, borderRadius:6, padding:'3px 9px', display:'inline-flex', alignItems:'center', gap:4, fontWeight:600 }}>
                            <Ic n="cam" s={10}/> {obsCount} obs
                          </span>
                        )}
                        {urgCount > 0 && (
                          <span style={{ fontSize:11, color:DA.red, background:DA.redL, border:`1px solid rgba(185,28,28,0.25)`, borderRadius:6, padding:'3px 9px', fontWeight:800, display:'inline-flex', alignItems:'center', gap:4 }}>
                            ⚠ {urgCount} urgente{urgCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Résumé thématique IA ou urgences */}
                    {(visitSummary || urgentItems.length > 0) && (
                      <div style={{ paddingTop:10, borderTop:`1px solid ${DA.border}`, display:'flex', flexDirection:'column', gap:5 }}>
                        {visitSummary && (
                          <p style={{ margin:0, fontSize:12, color:DA.gray, fontStyle:'italic', lineHeight:1.4 }}>
                            {visitSummary}
                          </p>
                        )}
                        {urgentItems.map((it, k) => (
                          <div key={k} style={{ display:'flex', alignItems:'flex-start', gap:6 }}>
                            <span style={{ fontSize:10, fontWeight:800, color:URGENCE.haute.text, background:URGENCE.haute.bg, borderRadius:4, padding:'2px 6px', flexShrink:0, whiteSpace:'nowrap', marginTop:1 }}>
                              {URGENCE.haute.label}
                            </span>
                            <span style={{ fontSize:12, color:'#333', flex:1, lineHeight:1.4 }}>
                              {it.titre}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Récap perso (local, instantané — jamais dans le rapport) */}
                    {obsCount > 0 && (
                      <div onClick={e => e.stopPropagation()} style={{ cursor:'default' }}>
                        {visitRecap ? (
                          <div style={{ background:'#F5F3FF', border:'1px solid #DDD6FE', borderRadius:9, padding:'9px 11px' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                              <span style={{ fontSize:11, fontWeight:800, color:'#6D28D9', letterSpacing:0.3 }}>🧠 Mon récap</span>
                              <button onClick={() => genRecap(v)} title="Régénérer"
                                style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'#6D28D9', fontSize:12, fontWeight:700, padding:'2px 4px' }}>↻</button>
                            </div>
                            <p style={{ margin:0, fontSize:12.5, color:'#4C1D95', lineHeight:1.45, whiteSpace:'pre-line' }}>{visitRecap}</p>
                          </div>
                        ) : (
                          <div style={{ display:'flex', flexDirection:'column', gap:5, alignItems:'flex-start' }}>
                            <button onClick={() => genRecap(v)}
                              style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#F5F3FF', border:'1px solid #DDD6FE', color:'#6D28D9', borderRadius:8, padding:'7px 12px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                              🧠 Générer mon récap
                            </button>
                            {recapErr[v.id] && (
                              <span style={{ fontSize:11, color:DA.red, fontWeight:600 }}>{recapErr[v.id]}</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Mode édition */
                  <div style={{ flex:1, padding:'16px 14px', minWidth:0 }} onClick={e => e.stopPropagation()}>
                    {/* Nom de la visite */}
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                      <Ic n="pen" s={11} style={{ color:DA.red }}/>
                      <span style={{ fontSize:10, fontWeight:800, color:DA.red, textTransform:'uppercase', letterSpacing:1 }}>Nom de la visite</span>
                    </div>
                    <input
                      autoFocus
                      value={v.label || ''}
                      onChange={e => patchVisite(v.id, { label: e.target.value })}
                      // Sélectionner le titre au doigt/à la souris déclenchait le DRAG natif du
                      // texte sélectionné (qui remonte à la carte → « déplacer la visite » au
                      // lieu de supprimer le titre). On tue le drag à la source (demande Thomas).
                      draggable={false}
                      onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}
                      placeholder="Ex: Diagnostic structure"
                      style={{ width:'100%', fontSize:16, fontWeight:700, color:DA.black, border:`1.5px solid ${DA.red}`, borderRadius:8, padding:'9px 11px', outline:'none', background:'white', boxSizing:'border-box', marginBottom:10 }}
                    />
                    {/* Date (compacte) + Ingénieurs (toute la place restante — plus de défilement
                        des puces, demande Thomas). */}
                    <div style={{ display:'flex', gap:8, marginBottom:12 }}>
                      <div style={{ width:148, flexShrink:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:4 }}>
                          <span style={{ fontSize:12 }}>📅</span>
                          <span style={{ fontSize:10, fontWeight:700, color:DA.gray, textTransform:'uppercase', letterSpacing:0.8 }}>Date</span>
                        </div>
                        <input
                          type="date"
                          value={v.dateVisite || ''}
                          onChange={e => patchVisite(v.id, { dateVisite: e.target.value || null })}
                          style={{ fontSize:13.5, color:DA.black, border:`1.5px solid ${DA.border}`, borderRadius:8, padding:'9px 8px', outline:'none', background:'white', cursor:'pointer', width:'100%', boxSizing:'border-box' }}
                        />
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:4 }}>
                          <Ic n="usr" s={10} style={{ color:DA.grayL }}/>
                          <span style={{ fontSize:10, fontWeight:700, color:DA.gray, textTransform:'uppercase', letterSpacing:0.8 }}>Ingénieur(s)</span>
                        </div>
                        <IngenieursEditor
                          value={v.ingenieur || ''}
                          onChange={val => patchVisite(v.id, { ingenieur: val })}
                        />
                      </div>
                    </div>
                    <button onClick={() => setEditingId(null)}
                      style={{ width:'100%', padding:'10px 0', background:DA.red, color:'white', border:'none', borderRadius:9, fontSize:14, fontWeight:800, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6, boxShadow:'0 2px 8px rgba(227,5,19,0.3)' }}>
                      <Ic n="chk" s={14}/> Valider
                    </button>
                  </div>
                )}

                {/* Actions droite */}
                <div style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:6, padding:'12px 12px 12px 6px', borderLeft:`1px solid ${DA.grayXL}` }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => setEditingId(isEditing ? null : v.id)}
                    title={isEditing ? 'Fermer' : 'Modifier'}
                    style={{ width:44, height:44, padding:0, background: isEditing ? DA.redL : DA.grayXL, border: isEditing ? `1px solid #FCA5A5` : `1px solid ${DA.border}`, color: isEditing ? DA.red : DA.gray, cursor:'pointer', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.1s' }}
                    onMouseEnter={e => { if (!isEditing) { e.currentTarget.style.background = DA.redL; e.currentTarget.style.color = DA.red; e.currentTarget.style.borderColor = '#FCA5A5'; } }}
                    onMouseLeave={e => { if (!isEditing) { e.currentTarget.style.background = DA.grayXL; e.currentTarget.style.color = DA.gray; e.currentTarget.style.borderColor = DA.border; } }}>
                    <Ic n="pen" s={15}/>
                  </button>
                  {/* Bouton pin retiré : le hors-ligne des projets de l'ingénieur est désormais
                      AUTOMATIQUE (et réglable par projet dans Paramètres). */}
                  <button onClick={e => duplicateVisite(e, v.id)}
                    title="Dupliquer cette visite"
                    style={{ width:44, height:44, padding:0, background:DA.grayXL, border:`1px solid ${DA.border}`, color:DA.grayL, cursor:'pointer', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#EFF6FF'; e.currentTarget.style.color = '#1D4ED8'; e.currentTarget.style.borderColor = '#93C5FD'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = DA.grayXL; e.currentTarget.style.color = DA.grayL; e.currentTarget.style.borderColor = DA.border; }}>
                    <Ic n="cpy" s={15}/>
                  </button>
                  {visites.length > 1 && (
                    <button onClick={e => deleteVisite(e, v.id)}
                      title="Supprimer"
                      style={{ width:44, height:44, padding:0, background:DA.grayXL, border:`1px solid ${DA.border}`, color:DA.grayL, cursor:'pointer', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.1s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#FEF2F2'; e.currentTarget.style.color = DA.red; e.currentTarget.style.borderColor = '#FCA5A5'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = DA.grayXL; e.currentTarget.style.color = DA.grayL; e.currentTarget.style.borderColor = DA.border; }}>
                      <Ic n="del" s={15}/>
                    </button>
                  )}
                  {/* La petite flèche décorative a été retirée (demande Thomas : elle n'apportait rien). */}
                </div>
              </div>
            );
          })}
        </div>

        <button onClick={addVisite}
          style={{ width:'100%', padding:'18px 20px', display:'flex', alignItems:'center', justifyContent:'center', gap:8, fontSize:16, fontWeight:800, color:'white', background:`linear-gradient(135deg, ${DA.red}, #B91C1C)`, border:'none', borderRadius:14, cursor:'pointer', boxShadow:'0 4px 16px rgba(227,5,19,0.35)', letterSpacing:0.3, marginTop:4 }}>
          <Ic n="plus" s={18}/> Nouvelle visite
        </button>

        {/* Versions gardées sur CET appareil (boîte noire) — lien discret, choix manuel (incident 26/10). */}
        <button onClick={openVersions}
          style={{ display:'block', margin:'14px auto 0', background:'none', border:'none', color:DA.grayL, fontSize:12, textDecoration:'underline', cursor:'pointer' }}>
          Versions sauvegardées sur cet appareil
        </button>

        </div>
      </div>

      {/* ── Versions sauvegardées sur cet appareil ── */}
      {versions && (
        <div onClick={() => setVersions(null)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'white', borderRadius:16, padding:'18px 16px', width:'100%', maxWidth:520, maxHeight:'85vh', overflowY:'auto', boxShadow:'0 12px 40px rgba(0,0,0,0.3)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
              <p style={{ fontSize:15, fontWeight:800, color:DA.black, margin:0 }}>Versions sauvegardées sur cet appareil</p>
              <button onClick={() => setVersions(null)} style={{ background:'none', border:'none', fontSize:20, color:DA.grayL, cursor:'pointer' }}>×</button>
            </div>
            {versions.loading ? (
              <p style={{ fontSize:13, color:DA.gray }}>Lecture des sauvegardes…</p>
            ) : (
              <>
                <p style={{ fontSize:12, color:DA.gray, margin:'4px 0 12px', lineHeight:1.45 }}>
                  {versions.count} sauvegarde{versions.count > 1 ? 's' : ''} sur cet appareil
                  {versions.oldest ? ` depuis le ${new Date(versions.oldest).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}` : ''}.
                  {' '}Restaurer ajoute la version choisie À CÔTÉ (« restaurée ») : rien n'est écrasé.
                </p>
                {versions.visits.length === 0 && <p style={{ fontSize:13, color:DA.gray }}>Aucune version de ce projet sur cet appareil.</p>}
                {versions.visits.map(g => {
                  const now = visites.find(v => v.id === g.visitId);
                  const sig = now ? visitSignature(now) : null;
                  return (
                    <div key={g.visitId} style={{ marginBottom:14 }}>
                      <p style={{ fontSize:13, fontWeight:800, color:DA.black, margin:'0 0 2px' }}>{g.label}</p>
                      <p style={{ fontSize:11, color:DA.grayL, margin:'0 0 6px' }}>
                        {sig ? `Aujourd'hui : ${sig.items} obs · ${sig.photos} photos · ${sig.text} caractères` : 'Absente du projet aujourd\'hui'}
                      </p>
                      {g.versions.map(ver => (
                        <div key={ver.ts} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 0', borderTop:`1px solid ${DA.border}` }}>
                          <div style={{ flex:1, minWidth:0, fontSize:12, color:DA.black }}>
                            <b>{new Date(ver.ts).toLocaleString('fr-FR', { weekday:'short', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</b>
                            <span style={{ color:DA.gray }}> — {ver.items} obs · {ver.photos} photos · {ver.text} car.</span>
                          </div>
                          <button onClick={() => restoreVersion(g, ver)}
                            style={{ flexShrink:0, padding:'6px 10px', borderRadius:8, border:'none', background:'#EA580C', color:'white', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                            Restaurer
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Duplication : avec ou sans les photos ? ── */}
      {dupSource && (() => {
        const nbPhotos = (dupSource.localisations || []).flatMap(l => l.items || [])
          .reduce((s, it) => s + (it.photos || []).length, 0);
        // Hors ligne : photos pas chargeables → on le dit plutôt que d'annoncer « pas de photo ».
        const partial = !dupLoading && visiteSyncState(dupSource, false) === 'notloaded';
        return (
          <div onClick={() => setDupSource(null)}
            style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background:'white', borderRadius:16, padding:'22px 20px', width:'100%', maxWidth:360, boxShadow:'0 12px 40px rgba(0,0,0,0.3)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:6 }}>
                <div style={{ width:34, height:34, borderRadius:9, background:DA.redL, color:DA.red, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><Ic n="cpy" s={17}/></div>
                <p style={{ fontSize:15, fontWeight:800, color:DA.black, margin:0 }}>Dupliquer la visite</p>
              </div>
              <p style={{ fontSize:12.5, color:DA.gray, margin:'0 0 16px', lineHeight:1.45 }}>
                « {dupSource.label || 'Visite'} » sera copiée (zones, observations, plans).
                {dupLoading
                  ? ' Chargement des photos…'
                  : nbPhotos > 0
                    ? ` Gardez-vous les ${nbPhotos} photo${nbPhotos > 1 ? 's' : ''} de la visite ?`
                    : partial
                      ? ' Les photos de cette visite n\'ont pas pu être chargées (hors connexion ?) : la copie sera faite sans photos.'
                      : ' Cette visite ne contient pas de photo.'}
                {!dupLoading && nbPhotos > 0 && partial && ' (Certaines photos non chargées — hors connexion ? — ne seront pas copiées.)'}
              </p>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                <button onClick={() => performDuplicate(dupSource, true)} disabled={dupLoading}
                  style={{ width:'100%', minHeight:52, padding:'12px', background:DA.red, color:'white', border:'none', borderRadius:11, fontSize:14, fontWeight:800, cursor:dupLoading ? 'default' : 'pointer', opacity:dupLoading ? 0.5 : 1, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                  <Ic n="chk" s={15}/> {nbPhotos > 0 ? 'Dupliquer avec les photos' : 'Dupliquer'}
                </button>
                {nbPhotos > 0 && !dupLoading && (
                  <button onClick={() => performDuplicate(dupSource, false)}
                    style={{ width:'100%', minHeight:52, padding:'12px', background:'white', color:DA.black, border:`1.5px solid ${DA.border}`, borderRadius:11, fontSize:14, fontWeight:700, cursor:'pointer' }}>
                    Dupliquer sans les photos
                  </button>
                )}
                <button onClick={() => setDupSource(null)}
                  style={{ width:'100%', padding:'9px', background:'none', color:DA.grayL, border:'none', borderRadius:11, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  Annuler
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

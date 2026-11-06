// PLANS SUPPRIMÉS — retrouver et remettre des plans retirés de la bibliothèque du projet.
//
// Incident 06/11/2026 (Thomas, Grasse) : pour préparer la DET 6, il a supprimé les anciens plans
// de la bibliothèque pour y mettre les nouveaux. La bibliothèque étant COMMUNE à toutes les visites,
// la suppression a retiré les plans de toutes les DET précédentes (ligne du plan effacée en base +
// zones de TOUTES les visites détachées de leur plan, annotations comprises).
//
// Ce qui survit, et que ce module recoupe (logique PURE, testée — aucune I/O) :
//   • l'historique serveur des ZONES (aichantier_history, trigger) : l'ancien plan_annotations de
//     chaque zone (plan principal `_planId` + annotations, plans additionnels `_extraPlans`) ;
//   • les sauvegardes de l'appareil (boîte noire) : nom des plans (planLibrary) et zones ;
//   • (côté stockage, hors de ce module) l'image HD de chaque plan, jamais effacée.
//
// Règle d'or (comme la corbeille) : une restauration AJOUTE, elle ne remplace jamais rien.
// Une zone qui a déjà un plan principal garde le sien ; un plan additionnel n'est ajouté que s'il
// n'est pas déjà là.

const parse = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
};

// Annotations du plan PRINCIPAL d'une valeur plan_annotations (format app : sans les clés `_…`).
function mainAnnotOf(obj) {
  if (!obj) return null;
  // eslint-disable-next-line no-unused-vars
  const { _planId, _extraPlans, _planReportHidden, _parentId, _dates, ...rest } = obj;
  return Object.keys(rest).length ? rest : null;
}

// Références zone → plan contenues dans une valeur plan_annotations (ligne de base).
function refsFromRowAnnot(raw) {
  const obj = parse(raw);
  if (!obj) return [];
  const out = [];
  if (obj._planId) out.push({ kind: 'main', planId: obj._planId, planAnnotations: mainAnnotOf(obj), reportHidden: !!obj._planReportHidden });
  for (const ep of (Array.isArray(obj._extraPlans) ? obj._extraPlans : [])) {
    if (ep?.planId) out.push({ kind: 'extra', planId: ep.planId, planAnnotations: ep.paths?.length ? { paths: ep.paths } : null, reportHidden: !!ep.reportHidden });
  }
  return out;
}

// Références zone → plan d'une zone au format app (sauvegardes de l'appareil).
function refsFromAppLoc(loc) {
  const out = [];
  if (loc?.planId) out.push({ kind: 'main', planId: loc.planId, planAnnotations: loc.planAnnotations ?? null, reportHidden: !!loc.planReportHidden });
  for (const ep of (loc?.extraPlans || [])) {
    if (ep?.planId) out.push({ kind: 'extra', planId: ep.planId, planAnnotations: ep.planAnnotations ?? null, reportHidden: !!ep.reportHidden });
  }
  return out;
}

const tsOf = (x) => { const t = new Date(x).getTime(); return Number.isFinite(t) ? t : 0; };

// Plans retirés de la bibliothèque et leurs anciens emplacements, d'après l'historique serveur
// des zones et les sauvegardes de l'appareil.
//   projet      : projet ACTUEL (format app)
//   zoneHistory : lignes aichantier_history des zones du projet [{ row_id, old_row, changed_at }]
//   snapshots   : [{ ts, data: projets[] }] (boîte noire de l'appareil, blobs retirés)
// → [{ id, nom, refs: [{ visiteId, locId, locNom, kind, planAnnotations, reportHidden, ts }], itemCount }]
//   (un seul ref par zone × plan × type : le plus RÉCENT — l'état juste avant la suppression).
export function findDeletedPlans(projet, { zoneHistory = [], snapshots = [] } = {}) {
  const current = new Set((projet?.planLibrary || []).map(p => p?.id).filter(Boolean));
  const zoneVisit = new Map(); // zone actuelle → { visiteId, nom }
  for (const v of (projet?.visites || [])) for (const l of (v.localisations || [])) if (l?.id) zoneVisit.set(l.id, { visiteId: v.id, nom: l.nom || '' });

  const plans = new Map(); // planId → { id, nom, nomTs, refs: Map(key → ref), itemCount }
  const plan = (id) => {
    if (!plans.has(id)) plans.set(id, { id, nom: '', nomTs: -1, refs: new Map(), itemCount: 0 });
    return plans.get(id);
  };
  const addRef = (r, locId, ts, source) => {
    if (!r.planId || current.has(r.planId)) return;
    const z = zoneVisit.get(locId);
    if (!z) return; // zone disparue depuis : rien à re-relier
    const p = plan(r.planId);
    const key = `${locId}|${r.kind}`;
    const prev = p.refs.get(key);
    // Historique serveur prioritaire (vérité partagée) ; sinon la version la plus récente.
    if (prev && (prev.source === 'server' && source !== 'server' || (prev.source === source && prev.ts >= ts))) return;
    p.refs.set(key, { visiteId: z.visiteId, locId, locNom: z.nom, kind: r.kind, planAnnotations: r.planAnnotations, reportHidden: r.reportHidden, ts, source });
  };

  for (const h of zoneHistory) {
    const row = h?.old_row;
    const locId = row?.id ?? h?.row_id;
    if (!locId) continue;
    for (const r of refsFromRowAnnot(row?.plan_annotations)) addRef(r, String(locId), tsOf(h.changed_at), 'server');
  }

  for (const s of snapshots) {
    const ts = Number(s?.ts) || 0;
    const sp = (Array.isArray(s?.data) ? s.data : []).find(p => p?.id === projet?.id);
    if (!sp) continue;
    for (const pl of (sp.planLibrary || [])) {
      if (!pl?.id || current.has(pl.id)) continue;
      const p = plan(pl.id);
      if (pl.nom && ts >= p.nomTs) { p.nom = pl.nom; p.nomTs = ts; }
    }
    for (const v of (sp.visites || [])) for (const l of (v.localisations || [])) {
      for (const r of refsFromAppLoc(l)) addRef(r, l.id, ts, 'device');
    }
  }

  // Observations dont un plan propre pointe encore vers un plan disparu (elles se ré-afficheront
  // d'elles-mêmes dès que le plan sera remis, aucune action sur elles).
  for (const v of (projet?.visites || [])) for (const l of (v.localisations || [])) for (const it of (l.items || [])) {
    for (const ip of (it.plans || [])) if (ip?.planId && !current.has(ip.planId)) plan(ip.planId).itemCount++;
  }

  return [...plans.values()]
    .filter(p => p.refs.size || p.itemCount || p.nom)
    .map(p => ({ id: p.id, nom: p.nom, itemCount: p.itemCount, refs: [...p.refs.values()] }));
}

// Remet les plans `planIds` dans les zones des visites `visiteIds` (ADDITIF) :
//   • plan principal : seulement si la zone n'a plus de plan principal ;
//   • plan additionnel : ajouté s'il n'y est pas déjà (ni comme plan principal).
// → { visites, relinked } (visites inchangées si rien à faire).
export function relinkDeletedPlans(visites, plans, planIds, visiteIds) {
  const ids = new Set(planIds), vids = new Set(visiteIds);
  const byLoc = new Map(); // locId → refs à appliquer
  for (const p of plans) {
    if (!ids.has(p.id)) continue;
    for (const r of p.refs) {
      if (!vids.has(r.visiteId)) continue;
      if (!byLoc.has(r.locId)) byLoc.set(r.locId, []);
      byLoc.get(r.locId).push({ ...r, planId: p.id });
    }
  }
  let relinked = 0;
  const next = (visites || []).map(v => {
    if (!vids.has(v.id)) return v;
    let changed = false;
    const locs = (v.localisations || []).map(l => {
      const refs = byLoc.get(l.id);
      if (!refs) return l;
      let out = l;
      for (const r of refs.filter(x => x.kind === 'main')) {
        if (out.planId) continue;
        out = { ...out, planId: r.planId, planBg: null, planData: null, planAnnotations: r.planAnnotations ?? null, planReportHidden: !!r.reportHidden };
        relinked++;
      }
      for (const r of refs.filter(x => x.kind === 'extra')) {
        if (out.planId === r.planId || (out.extraPlans || []).some(ep => ep.planId === r.planId)) continue;
        out = { ...out, extraPlans: [...(out.extraPlans || []), { id: crypto.randomUUID(), planId: r.planId, planBg: null, planData: null, planAnnotations: r.planAnnotations ?? null, reportHidden: !!r.reportHidden }] };
        relinked++;
      }
      if (out !== l) changed = true;
      return out;
    });
    return changed ? { ...v, localisations: locs } : v;
  });
  return { visites: relinked ? next : visites, relinked };
}

// ── Indépendance des visites (« chaque DET a ses plans ») ───────────────────────────────────────

// La visite utilise-t-elle ce plan (zone : principal ou additionnel ; observation : plan propre) ?
export function visitUsesPlan(visite, planId) {
  for (const l of (visite?.localisations || [])) {
    if (l.planId === planId) return true;
    if ((l.extraPlans || []).some(ep => ep.planId === planId)) return true;
    for (const it of (l.items || [])) if ((it.plans || []).some(p => p.planId === planId)) return true;
  }
  return false;
}

// Retire un plan des zones d'UNE visite (plan principal + additionnels) — les autres visites et la
// bibliothèque ne sont pas touchées.
export function detachPlanFromVisit(visite, planId) {
  let changed = false;
  const localisations = (visite.localisations || []).map(l => {
    const extra = (l.extraPlans || []).filter(ep => ep.planId !== planId);
    if (l.planId !== planId && extra.length === (l.extraPlans || []).length) return l;
    changed = true;
    const next = { ...l, extraPlans: extra };
    if (l.planId === planId) { next.planId = null; next.planBg = null; next.planData = null; next.planAnnotations = null; }
    return next;
  });
  return changed ? { ...visite, localisations } : visite;
}

// Bibliothèque vue depuis une visite : sans les plans retirés de CETTE visite.
export function visitPlanLibrary(planLibrary, visite) {
  const hidden = new Set(visite?.hiddenPlans || []);
  return hidden.size ? (planLibrary || []).filter(p => !hidden.has(p.id)) : (planLibrary || []);
}

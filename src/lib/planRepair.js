// RÉPARATION AUTOMATIQUE DES FONDS DE PLANS (retour Thomas 16/11, projet Voltaire : miniatures
// grises « Page 25…29 »). Le fond (bg) de certains plans n'est jamais arrivé en base : à l'import,
// les envois de fonds étaient refusés (base surchargée, erreurs 500 / 57014). Mais le stockage
// (Storage) garde souvent une autre copie :
//   1. l'image HD du plan : plans/{projet}/{planId}.webp ;
//   2. le PDF source, rangé par nom de document : la page N se re-dessine.
// On reconstruit le fond depuis ces copies ; le projet est ensuite sauvegardé normalement, ce qui
// renvoie le fond en base (saveRemote envoie le bg des plans qui n'en ont pas en base) → réparé
// pour tous les appareils. Rien n'est supprimé ; un plan introuvable reste tel quel.

// « Dossier … — Page 29 » → { base: 'Dossier …', page: 29 } ; sans « — Page N » → null.
export function parsePdfPageName(nom) {
  const m = /^(.*?)\s*—\s*Page\s*(\d+)\s*$/i.exec(String(nom || ''));
  if (!m) return null;
  const page = parseInt(m[2], 10);
  return m[1].trim() && page > 0 ? { base: m[1].trim(), page } : null;
}

// plans : [{ id, nom }] sans fond. deps : { fromCache(ids) → {id: bg}, fromHd(id) → dataUrl|null,
// downscale(dataUrl) → dataUrl|null, pdfOf(base) → pdfDataUrl|null, renderPage(pdf, n) → dataUrl|null }.
// → { [planId]: bg } (seulement les plans réparés). Ne rejette jamais.
export async function repairPlanBgs(plans, deps, { concurrency = 2, max = 80 } = {}) {
  const out = {};
  const todo = (plans || []).filter(p => p?.id).slice(0, max);
  if (!todo.length) return out;
  try {
    const cached = (await deps.fromCache?.(todo.map(p => p.id))) || {};
    for (const p of todo) if (typeof cached[p.id] === 'string' && cached[p.id].startsWith('data:')) out[p.id] = cached[p.id];
  } catch { /* pas de cache */ }
  const rest = todo.filter(p => !out[p.id]);
  const pdfMemo = new Map(); // base → Promise<pdf|null> (un seul téléchargement par document)
  const pdfOf = (base) => {
    if (!pdfMemo.has(base)) pdfMemo.set(base, Promise.resolve().then(() => deps.pdfOf?.(base)).catch(() => null));
    return pdfMemo.get(base);
  };
  let next = 0;
  const worker = async () => {
    while (next < rest.length) {
      const p = rest[next++];
      try {
        const hd = await deps.fromHd?.(p.id);
        if (hd) { const bg = await deps.downscale(hd); if (bg) { out[p.id] = bg; continue; } }
        const ref = parsePdfPageName(p.nom);
        if (!ref) continue;
        const pdf = await pdfOf(ref.base);
        if (!pdf) continue;
        const bg = await deps.renderPage(pdf, ref.page);
        if (bg) out[p.id] = bg;
      } catch { /* plan suivant */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rest.length) }, worker));
  return out;
}

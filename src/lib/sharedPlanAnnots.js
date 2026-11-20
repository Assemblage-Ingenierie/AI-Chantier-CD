// ANNOTATIONS D'UN PLAN PARTAGÉ ENTRE PLUSIEURS ZONES (incident Thomas 20/11, Voltaire).
//
// Plusieurs zones (« Bâtiment sur rue », « Bâtiment sur cour »…) peuvent utiliser le même plan.
// Ses annotations sont COMMUNES : celles posées depuis une zone restent visibles depuis l'autre,
// et chacune peut en ajouter (« les annotations coexistent »).
//
// Le bug : à l'enregistrement, l'éditeur recopiait SES annotations sur toutes les zones du même
// plan — or, pour les plans SUPPLÉMENTAIRES, il ne les avait pas fusionnées à l'ouverture → les
// annotations (vides) de la nouvelle zone ÉCRASAIENT celles de l'autre. Désormais :
//   • à l'ouverture : chaque plan (principal ET supplémentaires) montre l'UNION des annotations
//     de toutes les zones qui le partagent ;
//   • à l'enregistrement : on ne répercute que ce qui a CHANGÉ pendant la session (ajouts,
//     suppressions explicites) — jamais un remplacement en bloc. Plan non modifié = rien envoyé.
// Comparaison par empreinte (annotFp : marqueur = son id stable, sinon position arrondie).
import { annotFp } from './vpNumbering.js';

// Union sans doublon (ordre : d'abord `own`, puis ce qui manque des autres listes).
export function unionPaths(own, ...others) {
  const out = [...(own || [])];
  const seen = new Set(out.map(annotFp));
  for (const list of others) for (const p of (list || [])) {
    const f = annotFp(p);
    if (!seen.has(f)) { seen.add(f); out.push(p); }
  }
  return out;
}

export function sameFps(a, b) {
  const fa = (a || []).map(annotFp).sort(), fb = (b || []).map(annotFp).sort();
  return fa.length === fb.length && fa.every((f, i) => f === fb[i]);
}

// Annotations d'une AUTRE zone après une session d'édition : on retire ce que l'utilisateur a
// supprimé (présent à l'ouverture, absent à l'enregistrement), on met à jour ce qu'il a modifié
// (même empreinte → version enregistrée) et on ajoute ce qu'il a créé. Le reste est intact.
export function propagatePaths(otherPaths, openedPaths, savedPaths) {
  const saved = new Map((savedPaths || []).map(p => [annotFp(p), p]));
  const opened = new Set((openedPaths || []).map(annotFp));
  const removed = new Set([...opened].filter(f => !saved.has(f)));
  const out = [];
  const seen = new Set();
  for (const p of (otherPaths || [])) {
    const f = annotFp(p);
    if (removed.has(f) || seen.has(f)) continue;
    seen.add(f);
    out.push(saved.has(f) ? saved.get(f) : p);
  }
  for (const [f, p] of saved) if (!seen.has(f)) { seen.add(f); out.push(p); }
  return out;
}

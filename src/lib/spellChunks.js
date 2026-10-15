// Découpe d'un texte LONG en morceaux pour la correction IA (retour Thomas : « mes textes sont
// trop longs » → la réponse du modèle était coupée par sa limite de sortie). Chaque morceau est
// corrigé séparément puis recollé : la concaténation des morceaux redonne EXACTEMENT le texte
// d'origine (séparateurs compris), le diff de correction reste donc calculé sur le texte entier.
//
// Coupe de préférence entre paragraphes (sauts de ligne), sinon en fin de phrase, sinon sur un
// espace — jamais au milieu d'un mot.
export const SPELL_CHUNK_CHARS = 3000;

function splitLongPara(p, max) {
  const out = [];
  let rest = p;
  while (rest.length > max) {
    const win = rest.slice(0, max);
    // Dernière fin de phrase (. ! ? …) suivie d'un espace dans la fenêtre, sinon dernier espace.
    let cut = -1;
    const re = /[.!?…;:](\s+)/g;
    let m;
    while ((m = re.exec(win))) cut = m.index + 1 + m[1].length;
    if (cut < max * 0.4) { const sp = win.lastIndexOf(' '); cut = sp > 0 ? sp + 1 : max; }
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

export function chunkForCorrection(text, max = SPELL_CHUNK_CHARS) {
  const s = String(text ?? '');
  if (s.length <= max) return [s];
  // Paragraphes AVEC leurs sauts de ligne finaux (concaténation = texte exact).
  const paras = s.match(/[^\n]*\n*|[^\n]+$/g).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if (p.length > max) {
      if (cur) { chunks.push(cur); cur = ''; }
      chunks.push(...splitLongPara(p, max));
      continue;
    }
    if (cur && cur.length + p.length > max) { chunks.push(cur); cur = ''; }
    cur += p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// Exécute fn(item, index) sur chaque élément avec au plus `limit` appels simultanés.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

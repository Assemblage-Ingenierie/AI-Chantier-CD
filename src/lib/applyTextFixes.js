// Application POSITIONNELLE des corrections d'orthographe (diff mot à mot du correcteur IA).
//
// Pourquoi (retour Thomas : « la correction des fautes ne s'est pas appliquée ») : l'ancienne
// application cherchait chaque mot fautif dans TOUT le commentaire et corrigeait sa PREMIÈRE
// occurrence. Conséquences : un « de » en trop était retiré dans une AUTRE phrase (texte
// correct abîmé), et les insertions (« présence  plusieurs » → « présence de plusieurs ») ou
// corrections d'espaces étaient ignorées. Ici, chaque correction est appliquée à SA position
// exacte, en conservant la mise en forme (gras, puces, couleurs, images).
//
// Principe : le texte brut analysé (`plain`) et les nœuds texte du HTML ont les MÊMES caractères
// non blancs, dans le même ordre (seuls les blancs / sauts de ligne diffèrent). On aligne donc
// les deux via leurs caractères non blancs, puis on édite les nœuds texte de la fin vers le début.
// Si l'alignement échoue (texte modifié entre-temps…), renvoie null → l'appelant garde l'ancienne
// méthode : aucune régression possible.

const isWs = (c) => /\s/.test(c);

// Différences PUREMENT typographiques (apostrophe ’ vs ', guillemets “ ” vs ", espace insécable vs
// espace) : ce ne sont pas des fautes. On les ignore dans la comparaison, sinon elles s'affichaient
// comme de fausses « corrections » (retour Thomas : « il reste des trucs chelous »).
const typo = (s) => s
  .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
  .replace(/[\u201c\u201d\u2033]/g, '"')
  .replace(/[\u00a0\u202f]/g, ' ');

// Diff mot à mot (LCS) entre le texte original et le texte corrigé par l'IA → segments neutres
// ('eq') ou corrections activables ('fix'). Les segments 'eq' gardent le texte ORIGINAL (le
// diff recompose exactement l'original, et sa typographie n'est jamais modifiée).
//
// PERF (retour Thomas 20/10 : « des fois l'IA de correction plante ») : la table LCS complète
// (mots × mots) sur un LONG texte pesait des centaines de Mo → onglet tué sur téléphone. Désormais :
// fin identique retirée d'abord, table compacte (Uint16Array), et l'appelant diffe morceau
// par morceau (diffChunks). Au-delà d'un plafond, repli sûr : une seule correction globale.
const LCS_MAX_CELLS = 4e6;
export function buildDiffSegments(orig, corr) {
  const wa = orig.split(/(\s+)/);
  const wb = corr.split(/(\s+)/);
  const na = wa.map(typo), nb = wb.map(typo);
  // Suffixe commun hors table (même résultat que la table complète : la remontée part de la fin
  // et y apparie déjà les mots identiques).
  let suf = 0;
  while (suf < na.length && suf < nb.length && na[na.length - 1 - suf] === nb[nb.length - 1 - suf]) suf++;
  // Préfixe commun : SEULEMENT si la table serait trop grosse (il peut changer le côté où
  // s'accroche l'espace d'une correction — résultat appliqué identique — donc pas pour les
  // textes courts, qui gardent exactement le comportement d'avant).
  let pre = 0;
  if ((na.length - suf + 1) * (nb.length - suf + 1) > LCS_MAX_CELLS)
    while (pre < na.length - suf && pre < nb.length - suf && na[pre] === nb[pre]) pre++;
  const tokens = [];
  for (let k = 0; k < pre; k++) tokens.push({ t:'eq', v:wa[k] });
  const n = na.length - pre - suf, m = nb.length - pre - suf;
  if (n > 0 || m > 0) {
    if ((n + 1) * (m + 1) > LCS_MAX_CELLS || n >= 65535 || m >= 65535) {
      // Encore trop gros : même nombre de lignes → comparaison LIGNE PAR LIGNE ; sinon une seule
      // correction globale (toujours exacte et réversible).
      const lines = (t) => t.match(/[^\n]*\n|[^\n]+$/g) || []; // (pas de lookbehind : Safari < 16.4)
      const la = lines(orig), lb = lines(corr);
      if (la.length === lb.length && la.length > 1) return diffChunks(la, lb);
      for (let k = 0; k < n; k++) tokens.push({ t:'del', v:wa[pre + k] });
      for (let k = 0; k < m; k++) tokens.push({ t:'add', v:wb[pre + k] });
    } else {
      const W = m + 1;
      const dp = new Uint16Array((n + 1) * W);
      for (let i = 1; i <= n; i++)
        for (let j = 1; j <= m; j++)
          dp[i * W + j] = na[pre + i - 1] === nb[pre + j - 1] ? dp[(i - 1) * W + j - 1] + 1 : Math.max(dp[(i - 1) * W + j], dp[i * W + j - 1]);
      const mid = [];
      let i = n, j = m;
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && na[pre + i - 1] === nb[pre + j - 1]) { mid.push({ t:'eq', v:wa[pre + i - 1] }); i--; j--; }
        else if (j > 0 && (i === 0 || dp[i * W + j - 1] >= dp[(i - 1) * W + j])) { mid.push({ t:'add', v:wb[pre + j - 1] }); j--; }
        else { mid.push({ t:'del', v:wa[pre + i - 1] }); i--; }
      }
      for (let k = mid.length - 1; k >= 0; k--) tokens.push(mid[k]);
    }
  }
  for (let k = wa.length - suf; k < wa.length; k++) tokens.push({ t:'eq', v:wa[k] });
  // Grouper en segments : texte neutre ou correction toggleable
  const segs = [];
  let ci = 0, k = 0;
  while (k < tokens.length) {
    if (tokens[k].t === 'eq') {
      let text = '';
      while (k < tokens.length && tokens[k].t === 'eq') { text += tokens[k].v; k++; }
      segs.push({ type:'eq', text });
    } else {
      const dels = [], adds = [];
      while (k < tokens.length && tokens[k].t === 'del') { dels.push(tokens[k].v); k++; }
      while (k < tokens.length && tokens[k].t === 'add') { adds.push(tokens[k].v); k++; }
      segs.push({ type:'fix', id: ci++, del: dels.join(''), add: adds.join(''), active: true });
    }
  }
  return segs;
}

// Diff MORCEAU PAR MORCEAU (textes longs corrigés en plusieurs appels) : chaque paire
// (morceau d'origine, morceau corrigé) est comparée séparément, puis les segments sont recollés
// (identifiants renumérotés, textes neutres voisins fusionnés). Recompose exactement l'original.
export function diffChunks(origChunks, corrChunks) {
  const out = [];
  let id = 0;
  origChunks.forEach((o, k) => {
    for (const s of buildDiffSegments(o, corrChunks[k] ?? o)) {
      if (s.type === 'eq') {
        const last = out[out.length - 1];
        if (last?.type === 'eq') last.text += s.text; else out.push({ ...s });
      } else out.push({ ...s, id: id++ });
    }
  });
  return out;
}

/**
 * @param {string} html      commentaire HTML courant
 * @param {string} plain     texte brut sur lequel le diff a été calculé
 * @param {Array}  segments  segments du diff : {type:'eq', text} | {type:'fix', del, add, active}
 * @returns {string|null}    HTML corrigé, ou null si l'alignement est impossible
 */
export function applyFixesAtPositions(html, plain, segments) {
  if (typeof DOMParser === 'undefined' || !Array.isArray(segments)) return null;
  let doc;
  try { doc = new DOMParser().parseFromString(html || '', 'text/html'); }
  catch { return null; }

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let flat = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n, start: flat.length });
    flat += n.nodeValue;
  }

  // Alignement par caractères non blancs : flatMap[k] = position (dans flat) du k-ième non-blanc.
  const flatMap = [];
  for (let i = 0; i < flat.length; i++) if (!isWs(flat[i])) flatMap.push(i);
  const plainNW = [];
  for (let i = 0; i < plain.length; i++) if (!isWs(plain[i])) plainNW.push(i);
  if (flatMap.length !== plainNW.length) return null;
  for (let k = 0; k < flatMap.length; k++) if (flat[flatMap[k]] !== plain[plainNW[k]]) return null;

  // nwBefore[p] = nombre de caractères non blancs de plain avant la position p.
  const nwBefore = new Array(plain.length + 1);
  for (let i = 0, c = 0; i <= plain.length; i++) {
    nwBefore[i] = c;
    if (i < plain.length && !isWs(plain[i])) c++;
  }

  // Les segments recomposent `plain` dans l'ordre : on vérifie, sinon on renonce (sûr).
  const recomposed = segments.map(s => (s.type === 'eq' ? s.text : s.del)).join('');
  if (recomposed !== plain) return null;

  // 1) Calcul des éditions [fs, fe) → rep dans flat.
  const edits = [];
  let pos = 0;
  for (const s of segments) {
    if (s.type === 'eq') { pos += s.text.length; continue; }
    const ps = pos, pe = pos + s.del.length;
    pos = pe;
    if (s.type !== 'fix' || s.active === false) continue;
    const ka = nwBefore[ps], kb = nwBefore[pe];
    if (kb > ka) {
      // Remplacement / suppression d'un passage contenant du texte.
      let fs = flatMap[ka], fe = flatMap[kb - 1] + 1;
      const rep = s.add.trim();
      if (rep.includes('\n')) continue; // correction à cheval sur des lignes → on ne touche pas
      if (!rep) {
        // Suppression pure : retire aussi UN blanc voisin pour ne pas laisser de double espace.
        if (fs > 0 && /[ \t\u00a0]/.test(flat[fs - 1])) fs--;
        else if (fe < flat.length && /[ \t\u00a0]/.test(flat[fe])) fe++;
      }
      edits.push({ fs, fe, rep });
    } else {
      // Insertion ou correction d'espaces : on réécrit les blancs entre les deux mots voisins.
      const lead = plain.slice(0, ps).match(/\s*$/)[0];
      const trail = plain.slice(pe).match(/^\s*/)[0];
      const rep = lead + s.add + trail;
      if ((lead + s.del + trail).includes('\n') || rep.includes('\n')) continue;
      const fs = ka > 0 ? flatMap[ka - 1] + 1 : 0;
      const fe = ka < flatMap.length ? flatMap[ka] : flat.length;
      if (flat.slice(fs, fe).includes('\n')) continue;
      edits.push({ fs, fe, rep });
    }
  }
  if (!edits.length) return html;

  // 2) Application de la FIN vers le DÉBUT : les positions des éditions restantes restent valides.
  edits.sort((a, b) => b.fs - a.fs);
  let lowestApplied = Infinity;
  for (const { fs, fe, rep } of edits) {
    if (fe > lowestApplied) continue; // chevauchement avec une édition déjà faite → on saute (sûr)
    if (replaceRange(nodes, fs, fe, rep)) lowestApplied = fs;
  }
  return doc.body.innerHTML;
}

// Remplace la plage [fs, fe) de la concaténation des nœuds texte par `rep`.
function replaceRange(nodes, fs, fe, rep) {
  if (fs === fe) {
    // Insertion pure : dans le nœud qui contient la position (fin du nœud précédent si frontière).
    for (const it of nodes) {
      const t = it.node.nodeValue, nS = it.start, nE = nS + t.length;
      if ((fs > nS && fs <= nE) || (fs === 0 && nS === 0)) {
        it.node.nodeValue = t.slice(0, fs - nS) + rep + t.slice(fs - nS);
        return true;
      }
    }
    return false;
  }
  let done = false;
  for (const it of nodes) {
    const t = it.node.nodeValue, nS = it.start, nE = nS + t.length;
    const oS = Math.max(nS, fs), oE = Math.min(nE, fe);
    if (oS >= oE) continue;
    it.node.nodeValue = t.slice(0, oS - nS) + (done ? '' : rep) + t.slice(oE - nS);
    done = true;
  }
  return done;
}

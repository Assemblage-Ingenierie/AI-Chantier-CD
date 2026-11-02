// Dictée vocale : fusion des résultats de la reconnaissance avec le texte déjà dicté.
//
// Retour Thomas 02/11 : « des fois ça m'inscrit deux fois la même phrase ». Les moteurs renvoient
// souvent du texte DÉJÀ reçu : Android renvoie toute la phrase accumulée comme un nouveau résultat
// final ; iOS rejoue l'audio récent au redémarrage auto ; un final peut arriver après qu'on a déjà
// validé le texte provisoire au relâchement. L'ancien garde-fou ne retirait que les répétitions
// au mot près (casse ignorée) : une ponctuation ou une apostrophe différente (« fissure. » vs
// « fissure ») suffisait à laisser passer le doublon.
//
// mergeDictation(session, incoming) → la partie VRAIMENT nouvelle de `incoming` (chaîne, '' si rien) :
//   1. comparaison NORMALISÉE (casse, ponctuation, apostrophes, espaces) ;
//   2. retire le plus long début de `incoming` qui répète la fin de `session` ;
//   3. ignore `incoming` s'il est déjà contenu tel quel dans la fin récente de `session` (≥ 3 mots) ;
//   4. fusionne une répétition collée dans un même résultat (« il y a une fissure il y a une fissure »).
// Ne retire QUE des séquences identiques (après normalisation) : jamais de vrai texte perdu.

const norm = (w) => w
  .toLowerCase()
  .replace(/[’‘`´]/g, "'")
  .replace(/[.,;:!?…«»"“”()[\]{}]/g, '')
  .trim();

const words = (s) => String(s || '').split(/\s+/).filter(Boolean);

// « il y a une fissure il y a une fissure au droit » → « il y a une fissure au droit » (≥ 3 mots).
export function collapseRepeats(txt) {
  let w = words(txt);
  let changed = true;
  while (changed) {
    changed = false;
    for (let len = Math.floor(w.length / 2); len >= 3 && !changed; len--) {
      for (let i = 0; i + 2 * len <= w.length; i++) {
        let same = true;
        for (let k = 0; k < len; k++) if (norm(w[i + k]) !== norm(w[i + len + k])) { same = false; break; }
        if (same) { w = [...w.slice(0, i + len), ...w.slice(i + 2 * len)]; changed = true; break; }
      }
    }
  }
  return w.join(' ');
}

export function mergeDictation(session, incoming) {
  const inW = words(collapseRepeats(incoming));
  if (!inW.length) return '';
  const sW = words(session);
  if (!sW.length) return inW.join(' ');
  const inN = inW.map(norm), sN = sW.map(norm);

  // 3. Déjà dit, tel quel, dans la fin récente (Android/iOS qui rejouent un bout de phrase).
  if (inN.filter(Boolean).length >= 3) {
    const tail = sN.slice(-60).join(' ');
    const needle = inN.filter(Boolean).join(' ');
    if (` ${tail} `.includes(` ${needle} `)) return '';
  }
  // 2. Plus long début de `incoming` = fin de `session`.
  for (let len = Math.min(inN.length, sN.length); len >= 1; len--) {
    let ok = true;
    for (let i = 0; i < len; i++) if (inN[i] !== sN[sN.length - len + i]) { ok = false; break; }
    if (ok) return inW.slice(len).join(' ');
  }
  // Android « cumulatif » : le résultat reprend le début de la séance puis ajoute la suite.
  if (inN.length > 3 && sN.length >= 3) {
    let k = 0;
    while (k < sN.length && k < inN.length && inN[k] === sN[k]) k++;
    if (k === sN.length) return inW.slice(k).join(' ');
  }
  return inW.join(' ');
}

// Majuscule au début d'une phrase (après un saut de ligne, un point, ou en début de texte).
export function capitalizeAfter(prevText, txt) {
  if (!txt) return txt;
  const before = String(prevText || '').replace(/<[^>]*>/g, '').trimEnd();
  if (!before || /[.!?…]$/.test(before)) return txt.charAt(0).toUpperCase() + txt.slice(1);
  return txt;
}

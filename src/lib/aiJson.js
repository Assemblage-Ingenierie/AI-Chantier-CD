// Lecture TOLÉRANTE des réponses JSON de l'IA (bouton « Améliorer avec l'IA »).
//
// Retour Thomas 10/11 : « ça propose des trucs à vérifier mais ça ne reformule plus du tout ».
// Sur un texte long, la réponse de l'IA était COUPÉE (limite de longueur, réflexion comprise
// chez Gemini) → JSON invalide → TOUT était jeté (corrections + reformulations), et l'erreur
// était ensuite masquée par l'arrivée des points « à vérifier » des photos.
//
// parseLooseJson(raw, keys) : JSON complet si possible ; sinon, pour chaque tableau demandé
// (ex. corrections / reformulations / ajouts), récupère un à un les objets COMPLETS déjà reçus.
// Un objet tronqué en fin de réponse est simplement ignoré. Fonction pure, sans I/O.

function tryParse(s) { try { return JSON.parse(s); } catch { return undefined; } }

// Objets `{…}` complets d'un tableau qui commence à `start` (index du « [ »).
function objectsFrom(raw, start) {
  const out = [];
  let i = start + 1, depth = 0, inStr = false, esc = false, objStart = -1;
  for (; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) objStart = i; depth++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        const o = tryParse(raw.slice(objStart, i + 1));
        if (o && typeof o === 'object') out.push(o);
        objStart = -1;
      }
      continue;
    }
    if (ch === ']' && depth === 0) break; // fin du tableau
  }
  return out;
}

export function parseLooseJson(raw, keys = []) {
  const text = String(raw || '');
  const whole = tryParse((text.match(/\{[\s\S]*\}/) || [''])[0]);
  if (whole && typeof whole === 'object') return { obj: whole, partial: false };
  const obj = {};
  let found = false;
  for (const k of keys) {
    const m = new RegExp(`"${k}"\\s*:\\s*\\[`).exec(text);
    if (!m) continue;
    obj[k] = objectsFrom(text, m.index + m[0].length - 1);
    found = true;
  }
  return found ? { obj, partial: true } : { obj: null, partial: true };
}

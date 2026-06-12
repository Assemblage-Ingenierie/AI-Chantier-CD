// Préférences d'AFFICHAGE par photo dans le rapport (orientation portrait/paysage + recadrage).
//
// POURQUOI un magasin dédié : ces réglages ne sont pas stockés en base (pas de colonne).
// Les faire transiter par le cache projet + la fusion local/remote + l'hydratation s'est
// révélé fragile (l'orientation repassait en paysage après rechargement). Ce magasin
// localStorage est indexé par l'ID STABLE de la ligne photo (`_id`) → il survit au
// rechargement quoi qu'il arrive dans la chaîne de sync, et reste purement additif.
//
// Sécurité : si localStorage est indisponible, tout est un no-op silencieux.

const KEY = 'chantierai_photo_prefs_v1';
const _hasLS = (() => { try { localStorage.setItem('__pp__', '1'); localStorage.removeItem('__pp__'); return true; } catch { return false; } })();

let _cache = null;
function readAll() {
  if (_cache) return _cache;
  try { _cache = _hasLS ? (JSON.parse(localStorage.getItem(KEY) || '{}') || {}) : {}; }
  catch { _cache = {}; }
  return _cache;
}
function writeAll(map) {
  _cache = map;
  try { if (_hasLS) localStorage.setItem(KEY, JSON.stringify(map)); } catch {}
}

// Champs d'affichage que l'on persiste (jamais les pixels de l'image).
const FIELDS = ['orient', 'cropX', 'cropY', 'cropZoom'];

export function getPhotoPref(id) {
  if (!id) return null;
  const v = readAll()[id];
  return v || null;
}

// Enregistre/merge les réglages d'une photo. Les valeurs undefined sont ignorées (on ne
// veut pas écraser un réglage existant avec rien) ; orient:'landscape' (défaut) purge l'entrée
// si plus aucun autre réglage n'est présent, pour garder le magasin compact.
export function setPhotoPref(id, prefs) {
  if (!id || !prefs) return;
  const map = { ...readAll() };
  const cur = { ...(map[id] || {}) };
  for (const f of FIELDS) if (prefs[f] !== undefined) cur[f] = prefs[f];
  map[id] = cur;
  writeAll(map);
}

// Applique les préférences sauvegardées sur un objet photo hydraté (retourne une copie si
// une préférence existe, sinon l'objet tel quel). orient absent → on n'impose rien.
export function applyPhotoPref(photo) {
  const pref = getPhotoPref(photo?._id);
  if (!pref) return photo;
  const out = { ...photo };
  for (const f of FIELDS) if (pref[f] !== undefined) out[f] = pref[f];
  return out;
}

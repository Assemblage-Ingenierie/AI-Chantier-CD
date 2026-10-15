// ALLÈGEMENT des photos de couverture trop lourdes (retour Thomas 15/10/2026 : « la page de garde
// de Rue de Cléry et de Piuvelle met 10× plus de temps à charger que les autres »).
//
// Cause : sur iPhone, le recadrage encodait la couverture en PNG (Safari ne sait pas produire de
// WebP) → fichier ~10× plus lourd que les autres. Le recadrage est corrigé (CropTool) ; ici on
// répare les couvertures DÉJÀ envoyées :
//   - seulement les couvertures « par contenu » (…/cover/<id>/c<empreinte>.<ext>, le format actuel) ;
//   - si le fichier pèse > 350 Ko ou est un PNG : version compressée (≤ 1600 px, WebP/JPEG)
//     envoyée À CÔTÉ (nouveau nom), puis la fiche projet pointe dessus ;
//   - l'ANCIEN fichier n'est jamais supprimé ni écrasé (rien ne se perd) ;
//   - vérifié une seule fois par fichier et par appareil (mémo localStorage) ;
//   - toute erreur → on ne touche à rien (affichage inchangé).
import { getSupabase } from '../supabase.js';
import { contentKey } from './storage.js';

const SIGNED_TTL = 2592000; // 30 jours, comme les autres photos
const HEAVY_BYTES = 350 * 1024;
const DONE_KEY = 'chantierai_cover_opt_v1';

function loadDone() { try { return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]')); } catch { return new Set(); } }
function markDone(set, path) {
  set.add(path);
  try { localStorage.setItem(DONE_KEY, JSON.stringify([...set].slice(-300))); } catch { /* mode privé */ }
}

// Chemin Storage d'une URL signée (ou chemin relatif) du bucket photos.
export function coverPathOf(urlOrPath) {
  if (typeof urlOrPath !== 'string' || !urlOrPath || urlOrPath.startsWith('data:')) return null;
  const m = urlOrPath.match(/\/storage\/v1\/object\/(?:sign|public)\/photos\/([^?]+)/);
  let path = m ? m[1] : (/^https?:/i.test(urlOrPath) ? null : urlOrPath);
  if (!path) return null;
  try { path = decodeURIComponent(path); } catch { /* garde tel quel */ }
  return /\/cover\/[^/]+\/c[\w-]+\.(webp|jpe?g|png)$/i.test(path) ? path : null;
}

function encodeCover(blob) {
  return new Promise((resolve) => {
    try {
      const u = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const sc = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight || 1));
          const cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(img.naturalWidth * sc));
          cv.height = Math.max(1, Math.round(img.naturalHeight * sc));
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          const webp = cv.toDataURL('image/webp', 0.82);
          resolve(webp.startsWith('data:image/webp') ? webp : cv.toDataURL('image/jpeg', 0.85));
        } catch { resolve(null); }
        URL.revokeObjectURL(u);
      };
      img.onerror = () => { URL.revokeObjectURL(u); resolve(null); };
      img.src = u;
    } catch { resolve(null); }
  });
}

// projets : [{ id, photo }] — renvoie { [id]: nouvelle URL signée } pour les couvertures allégées.
export async function optimizeHeavyCovers(projets) {
  const out = {};
  const done = loadDone();
  const todo = (projets || [])
    .map(p => ({ id: p.id, path: coverPathOf(p.photo), url: p.photo }))
    .filter(t => t.id && t.path && !done.has(t.path));
  if (!todo.length) return out;
  let sb;
  try { sb = await getSupabase(); } catch { return out; }
  for (const t of todo) {
    try {
      const folder = t.path.slice(0, t.path.lastIndexOf('/'));
      const name = t.path.slice(t.path.lastIndexOf('/') + 1);
      const { data: files, error: lsErr } = await sb.storage.from('photos').list(folder, { search: name });
      if (lsErr) continue; // réessaiera à la prochaine ouverture
      const meta = (files || []).find(f => f?.name === name)?.metadata;
      if (!meta) { markDone(done, t.path); continue; }
      const size = Number(meta.size) || 0;
      const isPng = /png/i.test(meta.mimetype || '');
      if (size <= HEAVY_BYTES && !isPng) { markDone(done, t.path); continue; }
      const { data: sg } = await sb.storage.from('photos').createSignedUrl(t.path, 600);
      if (!sg?.signedUrl) continue;
      const resp = await fetch(sg.signedUrl);
      if (!resp.ok) continue;
      const dataUrl = await encodeCover(await resp.blob());
      if (!dataUrl) continue;
      const newBlob = await (await fetch(dataUrl)).blob();
      if (newBlob.size >= size * 0.8) { markDone(done, t.path); continue; } // pas de gain → on garde
      const ext = newBlob.type === 'image/webp' ? 'webp' : 'jpg';
      const newPath = `${folder}/c${contentKey(dataUrl)}.${ext}`;
      const { error: upErr } = await sb.storage.from('photos').upload(newPath, newBlob, { contentType: newBlob.type, upsert: true, cacheControl: '31536000' });
      if (upErr) continue;
      // La fiche ne pointe sur le nouveau fichier QUE s'il pointe encore sur l'ancien (pas d'écrasement
      // d'une couverture changée entre-temps sur un autre appareil).
      const { data: upd, error: dbErr } = await sb.from('aichantier_chantiers').update({ photo: newPath }).eq('id', t.id).eq('photo', t.path).select('id');
      if (dbErr) continue;
      if (!upd?.length) { markDone(done, t.path); continue; } // fiche déjà ailleurs → on ne change rien
      const { data: s2 } = await sb.storage.from('photos').createSignedUrl(newPath, SIGNED_TTL);
      markDone(done, t.path);
      markDone(done, newPath);
      if (s2?.signedUrl) out[t.id] = s2.signedUrl;
      console.log(`[cover] couverture allégée ${Math.round(size / 1024)} Ko → ${Math.round(newBlob.size / 1024)} Ko`, t.id);
    } catch { /* on ne touche à rien */ }
  }
  return out;
}

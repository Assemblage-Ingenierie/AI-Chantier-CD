import { getSupabase } from '../supabase.js';

const PROF_KEY = '_sb_prof'; // même clé que useAuth — cache profil (TTL 8h géré côté useAuth)

// Initiales suggérées depuis prénom + nom (ex : « Thomas Cassetari » → « TC »).
// Repli : 2 premières lettres du prénom, sinon de l'email.
export function suggestInitials({ first_name, last_name, email }) {
  const f = (first_name || '').trim();
  const l = (last_name || '').trim();
  if (f && l) return (f[0] + l[0]).toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  if (email) return email.slice(0, 2).toUpperCase();
  return '';
}

// Un projet est « à moi » si mes initiales figurent dans ses ingénieurs au niveau PROJET
// (champ `ingenieurs`, saisi à la création/modification) OU sur au moins une de ses visites —
// les deux champs sont indépendants, l'un OU l'autre suffit (demande Thomas). Tolérant au
// multi-ingénieurs (« SV, TCM ») : on découpe sur tout séparateur.
// Partagé par le filtre « Mes projets » (Dashboard) et le pré-téléchargement hors-ligne.
export function projectMatchesInitials(p, initials) {
  const mine = (initials || '').trim().toUpperCase();
  if (!mine) return false;
  const has = (s) => String(s || '').toUpperCase().split(/[^A-Z0-9]+/).includes(mine);
  return has(p.ingenieurs) || (p.visites || []).some(v => has(v.ingenieur));
}

// Nom affichable d'un profil : « Prénom Nom » sinon email.
export function displayName(p) {
  if (!p) return '';
  const full = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  return full || p.email || '';
}

// Vérifie si des initiales sont déjà prises par un AUTRE compte (fonction SECURITY DEFINER
// côté Supabase : un non-admin ne voit que sa propre fiche, il ne peut pas vérifier lui-même).
// DÉFENSIF : si la migration n'est pas encore appliquée (fonction absente) ou en cas d'erreur
// réseau, renvoie false (on n'empêche pas la sauvegarde, l'unicité sera contrôlée plus tard).
export async function checkInitialsTaken(initials) {
  const v = (initials || '').trim();
  if (!v) return false;
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.rpc('initials_taken', { p_initials: v });
    if (error) return false;
    return data === true;
  } catch { return false; }
}

// Met à jour SA PROPRE fiche profil (RLS : auth.uid() = id). Rafraîchit le cache local
// pour que le nom/initiales soient immédiatement disponibles sans recharger.
// Ne patche QUE les champs réellement fournis : « Mon compte » n'édite plus Poste/Téléphone,
// il ne doit pas les écraser à null (le Poste est géré par l'admin).
export async function saveMyProfile(userId, fields) {
  const sb = await getSupabase();
  const patch = {};
  for (const k of ['first_name', 'last_name', 'job_title', 'phone', 'initials']) {
    if (k in fields) patch[k] = fields[k]?.trim() || null;
  }
  const { data, error } = await sb
    .from('aichantier_profiles')
    .update(patch)
    .eq('id', userId)
    .select('*')
    .single();
  if (error) throw error;
  try {
    const cached = JSON.parse(localStorage.getItem(PROF_KEY) || 'null');
    if (cached?.id === userId) {
      localStorage.setItem(PROF_KEY, JSON.stringify({ ...cached, ...data, _ts: Date.now() }));
    }
  } catch { /* cache best-effort */ }
  return data;
}

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

// Nom affichable d'un profil : « Prénom Nom » sinon email.
export function displayName(p) {
  if (!p) return '';
  const full = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  return full || p.email || '';
}

// Met à jour SA PROPRE fiche profil (RLS : auth.uid() = id). Rafraîchit le cache local
// pour que le nom/initiales soient immédiatement disponibles sans recharger.
export async function saveMyProfile(userId, fields) {
  const sb = await getSupabase();
  const patch = {
    first_name: fields.first_name?.trim() || null,
    last_name:  fields.last_name?.trim()  || null,
    job_title:  fields.job_title?.trim()  || null,
    phone:      fields.phone?.trim()      || null,
    initials:   fields.initials?.trim()   || null,
  };
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

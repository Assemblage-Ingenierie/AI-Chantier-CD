import { getSupabase } from '../supabase.js';

const LS_OLD_KEY = 'chantierai_contacts_v1';
const LS_MIGRATED_KEY = 'chantierai_contacts_migrated_v2';

function toRow(c) {
  return {
    nom: c.nom,
    poste: c.poste || null,
    email: c.email || null,
    tel: c.tel || null,
    is_assemblage: !!c.isAssemblage,
  };
}

function fromRow(row) {
  return {
    id: row.id,
    nom: row.nom,
    poste: row.poste || '',
    email: row.email || '',
    tel: row.tel || '',
    isAssemblage: row.is_assemblage,
  };
}

export async function loadContacts() {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from('aichantier_contacts')
    .select('*')
    .order('is_assemblage', { ascending: false })
    .order('nom');
  if (error) throw error;
  return (data || []).map(fromRow);
}

export async function upsertContact(contact) {
  const sb = await getSupabase();
  const row = toRow(contact);
  if (contact.id) {
    const { error } = await sb.from('aichantier_contacts').update(row).eq('id', contact.id);
    if (error) throw error;
    return contact.id;
  } else {
    const { data, error } = await sb.from('aichantier_contacts').insert(row).select('id').single();
    if (error) throw error;
    return data.id;
  }
}

export async function deleteContact(id) {
  const sb = await getSupabase();
  const { error } = await sb.from('aichantier_contacts').delete().eq('id', id);
  if (error) throw error;
}

// Seeds the hardcoded Assemblage team if the table has no Assemblage entries yet.
export async function seedAssemblageContacts(team) {
  const sb = await getSupabase();
  const { count } = await sb
    .from('aichantier_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('is_assemblage', true);
  if (count > 0) return;
  const rows = team.map(t => ({ ...toRow({ ...t, isAssemblage: true }), id: crypto.randomUUID() }));
  const { error } = await sb.from('aichantier_contacts').insert(rows);
  if (error) console.error('Contact seed error:', error);
}

// One-time migration of old localStorage contacts to Supabase.
export async function migrateLocalContacts() {
  try {
    if (localStorage.getItem(LS_MIGRATED_KEY)) return;
    const raw = localStorage.getItem(LS_OLD_KEY);
    if (raw) {
      const old = JSON.parse(raw);
      if (old.length) {
        const sb = await getSupabase();
        await sb.from('aichantier_contacts').upsert(
          old.map(c => ({ id: c.id || crypto.randomUUID(), ...toRow(c) }))
        );
      }
    }
    localStorage.setItem(LS_MIGRATED_KEY, '1');
  } catch {}
}

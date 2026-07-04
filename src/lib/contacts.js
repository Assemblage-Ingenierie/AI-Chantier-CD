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

// ── Export / Import CSV ────────────────────────────────────────────────────────────
// Format Excel-friendly : séparateur « ; » + BOM UTF-8 (accents corrects à l'ouverture).

const CSV_HEADERS = ['Nom', 'Poste', 'Email', 'Téléphone', 'Type'];

function csvEscape(v) {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Contacts → chaîne CSV (avec BOM). `contacts` au format applicatif (fromRow).
export function contactsToCsv(contacts) {
  const lines = [CSV_HEADERS.join(';')];
  for (const c of contacts) {
    lines.push([
      csvEscape(c.nom), csvEscape(c.poste), csvEscape(c.email), csvEscape(c.tel),
      c.isAssemblage ? 'Assemblage' : 'Externe',
    ].join(';'));
  }
  return '﻿' + lines.join('\r\n');
}

// Parse une ligne CSV en respectant les guillemets (séparateur ; ou ,).
function splitCsvLine(line, sep) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// CSV → contacts (format applicatif). Détecte le séparateur (; ou ,), ignore l'entête,
// tolère un BOM. Ne renvoie que les lignes ayant au moins un nom.
export function parseContactsCsv(text) {
  if (!text) return [];
  const clean = text.replace(/^﻿/, '');
  const rows = clean.split(/\r\n|\n|\r/).filter(l => l.trim());
  if (!rows.length) return [];
  const sep = (rows[0].match(/;/g) || []).length >= (rows[0].match(/,/g) || []).length ? ';' : ',';
  const first = splitCsvLine(rows[0], sep).map(s => s.trim().toLowerCase());
  const looksHeader = first.some(h => ['nom', 'name', 'poste', 'email', 'e-mail', 'téléphone', 'telephone', 'tel', 'type'].includes(h));
  const dataRows = looksHeader ? rows.slice(1) : rows;
  const out = [];
  for (const line of dataRows) {
    const cols = splitCsvLine(line, sep).map(s => s.trim());
    const [nom, poste, email, tel, type] = cols;
    if (!nom) continue;
    out.push({
      nom, poste: poste || '', email: email || '', tel: tel || '',
      isAssemblage: /assemblage/i.test(type || ''),
    });
  }
  return out;
}

// Applique un import : met à jour les contacts existants (clé = email, repli nom),
// insère les nouveaux. NE SUPPRIME JAMAIS un contact absent du fichier (import non destructif).
// Renvoie { created, updated }.
export async function importContacts(parsed, existing) {
  const byEmail = new Map(existing.filter(c => c.email).map(c => [c.email.toLowerCase(), c]));
  const byName  = new Map(existing.map(c => [c.nom.trim().toLowerCase(), c]));
  let created = 0, updated = 0;
  for (const p of parsed) {
    const match = (p.email && byEmail.get(p.email.toLowerCase())) || byName.get(p.nom.trim().toLowerCase());
    if (match) { await upsertContact({ ...match, ...p, id: match.id }); updated++; }
    else { await upsertContact(p); created++; }
  }
  return { created, updated };
}

// Pré-calcul de l'aperçu d'import (sans écrire) — pour l'écran de confirmation.
export function previewImport(parsed, existing) {
  const byEmail = new Map(existing.filter(c => c.email).map(c => [c.email.toLowerCase(), c]));
  const byName  = new Map(existing.map(c => [c.nom.trim().toLowerCase(), c]));
  let created = 0, updated = 0;
  for (const p of parsed) {
    const match = (p.email && byEmail.get(p.email.toLowerCase())) || byName.get(p.nom.trim().toLowerCase());
    if (match) updated++; else created++;
  }
  return { total: parsed.length, created, updated };
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

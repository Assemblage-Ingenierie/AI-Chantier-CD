import { getSupabase } from '../supabase.js';

const LS_OLD_KEY = 'chantierai_contacts_v1';
const LS_MIGRATED_KEY = 'chantierai_contacts_migrated_v2';

function toRow(c) {
  return {
    nom: c.nom,
    poste: c.poste || null,
    entreprise: c.entreprise || null,
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
    entreprise: row.entreprise || '',
    email: row.email || '',
    tel: row.tel || '',
    isAssemblage: row.is_assemblage,
  };
}

// Si la migration « entreprise » n'est pas encore appliquée, PostgREST rejette la colonne
// inconnue → on retente sans elle (le reste du contact est sauvé, l'entreprise suivra).
function isUnknownEntrepriseColumn(error) {
  return /entreprise/i.test(error?.message || '') || error?.code === 'PGRST204';
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
    let { error } = await sb.from('aichantier_contacts').update(row).eq('id', contact.id);
    if (error && isUnknownEntrepriseColumn(error)) {
      const { entreprise, ...rest } = row;
      ({ error } = await sb.from('aichantier_contacts').update(rest).eq('id', contact.id));
    }
    if (error) throw error;
    return contact.id;
  } else {
    let { data, error } = await sb.from('aichantier_contacts').insert(row).select('id').single();
    if (error && isUnknownEntrepriseColumn(error)) {
      const { entreprise, ...rest } = row;
      ({ data, error } = await sb.from('aichantier_contacts').insert(rest).select('id').single());
    }
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

const CSV_HEADERS = ['Nom', 'Poste', 'Entreprise', 'Email', 'Téléphone', 'Type'];

function csvEscape(v) {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Contacts → chaîne CSV (avec BOM). `contacts` au format applicatif (fromRow).
export function contactsToCsv(contacts) {
  const lines = [CSV_HEADERS.join(';')];
  for (const c of contacts) {
    lines.push([
      csvEscape(c.nom), csvEscape(c.poste), csvEscape(c.entreprise), csvEscape(c.email), csvEscape(c.tel),
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

// CSV → contacts (format applicatif). Détecte le séparateur (; ou ,), tolère un BOM.
// Avec entête : mapping PAR NOM DE COLONNE (accepte les anciens fichiers sans Entreprise
// et tout ordre de colonnes). Sans entête : ordre positionnel du format d'export courant.
// Ne renvoie que les lignes ayant au moins un nom.
export function parseContactsCsv(text) {
  if (!text) return [];
  const clean = text.replace(/^﻿/, '');
  const rows = clean.split(/\r\n|\n|\r/).filter(l => l.trim());
  if (!rows.length) return [];
  const sep = (rows[0].match(/;/g) || []).length >= (rows[0].match(/,/g) || []).length ? ';' : ',';
  const first = splitCsvLine(rows[0], sep).map(s => s.trim().toLowerCase());
  const known = { nom:'nom', name:'nom', poste:'poste', entreprise:'entreprise', 'société':'entreprise', societe:'entreprise', email:'email', 'e-mail':'email', 'téléphone':'tel', telephone:'tel', tel:'tel', type:'type' };
  const looksHeader = first.some(h => known[h]);
  // Index de chaque champ : depuis l'entête si présente, sinon ordre du format d'export.
  const idx = { nom: 0, poste: 1, entreprise: 2, email: 3, tel: 4, type: 5 };
  if (looksHeader) {
    for (const k of Object.keys(idx)) idx[k] = -1;
    first.forEach((h, i) => { const f = known[h]; if (f && idx[f] === -1) idx[f] = i; });
    if (idx.nom === -1) idx.nom = 0;
  }
  const dataRows = looksHeader ? rows.slice(1) : rows;
  const out = [];
  const pick = (cols, i) => (i >= 0 && cols[i] != null ? cols[i] : '');
  for (const line of dataRows) {
    const cols = splitCsvLine(line, sep).map(s => s.trim());
    const nom = pick(cols, idx.nom);
    if (!nom) continue;
    out.push({
      nom,
      poste: pick(cols, idx.poste) || '',
      entreprise: pick(cols, idx.entreprise) || '',
      email: pick(cols, idx.email) || '',
      tel: pick(cols, idx.tel) || '',
      isAssemblage: /assemblage/i.test(pick(cols, idx.type) || ''),
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

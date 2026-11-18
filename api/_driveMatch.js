// RETROUVER LE DOSSIER DRIVE D'UNE AFFAIRE (partagé par drive-upload.js et drive-plans.js).
// Fichier préfixé « _ » : Vercel ne le publie pas comme fonction.
//
// Retour Thomas 18/11 : les vieilles affaires n'ont pas le même code que les nouvelles
// (« 2022_541_MARECHAL_VITRY » sans « A », « 2016_021_… » avec des zéros) ou une petite faute →
// dossier introuvable. Et une affaire peut être dans le Drive des affaires ARCHIVÉES.
//
// Ordre de recherche (le premier qui répond gagne) :
//   1. Affaires : même numéro (A541 = 541 = 0541) ET titre ressemblant ;
//   2. Affaires : titre très ressemblant ET numéro à une faute près (ou pas de numéro) ;
//   3. Affaires archivées : mêmes règles 1 puis 2 ;
//   4. même numéro seul (un seul dossier possible), Affaires puis archives — le numéro est la
//      donnée saisie par l'utilisateur : on ne crée pas un doublon s'il existe (cas « Pavillon
//      sous toit » renommé, retour Bach) ;
//   5. sinon (upload seulement) : création dans Affaires, au format « AAAA_NUM_TITRE ».

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

// ── Logique pure (testée : src/lib/driveMatch.test.js) ───────────────────────────────────────
const STOP = new Set(['rue', 'avenue', 'ave', 'bd', 'boulevard', 'bld', 'place', 'quai', 'impasse', 'allee', 'chemin', 'route',
  'de', 'du', 'des', 'la', 'le', 'les', 'et', 'sur', 'sous', 'aux', 'chez', 'pour', 'bis', 'ter',
  'projet', 'affaire', 'visite', 'mission', 'chantier', 'dossier', 'sci', 'sdc', 'sas', 'sarl']);

export const deaccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const compact = (s) => deaccent(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Numéro d'affaire normalisé : « A541 », « a0541 », « 541 », « 0541 » → « 541 ».
export function normNum(n) {
  const m = String(n || '').trim().match(/^a?\s*0*(\d{1,5})$/i);
  return m ? m[1] : null;
}

// Numéro d'affaire trouvé dans un NOM de projet (« A696 Péguy » → A696 ; « 504 Pavillon » → 504).
// Années (19xx/20xx) ignorées pour ne pas confondre un millésime avec un numéro.
export function numFromName(nom) {
  const s = String(nom || '');
  const a = s.match(/(?<![A-Za-z0-9])[Aa]\d{2,5}(?![0-9])/);
  if (a) return a[0].toUpperCase();
  const nums = s.match(/(?<![0-9])\d{2,4}(?![0-9])/g) || [];
  return nums.find(n => !/^(19|20)\d{2}$/.test(n)) || null;
}

// Nom de dossier Drive → { year, num, title }. Formats : « 2026_A743_BOURDEL_65RVOLTAIRE »,
// « 2022_541_MARECHAL_VITRY », « 2016_021_MANTES_PASSERELLE ». Sinon : numéro isolé éventuel.
export function parseFolderName(name) {
  const s = String(name || '').trim();
  const m = s.match(/^((?:19|20)\d{2})[\s_-]+[Aa]?0*(\d{1,5})(?:[\s_-]+(.*))?$/);
  if (m) return { year: m[1], num: m[2], title: m[3] || '' };
  const n = numFromName(s);
  return { year: null, num: n ? normNum(n) : null, title: s };
}

// Mots qui comptent dans un titre (sans accents, ≥ 3 lettres, sans chiffres seuls ni mots vides).
export function titleTokens(s) {
  return deaccent(s).toLowerCase()
    .replace(/(?<![a-z0-9])a?\d{2,5}(?![0-9])/g, ' ')   // numéro d'affaire / numéros de rue
    .split(/[^a-z0-9]+|(?<=[0-9])(?=[a-z])|(?<=[a-z])(?=[0-9])/)
    .filter(t => t.length >= 3 && !/^\d+$/.test(t) && !STOP.has(t));
}

// Distance d'édition (avec inversion de deux caractères voisins = 1 faute).
export function editDistance(a, b) {
  a = String(a); b = String(b);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Le mot apparaît-il (à une faute près pour les mots de 5 lettres et plus) dans le texte compacté ?
function fuzzyIn(hay, word) {
  if (hay.includes(word)) return true;
  if (word.length < 5) return false;
  for (let len = word.length - 1; len <= word.length + 1; len++) {
    for (let i = 0; i + len <= hay.length; i++) if (editDistance(hay.slice(i, i + len), word) <= 1) return true;
  }
  return false;
}

// Ressemblance de titre ∈ [0, 1] : part des mots du projet retrouvés dans le nom du dossier
// (le Drive colle les mots : « 65RVOLTAIRE » contient bien « voltaire »). null = projet sans mot utile.
export function titleScore(projetNom, folderTitle) {
  const toks = [...new Set(titleTokens(projetNom))];
  if (!toks.length) return null;
  const hay = compact(folderTitle);
  return toks.filter(t => fuzzyIn(hay, t)).length / toks.length;
}

const SIMILAR = 0.5; // « titre presque pareil » avec le bon numéro
const STRONG = 0.75; // titre très ressemblant quand le numéro a une faute

// Étapes 1-2 (ou 3) sur UNE liste de dossiers. → { folder, how } | null
export function matchStrict(folders, { num, nom }) {
  const n = normNum(num);
  const rows = (folders || []).map(f => { const p = parseFolderName(f.name); return { f, p, s: titleScore(nom, p.title || f.name) }; });
  const byNum = n ? rows.filter(r => r.p.num === n) : [];
  const hasTitle = titleTokens(nom).length > 0;
  const best = (list) => list.slice().sort((a, b) => (b.s ?? 0) - (a.s ?? 0) || String(b.p.year || '').localeCompare(String(a.p.year || '')))[0];
  if (byNum.length) {
    const b = best(byNum);
    if (!hasTitle && byNum.length === 1) return { folder: b.f, how: 'numero' };
    if (hasTitle && (b.s ?? 0) >= SIMILAR) return { folder: b.f, how: 'numero+titre' };
  }
  if (hasTitle) {
    const strong = rows.filter(r => (r.s ?? 0) >= STRONG && (!n || !r.p.num || editDistance(r.p.num, n) <= 1));
    if (strong.length) {
      const b = best(strong);
      // Deux dossiers aussi ressemblants sans numéro pour trancher → on ne devine pas.
      const tie = strong.filter(r => r.s === b.s && r !== b && !(n && r.p.num === n));
      if (!tie.length || (n && b.p.num && editDistance(b.p.num, n) <= 1)) return { folder: b.f, how: 'titre' };
    }
  }
  return null;
}

// Étape 4 : le numéro seul, s'il ne désigne qu'UN dossier.
export function matchNumOnly(folders, { num }) {
  const n = normNum(num);
  if (!n) return null;
  const byNum = (folders || []).filter(f => parseFolderName(f.name).num === n);
  return byNum.length === 1 ? { folder: byNum[0], how: 'numero seul' } : null;
}

// Nom d'un dossier créé : « 2026_A743_VOLTAIRE » (même convention que les dossiers existants →
// retrouvé au prochain coup par son numéro).
export function newFolderName(projetNom, num, year = new Date().getFullYear()) {
  const raw = String(num || '').trim().toUpperCase();
  const n = normNum(raw);
  const numRe = n ? new RegExp(`(?<![A-Z0-9])A?0*${n}(?![0-9])`, 'g') : null; // le numéro d'affaire seul
  const title = (numRe ? deaccent(projetNom).toUpperCase().replace(numRe, ' ') : deaccent(projetNom).toUpperCase())
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'PROJET';
  return raw ? `${year}_${raw}_${title}` : title;
}

// ── Accès Drive ─────────────────────────────────────────────────────────────────────────────
const _cache = new Map(); // driveId → { at, folders } (dossiers de 1er niveau, 3 min)
const TTL = 3 * 60 * 1000;

export async function listTopFolders(token, driveId) {
  const c = _cache.get(driveId);
  if (c && Date.now() - c.at < TTL) return c.folders;
  const folders = [];
  let pageToken = '';
  for (let guard = 0; guard < 20; guard++) {
    const params = new URLSearchParams({
      q: `'${driveId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'nextPageToken, files(id,name)', pageSize: '1000',
      supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'drive', driveId,
      ...(pageToken ? { pageToken } : {}),
    });
    const r = await fetch(`${DRIVE_API}/files?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if (d.error) throw new Error(`Drive API error: ${JSON.stringify(d.error)}`);
    folders.push(...(d.files || []));
    if (!d.nextPageToken) break;
    pageToken = d.nextPageToken;
  }
  _cache.set(driveId, { at: Date.now(), folders });
  return folders;
}
export function rememberFolder(driveId, folder) {
  const c = _cache.get(driveId);
  if (c) c.folders.push(folder);
}

// Drive partagé des affaires ARCHIVÉES : variable GOOGLE_AFFAIRES_ARCHIVE_DRIVE_ID, sinon recherche
// par nom (« AI_3_AFFAIRES ARCHIVE »). null si le compte de service n'y a pas accès (→ ignoré).
let _archiveId;
export async function findArchiveDriveId(token, mainDriveId) {
  const env = (process.env.GOOGLE_AFFAIRES_ARCHIVE_DRIVE_ID || '').trim();
  if (env) return env;
  if (_archiveId !== undefined) return _archiveId;
  try {
    const r = await fetch(`${DRIVE_API}/drives?pageSize=100&fields=drives(id,name)`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    const drives = (d.drives || []).filter(x => x.id !== mainDriveId && /affaires/i.test(x.name) && /archiv/i.test(x.name));
    const main = (d.drives || []).find(x => x.id === mainDriveId);
    const prefix = main ? (main.name.match(/^[A-Z]+_/) || [''])[0] : '';
    _archiveId = (prefix && drives.find(x => x.name.startsWith(prefix))) ? drives.find(x => x.name.startsWith(prefix)).id : (drives[0]?.id || null);
  } catch { _archiveId = null; }
  if (!_archiveId) console.log('drive: Drive « affaires archivées » non accessible au compte de service (recherche ignorée)');
  return _archiveId;
}

// Recherche complète (étapes 1 à 4). → { id, name, driveId, how } | null (rien trouvé).
export async function resolveProjetFolder(token, mainDriveId, { projetNom, projetNum }) {
  const num = (projetNum || '').trim() || numFromName(projetNom);
  const q = { num, nom: projetNom };
  const main = await listTopFolders(token, mainDriveId);
  let hit = matchStrict(main, q);
  if (hit) return { ...hit.folder, driveId: mainDriveId, how: hit.how };
  const archiveId = await findArchiveDriveId(token, mainDriveId);
  let archive = [];
  if (archiveId) {
    try { archive = await listTopFolders(token, archiveId); } catch (e) { console.log('drive: archives illisibles', e.message); }
    hit = matchStrict(archive, q);
    if (hit) return { ...hit.folder, driveId: archiveId, how: `${hit.how} (archives)` };
  }
  hit = matchNumOnly(main, q);
  if (hit) return { ...hit.folder, driveId: mainDriveId, how: hit.how };
  hit = archiveId ? matchNumOnly(archive, q) : null;
  if (hit) return { ...hit.folder, driveId: archiveId, how: `${hit.how} (archives)` };
  return null;
}

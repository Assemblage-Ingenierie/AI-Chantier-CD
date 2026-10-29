// VESTIAIRE DE COSTAR — petite gamification (demande Thomas 20/10/2026 : « des missions qui
// débloquent des cosmétiques, ex. faire lire un rapport → lunettes de soleil »).
//
// Périmètre : purement ludique et LOCAL (cet appareil, localStorage). Rien n'est écrit dans les
// projets, la sauvegarde ou Supabase. Toute erreur de lecture → progression vierge, jamais de crash.
// Seules les VRAIES relectures (rapport non vide, réponse de l'IA) font avancer les missions.

export const STORE_KEY = 'chantierai_costar_v1';
export const CHANGE_EVENT = 'costar-progress';

// Inventaire rangé par CATÉGORIE (demande Thomas : « un truc yeux, chapeau, tenue… ») : un seul
// objet porté par catégorie, cumulable entre catégories (chapeau de cowboy + gilet jaune + lunettes).
export const CATEGORIES = [
  { slot: 'head',  label: 'Chapeau' },
  { slot: 'eyes',  label: 'Yeux' },
  { slot: 'face',  label: 'Visage' },
  { slot: 'mouth', label: 'Bouche' },
  { slot: 'neck',  label: 'Cou' },
  { slot: 'body',  label: 'Tenue' },
  { slot: 'waist', label: 'Ceinture' },
  { slot: 'hand',  label: 'Main' },
  { slot: 'feet',  label: 'Pieds' },
  { slot: 'extra', label: 'Accessoire' },
];
export const SLOTS = CATEGORIES.map(c => c.slot);

export const COSMETICS = {
  lunettes:  { name: 'Lunettes d\'aviateur', slot: 'eyes', icon: '🕶️' },
  noeud:     { name: 'Nœud papillon',      slot: 'neck',  icon: '🎀' },
  casque_or: { name: 'Casque en or',       slot: 'head',  icon: '🏆' },
  tuque:     { name: 'Tuque québécoise',   slot: 'head',  icon: '🎿' },
  gilet:     { name: 'Gilet jaune',        slot: 'body',  icon: '🦺' },
  cowboy:    { name: 'Chapeau de cowboy',  slot: 'head',  icon: '🤠' },
  echarpe:   { name: 'Écharpe rouge',      slot: 'neck',  icon: '🧣' },
  cafe:      { name: 'Tasse de café',      slot: 'hand',  icon: '☕' },
  lampe:     { name: 'Lampe frontale',     slot: 'extra', icon: '🔦' },
  monocle:   { name: 'Monocle',            slot: 'eyes',  icon: '🧐' },
  couronne:  { name: 'Couronne',           slot: 'head',  icon: '👑' },
  pansement: { name: 'Pansement',          slot: 'face',  icon: '🩹' },
  cicatrices:{ name: 'Cicatrices de guerre', slot: 'face', icon: '⚔️' },
  clope:     { name: 'Clope au bec',       slot: 'mouth', icon: '🚬' },
  santiags:  { name: 'Santiags',           slot: 'feet',  icon: '👢' },
  noel:      { name: 'Bonnet de Noël',     slot: 'head',  icon: '🎅' },
  citrouille:{ name: 'Tête de citrouille', slot: 'head',  icon: '🎃' },
  pull:      { name: 'Pull en cachemire (rétréci)', slot: 'body', icon: '🧶' },
  costard:   { name: 'Costard trois pièces', slot: 'body', icon: '🤵' },
  slip:      { name: 'Slip',               slot: 'body',  icon: '🩲' },
  karate:    { name: 'Ceinture noire',     slot: 'waist', icon: '🥋' },
  gants:     { name: 'Gants de boxe',      slot: 'hand',  icon: '🥊' },
  securite:  { name: 'Chaussures de sécurité', slot: 'feet', icon: '🥾' },
  // Fournée du 29/10/2026 (demande Thomas : « fun, loufoque ou classe, pas trop dur à faire »).
  peace:     { name: 'Peace & love',       slot: 'hand',  icon: '✌️' },
  hawai:     { name: 'Chemise hawaïenne',  slot: 'body',  icon: '🌺' },
  hautforme: { name: 'Haut-de-forme',      slot: 'head',  icon: '🎩' },
  masque:    { name: 'Masque de nuit',     slot: 'eyes',  icon: '😴' },
  licorne:   { name: 'Corne de licorne',   slot: 'head',  icon: '🦄' },
  guitare:   { name: 'Guitare électrique', slot: 'extra', icon: '🎸' },
  bucheron:  { name: 'Chemise de bûcheron', slot: 'body', icon: '🪓' },
  chaine:    { name: 'Chaîne en or',       slot: 'neck',  icon: '📿' },
  bouee:     { name: 'Bouée canard',       slot: 'waist', icon: '🦆' },
  claquettes:{ name: 'Claquettes-chaussettes', slot: 'feet', icon: '🩴' },
  rose:      { name: 'Rose entre les dents', slot: 'mouth', icon: '🌹' },
  surf:      { name: 'Planche de surf',    slot: 'extra', icon: '🏄' },
  skis:      { name: 'Skis',               slot: 'feet',  icon: '🎿' },
  ninja:     { name: 'Bandeau de ninja',   slot: 'head',  icon: '🥷' },
};

// progress(stats) → [actuel, objectif]. Mission accomplie quand actuel >= objectif.
export const MISSIONS = [
  { id: 'premiere',  title: 'Première relecture',     desc: 'Faire relire un rapport à Costar',                     reward: 'lunettes',  progress: s => [s.reviews, 1] },
  { id: 'sept',      title: 'Bon élève',              desc: 'Obtenir 7/10 ou plus',                                  reward: 'noeud',     progress: s => [s.bestNote >= 7 ? 1 : 0, 1] },
  { id: 'dur',       title: 'Dur à cuire',            desc: 'Survivre à une note de 4/10 ou moins',                  reward: 'pansement', progress: s => [s.lowNote ? 1 : 0, 1] },
  // Quêtes « faciles » (29/10/2026) : faisables en quelques relectures.
  { id: 'peace',     title: 'Peace & love',           desc: 'Faire relire un rapport un vendredi. Bon week-end !',   reward: 'peace',     progress: s => [s.friday ? 1 : 0, 1] },
  { id: 'lundi',     title: 'Lundi tranquille',       desc: 'Faire relire un rapport un lundi',                      reward: 'claquettes',progress: s => [s.monday ? 1 : 0, 1] },
  { id: 'leve',      title: 'Lève-tôt',               desc: 'Faire relire un rapport avant 9 h (on n\'est pas bien réveillé)', reward: 'masque', progress: s => [s.early ? 1 : 0, 1] },
  { id: 'afterwork', title: 'Afterwork',              desc: 'Faire relire un rapport après 17 h',                    reward: 'hawai',     progress: s => [s.afterwork ? 1 : 0, 1] },
  { id: 'milieu',    title: 'Pile au milieu',         desc: 'Obtenir 5/10 ou 6/10. Ni bon ni mauvais : juste magique.', reward: 'licorne', progress: s => [s.midNote ? 1 : 0, 1] },
  { id: 'bucheron',  title: 'Bûcheron des Laurentides', desc: 'Faire relire 3 rapports',                             reward: 'bucheron',  progress: s => [Math.min(s.reviews, 3), 3] },
  { id: 'rock',      title: 'Rock\'n\'roll',          desc: 'Faire relire 2 rapports dans la même journée',          reward: 'guitare',   progress: s => [Math.min(s.bestDay, 2), 2] },
  { id: 'replonge',  title: 'On replonge',            desc: 'Faire relire une 2e fois le même rapport',              reward: 'bouee',     progress: s => [s.reread ? 1 : 0, 1] },
  { id: 'surf',      title: 'Sur la vague',           desc: 'Faire relire un rapport de 5 observations ou plus',     reward: 'surf',      progress: s => [Math.min(s.maxObs, 5), 5] },
  { id: 'ninja',     title: 'Ninja des chantiers',    desc: 'Faire relire 2 affaires différentes',                   reward: 'ninja',     progress: s => [Math.min(Object.keys(s.affaires).length, 2), 2] },
  { id: 'skis',      title: 'Tout schuss',            desc: 'Faire relire un rapport en hiver (novembre à mars)',    reward: 'skis',      progress: s => [s.winter ? 1 : 0, 1] },
  { id: 'bling',     title: 'Bling-bling',            desc: 'Obtenir 8/10 ou plus, 2 fois',                          reward: 'chaine',    progress: s => [Math.min(s.count8, 2), 2] },
  { id: 'coeur',     title: 'Coup de cœur',           desc: 'Obtenir 7/10 ou plus, deux relectures d\'affilée',      reward: 'rose',      progress: s => [Math.min(s.bestStreak7, 2), 2] },
  { id: 'gentleman', title: 'Gentleman ingénieur',    desc: 'Obtenir 8/10 ou plus sur un rapport de 8 observations ou plus', reward: 'hautforme', progress: s => [s.bigGood ? 1 : 0, 1] },
  { id: 'remontada', title: 'Remontada',              desc: 'Gagner 2 points sur un même rapport en le corrigeant',  reward: 'gilet',     progress: s => [s.remontada ? 1 : 0, 1] },
  { id: 'gros',      title: 'Gros chantier',          desc: 'Faire relire un rapport de 20 observations ou plus',   reward: 'cafe',      progress: s => [Math.min(s.maxObs, 20), 20] },
  { id: 'nuit',      title: 'Oiseau de nuit',         desc: 'Faire relire un rapport après 20 h',                    reward: 'lampe',     progress: s => [s.night ? 1 : 0, 1] },
  { id: 'tournee',   title: 'Tournée des chantiers',  desc: 'Faire relire 5 affaires différentes',                   reward: 'echarpe',   progress: s => [Math.min(Object.keys(s.affaires).length, 5), 5] },
  { id: 'cowboy',    title: 'Shérif du chantier',     desc: 'Faire relire 3 rapports dans la même journée',          reward: 'cowboy',    progress: s => [Math.min(s.bestDay, 3), 3] },
  { id: 'clope',     title: 'Pause clope',            desc: 'Faire relire un rapport pendant la pause de midi (12 h à 14 h)', reward: 'clope', progress: s => [s.noon ? 1 : 0, 1] },
  { id: 'santiags',  title: 'Cavalier solitaire',     desc: 'Faire relire des rapports sur 5 jours différents',      reward: 'santiags',  progress: s => [Math.min(s.days, 5), 5] },
  { id: 'pull',      title: 'Rétréci au lavage',      desc: 'Fais rétrécir un rapport : fais-le relire, retire-lui des observations, puis fais-le relire à nouveau. Comme ton pull en cachemire préféré, passé à 60 °C par la femme de ménage… il a rétréci, et maintenant il serre un peu.', reward: 'pull', progress: s => [s.shrunk ? 1 : 0, 1] },
  { id: 'citrouille',title: 'Halloween',              desc: 'Faire relire un rapport en octobre',                    reward: 'citrouille',progress: s => [s.october ? 1 : 0, 1] },
  { id: 'noel',      title: 'Joyeux Noël',            desc: 'Faire relire un rapport en décembre',                   reward: 'noel',      progress: s => [s.december ? 1 : 0, 1] },
  { id: 'securite',  title: 'Sécurité d\'abord',       desc: 'Faire relire un rapport de 10 observations ou plus : chaussures de sécurité obligatoires sur le chantier', reward: 'securite', progress: s => [Math.min(s.maxObs, 10), 10] },
  { id: 'slip',      title: 'Le minimum syndical',    desc: 'Faire relire un rapport de 3 observations ou moins', reward: 'slip', progress: s => [s.shortReport ? 1 : 0, 1] },
  { id: 'gants',     title: 'Uppercut',               desc: 'Gagner 3 points d\'un coup sur un même rapport en le corrigeant', reward: 'gants', progress: s => [s.bigComeback ? 1 : 0, 1] },
  { id: 'karate',    title: 'Ceinture noire',         desc: 'Obtenir 10/10 sur un rapport de 10 observations ou plus', reward: 'karate', progress: s => [s.perfectBig ? 1 : 0, 1] },
  { id: 'habitue',   title: 'Habitué du barrage',     desc: 'Faire relire 10 rapports',                              reward: 'tuque',     progress: s => [Math.min(s.reviews, 10), 10] },
  { id: 'serie',     title: 'Série en or',            desc: 'Obtenir 8/10 ou plus, 3 fois',                          reward: 'monocle',   progress: s => [Math.min(s.count8, 3), 3] },
  { id: 'costard',   title: 'Costar en costard',      desc: 'Obtenir 9/10 ou plus, 5 fois. Un ingénieur senior, ça se respecte : costard trois pièces de rigueur.', reward: 'costard', progress: s => [Math.min(s.count9, 5), 5] },
  { id: 'dix',       title: 'Perfection',             desc: 'Obtenir 10/10',                                         reward: 'casque_or', progress: s => [Math.min(s.count10, 1), 1] },
  { id: 'veteran',   title: 'Vétéran du chantier',    desc: 'Faire relire 25 rapports',                              reward: 'cicatrices',progress: s => [Math.min(s.reviews, 25), 25] },
  { id: 'legende',   title: 'Légende du Québec',      desc: 'Obtenir 10/10, 3 fois',                                 reward: 'couronne',  progress: s => [Math.min(s.count10, 3), 3] },
];

export function emptyStats() {
  return { reviews: 0, bestNote: -1, count8: 0, count9: 0, count10: 0, maxObs: 0, night: false, lowNote: false, remontada: false, projects: {}, affaires: {}, day: '', dayCount: 0, bestDay: 0, days: 0, noon: false, weekend: false, october: false, december: false, shortReport: false, bigComeback: false, perfectBig: false, shrunk: false, reportObs: {},
    friday: false, monday: false, early: false, afterwork: false, midNote: false, reread: false, winter: false, bigGood: false, streak7: 0, bestStreak7: 0 };
}
export function emptyState() {
  return { stats: emptyStats(), equipped: {}, unseen: [], sandbox: {} };
}

// Lecture tolérante : champ manquant / corrompu → valeur par défaut.
export function normalizeState(raw) {
  const st = emptyState();
  if (!raw || typeof raw !== 'object') return st;
  const s = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  st.stats = {
    reviews: num(s.reviews, 0), bestNote: num(s.bestNote, -1), count8: num(s.count8, 0), count9: num(s.count9, 0), count10: num(s.count10, 0),
    maxObs: num(s.maxObs, 0), night: !!s.night, lowNote: !!s.lowNote, remontada: !!s.remontada,
    projects: s.projects && typeof s.projects === 'object' ? { ...s.projects } : {}, // rapport (affaire + visite) → dernière note
    affaires: s.affaires && typeof s.affaires === 'object' ? { ...s.affaires } : {},  // affaires relues
    day: typeof s.day === 'string' ? s.day : '', dayCount: num(s.dayCount, 0), bestDay: num(s.bestDay, 0), // relectures du jour
    days: num(s.days, 0), noon: !!s.noon, weekend: !!s.weekend, october: !!s.october, december: !!s.december,
    shortReport: !!s.shortReport, bigComeback: !!s.bigComeback, perfectBig: !!s.perfectBig,
    shrunk: !!s.shrunk, reportObs: s.reportObs && typeof s.reportObs === 'object' ? { ...s.reportObs } : {}, // rapport → nb d'observations à la dernière relecture
    friday: !!s.friday, monday: !!s.monday, early: !!s.early, afterwork: !!s.afterwork, midNote: !!s.midNote,
    reread: !!s.reread, winter: !!s.winter, bigGood: !!s.bigGood, streak7: num(s.streak7, 0), bestStreak7: num(s.bestStreak7, 0),
  };
  if (raw.equipped && typeof raw.equipped === 'object') {
    // Rangé dans la catégorie ACTUELLE de l'objet (une catégorie peut avoir changé d'une version à l'autre).
    for (const id of Object.values(raw.equipped)) if (COSMETICS[id]) st.equipped[COSMETICS[id].slot] = id;
  }
  st.unseen = Array.isArray(raw.unseen) ? raw.unseen.filter(id => COSMETICS[id]) : [];
  // Tenue d'ESSAI du game mode (à part : la vraie tenue et la progression n'y sont jamais mêlées).
  if (raw.sandbox && typeof raw.sandbox === 'object') {
    for (const id of Object.values(raw.sandbox)) if (COSMETICS[id]) st.sandbox[COSMETICS[id].slot] = id;
  }
  return st;
}

export const missionDone = (m, stats) => { const [cur, max] = m.progress(stats); return cur >= max; };
export const unlockedIds = (stats) => MISSIONS.filter(m => missionDone(m, stats)).map(m => m.reward);

// Applique une relecture : renvoie le nouvel état + les missions accomplies À CETTE relecture.
// Les cosmétiques nouvellement débloqués sont portés tout de suite (effet « waouh » en direct).
// projectId = l'affaire ; reportId = le rapport relu (affaire + visite), pour la « remontada ».
export function applyReview(state, { note, observations = 0, projectId = null, reportId = projectId }, now = new Date()) {
  const prev = normalizeState(state);
  if (!Number.isFinite(note) || observations <= 0) return { state: prev, completed: [] };
  const s = { ...prev.stats, projects: { ...prev.stats.projects }, affaires: { ...prev.stats.affaires }, reportObs: { ...prev.stats.reportObs } };
  s.reviews += 1;
  s.bestNote = Math.max(s.bestNote, note);
  if (note >= 8) s.count8 += 1;
  if (note >= 9) s.count9 += 1;
  if (note >= 10) s.count10 += 1;
  if (note <= 4) s.lowNote = true;
  s.maxObs = Math.max(s.maxObs, observations);
  if (observations <= 3) s.shortReport = true;
  if (note >= 10 && observations >= 10) s.perfectBig = true;
  if (note >= 8 && observations >= 8) s.bigGood = true;
  if (note >= 5 && note <= 6) s.midNote = true;
  s.streak7 = note >= 7 ? s.streak7 + 1 : 0; // notes ≥ 7 d'affilée
  s.bestStreak7 = Math.max(s.bestStreak7, s.streak7);
  const dayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  if (s.day !== dayKey) s.days += 1; // jours différents avec au moins une relecture
  s.dayCount = s.day === dayKey ? s.dayCount + 1 : 1;
  s.day = dayKey;
  s.bestDay = Math.max(s.bestDay, s.dayCount);
  const h = now.getHours();
  if (h >= 20 || h < 5) s.night = true;
  if (h >= 12 && h < 14) s.noon = true;
  if (now.getDay() === 0 || now.getDay() === 6) s.weekend = true;
  if (now.getMonth() === 9) s.october = true;
  if (now.getMonth() === 11) s.december = true;
  if (now.getDay() === 5) s.friday = true;
  if (now.getDay() === 1) s.monday = true;
  if (h >= 5 && h < 9) s.early = true;
  if (h >= 17) s.afterwork = true;
  if ([10, 11, 0, 1, 2].includes(now.getMonth())) s.winter = true; // novembre → mars
  if (projectId) s.affaires[projectId] = 1;
  if (reportId) {
    const last = s.projects[reportId];
    if (Number.isFinite(last)) s.reread = true; // même rapport relu une 2e fois
    if (Number.isFinite(last) && note - last >= 2) s.remontada = true;
    if (Number.isFinite(last) && note - last >= 3) s.bigComeback = true;
    s.projects[reportId] = note;
    const lastObs = s.reportObs[reportId];
    if (Number.isFinite(lastObs) && observations < lastObs) s.shrunk = true; // le rapport a « rétréci »
    s.reportObs[reportId] = observations;
  }
  const before = new Set(unlockedIds(prev.stats));
  const completed = MISSIONS.filter(m => missionDone(m, s) && !before.has(m.reward));
  const equipped = { ...prev.equipped };
  completed.forEach(m => { equipped[COSMETICS[m.reward].slot] = m.reward; });
  const unseen = [...new Set([...prev.unseen, ...completed.map(m => m.reward)])];
  return { state: { stats: s, equipped, unseen, sandbox: prev.sandbox }, completed };
}

// Porter / enlever un cosmétique débloqué (un seul par emplacement).
// sandbox = game mode : TOUS les objets, dans la tenue d'essai (la vraie tenue n'est pas touchée).
export function toggleEquip(state, id, { sandbox = false } = {}) {
  const st = normalizeState(state);
  const c = COSMETICS[id];
  if (!c) return st;
  if (sandbox) {
    const box = { ...st.sandbox };
    if (box[c.slot] === id) delete box[c.slot]; else box[c.slot] = id;
    return { ...st, sandbox: box };
  }
  if (!unlockedIds(st.stats).includes(id)) return st;
  const equipped = { ...st.equipped };
  if (equipped[c.slot] === id) delete equipped[c.slot]; else equipped[c.slot] = id;
  return { ...st, equipped };
}

// ── Persistance locale (tolérante : mode privé / quota → la partie continue en mémoire) ──
let _mem = null;
export function loadCostarState() {
  if (_mem) return _mem;
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { raw = null; }
  _mem = normalizeState(raw);
  return _mem;
}
export function saveCostarState(state) {
  _mem = normalizeState(state);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(_mem)); } catch { /* mode privé */ }
  try { window.dispatchEvent(new CustomEvent(CHANGE_EVENT)); } catch { /* hors navigateur */ }
  return _mem;
}
// GAME MODE (pour tester tous les objets) : simple drapeau local, séparé de la progression.
// Réservé au compte de Thomas (demande : « que pour moi, personne d'autre ne peut le voir ») :
// la case n'apparaît que sur sa ligne dans Administration, et le drapeau est coupé si un autre
// compte se connecte sur le même appareil (cf. ChantierAI).
export const GAME_MODE_OWNER = 'thomas@assemblage.net';
export const canUseGameMode = (email) => String(email || '').trim().toLowerCase() === GAME_MODE_OWNER;
export const GAME_MODE_KEY = 'chantierai_costar_game_v1';
export function isGameMode() {
  try { return localStorage.getItem(GAME_MODE_KEY) === '1'; } catch { return false; }
}
export function setGameMode(on) {
  try { if (on) localStorage.setItem(GAME_MODE_KEY, '1'); else localStorage.removeItem(GAME_MODE_KEY); } catch { /* mode privé */ }
  try { window.dispatchEvent(new CustomEvent(CHANGE_EVENT)); } catch { /* hors navigateur */ }
}

// Tests uniquement.
export function _resetCostarMem() { _mem = null; }

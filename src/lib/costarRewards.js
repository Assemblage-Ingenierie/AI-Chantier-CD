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
};

// progress(stats) → [actuel, objectif]. Mission accomplie quand actuel >= objectif.
export const MISSIONS = [
  { id: 'premiere',  title: 'Première relecture',     desc: 'Faire relire un rapport à Costar',                     reward: 'lunettes',  progress: s => [s.reviews, 1] },
  { id: 'sept',      title: 'Bon élève',              desc: 'Obtenir 7/10 ou plus',                                  reward: 'noeud',     progress: s => [s.bestNote >= 7 ? 1 : 0, 1] },
  { id: 'dur',       title: 'Dur à cuire',            desc: 'Survivre à une note de 4/10 ou moins',                  reward: 'pansement', progress: s => [s.lowNote ? 1 : 0, 1] },
  { id: 'remontada', title: 'Remontada',              desc: 'Gagner 2 points sur un même rapport en le corrigeant',  reward: 'gilet',     progress: s => [s.remontada ? 1 : 0, 1] },
  { id: 'gros',      title: 'Gros chantier',          desc: 'Faire relire un rapport de 20 observations ou plus',   reward: 'cafe',      progress: s => [Math.min(s.maxObs, 20), 20] },
  { id: 'nuit',      title: 'Oiseau de nuit',         desc: 'Faire relire un rapport après 20 h',                    reward: 'lampe',     progress: s => [s.night ? 1 : 0, 1] },
  { id: 'tournee',   title: 'Tournée des chantiers',  desc: 'Faire relire 5 affaires différentes',                   reward: 'echarpe',   progress: s => [Math.min(Object.keys(s.affaires).length, 5), 5] },
  { id: 'cowboy',    title: 'Shérif du chantier',     desc: 'Faire relire 3 rapports dans la même journée',          reward: 'cowboy',    progress: s => [Math.min(s.bestDay, 3), 3] },
  { id: 'clope',     title: 'Pause clope',            desc: 'Faire relire un rapport pendant la pause de midi (12 h à 14 h)', reward: 'clope', progress: s => [s.noon ? 1 : 0, 1] },
  { id: 'santiags',  title: 'Cavalier solitaire',     desc: 'Faire relire des rapports sur 5 jours différents',      reward: 'santiags',  progress: s => [Math.min(s.days, 5), 5] },
  { id: 'pull',      title: 'Le pull du dimanche',    desc: 'Faire relire un rapport le week-end. En récompense : ton plus beau pull en cachemire… rétréci au lavage par la femme de ménage. Il serre un peu.', reward: 'pull', progress: s => [s.weekend ? 1 : 0, 1] },
  { id: 'citrouille',title: 'Halloween',              desc: 'Faire relire un rapport en octobre',                    reward: 'citrouille',progress: s => [s.october ? 1 : 0, 1] },
  { id: 'noel',      title: 'Joyeux Noël',            desc: 'Faire relire un rapport en décembre',                   reward: 'noel',      progress: s => [s.december ? 1 : 0, 1] },
  { id: 'habitue',   title: 'Habitué du barrage',     desc: 'Faire relire 10 rapports',                              reward: 'tuque',     progress: s => [Math.min(s.reviews, 10), 10] },
  { id: 'serie',     title: 'Série en or',            desc: 'Obtenir 8/10 ou plus, 3 fois',                          reward: 'monocle',   progress: s => [Math.min(s.count8, 3), 3] },
  { id: 'dix',       title: 'Perfection',             desc: 'Obtenir 10/10',                                         reward: 'casque_or', progress: s => [Math.min(s.count10, 1), 1] },
  { id: 'veteran',   title: 'Vétéran du chantier',    desc: 'Faire relire 25 rapports',                              reward: 'cicatrices',progress: s => [Math.min(s.reviews, 25), 25] },
  { id: 'legende',   title: 'Légende du Québec',      desc: 'Obtenir 10/10, 3 fois',                                 reward: 'couronne',  progress: s => [Math.min(s.count10, 3), 3] },
];

export function emptyStats() {
  return { reviews: 0, bestNote: -1, count8: 0, count10: 0, maxObs: 0, night: false, lowNote: false, remontada: false, projects: {}, affaires: {}, day: '', dayCount: 0, bestDay: 0, days: 0, noon: false, weekend: false, october: false, december: false };
}
export function emptyState() {
  return { stats: emptyStats(), equipped: {}, unseen: [] };
}

// Lecture tolérante : champ manquant / corrompu → valeur par défaut.
export function normalizeState(raw) {
  const st = emptyState();
  if (!raw || typeof raw !== 'object') return st;
  const s = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  st.stats = {
    reviews: num(s.reviews, 0), bestNote: num(s.bestNote, -1), count8: num(s.count8, 0), count10: num(s.count10, 0),
    maxObs: num(s.maxObs, 0), night: !!s.night, lowNote: !!s.lowNote, remontada: !!s.remontada,
    projects: s.projects && typeof s.projects === 'object' ? { ...s.projects } : {}, // rapport (affaire + visite) → dernière note
    affaires: s.affaires && typeof s.affaires === 'object' ? { ...s.affaires } : {},  // affaires relues
    day: typeof s.day === 'string' ? s.day : '', dayCount: num(s.dayCount, 0), bestDay: num(s.bestDay, 0), // relectures du jour
    days: num(s.days, 0), noon: !!s.noon, weekend: !!s.weekend, october: !!s.october, december: !!s.december,
  };
  if (raw.equipped && typeof raw.equipped === 'object') {
    // Rangé dans la catégorie ACTUELLE de l'objet (une catégorie peut avoir changé d'une version à l'autre).
    for (const id of Object.values(raw.equipped)) if (COSMETICS[id]) st.equipped[COSMETICS[id].slot] = id;
  }
  st.unseen = Array.isArray(raw.unseen) ? raw.unseen.filter(id => COSMETICS[id]) : [];
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
  const s = { ...prev.stats, projects: { ...prev.stats.projects }, affaires: { ...prev.stats.affaires } };
  s.reviews += 1;
  s.bestNote = Math.max(s.bestNote, note);
  if (note >= 8) s.count8 += 1;
  if (note >= 10) s.count10 += 1;
  if (note <= 4) s.lowNote = true;
  s.maxObs = Math.max(s.maxObs, observations);
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
  if (projectId) s.affaires[projectId] = 1;
  if (reportId) {
    const last = s.projects[reportId];
    if (Number.isFinite(last) && note - last >= 2) s.remontada = true;
    s.projects[reportId] = note;
  }
  const before = new Set(unlockedIds(prev.stats));
  const completed = MISSIONS.filter(m => missionDone(m, s) && !before.has(m.reward));
  const equipped = { ...prev.equipped };
  completed.forEach(m => { equipped[COSMETICS[m.reward].slot] = m.reward; });
  const unseen = [...new Set([...prev.unseen, ...completed.map(m => m.reward)])];
  return { state: { stats: s, equipped, unseen }, completed };
}

// Porter / enlever un cosmétique débloqué (un seul par emplacement).
export function toggleEquip(state, id) {
  const st = normalizeState(state);
  const c = COSMETICS[id];
  if (!c || !unlockedIds(st.stats).includes(id)) return st;
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
// Tests uniquement.
export function _resetCostarMem() { _mem = null; }

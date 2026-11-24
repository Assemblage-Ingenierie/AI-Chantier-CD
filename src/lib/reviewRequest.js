// DEMANDE DE RELECTURE par email (demande Thomas 24/11 : « je dois appeler Pierre pour qu'il
// relise, il dit oui, oublie et je le relance 3× ; j'aimerais lui envoyer un email avec le lien
// de l'affaire »). Rien côté serveur : l'email est préparé dans la messagerie de l'appareil
// (mailto:) et l'utilisateur l'envoie lui-même. Le lien ouvre directement l'affaire et la visite,
// onglet Rapport, chez le relecteur (#relire=…).

// « A743 » tiré du nom de l'affaire (« A743_TERRESTERRES_65RVOLTAIRE »), sinon le nom complet.
export function affaireCode(nom) {
  const m = String(nom || '').match(/(?:^|[^A-Za-z0-9])(A\d{3,5})(?=$|[^0-9])/i);
  return m ? m[1].toUpperCase() : String(nom || '').trim();
}

export function reviewLink(origin, projetId, visiteId) {
  return `${String(origin || '').replace(/\/+$/, '')}/#relire=${encodeURIComponent(projetId)}${visiteId ? `.${encodeURIComponent(visiteId)}` : ''}`;
}

// Lien reçu → { projetId, visiteId } (ou null).
export function parseReviewHash(hash) {
  const m = String(hash || '').match(/relire=([^&#]+)/);
  if (!m) return null;
  const [p, v] = m[1].split('.');
  const projetId = decodeURIComponent(p || '');
  if (!projetId) return null;
  return { projetId, visiteId: v ? decodeURIComponent(v) : null };
}

export function buildReviewMail({ nom, visiteLabel, link, note, from }) {
  const code = affaireCode(nom);
  const subject = `AICHANTIER - Relecture ${code}`;
  const lines = [
    'Bonjour,',
    '',
    `Peux-tu relire le rapport de l'affaire ${nom || code}${visiteLabel ? ` (${visiteLabel})` : ''} ?`,
    'Tu peux corriger directement dans l\'application.',
  ];
  const n = String(note || '').trim();
  if (n) lines.push('', `Point d'attention : ${n}`);
  lines.push('', `Lien vers le rapport : ${link}`, '', 'Merci !');
  if (from) lines.push(from);
  return { subject, body: lines.join('\n') };
}

export function mailtoUrl(to, { subject, body }) {
  const q = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${encodeURIComponent(String(to || '').trim()).replace(/%40/g, '@').replace(/%2C/gi, ',')}?${q}`;
}

// Derniers relecteurs (adresses), pour ne pas retaper.
const LS_KEY = 'chantierai_relecteurs_v1';
export function recentReviewers() {
  try { const a = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; } catch { return []; }
}
export function rememberReviewer(email) {
  const e = String(email || '').trim();
  if (!e) return;
  try { localStorage.setItem(LS_KEY, JSON.stringify([e, ...recentReviewers().filter(x => x !== e)].slice(0, 6))); } catch { /* mode privé */ }
}

// Au démarrage : lien #relire=… dans l'adresse → mémorisé pour la session (survit à l'écran de
// connexion) et retiré de l'adresse (un rechargement ne rouvre pas l'affaire).
const SS_KEY = 'chantierai_open_link';
export function captureReviewLink() {
  try {
    const r = parseReviewHash(typeof window !== 'undefined' ? window.location.hash : '');
    if (r) {
      sessionStorage.setItem(SS_KEY, JSON.stringify(r));
      history.replaceState(history.state, '', window.location.pathname + window.location.search);
      return r;
    }
    const s = sessionStorage.getItem(SS_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
export function clearReviewLink() { try { sessionStorage.removeItem(SS_KEY); } catch { /* ignore */ } }

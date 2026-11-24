// DATES DE SUIVI des observations (demande Thibaud, 20/10/2026) : « à la création d'une remarque,
// une date remplie automatiquement, modifiable, conservée d'une visite à l'autre » + « une date qui
// continue à tourner tant qu'on ne la clôture pas » (Thomas).
//
//   item.dateOuverture : 'AAAA-MM-JJ' — posée quand on clique « Dater » sur l'observation (choix
//                        Thomas 20/10 : OPTIONNEL par observation, rien tant qu'on n'y touche pas),
//                        modifiable, recopiée telle quelle quand on duplique une visite ;
//   item.dateCloture   : 'AAAA-MM-JJ' — pour une observation DATÉE, posée automatiquement quand elle
//                        passe « Fait », retirée si elle repasse à un autre état, modifiable.
// Tant qu'elle n'est pas levée, la durée « tourne » avec la date de la visite affichée.
// Observation non datée : aucun affichage, ni à l'écran ni dans le PDF (comportement d'avant).

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (s) => typeof s === 'string' && ISO_RE.test(s);

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDateFr(iso) {
  if (!isIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Durée lisible entre deux dates ISO : « 12 j », « 3 sem. », « 5 mois », « 1 an 2 mois ».
export function durationFr(fromIso, toIso) {
  if (!isIsoDate(fromIso) || !isIsoDate(toIso)) return '';
  const a = Date.UTC(...fromIso.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  const b = Date.UTC(...toIso.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  const days = Math.round((b - a) / 86400000);
  if (days < 0) return '';
  if (days === 0) return 'le jour même';
  if (days < 14) return `${days} j`;
  if (days < 60) return `${Math.round(days / 7)} sem.`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} mois`;
  const y = Math.floor(months / 12), r = months % 12;
  return `${y} an${y > 1 ? 's' : ''}${r ? ` ${r} mois` : ''}`;
}

// Infos d'affichage d'une observation à la date d'une visite — null si aucune date d'ouverture.
export function obsDatesInfo(item, visitDateIso) {
  const ouv = item?.dateOuverture;
  if (!isIsoDate(ouv)) return null;
  const closed = item?.suivi === 'fait';
  const fin = closed ? (isIsoDate(item?.dateCloture) ? item.dateCloture : null) : (isIsoDate(visitDateIso) ? visitDateIso : null);
  return { ouverture: ouv, closed, fin, duree: fin ? durationFr(ouv, fin) : '' };
}

// ZONE datée (titre de zone) : pas de « suivi » → levée = date de levée saisie à la main.
export function zoneDatesInfo(loc, visitDateIso) {
  if (!loc) return null;
  return obsDatesInfo({ dateOuverture: loc.dateOuverture, dateCloture: loc.dateCloture, suivi: isIsoDate(loc.dateCloture) ? 'fait' : 'a_faire' }, visitDateIso);
}

// Applique les règles automatiques à l'enregistrement d'une observation (_prev = version d'avant,
// null pour une création). N'écrase JAMAIS une date déjà saisie ; ne date jamais une observation
// que l'utilisateur n'a pas datée.
export function applyObsDates(_prev, next, refDateIso) {
  if (!next) return next;
  const ref = isIsoDate(refDateIso) ? refDateIso : todayIso();
  let out = next;
  if (!isIsoDate(out.dateOuverture)) {
    if (out.dateCloture == null) return out;
    // eslint-disable-next-line no-unused-vars
    const { dateCloture, ...rest } = out; // levée sans ouverture : incohérent → retirée
    return rest;
  }
  if (out.suivi === 'fait') {
    if (!isIsoDate(out.dateCloture)) out = { ...out, dateCloture: ref };
  } else if (out.dateCloture != null) {
    // eslint-disable-next-line no-unused-vars
    const { dateCloture, ...rest } = out;
    out = rest;
  }
  return out;
}

// Stockage : colonne jsonb `meta` de aichantier_localisation_items (migration 20261020).
export function itemMetaToRow(item) {
  const m = {};
  if (isIsoDate(item?.dateOuverture)) m.dateOuverture = item.dateOuverture;
  if (isIsoDate(item?.dateCloture)) m.dateCloture = item.dateCloture;
  // Mise en page des photos DANS LE RAPPORT, propre à l'observation (demande Thomas 24/11) :
  // nombre de photos par ligne (sinon réglage du rapport) et photos « en grand ».
  if ([1, 2, 3].includes(item?.reportCols)) m.reportCols = item.reportCols;
  const big = cleanBig(item?.photoBig);
  if (big.length) m.photoBig = big;
  // Par LIGNE (retour Thomas 24/11) : nb de photos de la ligne qui commence par cette photo, et
  // largeur d'une photo « en grand » (toujours centrée).
  const rc = cleanMap(item?.rowCols, v => [1, 2, 3].includes(v));
  if (rc) m.rowCols = rc;
  const bw = cleanMap(item?.photoBigW, v => BIG_WIDTHS.includes(v));
  if (bw) m.photoBigW = bw;
  return Object.keys(m).length ? m : null;
}
export const BIG_WIDTHS = [0.5, 0.75, 1];
const cleanMap = (o, ok) => {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const e = Object.entries(o).filter(([k, v]) => typeof k === 'string' && k && ok(v)).slice(0, 60);
  return e.length ? Object.fromEntries(e) : null;
};
const cleanBig = (v) => (Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string' && x))].slice(0, 60) : []);
export function itemMetaFromRow(meta) {
  let m = meta;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch { m = null; } }
  if (!m || typeof m !== 'object') return {};
  const out = {};
  if (isIsoDate(m.dateOuverture)) out.dateOuverture = m.dateOuverture;
  if (isIsoDate(m.dateCloture)) out.dateCloture = m.dateCloture;
  if ([1, 2, 3].includes(m.reportCols)) out.reportCols = m.reportCols;
  const big = cleanBig(m.photoBig);
  if (big.length) out.photoBig = big;
  const rc = cleanMap(m.rowCols, v => [1, 2, 3].includes(v));
  if (rc) out.rowCols = rc;
  const bw = cleanMap(m.photoBigW, v => BIG_WIDTHS.includes(v));
  if (bw) out.photoBigW = bw;
  return out;
}

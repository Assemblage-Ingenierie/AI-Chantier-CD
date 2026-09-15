// ── Installation PWA (« Télécharger l'application ») ────────────────────────────
// L'événement `beforeinstallprompt` (Chrome Android / Edge / Chrome Desktop) ne se
// déclenche QU'UNE FOIS, très tôt au chargement de la page. Si on ne l'écoute pas dès
// le départ, on le rate → plus aucun bouton ne peut déclencher l'installation native.
// Ce module s'abonne au niveau MODULE (importé dans main.jsx avant le rendu React) et
// mémorise l'événement pour qu'un bouton (ex : Paramètres) puisse lancer l'installation
// native à tout moment. iOS/Safari ne supporte pas cet événement → instructions manuelles.

let _deferred = null;          // l'événement beforeinstallprompt capturé (ou null)
let _installed = false;         // l'app vient d'être installée pendant cette session
const _subs = new Set();        // abonnés (re-render UI quand la dispo change)

function _notify() { for (const cb of _subs) { try { cb(); } catch { /* noop */ } } }

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // On empêche la mini-infobar automatique de Chrome pour piloter nous-mêmes le moment.
    e.preventDefault();
    _deferred = e;
    _notify();
  });
  window.addEventListener('appinstalled', () => {
    _installed = true;
    _deferred = null;
    _notify();
  });
}

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}
export function isAndroid() {
  return /android/i.test(navigator.userAgent);
}
export function isStandalone() {
  try {
    return window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
  } catch { return false; }
}
// Plateforme dominante pour mettre en avant le bon bouton par défaut.
export function detectPlatform() {
  if (isIOS()) return 'ios';
  if (isAndroid()) return 'android';
  return 'desktop';
}

// L'installation native est-elle possible tout de suite ? (événement capturé)
export function canInstallNative() { return !!_deferred; }
export function isAppInstalled() { return _installed || isStandalone(); }

// Le navigateur a-t-il accordé un stockage PERSISTANT (non effaçable) ? Sur un onglet Safari
// iOS non installé, c'est typiquement FAUX → les données peuvent être purgées (ITP). Async.
export async function isStoragePersisted() {
  try {
    if (isStandalone()) return true; // PWA installée : stockage durable de fait
    return navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  } catch { return false; }
}
export function isMobile() {
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || window.innerWidth < 900;
}

// Lance l'invite d'installation native du navigateur. Renvoie 'accepted' | 'dismissed'
// | 'unavailable'. À appeler dans un geste utilisateur (clic bouton).
export async function promptInstall() {
  if (!_deferred) return 'unavailable';
  try {
    _deferred.prompt();
    const { outcome } = await _deferred.userChoice;
    _deferred = null; // l'événement n'est utilisable qu'une fois
    _notify();
    return outcome || 'dismissed';
  } catch {
    _deferred = null;
    _notify();
    return 'unavailable';
  }
}

// S'abonner aux changements de disponibilité (capture de l'événement / installation).
// Renvoie une fonction de désabonnement.
export function subscribeInstall(cb) {
  _subs.add(cb);
  return () => _subs.delete(cb);
}

// Logger centralisé — 100 % additif, ne lève JAMAIS (un logger qui plante ne doit pas
// casser l'app). Double sortie : console (comme aujourd'hui) + remontée serveur best-effort
// via navigator.sendBeacon vers /api/log. Sert de point unique pour observer en prod les
// événements aujourd'hui silencieux : garde anti-mass-delete, conflits de version dans
// mergeWithLocal/saveRemote, erreurs de sync, erreurs globales non capturées, volume d'egress.
//
// Aucune dépendance. Si sendBeacon/fetch échoue ou est indisponible, on reste sur la console.

const ENDPOINT = '/api/log';

// Throttle simple par clé (scope+level) pour éviter d'inonder l'endpoint en cas de boucle
// d'erreurs. Une même clé n'est envoyée au réseau qu'une fois par fenêtre.
const _lastSent = new Map();
const THROTTLE_MS = 10_000;

function _send(payload) {
  try {
    const key = `${payload.level}:${payload.scope}`;
    const now = Date.now();
    const prev = _lastSent.get(key) || 0;
    if (now - prev < THROTTLE_MS) return; // trop récent — on garde la console mais on n'envoie pas
    _lastSent.set(key, now);

    const body = JSON.stringify({
      ...payload,
      ts: new Date(now).toISOString(),
      url: typeof location !== 'undefined' ? location.pathname : null,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
    if (typeof fetch !== 'undefined') {
      fetch(ENDPOINT, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch { /* le logging ne doit jamais casser l'app */ }
}

function _sanitize(data) {
  // Ne jamais remonter de gros blobs (base64) ni de structures profondes.
  try {
    const seen = new WeakSet();
    return JSON.parse(JSON.stringify(data, (k, v) => {
      if (typeof v === 'string' && v.startsWith('data:') && v.length > 128) return `[data:${v.length}b]`;
      if (typeof v === 'object' && v !== null) { if (seen.has(v)) return '[circular]'; seen.add(v); }
      return v;
    }));
  } catch { return { unserializable: true }; }
}

export function logError(scope, data = {}) {
  console.error(`[${scope}]`, data);
  _send({ level: 'error', scope, data: _sanitize(data) });
}

export function logWarn(scope, data = {}) {
  console.warn(`[${scope}]`, data);
  _send({ level: 'warn', scope, data: _sanitize(data) });
}

// Événements métier non-erreur : conflits détectés, volume d'egress, gardes déclenchées.
export function logEvent(scope, data = {}) {
  _send({ level: 'event', scope, data: _sanitize(data) });
}

// Handlers globaux — à installer une fois au démarrage. Capture ce que l'ErrorBoundary
// React ne voit pas : rejets de promesses et erreurs hors rendu (dont la sync).
let _installed = false;
export function installGlobalErrorHandlers() {
  if (_installed || typeof window === 'undefined') return;
  _installed = true;
  window.addEventListener('error', (e) => {
    logError('window.onerror', { message: e?.message, filename: e?.filename, line: e?.lineno, col: e?.colno });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason;
    logError('unhandledrejection', { message: r?.message ?? String(r), code: r?.code });
  });
}

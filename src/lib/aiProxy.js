import { getSupabase } from '../supabase.js';

const _lastCall = {};
const THROTTLE_MS = 15000; // 15s entre deux appels par feature pour ménager le quota free

// ── Choix du MOTEUR IA (réversible) ─────────────────────────────────────────────
// 'claude' (défaut), 'gemini-flash' (rapide) ou 'gemini-pro' (qualité max). Stocké en
// localStorage, réglable via le switch des Paramètres. La préférence est traduite en
// provider + modèle et envoyée au proxy à chaque appel ; le proxy route en conséquence.
const AI_PROVIDER_KEY = 'chantierai_ai_provider';
const AI_ENGINES = ['claude', 'gemini-flash', 'gemini-pro'];
const GEMINI_MODEL_FOR = { 'gemini-flash': 'gemini-3.6-flash', 'gemini-pro': 'gemini-3.6-pro' };
export function getAIProvider() {
  // Défaut = gemini-flash (rapide, fiable). Claude n'a plus de crédit → n'est plus le défaut.
  try { const v = localStorage.getItem(AI_PROVIDER_KEY); return AI_ENGINES.includes(v) ? v : 'gemini-flash'; } catch { return 'gemini-flash'; }
}
export function setAIProvider(p) {
  try { localStorage.setItem(AI_PROVIDER_KEY, AI_ENGINES.includes(p) ? p : 'claude'); } catch { /* mode privé */ }
}

export async function callAIProxy(params) {
  const feature = params.feature || 'default';
  const now = Date.now();
  const elapsed = now - (_lastCall[feature] || 0);
  if (elapsed < THROTTLE_MS) {
    if (params._waitOk) {
      await new Promise(r => setTimeout(r, THROTTLE_MS - elapsed));
    } else {
      const wait = Math.ceil((THROTTLE_MS - elapsed) / 1000);
      throw new Error(`Attends ${wait}s avant une nouvelle requête IA`);
    }
  }
  _lastCall[feature] = Date.now();

  // Moteur IA choisi dans les Paramètres (défaut Claude) — le proxy route en conséquence.
  if (!params.provider) {
    const engine = getAIProvider();
    if (engine === 'gemini-flash' || engine === 'gemini-pro') {
      params.provider = 'gemini';
      // Remplace tout modèle Claude passé en dur par le modèle Gemini choisi (sinon le proxy
      // ignore ce nom et retombe sur le Flash par défaut → « Pro » ne serait jamais utilisé).
      if (!params.model || !String(params.model).startsWith('gemini-')) params.model = GEMINI_MODEL_FOR[engine];
    }
  }

  const sb = await getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;

  // Combiner le signal venant du composant (annulation manuelle) avec un timeout 60s
  // (aligné sur le maxDuration de la function Vercel — 60s — pour ne pas couper avant elle)
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), 55000);
  const externalSignal = params._signal;
  delete params._signal;

  const signal = externalSignal
    ? (typeof AbortSignal.any === 'function'
        ? AbortSignal.any([timeoutCtrl.signal, externalSignal])
        : timeoutCtrl.signal)
    : timeoutCtrl.signal;

  let r;
  try {
    r = await fetch('/api/ai-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
      signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Timeout IA — réessaie');
    throw new Error(`Erreur réseau : ${e.message}`);
  }
  clearTimeout(timer);

  if (!r.ok) {
    let detail = '';
    try {
      const b = await r.json();
      detail = b.error ? ` — ${b.error}` : '';
    } catch {
      try { const t = await r.text(); if (t) detail = ` — ${t.slice(0, 150)}`; } catch {}
    }
    throw new Error(`Erreur IA (${r.status})${detail}`);
  }

  const data = await r.json();
  // L'API Anthropic renvoie parfois les erreurs avec un champ "error" en 200
  if (data.error) throw new Error(typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : data.error);
  return data;
}

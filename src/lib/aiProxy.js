import { getSupabase } from '../supabase.js';

const _lastCall = {};
const THROTTLE_MS = 5000;

export async function callAIProxy(params) {
  const feature = params.feature || 'default';
  const now = Date.now();
  const elapsed = now - (_lastCall[feature] || 0);
  if (elapsed < THROTTLE_MS) {
    const wait = Math.ceil((THROTTLE_MS - elapsed) / 1000);
    throw new Error(`Attends ${wait}s avant une nouvelle requête IA`);
  }
  _lastCall[feature] = now;

  const sb = await getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;

  // Combiner le signal venant du composant (annulation manuelle) avec un timeout 30s
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), 30000);
  const externalSignal = params._signal;
  delete params._signal;

  // Si l'un des deux signaux abort, on abort la requête
  const signal = externalSignal
    ? AbortSignal.any
      ? AbortSignal.any([timeoutCtrl.signal, externalSignal])
      : timeoutCtrl.signal
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
    if (e.name === 'AbortError') throw new Error('Timeout IA (30s) — réessaie');
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

import { getSupabase } from '../supabase.js';

export async function callAIProxy(params) {
  const sb = await getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;

  const r = await fetch('/api/ai-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params),
  });
  if (!r.ok) {
    let detail = '';
    try { const b = await r.json(); detail = b.error ? ` — ${b.error}` : ''; } catch {}
    throw new Error(`Erreur IA (${r.status})${detail}`);
  }
  const data = await r.json();
  // L'API Anthropic renvoie les erreurs avec un champ "error" même en 200
  if (data.error) throw new Error(typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : data.error);
  return data;
}

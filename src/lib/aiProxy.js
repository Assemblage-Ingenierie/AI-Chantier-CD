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
  if (!r.ok) throw new Error(`Erreur IA (${r.status})`);
  return r.json();
}

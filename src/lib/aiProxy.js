export async function callAIProxy(params) {
  const r = await fetch('/api/ai-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!r.ok) throw new Error(`Erreur IA (${r.status})`);
  return r.json();
}

const ALLOWED_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-5-20251101',
  'claude-haiku-4-5',
  'claude-sonnet-4-5',
  'claude-sonnet-4-6',
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-20241022',
];
const MAX_TOKENS_CAP = 2000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(request) {
  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    // Vérification minimale : présence du token (l'app est déjà derrière Supabase Auth)
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Non autorisé' }, 401);
    }

    const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();
    if (!anthropicKey) {
      return json({ error: 'Clé Anthropic manquante (ANTHROPIC_API_KEY non configurée dans Vercel)' }, 500);
    }

    const payload = await request.json();
    const model = ALLOWED_MODELS.includes(payload.model) ? payload.model : 'claude-3-5-haiku-20241022';
    const max_tokens = Math.min(Number(payload.max_tokens) || 1024, MAX_TOKENS_CAP);

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);

    let upstream;
    try {
      upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens, system: payload.system, messages: payload.messages }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
    } catch (e) {
      clearTimeout(t);
      return json({ error: `API Anthropic injoignable : ${e.message}` }, 500);
    }

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: `Réponse inattendue : ${text.slice(0, 200)}` }; }

    return json(data, upstream.status);

  } catch (error) {
    return json({ error: `Erreur : ${error instanceof Error ? error.message : String(error)}` }, 500);
  }
}

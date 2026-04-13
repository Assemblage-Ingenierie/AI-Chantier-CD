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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!anthropicKey) {
    return res.status(500).json({ error: 'Clé Anthropic manquante (ANTHROPIC_API_KEY non configurée dans Vercel)' });
  }

  let payload;
  try {
    payload = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'Corps de requête invalide' });
  }

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
    return res.status(500).json({ error: `API Anthropic injoignable : ${e.message}` });
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return res.status(500).json({ error: 'Réponse non-JSON de Anthropic' });
  }

  return res.status(upstream.status).json(data);
}

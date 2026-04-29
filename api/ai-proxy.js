const ALLOWED_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro',
];
const MAX_TOKENS_CAP = 2000;
const DEFAULT_MODEL = 'gemini-2.0-flash';

// Convertit le format Anthropic (messages + system) vers le format Gemini
function toGeminiBody(payload, maxTokens) {
  const contents = (payload.messages || []).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : (m.content || []).map(c => c.text || '').join('') }],
  }));
  const body = { contents, generationConfig: { maxOutputTokens: maxTokens } };
  if (payload.system) body.system_instruction = { parts: [{ text: payload.system }] };
  return body;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  // Valider le token Supabase — rejette les tokens forgés ou expirés
  const sbUrl = (process.env.SUPABASE_URL || '').trim();
  const sbAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  if (sbUrl && sbAnonKey) {
    let userRes;
    try {
      userRes = await fetch(`${sbUrl}/auth/v1/user`, {
        headers: { 'Authorization': authHeader, 'apikey': sbAnonKey },
      });
    } catch {
      return res.status(401).json({ error: 'Impossible de valider le token' });
    }
    if (!userRes.ok) {
      return res.status(401).json({ error: 'Token invalide ou expiré' });
    }
  }

  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!geminiKey) {
    return res.status(500).json({ error: 'Clé Gemini manquante (GEMINI_API_KEY non configurée dans Vercel)' });
  }

  let payload;
  try {
    payload = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'Corps de requête invalide' });
  }

  const model = ALLOWED_MODELS.includes(payload.model) ? payload.model : DEFAULT_MODEL;
  const maxTokens = Math.min(Number(payload.max_tokens) || 1024, MAX_TOKENS_CAP);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);

  let upstream;
  try {
    upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiKey,
        },
        body: JSON.stringify(toGeminiBody(payload, maxTokens)),
        signal: ctrl.signal,
      }
    );
    clearTimeout(t);
  } catch (e) {
    clearTimeout(t);
    return res.status(500).json({ error: `API Gemini injoignable : ${e.message}` });
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return res.status(500).json({ error: 'Réponse non-JSON de Gemini' });
  }

  if (!upstream.ok) {
    const msg = data?.error?.message || JSON.stringify(data);
    if (upstream.status === 429) {
      return res.status(429).json({ error: 'Quota Gemini dépassé (15 req/min sur le plan gratuit) — attends 1 minute ou active la facturation sur Google Cloud Console' });
    }
    return res.status(upstream.status).json({ error: `Erreur Gemini : ${msg}` });
  }

  // Normaliser au format Anthropic pour compatibilité avec le client existant
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return res.status(200).json({ content: [{ type: 'text', text }] });
}

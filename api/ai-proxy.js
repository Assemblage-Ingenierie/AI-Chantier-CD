// Proxy IA — utilise l'API Anthropic (Claude)
// Variable d'env Vercel requise : ANTHROPIC_API_KEY
// Modèles disponibles : claude-haiku-4-5-20251001 (rapide), claude-sonnet-4-6 (meilleur)
const DEFAULT_MODEL  = 'claude-haiku-4-5-20251001';
const FALLBACK_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS_CAP = 4096;
const ANTHROPIC_API  = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VER  = '2023-06-01';

// Rate limiting serveur : 20 appels/minute par IP (protection contre abus avec token volé)
const _rl = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const e = _rl.get(ip) || { n: 0, resetAt: now + 60_000 };
  if (now > e.resetAt) { e.n = 0; e.resetAt = now + 60_000; }
  e.n++;
  _rl.set(ip, e);
  return e.n <= 20;
}

// Mappe les anciens noms Gemini vers Claude (rétro-compatibilité)
function resolveModel(requested) {
  if (!requested || requested.startsWith('gemini-') || requested.startsWith('gemma-')) {
    return DEFAULT_MODEL;
  }
  const allowed = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-7'];
  return allowed.includes(requested) ? requested : DEFAULT_MODEL;
}

async function callClaude(model, payload, apiKey, maxTokens, timeoutMs = 55000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body = {
      model,
      max_tokens: maxTokens,
      messages: payload.messages || [],
    };
    if (payload.system) body.system = payload.system;

    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VER,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return { res, timedOut: false };
  } catch (e) {
    clearTimeout(t);
    return { res: null, timedOut: true, err: e.message };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  // Valider le token Supabase
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

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Trop de requêtes — réessaie dans une minute' });
  }

  const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!anthropicKey) {
    return res.status(500).json({ error: 'Clé API manquante (ANTHROPIC_API_KEY non configurée dans Vercel)' });
  }

  let payload;
  try {
    payload = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'Corps de requête invalide' });
  }

  const model     = resolveModel(payload.model);
  const maxTokens = Math.min(Number(payload.max_tokens) || 1024, MAX_TOKENS_CAP);

  // Tentative avec le modèle principal
  let { res: upstream, timedOut, err } = await callClaude(model, payload, anthropicKey, maxTokens);

  if (timedOut) {
    return res.status(504).json({ error: 'Timeout IA (55s) — réessaie' });
  }

  let data;
  try { data = await upstream.json(); } catch {
    return res.status(502).json({ error: 'Réponse invalide du modèle' });
  }

  // Si overloaded ou erreur serveur, retry avec le modèle de fallback
  if ((upstream.status === 529 || upstream.status === 503) && model !== FALLBACK_MODEL) {
    const fb = await callClaude(FALLBACK_MODEL, payload, anthropicKey, maxTokens);
    if (!fb.timedOut && fb.res) {
      try { data = await fb.res.json(); upstream = fb.res; } catch {}
    }
  }

  if (upstream.status === 401) {
    return res.status(401).json({ error: 'Clé API Claude invalide ou expirée. Vérifie ANTHROPIC_API_KEY dans Vercel.' });
  }
  if (upstream.status === 429) {
    const retryAfter = data?.error?.message || '';
    return res.status(429).json({ error: `Quota Claude dépassé — ${retryAfter || 'réessaie dans quelques minutes'}` });
  }
  if (!upstream.ok) {
    const detail = data?.error?.message || upstream.status;
    return res.status(upstream.status || 500).json({ error: `Erreur IA : ${detail}` });
  }

  // Réponse Anthropic : { content: [{ type:'text', text:'...' }] }
  const text = data.content?.[0]?.text ?? '';
  return res.status(200).json({ content: [{ type: 'text', text }], _model: data.model || model });
}

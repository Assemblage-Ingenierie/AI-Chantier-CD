// Ordre de préférence : le proxy essaie chaque modèle en cas de 429 (quota épuisé)
const FALLBACK_CHAIN = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash-preview-04-17',
  'gemini-2.5-pro-preview-03-25',
];
const MAX_TOKENS_CAP = 2000;
const DEFAULT_MODEL  = 'gemini-2.0-flash-lite';

// Convertit le format Anthropic (messages + system) vers le format Gemini
function toGeminiBody(payload, maxTokens, model) {
  const msgs = payload.messages || [];
  const isGemma = model.startsWith('gemma-');
  const contents = msgs.map((m, i) => {
    const text = typeof m.content === 'string' ? m.content : (m.content || []).map(c => c.text || '').join('');
    const prefix = isGemma && i === 0 && m.role === 'user' && payload.system ? payload.system + '\n\n' : '';
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: prefix + text }] };
  });
  const body = { contents, generationConfig: { maxOutputTokens: maxTokens } };
  if (!isGemma && payload.system) body.system_instruction = { parts: [{ text: payload.system }] };
  return body;
}

async function callGemini(model, body, geminiKey, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }
    );
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

  const requestedModel = FALLBACK_CHAIN.includes(payload.model) ? payload.model : DEFAULT_MODEL;
  const maxTokens = Math.min(Number(payload.max_tokens) || 1024, MAX_TOKENS_CAP);

  // Construire la chaîne de fallback : modèle demandé en premier, puis les suivants
  const startIdx = FALLBACK_CHAIN.indexOf(requestedModel);
  const modelsToTry = [
    ...FALLBACK_CHAIN.slice(startIdx),
    ...FALLBACK_CHAIN.slice(0, startIdx),
  ];

  const errors = {};

  for (const model of modelsToTry) {
    const geminiBody = toGeminiBody(payload, maxTokens, model);
    const { res: upstream, timedOut, err } = await callGemini(model, geminiBody, geminiKey);

    if (timedOut) {
      errors[model] = 'timeout';
      continue;
    }

    let data;
    try { data = await upstream.json(); } catch { errors[model] = 'non-json'; continue; }

    if (upstream.status === 429 || upstream.status === 503) {
      errors[model] = 'quota';
      continue;
    }
    if (upstream.status === 401 || upstream.status === 403) {
      // Clé invalide — inutile d'essayer les autres
      return res.status(401).json({ error: 'Clé API Gemini invalide ou expirée. Vérifie GEMINI_API_KEY dans Vercel.' });
    }
    if (!upstream.ok) {
      errors[model] = upstream.status === 404 ? 'not-found' : (data?.error?.message || upstream.status);
      continue;
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return res.status(200).json({ content: [{ type: 'text', text }], _model: model });
  }

  // Tous les modèles ont échoué — construire un message clair
  const quotaFailed = Object.values(errors).filter(e => e === 'quota').length;
  const notFound    = Object.values(errors).filter(e => e === 'not-found').length;
  let userMsg;
  if (quotaFailed === modelsToTry.length) {
    userMsg = 'Quota Gemini épuisé pour aujourd\'hui (limite journalière atteinte). Réessaie demain ou utilise une clé API avec un forfait payant.';
  } else if (quotaFailed > 0) {
    userMsg = `Quota partiel dépassé (${quotaFailed}/${modelsToTry.length} modèles). Réessaie dans quelques minutes.`;
  } else if (notFound === modelsToTry.length) {
    userMsg = 'Aucun modèle Gemini disponible. Vérifie que ta clé API est valide dans Vercel (GEMINI_API_KEY).';
  } else {
    const details = Object.entries(errors).map(([m, e]) => `${m.replace('gemini-','')}: ${e}`).join(' | ');
    userMsg = `IA indisponible — ${details}`;
  }
  return res.status(429).json({ error: userMsg });
}

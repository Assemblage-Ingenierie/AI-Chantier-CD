// Ordre de préférence : modèles avec les quotas free les plus généreux en premier
const FALLBACK_CHAIN = [
  'gemini-2.0-flash-lite',   // 30 RPM / 1500 RPD free — le plus permissif
  'gemini-2.0-flash',         // 15 RPM / 1500 RPD free
  'gemini-2.5-flash',         // 10 RPM / 500 RPD free — quota séparé
  'gemini-2.5-pro',           // 5 RPM / 25 RPD free — dernier recours
];
const MAX_TOKENS_CAP = 2000;
const DEFAULT_MODEL  = 'gemini-2.0-flash-lite';

// Extrait le délai de retry depuis la réponse d'erreur Gemini (en secondes)
function parseRetryDelay(data) {
  try {
    const details = data?.error?.details || [];
    for (const d of details) {
      if (d['@type']?.includes('RetryInfo') && d.retryDelay) {
        return parseInt(d.retryDelay, 10) || null;
      }
    }
    // Fallback : cherche dans le message
    const msg = data?.error?.message || '';
    const m = msg.match(/retry.*?(\d+)\s*s/i);
    if (m) return parseInt(m[1], 10);
  } catch {}
  return null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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

async function callGemini(model, body, geminiKey, timeoutMs = 25000) {
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

    // Jusqu'à 2 tentatives par modèle (1 retry si délai court)
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      const { res: upstream, timedOut, err } = await callGemini(model, geminiBody, geminiKey);

      if (timedOut) {
        errors[model] = 'timeout';
        break; // passer au modèle suivant
      }

      let data;
      try { data = await upstream.json(); } catch { errors[model] = 'non-json'; break; }

      if (upstream.status === 429 || upstream.status === 503) {
        const delaySec = parseRetryDelay(data);
        // Si Gemini dit "retry dans X secondes" et que c'est court, on attend et on retente
        if (delaySec && delaySec <= 12 && attempts === 1) {
          await sleep(delaySec * 1000 + 500);
          continue; // retry même modèle
        }
        errors[model] = delaySec ? `quota(${delaySec}s)` : 'quota';
        break;
      }
      if (upstream.status === 401 || upstream.status === 403) {
        // Clé invalide — inutile d'essayer les autres
        return res.status(401).json({ error: 'Clé API Gemini invalide ou expirée. Vérifie GEMINI_API_KEY dans Vercel.' });
      }
      if (!upstream.ok) {
        errors[model] = upstream.status === 404 ? 'not-found' : (data?.error?.message || upstream.status);
        break;
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      return res.status(200).json({ content: [{ type: 'text', text }], _model: model });
    }
  }

  // Tous les modèles ont échoué — message clair selon le type d'erreur
  const quotaFailed = Object.values(errors).filter(e => String(e).startsWith('quota')).length;
  const notFound    = Object.values(errors).filter(e => e === 'not-found').length;
  const workingModels = modelsToTry.length - notFound;

  let userMsg;
  if (notFound === modelsToTry.length) {
    userMsg = 'Aucun modèle IA disponible. Vérifie que ta clé API est valide (GEMINI_API_KEY dans Vercel).';
  } else if (quotaFailed === workingModels) {
    userMsg = 'Quota IA dépassé — tous les modèles sont saturés. Attends 1 minute et réessaie, ou active la facturation Google Cloud pour ta clé API.';
  } else if (quotaFailed > 0) {
    userMsg = `Quota IA partiel — ${quotaFailed} modèle(s) saturé(s). Réessaie dans 1 minute.`;
  } else {
    const details = Object.entries(errors).map(([m, e]) => `${m.replace('gemini-','')}: ${e}`).join(' | ');
    userMsg = `IA indisponible — ${details}`;
  }
  return res.status(429).json({ error: userMsg });
}

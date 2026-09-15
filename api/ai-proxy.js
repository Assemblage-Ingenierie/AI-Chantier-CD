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

// ── Gemini (Google) — activé si la requête demande provider:'gemini' ────────────
// Variable d'env Vercel requise : GEMINI_API_KEY. La réponse est normalisée au MÊME
// format que Claude ({ content:[{type:'text',text}] }) → aucun changement côté app.
// Modèles Gemini — on PRIVILÉGIE les alias `-latest` : ils pointent toujours vers la dernière
// version stable, donc ils ne se périment JAMAIS quand Google retire un numéro de version (cause
// des pannes récurrentes « génération de texte HS » : gemini-2.0-flash arrêté 06/2026,
// gemini-3.x fantômes). Les versions numériques ne servent que de repli, et en DERNIER recours
// une découverte dynamique (models.list) choisit un modèle réellement disponible.
const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_FLASH_FALLBACKS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const GEMINI_PRO_FALLBACKS   = ['gemini-pro-latest', 'gemini-2.5-pro'];
const GEMINI_API = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// Modèle découvert dynamiquement et VALIDÉ pendant cette instance (cache) → évite de re-lister.
const _discovered = { flash: null, pro: null };

// Découverte dynamique : demande à Google la liste des modèles supportant generateContent et en
// choisit un (flash ou pro), version la plus récente, hors variantes preview/exp/image/audio…
// Garantit que l'IA fonctionne tant que la clé est valide et que Google a AU MOINS un modèle.
async function discoverGeminiModel(apiKey, wantPro) {
  if (wantPro && _discovered.pro) return _discovered.pro;
  if (!wantPro && _discovered.flash) return _discovered.flash;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`);
    if (!r.ok) return null;
    const d = await r.json();
    const names = (d.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => (m.name || '').replace(/^models\//, ''))
      .filter(n => n.startsWith('gemini-') && !/preview|exp|thinking|image|audio|tts|embedding|learnlm|vision|native/i.test(n));
    const kind = wantPro ? 'pro' : 'flash';
    const pick = names.filter(n => n.includes(kind)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
              || names.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
              || null;
    if (pick) { if (wantPro) _discovered.pro = pick; else _discovered.flash = pick; }
    return pick;
  } catch { return null; }
}

// Convertit un contenu de message (string OU tableau de blocs texte/image façon Anthropic) en
// "parts" Gemini. IMPORTANT : les blocs image ({type:'image',source:{base64}}) sont mappés en
// inline_data → Gemini VOIT les photos (avant, elles étaient perdues → analyse aveugle).
function toGeminiParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  if (Array.isArray(content)) {
    return content.map(c => {
      if (typeof c === 'string') return { text: c };
      if (c?.type === 'text') return { text: c.text || '' };
      if (c?.type === 'image' && c.source?.type === 'base64' && c.source?.data)
        return { inline_data: { mime_type: c.source.media_type || 'image/jpeg', data: c.source.data } };
      if (c?.text) return { text: c.text };
      return null;
    }).filter(Boolean);
  }
  return [{ text: String(content ?? '') }];
}

function toGeminiContents(messages) {
  return (messages || []).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: toGeminiParts(m.content) }));
}

async function callGemini(model, payload, apiKey, maxTokens, timeoutMs = 55000, disableThinking = false) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const genCfg = { maxOutputTokens: maxTokens };
    // Coupe la « réflexion » (thinking) → réponse rapide. Valide sur Flash (budget 0), refusé par
    // Pro (400) → le handler réessaie alors sans ce réglage. N'activer que quand demandé (Flash).
    if (disableThinking) genCfg.thinkingConfig = { thinkingBudget: 0 };
    // JSON garanti : Gemini sort parfois du texte autour du JSON → « Réponse illisible ». Avec
    // responseMimeType, la sortie est un JSON valide. Demandé par la requête (payload.json).
    if (payload.json) genCfg.responseMimeType = 'application/json';
    const body = {
      contents: toGeminiContents(payload.messages),
      generationConfig: genCfg,
    };
    if (payload.system) body.system_instruction = { parts: [{ text: payload.system }] };
    const res = await fetch(`${GEMINI_API(model)}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  let payload;
  try {
    payload = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'Corps de requête invalide' });
  }

  const maxTokens = Math.min(Number(payload.max_tokens) || 1024, MAX_TOKENS_CAP);

  // ── Routage MOTEUR : Gemini si demandé, sinon Claude (défaut) ──
  if (payload.provider === 'gemini') {
    const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!geminiKey) {
      return res.status(500).json({ error: 'Gemini non configuré (GEMINI_API_KEY manquante dans Vercel). Repasse sur Claude dans les Paramètres.' });
    }
    const requested = (typeof payload.model === 'string' && payload.model.startsWith('gemini-')) ? payload.model : null;
    const wantPro = requested ? /pro/i.test(requested) : false;

    // Liste ORDONNÉE de modèles à essayer : (1) un modèle déjà validé cette session (cache),
    // (2) le modèle demandé, (3) les replis connus. On dédoublonne en gardant l'ordre.
    const cachedGood = wantPro ? _discovered.pro : _discovered.flash;
    const ordered = [cachedGood, requested, ...(wantPro ? GEMINI_PRO_FALLBACKS : GEMINI_FLASH_FALLBACKS)];
    const seen = new Set();
    const tryModels = ordered.filter(m => m && !seen.has(m) && (seen.add(m), true));

    // Erreur TERMINALE (inutile d'essayer d'autres modèles) : clé invalide, quota, permission.
    const isTerminal = (st, d) =>
      st === 429 || st === 403 ||
      (st === 400 && /api[_ ]?key|permission|denied/i.test(JSON.stringify(d?.error || '')));

    let gUp = null, gData = null, gModel = null, timedOutAll = true;
    const runOne = async (cand) => {
      const fast = /flash/i.test(cand);
      const r = await callGemini(cand, payload, geminiKey, maxTokens, 55000, fast);
      if (r.timedOut || !r.res) return { timedOut: true };
      let d; try { d = await r.res.json(); } catch { return { res: r.res, data: null }; }
      // Réglage refusé (thinking/responseMimeType) → on réessaie le MÊME modèle sans les extras.
      if (r.res.status === 400 && /invalid.?argument/i.test(JSON.stringify(d?.error || ''))) {
        const rt = await callGemini(cand, { ...payload, json: false }, geminiKey, maxTokens, 55000, false);
        if (!rt.timedOut && rt.res) { try { const d2 = await rt.res.json(); return { res: rt.res, data: d2 }; } catch { /* garde d'origine */ } }
      }
      return { res: r.res, data: d };
    };

    for (const cand of tryModels) {
      const out = await runOne(cand);
      if (out.timedOut) continue;
      timedOutAll = false;
      gUp = out.res; gData = out.data; gModel = cand;
      if (out.res.ok) { if (wantPro) _discovered.pro = cand; else _discovered.flash = cand; break; }
      if (isTerminal(out.res.status, out.data)) break; // clé/quota → arrêter, message clair plus bas
      // sinon (404 modèle absent, 400 not found, 500…) → candidat suivant
    }

    // DERNIER RECOURS : aucun modèle connu n'a marché → on demande à Google la liste réelle et on
    // essaie le meilleur modèle disponible. Rend l'IA insensible aux renommages/retraits de Google.
    if ((!gUp || !gUp.ok) && !(gUp && isTerminal(gUp.status, gData))) {
      const disc = await discoverGeminiModel(geminiKey, wantPro);
      if (disc && !seen.has(disc)) {
        const out = await runOne(disc);
        if (!out.timedOut) { timedOutAll = false; gUp = out.res; gData = out.data; gModel = disc; }
      }
    }

    if (timedOutAll || !gUp) return res.status(504).json({ error: 'Timeout IA (55s) — réessaie' });
    if (gUp.status === 429) {
      return res.status(429).json({ error: 'Quota Gemini dépassé — réessaie dans quelques minutes' });
    }
    if (gUp.status === 400 && /api[_ ]?key/i.test(JSON.stringify(gData?.error || ''))) {
      return res.status(401).json({ error: 'Clé API Gemini invalide. Vérifie GEMINI_API_KEY dans Vercel.' });
    }
    if (!gUp.ok) {
      const detail = gData?.error?.message || gUp.status;
      return res.status(gUp.status || 500).json({ error: `Erreur IA Gemini (${gModel}) : ${detail}` });
    }
    const gText = (gData.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('') || '';
    return res.status(200).json({ content: [{ type: 'text', text: gText }], _model: gModel });
  }

  const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!anthropicKey) {
    return res.status(500).json({ error: 'Clé API manquante (ANTHROPIC_API_KEY non configurée dans Vercel)' });
  }

  const model = resolveModel(payload.model);

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

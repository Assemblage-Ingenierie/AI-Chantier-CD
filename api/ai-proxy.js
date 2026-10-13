// Proxy IA — utilise l'API Anthropic (Claude)
// Variable d'env Vercel requise : ANTHROPIC_API_KEY
// Modèles disponibles : claude-haiku-4-5-20251001 (rapide), claude-sonnet-4-6 (meilleur)
const DEFAULT_MODEL  = 'claude-haiku-4-5-20251001';
const FALLBACK_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS_CAP = 4096;
const ANTHROPIC_API  = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VER  = '2023-06-01';

// ── BUDGET DE TEMPS (retour Thomas 13/10/2026 : « de temps en temps j'ai un Timeout IA ») ──
// Avant : chaque appel pouvait attendre 55 s, et Gemini essayait plusieurs modèles À LA SUITE →
// un Gemini lent/surchargé mangeait tout le temps et l'app abandonnait (55 s) AVANT que le
// secours Mistral ne soit essayé. Désormais : budget GLOBAL de 48 s (l'app attend 55 s, Vercel
// coupe à 60 s) et, tant qu'un autre moteur reste disponible, un appel ne peut pas dépasser 30 s
// → il reste toujours du temps pour basculer. Le dernier moteur dispose de tout le temps restant.
const TOTAL_BUDGET_MS = 48000;
const CALL_CAP_MS     = 30000;
const MIN_CALL_MS     = 3000;
const callTimeout = (budget) => Math.max(0, Math.min(budget?.cap ?? CALL_CAP_MS, (budget?.end ?? Date.now() + 55000) - Date.now() - 1000));

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

// ── Mistral (La Plateforme) — provider:'mistral', ou SECOURS automatique quand Gemini est à
// court de quota. Variable d'env Vercel : MISTRAL_API_KEY (offre gratuite « Experiment »).
// Réponse normalisée au MÊME format que Claude/Gemini → aucun changement côté app.
const MISTRAL_API = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_DEFAULT = 'mistral-small-latest'; // texte + images, bon en français, quota gratuit

function toMistralContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  const parts = content.map(c => {
    if (typeof c === 'string') return { type: 'text', text: c };
    if (c?.type === 'text') return { type: 'text', text: c.text || '' };
    if (c?.type === 'image' && c.source?.type === 'base64' && c.source?.data)
      return { type: 'image_url', image_url: `data:${c.source.media_type || 'image/jpeg'};base64,${c.source.data}` };
    if (c?.text) return { type: 'text', text: c.text };
    return null;
  }).filter(Boolean);
  // Que du texte → une simple chaîne (compatible avec tous les modèles Mistral).
  return parts.every(p => p.type === 'text') ? parts.map(p => p.text).join('\n') : parts;
}

async function callMistral(payload, apiKey, maxTokens, budget) {
  const requested = typeof payload.model === 'string' && /^(mistral|magistral|pixtral|ministral|open-mistral)/.test(payload.model) ? payload.model : null;
  const models = [...new Set([requested, MISTRAL_DEFAULT].filter(Boolean))];
  const messages = [
    ...(payload.system ? [{ role: 'system', content: payload.system }] : []),
    ...(payload.messages || []).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: toMistralContent(m.content) })),
  ];
  let last = { status: 504, data: { error: { message: 'Timeout IA — réessaie' } }, model: models[0] };
  for (const model of models) {
    const timeoutMs = callTimeout(budget);
    if (timeoutMs < MIN_CALL_MS) break;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const body = { model, messages, max_tokens: maxTokens, ...(payload.json ? { response_format: { type: 'json_object' } } : {}) };
      const res = await fetch(MISTRAL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      let data = null; try { data = await res.json(); } catch { /* corps illisible */ }
      last = { status: res.status, data, model };
      if (res.ok) break;
      if (res.status === 401 || res.status === 429) break; // clé / quota : inutile d'essayer un autre modèle
    } catch {
      clearTimeout(t);
      break; // délai dépassé : on laisse le temps restant au moteur suivant
    }
  }
  return last;
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
const GEMINI_FLASH_FALLBACKS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
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
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(5000) });
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
    // Réflexion BORNÉE demandée explicitement (ex. correcteur d'orthographe : plus fiable sur les
    // accords et les mots manquants) — budget fixe pour ne pas manger la sortie.
    else if (Number.isFinite(payload.thinkingBudget)) genCfg.thinkingConfig = { thinkingBudget: payload.thinkingBudget };
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

// ── Exécuteurs par moteur : renvoient { status, json } (json = corps à renvoyer au client) ──

async function runMistral(payload, apiKey, maxTokens, budget) {
  const out = await callMistral(payload, apiKey, maxTokens, budget);
  const { status, data, model } = out;
  if (status === 401) return { status: 401, json: { error: 'Clé API Mistral invalide. Vérifie MISTRAL_API_KEY dans Vercel.' } };
  if (status === 429) return { status: 429, json: { error: 'Quota Mistral dépassé — réessaie dans une minute' } };
  if (status < 200 || status >= 300) {
    const detail = data?.message || data?.error?.message || data?.detail || status;
    return { status: status || 500, json: { error: `Erreur IA Mistral (${model}) : ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` } };
  }
  const choice = data?.choices?.[0];
  const c = choice?.message?.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x?.text || '').join('') : '';
  // finish_reason 'length' = réponse coupée → même signal que Gemini (le client la refuse).
  const finish = choice?.finish_reason === 'length' ? 'MAX_TOKENS' : (choice?.finish_reason || null);
  return { status: 200, json: { content: [{ type: 'text', text }], _model: data?.model || model, _finish: finish } };
}

async function runGemini(payload, geminiKey, maxTokens, budget) {
  const requested = (typeof payload.model === 'string' && payload.model.startsWith('gemini-')) ? payload.model : null;
  const wantPro = requested ? /pro/i.test(requested) : false;

  // Liste ORDONNÉE de modèles à essayer : (1) un modèle déjà validé cette session (cache),
  // (2) le modèle demandé, (3) les replis connus. On dédoublonne en gardant l'ordre.
  const cachedGood = wantPro ? _discovered.pro : _discovered.flash;
  // Pro (souvent hors offre gratuite) → repli sur les Flash avant de changer de moteur.
  const ordered = [cachedGood, requested, ...(wantPro ? [...GEMINI_PRO_FALLBACKS, ...GEMINI_FLASH_FALLBACKS] : GEMINI_FLASH_FALLBACKS)];
  const seen = new Set();
  const tryModels = ordered.filter(m => m && !seen.has(m) && (seen.add(m), true));

  // Erreur TERMINALE (inutile d'essayer d'autres modèles) : clé invalide, permission.
  // PAS le quota (429) : chaque modèle a SON quota gratuit (Flash épuisé → Flash-Lite, bien
  // plus généreux, prend le relais au lieu d'abandonner).
  const isTerminal = (st, d) =>
    st === 403 ||
    (st === 400 && /api[_ ]?key|permission|denied/i.test(JSON.stringify(d?.error || '')));

  let gUp = null, gData = null, gModel = null, timedOutAll = true;
  const runOne = async (cand) => {
    // Flash : réflexion coupée (rapide) SAUF si la requête demande un budget de réflexion.
    const fast = /flash/i.test(cand) && !Number.isFinite(payload.thinkingBudget);
    const r = await callGemini(cand, payload, geminiKey, maxTokens, callTimeout(budget), fast);
    if (r.timedOut || !r.res) return { timedOut: true };
    let d; try { d = await r.res.json(); } catch { return { res: r.res, data: null }; }
    // Réglage refusé (thinking/responseMimeType) → on réessaie le MÊME modèle sans les extras.
    if (r.res.status === 400 && /invalid.?argument/i.test(JSON.stringify(d?.error || ''))) {
      if (callTimeout(budget) < MIN_CALL_MS) return { res: r.res, data: d };
      const rt = await callGemini(cand, { ...payload, json: false }, geminiKey, maxTokens, callTimeout(budget), false);
      if (!rt.timedOut && rt.res) { try { const d2 = await rt.res.json(); return { res: rt.res, data: d2 }; } catch { /* garde d'origine */ } }
    }
    return { res: r.res, data: d };
  };

  for (const cand of tryModels) {
    if (callTimeout(budget) < MIN_CALL_MS) break;
    const out = await runOne(cand);
    // Gemini ne répond pas (surcharge) : inutile d'essayer ses autres modèles l'un après l'autre
    // → on rend la main tout de suite pour basculer sur un autre moteur (Mistral).
    if (out.timedOut) break;
    timedOutAll = false;
    gUp = out.res; gData = out.data; gModel = cand;
    if (out.res.ok) { if (wantPro) _discovered.pro = cand; else _discovered.flash = cand; break; }
    if (isTerminal(out.res.status, out.data)) break; // clé/quota → arrêter, message clair plus bas
    // sinon (404 modèle absent, 400 not found, 500…) → candidat suivant
  }

  // DERNIER RECOURS : aucun modèle connu n'a marché → on demande à Google la liste réelle et on
  // essaie le meilleur modèle disponible. Rend l'IA insensible aux renommages/retraits de Google.
  if ((!gUp || !gUp.ok) && !timedOutAll && !(gUp && isTerminal(gUp.status, gData)) && callTimeout(budget) > 8000) {
    const disc = await discoverGeminiModel(geminiKey, wantPro);
    if (disc && !seen.has(disc)) {
      const out = await runOne(disc);
      if (!out.timedOut) { timedOutAll = false; gUp = out.res; gData = out.data; gModel = disc; }
    }
  }

  if (timedOutAll || !gUp) return { status: 504, json: { error: 'Gemini ne répond pas (surcharge) — réessaie' } };
  if (gUp.status === 429) return { status: 429, json: { error: 'Quota Gemini dépassé — réessaie dans quelques minutes' } };
  if (gUp.status === 400 && /api[_ ]?key/i.test(JSON.stringify(gData?.error || ''))) {
    return { status: 401, json: { error: 'Clé API Gemini invalide. Vérifie GEMINI_API_KEY dans Vercel.' } };
  }
  if (!gUp.ok) {
    const detail = gData?.error?.message || gUp.status;
    return { status: gUp.status || 500, json: { error: `Erreur IA Gemini (${gModel}) : ${detail}` } };
  }
  const gText = (gData.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('') || '';
  // _finish : motif de fin (STOP, MAX_TOKENS…) → le client peut REFUSER une réponse coupée au
  // lieu de la prendre pour un texte complet (sinon la fin manquante = « à supprimer »).
  return { status: 200, json: { content: [{ type: 'text', text: gText }], _model: gModel, _finish: gData.candidates?.[0]?.finishReason || null } };
}

async function runClaude(payload, anthropicKey, maxTokens, budget) {
  const model = resolveModel(payload.model);
  let { res: upstream, timedOut } = await callClaude(model, payload, anthropicKey, maxTokens, callTimeout(budget));
  if (timedOut || !upstream) return { status: 504, json: { error: 'Timeout IA — réessaie' } };
  let data;
  try { data = await upstream.json(); } catch {
    return { status: 502, json: { error: 'Réponse invalide du modèle' } };
  }
  // Si overloaded ou erreur serveur, retry avec le modèle de fallback
  if ((upstream.status === 529 || upstream.status === 503) && model !== FALLBACK_MODEL && callTimeout(budget) >= MIN_CALL_MS) {
    const fb = await callClaude(FALLBACK_MODEL, payload, anthropicKey, maxTokens, callTimeout(budget));
    if (!fb.timedOut && fb.res) {
      try { data = await fb.res.json(); upstream = fb.res; } catch { /* garde la 1re réponse */ }
    }
  }
  if (upstream.status === 401) return { status: 401, json: { error: 'Clé API Claude invalide ou expirée. Vérifie ANTHROPIC_API_KEY dans Vercel.' } };
  if (upstream.status === 429) return { status: 429, json: { error: `Quota Claude dépassé — ${data?.error?.message || 'réessaie dans quelques minutes'}` } };
  if (!upstream.ok) return { status: upstream.status || 500, json: { error: `Erreur IA : ${data?.error?.message || upstream.status}` } };
  // Réponse Anthropic : { content: [{ type:'text', text:'...' }] }
  return { status: 200, json: { content: [{ type: 'text', text: data.content?.[0]?.text ?? '' }], _model: data.model || model } };
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

  // ── Routage MOTEUR avec SECOURS AUTOMATIQUE entre moteurs ──
  // Le moteur choisi dans les Paramètres passe en premier ; s'il échoue (quota épuisé, clé
  // absente ou invalide, panne, délai), l'app bascule SEULE sur les autres moteurs configurés.
  // But : que l'IA marche avec la seule clé Gemini et/ou Mistral, sans jamais dépendre de Claude.
  const keys = {
    gemini:  (process.env.GEMINI_API_KEY || '').trim(),
    mistral: (process.env.MISTRAL_API_KEY || '').trim(),
    claude:  (process.env.ANTHROPIC_API_KEY || '').trim(),
  };
  const order = payload.provider === 'mistral' ? ['mistral', 'gemini', 'claude']
    : payload.provider === 'gemini' ? ['gemini', 'mistral', 'claude']
    : ['claude', 'gemini', 'mistral'];
  const runners = { gemini: runGemini, mistral: runMistral, claude: runClaude };
  let firstFail = null;
  const end = Date.now() + TOTAL_BUDGET_MS;
  const available = order.filter(prov => keys[prov]);
  for (let i = 0; i < available.length; i++) {
    const prov = available[i];
    // Plus assez de temps pour un essai utile → on renvoie l'échec précédent (pas de coupure Vercel).
    if (callTimeout({ end, cap: Infinity }) < MIN_CALL_MS) break;
    // Un autre moteur reste derrière → plafond par appel (30 s) ; sinon tout le temps restant.
    const budget = { end, cap: i < available.length - 1 ? CALL_CAP_MS : Infinity };
    // Moteur de SECOURS : on ne lui impose pas le modèle demandé pour un autre moteur.
    const p = prov === payload.provider || (prov === 'claude' && !payload.provider) ? payload : { ...payload, model: null };
    const out = await runners[prov](p, keys[prov], maxTokens, budget);
    if (out.status === 200) return res.status(200).json(out.json);
    if (!firstFail) firstFail = out;
  }
  if (firstFail) return res.status(firstFail.status || 500).json(firstFail.json);
  return res.status(500).json({ error: 'Aucun moteur IA configuré (GEMINI_API_KEY / MISTRAL_API_KEY dans Vercel).' });
}

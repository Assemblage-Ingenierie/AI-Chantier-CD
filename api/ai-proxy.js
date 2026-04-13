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
    headers: { "Content-Type": "application/json" }
  });
}

export default async function handler(request) {
  // Tout est dans un try/catch global pour garantir une réponse JSON même en cas d'exception inattendue
  try {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: "Non autorisé — token manquant" }, 401);
    }

    const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
    const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || "").trim();
    if (!supabaseUrl || !supabaseAnonKey) {
      return json({ error: "Config Supabase manquante (SUPABASE_URL / SUPABASE_ANON_KEY)" }, 500);
    }

    const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
    if (!anthropicKey) {
      return json({ error: "Clé Anthropic manquante (ANTHROPIC_API_KEY non configurée dans Vercel)" }, 500);
    }

    // Vérification du token Supabase
    let authCheck;
    try {
      authCheck = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { Authorization: authHeader, apikey: supabaseAnonKey },
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      return json({ error: `Impossible de vérifier la session Supabase : ${e.message}` }, 500);
    }
    if (!authCheck.ok) {
      return json({ error: "Session expirée ou invalide" }, 401);
    }

    const payload = await request.json();
    const model = ALLOWED_MODELS.includes(payload.model) ? payload.model : 'claude-haiku-4-5-20251001';
    const max_tokens = Math.min(Number(payload.max_tokens) || 1024, MAX_TOKENS_CAP);

    let upstream;
    try {
      upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({ model, max_tokens, system: payload.system, messages: payload.messages }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      return json({ error: `Impossible de joindre l'API Anthropic : ${e.message}` }, 500);
    }

    // Lire comme texte puis parser pour éviter les erreurs sur corps non-JSON
    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: `Réponse non-JSON de Anthropic : ${text.slice(0, 200)}` }; }

    return json(data, upstream.status);

  } catch (error) {
    return json({
      error: `Erreur inattendue : ${error instanceof Error ? error.message : String(error)}`
    }, 500);
  }
}

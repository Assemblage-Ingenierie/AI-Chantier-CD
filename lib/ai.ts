interface AIPayload {
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  max_tokens?: number
}

interface AIResponse {
  content: { type: string; text: string }[]
}

export async function callAI(payload: AIPayload): Promise<string> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: payload.max_tokens ?? 400,
      system: payload.system,
      messages: payload.messages,
    }),
  })
  if (!res.ok) throw new Error(`AI error ${res.status}`)
  const data: AIResponse = await res.json()
  return data.content?.[0]?.text ?? ''
}

export async function suggestObservation(observation: string): Promise<string> {
  return callAI({
    system: 'Expert MOE/BET batiment. Compte-rendu de visite chantier. Francais, concis, professionnel.',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Observation:\n\n${observation}\n\n1. 💬 Reformulation professionnelle (1-2 phrases)\n2. 🔧 Conseil technique si pertinent\nCommencer chaque partie par le symbole.`,
    }],
  })
}

export async function generateTableau(items: string): Promise<string> {
  return callAI({
    system: 'Expert MOE/BET batiment. Reponds UNIQUEMENT en JSON array. Pas de texte autour.',
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: `Observations de visite chantier :\n${items}\n\nGenere un tableau recapitulatif JSON avec UNIQUEMENT les observations urgentes et a planifier (pas les mineures).\nFormat strict : [{"urgence":"haute|moyenne|basse","locNom":"zone","desordre":"description courte 1 phrase","travaux":"action preconisee courte"}]\nSois succinct et professionnel. Max 15 mots par champ.`,
    }],
  })
}

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Projet } from './types'

let _client: SupabaseClient | null = null

async function getConfig(): Promise<{ url: string; key: string } | null> {
  try {
    const res = await fetch('/api/config')
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (_client) return _client
  const cfg = await getConfig()
  if (!cfg?.url || !cfg?.key) return null
  _client = createClient(cfg.url, cfg.key)
  return _client
}

// ---- Remote state ----
interface SlimPayload {
  payload: Projet[]
  blobs: Record<string, string>
}

export async function loadRemoteState(): Promise<SlimPayload | null> {
  try {
    const res = await fetch('/api/state')
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

export async function saveRemoteState(data: SlimPayload): Promise<void> {
  try {
    await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  } catch {}
}

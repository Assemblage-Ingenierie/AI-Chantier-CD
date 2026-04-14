import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  const url = (process.env.SUPABASE_URL ?? '').trim()
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '').trim()
  if (!url || !key) return null
  return createClient(url, key)
}

// Découpe un tableau en chunks de taille n
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

export async function GET() {
  const sb = getAdmin()
  if (!sb) return NextResponse.json({ error: 'No Supabase config' }, { status: 500 })
  try {
    const [stateRes, blobsRes] = await Promise.all([
      sb.from('app_state_store').select('payload').eq('id', 'default').single(),
      sb.from('app_blob_store').select('id,value'),
    ])
    const payload = stateRes.data?.payload ?? []
    const blobs: Record<string, string> = {}
    for (const row of blobsRes.data ?? []) blobs[row.id] = row.value
    return NextResponse.json({ payload, blobs })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const sb = getAdmin()
  if (!sb) return NextResponse.json({ error: 'No Supabase config' }, { status: 500 })
  try {
    const { payload, blobs } = await request.json()
    const now = new Date().toISOString()

    // 1. Sauvegarde état principal (rapide)
    const { error: stateErr } = await sb
      .from('app_state_store')
      .upsert({ id: 'default', payload, updated_at: now })
    if (stateErr) throw stateErr

    // 2. Sauvegarde blobs par batches de 10 en parallèle
    if (blobs && Object.keys(blobs).length > 0) {
      const rows = Object.entries(blobs as Record<string, string>)
        .map(([id, value]) => ({ id, value, updated_at: now }))

      const batches = chunk(rows, 10)
      const results = await Promise.allSettled(
        batches.map(batch => sb.from('app_blob_store').upsert(batch))
      )
      const failed = results.filter(r => r.status === 'rejected')
      if (failed.length > 0) {
        console.warn(`[state] ${failed.length}/${batches.length} blob batches failed`)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

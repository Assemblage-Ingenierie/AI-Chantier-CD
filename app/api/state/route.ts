import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  const url = (process.env.SUPABASE_URL ?? '').trim()
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '').trim()
  if (!url || !key) return null
  return createClient(url, key)
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
    await sb.from('app_state_store').upsert({ id: 'default', payload, updated_at: now })
    if (blobs && Object.keys(blobs).length > 0) {
      const rows = Object.entries(blobs).map(([id, value]) => ({ id, value, updated_at: now }))
      await sb.from('app_blob_store').upsert(rows)
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

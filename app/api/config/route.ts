import { NextResponse } from 'next/server'

export async function GET() {
  const url = (process.env.SUPABASE_URL ?? '').trim()
  const key = (process.env.SUPABASE_ANON_KEY ?? '').trim()
  if (!url || !key) {
    return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 })
  }
  return NextResponse.json({ url, key }, {
    headers: { 'Cache-Control': 'private, max-age=300' },
  })
}

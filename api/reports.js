var cleanEnv = function (value) {
  return (value || '').replace(/
|
|/g, '').trim();
};

var SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
var SUPABASE_KEY = cleanEnv(process.env.SUPABASE_ANON_KEY);
var REPORT_TABLE = 'report_history';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function supabaseHeaders(extra) {
  return Object.assign(
    { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' },
    extra || {}
  );
}

export default async function handler(request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return json({ error: 'Missing Supabase environment variables' }, 500);
  }

  // GET /api/reports            -> liste (sans snapshot)
  // GET /api/reports?id=xxx     -> rapport complet avec snapshot
  // GET /api/reports?chantier_id=xxx -> filtre par chantier
  if (request.method === 'GET') {
    try {
      var url = new URL(request.url);
      var id = url.searchParams.get('id');
      var chantierId = url.searchParams.get('chantier_id');

      if (id) {
        var single = await fetch(
          SUPABASE_URL + '/rest/v1/' + REPORT_TABLE + '?id=eq.' + encodeURIComponent(id) + '&select=*',
          { headers: supabaseHeaders(), signal: AbortSignal.timeout(8000) }
        );
        if (!single.ok) return json({ error: 'Failed to fetch report', detail: await single.text() }, single.status);
        var rows = await single.json();
        return json({ report: rows[0] || null });
      }

      var filter = chantierId ? '&chantier_id=eq.' + encodeURIComponent(chantierId) : '';
      var list = await fetch(
        SUPABASE_URL + '/rest/v1/' + REPORT_TABLE + '?order=published_at.desc&select=id,chantier_id,chantier_nom,published_at' + filter,
        { headers: supabaseHeaders(), signal: AbortSignal.timeout(8000) }
      );
      if (!list.ok) return json({ error: 'Failed to list reports', detail: await list.text() }, list.status);
      return json({ reports: await list.json() });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
    }
  }

  // POST /api/reports  -> publie un snapshot
  // Body: { chantier_id, chantier_nom, snapshot }
  if (request.method === 'POST') {
    try {
      var body = await request.json();
      if (!body.chantier_id || !body.chantier_nom || !body.snapshot) {
        return json({ error: 'Missing required fields: chantier_id, chantier_nom, snapshot' }, 400);
      }
      var insertRes = await fetch(SUPABASE_URL + '/rest/v1/' + REPORT_TABLE, {
        method: 'POST',
        headers: supabaseHeaders({ Prefer: 'return=representation' }),
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify([{
          chantier_id: body.chantier_id,
          chantier_nom: body.chantier_nom,
          snapshot: body.snapshot,
          published_at: new Date().toISOString()
        }])
      });
      if (!insertRes.ok) return json({ error: 'Failed to save report', detail: await insertRes.text() }, insertRes.status);
      var inserted = await insertRes.json();
      return json({ ok: true, report: inserted[0] });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: 'GET, POST' }
  });
}

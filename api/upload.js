var cleanEnv = function (v) { return (v || '').replace(/
|
|/g, '').trim(); };

var SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
var SUPABASE_KEY = cleanEnv(process.env.SUPABASE_ANON_KEY);
var BUCKET = 'rapports';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', Allow: 'POST' }
    });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return json({ error: 'Missing Supabase environment variables' }, 500);
  }

  try {
    var formData = await request.formData();
    var file = formData.get('file');
    var filename = formData.get('filename') || 'rapport.pdf';

    if (!file) return json({ error: 'Missing file field in form data' }, 400);

    // Nom de fichier unique : timestamp + nom original
    var now = new Date();
    var datePrefix = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
    var storagePath = datePrefix + '_' + now.getTime() + '_' + filename.replace(/[^a-zA-Z0-9._-]/g, '_');

    var arrayBuffer = await file.arrayBuffer();

    var uploadRes = await fetch(
      SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/' + storagePath,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/pdf',
          'x-upsert': 'false'
        },
        body: arrayBuffer,
        signal: AbortSignal.timeout(30000)
      }
    );

    if (!uploadRes.ok) {
      var errText = await uploadRes.text();
      return json({ error: 'Storage upload failed', detail: errText }, uploadRes.status);
    }

    var uploadData = await uploadRes.json();
    return json({ ok: true, path: storagePath, key: uploadData.Key || storagePath });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
}

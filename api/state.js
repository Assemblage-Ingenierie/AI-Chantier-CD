var SUPABASE_URL = process.env.SUPABASE_URL;
var SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
var STATE_TABLE = "app_state_store";
var BLOB_TABLE = "app_blob_store";
var STATE_ROW_ID = "default";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function supabaseHeaders(extra) {
  return Object.assign({
    apikey: SUPABASE_KEY,
    Authorization: "Bearer " + SUPABASE_KEY,
    "Content-Type": "application/json"
  }, extra || {});
}

export default async function handler(request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return json({
      error: "Missing Supabase environment variables"
    }, 500);
  }

  if (request.method === "GET") {
    try {
      var stateResponse = await fetch("".concat(SUPABASE_URL, "/rest/v1/").concat(STATE_TABLE, "?id=eq.").concat(STATE_ROW_ID, "&select=payload"), {
        headers: supabaseHeaders()
      });
      if (!stateResponse.ok) {
        return json({
          error: "Failed to load state"
        }, stateResponse.status);
      }
      var stateRows = await stateResponse.json();
      var blobResponse = await fetch("".concat(SUPABASE_URL, "/rest/v1/").concat(BLOB_TABLE, "?select=id,value"), {
        headers: supabaseHeaders()
      });
      if (!blobResponse.ok) {
        return json({
          error: "Failed to load blobs"
        }, blobResponse.status);
      }
      var blobRows = await blobResponse.json();
      var blobs = blobRows.reduce(function (acc, row) {
        acc[row.id] = row.value;
        return acc;
      }, {});
      return json({
        payload: stateRows[0] ? stateRows[0].payload : null,
        blobs: blobs
      });
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : "Unexpected error"
      }, 500);
    }
  }

  if (request.method === "POST") {
    try {
      var body = await request.json();
      var payload = Array.isArray(body.payload) ? body.payload : [];
      var blobs = body.blobs && typeof body.blobs === "object" ? body.blobs : {};
      var now = new Date().toISOString();
      var stateUpsert = await fetch("".concat(SUPABASE_URL, "/rest/v1/").concat(STATE_TABLE, "?on_conflict=id"), {
        method: "POST",
        headers: supabaseHeaders({
          Prefer: "resolution=merge-duplicates,return=minimal"
        }),
        body: JSON.stringify([{
          id: STATE_ROW_ID,
          payload: payload,
          updated_at: now
        }])
      });
      if (!stateUpsert.ok) {
        return json({
          error: "Failed to save state"
        }, stateUpsert.status);
      }
      var blobRows = Object.keys(blobs).map(function (id) {
        return {
          id: id,
          value: blobs[id],
          updated_at: now
        };
      });
      if (blobRows.length > 0) {
        var blobUpsert = await fetch("".concat(SUPABASE_URL, "/rest/v1/").concat(BLOB_TABLE, "?on_conflict=id"), {
          method: "POST",
          headers: supabaseHeaders({
            Prefer: "resolution=merge-duplicates,return=minimal"
          }),
          body: JSON.stringify(blobRows)
        });
        if (!blobUpsert.ok) {
          return json({
            error: "Failed to save blobs"
          }, blobUpsert.status);
        }
      }
      return json({
        ok: true
      });
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : "Unexpected error"
      }, 500);
    }
  }

  return new Response(JSON.stringify({
    error: "Method not allowed"
  }), {
    status: 405,
    headers: {
      "Content-Type": "application/json",
      Allow: "GET, POST"
    }
  });
}

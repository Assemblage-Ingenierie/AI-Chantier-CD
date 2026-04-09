var cleanEnv = function cleanEnv(value) {
  return (value || "").replace(/\r\n|\n|\r/g, "").trim();
};

export default function handler(request) {
  var url = cleanEnv(process.env.SUPABASE_URL);
  var key = cleanEnv(process.env.SUPABASE_ANON_KEY);
  if (!url || !key) {
    return new Response(JSON.stringify({ error: "Missing Supabase config" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
  return new Response(JSON.stringify({ url: url, key: key }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, max-age=300"
    }
  });
}

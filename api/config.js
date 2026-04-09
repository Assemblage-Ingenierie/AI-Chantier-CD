export default function handler(req, res) {
  var url = (process.env.SUPABASE_URL || "").replace(/\r\n|\n|\r/g, "").trim();
  var key = (process.env.SUPABASE_ANON_KEY || "").replace(/\r\n|\n|\r/g, "").trim();
  if (!url || !key) {
    return res.status(500).json({ error: "Missing Supabase config" });
  }
  res.setHeader("Cache-Control", "private, max-age=300");
  res.status(200).json({ url: url, key: key });
}

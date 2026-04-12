// NOTE : Ce endpoint n'est plus utilisé par le frontend depuis la migration
// vers les tables normalisées (chantiers, chantier_plans, chantier_localisations,
// localisation_items, item_photos). Le frontend écrit directement dans Supabase
// via le client JS (src/lib/storage.js + src/supabase.js).
// Ce fichier est conservé pour référence et compatibilité ascendante.

var cleanEnv = function cleanEnv(value) {
  return (value || "").replace(/\\r\\n|\\n|\\r/g, "").trim();
};
var SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
var SUPABASE_KEY = cleanEnv(process.env.SUPABASE_ANON_KEY);

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

// Helper : charge toutes les tables normalisées et reconstruit la structure projet
async function loadNormalized() {
  var base = SUPABASE_URL + "/rest/v1/";
  var opts  = { headers: supabaseHeaders(), signal: AbortSignal.timeout(8000) };

  var [r1, r2, r3, r4, r5] = await Promise.all([
    fetch(base + "chantiers?select=*", opts),
    fetch(base + "chantier_plans?select=id,chantier_id,nom,bg,data,sort_order&order=sort_order", opts),
    fetch(base + "chantier_localisations?select=id,chantier_id,nom,plan_bg,plan_data,plan_annotations,sort_order&order=sort_order", opts),
    fetch(base + "localisation_items?select=id,localisation_id,titre,suivi,urgence,commentaire,plan_annotations,sort_order&order=sort_order", opts),
    fetch(base + "item_photos?select=id,item_id,name,data,sort_order&order=sort_order", opts),
  ]);

  if (!r1.ok) throw new Error("chantiers: " + await r1.text());
  if (!r2.ok) throw new Error("chantier_plans: " + await r2.text());
  if (!r3.ok) throw new Error("chantier_localisations: " + await r3.text());
  if (!r4.ok) throw new Error("localisation_items: " + await r4.text());
  if (!r5.ok) throw new Error("item_photos: " + await r5.text());

  var chantiers = await r1.json();
  var plans     = await r2.json();
  var locs      = await r3.json();
  var items     = await r4.json();
  var photos    = await r5.json();

  function groupBy(arr, key) {
    return arr.reduce(function(acc, row) {
      var k = row[key];
      if (!acc[k]) acc[k] = [];
      acc[k].push(row);
      return acc;
    }, {});
  }

  function tryParse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

  var plansByChantier = groupBy(plans, "chantier_id");
  var locsByChantier  = groupBy(locs,  "chantier_id");
  var itemsByLoc      = groupBy(items, "localisation_id");
  var photosByItem    = groupBy(photos, "item_id");

  return chantiers.map(function(c) {
    return {
      id:            c.id,
      nom:           c.nom || "",
      statut:        c.statut || "en_cours",
      adresse:       c.adresse || "",
      maitreOuvrage: c.maitre_ouvrage || "",
      photo:         c.photo || null,
      photosParLigne: c.photos_par_ligne || 2,
      participants:  c.participants || [],
      tableauRecap:  c.tableau_recap || [],
      updatedAt:     c.updated_at,
      planLibrary: (plansByChantier[c.id] || []).map(function(pl) {
        return { id: pl.id, nom: pl.nom || "", bg: pl.bg || null, data: pl.data || null };
      }),
      localisations: (locsByChantier[c.id] || []).map(function(loc) {
        return {
          id:              loc.id,
          nom:             loc.nom || "",
          planBg:          loc.plan_bg || null,
          planData:        loc.plan_data || null,
          planAnnotations: tryParse(loc.plan_annotations),
          items: (itemsByLoc[loc.id] || []).map(function(item) {
            return {
              id:              item.id,
              titre:           item.titre || "",
              suivi:           item.suivi || "rien",
              urgence:         item.urgence || "basse",
              commentaire:     item.commentaire || "",
              planAnnotations: tryParse(item.plan_annotations),
              photos: (photosByItem[item.id] || []).map(function(ph) {
                return { name: ph.name || "", data: ph.data || "" };
              }),
            };
          }),
        };
      }),
    };
  });
}

export default async function handler(request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return json({ error: "Missing Supabase environment variables" }, 500);
  }

  if (request.method === "GET") {
    try {
      var payload = await loadNormalized();
      return json({ payload: payload, blobs: {} });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
    }
  }

  // POST : plus utilisé — le frontend écrit directement dans Supabase
  if (request.method === "POST") {
    return json({ error: "Ce endpoint est déprécié. Écriture directe dans Supabase requise." }, 410);
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json", Allow: "GET" }
  });
}

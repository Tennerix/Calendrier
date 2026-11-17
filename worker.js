// Cloudflare Worker : sert la page (dossier public/) et l'API /api/tournois (stockage dans KV).
// Lecture publique ; écriture réservée à qui envoie le bon code organisateur.
// Variables à créer dans Cloudflare :
//   - liaison KV nommée CALENDRIER (déclarée dans wrangler.jsonc)
//   - secret ORGA_CODE (le code organisateur, créé dans le tableau de bord)

const GENRES = ["Hommes", "Femmes", "Mixte", "Jeune"];
const AGES = ["Senior", "+45", "U18", "U14"];
const LIGUES = ["", "PDL", "Autre"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const rep = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function memeTexte(a, b) {
  let ecart = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) ecart |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return ecart === 0;
}
function autorise(request, env) {
  let code = "";
  try { code = decodeURIComponent(request.headers.get("x-code") || ""); } catch { return false; }
  return Boolean(env.ORGA_CODE) && code.length > 0 && memeTexte(code, String(env.ORGA_CODE));
}
async function lire(env) {
  return (await env.CALENDRIER.get("data", "json")) || { v: 0, items: [] };
}
async function ecrire(env, items) {
  const d = { v: Date.now(), items };
  await env.CALENDRIER.put("data", JSON.stringify(d));
  return d;
}
function valider(t) {
  if (!t || typeof t !== "object") return null;
  const okId = typeof t.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(t.id);
  const okNom = typeof t.nom === "string" && t.nom.trim().length > 0 && t.nom.length <= 120;
  const okDates = ISO.test(t.debut) && ISO.test(t.fin) && t.fin >= t.debut;
  const okCats = Array.isArray(t.cats) && t.cats.length > 0 && t.cats.every((c) => GENRES.includes(c));
  const okAges = Array.isArray(t.ages) && t.ages.every((a) => AGES.includes(a));
  const okLigue = LIGUES.includes(t.ligue || "");
  const okLieu = t.lieu === undefined || (typeof t.lieu === "string" && t.lieu.length <= 120);
  const okImg = t.img === undefined || (typeof t.img === "string" && t.img.length <= 400000 && (t.img === "" || t.img.startsWith("data:image/")));
  if (!(okId && okNom && okDates && okCats && okAges && okLigue && okLieu && okImg)) return null;
  return { id: t.id, nom: t.nom.trim(), cats: t.cats, ages: t.ages, ligue: t.ligue || "", debut: t.debut, fin: t.fin, lieu: (t.lieu || "").trim(), img: t.img || "" };
}

async function onRequestGet({ request, env }) {
  const d = await lire(env);
  if (new URL(request.url).searchParams.get("v")) return rep({ v: d.v });
  return rep(d);
}

async function onRequestPost({ request, env }) {
  if (!autorise(request, env)) return rep({ erreur: "code" }, 401);
  let corps;
  try { corps = await request.json(); } catch { return rep({ erreur: "json" }, 400); }
  if (corps.action === "verif") return rep({ ok: true });
  if (corps.action !== "save") return rep({ erreur: "action" }, 400);
  const t = valider(corps.item);
  if (!t) return rep({ erreur: "donnees" }, 400);
  const d = await lire(env);
  const items = d.items.filter((x) => x.id !== t.id);
  if (items.length >= 2000) return rep({ erreur: "plein" }, 400);
  items.push(t);
  const n = await ecrire(env, items);
  return rep({ v: n.v });
}

async function onRequestDelete({ request, env }) {
  if (!autorise(request, env)) return rep({ erreur: "code" }, 401);
  let corps;
  try { corps = await request.json(); } catch { return rep({ erreur: "json" }, 400); }
  if (typeof corps.id !== "string") return rep({ erreur: "id" }, 400);
  const d = await lire(env);
  const n = await ecrire(env, d.items.filter((x) => x.id !== corps.id));
  return rep({ v: n.v });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/tournois") {
      if (request.method === "GET") return onRequestGet({ request, env });
      if (request.method === "POST") return onRequestPost({ request, env });
      if (request.method === "DELETE") return onRequestDelete({ request, env });
      return rep({ erreur: "methode" }, 405);
    }
    return env.ASSETS.fetch(request);
  },
};

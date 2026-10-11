// FirmsFinder AI — cautare.js v1.1 · 2026-10-11
// Completează site-ul lipsă per CUI: coadă (cele mai mari firme întâi) → căutare web DataForSEO
// → validare prin CUI/denumire afișate pe site → scriere în firme_site (aceeași tabelă ca FirmsFinderBot).
// Rulează din cron-ul existent. Nu cere nimic local.
import { ia, verificaSite, salveaza, DIRECTOARE, PARCAT, textDin, fara } from "./site.js";

const DFS = "https://api.dataforseo.com/v3/serp/google/organic";
const UMPLE = 5000;      // câte firme intră în coadă la o rulare
const TRIMITE = 100;     // taskuri trimise la DataForSEO per rulare (max 100 per request)
const COLECTEAZA = 4;    // rezultate procesate per rulare (limită de cereri pe invocare)
const MAX_ZI_IMPLICIT = 5000; // plafon taskuri/zi (≈ 3 USD/zi la 0,0006 USD/task); se schimbă din config 'dfs_max_zi'

const cfg = async (env, k) => (await env.DB.prepare("SELECT valoare FROM config WHERE cheie=?").bind(k).first())?.valoare ?? null;
const setCfg = (env, k, v) => env.DB.prepare("INSERT OR REPLACE INTO config (cheie, valoare) VALUES (?, ?)").bind(k, String(v)).run();

async function dfs(env, cale, corp) {
  const r = await fetch(DFS + cale, {
    method: corp ? "POST" : "GET",
    headers: { authorization: "Basic " + env.DFS_AUTH, "content-type": "application/json" },
    body: corp ? JSON.stringify(corp) : undefined
  });
  return r.json();
}

async function pregateste(env) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS cautare_coada (cui INTEGER PRIMARY KEY, ca REAL, stare INTEGER NOT NULL DEFAULT 0, task_id TEXT, data TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS ix_coada ON cautare_coada(stare, ca DESC)")
  ]);
}

// stare: 0 = de trimis · 1 = trimis la DataForSEO · 2 = gata · 3 = eroare
async function umple(env) {
  if ((await cfg(env, "coada_gata")) === "1") return;
  const asteapta = await env.DB.prepare("SELECT COUNT(*) AS n FROM cautare_coada WHERE stare = 0").first();
  if (asteapta && asteapta.n > 2000) return;
  const cur = Number(await cfg(env, "coada_cursor")) || 9e15;
  const r = await env.DB.prepare(`SELECT m.cui, m.cifra_afaceri AS ca
    FROM mf_bilant_2024 m INDEXED BY ix_mf_2024_ca CROSS JOIN firme_site s ON s.cui = m.cui
    WHERE m.cifra_afaceri > 0 AND m.cifra_afaceri <= ? AND s.verificat = 0 AND s.metoda = 'negasit'
      AND NOT EXISTS (SELECT 1 FROM cautare_coada q WHERE q.cui = m.cui)
    ORDER BY m.cifra_afaceri DESC LIMIT ?`).bind(cur, UMPLE).all();
  if (!r.results.length) return setCfg(env, "coada_gata", "1");
  for (let i = 0; i < r.results.length; i += 500)
    await env.DB.batch(r.results.slice(i, i + 500).map((x) =>
      env.DB.prepare("INSERT OR IGNORE INTO cautare_coada (cui, ca) VALUES (?, ?)").bind(x.cui, x.ca)));
  await setCfg(env, "coada_cursor", r.results[r.results.length - 1].ca);
}

async function trimite(env) {
  await env.DB.prepare("UPDATE cautare_coada SET stare = 0 WHERE stare = 1 AND data < datetime('now','-3 hours')").run();
  const azi = new Date().toISOString().slice(0, 10);
  const [zi, n0] = ((await cfg(env, "dfs_zi")) || "").split(":");
  const folosite = zi === azi ? Number(n0) : 0;
  const max = Number(await cfg(env, "dfs_max_zi")) || MAX_ZI_IMPLICIT;
  const loc = Math.min(TRIMITE, max - folosite);
  if (loc <= 0) return;
  const q = await env.DB.prepare("SELECT cui FROM cautare_coada WHERE stare = 0 ORDER BY ca DESC LIMIT ?").bind(loc).all();
  if (!q.results.length) return;
  const rez = await env.DB.batch(q.results.map((x) =>
    env.DB.prepare("SELECT cui, denumire, localitate, top FROM onrc_firme WHERE cui = ? LIMIT 1").bind(x.cui)));
  const r = { results: rez.map((z) => z.results[0]).filter((x) => x && x.top === 1) };
  const buni = new Set(r.results.map((x) => x.cui));
  const rai = q.results.filter((x) => !buni.has(x.cui));
  for (let i = 0; i < rai.length; i += 500)
    await env.DB.batch(rai.slice(i, i + 500).map((x) => env.DB.prepare("UPDATE cautare_coada SET stare = 3 WHERE cui = ?").bind(x.cui)));
  if (!r.results.length) return;
  const taskuri = r.results.map((x) => ({
    keyword: '"' + x.denumire.replace(/"/g, "") + '" ' + (x.localitate || "").replace(/^(Municipiul|Oraş|Oras|Comuna)\s+/i, ""),
    location_code: 2642, language_code: "ro", depth: 10, tag: String(x.cui)
  }));
  let j;
  try { j = await dfs(env, "/task_post", taskuri); }
  catch (e) { return setCfg(env, "dfs_eroare", "exceptie: " + String(e).slice(0, 250)); }
  const ok = (j.tasks || []).filter((t) => t.status_code === 20100 && t.data?.tag);
  if (!ok.length) await setCfg(env, "dfs_eroare", JSON.stringify({ sc: j.status_code, sm: j.status_message, t: (j.tasks || []).slice(0, 2).map((t) => t.status_code + " " + t.status_message) }).slice(0, 400));
  for (let i = 0; i < ok.length; i += 500)
    await env.DB.batch(ok.slice(i, i + 500).map((t) =>
      env.DB.prepare("UPDATE cautare_coada SET stare = 1, task_id = ?, data = datetime('now') WHERE cui = ?").bind(t.id, Number(t.data.tag))));
  await setCfg(env, "dfs_zi", azi + ":" + (folosite + ok.length));
}

function domenii(items) {
  const vazute = new Set(), out = [];
  for (const it of items || []) {
    if (it.type !== "organic" || !it.url) continue;
    try {
      const h = new URL(it.url).hostname.replace(/^www\./, "");
      if (DIRECTOARE.test(h) || vazute.has(h)) continue;
      vazute.add(h); out.push(it.url);
    } catch {}
  }
  return out.slice(0, 3);
}

async function proceseazaRezultat(env, id, cui) {
  const j = await dfs(env, "/task_get/regular/" + id);
  const t = j.tasks?.[0];
  if (!t || t.status_code !== 20000) return env.DB.prepare("UPDATE cautare_coada SET stare = 3 WHERE cui = ?").bind(cui).run();
  const f = await env.DB.prepare("SELECT cui, denumire, localitate, judet FROM onrc_firme WHERE cui = ? LIMIT 1").bind(cui).first();
  if (!f) return env.DB.prepare("UPDATE cautare_coada SET stare = 3 WHERE cui = ?").bind(cui).run();
  const urls = domenii(t.result?.[0]?.items);
  const b = { n: 0 };
  const incercari = ["căutare DFS → " + (urls.length ? urls.length + " rezultate" : "niciun rezultat util")];
  let gasit = null;
  for (const u of urls) {
    if (gasit) break;
    const r = await ia(u, b, 5000);
    const d = new URL(u).hostname.replace(/^www\./, "");
    if (!r) { incercari.push("căutare " + d + " → nimic"); continue; }
    if (PARCAT.test(fara(textDin(r.html)))) { incercari.push("căutare " + d + " → domeniu parcat"); continue; }
    const v = await verificaSite(r, f, b, 3);
    if (v) {
      incercari.push("căutare " + d + " → GĂSIT (" + v + ")");
      gasit = { ...r, domeniu: d, nivel: v === "nume" ? 2 : 1, metoda: "dfs+" + v };
    } else incercari.push("căutare " + d + " → nu e firma");
  }
  await salveaza(env, f, gasit, incercari, b);
  await env.DB.prepare("UPDATE cautare_coada SET stare = 2 WHERE cui = ?").bind(cui).run();
  return !!gasit;
}

async function colecteaza(env) {
  const j = await dfs(env, "/tasks_ready");
  const gata = (j.tasks?.[0]?.result || []).filter((x) => x.tag && /^\d+$/.test(x.tag)).slice(0, COLECTEAZA);
  await Promise.all(gata.map(async (x) => {
    const q = await env.DB.prepare("SELECT cui FROM cautare_coada WHERE cui = ? AND stare = 1").bind(Number(x.tag)).first();
    if (q) await proceseazaRezultat(env, x.id, q.cui).catch(() => null);
  }));
}

async function ruleaza(env) {
  if (!env.DFS_AUTH) return;
  await pregateste(env);
  await umple(env).catch((e) => setCfg(env, "dfs_eroare", "umple: " + String(e).slice(0, 250)));
  await trimite(env).catch((e) => setCfg(env, "dfs_eroare", "trimite: " + String(e).slice(0, 250)));
  await colecteaza(env).catch((e) => setCfg(env, "dfs_eroare", "colecteaza: " + String(e).slice(0, 250)));
}

// Din cron: lansează căutarea într-o invocare separată (are propria limită de cereri).
export async function cronCautare(env) {
  if (!env.DFS_AUTH) return;
  const tok = await env.DB.prepare("SELECT valoare FROM config WHERE cheie='admin_token'").first();
  if (!tok) return;
  await fetch("https://1clic-ia.eu/admin/cautare?run=1&k=" + tok.valoare).catch(() => null);
}

// /admin/cautare?stat=1&k=TOKEN  → stare coadă, buget, rezultate
export async function cautareAdmin(url, env) {
  const tok = await env.DB.prepare("SELECT valoare FROM config WHERE cheie='admin_token'").first();
  if (!tok || url.searchParams.get("k") !== tok.valoare) return new Response("Acces interzis.", { status: 403 });
  if (url.searchParams.get("run") === "1") { await ruleaza(env); return Response.json({ ok: true }); }
  await pregateste(env);
  const coada = await env.DB.prepare("SELECT stare, COUNT(*) n FROM cautare_coada GROUP BY stare").all();
  const gasite = await env.DB.prepare("SELECT verificat, COUNT(*) n FROM firme_site WHERE metoda LIKE 'dfs+%' GROUP BY verificat").all();
  const nume = { 0: "de_trimis", 1: "trimis", 2: "gata", 3: "eroare" };
  return Response.json({
    coada: Object.fromEntries(coada.results.map((x) => [nume[x.stare] ?? x.stare, x.n])),
    gasite_prin_dfs: Object.fromEntries(gasite.results.map((x) => [{ 1: "confirmat", 2: "probabil" }[x.verificat] ?? x.verificat, x.n])),
    dfs_azi: await cfg(env, "dfs_zi"),
    plafon_zi: Number(await cfg(env, "dfs_max_zi")) || MAX_ZI_IMPLICIT,
    coada_completa: (await cfg(env, "coada_gata")) === "1",
    dfs_configurat: !!env.DFS_AUTH,
    ultima_eroare_dfs: await cfg(env, "dfs_eroare")
  });
}

// FirmsFinder AI — cautare.js v1.1 · 2026-10-11
// Completează site-ul lipsă per CUI: coadă (cele mai mari firme întâi) → căutare web DataForSEO
// → validare prin CUI/denumire afișate pe site → scriere în firme_site (aceeași tabelă ca FirmsFinderBot).
// Rulează din cron-ul existent. Nu cere nimic local.
import { verifica, ia, verificaSite, salveaza, DIRECTOARE, PARCAT, textDin, fara } from "./site.js";

const DFS = "https://api.dataforseo.com/v3/serp/google/organic";
const UMPLE = 5000;      // câte firme intră în coadă la o rulare
const TRIMITE = 100;     // taskuri trimise la DataForSEO per rulare (max 100 per request)
const COLECTEAZA = 1;    // rezultate procesate per rulare (limită de cereri pe invocare)
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

// portaluri/știri/directoare care apar la căutarea după denumire dar nu sunt site-ul firmei
const EXTRA = /zf\.ro|northdata|profit\.ro|seenews|economedia|bestjobs|ejobs|romjob|edemunca|publi24|undelucram|tradeatlas|jurnaluldeafaceri|transilvaniabusiness|emis\.com|wall-street|mediafax|hotnews|digi24|ziare|stirileprotv|bursa\.ro|business-review|capital\.ro|financiarul|revistabiz|forbes|glassdoor|indeed|jooble|lensa|trovit|wikimedia|wikidata|crunchbase|zoominfo|rocketreach|apollo\.io|dnb\.|kompass|europages|globaldatabase|company-?info|firma\.info|listafirme|mfinante|lege5|rnpm|pagini-?aur|infocamere|opencorporates|bizi\.|ceginformacio|ahkrumaenien|sw-umwelttechnik|gov\.ro|ro\.wikipedia|\.pdf$/i;

const LEGAL = /\b(s\.?r\.?l\.?|s\.?a\.?|s\.?c\.?|romania|româ?nia|international|group|holding|company|ltd|gmbh|d\.?e\.?|&)\b/gi;
function jeton(den) {
  const t = fara(String(den || "")).toLowerCase().replace(LEGAL, " ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((x) => x.length >= 4);
  return t[0] || null;
}

// citește paginile legale clasice (Termeni, Contact, GDPR...) chiar dacă meniul e încărcat cu JS
const CAI = ["/termeni-si-conditii", "/termeni-si-conditii/", "/termeni-conditii", "/termeni", "/contact", "/despre-noi", "/politica-de-confidentialitate", "/gdpr", "/impressum"];
async function verificaTermeni(r, f, b, cate) {
  let o; try { o = new URL(r.url).origin; } catch { return null; }
  const pg = await Promise.all(CAI.slice(0, cate).map((c) => ia(o + c, b, 4000).catch(() => null)));
  for (const x of pg) if (x && verifica(x.html, f.cui, f.denumire) === "cui") return "cui-termeni";
  return null;
}

function domenii(items) {
  const vazute = new Set(), out = [];
  for (const it of items || []) {
    if (it.type !== "organic" || !it.url) continue;
    try {
      const h = new URL(it.url).hostname.replace(/^www\./, "");
      if (DIRECTOARE.test(h) || EXTRA.test(h) || EXTRA.test(it.url) || vazute.has(h)) continue;
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
    let v = await verificaSite(r, f, b, 3);
    if (!v) v = await verificaTermeni(r, f, b, 6);
    if (!v) {
      const j = jeton(f.denumire), lab = d.split(".")[0];
      if (j && (lab === j || lab.startsWith(j) || j.startsWith(lab) && lab.length >= 4) && fara(textDin(r.html)).toLowerCase().includes(j)) v = "nume";
    }
    if (v) {
      incercari.push("căutare " + d + " → GĂSIT (" + v + ")");
      gasit = { ...r, domeniu: d, nivel: v === "nume" ? 2 : 1, metoda: "dfs+" + v };
    } else incercari.push("căutare " + d + " → nu e firma");
  }
  await salveaza(env, f, gasit, incercari, b);
  await env.DB.prepare("UPDATE cautare_coada SET stare = 2 WHERE cui = ?").bind(cui).run();
  return !!gasit;
}

async function colecteaza(env, k = 0, n = 1) {
  const j = await dfs(env, "/tasks_ready");
  const gata = (j.tasks?.[0]?.result || []).filter((x) => x.tag && /^\d+$/.test(x.tag)).filter((_, i) => i % n === k).slice(0, COLECTEAZA);
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
  await colecteaza(env, 0, 3).catch((e) => setCfg(env, "dfs_eroare", "colecteaza: " + String(e).slice(0, 250)));
}

// Din cron: lansează căutarea într-o invocare separată (are propria limită de cereri).
export async function cronCautare(env) {
  if (!env.DFS_AUTH) return;
  const tok = await env.DB.prepare("SELECT valoare FROM config WHERE cheie='admin_token'").first();
  if (!tok) return;
  const u = "https://1clic-ia.eu/admin/cautare?k=" + tok.valoare;
  await Promise.all([fetch(u + "&run=1"), fetch(u + "&col=1"), fetch(u + "&col=2")].map((p) => p.catch(() => null)));
}

// /admin/cautare?stat=1&k=TOKEN  → stare coadă, buget, rezultate
export async function cautareAdmin(url, env) {
  const tok = await env.DB.prepare("SELECT valoare FROM config WHERE cheie='admin_token'").first();
  if (!tok || url.searchParams.get("k") !== tok.valoare) return new Response("Acces interzis.", { status: 403 });
  const col = Number(url.searchParams.get("col"));
  if (col === 1 || col === 2) { await colecteaza(env, col, 3).catch((e) => setCfg(env, "dfs_eroare", "colecteaza" + col + ": " + String(e).slice(0, 200))); return Response.json({ ok: true }); }
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

// src/site.js — Crawler propriu v0.4 (2026-10-06): găsește site-ul unei firme, îl verifică după CUI/nume, extrage datele.
// GET /admin/site?cui=123&k=TOKEN[&fundal=1]  → o firmă: caută, verifică, salvează în D1 firme_site.
// GET /admin/site?stat=1&k=TOKEN              → statistici (confirmat / probabil / negăsit, căutări Brave azi).
// Cron (wrangler.toml [triggers], la fiecare minut) → cron(): 6 rulări × 12 firme ≈ 72 firme/minut ≈ 100.000/zi.
// Niveluri verificat: 1 = confirmat (CUI sau nume complet pe site), 2 = probabil (domeniu = numele exact + indicii), 0 = negăsit.
// Căutare web gratuită: Brave Search API (secret BRAVE_KEY), plafon BRAVE_ZI căutări/zi (5 $ credit gratuit/lună ≈ 1.000).

const FORME = /\b(S\.?\s?R\.?\s?L\.?|S\.?\s?A\.?|S\.?\s?C\.?\s?S\.?|S\.?\s?N\.?\s?C\.?|SRL-D|SRL|SA|PFA|II|IF|SOCIETATE|COMPANY|ROMANIA|ROMÂNIA)\b/gi;
const BRAVE_ZI = 30;      // 30 × 31 zile = 930 < 1.000 căutări gratuite/lună
const BUGET = 45;         // cereri externe per firmă (planul gratuit Workers permite 50/invocare)
const PARCAT = /domain (is )?for sale|domeniul (este )?de vanzare|cumpara (acest )?domeniu|buy this domain|parked (free|domain)|sedoparking|dan\.com|afternic|this domain (name )?(may be|is) for sale|hugedomains|domain parking/i;
const DIRECTOARE = /voloaga|targetare|e-firma|firmeonline|ro-firme|romaniafirme|firme-romania|registrulfirmelor|ghidulfirmelor|infocui|cui\.|catalog|anuar|director|listafirme|termene|risco|firme\.info|firmepenet|totalfirme|infofirme|romanian-companies|confidas|demoanaf|mfinante|onrc|facebook|linkedin|instagram|youtube|tiktok|twitter|x\.com|google\.|wikipedia|paginiaurii|cylex|infobel|tripadvisor|olx|anaf\.ro|portal\.just|europages|kompass|dnb\.com|opencorporates|companiesintheuk|firmeromania|lista-firme|topfirme|endole|bizbuysell/i;

// cuvinte-indiciu pe diviziuni CAEN (primele 2 cifre) — pentru nivelul „probabil”
const INDICII = [
  [[69, 69], /contab|fiscal|expert|audit|salariz|resurse umane|declarat|bilant|consultan/],
  [[70, 70], /consultan|management|strategi/],
  [[71, 71], /arhitect|proiect|inginer|topograf/],
  [[73, 73], /publicit|marketing|agenti|media/],
  [[62, 63], /software|aplicat|dezvolt|it |web|cloud|program/],
  [[41, 43], /construct|renovar|instalat|amenaj|constructii/],
  [[45, 47], /magazin|produse|vanzar|comert|distrib|livrare/],
  [[49, 53], /transport|logistic|curierat|marfa|expediti/],
  [[55, 56], /restaurant|hotel|cazare|pensiune|meniu|rezerv/],
  [[86, 88], /clinic|medic|cabinet|tratament|sanatat|stomatolog/],
  [[68, 68], /imobiliar|apartament|inchiriere|proprietat/],
  [[85, 85], /curs|scoala|gradinit|educat|formare/],
  [[10, 33], /productie|fabric|industri|produse/],
];

function curata(nume) {
  return nume.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(FORME, " ").replace(/[^A-Za-z0-9& ]+/g, " ")
    .replace(/&/g, " and ").replace(/\s+/g, " ").trim().toLowerCase();
}
const fara = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function cuvinte(denumire) { return curata(denumire).split(" ").filter(x => x && x !== "and"); }

export function candidati(denumire) {
  const w = cuvinte(denumire);
  if (!w.length) return [];
  const baze = new Set([w.join(""), w.join("-")]);
  if (w.length > 1) baze.add(w[0]);
  if (w.length > 2) { baze.add(w.slice(0, 2).join("")); baze.add(w.slice(0, 2).join("-")); }
  const out = [];
  for (const b of baze) if (b.length >= 3 && b.length <= 40) for (const tld of ["ro", "com", "eu"]) out.push(b + "." + tld);
  return out.slice(0, 12);
}

// fetch cu timeout + buget de cereri per firmă
async function ia(url, b, ms = 6000) {
  if (b.n >= BUGET) return null;
  b.n++;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { redirect: "follow", signal: ac.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; FirmsFinderBot/0.4; +https://1clic-ia.eu/legal/confidentialitate)", "accept": "text/html" } });
    const ct = r.headers.get("content-type") || "";
    if (!r.ok || !ct.includes("html")) return null;
    const html = (await r.text()).slice(0, 600000);
    return { url: r.url, html };
  } catch { return null; } finally { clearTimeout(t); }
}

function textDin(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

// catalog de firme: multe CUI-uri diferite pe aceeași pagină
function eCatalog(t) {
  const c = new Set((t.match(/\b(?:RO\s?)?\d{7,9}\b/g) || []).map(x => x.replace(/\D/g, "")));
  return c.size >= 6 || /cod fiscal|cui:/gi.test(t) && (t.match(/cod fiscal|cui:/gi) || []).length >= 6;
}

function verifica(html, cui, denumire) {
  const t = textDin(html);
  if (eCatalog(t)) return null;
  const cifre = t.replace(/\s/g, "");
  if (new RegExp("(RO)?" + cui + "(?!\\d)").test(cifre)) return "cui";
  const n = curata(denumire);
  const tn = curata(t);
  if (n.length >= 5 && n.includes(" ") && tn.includes(n)) return "nume";
  return null;
}

// „probabil”: domeniul = numele exact (nu doar primul cuvânt), site real (nu parcat), cu indicii de sector sau localitate
function probabil(r, domeniu, f) {
  const w = cuvinte(f.denumire);
  const baza = domeniu.replace(/^www\./, "").replace(/\.[a-z]+$/, "");
  if (!w.length || (baza !== w.join("") && baza !== w.join("-"))) return null;
  if (baza.replace(/-/g, "").length < 5) return null;
  const t = fara(textDin(r.html));
  if (PARCAT.test(t) || t.length < 400) return null;
  const div = Number(String(f.caen || "").slice(0, 2));
  const ind = INDICII.find(([[a, z]]) => div >= a && div <= z);
  const motive = [];
  if (ind && ind[1].test(t)) motive.push("sector");
  const loc = fara(f.localitate).replace(/^(municipiul|oras|orasul|comuna|sat)\s+/, "").split(/[ ,]/)[0];
  if (loc && loc.length >= 4 && t.includes(loc)) motive.push("localitate");
  if (/romania|\.ro\b|\+40|\b07\d{8}\b/.test(t)) motive.push("ro");
  return motive.length >= 2 || motive.includes("sector") ? "probabil(" + motive.join("+") + ")" : null;
}

function legaturiLegale(r) {
  const leg = [...r.html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => { try { return { u: new URL(m[1], r.url).href, t: (m[2] + " " + m[1]).toLowerCase() }; } catch { return null; } })
    .filter(x => x && x.u.startsWith(new URL(r.url).origin) && /contact|termen|terms|legal|confiden|privacy|gdpr|despre|about|impressum|date-firm|firma/.test(x.t));
  return [...new Map(leg.map(l => [l.u, l])).values()];
}

// verifică un site care răspunde: CUI/nume pe prima pagină, apoi CUI pe paginile de contact/legal
async function verificaSite(r, f, b, maxPag = 4) {
  let v = verifica(r.html, f.cui, f.denumire);
  if (v) return v;
  const pg = await Promise.all(legaturiLegale(r).slice(0, maxPag).map(l => ia(l.u, b, 5000)));
  for (const x of pg) if (x && verifica(x.html, f.cui, f.denumire) === "cui") return "cui-pagina";
  return null;
}

function extrage(html, baza) {
  const g = (re) => { const m = html.match(re); return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 300) : null; };
  const titlu = g(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descriere = g(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i) || g(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)/i);
  const emailuri = [...new Set((html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).filter(e => !/\.(png|jpg|svg|webp|gif)$/i.test(e) && !/example|sentry|wixpress|domain\.com/i.test(e)))].slice(0, 5);
  const telefoane = [...new Set((textDin(html).match(/(?:\+40|0040|\b0)[\s.-]?[237]\d{1,2}[\s.-]?\d{3}[\s.-]?\d{3,4}/g) || []).map(x => x.replace(/[\s.-]/g, "")))].slice(0, 5);
  const jsonld = (html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || []).map(s => s.replace(/<[^>]+>/g, "").trim()).join("\n").slice(0, 8000) || null;
  const linkuri = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => { try { return { u: new URL(m[1], baza).href, t: textDin(m[2]).toLowerCase() }; } catch { return null; } })
    .filter(x => x && x.u.startsWith(new URL(baza).origin) && /servic|despre|about|contact|oferta|activit|ce facem|solutii|produse/.test(x.t + " " + x.u.toLowerCase()));
  return { titlu, descriere, emailuri, telefoane, jsonld, linkuri: [...new Map(linkuri.map(l => [l.u, l])).values()].slice(0, 3) };
}

// contor zilnic Brave în D1 config (cheie brave_zi = "YYYY-MM-DD:n")
async function braveDisponibil(env) {
  if (!env.BRAVE_KEY) return false;
  const azi = new Date().toISOString().slice(0, 10);
  const r = await env.DB.prepare("SELECT valoare FROM config WHERE cheie='brave_zi'").first();
  const [zi, n] = (r?.valoare || "").split(":");
  return zi !== azi || Number(n) < BRAVE_ZI;
}
async function braveNumara(env) {
  const azi = new Date().toISOString().slice(0, 10);
  const r = await env.DB.prepare("SELECT valoare FROM config WHERE cheie='brave_zi'").first();
  const [zi, n] = (r?.valoare || "").split(":");
  const nou = azi + ":" + (zi === azi ? Number(n) + 1 : 1);
  await env.DB.prepare("INSERT OR REPLACE INTO config (cheie, valoare) VALUES ('brave_zi', ?)").bind(nou).run();
}

async function cautaBrave(f, env, b) {
  const loc = (f.localitate || "").replace(/^(Municipiul|Oraş|Oras|Comuna)\s+/i, "");
  const q = '"' + f.denumire.replace(/"/g, "") + '" ' + loc;
  if (b.n >= BUGET) return [];
  b.n++;
  await braveNumara(env);
  try {
    const r = await fetch("https://api.search.brave.com/res/v1/web/search?count=10&q=" + encodeURIComponent(q),
      { headers: { "accept": "application/json", "x-subscription-token": env.BRAVE_KEY } });
    if (!r.ok) return [{ eroare: "brave " + r.status + " " + (await r.text()).slice(0, 160) }];
    const j = await r.json();
    const vazute = new Set();
    return (j.web?.results || []).map(x => x.url).filter(u => {
      try { const h = new URL(u).hostname.replace(/^www\./, ""); if (DIRECTOARE.test(h) || vazute.has(h)) return false; vazute.add(h); return true; } catch { return false; }
    }).slice(0, 3);
  } catch (e) { return [{ eroare: "brave " + e.message }]; }
}

async function salveaza(env, f, gasit, incercari, b) {
  let rez = { cui: f.cui, denumire: f.denumire, gasit: !!gasit, incercari };
  if (gasit) {
    const e = extrage(gasit.html, gasit.url);
    const pagini = [];
    let text = textDin(gasit.html).slice(0, 1500);
    const sub = await Promise.all(e.linkuri.map(l => ia(l.u, b, 5000)));
    for (const r of sub) {
      if (!r) continue;
      const e2 = extrage(r.html, r.url);
      e.emailuri = [...new Set([...e.emailuri, ...e2.emailuri])].slice(0, 5);
      e.telefoane = [...new Set([...e.telefoane, ...e2.telefoane])].slice(0, 5);
      pagini.push(r.url);
      text += "\n---\n" + textDin(r.html).slice(0, 1200);
    }
    rez = { ...rez, nivel: gasit.nivel === 1 ? "confirmat" : "probabil", domeniu: gasit.domeniu, url: gasit.url, metoda: gasit.metoda, titlu: e.titlu, descriere: e.descriere, emailuri: e.emailuri, telefoane: e.telefoane, are_jsonld: !!e.jsonld, pagini };
    await env.DB.prepare(`INSERT OR REPLACE INTO firme_site (cui, denumire, domeniu, url, verificat, metoda, incercari, titlu, descriere, emailuri, telefoane, jsonld, pagini, text_scurt, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
      .bind(f.cui, f.denumire, gasit.domeniu, gasit.url, gasit.nivel, gasit.metoda, incercari.join("\n"), e.titlu, e.descriere, e.emailuri.join(", "), e.telefoane.join(", "), e.jsonld, pagini.join("\n"), text.slice(0, 6000)).run();
  } else {
    rez.nivel = "negasit";
    await env.DB.prepare(`INSERT OR REPLACE INTO firme_site (cui, denumire, verificat, metoda, incercari, data) VALUES (?, ?, 0, 'negasit', ?, datetime('now'))`)
      .bind(f.cui, f.denumire, incercari.join("\n")).run();
  }
  rez.cereri = b.n;
  return rez;
}

export async function proceseaza(cui, env, cuBrave = true) {
  const f = await env.DB.prepare(`SELECT o.cui, o.denumire, o.web, o.localitate, o.judet, m.caen_mf AS caen
    FROM onrc_firme o LEFT JOIN mf_bilant_2024 m ON m.cui = o.cui WHERE o.cui = ?`).bind(cui).first();
  if (!f) return { eroare: "CUI negăsit" };
  const b = { n: 0 };
  const incercari = [];
  const lista = [];
  if (f.web) lista.push(f.web.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, ""));
  lista.push(...candidati(f.denumire));
  const dom = [...new Set(lista)];
  let gasit = null, prob = null;

  // 1. ghicire domeniu: întâi fără www, apoi cu www doar unde nu a răspuns
  const r1 = await Promise.all(dom.map(d => ia("https://" + d, b, 5000)));
  const r2 = await Promise.all(dom.map((d, i) => r1[i] ? null : ia("https://www." + d, b, 5000)));
  for (let i = 0; i < dom.length && !gasit; i++) {
    const r = r1[i] || r2[i];
    const d = dom[i];
    if (!r) { incercari.push(d + " → nimic"); continue; }
    if (PARCAT.test(fara(textDin(r.html)))) { incercari.push(d + " → domeniu parcat"); continue; }
    const v = await verificaSite(r, f, b, 3);
    if (v) { incercari.push(d + " → GĂSIT (" + v + ")"); gasit = { ...r, domeniu: d, nivel: 1, metoda: (f.web && i === 0 ? "onrc+" : "ghicit+") + v }; break; }
    const p = probabil(r, d, f);
    if (p) { incercari.push(d + " → " + p); if (!prob) prob = { ...r, domeniu: d, nivel: 2, metoda: "ghicit+" + p }; continue; }
    incercari.push(d + " → răspunde, dar nu e firma");
  }

  // 2. căutare web gratuită (Brave), doar dacă ghicirea nu a confirmat nimic
  if (!gasit && cuBrave && await braveDisponibil(env)) {
    const urls = await cautaBrave(f, env, b);
    if (urls[0]?.eroare) incercari.push("căutare → " + urls[0].eroare);
    else incercari.push("căutare → " + (urls.length ? urls.length + " rezultate" : "niciun rezultat util"));
    for (const u of urls) {
      if (typeof u !== "string" || gasit) continue;
      const r = await ia(u, b, 5000);
      const d = new URL(u).hostname.replace(/^www\./, "");
      if (!r) { incercari.push("căutare " + d + " → nimic"); continue; }
      const v = await verificaSite(r, f, b, 3);
      if (v) { incercari.push("căutare " + d + " → GĂSIT (" + v + ")"); gasit = { ...r, domeniu: d, nivel: 1, metoda: "cautare+" + v }; }
      else incercari.push("căutare " + d + " → nu e firma");
    }
  } else if (!gasit) incercari.push(!env.BRAVE_KEY ? "căutare → fără BRAVE_KEY" : cuBrave ? "căutare → plafon zilnic atins" : "căutare → amânată (lot)");

  return salveaza(env, f, gasit || prob, incercari, b);
}

// lotul automat: rezervă n firme (rând verificat = -1 „în lucru”), apoi le procesează în paralel.
// Rezervarea (INSERT OR IGNORE) împiedică două rulări simultane să ia aceeași firmă.
export async function lot(env, n = 10, off = 0, cuBrave = true) {
  await env.DB.prepare("DELETE FROM firme_site WHERE verificat = -1 AND data < datetime('now', '-30 minutes')").run();
  let retry = null;
  if (cuBrave && await braveDisponibil(env)) {
    retry = await env.DB.prepare(`SELECT cui FROM firme_site WHERE verificat IN (0, 2)
      AND (incercari LIKE '%fără BRAVE_KEY%' OR incercari LIKE '%amânată (lot)%' OR incercari LIKE '%plafon zilnic%' OR incercari LIKE '%căutare → brave %') LIMIT 1`).first();
  }
  const r = await env.DB.prepare(`SELECT m.cui, o.denumire FROM mf_bilant_2024 m INDEXED BY ix_mf_2024_ca CROSS JOIN onrc_firme o ON o.cui = m.cui
    WHERE m.cifra_afaceri > 0 AND o.top = 1 AND NOT EXISTS (SELECT 1 FROM firme_site s WHERE s.cui = m.cui)
    ORDER BY m.cifra_afaceri DESC LIMIT ? OFFSET ?`).bind(n, off).all();
  const rez = r.results.length ? await env.DB.batch(r.results.map(x =>
    env.DB.prepare("INSERT OR IGNORE INTO firme_site (cui, denumire, verificat, metoda, data) VALUES (?, ?, -1, 'in-lucru', datetime('now'))").bind(x.cui, x.denumire))) : [];
  const ale = r.results.filter((x, i) => rez[i]?.meta?.changes === 1).map(x => x.cui);
  // doar o firmă pe rulare poate folosi Brave (contorul zilnic rămâne exact)
  const sarcini = ale.map((cui, i) => [cui, cuBrave && !retry && i === 0]);
  if (retry) sarcini.unshift([retry.cui, true]);
  const out = await Promise.all(sarcini.map(([cui, b]) => proceseaza(cui, env, b).catch(e => ({ cui, eroare: e.message }))));
  return { rezervate: ale.length, procesate: out.length, gasite: out.filter(x => x.gasit).length };
}

// cron: 8 rulări separate în paralel (fiecare are propriile 6 conexiuni simultane), câte 20 firme fiecare (~160/min) — 2026-10-07
export async function cron(env) {
  const tok = await env.DB.prepare("SELECT valoare FROM config WHERE cheie='admin_token'").first();
  const N = 20, R = 8;
  await Promise.all([...Array(R).keys()].map(i =>
    fetch(`https://1clic-ia.eu/admin/site?lot=${N}&off=${i * N}&brave=${i === 0 ? 1 : 0}&k=${tok.valoare}`).then(r => r.text()).catch(() => null)));
}

export async function site(url, env, ctx) {
  const p = url.searchParams;
  const tok = await env.DB.prepare("SELECT valoare FROM config WHERE cheie='admin_token'").first();
  if (!tok || p.get("k") !== tok.valoare) return new Response("Acces interzis.", { status: 403 });
  if (p.get("stat") === "1") {
    const s = await env.DB.prepare("SELECT verificat, COUNT(*) n FROM firme_site GROUP BY verificat").all();
    const bz = await env.DB.prepare("SELECT valoare FROM config WHERE cheie='brave_zi'").first();
    return Response.json({ niveluri: Object.fromEntries(s.results.map(x => [{ "-1": "in_lucru", 0: "negasit", 1: "confirmat", 2: "probabil" }[x.verificat] ?? x.verificat, x.n])), brave_azi: bz?.valoare || null, plafon_brave_zi: BRAVE_ZI, brave_configurat: !!env.BRAVE_KEY });
  }
  if (p.get("lot")) {
    const n = Math.min(20, Number(p.get("lot")) || 1);
    return Response.json(await lot(env, n, Math.min(200, Number(p.get("off")) || 0), p.get("brave") !== "0"));
  }
  const cui = Number(p.get("cui"));
  if (ctx && p.get("fundal") === "1") { ctx.waitUntil(proceseaza(cui, env)); return Response.json({ pornit: true, cui }); }
  const rez = await proceseaza(cui, env);
  return Response.json(rez, { status: rez.eroare ? 404 : 200 });
}

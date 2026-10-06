// src/worker.js — FirmsFinder AI v1.0 (2026-10-06)
// FirmsFinder AI — Descoperiți firmele pe care nu le știți: viitorii clienți.
// Cloudflare Worker: API peste D1 b2b-romania-db (ONRC + bilanțuri MF 2023–2025).
// Sursa datelor: ONRC / MF, data.gov.ro (OGL-ROU-1.0).

const PE_PAGINA = 25;
const MAX_PAGINI = 20;
const MAX_CSV = 500;
const STARI_CURATE = ["1048", "1112"]; // în funcțiune, fără alte mențiuni

const JUDETE = ["Alba","Arad","Argeș","Bacău","Bihor","Bistrița-Năsăud","Botoșani","Brașov","Brăila","București",
  "Buzău","Caraș-Severin","Călărași","Cluj","Constanța","Covasna","Dâmbovița","Dolj","Galați","Giurgiu","Gorj",
  "Harghita","Hunedoara","Ialomița","Iași","Ilfov","Maramureș","Mehedinți","Mureș","Neamț","Olt","Prahova",
  "Satu Mare","Sălaj","Sibiu","Suceava","Teleorman","Timiș","Tulcea","Vaslui","Vâlcea","Vrancea"];

// Worker: răspunde la /api/* și /robots.txt; pagina (public/index.html) e servită automat ca „asset”.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/caen") return await caen(url, env);
      if (url.pathname === "/api/stari") return await stari(env);
      if (url.pathname === "/api/cauta") return await cauta(url, env);
      if (url.pathname === "/api/opozitie" && request.method === "POST") return await opozitie(request, env);
      if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /api/\n", { headers: { "content-type": "text/plain" } });
      if (url.pathname.startsWith("/api/")) return json({ eroare: "Adresă necunoscută." }, 404);
    } catch (e) {
      return json({ eroare: "Eroare internă. Încercați din nou." }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};

function json(d, status = 200, extra = {}) {
  return new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } });
}
function html(s) {
  return new Response(s, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}
function intreg(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[.\s]/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function faraDiacritice(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Activități CAEN (versiunea 2008 = cea folosită în bilanțurile 2023–2024)
async function caen(url, env) {
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return json([]);
  if (/^\d{2,4}$/.test(q)) {
    const r = await env.DB.prepare("SELECT clasa, denumire FROM onrc_nom_caen WHERE versiune=2 AND clasa LIKE ?1 ORDER BY clasa LIMIT 15")
      .bind(q + "%").all();
    return json(r.results, 200, { "cache-control": "public, max-age=86400" });
  }
  const r = await env.DB.prepare("SELECT clasa, denumire FROM onrc_nom_caen WHERE versiune=2 AND clasa IS NOT NULL AND clasa<>''").all();
  const cuv = faraDiacritice(q).split(/\s+/).filter(Boolean);
  const gasite = r.results.filter(x => { const d = faraDiacritice(x.denumire || ""); return cuv.every(c => d.includes(c)); }).slice(0, 15);
  return json(gasite, 200, { "cache-control": "public, max-age=86400" });
}

async function stari(env) {
  const r = await env.DB.prepare("SELECT cod, denumire FROM onrc_nom_stare").all();
  const m = {};
  for (const x of r.results) m[x.cod] = x.denumire;
  return json(m, 200, { "cache-control": "public, max-age=86400" });
}

async function cauta(url, env) {
  const p = url.searchParams;
  const cod = (p.get("caen") || "").trim();
  if (!/^\d{4}$/.test(cod)) return json({ eroare: "Alegeți o activitate (cod CAEN din 4 cifre)." }, 400);

  const conditii = ["b.caen_mf = ?"], valori = [cod];
  const judet = (p.get("judet") || "").trim();
  if (judet) {
    if (!JUDETE.includes(judet)) return json({ eroare: "Județ necunoscut." }, 400);
    conditii.push("f.judet = ?"); valori.push(judet);
  }
  const loc = (p.get("loc") || "").trim().slice(0, 60);
  if (loc) { conditii.push("f.localitate LIKE ?"); valori.push("%" + loc + "%"); }
  const smin = intreg(p.get("smin")), smax = intreg(p.get("smax"));
  if (smin !== null) { conditii.push("b.salariati >= ?"); valori.push(smin); }
  if (smax !== null) { conditii.push("b.salariati <= ?"); valori.push(smax); }
  const cmin = intreg(p.get("cmin")), cmax = intreg(p.get("cmax"));
  if (cmin !== null) { conditii.push("b.cifra_afaceri >= ?"); valori.push(cmin); }
  if (cmax !== null) { conditii.push("b.cifra_afaceri <= ?"); valori.push(cmax); }
  const trend = p.get("trend");
  if (trend === "up") conditii.push("a.cifra_afaceri > 0 AND b.cifra_afaceri > a.cifra_afaceri AND (c.cifra_afaceri IS NULL OR c.cifra_afaceri >= b.cifra_afaceri)");
  if (trend === "down") conditii.push("a.cifra_afaceri > 0 AND b.cifra_afaceri < a.cifra_afaceri AND (c.cifra_afaceri IS NULL OR c.cifra_afaceri <= b.cifra_afaceri)");
  if (p.get("risc") === "1") conditii.push(`f.coduri_stare IN (${STARI_CURATE.map(() => "?").join(",")})`), valori.push(...STARI_CURATE);
  conditii.push("b.cui NOT IN (SELECT cui FROM onrc_excluderi WHERE cui IS NOT NULL)");

  const ORDINI = {
    ca: "b.cifra_afaceri DESC",
    sal: "b.salariati DESC, b.cifra_afaceri DESC",
    crestere: "(COALESCE(c.cifra_afaceri, b.cifra_afaceri) * 1.0 / NULLIF(a.cifra_afaceri, 0)) DESC NULLS LAST",
    profit: "b.profit_net DESC",
    nou: "f.data_inmatriculare DESC",
  };
  const ordine = ORDINI[p.get("sort")] || ORDINI.ca;
  // La ordonarea după creștere ignorăm firmele foarte mici în 2023 (altfel 3.600 → 250.000 lei apare „+6.900%”).
  if (p.get("sort") === "crestere") { conditii.push("a.cifra_afaceri >= ?"); valori.push(100000); }
  // CROSS JOIN = pornește de la bilanțurile activității (index caen_mf), apoi caută firma după CUI. Rapid (<0,1 s).
  const DIN = `FROM mf_bilant_2024 b CROSS JOIN onrc_firme f ON f.cui = b.cui
    LEFT JOIN mf_bilant_2023 a ON a.cui = b.cui
    LEFT JOIN mf_bilant_2025 c ON c.cui = b.cui
    WHERE ${conditii.join(" AND ")}`;

  const csv = p.get("format") === "csv";
  const pagina = Math.min(Math.max(intreg(p.get("pag")) || 1, 1), MAX_PAGINI);
  const limita = csv ? MAX_CSV : PE_PAGINA;
  const offset = csv ? 0 : (pagina - 1) * PE_PAGINA;

  const sql = `SELECT f.cui, f.denumire, f.forma_juridica, f.judet, f.localitate, f.data_inmatriculare, f.coduri_stare, f.web,
      a.cifra_afaceri AS ca_2023, b.cifra_afaceri AS ca_2024, c.cifra_afaceri AS ca_2025,
      a.salariati AS sal_2023, b.salariati AS sal_2024, c.salariati AS sal_2025,
      b.profit_net AS profit_2024, b.pierdere_neta AS pierdere_2024
    ${DIN} ORDER BY ${ordine} LIMIT ${limita} OFFSET ${offset}`;

  const [rez, tot] = await Promise.all([
    env.DB.prepare(sql).bind(...valori).all(),
    csv ? Promise.resolve(null) : env.DB.prepare(`SELECT COUNT(*) AS n ${DIN}`).bind(...valori).first(),
  ]);

  if (csv) {
    const cap = ["CUI","Denumire","Forma","Judet","Localitate","Inmatriculare","CA_2023","CA_2024","CA_2025","Salariati_2024","Salariati_2025","Profit_net_2024","Stare"];
    const linii = [cap.join(";")];
    for (const r of rez.results) {
      linii.push([r.cui, r.denumire, r.forma_juridica, r.judet, r.localitate, r.data_inmatriculare, r.ca_2023, r.ca_2024, r.ca_2025,
        r.sal_2024, r.sal_2025, r.profit_2024, r.coduri_stare]
        .map(v => { const s = v === null || v === undefined ? "" : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; })
        .join(";"));
    }
    linii.push("", "Sursa: ONRC / MF, data.gov.ro — FirmsFinder AI");
    return new Response("﻿" + linii.join("\r\n"), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="firmsfinder_${cod}.csv"` },
    });
  }
  return json({ total: tot ? tot.n : 0, pagina, pe_pagina: PE_PAGINA, rezultate: rez.results });
}


// Cerere de opoziție / ștergere (GDPR art. 17 și 21). Se înregistrează ca „noua”;
// excluderea efectivă (onrc_excluderi) se face după verificare, ca nimeni să nu poată scoate firma altcuiva.
async function opozitie(request, env) {
  let d;
  try { d = await request.json(); } catch { return json({ eroare: "Cerere invalidă." }, 400); }
  const t = (v, n) => String(v ?? "").trim().slice(0, n);
  const cui = t(d.cui, 12).replace(/^RO/i, "").replace(/\s/g, "");
  const nume = t(d.nume, 120), email = t(d.email, 160), calitate = t(d.calitate, 60), motiv = t(d.motiv, 1000);
  if (!/^\d{2,10}$/.test(cui)) return json({ eroare: "CUI invalid (doar cifre, fără RO)." }, 400);
  if (nume.length < 3) return json({ eroare: "Scrieți numele dumneavoastră." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ eroare: "Adresă de email invalidă." }, 400);
  if (!d.acord) return json({ eroare: "Bifați confirmarea." }, 400);
  const firma = await env.DB.prepare("SELECT denumire FROM onrc_firme WHERE cui = ? LIMIT 1").bind(Number(cui)).first();
  if (!firma) return json({ eroare: "Nu găsim acest CUI printre firmele active din bază." }, 404);
  const deja = await env.DB.prepare("SELECT COUNT(*) AS n FROM cereri_gdpr WHERE cui = ? AND email = ? AND data > datetime('now','-1 day')")
    .bind(Number(cui), email).first();
  if (deja && deja.n > 0) return json({ ok: true, denumire: firma.denumire, repetat: true });
  const ins = await env.DB.prepare("INSERT INTO cereri_gdpr (data, cui, denumire, nume, email, calitate, motiv) VALUES (datetime('now'), ?, ?, ?, ?, ?, ?)")
    .bind(Number(cui), firma.denumire, nume, email, calitate, motiv).run();
  const id = ins && ins.meta ? ins.meta.last_row_id : null;
  const stare = await emailCerere(env, { id, cui, denumire: firma.denumire, nume, email, calitate, motiv });
  if (id) await env.DB.prepare("UPDATE cereri_gdpr SET email_status = ? WHERE id = ?").bind(stare.slice(0, 500), id).run();
  return json({ ok: true, denumire: firma.denumire, nr: id, email_trimis: stare.startsWith("OK") });
}

// Trimite cererea pe email la contact@5thelement.ai prin Resend (secretul RESEND_API_KEY în setările Worker-ului).
async function emailCerere(env, c) {
  if (!env.RESEND_API_KEY) return "LIPSA RESEND_API_KEY";
  const text = [
    "Cerere nouă de opoziție / scoatere din FirmsFinder AI",
    "",
    "Nr. cerere: " + (c.id ?? "—"),
    "Firmă: " + c.denumire,
    "CUI: " + c.cui,
    "Solicitant: " + c.nume + " (" + (c.calitate || "—") + ")",
    "Email: " + c.email,
    "Mesaj: " + (c.motiv || "—"),
    "",
    "Cererea este salvată în D1 b2b-romania-db, tabelul cereri_gdpr, cu starea „noua”.",
    "După verificare, scrieți lui Claude: „aprobă cererea " + (c.id ?? "") + "” — firma iese din rezultate.",
    "Răspundeți direct la acest email ca să-i scrieți solicitantului.",
  ].join("\n");
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "authorization": "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.FROM_EMAIL || "FirmsFinder AI <no-reply@eu-ai-act-ready.eu>",
        to: [env.EMAIL_CERERI || "contact@5thelement.ai"],
        reply_to: c.email,
        subject: "FirmsFinder AI — cerere de opoziție nr. " + (c.id ?? "") + " — " + c.denumire + " (CUI " + c.cui + ")",
        text,
      }),
    });
    const corp = await r.text();
    return (r.ok ? "OK " : "EROARE " + r.status + " ") + corp;
  } catch (e) { return "EXCEPTIE " + String(e); }
}

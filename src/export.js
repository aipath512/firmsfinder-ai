// export.js — v1.0 (2026-10-12)
// GET /admin/export?k=TOKEN                → CSV: firme active cu site (confirmat / probabil / din ONRC) + CAEN
// GET /admin/export?k=TOKEN&toate=1        → CSV: TOATE firmele active (site gol unde nu există)
// Doar societăți (top = 1): PFA, II și IF sunt excluse (persoane fizice, date personale).
// Parametri: &n=20 (previzualizare, primele n rânduri) · &dupa=CUI (reia după un CUI) · &pagina=5000
// Delimitator „;” (Excel românesc), UTF-8 cu BOM. Datele sunt cele din D1; nimic nu e inventat:
//   site_confirmat = CUI-ul sau numele firmei apare pe pagină · site_probabil = doar numele seamănă
//   site_onrc = câmpul „web” din ONRC (doar dacă arată a domeniu).

const ANTET = ["cui", "denumire", "judet", "localitate", "caen", "site", "stare_site", "sursa_site"];

function celula(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function siteOnrc(web) {
  const w = String(web || "").trim();
  if (!w || /^[\d\s+().\-/]+$/.test(w) || !w.includes(".") || /\s/.test(w)) return "";
  return w.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

export async function exportCsv(url, env) {
  const tok = await env.DB.prepare("SELECT valoare FROM config WHERE cheie='admin_token'").first();
  if (!tok || url.searchParams.get("k") !== tok.valoare) return new Response("Acces interzis.", { status: 403 });

  const toate = url.searchParams.get("toate") === "1";
  const pagina = Math.min(10000, Math.max(100, Number(url.searchParams.get("pagina")) || 5000));
  const limitaRanduri = Number(url.searchParams.get("n")) > 0 ? Number(url.searchParams.get("n")) : Infinity;
  let cursor = Number(url.searchParams.get("dupa")) || 0;
  const MAX_PAGINI = 300; // sub limita de interogări D1 pe o singură cerere; pentru restul: &dupa=ULTIMUL_CUI

  const filtru = toate
    ? ""
    : `AND ((s.verificat IN (1, 2) AND s.url IS NOT NULL AND s.url <> '')
         OR (o.web LIKE '%.%' AND o.web NOT GLOB '[0-9]*' AND o.web NOT GLOB '+*'))`;
  const sql = `SELECT o.cui, o.denumire, o.judet, o.localitate, o.web, c.caen, s.url, s.verificat, s.metoda
    FROM onrc_firme o
    LEFT JOIN firme_site s ON s.cui = o.cui
    LEFT JOIN onrc_firma_caen c ON c.cod_inmatriculare = o.cod_inmatriculare
    WHERE o.cui > ? AND o.top = 1 ${filtru}
    ORDER BY o.cui LIMIT ?`;

  const enc = new TextEncoder();
  let trimise = 0;
  const corp = new ReadableStream({
    async start(c) {
      c.enqueue(enc.encode("﻿" + ANTET.join(";") + "\r\n"));
      try {
        for (let p = 0; p < MAX_PAGINI && trimise < limitaRanduri; p++) {
          const r = await env.DB.prepare(sql).bind(cursor, Math.min(pagina, limitaRanduri - trimise)).all();
          const rows = r.results;
          if (!rows.length) break;
          let buf = "";
          for (const x of rows) {
            const conf = x.verificat === 1 && x.url, prob = x.verificat === 2 && x.url;
            const onrc = siteOnrc(x.web);
            const site = conf ? x.url : prob ? x.url : onrc;
            const stare = conf ? "confirmat" : prob ? "probabil" : onrc ? "din_onrc" : "";
            const sursa = conf || prob ? x.metoda || "" : onrc ? "onrc" : "";
            buf += [x.cui, x.denumire, x.judet, x.localitate, x.caen, site, stare, sursa].map(celula).join(";") + "\r\n";
          }
          c.enqueue(enc.encode(buf));
          trimise += rows.length;
          cursor = rows[rows.length - 1].cui;
        }
      } catch (e) {
        c.enqueue(enc.encode("\r\n#EROARE;" + celula(String(e.message || e).slice(0, 200)) + ";ultimul_cui=" + cursor + "\r\n"));
      }
      c.close();
    },
  });

  const nume = `firme_caen_site_${toate ? "toate" : "cu-site"}_v1.0_2026-10-12.csv`;
  return new Response(corp, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${nume}"`,
      "cache-control": "no-store",
    },
  });
}

// FirmsFinder AI — maps.js v1.0 · 2026-10-12
// Test Google Maps (DataForSEO, mod live ≈ 0,002 USD/căutare): 100 de firme fără contact,
// 25 din fiecare clasă de salariați (50+, 10–49, 1–9, 0). Rezultatele intră în tabelul maps_test.
// Pornire: în config, maps_test = 'pornit'. Rulează o singură dată, din cron, doar dacă soldul DataForSEO > 0,5 USD.
import { sold, jeton } from "./cautare.js";

const URL_MAPS = "https://api.dataforseo.com/v3/serp/google/maps/live/advanced";
const CLASE = [["50+", 50, 1e9], ["10-49", 10, 49], ["1-9", 1, 9], ["0", 0, 0]];
const PE_CLASA = 25;

const cfg = async (env, k) => (await env.DB.prepare("SELECT valoare FROM config WHERE cheie=?").bind(k).first())?.valoare ?? null;
const setCfg = (env, k, v) => env.DB.prepare("INSERT OR REPLACE INTO config (cheie, valoare) VALUES (?, ?)").bind(k, String(v)).run();

async function esantion(env) {
  const out = [];
  for (const [clasa, min, max] of CLASE) {
    const r = await env.DB.prepare(`SELECT m.cui, o.denumire, o.localitate, ? AS clasa
      FROM mf_bilant_2024 m CROSS JOIN onrc_firme o ON o.cui = m.cui
      LEFT JOIN firme_site s ON s.cui = m.cui
      WHERE m.cifra_afaceri > 0 AND m.salariati BETWEEN ? AND ? AND o.top = 1 AND m.cui % 101 = 7
        AND COALESCE(s.emailuri, '') = '' AND COALESCE(s.telefoane, '') = ''
      LIMIT ?`).bind(clasa, min, max, PE_CLASA).all();
    out.push(...r.results);
  }
  return out;
}

async function cautaMaps(env, f) {
  // „Loc. Târgu Neamț, Oraș Târgu Neamț” → „Târgu Neamț”; „București Sectorul 3” → „București”
  const loc = (f.localitate || "").split(",")[0]
    .replace(/^(Municipiul|Oraşul|Orașul|Oraş|Oraș|Oras|Comuna|Loc\.|Sat|Satul)\s+/i, "")
    .replace(/\s+Sectorul\s+\d+$/i, "").trim();
  const r = await fetch(URL_MAPS, {
    method: "POST",
    headers: { authorization: "Basic " + env.DFS_AUTH, "content-type": "application/json" },
    body: JSON.stringify([{ keyword: f.denumire.replace(/"/g, "") + " " + loc, location_code: 2642, language_code: "ro", depth: 20 }])
  });
  const j = await r.json();
  const t = j.tasks?.[0];
  if (!t || t.status_code !== 20000) return { eroare: (t?.status_code || j.status_code) + " " + (t?.status_message || j.status_message) };
  const items = (t.result?.[0]?.items || []).filter((x) => x.type === "maps_search");
  const tok = jeton(f.denumire);
  const p = items.find((x) => tok && String(x.title || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(tok));
  return { rezultate: items.length, p };
}

export async function mapsTest(env) {
  if (!env.DFS_AUTH || (await cfg(env, "maps_test")) !== "pornit") return;
  const s = await sold(env, true);
  if (s === null || s < 0.5) return setCfg(env, "maps_test_stare", "aștept sold DataForSEO (acum " + s + " USD) · " + new Date().toISOString());
  await setCfg(env, "maps_test", "in_lucru");
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS maps_test (cui INTEGER PRIMARY KEY, denumire TEXT, clasa TEXT,
    gasit INTEGER, titlu TEXT, telefon TEXT, site TEXT, adresa TEXT, rezultate INTEGER, eroare TEXT, data TEXT)`).run();
  const firme = await esantion(env);
  for (let i = 0; i < firme.length; i += 10) {
    await Promise.all(firme.slice(i, i + 10).map(async (f) => {
      let r;
      try { r = await cautaMaps(env, f); } catch (e) { r = { eroare: String(e).slice(0, 200) }; }
      const p = r.p || {};
      await env.DB.prepare(`INSERT OR REPLACE INTO maps_test (cui, denumire, clasa, gasit, titlu, telefon, site, adresa, rezultate, eroare, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
        .bind(f.cui, f.denumire, f.clasa, r.p ? 1 : 0, p.title || null, p.phone || null, p.domain || p.url || null, p.address || null, r.rezultate ?? null, r.eroare || null).run();
    }));
  }
  await setCfg(env, "maps_test", "gata");
  await setCfg(env, "maps_test_stare", "gata: " + firme.length + " firme · " + new Date().toISOString());
}

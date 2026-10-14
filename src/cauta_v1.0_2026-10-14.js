// FirmsFinder AI — listă alfabetică /firme cu filtre și negație (NU / fără)
// Versiune v1.0 · 2026-10-14
// Se importă din src/worker.js:  import { cauta } from "./cauta_v1.0_2026-10-14.js";
// Rută în worker.js:  if (url.pathname === "/firme") return await cauta(url, env);
// Necesită indexul D1  ix_onrc_top_den ON onrc_firme(top, denumire_cautare, cui)  (creat la 14 oct 2026).

const VERSIUNE = "v1.0 · 2026-10-14";
const PE_PAGINA = 15;          // rezultate pe pagină
const MIN_LITERE = 3;          // minimum de litere pentru începutul denumirii
const MAX_CUVINTE_NU = 5;      // cuvinte excluse din denumire
const ACCENT = "#e36414";

const JUDETE = ["Alba","Arad","Argeș","Bacău","Bihor","Bistrița-Năsăud","Botoșani","Brașov","Brăila","București","Buzău","Caraș-Severin","Călărași","Cluj","Constanța","Covasna","Dâmbovița","Dolj","Galați","Giurgiu","Gorj","Harghita","Hunedoara","Ialomița","Iași","Ilfov","Maramureș","Mehedinți","Mureș","Neamț","Olt","Prahova","Satu Mare","Sălaj","Sibiu","Suceava","Teleorman","Timiș","Tulcea","Vaslui","Vâlcea","Vrancea"];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fara = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
// denumire_cautare din onrc_firme: MAJUSCULE fără diacritice
const normDen = (s) => fara(s).toUpperCase().replace(/[^A-Z0-9 .&-]+/g, " ").replace(/\s+/g, " ").trim();
// caen_nume.denumire_cautare: minuscule fără diacritice
const cuvinteCaen = (s) => fara(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w.length >= 3).slice(0, 5);

function numar(s) {
  const t = String(s ?? "").toLowerCase().replace(/\s+/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const m = t.match(/^(-?\d+(?:\.\d+)?)(k|mii|m|mil|milioane)?$/);
  if (!m) return null;
  const mult = !m[2] ? 1 : (m[2] === "k" || m[2] === "mii") ? 1e3 : 1e6;
  return Math.round(Number(m[1]) * mult);
}

// Condiție CAEN: cod numeric (prefix 1–4 cifre) sau cuvinte din numele activității
function condCaen(valoare, binds) {
  const v = String(valoare || "").trim();
  if (/^\d{1,4}$/.test(v)) { binds.push(v + "%"); return "fa.caen LIKE ?"; }
  const w = cuvinteCaen(v);
  if (!w.length) return null;
  w.forEach((x) => binds.push("%" + x + "%"));
  return "fa.caen IN (SELECT caen FROM caen_nume WHERE " + w.map(() => "denumire_cautare LIKE ?").join(" AND ") + ")";
}

export function construieste(p) {
  const q = normDen(p.q || "");
  const caen = String(p.caen || "").trim();
  const mesaje = [];
  const caenExact = /^\d{4}$/.test(caen);
  if (q.replace(/[^A-Z0-9]/g, "").length < MIN_LITERE && !caenExact) {
    return { eroare: `Introduceți cel puțin ${MIN_LITERE} litere din începutul denumirii (sau un cod CAEN de 4 cifre).` };
  }
  const binds = [];
  const w = ["o.top = 1", "o.cui NOT IN (SELECT cui FROM onrc_excluderi WHERE cui IS NOT NULL)"];

  if (q) { w.push("o.denumire_cautare >= ? AND o.denumire_cautare < ?"); binds.push(q, q + "~"); }
  const nu = normDen(p.nu || "").split(" ").filter((x) => x.length >= 2).slice(0, MAX_CUVINTE_NU);
  nu.forEach((x) => { w.push("o.denumire_cautare NOT LIKE ?"); binds.push("%" + x + "%"); });

  if (p.jud && JUDETE.includes(p.jud)) { w.push("o.judet = ?"); binds.push(p.jud); }
  if (p.nu_jud && JUDETE.includes(p.nu_jud)) { w.push("(o.judet IS NULL OR o.judet <> ?)"); binds.push(p.nu_jud); }

  if (caen) { const b = []; const c = condCaen(caen, b); if (c) { w.push(c); binds.push(...b); } else mesaje.push("Activitatea introdusă nu a putut fi folosită."); }
  if (p.nu_caen) { const b = []; const c = condCaen(p.nu_caen, b); if (c) { w.push("(fa.caen IS NULL OR NOT (" + c + "))"); binds.push(...b); } }

  const num = [["ca_min", "b.cifra_afaceri >= ?"], ["ca_max", "b.cifra_afaceri <= ?"], ["sal_min", "b.salariati >= ?"], ["sal_max", "b.salariati <= ?"]];
  for (const [k, cond] of num) {
    if (p[k] === undefined || p[k] === "") continue;
    const n = numar(p[k]);
    if (n === null) mesaje.push(`Valoarea „${p[k]}” nu este un număr.`); else { w.push(cond); binds.push(n); }
  }

  const m = String(p.dupa || "").match(/^(.*)\|(\d+)$/);
  if (m) { w.push("(o.denumire_cautare > ? OR (o.denumire_cautare = ? AND o.cui > ?))"); binds.push(m[1], m[1], Number(m[2])); }

  const sql = `SELECT o.cui, o.denumire, o.denumire_cautare, o.localitate, o.judet, fa.caen, fa.activitate, b.cifra_afaceri AS ca, b.salariati AS sal
FROM onrc_firme o
LEFT JOIN firma_activitate fa ON fa.cui = o.cui
LEFT JOIN mf_bilant_2024 b ON b.cui = o.cui
WHERE ${w.join("\n AND ")}
ORDER BY o.denumire_cautare, o.cui
LIMIT ${PE_PAGINA + 1}`;
  return { sql, binds, mesaje, q };
}

const compact = (n) => {
  if (n === null || n === undefined) return "—";
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (a >= 1e6) { const v = a / 1e6; return s + (v >= 10 ? Math.round(v) : v.toFixed(1).replace(".", ",")) + " mil. lei"; }
  if (a >= 1e3) return s + Math.round(a / 1e3) + " mii lei";
  return s + a + " lei";
};

function pagina({ p, rezultate, urmator, eroare, mesaje, ms }) {
  const opt = (sel) => `<option value="">—</option>` + JUDETE.map((j) => `<option${j === sel ? " selected" : ""}>${esc(j)}</option>`).join("");
  const v = (k) => esc(p[k] || "");
  const camp = (et, nume, extra = "", ph = "") => `<label>${et}<input name="${nume}" value="${v(nume)}" ${extra}${ph ? ` placeholder="${esc(ph)}"` : ""}></label>`;
  const qs = new URLSearchParams();
  for (const k of ["q", "nu", "jud", "nu_jud", "caen", "nu_caen", "ca_min", "ca_max", "sal_min", "sal_max"]) if (p[k]) qs.set(k, p[k]);
  const ultim = rezultate[rezultate.length - 1];
  const linkUrm = urmator && ultim ? "/firme?" + qs.toString() + "&dupa=" + encodeURIComponent(ultim.denumire_cautare + "|" + ultim.cui) : "";
  const linii = rezultate.map((r) => `<tr><td><a href="/firma/${r.cui}">${esc(r.denumire)}</a><div class="m">CUI ${r.cui}</div></td><td>${esc(r.localitate || "")}${r.localitate && r.judet ? ", " : ""}${esc(r.judet || "")}</td><td>${r.caen ? esc(r.caen) + " · " + esc(r.activitate || "") : '<span class="m">—</span>'}</td><td class="n">${compact(r.ca)}</td></tr>`).join("");
  const corp = `<h1>Căutare firme</h1>
<p class="sub">Firme în ordine alfabetică, ${PE_PAGINA} pe pagină. Persoanele fizice autorizate (PFA, II, IF) și firmele scoase din bază nu apar în listă.</p>
<form class="c" method="get" action="/firme">
<div class="f">${camp("Începe cu (minimum 3 litere)", "q", 'required minlength="3" autofocus autocomplete="off"', "ex. TAX")}${camp("Dar NU conține (cuvinte)", "nu", "", "ex. HOLDING IMOBILIARE")}</div>
<div class="f"><label>Județ<select name="jud">${opt(p.jud)}</select></label><label>NU din județul<select name="nu_jud">${opt(p.nu_jud)}</select></label></div>
<div class="f">${camp("Activitate (cod CAEN sau cuvinte)", "caen", "", "ex. 6920 sau contabilitate")}${camp("NU activitatea", "nu_caen", "", "ex. 68 sau imobiliare")}</div>
<div class="f">${camp("Cifra de afaceri 2024 de la", "ca_min", "", "ex. 1 mil")}${camp("până la", "ca_max", "", "ex. 10 mil")}${camp("Salariați de la", "sal_min", "", "ex. 5")}${camp("până la", "sal_max", "", "ex. 50")}</div>
<div class="bt"><button class="p" type="submit">Caută</button><a href="/firme">Resetare</a><button type="button" onclick="window.print()">Tipărește / Salvează PDF</button></div>
<p class="m">Căutarea ține cont de începutul denumirii, fără diacritice și indiferent de litere mari sau mici. Cifra de afaceri și salariații provin din bilanțul 2024; acceptă forme precum 500k sau 2 mil.</p>
</form>
${eroare ? `<div class="c bad">${esc(eroare)}</div>` : ""}
${(mesaje || []).map((m) => `<p class="m bad">${esc(m)}</p>`).join("")}
${!eroare ? (rezultate.length ? `<div class="c"><div class="t"><table><thead><tr><th>Firma</th><th>Localitate</th><th>Activitate</th><th class="n">Cifra de afaceri 2024</th></tr></thead><tbody>${linii}</tbody></table></div>
<p class="m">${rezultate.length} rezultate afișate · ${ms} ms${linkUrm ? "" : " · sfârșitul listei"}</p>
${linkUrm ? `<div class="bt"><a class="p" href="${esc(linkUrm)}">Următoarele ${PE_PAGINA} →</a></div>` : ""}</div>` : `<div class="c">Nicio firmă nu corespunde criteriilor.</div>`) : ""}`;
  return `<!doctype html>
<!-- FirmsFinder AI · /firme ${VERSIUNE} -->
<html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Căutare firme · FirmsFinder AI</title><meta name="robots" content="noindex,nofollow">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#f6f4ef;--card:#fff;--ink:#16202a;--muted:#5d6873;--line:#e2ddd2;--acc:${ACCENT};--bad:#b23a3a}
@media (prefers-color-scheme:dark){:root{--bg:#11161b;--card:#1a2128;--ink:#e8e4dc;--muted:#9aa4ad;--line:#2a333c;--bad:#ff8a8a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15.5px/1.6 Inter,system-ui,sans-serif}
.w{max-width:960px;margin:0 auto;padding:0 16px}
nav{display:flex;flex-wrap:wrap;gap:6px 16px;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--line)}
nav a{color:var(--ink);text-decoration:none;font-weight:500;font-size:14px}nav a.b{font-weight:600}nav .l a{margin-left:14px}
h1{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:clamp(26px,5vw,38px);margin:26px 0 6px}
.sub{color:var(--muted);margin:0 0 18px}.m{color:var(--muted);font-size:13.5px}.bad{color:var(--bad)}
.c{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:18px}
.f{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:12px}
label{display:block;font-size:13px;color:var(--muted)}
input,select{display:block;width:100%;margin-top:3px;font:16px Inter,system-ui,sans-serif;padding:9px 10px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink)}
.t{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}
td,th{border-bottom:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}
th{font-size:12.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}td.n,th.n{text-align:right;white-space:nowrap}
a{color:var(--acc)}
.bt{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}
.bt a,.bt button{font:600 14px Inter,system-ui,sans-serif;border:1px solid var(--acc);color:var(--acc);background:transparent;border-radius:9px;padding:9px 14px;text-decoration:none;cursor:pointer}
.bt .p{background:var(--acc);color:#fff}
footer{margin:28px 0;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
@media print{nav,form,.bt{display:none!important}body{background:#fff;color:#000}.c{border:0;padding:0}a{color:#000;text-decoration:none}}
</style></head><body><div class="w">
<nav><a class="b" href="/">← FirmsFinder AI</a><span class="l"><a href="/date">Datele din bază</a><a href="/legal/confidentialitate">Confidențialitate</a><a href="/cerere.html">Cerere de scoatere</a></span></nav>
${corp}
<footer>FirmsFinder AI · operator AiVenture S.R.L., CUI 51415878 · <a href="mailto:contact@5thelement.ai">contact@5thelement.ai</a> · pagină ${VERSIUNE}</footer>
</div></body></html>`;
}

export async function cauta(url, env) {
  const p = Object.fromEntries(url.searchParams.entries());
  const hdr = { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" };
  const gol = !url.search;
  const c = gol ? { eroare: "" } : construieste(p);
  if (c.eroare !== undefined && c.eroare !== "" ) return new Response(pagina({ p, rezultate: [], urmator: false, eroare: c.eroare, mesaje: [], ms: 0 }), { headers: hdr });
  if (gol) return new Response(pagina({ p, rezultate: [], urmator: false, eroare: "", mesaje: [], ms: 0 }).replace("Nicio firmă nu corespunde criteriilor.", "Introduceți criteriile și apăsați Caută."), { headers: hdr });
  const t0 = Date.now();
  let rows;
  try {
    rows = (await env.DB.prepare(c.sql).bind(...c.binds).all()).results;
  } catch (e) {
    return new Response(pagina({ p, rezultate: [], urmator: false, eroare: "Căutarea nu a putut fi efectuată acum. Încercați din nou.", mesaje: [], ms: 0 }), { status: 500, headers: { ...hdr, "cache-control": "no-store" } });
  }
  const urmator = rows.length > PE_PAGINA;
  return new Response(pagina({ p, rezultate: rows.slice(0, PE_PAGINA), urmator, eroare: "", mesaje: c.mesaje, ms: Date.now() - t0 }), { headers: hdr });
}

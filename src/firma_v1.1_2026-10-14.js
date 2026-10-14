// FirmsFinder AI — pagini /date și /firma/{CUI} (+ /firma/{CUI}/grafic.svg)
// Versiune v1.1 · 2026-10-14 (v1.1: butoane Tipărește/PDF, Sună acum, Scrie acum + aspect de tipărire)
// Se importă din src/worker.js:  import { firma, datePagina } from "./firma_v1.1_2026-10-14.js";

const VERSIUNE = "v1.1 · 2026-10-14";
const ANI = [2023, 2024, 2025];
const ACCENT = "#e36414";
const CACHE_STAT_SEC = 3600; // statistica /date se recalculează cel mult o dată pe oră

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nr = (n) => (n === null || n === undefined || n === "" ? "—" : Number(n).toLocaleString("ro-RO"));
const ziua = (s) => { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + "." + m[2] + "." + m[1] : "—"; };
const referinta = (cui) => "P-" + ((cui ^ 5921370) >>> 0).toString(36).toUpperCase(); // identică cu cea din căutare

function compact(n) {
  const a = Math.abs(n), semn = n < 0 ? "−" : "";
  if (a >= 1e6) { const v = a / 1e6; return semn + (v >= 10 ? Math.round(v) : v.toFixed(1).replace(".", ",")) + " mil."; }
  if (a >= 1e3) return semn + Math.round(a / 1e3) + " mii";
  return semn + a;
}

/* ---------- aspect comun ---------- */
function shell({ titlu, desc, corp, canonical, noindex, jsonld, status = 200, cache = "public, max-age=3600" }) {
  const html = `<!doctype html>
<!-- FirmsFinder AI · ${VERSIUNE} -->
<html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titlu)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="${noindex ? "noindex,nofollow" : "index,follow"}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : ""}
<style>
:root{--bg:#f6f4ef;--card:#fff;--ink:#16202a;--muted:#5d6873;--line:#e2ddd2;--acc:${ACCENT};--ok:#2d7a46;--bad:#b23a3a}
@media (prefers-color-scheme:dark){:root{--bg:#11161b;--card:#1a2128;--ink:#e8e4dc;--muted:#9aa4ad;--line:#2a333c;--ok:#5fcf86;--bad:#ff8a8a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15.5px/1.6 Inter,system-ui,sans-serif}
.w{max-width:960px;margin:0 auto;padding:0 16px}
nav{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--line)}
nav a{color:var(--ink);text-decoration:none;font-weight:500;font-size:14px}nav a.b{font-weight:600}nav .l a{margin-left:14px}
h1{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:clamp(26px,5vw,38px);line-height:1.15;margin:26px 0 6px;overflow-wrap:anywhere}
h2{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:20px;margin:0 0 10px}
.sub{color:var(--muted);margin:0 0 18px}
.c{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:18px}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.k{border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--bg)}
.k b{display:block;font:600 26px Fraunces,Georgia,serif;line-height:1.2}.k span{color:var(--muted);font-size:13.5px}
a{color:var(--acc)}
.t{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}
td,th{border-bottom:1px solid var(--line);padding:7px 8px;text-align:left;vertical-align:top}
th{font-size:12.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}
td.n,th.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
tr.s td{background:var(--bg);font-weight:600}
.ok{color:var(--ok)}.bad{color:var(--bad)}.m{color:var(--muted);font-size:13.5px}
.chip{display:inline-block;border:1px solid var(--line);border-radius:99px;padding:2px 10px;font-size:13px;margin:2px 4px 2px 0}
svg.gr{width:100%;height:auto;display:block;border-radius:12px;border:1px solid var(--line)}
details summary{cursor:pointer;color:var(--acc);font-weight:500}
.bt{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}
.bt a,.bt button{font:600 14px Inter,system-ui,sans-serif;border:1px solid var(--acc);color:var(--acc);background:transparent;border-radius:9px;padding:9px 14px;text-decoration:none;cursor:pointer}
.bt .p{background:var(--acc);color:#fff}
@media print{nav,.bt,details summary{display:none!important}body{background:#fff;color:#000;font-size:12pt}.c{border:0;padding:0 0 12px;break-inside:avoid}.k{background:#fff}a{color:#000;text-decoration:none}svg.gr{border:0}footer{border-top:1px solid #999;color:#000}}
footer{margin:28px 0;padding-top:14px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}footer a{color:var(--muted)}
</style></head><body><div class="w">
<nav><a class="b" href="/">← FirmsFinder AI</a><span class="l"><a href="/date">Datele din bază</a><a href="/legal/confidentialitate">Confidențialitate</a><a href="/gdpr.html">Datele firmei dumneavoastră</a><a href="/cerere.html">Cerere de scoatere</a></span></nav>
${corp}
<footer>FirmsFinder AI · operator AiVenture S.R.L., CUI 51415878, J2025016406000 · <a href="mailto:contact@5thelement.ai">contact@5thelement.ai</a> · pagină ${VERSIUNE}</footer>
</div></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache } });
}

/* ---------- grafic SVG: cifra de afaceri + profit/pierdere 2023–2025 ---------- */
export function graficSvg(d) {
  const W = 720, H = 300, SLOT = 100, BW = 60;
  const ca = ANI.map((a) => (d[a] ? d[a].cifra_afaceri : null));
  const rn = ANI.map((a) => (d[a] ? (d[a].profit_net || 0) - (d[a].pierdere_neta || 0) : null));
  const maxCa = Math.max(1, ...ca.filter((v) => v !== null && v > 0));
  const maxRn = Math.max(1, ...rn.filter((v) => v !== null).map(Math.abs));
  const rez = ANI.map((a, i) => a + ": cifra de afaceri " + (ca[i] === null ? "fără bilanț" : nr(ca[i]) + " lei") + ", rezultat net " + (rn[i] === null ? "fără bilanț" : nr(rn[i]) + " lei")).join("; ");
  const txt = (x, y, t, o = "") => `<text x="${x}" y="${y}" text-anchor="middle" font-size="12" ${/fill=/.test(o) ? "" : 'fill="#16202a" '}${o}>${esc(t)}</text>`;
  let s = `<svg class="gr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc("Cifra de afaceri și rezultat net, 2023–2025. " + rez)}" font-family="Inter,system-ui,sans-serif">`;
  s += `<title>${esc("Cifra de afaceri și rezultat net 2023–2025")}</title><rect width="${W}" height="${H}" rx="12" fill="#ffffff"/>`;
  s += `<text x="30" y="34" font-size="15" font-weight="600" fill="#16202a">Cifra de afaceri (lei)</text>`;
  s += `<text x="390" y="34" font-size="15" font-weight="600" fill="#16202a">Rezultat net: profit / pierdere (lei)</text>`;
  s += `<line x1="30" y1="230" x2="330" y2="230" stroke="#cfc8b8"/><line x1="390" y1="150" x2="690" y2="150" stroke="#cfc8b8"/>`;
  ANI.forEach((a, i) => {
    const x1 = 30 + i * SLOT + (SLOT - BW) / 2, c1 = x1 + BW / 2;
    const x2 = 390 + i * SLOT + (SLOT - BW) / 2, c2 = x2 + BW / 2;
    // cifra de afaceri
    if (ca[i] === null) s += txt(c1, 215, "fără bilanț", 'fill="#8a939b"');
    else {
      const h = ca[i] > 0 ? Math.max(2, (ca[i] / maxCa) * 150) : 0;
      if (h) s += `<rect x="${x1}" y="${230 - h}" width="${BW}" height="${h}" rx="4" fill="${ACCENT}"/>`;
      s += txt(c1, 230 - h - 6, compact(ca[i]), 'font-weight="600"');
    }
    // rezultat net
    if (rn[i] === null) s += txt(c2, 145, "fără bilanț", 'fill="#8a939b"');
    else if (rn[i] === 0) s += txt(c2, 142, "0", 'font-weight="600"');
    else {
      const h = Math.max(2, (Math.abs(rn[i]) / maxRn) * 70);
      if (rn[i] > 0) { s += `<rect x="${x2}" y="${150 - h}" width="${BW}" height="${h}" rx="4" fill="#2d7a46"/>`; s += txt(c2, 150 - h - 6, compact(rn[i]), 'font-weight="600"'); }
      else { s += `<rect x="${x2}" y="150" width="${BW}" height="${h}" rx="4" fill="#b23a3a"/>`; s += txt(c2, 150 + h + 15, compact(rn[i]), 'font-weight="600"'); }
    }
    s += txt(c1, 252, String(a), 'fill="#5d6873"') + txt(c2, 252, String(a), 'fill="#5d6873"');
  });
  s += `<rect x="390" y="266" width="10" height="10" rx="2" fill="#2d7a46"/><text x="406" y="275" font-size="12" fill="#16202a">profit net</text>`;
  s += `<rect x="480" y="266" width="10" height="10" rx="2" fill="#b23a3a"/><text x="496" y="275" font-size="12" fill="#16202a">pierdere netă</text>`;
  s += `<text x="30" y="290" font-size="10.5" fill="#8a939b">Sursa: Ministerul Finanțelor, data.gov.ro · FirmsFinder AI</text></svg>`;
  return s;
}

/* ---------- pagina unei firme ---------- */
const INDICATORI = [
  ["Rezultate", [["cifra_afaceri", "Cifra de afaceri"], ["venituri_totale", "Venituri totale"], ["cheltuieli_totale", "Cheltuieli totale"], ["profit_brut", "Profit brut"], ["pierdere_bruta", "Pierdere brută"], ["profit_net", "Profit net"], ["pierdere_neta", "Pierdere netă"], ["salariati", "Număr mediu de salariați"]]],
  ["Bilanț", [["active_imobilizate", "Active imobilizate"], ["active_circulante", "Active circulante"], ["stocuri", "Stocuri"], ["creante", "Creanțe"], ["casa_banci", "Casa și conturi la bănci"], ["cheltuieli_avans", "Cheltuieli în avans"], ["datorii", "Datorii"], ["venituri_avans", "Venituri în avans"], ["provizioane", "Provizioane"], ["capitaluri", "Capitaluri proprii"], ["capital_subscris", "Capital subscris"], ["patrimoniu_regie", "Patrimoniul regiei"]]]
];

function adresa(f) {
  const p = [f.strada, f.nr ? "nr. " + f.nr : "", f.bloc ? "bl. " + f.bloc : "", f.scara ? "sc. " + f.scara : "", f.etaj ? "et. " + f.etaj : "", f.apartament ? "ap. " + f.apartament : "", f.localitate, f.judet, f.cod_postal && f.cod_postal !== "000000" ? f.cod_postal : ""];
  return p.filter((x) => x && String(x).trim()).join(", ");
}

function nuGasit(status, titlu, mesaj) {
  return shell({ titlu, desc: titlu, noindex: true, status, cache: "public, max-age=300", corp: `<h1>${esc(titlu)}</h1><div class="c"><p>${esc(mesaj)}</p><p><a href="/">Căutați în baza FirmsFinder AI</a></p></div>` });
}

export async function firma(url, env) {
  const m = url.pathname.match(/^\/firma\/(\d{2,10})(\/grafic\.svg)?\/?$/);
  if (!m) return nuGasit(404, "Pagină inexistentă", "Adresa trebuie să fie de forma /firma/{CUI}.");
  const cui = Number(m[1]);
  const f = await env.DB.prepare(`SELECT cod_inmatriculare, cui, denumire, forma_juridica, persoana_fizica, top, data_inmatriculare, euid, judet, localitate, strada, nr, bloc, scara, etaj, apartament, cod_postal, web, coduri_stare, sursa_data
    FROM onrc_firme WHERE cui = ? LIMIT 1`).bind(cui).first();
  if (!f) return nuGasit(404, "Firmă negăsită", "CUI-ul nu se află printre firmele active din baza FirmsFinder AI.");
  const exc = await env.DB.prepare("SELECT 1 AS x FROM onrc_excluderi WHERE cui = ? LIMIT 1").bind(cui).first();
  if (exc) return nuGasit(410, "Firmă scoasă din bază", "Această firmă a fost scoasă din bază la cererea ei.");

  // PFA / II / IF și orice înregistrare cu top ≠ 1: pagină mascată, fără nume, fără CUI afișat
  if (f.persoana_fizica || f.top !== 1) {
    if (m[2]) return new Response("Grafic indisponibil.", { status: 404 });
    return shell({
      titlu: "Înregistrare în așteptarea acordului GDPR · FirmsFinder AI", desc: "Identitatea acestei înregistrări este ascunsă până la acordul titularului.", noindex: true,
      corp: `<h1>Înregistrare în așteptarea acordului GDPR</h1><p class="sub">Referință ${esc(referinta(cui))}</p>
<div class="c"><p>${esc(f.forma_juridica || "Persoană fizică")} · județul ${esc(f.judet || "—")}.</p>
<p>Numele și datele de identificare ale persoanelor fizice autorizate, întreprinderilor individuale și familiale sunt ascunse în pagina publică. Titularul poate cere afișarea sau scoaterea din bază la <a href="mailto:contact@5thelement.ai">contact@5thelement.ai</a>.</p></div>`
    });
  }

  const bd = await env.DB.batch([
    env.DB.prepare("SELECT * FROM mf_bilant_2023 WHERE cui = ? LIMIT 1").bind(cui),
    env.DB.prepare("SELECT * FROM mf_bilant_2024 WHERE cui = ? LIMIT 1").bind(cui),
    env.DB.prepare("SELECT * FROM mf_bilant_2025 WHERE cui = ? LIMIT 1").bind(cui),
    env.DB.prepare("SELECT caen FROM onrc_firma_caen WHERE cod_inmatriculare = ? LIMIT 1").bind(f.cod_inmatriculare),
    env.DB.prepare("SELECT domeniu, url, verificat, metoda, emailuri, telefoane, titlu, descriere, data FROM firme_site WHERE cui = ? LIMIT 1").bind(cui)
  ]);
  const date = { 2023: bd[0].results[0] || null, 2024: bd[1].results[0] || null, 2025: bd[2].results[0] || null };
  if (m[2]) return new Response(graficSvg(date), { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=3600" } });

  const caenAut = String(bd[3].results[0]?.caen || "").split(",").map((x) => x.split(":")[0].trim()).filter(Boolean).slice(0, 60);
  const principal = (date[2025] || date[2024] || date[2023] || {}).caen_mf || "";
  const coduri = String(f.coduri_stare || "").split(",").map((x) => Number(x.trim())).filter(Boolean).slice(0, 20);
  const caenCer = [...new Set([principal, ...caenAut].filter(Boolean))].slice(0, 60);
  const [rs, rc] = await Promise.all([
    coduri.length ? env.DB.prepare(`SELECT cod, denumire FROM onrc_nom_stare WHERE cod IN (${coduri.map(() => "?").join(",")})`).bind(...coduri).all() : { results: [] },
    caenCer.length ? env.DB.prepare(`SELECT clasa, denumire FROM onrc_nom_caen WHERE versiune = 2 AND clasa IN (${caenCer.map(() => "?").join(",")})`).bind(...caenCer).all() : { results: [] }
  ]);
  const stari = rs.results.map((x) => x.denumire);
  const numeCaen = Object.fromEntries(rc.results.map((x) => [x.clasa, x.denumire]));

  const s = bd[4].results[0] || null;
  const siteBun = s && s.url && (s.verificat === 1 || s.verificat === 2);
  const deVerificat = siteBun && /^(cautare|dfs)\+/.test(s.metoda || "");
  const stareSite = !siteBun ? "" : deVerificat ? "de verificat" : s.verificat === 1 ? "confirmat" : "probabil";

  const ca24 = date[2024]?.cifra_afaceri;
  const desc = `${f.denumire}, ${f.forma_juridica || ""}, ${f.localitate || f.judet || ""}. ` + (ca24 != null ? `Cifra de afaceri 2024: ${nr(ca24)} lei. ` : "") + "Date ONRC și Ministerul Finanțelor.";
  const jsonld = {
    "@context": "https://schema.org", "@type": "Organization", name: f.denumire, legalName: f.denumire, taxID: String(cui), foundingDate: f.data_inmatriculare || undefined,
    address: { "@type": "PostalAddress", addressLocality: f.localitate || undefined, addressRegion: f.judet || undefined, addressCountry: "RO" },
    ...(s && s.verificat === 1 && s.url && !deVerificat ? { url: s.url } : {})
  };

  const randuri = (lista) => lista.map(([k, et]) => `<tr><td>${esc(et)}</td>${ANI.map((a) => `<td class="n">${date[a] ? nr(date[a][k]) : "—"}</td>`).join("")}</tr>`).join("");
  const net = ANI.map((a) => (date[a] ? (date[a].profit_net || 0) - (date[a].pierdere_neta || 0) : null));
  const tabel = `<div class="t"><table><thead><tr><th>Indicator (lei)</th>${ANI.map((a) => `<th class="n">${a}</th>`).join("")}</tr></thead><tbody>
<tr class="s"><td>Rezultat net (profit − pierdere)</td>${net.map((v) => `<td class="n ${v === null ? "" : v >= 0 ? "ok" : "bad"}">${v === null ? "—" : nr(v)}</td>`).join("")}</tr>
${INDICATORI.map(([g, l]) => `<tr><th colspan="4">${g}</th></tr>${randuri(l)}`).join("")}
<tr><th colspan="4">Metadate fișier MF</th></tr>
<tr><td>Formular (câmp „sursa”)</td>${ANI.map((a) => `<td class="n">${date[a] ? esc(date[a].sursa || "—") : "—"}</td>`).join("")}</tr>
<tr><td>CAEN principal în bilanț</td>${ANI.map((a) => `<td class="n">${date[a] ? esc(date[a].caen_mf || "—") : "—"}</td>`).join("")}</tr>
<tr><td>An raportare (câmp „an”)</td>${ANI.map((a) => `<td class="n">${date[a] ? esc(date[a].an ?? "—") : "—"}</td>`).join("")}</tr>
</tbody></table></div>`;

  const lipsa = ANI.filter((a) => !date[a]);
  const tel = String(s?.telefoane || "").split(",").map((x) => x.replace(/[^\d+]/g, "")).find((x) => x.length >= 9 && x.length <= 13);
  const mail = String(s?.emailuri || "").split(/[,;\s]+/).find((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
  const butoane = `<div class="bt"><button type="button" class="p" onclick="window.print()">Tipărește / Salvează PDF</button>${tel ? `<a href="tel:${esc(tel)}">Sună acum</a>` : ""}${mail ? `<a href="mailto:${esc(mail)}">Scrie acum</a>` : ""}</div>${tel || mail ? '<p class="m" style="margin-top:-8px">Contact găsit automat pe site-uri publice; poate fi neactualizat.</p>' : ""}`;
  const corp = `<h1>${esc(f.denumire)}</h1>
<p class="sub">${esc(f.forma_juridica || "")} · CUI ${cui} · ${esc(f.localitate || "")}${f.localitate && f.judet ? ", " : ""}${esc(f.judet || "")}</p>
${butoane}

<div class="c"><h2>Cifra de afaceri și rezultatul net, 2023–2025</h2>${graficSvg(date)}
<p class="m">${lipsa.length ? "Fără bilanț în baza noastră pentru: " + lipsa.join(", ") + ". " : ""}Bilanțurile 2025 pot fi încă incomplete. <a href="/firma/${cui}/grafic.svg">Imaginea în sine (SVG)</a></p></div>

<div class="c"><h2>Date din registrul comerțului (ONRC)</h2><div class="t"><table><tbody>
<tr><td>Denumire</td><td>${esc(f.denumire)}</td></tr>
<tr><td>CUI</td><td>${cui}</td></tr>
<tr><td>Nr. înmatriculare</td><td>${esc(f.cod_inmatriculare || "—")}</td></tr>
<tr><td>EUID</td><td>${esc(f.euid || "—")}</td></tr>
<tr><td>Formă juridică</td><td>${esc(f.forma_juridica || "—")}</td></tr>
<tr><td>Data înmatriculării</td><td>${ziua(f.data_inmatriculare)}</td></tr>
<tr><td>Sediu</td><td>${esc(adresa(f) || "—")}</td></tr>
<tr><td>Stare</td><td>${stari.length ? stari.map((x) => `<span class="chip">${esc(x)}</span>`).join("") : "—"}</td></tr>
<tr><td>Site declarat la ONRC</td><td>${f.web ? esc(f.web) : "—"}</td></tr>
<tr><td>Activitate principală (MF)</td><td>${principal ? esc(principal) + " — " + esc(numeCaen[principal] || "denumire indisponibilă") : "—"}</td></tr>
</tbody></table></div>
${caenAut.length ? `<details style="margin-top:10px"><summary>Activități autorizate (${caenAut.length} coduri CAEN)</summary><div class="t"><table><tbody>${caenAut.map((c) => `<tr><td>${esc(c)}</td><td>${esc(numeCaen[c] || "—")}</td></tr>`).join("")}</tbody></table></div></details>` : ""}</div>

<div class="c"><h2>Date financiare (Ministerul Finanțelor)</h2>${tabel}</div>

<div class="c"><h2>Site și contact</h2>${siteBun
    ? `<div class="t"><table><tbody>
<tr><td>Site</td><td><a href="${esc(s.url)}" rel="nofollow noopener" target="_blank">${esc(s.domeniu || s.url)}</a> <span class="chip">${esc(stareSite)}</span></td></tr>
${s.titlu ? `<tr><td>Titlu</td><td>${esc(s.titlu)}</td></tr>` : ""}${s.descriere ? `<tr><td>Descriere</td><td>${esc(s.descriere)}</td></tr>` : ""}
<tr><td>Email</td><td>${s.emailuri ? esc(s.emailuri) : "negăsit"}</td></tr>
<tr><td>Telefon</td><td>${s.telefoane ? esc(s.telefoane) : "negăsit"}</td></tr>
<tr><td>Găsit de FirmsFinderBot</td><td>${ziua(s.data)}${s.metoda ? " · metodă: " + esc(s.metoda) : ""}</td></tr>
</tbody></table></div>${deVerificat ? '<p class="m">Site găsit prin căutare web și încă neconfirmat cu CUI-ul firmei.</p>' : ""}`
    : `<p>Nu am găsit un site pentru această firmă${s ? " (căutat de FirmsFinderBot la " + ziua(s.data) + ")" : " (încă necăutat)"}. Lipsa unui rezultat nu înseamnă că site-ul nu există.</p>`}</div>

<div class="c"><h2>Sursele acestei pagini</h2><ul class="m">
<li>ONRC, data.gov.ro (licența OGL-ROU-1.0) — setul din ${ziua(f.sursa_data)}, încărcat în bază la 5 octombrie 2026.</li>
<li>Ministerul Finanțelor, „Situații financiare”, data.gov.ro — anii ${ANI.filter((a) => date[a]).join(", ") || "—"}; încărcate la 5–6 octombrie 2026.</li>
<li>Site, email, telefon: FirmsFinderBot, căutare automată pe site-uri publice.</li>
<li>Datele sunt preluate ca atare din sursele oficiale și pot conține întârzieri sau erori; nu înlocuiesc verificarea la sursă. Dreptul de opoziție: <a href="/cerere.html">cerere de scoatere din bază</a>.</li></ul></div>`;

  return shell({ titlu: `${f.denumire} — CUI ${cui} · FirmsFinder AI`, desc, corp, canonical: url.origin + "/firma/" + cui, jsonld });
}

/* ---------- pagina /date: statistici live, cache o oră ---------- */
async function calculeaza(env) {
  const r = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS total, SUM(persoana_fizica = 1) AS pf, SUM(top = 1) AS publice FROM onrc_firme"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM mf_bilant_2023"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM mf_bilant_2024"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM mf_bilant_2025"),
    env.DB.prepare(`SELECT COUNT(*) AS procesate,
      SUM(CASE WHEN domeniu IS NOT NULL AND domeniu <> '' THEN 1 ELSE 0 END) AS cu_domeniu,
      SUM(verificat = 1) AS confirmate, SUM(verificat = 2) AS probabile,
      SUM(CASE WHEN emailuri IS NOT NULL AND emailuri <> '' AND emailuri <> '[]' THEN 1 ELSE 0 END) AS cu_email,
      SUM(CASE WHEN telefoane IS NOT NULL AND telefoane <> '' AND telefoane <> '[]' THEN 1 ELSE 0 END) AS cu_telefon,
      MAX(data) AS ultima FROM firme_site WHERE COALESCE(verificat, 0) <> -1`)
  ]);
  const d = { onrc: r[0].results[0], mf: { 2023: r[1].results[0].n, 2024: r[2].results[0].n, 2025: r[3].results[0].n }, site: r[4].results[0] };
  const st = { t: new Date().toISOString(), d };
  await env.DB.prepare("INSERT OR REPLACE INTO config (cheie, valoare) VALUES ('stat_date', ?)").bind(JSON.stringify(st)).run();
  return st;
}

export async function datePagina(url, env, ctx) {
  const row = await env.DB.prepare("SELECT valoare FROM config WHERE cheie = 'stat_date'").first();
  let st = null;
  try { st = row ? JSON.parse(row.valoare) : null; } catch { st = null; }
  if (!st) st = await calculeaza(env);
  else if (Date.now() - Date.parse(st.t) > CACHE_STAT_SEC * 1000) {
    const lk = await env.DB.prepare("SELECT valoare FROM config WHERE cheie = 'stat_date_lock'").first();
    if (!lk || Date.now() - Date.parse(lk.valoare) > 600000) {
      await env.DB.prepare("INSERT OR REPLACE INTO config (cheie, valoare) VALUES ('stat_date_lock', ?)").bind(new Date().toISOString()).run();
      const p = calculeaza(env).catch(() => null);
      if (ctx && ctx.waitUntil) ctx.waitUntil(p); else st = (await p) || st;
    }
  }
  const { onrc, mf, site } = st.d;
  const pj = onrc.total - onrc.pf;
  const pct = (n, tot) => (tot ? ((n / tot) * 100).toLocaleString("ro-RO", { maximumFractionDigits: 1 }) + "%" : "—");
  const ora = new Date(st.t).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "long", timeStyle: "short" });
  const k = (v, et) => `<div class="k"><b>${nr(v)}</b><span>${esc(et)}</span></div>`;

  const corp = `<h1>Datele din baza FirmsFinder AI</h1>
<p class="sub">Cifre calculate direct din baza de date, actualizate la ${esc(ora)} (se reîmprospătează cel mult o dată pe oră).</p>

<div class="c"><h2>Firmele</h2><div class="g">${k(onrc.total, "firme active în registrul ONRC")}${k(pj, "persoane juridice")}${k(onrc.pf, "PFA / II / IF (identitate ascunsă)")}${k(onrc.publice, "afișate public în căutare")}</div></div>

<div class="c"><h2>Bilanțuri Ministerul Finanțelor</h2><div class="t"><table><thead><tr><th>An</th><th class="n">Firme cu bilanț</th><th class="n">Din persoanele juridice active</th></tr></thead><tbody>
${ANI.map((a) => `<tr><td>${a}</td><td class="n">${nr(mf[a])}</td><td class="n">${pct(mf[a], pj)}</td></tr>`).join("")}
</tbody></table></div><p class="m">Bilanțurile 2025 pot fi încă incomplete. Anul 2022 nu este încă în bază.</p></div>

<div class="c"><h2>Site-uri, email, telefon (FirmsFinderBot)</h2><div class="g">
${k(site.procesate, "firme procesate (" + pct(site.procesate, pj) + " din persoanele juridice)")}${k(site.cu_domeniu, "cu domeniu găsit")}${k(site.confirmate, "cu site confirmat")}${k(site.probabile, "cu site probabil")}${k(site.cu_email, "cu email găsit")}${k(site.cu_telefon, "cu telefon găsit")}</div>
<p class="m">Ultima intrare în tabel: ${ziua(site.ultima)}. „Fără domeniu” înseamnă că nu l-am găsit, nu că firma nu are site.</p></div>

<div class="c"><h2>Datele încărcării</h2><div class="t"><table><thead><tr><th>Set</th><th>Sursă</th><th>Versiunea setului</th><th>Încărcat în bază</th><th class="n">Rânduri</th></tr></thead><tbody>
<tr><td>Firme active</td><td>ONRC, data.gov.ro (OGL-ROU-1.0)</td><td>02.09.2026</td><td>5 oct 2026</td><td class="n">${nr(onrc.total)}</td></tr>
<tr><td>Bilanțuri 2024</td><td>MF, data.gov.ro</td><td>actualizat iunie 2026</td><td>5 oct 2026</td><td class="n">${nr(mf[2024])}</td></tr>
<tr><td>Bilanțuri 2023</td><td>MF, data.gov.ro</td><td>neînregistrată</td><td>6 oct 2026</td><td class="n">${nr(mf[2023])}</td></tr>
<tr><td>Bilanțuri 2025</td><td>MF, data.gov.ro</td><td>neînregistrată</td><td>6 oct 2026</td><td class="n">${nr(mf[2025])}</td></tr>
<tr><td>Site, email, telefon</td><td>FirmsFinderBot (căutare automată)</td><td>continuu</td><td>ultima intrare ${ziua(site.ultima)}</td><td class="n">${nr(site.procesate)}</td></tr>
</tbody></table></div>
<p class="m">Fiecare firmă are o pagină proprie, cu datele ONRC, indicatorii MF pe trei ani și graficul cifrei de afaceri și al rezultatului net: <code>/firma/{CUI}</code>.</p></div>`;

  return shell({ titlu: "Datele din baza FirmsFinder AI", desc: `${nr(onrc.total)} de firme active din România, bilanțuri MF 2023–2025 și site-uri găsite, cu datele încărcării.`, corp, canonical: url.origin + "/date", cache: "public, max-age=600" });
}

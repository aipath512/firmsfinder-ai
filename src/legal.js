// src/legal.js — Kit legal + formular v1.0 (2026-10-06)
// Un singur Worker servește, pentru FIECARE site din SITES:
//   /legal/confidentialitate   politica de prelucrare a datelor
//   /legal/termeni             termeni și condiții
//   /legal/cerere              cerere GDPR (acces / rectificare / ștergere / opoziție)
//   /legal/lead.js             formularul „primiți o ofertă” — se pune pe orice pagină cu o linie <script>
//   POST /legal/api/lead       salvare formular în KV (LEADS) + email
//   POST /legal/api/cerere     salvare cerere GDPR în KV (LEADS) + email
// Datele fiecărui site (operator, CUI, adresă, email) stau în SITES. Un site nou = o fișă nouă + o rută în wrangler.toml.

const AIVENTURE = {
  operator: "AiVenture S.R.L.",
  cui: "51415878",
  reg: "J2025016406000",
  adresa: "București, Sectorul 1, Drumul Pădurea Pustnicu nr. 141C, Corp A, Etaj 2, Ap. 5",
  email: "contact@5thelement.ai",
};

export const SITES = {
  "1clic-ia.eu": {
    ...AIVENTURE,
    marca: "FirmsFinder AI",
    site: "1clic-ia.eu",
    scop_formular: "o ofertă personalizată pentru FirmsFinder AI",
    politica_url: "/gdpr.html",
    termeni_url: "/termeni.html",
    destinatari: ["contact@5thelement.ai"],
    culoare: "#e36414",
    servicii_extra: ["căutarea în baza de firme FirmsFinder AI (date publice ONRC și Ministerul Finanțelor)"],
  },
  "ecbtax.com": {
    operator: "ECB TAX, ACCOUNTING & HR SRL",
    cui: "35136588",
    reg: "J2015012724402",
    adresa: "București, Sectorul 1, Str. Nicolae G. Caramfil nr. 61C, Corp C1, Etaj 3, Ap. 1",
    email: "ecbtax@gmail.com",
    marca: "ECB Tax Accounting & HR",
    site: "ecbtax.com",
    scop_formular: "o ofertă personalizată de servicii de contabilitate, salarizare și consultanță fiscală",
    politica_url: "/legal/confidentialitate",
    termeni_url: "/legal/termeni",
    destinatari: ["ecbtax@gmail.com", "contact@5thelement.ai"],
    culoare: "#b8860b",
    servicii_extra: [],
  },
};
SITES["www.ecbtax.com"] = SITES["ecbtax.com"];
SITES["firmsfinder.aiventure.ro"] = SITES["1clic-ia.eu"];
SITES["firmsfinder-ai.aipath512.workers.dev"] = SITES["1clic-ia.eu"];

export const JUDETE_RO = ["Alba","Arad","Argeș","Bacău","Bihor","Bistrița-Năsăud","Botoșani","Brașov","Brăila","București",
  "Buzău","Caraș-Severin","Călărași","Cluj","Constanța","Covasna","Dâmbovița","Dolj","Galați","Giurgiu","Gorj",
  "Harghita","Hunedoara","Ialomița","Iași","Ilfov","Maramureș","Mehedinți","Mureș","Neamț","Olt","Prahova",
  "Satu Mare","Sălaj","Sibiu","Suceava","Teleorman","Timiș","Tulcea","Vaslui","Vâlcea","Vrancea"];

const VERSIUNE = "v1.0 · 2026-10-06";

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const jr = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export async function legal(request, env, url) {
  const s = SITES[url.hostname];
  if (!s) return new Response("Site neconfigurat.", { status: 404 });
  const p = url.pathname.replace(/\/+$/, "");
  if (p === "/legal/lead.js") return new Response(widgetJs(s).replace(/[^\x00-\x7f]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")), { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300" } });
  if (p === "/legal/api/lead" && request.method === "POST") return lead(request, env, s, url.hostname);
  if (p === "/legal/api/cerere" && request.method === "POST") return cerere(request, env, s, url.hostname);
  if (p === "/legal/confidentialitate") return pagina(s, "Politica de prelucrare a datelor personale", confidentialitate(s));
  if (p === "/legal/termeni") return pagina(s, "Termeni și condiții", termeni(s));
  if (p === "/legal/cerere") return pagina(s, "Cerere privind datele personale", cerereHtml(s));
  if (p === "/legal" ) return Response.redirect(url.origin + "/legal/confidentialitate", 302);
  return new Response("Pagina nu există.", { status: 404 });
}

// ---------- texte acorduri (se salvează cu fiecare cerere, ca dovadă) ----------
function texteAcorduri(s) {
  return {
    versiune: VERSIUNE,
    com_telefon: "Sunt de acord să primesc comunicări comerciale ulterioare pe: Telefon",
    com_sms: "Sunt de acord să primesc comunicări comerciale ulterioare pe: SMS",
    com_whatsapp: "Sunt de acord să primesc comunicări comerciale ulterioare pe: WhatsApp",
    com_email: "Sunt de acord să primesc comunicări comerciale ulterioare pe: E-mail",
    reclame: "Sunt de acord ca datele mele să fie folosite pentru afișarea de reclame personalizate (custom audience, GDN)",
    politica: "Am citit și am înțeles politica de prelucrare a datelor personale (" + s.site + s.politica_url + ")",
    termeni: "Sunt de acord cu termenii și condițiile (" + s.site + s.termeni_url + ")",
  };
}

async function lead(request, env, s, host) {
  let d;
  try { d = await request.json(); } catch { return jr({ eroare: "Cerere invalidă." }, 400); }
  const t = (v, n) => String(v ?? "").trim().slice(0, n);
  const nume = t(d.nume, 120), firma = t(d.firma, 160), email = t(d.email, 160), telefon = t(d.telefon, 30);
  if (d.website) return jr({ ok: true }); // capcană pentru roboți (câmp ascuns)
  if (nume.length < 3) return jr({ eroare: "Completați numele și prenumele." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jr({ eroare: "Adresă de email invalidă." }, 400);
  if (telefon.replace(/\D/g, "").length < 9) return jr({ eroare: "Număr de telefon invalid." }, 400);
  if (firma.length < 2) return jr({ eroare: "Completați numele firmei." }, 400);
  if (!d.politica) return jr({ eroare: "Bifați că ați citit politica de prelucrare a datelor." }, 400);
  if (!d.termeni) return jr({ eroare: "Bifați acordul cu termenii și condițiile." }, 400);
  if (!env.LEADS) return jr({ eroare: "Stocarea nu este configurată." }, 500);
  const acum = new Date().toISOString();
  const acorduri = {};
  for (const k of ["com_telefon", "com_sms", "com_whatsapp", "com_email", "reclame", "politica", "termeni"]) acorduri[k] = !!d[k];
  const inreg = {
    tip: "lead", site: s.site, operator: s.operator, data: acum, nume, firma, email, telefon, acorduri,
    text_acorduri: texteAcorduri(s), pagina: t(d.pagina, 200), tara: (request.cf && request.cf.country) || null,
    agent: t(request.headers.get("user-agent"), 200),
  };
  const cheie = "lead:" + s.site + ":" + acum + ":" + crypto.randomUUID().slice(0, 8);
  await env.LEADS.put(cheie, JSON.stringify(inreg, null, 2), { metadata: { site: s.site, nume, firma, email, data: acum } });
  const canale = ["com_telefon", "com_sms", "com_whatsapp", "com_email"].filter(k => acorduri[k]).map(k => k.slice(4)).join(", ") || "niciunul";
  await trimiteMail(env, s, "Cerere de ofertă — " + nume + " (" + firma + ") — " + s.site, [
    "Cerere nouă de ofertă personalizată de pe " + s.site, "",
    "Nume: " + nume, "Firma: " + firma, "Email: " + email, "Telefon: " + telefon,
    "Comunicări comerciale acceptate pe: " + canale,
    "Reclame personalizate: " + (acorduri.reclame ? "DA" : "nu"),
    "Politica date: DA · Termeni: DA", "Data: " + acum, "Pagina: " + inreg.pagina, "",
    "Salvat în Cloudflare KV „firmsfinder-leads”, cheia: " + cheie,
  ].join("\n"), email);
  return jr({ ok: true });
}

const TIPURI_CERERE = { acces: "Acces la date", rectificare: "Rectificare", stergere: "Ștergere", opozitie: "Opoziție", retragere: "Retragerea acordului", altele: "Altă solicitare" };

async function cerere(request, env, s) {
  let d;
  try { d = await request.json(); } catch { return jr({ eroare: "Cerere invalidă." }, 400); }
  const t = (v, n) => String(v ?? "").trim().slice(0, n);
  const nume = t(d.nume, 120), email = t(d.email, 160), tip = t(d.tip, 20), mesaj = t(d.mesaj, 2000);
  if (d.website) return jr({ ok: true });
  if (nume.length < 3) return jr({ eroare: "Scrieți numele dumneavoastră." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jr({ eroare: "Adresă de email invalidă." }, 400);
  if (!TIPURI_CERERE[tip]) return jr({ eroare: "Alegeți tipul cererii." }, 400);
  if (!env.LEADS) return jr({ eroare: "Stocarea nu este configurată." }, 500);
  const acum = new Date().toISOString();
  const nr = "GDPR-" + acum.slice(0, 10).replace(/-/g, "") + "-" + crypto.randomUUID().slice(0, 4).toUpperCase();
  const cheie = "cerere:" + s.site + ":" + acum + ":" + nr;
  await env.LEADS.put(cheie, JSON.stringify({ tip: "cerere_gdpr", nr, site: s.site, operator: s.operator, data: acum, nume, email, cerere: TIPURI_CERERE[tip], mesaj }, null, 2),
    { metadata: { site: s.site, nr, nume, email, cerere: TIPURI_CERERE[tip], data: acum } });
  await trimiteMail(env, s, "Cerere GDPR " + nr + " — " + TIPURI_CERERE[tip] + " — " + s.site, [
    "Cerere nouă privind datele personale, de pe " + s.site, "",
    "Număr: " + nr, "Tip: " + TIPURI_CERERE[tip], "Nume: " + nume, "Email: " + email, "Mesaj: " + (mesaj || "—"), "Data: " + acum, "",
    "Termen legal de răspuns: o lună de la primire (art. 12 alin. 3 GDPR).",
    "Salvat în Cloudflare KV „firmsfinder-leads”, cheia: " + cheie,
  ].join("\n"), email);
  return jr({ ok: true, nr });
}

async function trimiteMail(env, s, subiect, text, replyTo) {
  if (!env.RESEND_API_KEY) return "LIPSA RESEND_API_KEY";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "authorization": "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ from: (s.marca + " <no-reply@eu-ai-act-ready.eu>").replace(/[^\w\s<>@.&-]/g, ""), to: s.destinatari, reply_to: replyTo, subject: subiect, text }),
    });
    return r.ok ? "OK" : "EROARE " + r.status;
  } catch (e) { return "EXCEPTIE"; }
}

// ---------- widget: formularul „primiți o ofertă” ----------
function widgetJs(s) {
  const css = `.lk{background:#0f1a20;color:#f3efe6;border-radius:16px;padding:26px 22px;margin:24px auto;max-width:1100px;box-sizing:border-box;font:15px/1.5 Inter,system-ui,sans-serif;text-align:left}
.lk *{box-sizing:border-box}
.lk h2{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:clamp(22px,4vw,30px);margin:0 0 18px;color:#fff;line-height:1.2}
.lk form{display:block;background:transparent;border:0;padding:0;margin:0;max-width:720px}
.lk label{color:#f3efe6;text-transform:none;letter-spacing:0;margin:0;font-weight:500}
.lk .lk-t{display:block;font-size:15px;font-weight:600;margin:16px 0 6px}
.lk input[type=text],.lk input[type=email],.lk input[type=tel],.lk select{display:block;width:100%;padding:12px;border-radius:9px;border:1px solid #3a4650;background:#fff;color:#16202a;font:inherit;margin:0}
.lk .lk-ck{display:flex;gap:10px;align-items:flex-start;margin:12px 0;font-size:14.5px;line-height:1.45}
.lk .lk-ck input{width:20px;height:20px;margin:1px 0 0;flex:none}
.lk .lk-row{display:flex;flex-wrap:wrap;gap:8px 22px}
.lk a{color:#ffb27a}
.lk .lk-p{margin:18px 0 4px;font-size:14.5px}
.lk button{margin-top:14px;background:${s.culoare};color:#fff;border:0;border-radius:9px;padding:13px 22px;font:600 16px Inter,sans-serif;cursor:pointer}
.lk .lk-msg{margin-top:12px;font-weight:600}.lk .lk-ok{color:#7fe0a0}.lk .lk-err{color:#ff9b9b}
.lk .lk-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}`;
  const html = `<section class="lk" id="oferta" aria-label="Cerere ofertă">
<h2>Completați formularul și primiți o ofertă personalizată.</h2>
<form autocomplete="on" novalidate>
<label class="lk-t">Nume și Prenume *<input type="text" name="nume" autocomplete="name" maxlength="120"></label>
<label class="lk-t">Firma *<input type="text" name="firma" autocomplete="organization" maxlength="160"></label>
<label class="lk-t">Email *<input type="email" name="email" autocomplete="email" maxlength="160"></label>
<label class="lk-t">Telefon *<input type="tel" name="telefon" autocomplete="tel" maxlength="30"></label>
<div class="lk-hp" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>
<p class="lk-p">Sunt de acord să primesc comunicări comerciale ulterioare pe:</p>
<div class="lk-row"><label class="lk-ck"><input type="checkbox" name="com_telefon"> Telefon</label><label class="lk-ck"><input type="checkbox" name="com_sms"> SMS</label><label class="lk-ck"><input type="checkbox" name="com_whatsapp"> WhatsApp</label><label class="lk-ck"><input type="checkbox" name="com_email"> E-mail</label></div>
<label class="lk-ck"><input type="checkbox" name="reclame"> <span>Sunt de acord ca datele mele să fie folosite pentru afișarea de reclame personalizate (custom audience, GDN)</span></label>
<label class="lk-ck"><input type="checkbox" name="politica"> <span>Am citit și am înțeles <a href="${s.politica_url}" target="_blank">politica de prelucrare a datelor personale</a> *</span></label>
<label class="lk-ck"><input type="checkbox" name="termeni"> <span>Sunt de acord cu <a href="${s.termeni_url}" target="_blank">termenii și condițiile</a> *</span></label>
<button type="submit">Trimite</button>
<div class="lk-msg" role="status"></div>
</form></section>`;
  return `/* ${s.marca} — formular ofertă · Kit legal ${VERSIUNE} */
(function(){
  if (document.getElementById("oferta") && document.getElementById("oferta").classList.contains("lk")) return;
  var cur = document.currentScript;
  var st = document.createElement("style"); st.textContent = ${JSON.stringify(css)}; document.head.appendChild(st);
  if (!document.querySelector('link[href*="family=Fraunces"]')) { var l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600&display=swap"; document.head.appendChild(l); }
  var w = document.createElement("div"); w.innerHTML = ${JSON.stringify(html)};
  var sec = w.firstElementChild;
  var tinta = document.getElementById("lead-form");
  if (tinta) tinta.appendChild(sec); else if (cur && cur.parentNode) cur.parentNode.insertBefore(sec, cur); else document.body.appendChild(sec);
  var f = sec.querySelector("form"), m = sec.querySelector(".lk-msg"), b = sec.querySelector("button");
  f.addEventListener("submit", function(e){
    e.preventDefault();
    var d = { pagina: location.href };
    ["nume","firma","email","telefon","website"].forEach(function(k){ d[k] = f.elements[k].value; });
    ["com_telefon","com_sms","com_whatsapp","com_email","reclame","politica","termeni"].forEach(function(k){ d[k] = f.elements[k].checked; });
    m.className = "lk-msg"; m.textContent = "Se trimite…"; b.disabled = true;
    fetch("/legal/api/lead", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d) })
      .then(function(r){ return r.json().then(function(j){ return [r.ok, j]; }); })
      .then(function(x){
        b.disabled = false;
        if (!x[0]) { m.className = "lk-msg lk-err"; m.textContent = x[1].eroare || "Eroare."; return; }
        m.className = "lk-msg lk-ok"; m.textContent = "Mulțumim! Am primit datele și vă contactăm în curând cu o ofertă personalizată."; f.reset();
      })
      .catch(function(){ b.disabled = false; m.className = "lk-msg lk-err"; m.textContent = "Nu s-a putut trimite. Scrieți-ne la ${s.email}."; });
  });
})();`;
}

// ---------- pagini legale ----------
function pagina(s, titlu, corp) {
  return new Response(`<!doctype html>
<!-- ${esc(s.marca)} · Kit legal ${VERSIUNE} -->
<html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titlu)} — ${esc(s.marca)}</title>
<meta name="robots" content="index,follow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#f6f4ef;--card:#fff;--ink:#16202a;--muted:#5d6873;--line:#e2ddd2;--acc:${s.culoare}}
@media (prefers-color-scheme:dark){:root{--bg:#11161b;--card:#1a2128;--ink:#e8e4dc;--muted:#9aa4ad;--line:#2a333c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15.5px/1.6 Inter,system-ui,sans-serif}
.w{max-width:860px;margin:0 auto;padding:0 16px}
nav{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--line)}
nav a{color:var(--ink);text-decoration:none;font-weight:500;font-size:14px}nav a.b{font-weight:600}nav .l a{margin-left:14px}
h1{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:clamp(28px,5vw,40px);line-height:1.15;margin:28px 0 6px}
.sub{color:var(--muted);margin:0 0 20px}
.c{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;margin-bottom:20px}
h2{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:21px;margin:22px 0 6px}h2:first-child{margin-top:0}
a{color:var(--acc)}table{border-collapse:collapse;width:100%;font-size:14.5px}td,th{border:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}
label{display:block;font-weight:600;font-size:14px;margin:12px 0 4px}input,select,textarea{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}
textarea{min-height:110px}button{margin-top:14px;background:var(--acc);color:#fff;border:0;border-radius:9px;padding:12px 20px;font:600 15px Inter,sans-serif;cursor:pointer}
.hp{position:absolute;left:-9999px}#msg{margin-top:12px;font-weight:600}.ok{color:#2d7a46}.err{color:#b23a3a}
footer{margin:30px 0;padding-top:14px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}footer a{color:var(--muted)}
</style></head><body><div class="w">
<nav><a class="b" href="/">← ${esc(s.marca)}</a><span class="l"><a href="/legal/confidentialitate">Confidențialitate</a><a href="/legal/termeni">Termeni</a><a href="/legal/cerere">Cerere date personale</a></span></nav>
<h1>${esc(titlu)}</h1><p class="sub">${esc(s.operator)} · ${esc(s.site)} · versiunea ${VERSIUNE}</p>
${corp}
<footer>${esc(s.operator)} · CUI ${esc(s.cui)} · ${esc(s.reg)} · ${esc(s.adresa)} · <a href="mailto:${esc(s.email)}">${esc(s.email)}</a></footer>
</div></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}

function operatorHtml(s) {
  return `<p><b>${esc(s.operator)}</b>, CUI ${esc(s.cui)}, Nr. Reg. Com. ${esc(s.reg)}, cu sediul în ${esc(s.adresa)}. Contact pentru orice întrebare privind datele: <a href="mailto:${esc(s.email)}">${esc(s.email)}</a>.</p>`;
}

function confidentialitate(s) {
  const extra = s.servicii_extra.map(x => `<li>${esc(x)}</li>`).join("");
  return `<div class="c">
<h2>1. Cine prelucrează datele</h2>${operatorHtml(s)}
<h2>2. Ce date prelucrăm și de ce</h2>
<table><tr><th>Situație</th><th>Date</th><th>Scop</th><th>Temei (GDPR)</th></tr>
<tr><td>Formularul „primiți o ofertă personalizată”</td><td>nume, firmă, email, telefon, opțiunile bifate</td><td>să vă trimitem ${esc(s.scop_formular)}</td><td>art. 6 alin. 1 lit. b (demersuri la cererea dumneavoastră)</td></tr>
<tr><td>Comunicări comerciale (Telefon / SMS / WhatsApp / E-mail), doar dacă le-ați bifat</td><td>nume, email, telefon</td><td>oferte și noutăți pe canalele alese</td><td>art. 6 alin. 1 lit. a (consimțământ)</td></tr>
<tr><td>Reclame personalizate, doar dacă ați bifat</td><td>email, telefon</td><td>afișarea de reclame relevante (custom audience)</td><td>art. 6 alin. 1 lit. a (consimțământ)</td></tr>
<tr><td>Cereri privind datele personale</td><td>nume, email, mesajul</td><td>rezolvarea cererii</td><td>art. 6 alin. 1 lit. c (obligație legală)</td></tr>
</table>
${extra ? `<p>Alte servicii ale site-ului:</p><ul>${extra}</ul>` : ""}
<p>Păstrăm data și textul exact al fiecărui acord bifat, ca dovadă a consimțământului.</p>
<h2>3. Cât timp păstrăm datele</h2>
<p>Datele din formularul de ofertă: cel mult 2 ani de la ultimul contact, dacă nu devenim parteneri contractuali. Acordurile pentru comunicări comerciale: până la retragerea lor. Cererile privind datele: 3 ani, pentru a putea dovedi că le-am rezolvat.</p>
<h2>4. Cine are acces</h2>
<p>Datele sunt stocate în infrastructura Cloudflare (UE și SUA, cu clauze contractuale standard) și trimise pe email prin furnizorul Resend. Nu vindem datele. Pentru reclame personalizate, doar dacă ați bifat, datele pot fi transmise platformelor de publicitate (de exemplu Google), în formă criptată.</p>
<h2>5. Drepturile dumneavoastră</h2>
<p>Aveți dreptul de acces, rectificare, ștergere, restricționare, portabilitate, opoziție și de a retrage oricând consimțământul, fără a afecta prelucrarea anterioară (art. 15–22 GDPR). Le puteți exercita din pagina <a href="/legal/cerere">Cerere date personale</a> sau la <a href="mailto:${esc(s.email)}">${esc(s.email)}</a>. Răspundem în cel mult o lună. Aveți și dreptul de a depune plângere la ANSPDCP (<a href="https://www.dataprotection.ro" rel="noopener">dataprotection.ro</a>).</p>
<h2>6. Cookies</h2>
<p>Formularul și aceste pagini nu folosesc cookies de urmărire. Dacă site-ul folosește alte instrumente, ele sunt descrise în politica de cookies a site-ului.</p>
</div>`;
}

function termeni(s) {
  return `<div class="c">
<h2>1. Furnizorul</h2>${operatorHtml(s)}
<h2>2. Utilizarea site-ului</h2>
<p>Informațiile de pe ${esc(s.site)} au caracter general și nu constituie o ofertă fermă sau o consultanță personalizată, până la confirmarea scrisă a ${esc(s.operator)}.</p>
<h2>3. Formularul de ofertă</h2>
<p>Trimiterea formularului nu creează obligații contractuale. Vă contactăm cu ${esc(s.scop_formular)}; contractul se încheie doar prin acordul scris al ambelor părți.</p>
<h2>4. Proprietate intelectuală</h2>
<p>Conținutul site-ului aparține ${esc(s.operator)} sau partenerilor săi și nu poate fi copiat în scop comercial fără acord.</p>
<h2>5. Date personale</h2>
<p>Prelucrarea datelor este descrisă în <a href="${s.politica_url}">politica de prelucrare a datelor personale</a>.</p>
<h2>6. Răspundere și legea aplicabilă</h2>
<p>Site-ul este oferit „ca atare”. Termenii sunt guvernați de legea română; litigiile se soluționează pe cale amiabilă sau de instanțele competente din România. Consumatorii pot folosi și platforma SOL a Comisiei Europene.</p>
</div>`;
}

function cerereHtml(s) {
  const opt = Object.entries(TIPURI_CERERE).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  return `<div class="c">
<p>Folosiți formularul pentru a afla ce date avem despre dumneavoastră, pentru a le corecta sau șterge, pentru a vă opune prelucrării ori pentru a retrage un acord. Răspundem pe email în cel mult o lună.</p>
<form id="g" novalidate>
<label for="nume">Numele dumneavoastră *</label><input id="nume" autocomplete="name" maxlength="120">
<label for="email">Email *</label><input id="email" type="email" autocomplete="email" maxlength="160">
<label for="tip">Tipul cererii *</label><select id="tip"><option value="">Alegeți</option>${opt}</select>
<label for="mesaj">Detalii (opțional)</label><textarea id="mesaj" maxlength="2000"></textarea>
<div class="hp" aria-hidden="true"><input id="website" tabindex="-1" autocomplete="off"></div>
<button type="submit">Trimite cererea</button><div id="msg" role="status"></div>
</form></div>
<script>
document.getElementById("g").addEventListener("submit", function(e){
  e.preventDefault(); var m = document.getElementById("msg"), b = this.querySelector("button");
  var d = {}; ["nume","email","tip","mesaj","website"].forEach(function(k){ d[k] = document.getElementById(k).value; });
  m.className = ""; m.textContent = "Se trimite…"; b.disabled = true;
  fetch("/legal/api/cerere", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d) })
    .then(function(r){ return r.json().then(function(j){ return [r.ok, j]; }); })
    .then(function(x){ b.disabled = false;
      if (!x[0]) { m.className = "err"; m.textContent = x[1].eroare || "Eroare."; return; }
      document.getElementById("g").outerHTML = '<p class="ok" style="font-size:18px">✓ Cererea a fost trimisă. Numărul ei: <b>' + x[1].nr + '</b>. Vă răspundem pe email.</p>'; })
    .catch(function(){ b.disabled = false; m.className = "err"; m.textContent = "Nu s-a putut trimite. Scrieți-ne la ${esc(s.email)}."; });
});
</script>`;
}

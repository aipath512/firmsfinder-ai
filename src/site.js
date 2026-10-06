// src/site.js — Crawler propriu v0.1 (2026-10-06): găsește site-ul unei firme, îl verifică după CUI/nume, extrage datele.
// GET /admin/site?cui=123&k=TOKEN  → caută, verifică, salvează în D1 firme_site, întoarce rezultatul.
// Tokenul stă în D1 (config.admin_token). Fără serviciu extern: doar fetch din Worker.

const FORME = /\b(S\.?\s?R\.?\s?L\.?|S\.?\s?A\.?|S\.?\s?C\.?\s?S\.?|S\.?\s?N\.?\s?C\.?|SRL-D|SRL|SA|PFA|II|IF|SOCIETATE|COMPANY|ROMANIA|ROMÂNIA)\b/gi;

function curata(nume) {
  return nume.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(FORME, " ").replace(/[^A-Za-z0-9& ]+/g, " ")
    .replace(/&/g, " and ").replace(/\s+/g, " ").trim().toLowerCase();
}

export function candidati(denumire) {
  const c = curata(denumire);
  const w = c.split(" ").filter(x => x && x !== "and");
  if (!w.length) return [];
  const baze = new Set([w.join(""), w.join("-")]);
  if (w.length > 1) baze.add(w[0]);
  if (w.length > 2) { baze.add(w.slice(0, 2).join("")); baze.add(w.slice(0, 2).join("-")); }
  const out = [];
  for (const b of baze) if (b.length >= 3 && b.length <= 40) for (const tld of ["ro", "com", "eu"]) out.push(b + "." + tld);
  return out.slice(0, 12);
}

async function ia(url, ms = 6000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { redirect: "follow", signal: ac.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; FirmsFinderBot/0.1; +https://1clic-ia.eu/legal/confidentialitate)", "accept": "text/html" } });
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

function verifica(html, cui, denumire) {
  const t = textDin(html);
  const cifre = t.replace(/\s/g, "");
  if (new RegExp("(RO)?" + cui + "(?!\\d)").test(cifre)) return "cui";
  const n = curata(denumire);
  const tn = curata(t);
  if (n.length >= 5 && n.includes(" ") && tn.includes(n)) return "nume";
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

export async function site(url, env, ctx) {
  const p = url.searchParams;
  const tok = await env.DB.prepare("SELECT valoare FROM config WHERE cheie='admin_token'").first();
  if (!tok || p.get("k") !== tok.valoare) return new Response("Acces interzis.", { status: 403 });
  const cui = Number(p.get("cui"));
  if (ctx && p.get("fundal") === "1") { ctx.waitUntil(proceseaza(cui, env)); return Response.json({ pornit: true, cui }); }
  return proceseaza(cui, env);
}

async function proceseaza(cui, env) {
  const f = await env.DB.prepare("SELECT cui, denumire, web FROM onrc_firme WHERE cui = ?").bind(cui).first();
  if (!f) return Response.json({ eroare: "CUI negăsit" }, { status: 404 });
  const incercari = [];
  const lista = [];
  if (f.web) lista.push(f.web.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
  lista.push(...candidati(f.denumire));
  let gasit = null;
  const dom = [...new Set(lista)];
  // în paralel: întâi fără www, apoi cu www doar unde nu a răspuns
  const r1 = await Promise.all(dom.map(d => ia("https://" + d, 5000)));
  const r2 = await Promise.all(dom.map((d, i) => r1[i] ? null : ia("https://www." + d, 5000)));
  for (let i = 0; i < dom.length; i++) {
    const r = r1[i] || r2[i];
    const d = dom[i];
    if (!r) { incercari.push(d + " → nimic"); continue; }
    const v = verifica(r.html, f.cui, f.denumire);
    if (!v) { incercari.push(d + " → răspunde, dar nu e firma"); continue; }
    incercari.push(d + " → GĂSIT (" + v + ")");
    if (!gasit) gasit = { ...r, domeniu: d, metoda: (f.web && i === 0 ? "onrc+" : "ghicit+") + v };
  }
  let rez = { cui: f.cui, denumire: f.denumire, gasit: !!gasit, incercari };
  if (gasit) {
    const e = extrage(gasit.html, gasit.url);
    const pagini = [];
    let text = textDin(gasit.html).slice(0, 1500);
    const sub = await Promise.all(e.linkuri.map(l => ia(l.u, 5000)));
    for (const r of sub) {
      if (!r) continue;
      const e2 = extrage(r.html, r.url);
      e.emailuri = [...new Set([...e.emailuri, ...e2.emailuri])].slice(0, 5);
      e.telefoane = [...new Set([...e.telefoane, ...e2.telefoane])].slice(0, 5);
      pagini.push(r.url);
      text += "\n---\n" + textDin(r.html).slice(0, 1200);
    }
    rez = { ...rez, domeniu: gasit.domeniu, url: gasit.url, metoda: gasit.metoda, titlu: e.titlu, descriere: e.descriere, emailuri: e.emailuri, telefoane: e.telefoane, are_jsonld: !!e.jsonld, pagini };
    await env.DB.prepare(`INSERT OR REPLACE INTO firme_site (cui, denumire, domeniu, url, verificat, metoda, incercari, titlu, descriere, emailuri, telefoane, jsonld, pagini, text_scurt, data)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
      .bind(f.cui, f.denumire, gasit.domeniu, gasit.url, gasit.metoda, incercari.join("\n"), e.titlu, e.descriere, e.emailuri.join(", "), e.telefoane.join(", "), e.jsonld, pagini.join("\n"), text.slice(0, 6000)).run();
  } else {
    await env.DB.prepare(`INSERT OR REPLACE INTO firme_site (cui, denumire, verificat, metoda, incercari, data) VALUES (?, ?, 0, 'negasit', ?, datetime('now'))`)
      .bind(f.cui, f.denumire, incercari.join("\n")).run();
  }
  return Response.json(rez);
}

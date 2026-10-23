
 // src/site.js v0.7 — SAFE INDIVIDUAL CRAWLER
 // Candidat pentru testare. Nu este validat în producție.
 //
 // D1:
 // config(cheie UNIQUE, valoare)
 // onrc_firme(cui, denumire, web, localitate, judet)
 // firme_site(cui UNIQUE, denumire, domeniu, url,
 //   verificat, metoda, incercari, titlu, descriere,
 //   emailuri, telefoane, jsonld, pagini, text_scurt, data)
 //
 // verificat: 1=confirmat, 2=probabil, 0=negasit

const MAX_REQUESTS = 24;
const MAX_DOMAINS = 6;
const MAX_REDIRECTS = 2;
const MAX_BYTES = 500000;
const MAX_MS = 22000;
const DAILY_JOBS = 30;
const BRAVE_DAILY = 30;

const PARKED =
  /domain (?:is )?for sale|buy this domain|domain parking|sedoparking|afternic|hugedomains|domeniu(?:l)? de vanzare/i;

const STOP = new Set([
  "and", "si", "de", "la", "din", "cu",
  "the", "of", "pentru"
]);

const BLOCKED = new Set([
  "facebook.com",
  "linkedin.com",
  "instagram.com",
  "youtube.com",
  "wikipedia.org",
  "termene.ro",
  "listafirme.ro",
  "risco.ro",
  "opencorporates.com",
  "anaf.ro",
  "onrc.ro",
  "google.com"
]);

const plain = s =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function clean(s) {
  return plain(s)
    .replace(
      /\b(?:s\.?\s*r\.?\s*l\.?|s\.?\s*a\.?|pfa|srl-d|sc|ii|if)\b/g,
      " "
    )
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(s) {
  return clean(s)
    .split(" ")
    .filter(x => x.length > 1 && !STOP.has(x));
}

export function candidati(name) {
  const w = words(name);
  if (!w.length) return [];

  const bases = new Set([
    w.join(""),
    w.join("-")
  ]);

  if (w.length > 1 && w[0].length >= 5) {
    bases.add(w[0]);
  }

  if (w.length > 2) {
    bases.add(w.slice(0, 2).join(""));
    bases.add(w.slice(0, 2).join("-"));
  }

  return [...bases]
    .filter(x => x.length >= 5 && x.length <= 40)
    .flatMap(x =>
      ["ro", "com", "eu"].map(t => x + "." + t)
    )
    .slice(0, MAX_DOMAINS);
}

function cuiValid(x) {
  const s = String(x ?? "");

  return /^[1-9]\d{0,9}$/.test(s) &&
    Number.isSafeInteger(Number(s))
    ? Number(s)
    : null;
}

function hostOK(host) {
  const h = host.toLowerCase().replace(/\.$/, "");

  if (
    h.length > 253 ||
    !h.includes(".") ||
    h.includes(":")
  ) {
    return false;
  }

  const labels = h.split(".");

  if (
    labels.some(
      x =>
        !x ||
        x.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(x)
    )
  ) {
    return false;
  }

  if (/^\d/.test(labels.at(-1))) return false;

  if (
    ["local", "localhost", "internal", "test", "invalid"]
      .includes(labels.at(-1))
  ) {
    return false;
  }

  if (labels.includes("localhost")) return false;

  if (
    [...BLOCKED].some(
      x => h === x || h.endsWith("." + x)
    )
  ) {
    return false;
  }

  return true;
}

function safeURL(raw) {
  try {
    const u = new URL(raw);

    return (
      (u.protocol === "https:" || u.protocol === "http:") &&
      !u.username &&
      !u.password &&
      !u.port &&
      hostOK(u.hostname)
    );
  } catch {
    return false;
  }
}

function origin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function entities(s) {
  return String(s).replace(
    /&(#x[\da-f]+|#\d+|amp|nbsp|quot|apos|lt|gt);/gi,
    (m, k) => {
      const named = {
        amp: "&",
        nbsp: " ",
        quot: '"',
        apos: "'",
        lt: "<",
        gt: ">"
      };

      if (k[0] !== "#") {
        return named[k.toLowerCase()] ?? m;
      }

      const n =
        k[1].toLowerCase() === "x"
          ? parseInt(k.slice(2), 16)
          : parseInt(k.slice(1), 10);

      return (
        n > 0 &&
        n <= 0x10ffff &&
        (n < 0xd800 || n > 0xdfff)
      )
        ? String.fromCodePoint(n)
        : m;
    }
  );
}

function textDin(html) {
  return entities(
    String(html)
      .replace(
        /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
        " "
      )
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function timeoutLeft(b) {
  return Math.max(0, b.deadline - Date.now());
}

async function ia(url, b, ms = 4000) {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (
      !safeURL(current) ||
      b.n >= MAX_REQUESTS ||
      timeoutLeft(b) < 300
    ) {
      return null;
    }

    b.n++;

    const ac = new AbortController();
    const timer = setTimeout(
      () => ac.abort(),
      Math.min(ms, timeoutLeft(b))
    );

    try {
      const r = await fetch(current, {
        redirect: "manual",
        signal: ac.signal,
        headers: {
          accept: "text/html",
          "user-agent":
            "FirmsFinderBot/0.7 (+https://firmsfinder.eu/)"
        }
      });

      if ([301, 302, 303, 307, 308].includes(r.status)) {
        if (hop === MAX_REDIRECTS) return null;

        const loc = r.headers.get("location");
        if (!loc) return null;

        const next = new URL(loc, current).href;

        if (!origin(next, current) || !safeURL(next)) {
          return null;
        }

        current = next;
        continue;
      }

      if (
        !r.ok ||
        !/text\/html|application\/xhtml\+xml/i.test(
          r.headers.get("content-type") || ""
        )
      ) {
        return null;
      }

      const reader = r.body?.getReader();
      if (!reader) return null;

      const parts = [];
      let len = 0;

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        len += value.byteLength;

        if (len > MAX_BYTES) {
          await reader.cancel();
          return null;
        }

        parts.push(value);
      }

      const bytes = new Uint8Array(len);
      let pos = 0;

      for (const part of parts) {
        bytes.set(part, pos);
        pos += part.length;
      }

      return {
        url: current,
        html: new TextDecoder().decode(bytes)
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

function cuiEvidence(html, cui) {
  if (cuiValid(cui) === null) return false;

  const t = textDin(html);
  const id = String(cui);

  const pattern = new RegExp(
    "(?:CUI|CIF|cod(?:ul)? fiscal|" +
    "cod unic de inregistrare|VAT(?: number| no)?)" +
    "\\s*[:#.-]?\\s*(?:RO\\s*)?" +
    id +
    "(?!\\d)",
    "i"
  );

  if (!pattern.test(t)) return false;

  const all = [
    ...t.matchAll(
      /\b(?:CUI|CIF|cod fiscal|cod unic de inregistrare)\s*[:#.-]?\s*(?:RO\s*)?\d{2,10}\b/gi
    )
  ];

  return all.length <= 3;
}

function legalLinks(r) {
  const found = [];

  for (
    const m of r.html.matchAll(
      /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi
    )
  ) {
    try {
      const u = new URL(
        entities(m[1]),
        r.url
      ).href;

      if (
        origin(u, r.url) &&
        safeURL(u) &&
        /contact|termen|terms|legal|confiden|privacy|gdpr|despre|about|impressum|date.firma/i.test(
          textDin(m[2]) + " " + u
        )
      ) {
        found.push(u);
      }
    } catch {}
  }

  return [...new Set(found)].slice(0, 2);
}

async function verificaSite(r, f, b) {
  if (cuiEvidence(r.html, f.cui)) {
    return "cui-home";
  }

  for (const u of legalLinks(r)) {
    const sub = await ia(u, b);

    if (sub && cuiEvidence(sub.html, f.cui)) {
      return "cui-legal";
    }
  }

  return null;
}

function probable(r, d, f) {
  const w = words(f.denumire);

  const base = d
    .replace(/^www\./, "")
    .replace(/\.(ro|com|eu)$/, "");

  if (
    !w.length ||
    ![w.join(""), w.join("-")].includes(base)
  ) {
    return false;
  }

  const t = plain(textDin(r.html));

  if (PARKED.test(t) || t.length < 400) {
    return false;
  }

  const loc = plain(f.localitate || "")
    .replace(
      /^(municipiul|oras|orasul|comuna|sat)\s+/,
      ""
    )
    .split(/[ ,]/)[0];

  return Boolean(
    loc.length >= 4 &&
    t.includes(loc) &&
    /romania|\+40|\b07\d{8}\b/.test(t)
  );
}

function extract(html) {
  const t = textDin(html);

  const title =
    html.match(
      /<title\b[^>]*>([\s\S]*?)<\/title>/i
    )?.[1] || "";

  const meta = [
    ...html.matchAll(/<meta\b[^>]*>/gi)
  ].map(x => x[0]);

  let desc = "";

  for (const tag of meta) {
    if (
      !/\bname\s*=\s*["']description["']/i.test(tag) &&
      !/\bproperty\s*=\s*["']og:description["']/i.test(tag)
    ) {
      continue;
    }

    desc =
      tag.match(
        /\bcontent\s*=\s*["']([^"']*)["']/i
      )?.[1] || "";

    if (desc) break;
  }

  const emails = [
    ...new Set(
      (
        t.match(
          /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
        ) || []
      ).filter(
        x => !/example|sentry|wixpress/i.test(x)
      )
    )
  ].slice(0, 5);

  const phones = [
    ...new Set(
      (
        t.match(
          /(?:\+40|0040|0)[\s.-]?[237]\d{1,2}[\s.-]?\d{3}[\s.-]?\d{3,4}/g
        ) || []
      ).map(
        x => x.replace(/[\s.-]/g, "")
      )
    )
  ].slice(0, 5);

  const ld = (
    html.match(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
    ) || []
  )
    .join("\n")
    .slice(0, 8000);

  return {
    titlu: entities(title).slice(0, 300),
    descriere: entities(desc).slice(0, 300),
    emailuri: emails,
    telefoane: phones,
    jsonld: ld,
    text: t.slice(0, 6000)
  };
}

async function reserve(env, key, max) {
  const day = new Date().toISOString().slice(0, 10);

  const r = await env.DB.prepare(`
    INSERT INTO config(cheie,valoare)
    VALUES(?,?)
    ON CONFLICT(cheie) DO UPDATE SET
      valoare=CASE
        WHEN substr(config.valoare,1,10)=?
        THEN ?||':'||
          (CAST(substr(config.valoare,12) AS INTEGER)+1)
        ELSE ?||':1'
      END
    WHERE substr(config.valoare,1,10)<>?
       OR CAST(substr(config.valoare,12) AS INTEGER)<?
  `)
    .bind(
      key,
      day + ":1",
      day,
      day,
      day,
      day,
      max
    )
    .run();

  return r.meta?.changes === 1;
}

async function braveSearch(f, env, b) {
  if (
    !env.BRAVE_KEY ||
    b.n >= MAX_REQUESTS ||
    timeoutLeft(b) < 1500
  ) {
    return [];
  }

  let allowed = false;

  try {
    allowed = await reserve(
      env,
      "brave_zi",
      BRAVE_DAILY
    );
  } catch (e) {
    console.error("BRAVE_QUOTA", String(e));
  }

  if (!allowed) return [];

  b.n++;

  const ac = new AbortController();
  const timer = setTimeout(
    () => ac.abort(),
    Math.min(3500, timeoutLeft(b))
  );

  try {
    const q =
      '"' +
      String(f.denumire).replace(/"/g, "") +
      '" ' +
      (f.localitate || "");

    const r = await fetch(
      "https://api.search.brave.com/res/v1/web/search" +
      "?count=5&q=" + encodeURIComponent(q),
      {
        signal: ac.signal,
        headers: {
          accept: "application/json",
          "x-subscription-token": env.BRAVE_KEY
        }
      }
    );

    if (!r.ok) return [];

    const j = await r.json();

    return [
      ...new Set(
        (j.web?.results || [])
          .map(x => x.url)
          .filter(safeURL)
      )
    ].slice(0, 2);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function salveaza(
  env,
  f,
  found,
  attempts,
  b
) {
  const rez = {
    cui: f.cui,
    denumire: f.denumire,
    gasit: !!found,
    nivel: found
      ? found.nivel === 1
        ? "confirmat"
        : "probabil"
      : "negasit",
    incercari: attempts,
    cereri: b.n
  };

  if (!found) {
    await env.DB.prepare(`
      INSERT INTO firme_site
        (cui,denumire,verificat,metoda,incercari,data)
      VALUES
        (?,?,0,'negasit',?,datetime('now'))
      ON CONFLICT(cui) DO NOTHING
    `)
      .bind(
        f.cui,
        f.denumire,
        attempts.join("\n")
      )
      .run();

    return rez;
  }

  const e = extract(found.html);

  const r = await env.DB.prepare(`
    INSERT INTO firme_site
      (
        cui,denumire,domeniu,url,verificat,
        metoda,incercari,titlu,descriere,
        emailuri,telefoane,jsonld,pagini,
        text_scurt,data
      )
    VALUES
      (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,
        datetime('now')
      )
    ON CONFLICT(cui) DO UPDATE SET
      denumire=excluded.denumire,
      domeniu=excluded.domeniu,
      url=excluded.url,
      verificat=excluded.verificat,
      metoda=excluded.metoda,
      incercari=excluded.incercari,
      titlu=excluded.titlu,
      descriere=excluded.descriere,
      emailuri=excluded.emailuri,
      telefoane=excluded.telefoane,
      jsonld=excluded.jsonld,
      pagini=excluded.pagini,
      text_scurt=excluded.text_scurt,
      data=datetime('now')
    WHERE COALESCE(firme_site.verificat,0)=0
       OR (
         firme_site.verificat=2
         AND excluded.verificat=1
       )
  `)
    .bind(
      f.cui,
      f.denumire,
      found.domeniu,
      found.url,
      found.nivel,
      found.metoda,
      attempts.join("\n"),
      e.titlu,
      e.descriere,
      e.emailuri.join(", "),
      e.telefoane.join(", "),
      e.jsonld,
      "",
      e.text
    )
    .run();

  return {
    ...rez,
    domeniu: found.domeniu,
    url: found.url,
    stored: r.meta?.changes === 1,
    cereri: b.n
  };
}

export async function proceseaza(
  cui,
  env,
  cuBrave = false
) {
  cui = cuiValid(cui);

  if (cui === null) {
    return { eroare: "INVALID_CUI" };
  }

  const f = await env.DB.prepare(`
    SELECT cui,denumire,web,localitate,judet
    FROM onrc_firme
    WHERE cui=?
  `)
    .bind(cui)
    .first();

  if (!f) {
    return { eroare: "CUI_NEGASIT" };
  }

  const b = {
    n: 0,
    deadline: Date.now() + MAX_MS
  };

  const attempts = [];
  const candidates = [];

  if (f.web) {
    try {
      const u = new URL(
        /^https?:\/\//i.test(f.web)
          ? f.web
          : "https://" + f.web
      );

      if (safeURL(u.origin)) {
        candidates.push(
          u.hostname.replace(/^www\./, "")
        );
      }
    } catch {}
  }

  candidates.push(
    ...candidati(f.denumire)
  );

  let found = null;
  let prob = null;

  for (
    const d of [...new Set(candidates)]
      .slice(0, MAX_DOMAINS)
  ) {
    if (
      b.n >= MAX_REQUESTS ||
      timeoutLeft(b) < 500
    ) {
      break;
    }

    const r =
      await ia("https://" + d, b) ||
      await ia("https://www." + d, b);

    if (!r) {
      attempts.push(d + ": unavailable");
      continue;
    }

    if (PARKED.test(textDin(r.html))) {
      attempts.push(d + ": parked");
      continue;
    }

    const v = await verificaSite(
      r,
      f,
      b
    );

    if (v) {
      found = {
        ...r,
        domeniu: d,
        nivel: 1,
        metoda: "cui+" + v
      };

      attempts.push(d + ": " + v);
      break;
    }

    if (
      !prob &&
      probable(r, d, f)
    ) {
      prob = {
        ...r,
        domeniu: d,
        nivel: 2,
        metoda: "probabil"
      };
    }

    attempts.push(
      d + ": unconfirmed"
    );
  }

  if (!found && cuBrave) {
    const urls = await braveSearch(f, env, b);

    for (const u of urls) {
      if (
        b.n >= MAX_REQUESTS ||
        timeoutLeft(b) < 500
      ) {
        break;
      }

      const r = await ia(u, b);
      if (!r) continue;

      const v = await verificaSite(
        r,
        f,
        b
      );

      if (v) {
        found = {
          ...r,
          domeniu: new URL(r.url)
            .hostname
            .replace(/^www\./, ""),
          nivel: 1,
          metoda: "brave+" + v
        };
        break;
      }
    }
  }

  return salveaza(
    env,
    f,
    found || prob,
    attempts,
    b
  );
}

export async function lot() {
  return {
    error: "BATCH_CRAWLER_DISABLED",
    processed: 0
  };
}

export async function cron() {
  return {
    disabled: true,
    reason: "D1_COST_GUARD"
  };
}

function constantEqual(a, b) {
  let diff = 0;

  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}

export async function site(url, env, ctx) {
  const p = url.searchParams;

  if (p.has("lot")) {
    return Response.json(
      { error: "BATCH_CRAWLER_DISABLED" },
      { status: 503 }
    );
  }

  if (p.has("stat")) {
    return Response.json(
      { error: "STATS_DISABLED" },
      { status: 503 }
    );
  }

  if (p.has("fundal")) {
    return Response.json(
      { error: "BACKGROUND_DISABLED" },
      { status: 503 }
    );
  }

  const key = p.get("k");

  if (!key) {
    return new Response(
      "Acces interzis.",
      { status: 403 }
    );
  }

  let token;

  try {
    token = await env.DB.prepare(`
      SELECT valoare
      FROM config
      WHERE cheie='admin_token'
    `).first();
  } catch {
    return Response.json(
      { error: "CONFIG_DB_ERROR" },
      { status: 503 }
    );
  }

  if (
    !token ||
    !token.valoare ||
    key.length !== token.valoare.length ||
    !constantEqual(key, token.valoare)
  ) {
    return new Response(
      "Acces interzis.",
      { status: 403 }
    );
  }

  const cui = cuiValid(
    p.get("cui")
  );

  if (cui === null) {
    return Response.json(
      { error: "INVALID_CUI" },
      { status: 400 }
    );
  }

  let allowed;

  try {
    allowed = await reserve(
      env,
      "site_jobs_zi",
      DAILY_JOBS
    );
  } catch (e) {
    console.error(
      "SITE_QUOTA",
      String(e)
    );

    return Response.json(
      { error: "QUOTA_DB_ERROR" },
      { status: 503 }
    );
  }

  if (!allowed) {
    return Response.json(
      { error: "DAILY_QUOTA_REACHED" },
      { status: 429 }
    );
  }

  try {
    const result = await proceseaza(
      cui,
      env,
      false
    );

    return Response.json(
      result,
      {
        status: result.eroare ? 404 : 200,
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  } catch (e) {
    console.error(
      "SITE_ERROR",
      String(e)
    );

    return Response.json(
      { error: "PROCESSING_FAILED" },
      { status: 500 }
    );
  }
}

export {
  cuiEvidence as verifica,
  ia,
  verificaSite,
  salveaza,
  textDin,
  plain as fara
};

#!/usr/bin/env python3
"""site_ghicit v1.0 (2026-10-12)

Pentru fiecare firma din D1 (onrc_firme) care NU are inca rand in firme_site:
  1. genereaza domenii candidate din denumire (agrotora.ro, agro-tora.com, ...)
  2. verifica direct (DNS + HTTP) - fara motor de cautare, fara costuri
  3. confirma: CUI-ul apare pe pagina (verificat=1) sau numele identic cu domeniul (verificat=2)
  4. scrie rezultatul in firme_site (INSERT OR IGNORE - nu atinge randurile existente)

Ruleaza in GitHub Actions. Variabile: CF_ACCOUNT_ID, CF_API_TOKEN (obligatorii),
D1_DB_ID, MAX_MINUTES (330), CHUNK (3000), CONC (300).
Nu cauta contacte. PFA / intreprinderi individuale sunt sarite (date personale).
"""
import os, re, sys, json, time, html as htmlmod, asyncio, unicodedata
from urllib.parse import urlparse

DB_ID = os.environ.get("D1_DB_ID", "0d6de488-285f-458b-b4b0-5f9ac913c5f1")
MAX_MIN = float(os.environ.get("MAX_MINUTES", "330"))
CHUNK = int(os.environ.get("CHUNK", "3000"))
CONC = int(os.environ.get("CONC", "300"))
UA = "Mozilla/5.0 (compatible; AiVentureSiteCheck/1.0; +https://5thelement.ai; contact@5thelement.ai)"

# ---------------------------------------------------------------- nume -> domenii
LEGAL = {"srl", "sa", "sc", "snc", "scs", "sca", "ra"}
SKIP_RE = re.compile(r"persoana fizica|intreprindere individuala|intreprindere familiala|\bpfa\b")


def fold(s: str) -> str:
    return unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()


def candidates(den: str):
    """-> (lista domenii, core, tokeni)"""
    s = fold(den)
    s = re.sub(r"\bs\s*\.\s*r\s*\.\s*l\s*\.?", "srl", s)
    s = re.sub(r"\bs\s*\.\s*c\s*\.?", "sc", s)
    s = re.sub(r"\bs\s*\.\s*a\s*\.?", "sa", s)
    s = re.sub(r"srl\s*-\s*d\b", "srl", s)
    acr = re.findall(r"\(([a-z0-9]{3,10})\)", s)
    s = re.sub(r"\([^)]*\)", " ", s)
    toks = [t for t in re.split(r"[^a-z0-9]+", s) if t and t not in LEGAL]
    if not toks:
        return [], "", []
    core = "".join(toks)
    bases = list(acr)
    bases.append(core)
    if len(toks) > 1 and len(toks[0]) >= 6:
        bases.append(toks[0])
    if len(toks) > 1:
        bases.append("-".join(toks))
    if len(toks) > 2:
        bases.append("".join(toks[:2]))
    seen, out = set(), []
    for b in bases:
        if 4 <= len(b) <= 40 and b not in seen:
            seen.add(b)
            out.append(b)
    doms = [f"{b}.{tld}" for b in out[:4] for tld in ("ro", "com")]
    return doms[:8], core, toks


# ---------------------------------------------------------------- verificare pagina
PARK = re.compile(
    r"domain (is )?for sale|domeniu (de vanzare|parcat)|buy this domain|cumpara(ti)? acest domeniu|"
    r"this domain (is|may be)|parked|sedo\.com|dan\.com|hugedomains|website coming soon|"
    r"index of /|default web site page|welcome to nginx|apache2 (ubuntu )?default"
)


def text_of(html: str) -> str:
    h = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", html)
    h = re.sub(r"(?s)<[^>]+>", " ", h)
    h = htmlmod.unescape(h)
    return re.sub(r"\s+", " ", fold(h))


def has_cui(txt: str, cui) -> bool:
    c = str(int(cui))
    pat = (r"(?:\bcui\b|c\.?\s?u\.?\s?i\.?|\bcif\b|c\.?\s?i\.?\s?f\.?|cod\s+(?:unic|fiscal|identificare)|"
           r"\bvat\b|\btva\b|nr\.?\s*inreg|cod\s+fiscal)[^0-9]{0,25}(?:ro\s?)?" + c + r"(?!\d)")
    return re.search(pat, txt) is not None


def name_ok(txt: str, toks, label: str, core: str) -> bool:
    """verificare 'nume': eticheta domeniului == nume, iar toate cuvintele apar pe pagina"""
    if label.replace("-", "") != core:
        return False
    big = [t for t in toks if len(t) >= 3]
    return bool(big) and all(t in txt for t in big)


def meta(html: str):
    t = re.search(r"(?is)<title[^>]*>(.*?)</title>", html)
    d = re.search(r'(?is)<meta[^>]+name=["\']description["\'][^>]*content=["\'](.*?)["\']', html)
    clean = lambda x: re.sub(r"\s+", " ", htmlmod.unescape(x.group(1))).strip()[:300] if x else None
    return clean(t), clean(d)


# ---------------------------------------------------------------- retea
async def resolves(loop, host: str) -> bool:
    try:
        await asyncio.wait_for(loop.getaddrinfo(host, 443), 4)
        return True
    except Exception:
        return False


async def get(session, url: str):
    try:
        async with session.get(url, allow_redirects=True, max_redirects=5) as r:
            if r.status >= 400:
                return None
            ct = r.headers.get("content-type", "")
            if ct and "html" not in ct:
                return None
            b = await r.content.read(250_000)
            return str(r.url), b.decode("utf-8", "ignore")
    except Exception:
        return None


async def check(session, sem, loop, row):
    cui, den = row["cui"], row["denumire"] or ""
    if SKIP_RE.search(fold(den)):
        return cui, den, None, None, 0, "sarit-pfa", "PFA/II sarit", None, None
    doms, core, toks = candidates(den)
    if not doms:
        return cui, den, None, None, 0, "negasit", "fara-candidati", None, None
    notes = []
    for d in doms:
        async with sem:
            if not await resolves(loop, d):
                continue
            r = await get(session, "https://" + d) or await get(session, "http://" + d)
        if not r:
            notes.append(d + ":fara-pagina")
            continue
        url, html = r
        txt = text_of(html)
        ti, de = meta(html)
        dom = urlparse(url).hostname.removeprefix("www.") if urlparse(url).hostname else d
        if has_cui(txt, cui):
            return cui, den, dom, url, 1, "ghicit+cui", ";".join(notes) or "ok", ti, de
        if PARK.search(txt):
            notes.append(d + ":parcat")
            continue
        label = d.rsplit(".", 1)[0]
        if label.replace("-", "") == core or label in core:
            base = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
            for p in ("/contact", "/termeni-si-conditii", "/despre-noi", "/politica-de-confidentialitate"):
                async with sem:
                    r2 = await get(session, base + p)
                if r2 and has_cui(text_of(r2[1]), cui):
                    return cui, den, dom, url, 1, "ghicit+cui-pagina", ";".join(notes) or "ok", ti, de
        if name_ok(txt, toks, label, core):
            return cui, den, dom, url, 2, "ghicit+nume", ";".join(notes) or "ok", ti, de
        notes.append(d + ":nu-e-firma")
    return cui, den, None, None, 0, "negasit", ";".join(notes)[:500] or "niciun-domeniu-activ", None, None


# ---------------------------------------------------------------- D1 REST
async def d1(session, payload, tries=5):
    url = f"https://api.cloudflare.com/client/v4/accounts/{os.environ['CF_ACCOUNT_ID']}/d1/database/{DB_ID}/query"
    hdr = {"Authorization": "Bearer " + os.environ["CF_API_TOKEN"], "Content-Type": "application/json"}
    for i in range(tries):
        try:
            async with session.post(url, json=payload, headers=hdr, timeout=60) as r:
                j = await r.json()
                if r.status == 200 and j.get("success"):
                    return j["result"]
                err = json.dumps(j.get("errors"))[:300]
        except Exception as e:
            err = str(e)[:300]
        await asyncio.sleep(2 * (i + 1))
    raise RuntimeError("D1: " + err)


async def main():
    import aiohttp
    t0 = time.time()
    loop = asyncio.get_running_loop()
    conn = aiohttp.TCPConnector(limit=CONC, ttl_dns_cache=300, ssl=False)
    web = aiohttp.ClientSession(connector=conn, headers={"User-Agent": UA, "Accept-Language": "ro,en;q=0.5"},
                                timeout=aiohttp.ClientTimeout(total=12, connect=5))
    api = aiohttp.ClientSession()
    sem = asyncio.Semaphore(CONC)
    try:
        await d1(api, {"sql": "CREATE INDEX IF NOT EXISTS ix_onrc_cui_top ON onrc_firme(cui)"})
        cur = await d1(api, {"sql": "SELECT valoare FROM config WHERE cheie='ghicit_py_cursor'"})
        rows = cur[0]["results"]
        cursor = int(rows[0]["valoare"]) if rows else 0
        tot = {"1": 0, "2": 0, "0": 0}
        done = 0
        while (time.time() - t0) / 60 < MAX_MIN:
            res = await d1(api, {"sql": (
                "SELECT o.cui, o.denumire FROM onrc_firme o WHERE o.cui > ? AND o.top = 1 "
                "AND NOT EXISTS (SELECT 1 FROM firme_site s WHERE s.cui = o.cui) ORDER BY o.cui LIMIT ?"),
                "params": [cursor, CHUNK]})
            firme = res[0]["results"]
            if not firme:
                print("GATA: nu mai sunt firme neincercate dupa cui", cursor)
                break
            outs = await asyncio.gather(*[check(web, sem, loop, f) for f in firme], return_exceptions=True)
            stm = []
            for o in outs:
                if isinstance(o, Exception):
                    continue
                cui, den, dom, url, ver, met, inc, ti, de = o
                tot[str(ver)] += 1
                stm.append({"sql": "INSERT OR IGNORE INTO firme_site (cui, denumire, domeniu, url, verificat, metoda, incercari, titlu, descriere, data) "
                                   "VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))",
                            "params": [cui, den, dom, url, ver, met, inc, ti, de]})
            for i in range(0, len(stm), 80):
                await d1(api, {"batch": stm[i:i + 80]})
            cursor = int(firme[-1]["cui"])
            await d1(api, {"sql": "INSERT OR REPLACE INTO config (cheie, valoare) VALUES ('ghicit_py_cursor', ?)",
                           "params": [str(cursor)]})  # config.valoare e TEXT
            done += len(firme)
            print(f"[{(time.time()-t0)/60:6.1f} min] procesate={done} confirmat={tot['1']} probabil={tot['2']} negasit/sarit={tot['0']} cursor={cursor}", flush=True)
    finally:
        await web.close()
        await api.close()


if __name__ == "__main__":
    asyncio.run(main())

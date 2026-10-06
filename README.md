# FirmsFinder AI

**Descoperiți firmele pe care nu le știți: viitorii clienți.**

Căutare în 1,78 milioane de firme active din România (ONRC) cu bilanțurile Ministerului Finanțelor 2023–2025.

- `public/index.html` — pagina de căutare
- `src/worker.js` — API (`/api/caen`, `/api/stari`, `/api/cauta`) peste Cloudflare D1 `b2b-romania-db`
- `wrangler.toml` — configurarea Cloudflare Worker (legătura cu D1)

Sursa datelor: ONRC / Ministerul Finanțelor, data.gov.ro (OGL-ROU-1.0).
© AiVenture S.R.L. — v1.0, 2026-10-06

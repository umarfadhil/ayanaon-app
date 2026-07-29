# Cloudflare Migration - Step 1 Handoff

Status: Complete on 2026-07-29. This document is the redacted implementation baseline for the AyaNaon Netlify-to-Cloudflare migration.

## Security rule

- Never add credential values, connection strings, API keys, tokens, or passwords to this file or any committed file.
- Live values belong in Netlify/Cloudflare encrypted secrets or a password manager.
- Credentials exposed in the original desktop inventory must be rotated before production cutover.

## Cost and usage baseline

- Current Netlify plan: Free, 300 credits per billing period.
- Credit history: 265, then 299, then 334 credits.
- Latest period: 34 credits over the allowance (about 11.3%).
- The chart visually attributes most usage to Functions & Agent Compute and bandwidth, with production-deploy spikes.
- Target: Cloudflare Workers Paid (minimum USD 5/month) because AyaNaon includes bcrypt, SSR, MongoDB, and buffered photo uploads that are unsafe against the Workers Free 10 ms CPU limit.

## Authoritative DNS baseline

- Registrar: Hostinger.
- Current authoritative DNS: Netlify/NS1.
- Nameservers:
  - `dns1.p05.nsone.net`
  - `dns2.p05.nsone.net`
  - `dns3.p05.nsone.net`
  - `dns4.p05.nsone.net`
- Complete zone contains exactly three records:
  - Apex `ayanaon.app`, TTL 3600, Netlify target `ayanaon.netlify.app`.
  - `www.ayanaon.app`, TTL 3600, Netlify target `ayanaon.netlify.app`.
  - Apex TXT Google site verification; preserve the existing value unchanged.
- Hostinger shows no configured DNSSEC/DS entry. DNSSEC is currently disabled.
- Netlify's custom `NETLIFY` record type cannot be copied literally to Cloudflare. Recreate temporary Netlify targets as Cloudflare CNAMEs, then replace `www` with the Worker Custom Domain at cutover.
- Canonical production host remains `https://www.ayanaon.app`; apex must permanently redirect to `www` while preserving path and query.

## Runtime environment inventory

All Netlify contexts, scopes, and builds were reviewed.

### Required secrets

- `MONGODB_URI` - replace with the new least-privilege Atlas user connection string.
- `JWT_SECRET` - missing from Netlify at capture time; create a strong value. Changing it invalidates existing sessions.
- `MONGODB_DASHBOARD_PASSWORD` - current backend variable name used by the analytics dashboard endpoint.
- `AYAKASIR_PARTNER_SECRET` - rotate in coordination with the AyaKasir/petalytix sender.
- `APIFY_API_TOKEN` - rotate before cutover.
- `GOOGLE_GEOCODING_API_KEY` - new server-only key for Geocoding API; introduced during Step 2.

### Required identifiers/configuration

- `APIFY_GATHER_ACTOR_ID`
- `AYAKASIR_ORDER_URL_PREFIX` - explicitly set to the production AyaKasir order origin even though code has a default.
- `GOOGLE_MAPS_BROWSER_API_KEY` - new browser key; replaces `GOOGLE_MAPS_API_KEY` while keeping the old name as a temporary fallback.

### Verify before removal

- `ABLY_API_KEY` - not referenced by this repository.
- `DASHBOARD_PASSWORD` - not referenced; backend reads `MONGODB_DASHBOARD_PASSWORD`.
- `NETLIFY_DATABASE_URL` - not referenced by this repository.
- `NETLIFY_DATABASE_URL_UNPOOLED` - not referenced by this repository.

## Google Maps key target policy

- The captured browser key has redundant/invalid referrers, an `ayanaop.app` typo, and 31 enabled APIs.
- Browser-key API allowlist:
  - Maps JavaScript API.
  - Places API (New).
- Server-key API allowlist:
  - Geocoding API only.
- Browser referrers to retain during migration:
  - `https://ayanaon.app/*`
  - `https://www.ayanaon.app/*`
  - `https://ayanaon.netlify.app/*` until rollback is retired.
  - `https://staging.ayanaon.app/*` after the staging hostname exists.
  - `http://localhost:8888/*` and `http://127.0.0.1:8888/*` for Netlify local development.
  - `http://localhost:8787/*` and `http://127.0.0.1:8787/*` for Wrangler local development.
- Remove path-specific duplicates, unschemed patterns, unused LAN addresses, `*localhost...` patterns, and the `ayanaop.app` typo after confirming no active workflow depends on them.

## MongoDB Atlas baseline

- Network Access contains active `0.0.0.0/0`, so Cloudflare staging can attempt direct Atlas connectivity.
- Two active `/32` entries also exist: one for MongoDB MCP access and one created by Atlas Auto Setup. They are redundant while allow-all remains.
- Keep `0.0.0.0/0` temporarily through staging and production cutover because Workers do not provide a stable low-cost outbound TCP IP allowlist.
- Compensating controls while allow-all remains: TLS connection, rotated strong password, least privilege, secret storage, and Atlas monitoring.
- New database user captured: `local_migration` with `readWrite@ayanaon-db` only. Use this user for the new Worker connection after its credential is stored securely.
- Legacy application user has `atlasAdmin@admin` plus `readWrite@ayanaon-db`; retire it after both Netlify rollback and Cloudflare production are verified.
- `local_dev` remains separate for local workflows and must not be used by production.

## Step 2 implementation decisions

- Keep production on Netlify while adding Cloudflare support.
- Reuse one Express app with two adapters:
  - Netlify: existing `serverless-http` handler.
  - Cloudflare: `httpServerHandler` with `nodejs_compat`.
- Remove eager MongoDB connection at module initialization; connect lazily during a request and reuse warm state.
- Centralize client IP lookup: Cloudflare `cf-connecting-ip`, Netlify `x-nf-client-connection-ip`, then local `req.ip` fallback.
- Serve `public/` through Workers Static Assets; unmatched API/SEO routes fall through to Express.
- Move Netlify-only function rewrites from `public/_redirects` into `netlify.toml` so Cloudflare never consumes `/.netlify/functions/*` rewrites.
- Preserve `/service-worker.js` with `Cache-Control: no-cache` on both providers.
- Keep Netlify configuration and secrets intact until the post-cutover observation window ends.

## External actions still pending

- Rotate exposed credentials and update Netlify without downtime.
- Store the new Atlas `local_migration` connection string securely.
- Create/restrict the separate Google browser and server keys.
- Create Cloudflare account/project secrets after the first Worker exists.
- Onboard `ayanaon.app` DNS to Cloudflare while initially retaining Netlify as origin.
- Create `staging.ayanaon.app`, complete the migration test matrix, then cut over `www`.
- Retain Netlify for 7-14 days after cutover before retirement.
- Remediate and retest the production dependency advisories reported by `npm audit --omit=dev` before production cutover.

## Rollback invariant

- Until retirement, a rollback must require only detaching the Worker custom domain and restoring the Cloudflare `www` DNS target to `ayanaon.netlify.app`; it must not require reverting application data.

# Code Rules & Conventions

## Architecture
- **No build step** - vanilla HTML/CSS/JS served directly from `public/`
- **No frontend framework** - DOM manipulation with `document.getElementById` etc.
- **Monolith backend** - everything in one `api.js` file with Express router
- **Monolith frontend** - `app.js` is one large file with global variables
- **Serverless** - the shared Express app runs through Netlify `serverless-http` and Cloudflare Workers `httpServerHandler` adapters during migration

## Language & Naming
- UI text is in **Bahasa Indonesia** (Indonesian)
- Code comments and variable names are in **English**
- Error messages from API are in **Bahasa Indonesia**
- Collection/field names are in English

## Backend Patterns
- `connectToDatabase()` - MongoDB is lazy and request-scoped: one client/connection promise may be shared only within the active request context, the client closes in the request wrapper `finally`, and MongoDB clients/databases/I/O promises must never be stored globally or reused across Worker requests
- Collection helpers: `getSellersCollection()`, `getResidentsCollection()`, `getSettingsCollection()`
- Auth: JWT tokens verified inline per route (no middleware), `req.headers.authorization` Bearer token
- Settings stored in `settings` collection with `{ key: string, value: any }` pattern
- Photos stored as base64 data URIs in MongoDB documents directly
- Mass promo image reads must tolerate legacy docs where `sharedImageCount` exists but `sharedImagesFromGroup` is missing; fallback to `massPromotionGroupId` before calling `resolveSharedImages()`
- Mass promo pins share images via `sharedImagesFromGroup` referencing `massPromotionGroupId` — only the first pin in a group stores actual image data; resolved at read time by `resolveSharedImages()`
- IP address used for anonymous voting and visitor tracking via `getClientIp(req)`: prefer `cf-connecting-ip`, then `x-nf-client-connection-ip`, then local `req.ip`
- Merchant writes come ONLY from the AyaKasir partner API (Bearer `AYAKASIR_PARTNER_SECRET`, timing-safe compare); every payload field is re-sanitized server-side and `slug` is immutable after create (SEO permanence). Every merchant write must bust `sitemapCache`
- AyaKasir menu entries use an optional `onlineVisible` partner field: omitted defaults to visible for backward compatibility, while explicit `false` must be discarded before persistence/search indexing. `/toko/:slug` responses must remain `no-store` so a completed partner sync is visible on the next request.
- Gather Pins browser work runs only in the separately deployed Apify Actor; the shared backend starts/polls runs and persists normalized results. Never put Chromium/Playwright in either hosting adapter.
- Browser-adapter changes are not live until `gather-actor/` is pushed, the Actor's default `latest` build succeeds, and a remote smoke run confirms both a non-zero dataset and the expected build number/log signature. Keep `.actorignore` excluding dependencies, local storage, secrets, and logs from source uploads.
- Gather drafts require title, description, category, valid HTTP(S) link, start/end dates, and valid coordinates before publication; static location sources intentionally leave dates incomplete for human review.
- Gather deduplication prefers `source + externalId` (not link alone) because Pertamina/SPKLU records legitimately share a locator URL.
- Published-pin duplicate checks must also cover manual/admin-created pins: require a normalized title match plus either the same canonical link or coordinates within 350 meters; remove matching stale drafts from the review queue. A shared locator URL alone is never sufficient.
- Before starting an Actor run, the shared backend sends known source IDs (or links only when an ID is absent); adapters skip them before detail/geocoding work and continue until the requested number of new rows is collected.
- Gather Actor images are normalized to at most three HTTP(S) references and persisted with the draft; re-import may enrich an existing image-less draft without creating a duplicate.
- Tiket detail drafts use the dynamically rendered event header as authority: wait for its labels, format description as price + full venue + a blank line + Indonesian date, strip regional text appended after the first `, Indonesia`, and geocode the full venue with a venue/final-locality/country fallback before using broad search-card coordinates.
- A Tiket list request that renders no event cards must throw so Crawlee retries it; zero new candidates is valid only after cards were observed but all matching events were excluded as known.
- Gather address searches must call authenticated `GET /api/admin/gather/geocode`; never authorize browser-side Geocoder with the browser Maps key or expose `GOOGLE_GEOCODING_API_KEY` to client code.
- Resolve split Google key fallbacks with truthy checks (`specificKey || GOOGLE_MAPS_API_KEY`), because Wrangler may expose a declared-but-unset local secret as an empty string rather than `undefined`.
- Google Indexing API must not be used for merchant pages: Google limits it to `JobPosting` and livestream `BroadcastEvent` pages. Merchant discovery uses canonical SSR pages + the submitted sitemap; keep sitemap CDN caching aligned with `SITEMAP_CACHE_TTL_MS` so merchant writes surface promptly
- Inline client scripts emitted from server-rendered pages (`waScript`/`themeScript`/`availScript`/`cartModalHtml` in the toko page) live inside JS template literals — they must contain NO backticks and NO dollar-brace; use quotes + string concatenation, and `\\n` in api.js source to emit `\n` escapes
- Search visibility spans THREE layers: pins, live sellers, merchants. Any feature consuming search results (`filterMarkers`, `updatePinListPanel`, `focusMapOnSearchResults`) must handle all three or merchant-only matches break

## Frontend Patterns
- Global variables at top of `app.js` for all state
- Google Maps loaded via script tag with callback
- DOM elements cached in global variables, looked up in `initializeApp()` or similar
- Event listeners attached imperatively
- API calls via `fetch()` to `/api/...`
- Resident session: JWT stored in `localStorage` as `warga_token`
- Seller session: JWT stored in `localStorage` as `seller_token`
- Theme preference: `localStorage` key `ayanaon_theme`
- A missing Google Maps browser key is an editor-preview limitation, not a Gather run failure; keep its warning inside the map container and allow authenticated server geocoding to fill coordinates independently.

## Deployment
- `npm run dev` / `npm run dev:cloudflare` must select Wrangler environment `local`, whose `secrets.required` admits both the migration-era `GOOGLE_MAPS_API_KEY` and the preferred split keys; `npm run dev:netlify` retains rollback-provider development.
- **Local Wrangler development now connects directly to production `ayanaon-db`** (owner decision, 2026-08-11, superseding the earlier isolated-database design below). `wrangler.jsonc`'s `local` env no longer sets `MONGODB_DATABASE`, so `resolveMongoDatabaseName()` in `api.js` falls back to the same `ayanaon-db` default production uses — same cluster, same database, no isolation. Petalytix local partner sync must target `http://localhost:8787`, and the ignored local env files must carry matching partner secrets before testing.
- **There is no longer a local/prod data safety net.** Every local write — creating/editing/deleting pins, admin actions, seller/resident flows, mass promotions, Gather publishes — mutates the live database real users see on ayanaon.app immediately. There is no separate sandbox to test destructive operations in; treat local `npm run dev` sessions with the same care as acting directly on production, because that is what it now is.
- The formerly isolated `ayanaon-local` database (and `scripts/mirror-db-to-local.js` / `npm run db:mirror-local`) existed from 2026-08-05 to 2026-08-11 to keep local writes from touching prod. It was dropped on 2026-08-11 (`db:mirror-local -- --revert --yes`) to free Atlas storage once local dev stopped pointing at it. The mirror script file still exists in the repo but is now dead code for the primary dev workflow — nothing points `MONGODB_DATABASE` at `ayanaon-local` anymore; only its `--revert` path was actually used for the drop.
- Atlas M0 free tier is a single 512 MB storage pool shared by every database on the cluster (confirmed live 2026-08-11: `AtlasError` code 8000 blocked writes cluster-wide, production included, when a mirror briefly overflowed it). With local dev now writing straight into `ayanaon-db`, there is no separate local storage cost to manage — but the underlying quota ceiling for the whole cluster (prod included) is still 512 MB and unchanged.
- `npm run check:cloudflare` and `npm run deploy:cloudflare` must pass `--env=""` to target the top-level production configuration explicitly; production continues to require only the split browser/geocoding keys.
- Cloudflare serves the production `www` hostname. Keep Netlify's apex redirect, rollback deployment, adapter, configuration, secrets, and credentials intact throughout the 7-14 day observation window.
- `public/_redirects` must not contain Netlify function rewrites; keep those only in `netlify.toml` so Workers Static Assets fall through to Express
- `npm run test:deployment` validates both provider exports, browser-key routing, Cloudflare/Netlify IP precedence, and request-scope isolation/nesting/cleanup; the legacy `npm test` placeholder remains
- Service worker cache version must be bumped on each release

## Constraints
- JSON payload limit: 20 MB (for photo uploads)
- Main photo max: 1 MB, menu photo max: 4 MB, up to 3 menu photos
- Resident photo max: 1 MB
- Pin images: up to 3 photos
- Roles: `admin`, `pin_manager`, `resident`

## Release Process
- Version in `package.json`
- Update release notes in `README.md`
- Bump service worker cache version in `public/service-worker.js`
- Commit message format: `chore: release vX.Y.Z`

## Merchant `/toko` Menu Rendering (`netlify/functions/api.js`, added 2026-08-11)
- Variant-bearing products render as ONE expandable group (`buildMenuItemGroupHtml`), never as N flat rows — collapsed `<details class="toko-menu__variants"><summary>` shows the product's photo/name/description/base price; expanding reveals the real orderable `.toko-menu__item` rows (one per variant) in a nested `<ul class="toko-menu__variant-list">`. Matches the AyaKasir order page's tap-to-reveal-variants pattern.
- **Never give the group wrapper `<li>` (or its `<summary>`) the `toko-menu__item` class.** The WA-cart script and the availability-poll script both do `document.querySelectorAll('.toko-menu__item')` and read `data-name`/`.toko-menu__count` off every match — `querySelectorAll` sees into collapsed `<details>` content regardless of visibility, so a group wrapper carrying that class would be double-counted alongside its own nested variant rows. Use `toko-menu__group-item` / `toko-menu__variants-summary` (separately styled via CSS to LOOK the same) for the wrapper/header instead.
- The visible variant row label is just the variant name (e.g. "Large") since the product name is already shown once on the group summary — but `dataName` (the `data-name` attribute, used for the WA pre-filled message AND the availability-poll's `"ProductName - VariantName"` composite-miss matching) MUST stay fully qualified as `"${item.name} - ${variant.name}"`. Changing the visible label is safe; changing `dataName`'s format is NOT — it would break matching against petalytix's `/api/ayakasir/online-order/availability` response and desync the WA cart's line-item text from what the merchant actually sees ordered.
- A bare (no-variant) product's `description` still renders on its own single `<li class="toko-menu__item">` row (`buildMenuItemRowHtml`'s `!variant && item.description` guard) — that guard is intentionally unchanged; it's what stops a variant's row from ALSO rendering the product description a second time (the group summary already shows it once).

## Memory Maintenance
- After finishing a task, append durable knowledge to `/ai-memory/SESSION_LEARNINGS.md`
- Never rewrite or refactor memory files

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
- Inline client scripts emitted from server-rendered pages (`waScript`/`themeScript`/`availScript` in the toko page) live inside JS template literals — they must contain NO backticks and NO dollar-brace; use quotes + string concatenation, and `\\n` in api.js source to emit `\n` escapes
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
- Local Wrangler development must use `MONGODB_DATABASE=ayanaon-local`; production intentionally omits that var and falls back to `ayanaon-db`. Petalytix local partner sync must target `http://localhost:8787`, and the ignored local env files must carry matching partner secrets before testing.
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

## Memory Maintenance
- After finishing a task, append durable knowledge to `/ai-memory/SESSION_LEARNINGS.md`
- Never rewrite or refactor memory files

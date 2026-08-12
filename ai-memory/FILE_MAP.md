# File Map

## Root
- `package.json` - runtime deps plus Netlify CLI and Wrangler dual-provider development/deploy scripts
- `netlify.toml` - Netlify rollback build config and all Netlify-only API/SEO rewrites
- `wrangler.jsonc` - Cloudflare Worker entry, Node compatibility, static assets, observability, optional Mongo database selection (`ayanaon-local` in the local environment; production defaults to `ayanaon-db`), and unused MongoDB-native-module aliases
- `src/worker.js` - Cloudflare `httpServerHandler` adapter over the shared Express app; wraps every fetch in the database request context
- `src/request-scope.js` - AsyncLocalStorage request-scope utility with nested reuse and guaranteed async disposal
- `src/mongodb-optional-native-stub.js` - excludes unused Kerberos/client-encryption native add-ons from the Worker bundle
- `.dev.vars.example` - redacted local Cloudflare runtime-variable template
- `tests/deployment-adapters.test.js` - provider-adapter exports, Google browser-key routing, and Cloudflare/Netlify client-IP precedence tests
- `tests/request-scope.test.js` - concurrent isolation, nested reuse, and error-path disposal regression tests
- `tests/google-geocoding.test.js` - server-key Google Geocoding request, zero-results handling, and missing-key regression tests
- `tests/gather-pins.test.js` - Gather duplicate-suppression, draft-cleanup, source-link, and browser-adapter deployment regression tests
- `tests/merchant-visibility.test.js` - AyaKasir partner menu visibility sanitizer (`onlineVisible: false` rejection) and merchant storefront `no-store` cache-control regression tests
- `.gitignore` - ignores: node_modules, .env, .netlify

## Backend (single file)
- `netlify/functions/api.js` - **THE ENTIRE BACKEND** (~8910+ lines)
  - Express router mounted at `/api/*`; exports both the shared `app` and the Netlify `handler`
  - MongoDB client connects lazily once per request context, shares one in-request connection promise, and closes before the adapter request completes
  - MongoDB connection + index setup; never retain MongoDB clients/databases/I/O promises across Worker requests
  - All REST endpoints (see API Routes below)
  - Server-rendered HTML for `/pin/:id`, `/toko/:slug`, sitemap, robots.txt
  - "Merchants" section (~line 5690): AyaKasir partner integration (secret-gated push API + merchant SSR page)

## Frontend (`public/`)

### Main App
- `index.html` - main page (map, pin list, forms, modals)
- `app.js` - all map/pin/UI logic (large monolith)
- `style.css` - all main styles
- `_headers` - provider-compatible `no-cache` rule for the service worker; Netlify-only `_redirects` moved to `netlify.toml`

### Admin
- `admin.html` - admin dashboard page
- `admin.js` - admin logic (manage pins, SEO, categories, brands, areas, mass promos, analytics)
- `admin-gather.js` - Gather Pins source runs, polling, category-backed draft editing, authenticated server-proxied address search, map coordinates, automatic/manual images, and publication UI
- `admin.css` - admin styles

### External Gather Actor (`gather-actor/`)
- `src/main.js` - normalized, duplicate-aware adapters for tiket.com, Loket, Yesplis, IndoRelawan, KalenderLari, MICHELIN, Pertamina, and SPKLU
- `src/pertamina-utils.js` - source-specific SPBU COCO description formatting with multiline fuel and facility values
- `src/spklu-utils.js` - SPKLU charger-total fallback and per-charger-box description formatting
- `src/tiket-utils.js` - Tiket full-venue cleanup, price normalization, and Indonesian event-summary formatting
- `.actor/actor.json` + `.actor/input_schema.json` - Apify Actor manifest and source/limit input schema
- `Dockerfile` - Playwright Chrome Actor runtime; deployed separately from the web app
- `.actorignore` - excludes local dependencies, storage, environment files, and logs from Apify source uploads

### Auth - Sellers (Gerobak Online)
- `login.html` - seller login page
- `register.html` - seller registration page
- `verify.html` - seller verification page
- `auth.js` - shared seller auth logic
- `auth.css` - auth page styles

### Auth - Residents (Warga)
- `warga-login.html` - resident login page
- `warga-register.html` - resident registration page
- `resident-auth.js` - resident auth logic
- `resident-session.js` - resident session management

### PWA
- `service-worker.js` - caching, offline support, skip-waiting

## API Routes (all under `/api/`)

### Pins
- `GET /pins` - list active pins (excludes mass promo pins)
- `GET /pins/nearby-promos?lat=X&lng=Y` - mass promo pins within 10km radius
- `GET /pins/nearby-promos` must derive `imageCount` from shared-image metadata and only resolve actual shared images when not in lean mode
- `GET /pins/count` - active pin count
- `GET /pins/search` - server-side search with pagination
- `GET /pins/:id` - single pin
- `GET /pins/:id` resolves mass-promo shared images from the owner pin before returning detail data
- `POST /pins` - create pin
- `PUT /pins/:id` - update pin
- `DELETE /pins/:id` - delete pin
- `POST /pins/:id/upvote` | `downvote` - voting

### Residents (Warga)
- `POST /residents/register` | `login`
- `GET /PUT /residents/me` - profile
- `POST /GET /residents/share` - location sharing
- `POST /residents/badges/increment`

### Sellers (Gerobak Online)
- `POST /register-seller` | `login`
- `GET /PUT /sellers/me` - profile
- `POST /live-sellers/status` | `heartbeat`
- `GET /live-sellers` - list live sellers
- `POST /live-sellers/:id/community-verify`

### Admin
- `GET /admin/gather/sources` - source catalog + external-service configuration status
- `GET /admin/gather/geocode?query=` - authenticated, server-side Google Geocoding lookup for Gather and admin location searches
- `POST /admin/gather/runs` | `GET /admin/gather/runs[/:id]` - start/poll/list Apify runs; successful results import into drafts
- `GET /PUT/DELETE /admin/gather/drafts[/:id]` | `POST /admin/gather/drafts/:id/publish` - review, edit, discard, and publish gathered drafts
- `GET /admin/residents` | `PUT /:id/role` | `DELETE /:id`
- `POST /admin/pins/backfill-city` | `backfill-provinces`
- `GET /admin/mass-promotions` - list mass promo groups; `PUT /:groupId` - bulk-edit group; `DELETE /:groupId` - bulk-delete group
- `PUT /admin/mass-promotions/:groupId` must update owner images and stamp shared-image reference fields on every non-owner pin in the group
- `CRUD /admin/brands` | `DELETE /admin/brands/:id/locations/:placeId`
- `CRUD /admin/areas` | `POST /admin/areas/seed`

### Settings & Config
- `GET /PUT /maintenance` | `features` | `tabs-visibility` | `categories` | `seo`
- `GET /config` - Google Maps API key
- `GET /ip` - client IP
- `GET /unique-ips` - visitor count

### Analytics
- `POST /analytics/track`
- `GET /analytics/summary` | `top-pins` | `top-referrers` | `top-cities` | `heatmap` | `timeseries`
- `GET /analytics/dashboard-password`

### Merchants (AyaKasir partner integration)
- `PUT /partners/ayakasir/stores` - upsert tenant store (Bearer `AYAKASIR_PARTNER_SECRET`; upsert key `tenantId`; slug immutable after create; builds `searchText` blob; sanitizes `logoUrl`/`menuLayout`/per-item `category`+`available`; menu cap 100)
- `DELETE /partners/ayakasir/stores/:tenantId` - soft-hide (default) or `?purge=1` hard delete
- `GET /merchants` - lean active list for the map layer (logoUrl, photos $slice 3, menuHighlights $slice 3, searchText)
- `GET /merchants/:slug` - full merchant detail
- `GET /toko/:slug` - server-rendered merchant SEO page (also app-level route + `/toko/*` `_redirects` rule): FoodEstablishment JSON-LD, logo top-right, full menu grouped by category in the tenant's LIST/GRID/ACCORDION layout, WA-cart ordering (`waScript`) with a "Lihat Keranjang" review modal (`cartModalHtml`) listing selected items/qty/total before handoff, light/dark theme (`themeScript`, localStorage), live availability polling (`availScript` → AyaKasir `GET /api/ayakasir/online-order/availability?token=…`, endpoint derived from orderUrl into `body[data-avail-endpoint]`)
- app.js merchants layer: `fetchMerchants` (once, from initMap), `createMerchantMarkerEntry`/`createMerchantMarkerElement` (rounded-square logo pin), `buildMerchantPopupNode` (headerDisabled InfoWindow: logo/name/meta + photo strip + "Kunjungi Toko"), `ensureMerchantMapClickCloser`, `focusMerchantEntry`/`focusMerchantFromUrl` (`?toko=` deep link), `buildMerchantSearchBlob` fallback; search visibility handled in `filterMarkers`, the results-list "Toko / UMKM" section in `updatePinListPanel`, and `focusMapOnSearchResults` candidates

### SEO (server-rendered)
- `GET /seo/sitemap` | `robots` (sitemap includes active `/toko/:slug` entries; cache busted on merchant writes)
- `GET /pin/:id` - server-rendered pin detail page

## Migration
- `ai-memory/CLOUDFLARE_MIGRATION_STEP1.md` - redacted Step 1 infrastructure, security, DNS, environment, Atlas, Google Maps, cost, and rollback handoff for the Netlify-to-Cloudflare migration

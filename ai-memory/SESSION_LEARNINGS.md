# Session Learnings
Append-only log of durable discoveries.
Max 10 lines per task.

## Gather Pins external ingestion (2026-07-11)
- Added the Gather Pins admin tab for authenticated admin/pin-manager users: start scraper, poll status, review durable drafts, edit all mandatory fields, attach up to 3 images, delete, and publish.
- Browser scraping cannot run reliably inside Netlify; `gather-actor/` is a separate Apify Playwright Actor with proxy support, while Netlify only orchestrates runs and stores results.
- Eight adapters cover tiket.com, Loket, Yesplis, IndoRelawan, KalenderLari, MICHELIN, Pertamina, and SPKLU; API sources avoid browser cost where possible.
- Scrape results persist in `gather_pin_drafts`; Actor execution metadata and import counters persist in `gather_runs`.
- Deduplicate by `source + externalId`, with a link/coordinate/title fallback; link-only dedupe breaks locator datasets whose records share one directory URL.
- MICHELIN/Pertamina/SPKLU lack natural event dates, so their drafts remain intentionally incomplete and cannot publish until dates are reviewed.
- Deployment requires Netlify `APIFY_API_TOKEN` + `APIFY_GATHER_ACTOR_ID`, plus an Apify deployment of `gather-actor/`.
- Apify input-schema fields require `description`; integer UI fields also use `editor: number`. A schema build failure surfaces later as the misleading run error `Actor version was not found`.

## Gather Pins review workflow v2.5.1 (2026-07-11)
- Gather controls now use the shared admin font, compact labels, full-width sections, and right-aligned actions; the numbered step and empty editor panel were removed.
- Draft categories come from `GET /api/categories`; a scraped legacy value remains as a temporary option so the editor never silently clears it.
- Draft coordinates use the existing `/api/config` Google Maps key with address geocoding, map clicks, and a draggable marker that update latitude/longitude.
- Actor adapters emit up to three HTTP(S) image URLs; the Netlify importer normalizes and persists them as supportive-image records.
- Source audit confirmed Loket uses `event.banner`/`event_banner`, Yesplis uses `full_path`/`picture2_full_path`, and MICHELIN uses `main_image`/`images`.
- A repeated Actor import may add photos to a matching image-less draft while still counting the source item as a duplicate.
- Version and service-worker cache advanced to v2.5.1 so deployed admins receive the new Gather assets.

## Gather source cleanup and preflight dedupe v2.5.2 (2026-07-11)
- Loket detail descriptions are encoded HTML; clean them in both the Actor and Netlify normalization so tags/entities never leak into drafts.
- Nested malformed entities such as `&amp;mdash` and `&amp;rsquos` require iterative decoding before HTML removal.
- Loket’s current detail API exposes the banner as `event_banner` (with optional `event_banner_mobile`), not generic `image`.
- Netlify now loads up to 6,000 known source records and sends their external IDs—or links only when IDs are absent—to the Actor before a run.
- Adapters skip exclusions before detail/geocoding work and keep paging until they collect the requested count of new items.
- Shared locator links for Pertamina/SPKLU must never drive exclusions when an external ID exists.
- Existing raw-HTML drafts remain eligible for one refresh so a repeat Loket run can clean their stored description and enrich missing images.
- Version and service-worker cache advanced to v2.5.2.

## Merchant Google discovery freshness (2026-07-11)
- Google Indexing API is not eligible for `/toko/:slug`; it only supports `JobPosting` and livestream `BroadcastEvent` pages, so do not send merchant URLs to it.
- Google's unauthenticated sitemap ping endpoint is deprecated and returns 404; sitemap submission/discovery is the supported path for these store pages.
- Merchant writes already invalidate `sitemapCache`, and active stores already have canonical SSR pages plus timestamped sitemap entries.
- Fixed the sitemap CDN TTL mismatch: Netlify could serve a stale sitemap for 24 hours despite the 15-minute function cache and write invalidation.
- Sitemap responses now use `s-maxage=900, stale-while-revalidate=60`, targeting new store discovery within about 15 minutes of a Google sitemap fetch.

## SEO & Canonical URLs (2026-02-14)

### Issue: Google Search Console "Alternative page with proper canonical tag"
- **Root cause**: Canonical URL mismatch between hardcoded meta tag and actual site URL
- Static `index.html` had canonical URL: `https://ayanaon.app/`
- Actual site accessed via: `https://www.ayanaon.app/`
- Query parameters like `?pin=<id>` inherited the wrong canonical, creating duplicates

### Fix
- Updated canonical and og:url in `public/index.html` to match actual domain with www subdomain
- Ensures all homepage variations (`/`, `/?pin=<id>`, etc.) point to same canonical URL
- Server-rendered pages (`/pin/:id`, `/kategori/*`) already generate correct canonicals dynamically

### Learning
- **Always align canonical URLs with actual site domain** (including www vs non-www)
- Static HTML files need manual canonical tag updates
- Query parameters should resolve to same canonical as base URL
- Server-rendered pages use dynamic canonical generation (already correct)

## Sitemap & Redirects (2026-02-14)

### Issue: Google Search Console "Page with redirect"
- **Root cause 1**: Sitemap included legacy redirect URLs `/kategori/:category/:city` that redirect to `/kategori/:category/:province/:city`
- **Root cause 2**: HTTP and non-www URLs not properly redirected at infrastructure level
- Legacy redirect handler exists at line 5481 (`handleCategoryLegacyRedirect`) for backward compatibility
- Sitemap generator (`buildLandingEntriesFromPins`) was including both formats

### Fix
- Modified sitemap generation to skip entries without province (line 1483-1485: early return if `!provinceSlug`)
- Added HTTPS force redirects in `netlify.toml` for `http://ayanaon.app/*` and `http://www.ayanaon.app/*`
- Added non-www to www redirect in `netlify.toml` for `https://ayanaon.app/*`
- All redirects use 301 status with `force = true` for proper SEO signal

### Learning
- **Sitemap should only include final URLs, never intermediate redirect URLs**
- Use `force = true` in Netlify redirects to ensure they take precedence
- Order matters: HTTPS redirects before non-www redirects in config
- Legacy redirect handlers are fine for backward compatibility, just exclude from sitemap

## Duplicate Content - Mass Promotions (2026-02-14)

### Issue: Google Search Console "Duplicate, Google chose different canonical than user"
- **Root cause**: Mass promotions create multiple pins with identical title/description but different locations
- Each pin has unique canonical URL pointing to itself (`/pin/:id`), but Google sees identical content as duplicates
- Google ignores the specified canonical and chooses its own, causing indexing issues
- Mass promotions feature allows creating multiple pins at once (e.g., brand promotion across multiple locations)

### Fix
- Added location (city) to page title: `${title} | ${city} | ${siteTitle}` (line 1914-1916)
- Added location suffix to meta description: `${description} di ${city}, ${province}` (line 1908-1910)
- Makes each pin page unique even with identical promotion content
- Location-specific titles/descriptions signal to Google that pages serve different geographic audiences

### Learning
- **For duplicate content with location variance, include location in title and description**
- Page title should be: `Content | Location | Site` for geo-specific duplicates
- Meta descriptions should mention location to differentiate similar content
- Each page maintains its own canonical URL but content is unique enough to avoid duplicate detection

## Google Search Snippets & Sitelinks (2026-02-14)

### Issue: Google showing wrong meta description and uncontrolled sitelinks
- **Problem 1**: Searching "ayanaon.app" showed UI text instead of meta description tag value
- Google scraped: "Tap peta untuk menjatuhkan pin... Install App... Update Tersedia" from page body
- **Problem 2**: Sitelinks auto-generated by Google without control over which pages appear

### Fix
- Added JSON-LD WebSite schema with proper description and SearchAction (line 34-47)
- Added JSON-LD ItemList schema for 8 priority category sitelinks (line 48-102)
- Added `data-nosnippet` attribute to UI elements (navigation, install buttons, instructions) to exclude from snippets
- Added hidden SEO-optimized content block with h1 and description paragraph for crawlers (line 105-108)

### Learning
- **Use JSON-LD structured data to control search appearance** - WebSite schema for site info, ItemList for sitelinks
- **Use `data-nosnippet` attribute** to prevent specific HTML elements from appearing in search snippets
- Hidden accessibility content (off-screen but semantic) helps Google understand page purpose
- Meta description alone isn't enough - structured data + hidden semantic content reinforces it
- Sitelinks require ItemList schema with proper URLs and names for each preferred link

## Mass Promotion Optimization (2026-02-16)

### Issue: Mass promo pins burden initial load and duplicate image storage
- All pins loaded on page load, including mass promos that may be irrelevant to user's location
- Each mass promo pin stored its own copy of base64 images, wasting MongoDB storage

### Fix
- **Flagging**: Mass promo pins now have `massPromotion: true` and `massPromotionGroupId` fields
- **Shared images**: Only first pin in a group stores images; subsequent pins use `sharedImagesFromGroup` reference, resolved at read time via `resolveSharedImages()`
- **Location-gated loading**: `GET /pins` excludes `massPromotion: true`; new `GET /pins/nearby-promos?lat=X&lng=Y` returns mass promos within 10km using Haversine bounding-box + exact distance filter
- **Frontend**: `fetchNearbyPromos()` called when `userLocation` becomes available (both `getCurrentPosition` and `watchPosition` callbacks); uses `nearbyPromosLoaded` flag to avoid duplicate fetches

### Learning
- **Use a groupId pattern for bulk-created resources** to enable shared references (images, metadata)
- **Haversine bounding-box pre-filter** (lat/lng ± delta) before exact distance check is efficient without a 2dsphere index
- **Location-gated content** should be loaded separately from main data to avoid penalizing users without location

## Mass Promo Pins Disappearing Bug (2026-02-16)

### Issue: Mass promo pins load then vanish after regular pins sync
- Console log sequence: "Nearby promos loaded {count: 2}" → "Pins synchronized {count: 3358}"
- Promo pins visible briefly, then removed from map

### Root Cause
- `fetchPins()` sync loop (line ~8231) removes all markers not in `seenIds` set
- `seenIds` only contains IDs from `/api/pins` response, which **excludes** mass promo pins (`massPromotion: { $ne: true }`)
- Mass promo pins added by `fetchNearbyPromos()` were in `pinMarkersById` but not in `seenIds`, so sync deleted them

### Fix
- Added guard in sync loop: skip removal if `marker.pin.massPromotion` is truthy
- `pinMarkersById.forEach` now preserves mass promo markers during regular pin sync

### Learning
- **When multiple endpoints contribute to a shared marker map, the sync/reconciliation logic must account for all sources**
- Markers from secondary endpoints need a distinguishing flag to survive primary endpoint sync cycles

## Category Landing Page Filters (2026-02-16)

### Issue: Province/city filters not auto-applied from URL parameters
- URL `/kategori/promo-diskon-makanan-minuman/jawa-barat/kota-bandung` showed all pins instead of filtering by province and city
- Server-rendered HTML passed `provinceSlug` and `regionSlug` (city) to `buildCategoryLandingHtml()` but not to frontend script
- Filter dropdowns rendered with correct options but no selected values
- Initial search ran without province/city filters

### Root Cause
- Script only received `window.__regionTree` and `window.__categorySlug` (line 3820)
- No initialization code to set filter values from URL parameters
- `doSearch()` only triggered after geolocation, ignoring URL-based filters

### Fix
- Added `window.__provinceSlug` and `window.__regionSlug` to script globals (line 3820)
- Initialize `provinceSelect.value = initialProvinceSlug` on page load
- Call `populateCities()` to load city options for selected province
- Set `citySelect.value = initialRegionSlug` after populating cities
- Trigger `doSearch(1)` even if geolocation fails/unavailable when URL filters present

### Learning
- **Server-rendered pages with client-side filtering must pass URL parameters to frontend**
- Initialize filter UI state from URL on page load before any search triggers
- Don't rely solely on async geolocation for initial search when filters are in URL

## Admin Brands Search Hanging (2026-03-03)

### Issue: Searching places in Manage Brands returned nothing with no feedback
- `handleBrandsSearch` called `ensureBrandsPlacesService()` → `initBrandsMap()` → `ensureGoogleMaps()`
- `ensureGoogleMaps` promise hung silently — no error shown, button stuck in "Searching..."

### Root Cause
- `ensureGoogleMaps` (line ~1964) checks for existing `<script data-admin-gmaps="true">` in DOM
- If found, it attaches a `load` event listener — but if the script already fired `load` (already loaded), the event never fires again
- This happens when: Maps loaded OK once → `googleMapsPromise` reset to null (on prior error) → retry finds existing script but can't resolve
- Promise hangs indefinitely → `setBrandsSearchState(false)` never called → UI frozen

### Fix
- In the `existing` script branch, check `window.google?.maps` first; if already loaded, call `resolve()` immediately
- Added 3-line guard before attaching stale `load` listener

### Learning
- **When re-attaching load listeners to potentially-already-loaded scripts, always check if the resource is already available before listening**
- Pattern: `if (window.google?.maps) { resolve(); return; }` before `existing.addEventListener('load', resolve)`
- `googleMapsPromise = null` reset on error causes retry to hit the `existing` branch if the script tag persists in DOM

## Admin Brands Search — English "in" Not Recognized as Location Separator (2026-03-03)

### Issue: "Sushi Yay in Jakarta" returned no location-scoped results
- `parseMassSearchQuery` only matched ` di ` (Indonesian) as the location separator
- English "in" was unrecognized, so the full query was passed without geocoding the location
- Without location bounds, Places API returned unscoped results (or ZERO_RESULTS for obscure brands)
- Placeholder showed `KFC di Jakarta` hinting only Indonesian format

### Fix
- Changed regex from `/\s+di\s+/i` to `/\s+(?:di|in)\s+/i` in `parseMassSearchQuery`
- Updated hint text in `admin.html` to show both: "di Kota" or "in City"

### Learning
- **Support both language keywords in bilingual admin UIs** — admins may type queries in English or Indonesian
- `parseMassSearchQuery` is shared with Mass Promotions — the fix benefits both features

## Admin Places Search — Legacy PlacesService.textSearch Deprecated (2026-03-03)

### Issue: "Pencarian tempat gagal." — status was neither OK nor ZERO_RESULTS
- `runPlacesTextSearch` used legacy `PlacesService.textSearch()` callback API
- Google Maps JS API (default/weekly channel) now routes to new Places API architecture
- Legacy `textSearch` returns `REQUEST_DENIED` on keys/channels that have migrated to new API
- Error was surfaced correctly but with an opaque message (status not included)

### Fix
- Replaced `runPlacesTextSearch` with async function using new `google.maps.places.Place.searchByText()`
- New API: Promise-based, requires explicit `fields` array (`id`, `displayName`, `formattedAddress`, `location`)
- Falls back to legacy callback API if `Place.searchByText` is not available
- Updated `normalizePlaceResult` to handle both old (`place_id`, `geometry.location`, `name`, `formatted_address`) and new (`id`, `location`, `displayName`, `formattedAddress`) Place shapes
- Removed `PlacesService` instantiation from `ensureMassPlacesService`, `ensureBrandsPlacesService`, `initMassMap` — new API needs no service instance

### Learning
- **Google Maps Places API has two generations**: legacy `PlacesService` (callback, deprecated) and new `Place` class (Promise-based, current)
- `Place.searchByText({ textQuery, fields, region, locationRestriction })` is the correct current API
- Always include explicit `fields` in new Places API — omitting them returns nothing
- `locationRestriction` replaces `bounds` for the new API; `region` is a 2-letter ISO code (uppercase `'ID'`)
- New Place objects: `.id` (not `.place_id`), `.displayName` (not `.name`), `.formattedAddress` (not `.formatted_address`), `.location` (not `.geometry.location`)

## Admin Places Search — Max 20 Results Limit (2026-03-03)

### Issue: Places search capped at 20 results regardless of query
- `Place.searchByText` JS API hard-caps at 20 results per call
- JS API does not return `nextPageToken` in the response (known missing feature as of 2024-2025)
- Legacy `PlacesService.textSearch` also returned 20 per page via callback pagination

### Fix
- Replaced JS SDK call with **Places REST API** (`POST https://places.googleapis.com/v1/places:searchText`)
- REST API supports `pageToken`/`nextPageToken` pagination; max 20 per page, up to 100 total (5 pages)
- Uses `mapsApiKey` (module-level var, populated in `ensureGoogleMaps`) via `X-Goog-Api-Key` header
- Field mask via `X-Goog-FieldMask` header: `places.id,places.displayName,places.formattedAddress,places.location,nextPageToken`
- `locationRestriction.rectangle` built from geocoded bounds (SW/NE corners)

### REST API response shape differences vs JS API
- `place.id` → full resource name `"places/ChIJ..."` (used as-is, still unique)
- `place.displayName` → `{ text: "...", languageCode: "..." }` object (not string)
- `place.location` → `{ latitude, longitude }` (not LatLng with `.lat()`/`.lng()` functions)
- `normalizePlaceResult` updated to handle all three shapes: REST, new JS API, legacy JS API

## Mass Promotions — Edit/Delete Groups (2026-03-09)

### Feature: Admin can edit or delete posted mass promotion groups
- Added manage-groups UI section below the create form in Mass Promotions tab
- Groups are fetched from new backend endpoint, grouped by massPromotionGroupId
- Edit updates all pins in a group at once (title, description, category, link, lifetime)
- Delete removes all pins in a group with a confirmation dialog

### Backend (api.js)
- GET /admin/mass-promotions: lists all mass promo pins grouped by groupId; auth: canManagePins
- PUT /admin/mass-promotions/:groupId: bulk-updates all pins via updateMany; auth: canManagePins
- DELETE /admin/mass-promotions/:groupId: bulk-deletes all pins via deleteMany; auth: canManagePins

### Frontend
- state.massGroups: { groups, loaded, isLoading, editingGroupId, isSaving }
- loadMassGroups() called on first Mass tab open via setActiveTab guard (!state.massGroups.loaded)
- Modal-based edit form with same lifetime/date fields; reuses buildLifetimePayload()
- renderMassGroups() renders group cards with Edit and Hapus (delete) buttons
- CSS: .mass-group-card, .modal-overlay, .modal-box, .danger-btn added to admin.css
- New element caching in cacheElements(), new event bindings in bindEvents()

## Mass Promo Image Sync â€” Missing sharedImagesFromGroup Backfill (2026-03-09)

### Issue: Mass promo popup still showed no images after nearby-promos fix
- Live MongoDB data for group `mp_1772958904929_wfju7u` had `sharedImageCount: 2` on 69 sibling pins but no `sharedImagesFromGroup`
- This happened when a group was created first and images were added later via `PUT /admin/mass-promotions/:groupId`: the owner pin got `images`, but sibling pins only got `sharedImageCount`
- Result: `GET /pins/:id` and server-rendered `/pin/:id` skipped `resolveSharedImages()` because they only checked `sharedImagesFromGroup`

### Fix
- Added `getSharedImageGroupId()` in `netlify/functions/api.js` to treat legacy mass-promo docs with `sharedImageCount > 0` and no inline images as shared-image pins using `massPromotionGroupId`
- Updated `GET /pins/:id`, `/pin/:id`, `/pins/nearby-promos`, and `GET /admin/mass-promotions` to use the shared-image fallback instead of relying only on `sharedImagesFromGroup`
- Updated `PUT /admin/mass-promotions/:groupId` to find the true owner pin by stored images first, unset shared-image fields on the owner, and stamp `sharedImagesFromGroup` + `sharedImageCount` on all sibling pins when images exist
- Repaired live MongoDB data for the affected group: 69 sibling pins were backfilled with `sharedImagesFromGroup`, and the broken-pin count dropped to 0

### Learning
- updateMany with { massPromotionGroupId: groupId } is the pattern for group bulk-edits
- Modal overlay: position fixed; inset 0; click-outside-to-close via event target check
- Images NOT editable per group (shared via sharedImagesFromGroup reference); only metadata updateable

## Mass Group Edit — Image Update (2026-03-09)

### Feature: Edit modal can now add/remove images for a mass promotion group
- Images are shared across the group via sharedImagesFromGroup referencing the owner pin
- Only the owner pin (without sharedImagesFromGroup) stores actual image data
- GET /admin/mass-promotions now returns imageSourcePinId (owner pin _id) per group
- PUT /admin/mass-promotions/:groupId accepts images array; finds owner pin, calls normalizeIncomingPinImages, updates owner images + sharedImageCount on all other pins

### Frontend
- state.massGroups.editExistingImages, editAddedImages: image arrays for modal
- loadMassGroupEditImages(pinId): fetches full pin via GET /api/pins/:id, populates editExistingImages
- renderMassGroupEditImages(): renders existing (with toggle-remove) + new images in modal
- handleMassGroupEditImageInput(): reads files, appends to editAddedImages (same 3-photo/4MB limits)
- On submit: builds images payload from kept existing + new, includes in PUT body

### Learning
- Fetching full pin images on modal open (lazy fetch) avoids sending base64 in list responses
- resolveImageDataUrl + getImageIdentifier reused from main pin editor pattern
- Owner pin identified by absence of sharedImagesFromGroup field

## Mass Promo Image Sync — resolveSharedImages Not Called in List Endpoint (2026-03-09)

### Issue: Updated mass promo images not loading in frontend after PUT
- Root cause: GET /pins/nearby-promos never called resolveSharedImages() after fetching
- Non-owner pins have sharedImagesFromGroup set and store no actual images; they rely on runtime resolution from the owner pin
- After a PUT, the owner pin's images array was correctly updated in MongoDB, but /nearby-promos returned empty images: [] for all shared pins
- resolveSharedImages() existed and worked, but was only called in GET /pins/:id and server-rendered pin page — not in the list endpoint

### Fix
- Added resolveSharedImages() call in /pins/nearby-promos (~line 5158) for non-lean requests only
- Skipped when ?lean=true since images are projected out anyway

### Learning
- resolveSharedImages() must be called in every endpoint that returns mass promo pins with image data
- `sharedImageCount` alone is not enough for shared-image read paths; use `massPromotionGroupId` fallback when legacy docs are missing `sharedImagesFromGroup`
- Group image writes must update both the owner pin and every sibling pin's shared-image reference metadata, or popup hydration will silently fail later
- Lean mode strips images — always guard with !isLean to avoid useless DB lookups

## AyaKasir Merchants Integration — backend (2026-07-09)

### What was built (api.js "Merchants" section, ~line 5690)
- New `merchants` collection (indexes: slug unique, tenantId unique, status+updatedAt): tenant stores pushed server-to-server from the AyaKasir portal
- Partner API (Bearer `AYAKASIR_PARTNER_SECRET`, timingSafeEqual, 503 when env unset): `PUT /api/partners/ayakasir/stores` (upsert by tenantId; slug generated once on create, NEVER regenerated on update — SEO permanence) and `DELETE /api/partners/ayakasir/stores/:tenantId` (soft-hide default, `?purge=1` hard delete)
- Payload fully re-sanitized server-side; `orderUrl` must start with `AYAKASIR_ORDER_URL_PREFIX` (default `https://ayakasir.petalytix.id/`); lat/lng required (map pin); photos/menuHighlights/openingHours capped
- Public reads: `GET /api/merchants` (lean, active-only, for future map layer), `GET /api/merchants/:slug`
- SSR SEO page `GET /toko/:slug` (router + app-level like `/pin/:id`; `_redirects` `/toko/*` rule added): self-contained `.toko-*` styles, FoodEstablishment JSON-LD (geo, openingHoursSpecification, menu → orderUrl), canonical, "Pesan Online" CTA; hidden/missing → 302 `/`
- Sitemap now includes active `/toko/:slug` (weekly, 0.8); every merchant write busts `sitemapCache`

### Learning
- Writing api.js via the sandbox mount right after file-tool edits truncated the file (stale mount view read back = data loss); recovered from `git show HEAD:` + re-splice. Never bash read-modify-write a file freshly edited by file tools

## AyaKasir Merchants Integration — frontend map layer (2026-07-09, same day, later)

### What was built (app.js, self-contained block before getSellerAuthHeaders ~line 3146)
- `fetchMerchants()` — called once from initMap (after startLiveSellerRefreshLoop); GET /api/merchants → AdvancedMarkerElement markers (reuses `LiveSellerMarkerCtor`; white circle/blue border, first photo or store emoji via String.fromCodePoint)
- InfoWindow popup built with DOM textContent (injection-safe): name, category · city, buttons Pesan Online (orderUrl, _blank) / Halaman Toko (`/toko/:slug`) / WhatsApp
- `?toko=<slug>` deep link (`focusMerchantFromUrl`): pan + zoom ≥16 + open popup after fetch — matches the `mapFocusUrl` the SSR toko page links to
- All styles inline on elements — zero style.css changes; layer is independent of pin category filters and clustering (v1)

### Learning
- AyaKasir-side push implemented same day in the petalytix repo (see petalytix/ai-memory SESSION_LEARNINGS 2026-07-09 evening): migration + `ayanaon-partner.ts` + Settings UI + lifecycle auto-unlist. Deploy order: ayanaon first (with `AYAKASIR_PARTNER_SECRET`), then petalytix
- Frontend candidates for later: cluster merchants when count grows, a "Toko/UMKM" filter chip, periodic refresh (currently fetch-once per page load)

## Merchants v2 — popup redesign + WA cart ordering on /toko (2026-07-09, night)

### Owner-requested UX changes (both files)
- Data: merchants gain `logoUrl` (separate from `photos`, pushed by AyaKasir from the receipt logo) and per-highlight `category`; `GET /api/merchants` now also returns `logoUrl` + `menuHighlights` ($slice 3) and no longer returns orderUrl
- app.js popup rebuilt: logo (logoUrl→photo fallback) + name/category·city header with EXPLICIT dark colors (#17233b/#44506b — previously inherited theme color washed out on the light InfoWindow), ≤3 menu rows (thumb/name/price), single "Kunjungi Toko" CTA (Pesan Online + WhatsApp buttons removed); `ensureMerchantMapClickCloser()` adds a map click listener (once, from fetchMerchants) so the popup collapses on any map tap like regular pins
- /toko/:slug page: logo top-right of the main card (`.toko-card-head` flex + `.toko-logo`); gallery section REMOVED; menu now grouped by category (`.toko-menu__group/__category`) with per-item photo/name/price; "Pesan Online" CTA REMOVED (QR flow is for physical visitors); NEW WhatsApp cart — qty steppers per item (only when store has WA) + "Pesan via WhatsApp" CTA that builds a pre-filled wa.me message (items, per-line totals, Total) via inline `waScript`
- JSON-LD: `menu` (orderUrl) dropped; `image` = [logoUrl, ...photos]

### Learning
- The `waScript` client code lives inside a JS template literal → it must contain NO backticks or dollar-brace; quotes + string concatenation only; `'\\n'` in api.js source emits `'\n'` into the served script
- Old merchant docs (pre-v2) lack logoUrl/category — all readers fall back gracefully (photo fallback, "Menu" group)

## Merchants v3 — popup polish + toko theme toggle (2026-07-09, late night)

### Changes
- Popup (app.js): InfoWindow created with `{ headerDisabled: true }` → Google's close button/header removed (map-click closer is the only dismiss); menu name/price rows replaced by a 3-photo preview strip (72px, from `merchant.photos` with `menuHighlights[].photoUrl` fallback)
- `GET /api/merchants`: `photos: {$slice:3}` (was 1) + `photos` array in the response (kept `photo` first-item for compat)
- /toko/:slug theme: whole style block converted to CSS custom properties on `body.toko-page` with a `body.toko-dark` override set (incl. `color-scheme`); "Gelap/Terang" `.toko-ghost` button in the header; `themeScript` placed immediately after `<body>` open (applies stored/prefers-color-scheme theme before paint — no flash), persists to `localStorage('toko-theme')`
- Store `category` comes from the AyaKasir push payload — petalytix currently hardcodes "Kuliner" (ayanaon defaults to 'Kuliner' when absent); making it owner-selectable is a petalytix-side follow-up

### Learning
- `headerDisabled` needs Maps JS ≥3.56 — the app loads via importLibrary (weekly channel), so it's available; unknown options are ignored harmlessly on older channels
- petalytix same-night counterpart: `products.sort_order` migration + Kantor menu-page ↑/↓ reordering feed the order used by `/toko` menu grouping (via ordered `menuHighlights`) — ayanaon needed no changes for that

## Merchants v4 — full menu, layout passthrough, tenant category (2026-07-09, final)

### Changes (api.js)
- `menuHighlights` caps raised 12→100 (sanitizer + /toko page): the store page now mirrors the FULL AyaKasir order-page menu, not a highlights sample (root cause of "Kopi only showed Caramel Macchiato")
- New sanitized `menuLayout` field (`LIST|GRID|ACCORDION`, default LIST, `MERCHANT_MENU_LAYOUTS`) pushed from the tenant's AyaKasir "Tampilan menu pelanggan"; /toko renders per layout — GRID = `.toko-menu__list--grid` photo cards, ACCORDION = native `<details>/<summary>` per category (first `open`), LIST unchanged. Item classes identical in all layouts so the WA-cart script needs no changes
- `category` now arrives owner-picked from AyaKasir (still free text ≤60, still defaults 'Kuliner')

### Learning
- Old merchant docs need one re-push from AyaKasir to gain menuLayout/full menu — readers default gracefully meanwhile

## Merchants v5 — availability, logo square pin, merchant search (2026-07-09)

### Changes
- `menuHighlights[].available` accepted from AyaKasir (default true; push-time BOM stock snapshot); /toko renders sold-out items with `.toko-menu__item--out` (greyed + grayscale thumb) + "Habis" badge + NO stepper, so the WA cart skips them automatically (`if (!countEl) return`)
- Map marker (app.js `createMerchantMarkerElement`): rounded SQUARE (borderRadius 8px, was 50%) showing the tenant LOGO (`merchant.logoUrl`) — never a menu photo; store-emoji fallback
- Map search now matches merchants: partner PUT builds `merchants.searchText` (lowercased blob: name/category/address/city/province + every menu item name + item categories, ≤4000 chars) via `buildMerchantSearchText`; lean `GET /api/merchants` projects it; app.js entries carry `searchText` (client `buildMerchantSearchBlob` fallback for pre-v5 docs) and `filterMarkers` filters merchant markers with the same `currentSearchTokens` every-token-includes logic as live sellers (category checkboxes/date filters intentionally don't apply; hidden in SAVED view)

### Learning
- Merchant docs pushed before v5 lack searchText/available — client fallback blob covers search (from the 3 sliced highlights only), and availability defaults to available; one AyaKasir re-sync fixes both

## Merchants v6 — LIVE availability + tenants in the results list (2026-07-09)

### Changes
- /toko live availability: SSR derives `body[data-avail-endpoint]` from the stored orderUrl → `{origin}/api/ayakasir/online-order/availability?token=…` (new CORS API on the AyaKasir side, 30s edge cache); badge (`.toko-soldout[hidden]`) + stepper (`disabled`) now ALWAYS rendered so `availScript` can toggle both ways; polls on load + 60s interval + visibilitychange, hides rows when the tenant hides out-of-stock, zeroes sold-out cart lines and calls `window.tokoRefreshCart` (exposed by waScript)
- Search results list (`updatePinListPanel`): when a search matches merchants, a "Toko / UMKM" section renders ABOVE pins (≤10, distance-sorted, logo/emoji + name + category·city·distance, row click = `focusMerchantEntry` pan+popup, "Kunjungi" link → /toko/:slug); empty-state + summary (`… + N toko`) account for merchants so a merchant-only match no longer shows "no results"; merchant entries now track `isVisible` in `filterMarkers`; `focusMerchantFromUrl` refactored onto shared `focusMerchantEntry`

### Learning
- The availability endpoint origin comes from each merchant's stored orderUrl — local-only testing needs BOTH `AYAKASIR_PUBLIC_ORIGIN` (petalytix) and `AYAKASIR_ORDER_URL_PREFIX` (ayanaon) pointed at the local dev origin, then a re-sync; otherwise local /toko pages poll the prod endpoint
- **v6 fix**: `focusMapOnSearchResults` (search submit) counted only pins + live sellers → merchant-only matches raised the "Pencarian tidak ditemukan" alert despite visible markers/list rows. Now includes `visibleMerchantEntries` in the empty check, `merchantCandidates` in nearest-result panning, and opens the merchant popup when a merchant is nearest. Rule: every surface consuming search visibility (filterMarkers, list panel, focus-on-results) must handle all THREE layers — pins, live sellers, merchants

## Netlify deploy failure — phantom .claude worktree submodules (2026-07-10)

### Issue
`git clone` on Netlify failed with "No url found for submodule path '.claude/worktrees/admiring-mcnulty' in .gitmodules". Ten Claude session worktrees under `.claude/worktrees/*` each contain a `.git` file, so `git add .` recorded them as gitlinks (mode 160000) with NO `.gitmodules` entries — Netlify's submodule checkout then hard-fails.

### Fix
- `git update-index --force-remove` on all 10 gitlinks + `.claude/settings.local.json` (plain `git rm --cached` failed in the sandbox: the worktree `.git` files hold Windows `gitdir:` paths that break git there, and a stale `.git/index.lock` had to be force-deleted)
- Deleted the worktree dirs + `git worktree prune` + deleted the 10 local `claude/*` branches (all pointed at old HEAD, no unique work)
- `.claude/` added to `.gitignore` in BOTH repos (petalytix also had `.claude/settings.local.json` tracked — untracked preventively; its worktrees would break Vercel the same way)

### Learning
- NEVER let `.claude/` into git: worktrees inside the repo = phantom submodules = broken deploy clones. The staged deletions ride the next commit — commit + push, then Netlify's clone succeeds

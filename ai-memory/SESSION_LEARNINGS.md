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

## Cloudflare deployment migration assessment (2026-07-29)
- Target Cloudflare Workers with Static Assets, not a new Pages project: AyaNaon is a full-stack Express app with static `public/` assets and dynamic API/SEO routes.
- Migration is not configuration-only: replace `serverless-http` with Workers `httpServerHandler` under `nodejs_compat`, and remove the eager top-level MongoDB connection.
- Keep MongoDB Atlas initially; Hyperdrive does not support MongoDB, so prove the native driver/TLS connection in a staging Worker before DNS cutover.
- Replace every `x-nf-client-connection-ip` read with a centralized `cf-connecting-ip` helper (plus a local-development fallback) to preserve voting, reporting, and analytics behavior.
- Remove the Netlify `public/_redirects` function rewrites; unmatched paths should reach Express while matching files are served by Workers Static Assets.
- Use Cloudflare edge rules for Always Use HTTPS and apex-to-`www`; preserve `https://www.ayanaon.app` as the canonical host.
- Workers Paid (minimum $5/month) is the safe starting tier because bcrypt, SSR, MongoDB, and large JSON photo handling can exceed the Free plan's 10 ms CPU limit.
- Cut over only after staging route, auth, uploads, Apify, AyaKasir partner API, SEO routes, caching, PWA, and rollback tests pass; keep Netlify intact during observation.

## Cloudflare migration Step 1 evidence audit (2026-07-29)
- Netlify credit usage rose from 265 to 299 to 334 across the last three periods; the screenshot shows category trends but not exact per-category units or the plan allowance.
- DNS evidence records apex/`www` Netlify targets, Google verification TXT, 3600-second TTL, and four `p05.nsone.net` authoritative nameservers.
- DNSSEC status is still missing and must be captured at the domain registrar before nameserver migration.
- The environment export is production-scoped but contains exposed credentials; rotate/revoke them and keep only a redacted name/scope inventory in migration documentation.
- `JWT_SECRET` is absent, so production currently falls back to the hard-coded development secret; setting a strong value will invalidate existing JWT sessions.
- `ABLY_API_KEY`, `DASHBOARD_PASSWORD`, and both `NETLIFY_DATABASE_URL*` names are not referenced by the AyaNaon repository; verify external consumers before removal.
- The supplied Atlas table is Database Access (users/roles), not Network Access (IP access list); the actual CIDR/IP rules remain required.
- The application Atlas user is over-privileged (`atlasAdmin` plus database read/write); plan a least-privilege replacement with only `readWrite@ayanaon-db`.

## Cloudflare migration Step 1 completed (2026-07-29)
- Netlify Free includes 300 credits; the latest 334-credit period exceeded the allowance by 34 credits (about 11.3%), with compute/bandwidth dominant visually.
- The authoritative DNS export is complete: only apex and `www` Netlify targets plus the Google verification TXT; registrar is Hostinger.
- Hostinger shows no configured DNSSEC/DS record, so DNSSEC is currently disabled and does not need removal before the nameserver switch.
- All Netlify environment contexts/scopes/builds are accounted for; exposed credentials still require rotation before production cutover.
- The Google key has redundant/invalid referrers (including an `ayanaop.app` typo) and access to 31 APIs; reduce it to required hosts/APIs and add Cloudflare staging/local Wrangler hosts.
- Split browser Maps/Places access from server Geocoding into separate keys because HTTP-referrer restrictions do not protect or reliably authorize Worker-side requests.
- Atlas Network Access contains active `0.0.0.0/0`, so a staging Worker can reach Atlas, but the two `/32` entries are redundant while allow-all remains.
- Step 2 may begin; retain allow-all temporarily for compatibility, paired with rotated credentials and a least-privilege `readWrite@ayanaon-db` application user.

## Cloudflare migration Step 2 local implementation (2026-07-29)
- Added the redacted future handoff at `ai-memory/CLOUDFLARE_MIGRATION_STEP1.md`; it contains no credential values.
- `api.js` now exports the shared Express app plus the unchanged Netlify handler; the existing WhatsApp-only merchant edit remains intact.
- MongoDB creation/connection is lazy, client IP lookup supports Cloudflare/Netlify/local, and browser/server Google keys are split with legacy fallback.
- Added `src/worker.js`, `wrangler.jsonc`, required-secret validation, Static Assets, observability, and redacted `.dev.vars.example`.
- Wrangler aliases only unused MongoDB Kerberos/client-encryption native add-ons; dry bundle succeeds at 962.56 KiB gzip with 22 assets.
- Netlify-only rewrites moved from `public/_redirects` to `netlify.toml`; `public/_headers` keeps the service worker at `no-cache` on both providers.
- Four deployment-adapter tests pass; Wrangler runtime smoke tests pass; Netlify 35.1.6 offline build still bundles `api.js` successfully.
- Remote Worker/Atlas validation is pending Cloudflare project secrets; npm audit also reports 5 high and 3 moderate production-tree advisories for a separate pre-cutover dependency update.

## Cloudflare request-scoped MongoDB lifecycle fix (2026-07-29)
- Symptom on the live staging Worker: concurrent database-backed routes intermittently returned Cloudflare Error 1101 HTML; browser JSON parsing then failed with `Unexpected token '<'`, so the map rendered without pins even though `/api/pins?lean=1` could return 3,095 valid pins when requested alone.
- Cloudflare observability reported requests canceled as hung. Root cause was the module-level `MongoClient` and database object in `api.js`, which reused request-bound TCP/I/O resources across Worker invocations.
- Added `src/request-scope.js` using `AsyncLocalStorage`. Each outer adapter request creates independent state; nested calls reuse that state; async disposal runs once in `finally`, including error paths.
- `connectToDatabase()` now lazily creates one MongoDB client and one shared connection promise per request, while `src/worker.js` and the Netlify handler both wrap their complete request lifecycle. The client closes before the adapter request resolves.
- Global I/O objects/promises are forbidden. The existing `indexesEnsured` boolean may remain global because it is primitive readiness metadata; concurrent cold-start index attempts are idempotent and no database promise crosses requests.
- Pre-deploy verification: current Workers types `5.20260729.1`, syntax checks, seven adapter/request-scope tests, Wrangler dry-run bundle (4,800.42 KiB / 963.14 KiB gzip), and three local concurrent waves (18 total calls across pins/count/features/live-sellers/resident-share/config) all passed with HTTP 200 JSON.
- Production staging verification after Git build `d869c49` (Worker version 7): 30/30 concurrent API calls passed across five waves, each pins response returned 3,095 records, the browser logged `Pins synchronized` and rendered 582 visible `gmp-advanced-marker` elements, and observability returned zero error events for version `f6db24c8-fdb1-4f0c-a480-ca4280a0521d` during the test window.

## Cloudflare staging acceptance checkpoint (2026-07-29)
- Owner confirmed the complete temporary-pin workflow on `ayanaon.petalytix-id.workers.dev`: create with image, marker/popup display, reload persistence, search, detail/share page, admin edit, and delete all passed.
- Owner confirmed Warga registration/login, session persistence, profile changes, saved-pin persistence, logout/login restoration, and location-sharing enable/disable all pass on the Worker.
- Gerobak Online seller acceptance is intentionally skipped, not failed, because the feature is currently deactivated.
- The Gather Pins/Apify run completed and produced a reviewable draft; its location search then exposed a browser-key `Geocoding Service` authorization failure.
- Gather address search now uses authenticated `GET /api/admin/gather/geocode` with the server-only `GOOGLE_GEOCODING_API_KEY`; the owner confirmed Jakarta search now works and fills the map coordinates.
- Cloudflare observability confirmed four authenticated Jakarta requests reached Worker version 9 with `outcome: ok` and controlled HTTP 502 responses in roughly 0.3 seconds; this is not a Worker crash or auth failure.
- The separate Google server-key creation/restriction action is complete: Geocoding API authorization now succeeds while the browser key remains separate.
- Owner confirmed the complete Gather draft lifecycle passed: required-field completion, save/reload persistence, publication, public map/search/popup/detail/share verification, and cleanup.
- Next manual gate is the AyaKasir partner sync lifecycle; staging currently returns two active merchants (`ES TEH SOLO`, `Kedai Rakyat`) as the comparison baseline before SEO/PWA and DNS tests.

## Cloudflare AyaKasir staging acceptance (2026-07-29)
- Owner confirmed the AyaKasir control-panel lifecycle path: a newly synced store appears on AyaNaon, disappears when unlisted, and returns after reactivation.
- Owner confirmed re-sync updates store/menu data while preserving `/toko/:slug`; marker, search, popup, storefront, and live-availability behavior all passed.
- The AyaKasir staging gate is fully passed. Next is SEO/PWA route, canonical, sitemap, cache, installation, offline, and rollback validation.

## Cloudflare SEO/PWA staging implementation (2026-07-29)
- Deployed commit `0401bec` through the connected Git build; Cloudflare build `68752187-e6ce-42b9-b41d-68bbf3653d3f` completed successfully.
- The `workers.dev` staging hostname now returns `X-Robots-Tag: noindex, nofollow` for both Static Assets and Worker-generated API/SSR responses; production hosts remain indexable and canonical URLs still target `https://www.ayanaon.app/`.
- Homepage metadata now uses Indonesian document language, absolute production social images, a root-relative manifest, and the package-aligned `2.5.2` footer.
- The manifest has stable `/` identity/start/scope, Indonesian language metadata, standalone display, and exact 192x192 plus 512x512 PNG assets; the previously mislabeled 193x193 and 500x500 files were normalized.
- Service-worker installation is now atomic: failed precaching does not activate an incomplete cache, activation waits for cleanup, updates wait for the existing user-controlled `SKIP_WAITING` action, API/dynamic requests bypass cache interception, and only successful static responses enter cache.
- Automated verification passed: 15 deployment/request-scope/geocoding/PWA tests, Wrangler dry-run (22 assets, 4,804.35 KiB / 964.25 KiB gzip), Netlify 35.1.6 offline rollback build, and live HTTP checks for homepage/manifest/service worker/icons/API/sitemap.
- Connected-browser verification confirmed the deployed `lang=id`, `/manifest.webmanifest`, version 2.5.2, map presence, service-worker registration, and pin synchronization. Geolocation errors are expected because the automation browser has no location permission.
- Remaining manual SEO/PWA gate: install from a real Chrome/Android device, confirm standalone launch, disable network and reopen/reload a previously visited page to confirm cached-shell fallback, then restore network. The in-app automation browser does not expose its install prompt or offline emulation, so these are not yet marked passed.
- DNS/custom-domain cutover must not start until this device-only install/offline gate is confirmed.

## Cloudflare SEO/PWA staging acceptance completed (2026-07-29)
- Owner confirmed all four device-only checks passed: installation, standalone launch, offline shell, and online recovery.
- The SEO/PWA staging gate is fully passed.
- Cloudflare account inspection confirms Workers Paid is active, the Worker has all nine required configuration/secret binding names, and no `ayanaon.app` Cloudflare DNS zone or Worker custom domain exists yet.
- Next phase is controlled DNS onboarding: create the Cloudflare zone and copy the three authoritative records while Netlify remains the origin; do not change Hostinger nameservers or attach production Worker domains until the imported zone is verified and exposed credentials are confirmed rotated.

## Cloudflare DNS onboarding review (2026-07-29)
- `ayanaon.app` now exists as a pending full Cloudflare zone on the Free Website plan; assigned nameservers are `brad.ns.cloudflare.com` and `riya.ns.cloudflare.com`.
- The authoritative registrar delegation is unchanged and still uses the four `p05.nsone.net` nameservers, so the pending Cloudflare zone is not serving production DNS yet.
- Quick Scan preserved the Google verification TXT but converted the two Netlify hostnames into four proxied A records (`13.52.188.95` and `52.52.192.191` at apex and `www`). These point-in-time IP records are rejected for the migration baseline.
- Before nameserver activation, delete all four scanned A records and create DNS-only CNAMEs from apex and `www` to `ayanaon.netlify.app`; retain the TXT unchanged. Reverify that exactly three records remain before changing Hostinger nameservers.

## Cloudflare pre-activation DNS verification passed (2026-07-29)
- Cloudflare API confirms the pending zone contains exactly three records: DNS-only CNAMEs from apex and `www` to `ayanaon.netlify.app`, plus the unchanged Google verification TXT.
- The rejected scanned A records are gone, no Worker custom domain is attached, and production remains on Netlify.
- The Hostinger nameserver replacement is approved: remove all four `p05.nsone.net` nameservers and set only `brad.ns.cloudflare.com` plus `riya.ns.cloudflare.com`; keep DNSSEC disabled.
- After submitting the registrar change, request Cloudflare's nameserver check and wait for the zone to become active before creating any Worker custom domain.
- The dashboard's `ayanaon.app is not fully protected` warning is expected during this DNS-only bridge: do not proxy the temporary Netlify CNAMEs. Workers Custom Domains will later replace them with Cloudflare-managed proxied records.

## Cloudflare authoritative DNS activation completed (2026-07-29)
- Hostinger delegation now uses only `brad.ns.cloudflare.com` and `riya.ns.cloudflare.com`; both `1.1.1.1` and `8.8.8.8` return the new nameservers.
- Cloudflare marked zone `ayanaon.app` active at `2026-07-29T12:52:43Z`.
- Bridge verification passed: apex returns Netlify HTTP 301 to `https://www.ayanaon.app/`; `www` and `ayanaon.netlify.app` return matching Netlify HTTP 200 content over HTTPS.
- No Worker Custom Domain is attached yet. Netlify remains the production origin and rollback path while the next custom-domain rehearsal is prepared.

## Cloudflare staging custom-domain rehearsal deployed (2026-07-29)
- Added staging-host crawler protection before routing: both Static Assets and Worker-generated responses on `staging.ayanaon.app` return `X-Robots-Tag: noindex, nofollow`, while `www.ayanaon.app` remains indexable.
- Commit `f2f1282` passed 16 deployment tests, Wrangler dry-run (22 assets, 4,804.41 KiB / 964.26 KiB gzip), the Netlify 35.1.6 offline rollback build, and Cloudflare Git build `6c39aa88-462a-4e58-9046-05faafdb6ec7`.
- Attached `staging.ayanaon.app` to Worker `ayanaon` as an enabled Custom Domain. Cloudflare issued certificate `e4b0685b-4241-468f-b6c7-b4020dd48dbb` and created a managed proxied AAAA placeholder record (`100::`).
- Public `1.1.1.1` and `8.8.8.8` resolution, HTTPS, homepage, manifest, service worker, merchants API, sitemap, production canonicals, and crawler headers all pass on the custom hostname.
- Connected-browser verification rendered 584 markers and logged successful service-worker registration, visitor count, active pin count, and pin synchronization. No Google authorization error occurred; automation-only geolocation permission errors are expected.
- Apex and `www` remain DNS-only Netlify CNAMEs. Before production `www` cutover, perform a short custom-domain smoke test for public search/storefront, Warga login/session/logout, and admin login plus Jakarta geocoding.

## Cloudflare staging custom-domain acceptance completed (2026-07-29)
- Owner confirmed the complete `staging.ayanaon.app` smoke test passed: public map/search/storefront, Warga login/session/logout, admin login, and Jakarta geocoding.
- The custom-domain rehearsal gate is fully passed. Apex and `www` intentionally remain DNS-only CNAMEs to Netlify; no production routing change is approved yet.
- A fresh production-only `npm audit --omit=dev` found seven advisories: four high and three moderate. Direct findings are `axios` (high) and `body-parser` (moderate); transitive findings are `follow-redirects`, `form-data`, `jws`, `path-to-regexp`, and `qs`.
- `npm audit fix --dry-run --omit=dev` reports fixes for all seven without requiring `--force`, including `axios` 1.18.1, `body-parser` 2.3.0, and patched transitive versions. Apply the update deliberately and rerun the complete automated/staging regression gate before production cutover.
- Production cutover remains blocked until the dependency audit is clean and the owner confirms—without sharing values—that all credentials exposed in the original inventory were rotated and synchronized with any system that must remain a working rollback path.

## Cloudflare pre-cutover dependency remediation completed (2026-07-29)
- Updated the production runtime to `axios` 1.18.1, `body-parser` 2.3.0, Express 5.2.1, and `jsonwebtoken` 9.0.3; the lockfile now resolves patched `follow-redirects`, `form-data`, `jws`, `path-to-regexp`, and `qs` transitives.
- `npm audit --package-lock-only --omit=dev` now reports zero production vulnerabilities.
- Compatibility verification passed: all 16 deployment/request-scope/geocoding/PWA tests, Wrangler dry-run (22 assets, 4,306.98 KiB / 777.07 KiB gzip), and Netlify 35.5.14 offline rollback build.
- Netlify CLI remains at the existing 23.5.1 range to keep the rollback-tool change out of this patch. The full development-tool audit still reports 41 findings; these are not in the production runtime and should be retired with the Netlify toolchain after the rollback window.
- Commit `5d00a67` deployed successfully through Cloudflare Git build `8c6cd384-9852-4030-90c5-a282bed113bf`.
- Post-deploy staging checks passed: homepage and manifest HTTP 200, `X-Robots-Tag: noindex, nofollow`, 3,097 pins, two active merchants, and configuration API HTTP 200.
- One brief owner-operated authentication/admin smoke test remains because private login credentials are not available to automation. Production cutover also remains blocked until the owner confirms—without sharing values—that exposed credentials were rotated and synchronized with the rollback environment.

## Cloudflare production cutover preflight passed (2026-07-29)
- Owner confirmed the post-dependency staging smoke test passed, including the private Warga/admin paths.
- Owner confirmed the least-privilege `local_migration` MongoDB credential, MongoDB dashboard password, AyaKasir partner secret, and Apify token were rotated and synchronized with the Netlify rollback environment; no secret values were recorded.
- Cloudflare zone `ayanaon.app` is active on `brad.ns.cloudflare.com` and `riya.ns.cloudflare.com`. The Google verification TXT is preserved.
- Apex and `www` remain DNS-only CNAMEs to `ayanaon.netlify.app`; public HTTPS verifies `www` is served by Netlify and apex returns HTTP 301 to `https://www.ayanaon.app/`.
- Only `staging.ayanaon.app` is attached to Worker `ayanaon`; it returns HTTP 200 from Cloudflare with `X-Robots-Tag: noindex, nofollow`.
- All implementation, security, staging, dependency, DNS, and rollback gates are passed. The remaining action is the explicitly approved production Custom Domain cutover, followed by immediate public/auth/admin verification and a 7–14 day Netlify rollback window.

## Cloudflare www production cutover completed (2026-07-29)
- Owner explicitly approved the `www` production cutover. Immediately before mutation, `www.ayanaon.app` was the single DNS-only CNAME `508fb177a04ebc62d576eb34cbda42ee` to `ayanaon.netlify.app`, and Worker build `8c6cd384-9852-4030-90c5-a282bed113bf` for commit `5d00a67` was successful.
- Cloudflare required deletion of the external CNAME before attachment. The CNAME was removed and `www.ayanaon.app` was attached to Worker `ayanaon` as Custom Domain `0e0310885f0d39954d8083a89f8f47ffd797febf`, with certificate `b6011ce2-72ae-4bf4-80c2-48db5738cb0e`.
- Cloudflare created managed proxied AAAA record `7a713bf5cccc7baa6d0cebdadab2dde5` (`100::`, read-only). Both `1.1.1.1` and `8.8.8.8` resolve `www` to Cloudflare anycast IPv4/IPv6 addresses.
- Production verification passed: homepage, manifest, service worker, sitemap, and configuration API return HTTP 200 from Cloudflare; production has no staging crawler header, the canonical is `https://www.ayanaon.app/`, the database reports 3,097 pins and two merchants, and the rendered map synchronized 584 markers.
- Automation-only geolocation errors are expected. The disabled Gerobak/live-seller warning is identical on staging and is not a cutover regression.
- Apex remains DNS-only on Netlify and still returns HTTP 301 to `https://www.ayanaon.app/`, preserving the planned rollback window. Rollback is to detach Custom Domain `0e0310885f0d39954d8083a89f8f47ffd797febf` and recreate a DNS-only CNAME from `www.ayanaon.app` to `ayanaon.netlify.app`.
- Next gate is owner-operated production Warga/admin acceptance. If it passes, observe Cloudflare production for 7–14 days while retaining Netlify unchanged.

## Cloudflare production acceptance completed (2026-07-29)
- Owner confirmed all private production acceptance checks passed on `https://www.ayanaon.app`: public map/search/storefront, Warga authentication/session/logout, admin authentication, and Jakarta geocoding.
- Final Cloudflare snapshot confirms Custom Domains `www.ayanaon.app` and `staging.ayanaon.app` remain enabled on Worker `ayanaon`; the managed proxied records and certificates are unchanged.
- Apex remains the DNS-only CNAME to `ayanaon.netlify.app`, and the Google verification TXT remains unchanged. Netlify is still the rollback path.
- The observation window starts 2026-07-29. Earliest seven-day review is 2026-08-05; the recommended fourteen-day retirement review is 2026-08-12.
- During observation, do not delete the Netlify site, remove its synchronized secrets, change the apex record, retire rollback credentials/users, remove staging, or enable DNSSEC.
- After a clean observation window: move the apex redirect fully to Cloudflare, verify path/query preservation, retire Netlify and obsolete Netlify-only tooling/credentials, remove the staging hostname if no longer needed, review Atlas access and legacy database users, then enable DNSSEC as a separate final change.

## Production admin Maps referrer incident (2026-07-30)
- `https://www.ayanaon.app/admin` reports Google Maps JavaScript API `RefererNotAllowedMapError`; the browser-key value is intentionally not recorded.
- Admin correctly fetches `GOOGLE_MAPS_BROWSER_API_KEY` through `/api/config` and loads the Google Maps JavaScript API with the Places library. This is an external key restriction mismatch, not a Cloudflare routing failure.
- The captured legacy allowlist included the root and `/admin.html`, but the production application now uses the clean `/admin` route. The intended migration policy already requires host-wide `https://www.ayanaon.app/*` and `https://ayanaon.app/*` entries.
- Add/retain host-wide website restrictions for production, staging, Netlify rollback, and approved local development origins; keep API restrictions limited to Maps JavaScript API and Places API (New). The server Geocoding key remains separate.
- The repository has no `IntersectionObserver` usage. The Google-script observer exception is treated as a secondary symptom of failed Maps initialization unless it persists after referrer authorization is corrected.
- No application deployment or DNS change is required. Save the Google browser-key restrictions, allow propagation, hard-refresh `/admin`, and retest the map plus Jakarta search.

## Production Admin geocoding proxy completed (2026-07-30)
- Owner confirmed the production Admin map renders after the host-wide browser referrer update, but Manage Pins search returned `GEOCODER_GEOCODE: REQUEST_DENIED` because `public/admin.js` still instantiated the browser-side `google.maps.Geocoder`.
- This was an application migration gap, not a DNS or Cloudflare routing issue. The security policy remains unchanged: the browser key is limited to Maps JavaScript API and Places API (New), while Geocoding API uses the separate server-only `GOOGLE_GEOCODING_API_KEY`.
- Manage Pins single-location search and the shared mass/brand location scope now call authenticated `GET /api/admin/gather/geocode`; the existing endpoint retains resident authentication plus `canManagePinsResident` authorization and returns only normalized coordinates/address metadata.
- Removed all `new gmaps.Geocoder()` use from Admin and advanced the PWA static cache revision from `cf1` to `cf2` so installed clients can receive the corrected `admin.js` through the existing user-controlled update flow.
- Verification passed: JavaScript syntax, all 17 deployment/request-scope/geocoding/PWA tests, Wrangler dry-run (22 assets, 4,844.29 KiB / 972.44 KiB gzip), and Netlify 35.5.14 offline rollback build.
- Commit `a0b7663` deployed successfully through Cloudflare Git build `35e10606-07ea-44e9-9a1f-c06609f9d7de`. Production serves the proxy-based Admin bundle and `cf2` service worker with HTTP 200; unauthenticated geocode requests return HTTP 401, confirming the route remains protected.
- Remaining acceptance action: approve/apply the PWA update if prompted, reload `https://www.ayanaon.app/admin`, sign in, and confirm Manage Pins search for Jakarta moves the marker and fills latitude/longitude. Also spot-check a mass/brand query with a location suffix such as `kopi di Jakarta`.

## Gather Pins tiket/KalenderLari recovery + published duplicate cleanup (2026-07-30)
- Root cause for KalenderLari zero rows: the Actor still selected singular `/event/` links, while the live archive exposes event details under plural `/events/<slug>` URLs.
- Root cause for tiket.com zero rows: the search cards still render, but current detail pages no longer expose the old hydrated product object and localized browser detail requests may return HTTP 403. The adapter now reads title/date/location/images from the rendered search card, tries Event JSON-LD when detail is available, and emits the card fallback when detail navigation is blocked.
- Tiket date normalization now supports English and Indonesian full/abbreviated month names. Missing numeric values remain `null` instead of becoming false `0,0` coordinates.
- KalenderLari now reads current `/events/` links, tolerates the site's invalid escaped apostrophes in Event JSON-LD, and falls back to MEC date/location elements. HTML entities in gathered titles are decoded.
- Live local Actor verification passed: tiket.com gathered one dated/geocoded row with three images despite a reproduced detail HTTP 403; KalenderLari gathered one dated/geocoded row with the venue/location populated. Nominatim now retries the broader locality when the exact venue string has no match.
- Published duplicate suppression now checks Gather provenance first, then normalized title plus either coordinates within 350 meters or the same canonical link. This catches manual/admin-published pins such as `SPBU COCO Jakarta Samanhudi` without collapsing different stations that share the Pertamina locator URL.
- New imports skip published matches, draft refresh automatically deletes older queue entries that match a published pin, and publish rechecks the same rule to close race/manual-entry gaps.
- The Gather Link field now includes an `Open in new tab` control that is enabled only for valid HTTP(S) links and uses `noopener noreferrer`.
- PWA static cache revision advanced from `cf2` to `cf3` for the updated Admin assets.
- Verification passed: live one-row Actor runs for both repaired sources, Actor/backend/Admin JavaScript syntax, `git diff --check`, five new Gather regression tests, the complete 22-test deployment suite, and Wrangler dry-run (22 assets, 4,848.72 KiB / 973.38 KiB gzip).
- Deployment is still required for this patch: rebuild the Apify Gather Actor, then deploy the AyaNaon app/Worker so the backend, Admin UI, and `cf3` service worker are live.

## Gather Pins localhost Maps configuration isolation (2026-07-30)
- Reproduced `Google Maps belum dikonfigurasi.` on the already-running `localhost:8787`: `/api/config` returned an empty browser key even though the legacy `GOOGLE_MAPS_API_KEY` in local `.env` was non-empty; no secret value was printed or recorded.
- The scraper had not failed. After Tiket.com or KalenderLari completed, automatic draft selection initialized the optional map preview, and that later UI warning could overwrite the successful Gather message.
- Root cause of the configuration mismatch: Wrangler can supply declared-but-unset `GOOGLE_MAPS_BROWSER_API_KEY` and `GOOGLE_GEOCODING_API_KEY` bindings as empty strings, while JavaScript destructuring defaults only apply to `undefined`. Both split keys now use truthy fallback to the legacy key.
- A fresh process loaded from the same `.env` returned a configured `/api/config` response, confirming the fallback. An already-running Wrangler process still requires restart because environment-derived constants are captured at module startup.
- Missing/unloadable browser Maps configuration now renders only an inline unavailable state in the preview. It no longer changes the Gather run result, and authenticated server geocoding can still fill latitude/longitude before the preview retries.
- The PWA static cache revision advanced from `cf3` to `cf4` for the corrected Admin assets.
- Verification passed: backend/Admin/service-worker syntax, the complete 24-test deployment suite, and Wrangler 4.115.0 dry-run (22 assets, 4,849.10 KiB / 973.46 KiB gzip). The existing `whatwg-url` default-import warning remains non-blocking.
- This patch is local only; restart `npm run dev:cloudflare` for localhost to load it, and deploy the Worker/Admin assets separately when ready.

## Wrangler local Maps secret allowlist fix (2026-07-30)
- Adding `http://localhost:8787/*` and `http://127.0.0.1:8787/*` to Google browser-key referrers did not affect `Google Maps belum dikonfigurasi.` because that message occurs before Google receives a browser request.
- Safe inspection confirmed `.dev.vars` is absent, local `.env` contains a non-empty legacy `GOOGLE_MAPS_API_KEY` but not the split names, and the running port 8787 still returned an empty `/api/config` key.
- Current Cloudflare behavior is authoritative: when `wrangler.jsonc` defines `secrets.required`, local development loads only listed names from `.env`/`.dev.vars`; the unlisted legacy key was filtered out before Worker startup.
- Added Wrangler environment `local` with the legacy and split Google names plus all existing local requirements. `npm run dev` and `npm run dev:cloudflare` now select it, allowing the API's truthy split-to-legacy fallback to execute.
- The top-level production secret requirements remain unchanged and keep browser/server keys separate. Deploy and bundle-check scripts now pass `--env=""` explicitly so the new named local environment can never become an accidental deployment target.
- Isolated Wrangler 4.115.0 verification on port 8788 loaded the hidden legacy key from `.env`; `/api/config` returned configured with key length 39. The homepage rendered meaningful content and its map container with no browser console errors or framework overlay.
- Verification passed: JSON/JavaScript syntax, `git diff --check`, the complete 25-test deployment suite, and the explicit top-level Worker dry-run (22 assets, 4,849.10 KiB / 973.46 KiB gzip). The existing `whatwg-url` warning remains non-blocking.
- Port 8787 is still the owner's earlier process and must be stopped and restarted with `npm run dev:cloudflare`; no Google Console change or production deployment is required for this localhost fix.

## Apify Gather Actor 1.1 browser-adapter deployment (2026-07-30)
- The new Tiket/KalenderLari zero-result reports were remote deployment drift, not duplicate filtering or a new website failure: recent successful-status runs had zero dataset rows, zero exclusions, build `1.0.2`, and the old `Gathered 0 <source> item(s).` log signature.
- Pushed the already-repaired browser adapters as Actor version `1.1`; build `1.1.1` succeeded and the Actor's default run option remains `build: latest`. The package now reports version `1.1.0`, and `.actorignore` keeps `node_modules`, local Actor storage, environment files, and logs out of uploads.
- Live remote one-row smoke runs succeeded on build `1.1.1`: Tiket returned `LANY: soft world tour (29 October 2026) - General on Sale` with all eight mandatory fields and three images; KalenderLari returned `d'BestO Family Run 2026` with all eight mandatory fields. Both logs used the new duplicate-aware completion message.
- The two smoke runs cost about USD 0.0836 combined. A subsequent Gather action from localhost or the deployed Admin will use the repaired `latest` Actor without an app restart or Worker deployment because the backend starts the external Actor by ID.
- Added deployment metadata regression coverage for Actor/Node version alignment, the `latest` build tag, and upload exclusions. The complete deployment suite passes 26/26 tests; Actor syntax and `git diff --check` also pass.

## Tiket full event-detail summary and venue precision (2026-07-30)
- Root cause of the LANY draft's generic description and Tanah Abang centroid: the Tiket detail handler evaluated immediately after `domcontentloaded`, before the dynamically rendered event header labels existed, then fell back to the broad search-card location.
- Actor version `1.2.0` now waits for the detail header, reads its price/full venue/display date, removes Tiket's appended region/country display suffix, and formats the draft summary as price + full venue + a blank line + Indonesian weekday/date. `tiket-utils.js` keeps those transformations deterministic and unit-testable.
- Full-address geocoding now tries a venue + final locality + country fallback before dropping the venue. For Indonesia Arena this resolves `-6.2148291, 106.8005215` instead of the Tanah Abang centroid.
- Tiket discovery now starts at the explicit `/en-id/` search URL, limits unproductive scrolling, records whether cards were actually observed, and throws when the page renders no cards so Crawlee retries rather than returning a false successful zero-row run.
- Deployed default-latest Actor build `1.2.2`; its successful one-row live dataset returned the exact requested LANY description, full Indonesia Arena address, 2026-10-29 dates, precise coordinates, and three images. The completion log reported one new Tiket item.
- Guarded production-data migration updated only the existing LANY draft whose old description and coordinates still matched the known Tanah Abang values; it now contains the verified summary/location/price and retains all three images.
- The two builds and two smoke runs used about USD 0.0596 of Apify usage. The first smoke exposed the list-page false-zero path; the second verified the hardened build.

## v2.6.0 release alignment (2026-07-30)
- v2.6.0 packages the July 28-30 Cloudflare production delivery, PWA/SEO hardening, protected server-side admin geocoding, and Gather Pins reliability work.
- Production `www.ayanaon.app` is served by Cloudflare Workers; retain Netlify's apex redirect and rollback deployment unchanged for the documented 7-14 day observation window.
- The Gather Actor now uses the `latest` build path with Tiket full-venue summaries, KalenderLari `/events/` discovery, and duplicate checks that also protect against matching manual pins.
- Release metadata must advance together: root package and lockfile version, README notes, project overview, and service-worker cache revision.

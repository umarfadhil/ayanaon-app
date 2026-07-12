# Project Overview

## What
- **AyaNaon** = community-driven map app ("What's happening?" in Sundanese)
- Users drop pins on a Google Maps interface to share events, promos, traffic, lost+found, etc.
- **Gerobak Online** = live vendor location broadcasting (mobile cart sellers)
- **Warga** = registered residents who verify vendors and save pins
- **Toko / UMKM (Merchants)** = AyaKasir POS tenant stores pushed via a partner API: logo map pins + SEO pages `/toko/:slug` with WhatsApp ordering & live availability
- PWA (installable, service worker, offline-capable)
- Live site: **ayanaon.app**
- Current version: **v2.5.2**

## Tech Stack
- **Frontend:** Vanilla HTML/CSS/JS (no framework/bundler)
- **Map:** Google Maps JavaScript API
- **Backend:** Single Express.js app wrapped with `serverless-http`
- **Hosting:** Netlify (static files + serverless functions)
- **Database:** MongoDB (database name: `ayanaon-db`)
- **Auth:** JWT + bcrypt (separate flows for sellers and residents)

## Key Features
- Pin CRUD with categories, photos (up to 3), voting, expiration
- Category filtering, keyword search, date-range filtering
- Gerobak Online: seller registration, live broadcasting, menu gallery, community verification
- Warga system: resident profiles, avatars, status, location sharing, saved pins
- Admin dashboard: manage pins, Gather Pins external scraper drafts, SEO, categories, tabs, brands, areas, mass promotions (flagged, location-gated, shared images), analytics
- Light/dark theme
- SEO: server-rendered pin and merchant pages, dynamic sitemap (merchant writes invalidate it; CDN freshness target 15 minutes), robots.txt

## Environment Variables
- `MONGODB_URI` - MongoDB connection string
- `GOOGLE_MAPS_API_KEY` - Google Maps API key
- `JWT_SECRET` - JWT signing secret (default: `ayanaon-dev-secret`)
- `MONGODB_DASHBOARD_PASSWORD` - embedded MongoDB Charts password
- `AYAKASIR_PARTNER_SECRET` - Bearer secret for the AyaKasir merchants push API (integration returns 503 when unset)
- `AYAKASIR_ORDER_URL_PREFIX` - allowed orderUrl prefix (default `https://ayakasir.petalytix.id/`)
- `APIFY_API_TOKEN` - server-side token used to start and inspect Gather Pins Actor runs
- `APIFY_GATHER_ACTOR_ID` - Apify Actor ID for the deployable `gather-actor/` package

## MongoDB Collections
- `pins` - map pins (events, promos, etc.). Mass promo pins have `massPromotion: true`, `massPromotionGroupId`, and may use `sharedImagesFromGroup` for shared images
- In mass promo groups, only one owner pin should store `images`; sibling pins should carry `sharedImagesFromGroup` plus `sharedImageCount`
- `sellers` - Gerobak Online vendor accounts
- `residents` - Warga (registered resident) accounts
- `unique_ips` - anonymous visitor tracking
- `settings` - app config (maintenance, features, tabs, categories, SEO)
- `analytics_events` - page views, pin views, referrers
- `brands` - brand directory with locations
- `areas` - Indonesian provinces and cities
- `merchants` - AyaKasir tenant stores (pushed from the AyaKasir portal; unique `slug` + `tenantId`; `status: active|hidden`; fields incl. `logoUrl`, `menuLayout` LIST/GRID/ACCORDION, `menuHighlights[]` full menu ≤100 with per-item `category`/`photoUrl`/`price`/`available`, `searchText` blob built at upsert; SSR page at `/toko/:slug` with WA-cart ordering + live availability polling; map layer in app.js with `?toko=<slug>` deep link + search integration)
- `gather_runs` - external Apify run records and import counters/status
- `gather_pin_drafts` - editable, authenticated pre-publication pin drafts with source provenance and completeness metadata

## User Roles
- `admin` - full access to admin dashboard
- `pin_manager` - can manage pins
- `resident` - regular Warga user

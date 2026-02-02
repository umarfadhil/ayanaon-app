# AyaNaon-app

AyaNaon-app is a community-driven map application designed to help you share and discover local information, promotions, and reports in your area. Think of it as a digital bulletin board powered by your community.

- **Link:** ayanaon.app

## Table of Contents
- [What is AyaNaon-app?](#what-is-ayanaon-app)
- [Key Features](#key-features)
- [How It Works (Under the Hood)](#how-it-works-under-the-hood)
- [Getting Started](#getting-started)
- [PWA Install & Updates](#pwa-install--updates)
- [Gerobak Online Workflow](#gerobak-online-workflow)
- [Contributing](#contributing)
- [Contact](#contact)
- [Release Notes](#release-notes)

## What is AyaNaon-app?

AyaNaon-app (which roughly translates to "What's up?" or "What's happening?" in Sundanese) is a platform where users can drop "pins" on a map to highlight events, deals, traffic updates, lost and found items, and more. It's built to foster local engagement and keep everyone informed about what's happening around them.

## Key Features

### Map & Discovery
- **Interactive Map:** Explore your local area with an intuitive Google Maps interface.
- **Category Filtering:** Quickly find what you're looking for by filtering pins based on different categories like "Events," "Food & Drink Promos," "Traffic & Accidents," and more.
- **Location Services:** Find your current location on the map with a single click.
- **Real-time Updates:** See the number of active pins and unique contributors in real-time.
- **Responsive Design:** Enjoy a seamless experience whether you're on your desktop or mobile phone.

### Contribution & Community
- **Pin Dropping:** Easily add new pins to the map with a title, detailed description, category, and an optional external link. You can even set an expiration time for your pins.
- **Community Engagement:** Upvote or downvote pins to show your support or disagreement.
- **Pin Management:** Reporters can edit their own pins, ensuring information stays accurate.

### Gerobak Online
- **Gerobak Online Mode:** Vendors can broadcast a live location, showcase a full profile with optional WhatsApp contact, collect "Verified by Warga" badges from customer votes, and manage their storefront directly on the map (edit details, control phone privacy, upload a menu gallery).

## How It Works (Under the Hood)

AyaNaon-app is a modern web application built with:

- **Frontend:** HTML, CSS, and JavaScript, utilizing the Google Maps JavaScript API for the interactive map.
- **Backend:** Powered by Netlify Functions (serverless functions) using Node.js and Express.js.
- **Database:** MongoDB for storing all pin data, user IP addresses (anonymously), and other application information.

## Getting Started

Follow these steps to get AyaNaon-app up and running:

### 1. Clone the repository
```bash
git clone https://github.com/umarfadhil/ayanaon-app.git
cd ayanaon-app
```

### 2. Set up your environment variables
You'll need a `.env` file in your project root with:
- `MONGODB_URI`: Your MongoDB connection string.
- `GOOGLE_MAPS_API_KEY`: Your Google Maps JavaScript API key.

### 3. Install dependencies
```bash
npm install
```

### 4. Deploy to Netlify
This app is designed for easy deployment on Netlify. Connect your GitHub repository to Netlify, and it will automatically build and deploy your functions and frontend.

## PWA Install & Updates

- **Install App:** Open the top-right Menu and, in the first tab, tap **Install App** when the browser surfaces the install prompt.
- **Update Available:** When a new version is ready, an **Update Tersedia** button appears in the same tab. Tap it to refresh immediately (it triggers the waiting service worker to activate, then reloads).
- **Manual Refresh:** If the update button is hidden but you suspect a newer build exists, refresh the page to pick up the latest assets.

## Gerobak Online Workflow

| Step | Details |
| --- | --- |
| 1. **Register** | Visit `register.html`, fill out stall details, upload a main cart photo (max 1 MB), and optionally add up to three menu photos before accepting the broadcast terms. |
| 2. **Go Live** | Sign in through `login.html`, enable Gerobak Online from the map panel when you are ready to broadcast, and watch the live cart counter update in real time. |
| 3. **Manage Profile** | Update the name, brand, description, hero photo, menu gallery, and phone visibility directly from the map interface. |
| 4. **Earn Community Trust** | Happy customers can vote through the marker popup to award the "Verified by Warga" badge. |

Active Gerobak Online carts appear as dedicated markers with full profiles, optional menu galleries, and a WhatsApp link (when enabled) so residents can reach vendors instantly.

## Contributing

We welcome contributions! If you have ideas for new features, bug fixes, or improvements, feel free to open an issue or submit a pull request.

## Contact

For any inquiries or feedback, please reach out to `contact@petalytix.id`.

## Release Notes

Release updates are listed from the most recent version to the earliest.

### What's New in v2.4.13
- **Province-Level Category Cards:** Category cards on `/kategori` now display province-level areas instead of city-level for broader regional grouping.
- **Server-Side Pin Search & Pagination:** The "Cari pin" section on both `/kategori` and `/kategori/<category>` pages now queries all active pins via a server-side API with paginated results (10 per page), replacing the previous client-side filtering of 200 pins.
- **Province & City Filter Dropdowns:** Region filtering upgraded from a single dropdown to cascading province and city selects, with city options populated dynamically based on the selected province.
- **Date Range Filter:** Renamed "Range tanggal" to "Select date" with start/end date inputs for filtering pins by date range overlap.
- **Reset Filter Button:** Added a themed reset button next to the date filter to clear all search, region, and date inputs in one click.
- **Geolocation Sorting:** When browser location is available, pin results are sorted by proximity to the user's position.
- **Pin Detail Province Field:** Pin detail pages (`/pin/<id>`) now display the province alongside the city in the metadata section.
- **Pin Detail Action Buttons:** Redesigned action buttons with a prominent "Temukan lebih banyak di Ayanaon" CTA, plus compact "Arahkan" (Google Maps) and "Website" buttons side by side.

### What's New in v2.4.12
- **Manage Areas:** New admin tab with a full directory of Indonesian provinces and cities in both Bahasa Indonesia and English, with seed data for all 38 provinces, plus add/edit/delete support for provinces, cities, and aliases.
- **Auto-Translate Province/City:** Brand search results now automatically translate English province and city names (e.g., "West Java", "Bandung City") to Indonesian equivalents ("Jawa Barat", "Kota Bandung") using the areas directory, both client-side and server-side.
- **Brand Details Accordion Persistence:** Removing a location from a brand in the Brand Details sub-tab no longer collapses the card, so admins can continue removing locations without re-expanding.
- **Mobile Responsive Fixes:** Brand search section and selected location names now display correctly on mobile browsers without overflowing the screen.

### What's New in v2.4.11
- **Mass Promotions from Brands:** The Mass Promotions tab now supports selecting locations from stored brands in addition to Google Places search, with sub-tab switching between "Search Places" and "From Brands" for faster bulk pin creation.
- **Manage Brands:** Admins can search Google Places to build a brand directory, assign locations with auto-detected province/city, view brands organized by region in an accordion layout, and rename, delete, or remove individual locations.

### What's New in v2.4.10
- **Manage Categories:** Admins can add, rename, reorder, and remove pin categories with emoji previews, plus role-based availability (Admin/Pin Manager/Warga).
- **Category Sync Everywhere:** Category updates now sync to the main page (search + add pin) and the `/kategori` landing pages automatically.
- **More Reliable Pin Sharing:** Add-pin submission now guards against early map loads and surfaces clearer errors when something goes wrong.

### What's New in v2.4.9
- **Mass Promotions Tab:** Admins can search places with Google Places, review results on a mini map, select multiple locations, and add pins in bulk with shared details (title, description, category, links, dates, and photos).
- **Admin Category Sync:** Manage Pins category input now uses a dropdown of existing categories to keep edits consistent.
- **Tab Management:** New Manage Tabs panel lets admins reorder tabs, set role-based visibility (Admin/Pin Manager/Warga), and save the configuration for all users.
- **Mobile Admin Navigation:** Admin tabs row now scrolls horizontally on small screens.

### What's New in v2.4.8
- **Logo Refresh:** Favicon, PWA icons, and social preview image now point to the v2 logo assets for search and sharing updates.

### What's New in v2.4.7
- **Share Button Added:** Pin list and map popups now include a share action for quick link sharing.
- **Improved Button Links:** Cross-page CTAs now point to the most relevant destinations for a smoother flow.
- **Category Filters:** `/kategori` landing pages now include search, region, and date-range filters.

### What's New in v2.4.6
- **Category + Region Landing Pages:** Added server-rendered `/kategori` index and category/region pages with pin lists for better crawl visibility.
- **Sitemap Expansion:** Category and region landing URLs are now included in the sitemap.
- **City Backfill Support:** New pins resolve city with a reverse-geocode fallback, plus an admin endpoint to backfill older pins.

### What's New in v2.4.5
- **Pin Detail Links Strengthened:** Pin list titles and map popups now include direct anchor links to `/pin/<id>` pages for better crawl discovery.
- **Canonical Host Alignment:** SEO base URLs prefer the request host when it avoids `www`/HTTP redirects, reducing "Page with redirect" indexing issues.

### What's New in v2.4.4
- **Internal Linking Boost:** Added "View detail" links in the pin list and map popups that point to `/pin/<id>` pages.
- **PWA Cache Bump:** Service worker cache version updated to deliver the latest assets.

### What's New in v2.4.3
- **Static Sitemap & Robots:** Added `public/sitemap.xml` and `public/robots.txt` for reliable crawl discovery.
- **SEO Defaults Synced:** Homepage meta tags and SEO defaults now align with the configured marketing copy.
- **Sitemap Routing Simplified:** Removed dynamic sitemap redirects to avoid Netlify 404s.

### What's New in v2.4.2
- **Sitemap & Robots Routing:** Added Netlify publish-folder redirects so `/sitemap.xml` and `/robots.txt` resolve reliably.
- **SEO URL Normalization:** Site URL values now auto-prefix `https://` when missing, keeping sitemap and canonical links valid.
- **SEO Preview Sync:** Admin SEO preview reflects the normalized base URL for consistent output.

### What's New in v2.4.1
- **Home Navigation Reset:** Home button now clears filters and recenters to your location (or Jakarta if location is off).
- **Image Loading Improvement:** Pin popup images load reliably on first open, including from list interactions.
- **Manage Web-app SEO:** Admin dashboard adds a Manage SEO tab with editable meta settings plus sitemap/robots support.

### What's New in v2.4.0
- **Navigation Improvements:** Bottom navigation adds Home, Search, List, and Saved modes with clearer panel behavior.
- **Save Pins Feature:** Save pins from the list or map popups and see them in a dedicated Saved view, synced to Warga profiles.
- **Theme Feature:** Light/Dark theme toggle with map styling and persisted preference.
- **Performance Improvements:** Debounced search, cached search text for faster filtering, and in-flight guards to avoid duplicate requests.
- **Pin List Filters Refresh:** Category/date popovers with select-all/clear-all and a date-range picker to refine results faster.
- **Pin Location Search:** Search for addresses while choosing a pin location before confirming the marker.
- **PWA Cache Update:** Service worker cache bumped to v2.4.0 for fresh assets on deploy.

### What's New in v2.3.2
- **Admin Pin Filters:** Added category dropdown plus Link/Date/Photo radio filters with a cleaner layout and search button for quicker curation.
- **Category Sync:** Admin category filter now auto-populates from existing pin categories so options stay accurate without manual edits.
- **Metrics Defaults:** Business Metrics tab now opens on per-day view with the current month and year preselected for faster checks.

### What's New in v2.3.1
- **Maintenance Mode:** Admins can toggle website maintenance from the dashboard with a custom visitor message; visitors see a banner and dimmed controls while active.
- **Live Notice Refresh:** The public site polls the maintenance status periodically so notices appear/clear without a full reload.
- **PWA Cache Bump:** Service worker cache version bumped to pull the new assets immediately after deploys.

### What's New in v2.3.0
- **Manage Pins:** Add Kelola Pin tab to manage pins (update information, add photos, relocate pin, remove, etc.) for admin.
- **Business Metrics:** Add Business Metrics tab to control the web-app performances and gain insights for future developments.
- **Dashboard Embed:** MongoDB Charts dashboard is embedded in the metrics view with secured password loading via backend.

### What's New in v2.2.10
- **Cleaner Pin Cards:** Pins without date info now skip the Mulai/Selesai meta cards so only relevant details show in the list.

### What's New in v2.2.9
- **Guided Pin Placement:** The “Tentukan Titik Lokasi” button now collapses the form and highlights the map with a floating search bar so users tap the map or search first, preventing accidental drops.
- **Explicit Confirmation:** After choosing a point, a pop-up anchored to the marker asks for confirmation (button now bottom-right and labeled “Konfirmasi”) before the form reappears with the chosen lat/lng.
- **Safer Defaults:** Map clicks only place temporary pins while in selection mode, reducing unintended locations.

### What's New in v2.2.8
- **Pin List Cards:** Rebuilt the pin list item layout into four compact cards (Kategori, Mulai, Selesai, Jarak) with N/A fallbacks and emoji-only category badges plus short labels beneath.
- **Cleaner Details:** Removed the inline date-range row, added a “Lihat lebih banyak...” toggle for descriptions, and auto-collapsed the list when opening a pin so the map popup takes focus.
- **Mobile Fit:** Widened the pin list panel and tightened card sizing so all four cards sit on one row without overlap across desktop and mobile.

### What's New in v2.2.7
- **Travel Modes:** Added a dedicated car button beside the walking toggle; both share matching active styling while car mode reveals fuel/EV stations and walking hides them.
- **PWA Icons Fixed:** Manifest now ships PNG icons (with SVG fallback) so desktop installs display the correct logo; cache and precache entries bumped to v2.2.7.
- **Head Cleanup:** Favicon/apple-touch links now point to the generated PNG icon for consistent branding across platforms.

### What's New in v2.2.6
- **Install App Placement:** The PWA install button now lives in the first Menu tab for easier access on mobile.
- **One-Tap Updates:** A new “Update Tersedia” button appears in that tab whenever a fresh version is waiting; tapping it activates the new service worker and reloads automatically.
- **Fresher Caches:** Service worker now honors `SKIP_WAITING` messages so users hop onto the latest build faster.

### What's New in v2.2.5
- **AyaNaon List Pin:** List of pins from the nearest location or search query to get better list of information about the pins
- **Unified Top Controls:** The AyaNaon pin toggle, Menu, Filter, and Add Pin buttons now close each other automatically so only one panel stays open at a time, reducing overlap on mobile.

### What's New in v2.2.4
- **Photo-Rich Pins:** Pins now accept up to three photos; uploads are compressed in the browser, previewed in-line, and existing images can be removed or restored before saving.
- **Immersive Gallery Experience:** Pin popups render image strips and open a full-screen viewer so residents can browse every attachment without leaving the map.
- **Smoother Pin Editing:** The share panel scrolls gracefully on small screens while the backend normalizes image payloads and lifetime expirations to keep pins tidy.

### What's New in v2.2.3
- **Optimized Pin Form Handling:** Cached frequently used DOM nodes so pin creation and editing reuse the same references instead of querying the document repeatedly.
- **Lean Auth Bundle:** Removed the unused verification initializer and redundant script include now that WhatsApp delivery is disabled, shrinking the Gerobak auth footprint without altering workflows.
- **UI Cleanup:** Eliminated duplicate DOM lookups in the live seller panel to keep the menu logic tidy.

### What's New in v2.2.2
- **Client-Side Image Optimization:** Logo and menu uploads are automatically resized and compressed in the browser before submission, keeping payloads small while preserving visual quality.

### What's New in v2.2.1
- **Tap-to-Zoom Menu Gallery:** Live Seller menu thumbnails now open a full-screen overlay when tapped, making it easier to inspect dishes without leaving the map view.

### What's New in v2.2.0
- **Resident Profile Enhancements:** Warga can now attach a profile photo during sign-up or via the new `PUT /api/residents/me` endpoint, and manage a 30-character status message that travels with their profile.
- **Unified Live Controls:** The Warga "Live" panel adopts the same layout and styling as Gerobak Online, including matching primary/secondary buttons, a live/offline badge, and a status input that sits alongside the share toggle.
- **Avatar-Only Map Markers:** Resident markers (including the current user while sharing location) are rendered as breathing circular avatars with optional photos and status bubbles, replacing the previous dot-style pin for a clearer map experience.
- **Backend Status Support:** Resident share payloads now include the saved status message so it persists between refreshes and appears consistently whenever a Warga is live.

### What's New in v2.1.2
- **Terms Improvement:** Warga Terdaftar become Warga Ayanaon and Badge become Rekomendasi. 
- **Incentives:** Gerobak Online can get up to 1 million rupiah by getting recommendations from Warga.

### What's New in v2.1.1
- **Reliable Live Toggle:** Initial heartbeats now wait for backend persistence, auto-retry when a session is warming up, and cancel cleanly on logout so going live/offline works the first time.
- **Cleaner Popups:** Seller descriptions in the live marker popup honor line breaks, improving readability for multi-line bios and menus.

### What's New in v2.1.0
- **Gerobak Online Profile Editor:** Vendors can update their name, brand, description, hero photo, and WhatsApp visibility right from the map; live markers refresh instantly with each change.
- **Menu Photo Gallery:** Registration and profile forms now accept up to three menu photos (max 4 MB each) and display them in an expandable gallery within the marker popup.
- **Live Cart Statistics:** The stats panel highlights the number of Gerobak Online carts currently live with animated updates, including a reminder when the WhatsApp number is hidden.
- **Large Upload-Ready Backend:** The JSON payload limit is raised to 20 MB, and the new `PUT /sellers/me` endpoint enforces photo/menu validation while sanitizing responses for seller privacy.

### What's New in v2.0.0
- **Unified Menu Controls:** The UI is now cleaner with a single collapsible top-right menu containing Statistics, the walking button, Fuel/EV toggle, "Gerobak Online," and the new "Warga Terdaftar" (Registered Resident) login/registration access.
- **Gerobak Online Launch:** Mobile cart vendors can now broadcast their real-time location, allowing residents to discover nearby sellers and their products instantly.
- **Warga Terdaftar (Registered Resident) System:** Residents can register to help legitimize "Gerobak Online" vendors by awarding a "Verified by Warga" badge, building a trusted community marketplace.
- **Guaranteed Freshness:** The service worker is updated to ensure all users receive the latest app features and assets immediately.

### What's New in v1.7.1
- **Default quick-hide:** The 🚶 button now starts enabled, keeping the map clutter-free until users opt into fuel or EV stations.
- **Toggle improvements:** Fuel/EV switch stays disabled until stations are available; clicking it automatically reveals stations when possible.
- **UI separation:** Fuel/EV toggle and walking button have distinct positions with cohesive styling.

### What's New in v1.7.0
- **Fuel vs EV toggle:** Added a dedicated switch so users can focus on `⛽ SPBU/SPBG` or `⚡ SPKLU` locations with a single tap.
- **Location-aware filtering:** Fuel/EV pins only display when location access is granted and the station is within 30km of the user.
- **Marker clustering:** Integrated Google MarkerClusterer with a zoom threshold so high-density areas stay responsive while still supporting full-text search.
- **Map polish:** Toggle styling aligned with map controls, fullscreen shortcut removed, and service worker cache bumped to deliver the latest assets reliably.
- **Quick hide option:** Added a 🚶 button to temporarily hide both fuel and EV stations with one tap.

### What's New in v1.6.2
- **Category refresh:** Replaced the old traffic/weather categories with `🏡 Akomodasi Pilihan` and `⚡ SPKLU`, including updated icons.
- **Curated submissions:** Restricted categories remain visible in filters and existing pins but are omitted from the public submission form.
- **Docs & build:** Version bump and cache version update to deliver the latest assets.

### What's New in v1.6.1
- **User Marker Improvement:** Pulsing user location marker for clearer presence without distraction.
- **Push update to users device:** Service worker cache bump to ensure updated assets load.

### What's New in v1.6.0
- **Date range for events:** Users can now select either a single date or a start-end range when creating or editing a pin.
- **Info-window display:** Single dates render normally; ranges show as "Start - End"; "Hari ini" still supported.
- **Filtering respects ranges:** Pins appear if their date range overlaps the filter range.
- **Expiration handling:** Pins with ranges expire at the end of the last day selected.
- **PWA polish:** Dark theme color refined in HTML, manifest set to light for smoother splash; service worker updated to stale-while-revalidate with a bumped cache version to reduce stale assets.

### What's New in v1.5.0
- **Performance Tune-Up:** Marker refreshes clean up old overlays, cached search text speeds up filtering, and periodic pin reloads now trigger only when counts change.
- **Metric Enhancements:** Visitor and active-pin counters refresh every three minutes and animate when values change.
- **Mobile UX:** Disabled accidental page zooming, streamlined geolocation watching, and added a PWA install button with native prompt support.
- **PWA Readiness:** Added a web app manifest, service worker with precaching, and install logging so Chrome on Android surfaces the Install App prompt.

### What's New in v1.4.0
- **Smarter Search:** Multi-term queries now match across titles, descriptions, categories, and links with accent-insensitive token matching (e.g., `"Marathon 5K"`).
- **Reset Recenter Logic:** Resetting filters recenters the map on your detected location and falls back to Jakarta when location access is unavailable.
- **Navigation Polishing:** Navigation deep links now properly fall back without lingering timers, keeping the bottom-sheet experience snappy.

### What's New in v1.3.0
- **Smart Filter Search:** Added keyword, single-date, and date-range filters inside the map drawer for faster pin discovery.
- **Navigation Shortcuts:** Introduced the Get Me Here button with an app selector that surfaces Google Maps, Apple Maps, Waze, or the browser based on your device.
- **Streamlined Pin Actions:** Reworked the info-window layout so voting and navigation controls sit together, with edit actions highlighted above when available.
- **Mobile-Friendly Controls:** Refined floating buttons (including the reset icon) to stay legible and consistent across devices.

### What's New in v1.2.0
- **Traffic Information:** Integrated a real-time traffic layer onto the map for improved navigation.
- **Performance Optimization:** Implemented best practices for Google Maps API loading, resolving console warnings and enhancing application performance.
- **Enhanced Welcome Message:** Added a ⓘ to the welcome pop-up for a more engaging user experience.
- **Improved Info Window Display:** Adjusted the spacing between marker icons and pop-up descriptions for better visual clarity.
- **Interactive Markers:** Enabled toggling of info window visibility by clicking the marker icon, allowing users to open and close pop-ups with a single click.

### What's New in v1.1.0
- **Custom Map Views:** Added buttons to easily switch between Map/Terrain and Satellite/Hybrid views.
- **Improved Mobile Navigation:** Map panning on mobile devices now only requires one finger.
- **Cleaner UI:** Simplified the default map controls for a less cluttered interface.
- **Smarter Refresh:** The map's live pin refresh now pauses when a category filter is active, preventing filter disruption.

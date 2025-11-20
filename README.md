# AyaNaon-app

AyaNaon-app is a community-driven map application designed to help you share and discover local information, promotions, and reports in your area. Think of it as a digital bulletin board powered by your community.

- **Link:** ayanaon.app

## Table of Contents
- [What is AyaNaon-app?](#what-is-ayanaon-app)
- [Key Features](#key-features)
- [How It Works (Under the Hood)](#how-it-works-under-the-hood)
- [Getting Started](#getting-started)
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

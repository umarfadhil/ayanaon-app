# AyaNaon-app

Welcome to AyaNaon-app! This is a community-driven map application designed to help you share and discover local information, promotions, and reports within your area. Think of it as a digital bulletin board powered by your community!

LINK: ayanaon.app

## What is AyaNaon-app?

AyaNaon-app (which roughly translates to "What's up?" or "What's happening?" in Sundanese) is a platform where users can drop "pins" on a map to highlight various events, deals, traffic updates, lost and found items, and more. It's built to foster local engagement and keep everyone informed about what's happening around them.

## Key Features

*   **Interactive Map:** Explore your local area with an intuitive Google Maps interface.
*   **Pin Dropping:** Easily add new pins to the map with a title, detailed description, category, and an optional external link. You can even set an expiration time for your pins!
*   **Category Filtering:** Quickly find what you're looking for by filtering pins based on different categories like "Events," "Food & Drink Promos," "Traffic & Accidents," and more.
*   **Community Engagement:** Upvote or downvote pins to show your support or disagreement.
*   **Location Services:** Find your current location on the map with a single click.
*   **Pin Management:** Reporters can edit their own pins, ensuring information stays accurate.
*   **Real-time Updates:** See the number of active pins and unique contributors in real-time.
*   **Responsive Design:** Enjoy a seamless experience whether you're on your desktop or mobile phone.
*   **Gerobak Online Mode:** Vendors can broadcast a live location, showcase a full profile with optional WhatsApp contact, collect "Verified by Warga" badges from customer votes, and manage their storefront directly on the map (edit details, control phone privacy, upload a menu gallery).

## How It Works (Under the Hood)

AyaNaon-app is a modern web application built with:

*   **Frontend:** HTML, CSS, and JavaScript, utilizing the Google Maps JavaScript API for the interactive map.
*   **Backend:** Powered by Netlify Functions (serverless functions) using Node.js and Express.js.
*   **Database:** MongoDB for storing all pin data, user IP addresses (anonymously), and other application information.

## Getting Started

To get the app up and running, you'll need to:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/umarfadhil/ayanaon-app.git
    cd ayanaon-app
    ```
2.  **Set up your environment variables:**
    You'll need a `.env` file in your project root with:
    *   `MONGODB_URI`: Your MongoDB connection string.
    *   `GOOGLE_MAPS_API_KEY`: Your Google Maps JavaScript API key.
    *   `JWT_SECRET`: Secret used to sign seller login tokens.
    *   `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` *(optional)*: Required to deliver WhatsApp verification codes via Twilio's API. When omitted, codes are surfaced in the API response for local testing.
3.  **Install dependencies:**
    ```bash
    npm install
    ```
4.  **Deploy to Netlify:** This app is designed for easy deployment on Netlify. Connect your GitHub repository to Netlify, and it will automatically build and deploy your functions and frontend.

## Gerobak Online Workflow

1. **Register:** Visit `register.html`, fill out stall details, upload a main cart photo (max 1 MB), and optionally add up to three menu photos before accepting the broadcast terms.
2. **Verify WhatsApp:** A 6-digit code is sent to the registered WhatsApp number (via Twilio when credentials are available). In development environments without Twilio, the code also appears in the API response.
3. **Go Live:** Sign in through `login.html`, enable Gerobak Online from the map panel when you are ready to broadcast, and watch the live cart counter update in real time.
4. **Manage Profile:** Update the name, brand, description, hero photo, menu gallery, and phone visibility directly from the map interface.
5. **Earn Community Trust:** Happy customers can vote through the marker popup to award the "Verified by Warga" badge.

Active Gerobak Online carts appear as dedicated markers with full profiles, optional menu galleries, and a WhatsApp link (when enabled) so residents can reach vendors instantly.

## Contributing

We welcome contributions! If you have ideas for new features, bug fixes, or improvements, feel free to open an issue or submit a pull request.

## Contact

For any inquiries or feedback, please reach out to `contact@petalytix.id`.

---

## What's New in v1.1.0

*   **Custom Map Views:** Added buttons to easily switch between Map/Terrain and Satellite/Hybrid views.
*   **Improved Mobile Navigation:** Map panning on mobile devices now only requires one finger.
*   **Cleaner UI:** Simplified the default map controls for a less cluttered interface.
*   **Smarter Refresh:** The map's live pin refresh now pauses when a category filter is active, preventing filter disruption.

---

## What's New in v1.2.0

*   **Traffic Information:** Integrated a real-time traffic layer onto the map for improved navigation.
*   **Performance Optimization:** Implemented best practices for Google Maps API loading, resolving console warnings and enhancing application performance.
*   **Enhanced Welcome Message:** Added a Ã°Å¸â€œÂ emoji to the welcome pop-up for a more engaging user experience.
*   **Improved Info Window Display:** Adjusted the spacing between marker icons and pop-up descriptions for better visual clarity.
*   **Interactive Markers:** Enabled toggling of info window visibility by clicking the marker icon, allowing users to open and close pop-ups with a single click.
---

## What's New in v1.3.0

*   **Smart Filter Search:** Added keyword, single-date, and date-range filters inside the map drawer for faster pin discovery.
*   **Navigation Shortcuts:** Introduced the Ã¢â‚¬Å“Get Me HereÃ¢â‚¬Â button with an app selector that surfaces Google Maps, Apple Maps, Waze, or the browser based on your device.
*   **Streamlined Pin Actions:** Reworked the info-window layout so voting and navigation controls sit together, with edit actions highlighted above when available.
*   **Mobile-Friendly Controls:** Refined floating buttons (including the reset icon) to stay legible and consistent across devices.
---

## What's New in v1.4.0

*   **Smarter Search:** Multi-term queries now match across titles, descriptions, categories, and links with accent-insensitive token matching (e.g., `"Marathon 5K"`).
*   **Reset Recenter Logic:** Resetting filters recenters the map on your detected location and falls back to Jakarta when location access is unavailable.
*   **Navigation Polishing:** Navigation deep links now properly fall back without lingering timers, keeping the bottom-sheet experience snappy.

---

## What's New in v1.5.0

*   **Performance Tune-Up:** Marker refreshes clean up old overlays, cached search text speeds up filtering, and periodic pin reloads now trigger only when counts change.
*   **Metric Enhancements:** Visitor and active-pin counters refresh every three minutes and animate when values change.
*   **Mobile UX:** Disabled accidental page zooming, streamlined geolocation watching, and added a PWA install button with native prompt support.
*   **PWA Readiness:** Added a web app manifest, service worker with precaching, and install logging so Chrome on Android surfaces the Install App prompt.

---

## What's New in v1.6.0

- **Date range for events**: Users can now select either a single date or a startâ€“end range when creating or editing a pin.
- **Info-window display**: Single dates render normally; ranges show as "Start - End"; "Hari ini" still supported.
- **Filtering respects ranges**: Pins appear if their date range overlaps the filter range.
- **Expiration handling**: Pins with ranges expire at the end of the last day selected.
- **PWA polish**: Dark theme color refined in HTML, manifest set to light for smoother splash; service worker updated to stale-while-revalidate with a bumped cache version to reduce stale assets.

---

## What's New in v1.6.1

- **User Marker Improvement**: Pulsing user location marker for clearer presence without distraction.
- **Push update to users device**: Service worker cache bump to ensure updated assets load.

---

## What's New in v1.6.2

- **Category refresh**: Replaced the old traffic/weather categories with `ðŸ¡ Akomodasi Pilihan` and `âš¡ SPKLU`, including updated icons.
- **Curated submissions**: Restricted categories remain visible in filters and existing pins but are omitted from the public submission form.
- **Docs & build**: Version bump and cache version update to deliver the latest assets.

---

## What's New in v1.7.0

- **Fuel vs EV toggle**: Added a dedicated switch so users can focus on `â›½ SPBU/SPBG` or `âš¡ SPKLU` locations with a single tap.
- **Location-aware filtering**: Fuel/EV pins only display when location access is granted and the station is within 30â€¯km of the user.
- **Marker clustering**: Integrated Google MarkerClusterer with a zoom threshold so high-density areas stay responsive while still supporting full-text search.
- **Map polish**: Toggle styling aligned with map controls, fullscreen shortcut removed, and service worker cache bumped to deliver the latest assets reliably.
- **Quick hide option**: Added a ðŸš¶ button to temporarily hide both fuel and EV stations with one tap.


---

## What's New in v1.7.1

- **Default quick-hide**: The 🚶 button now starts enabled, keeping the map clutter-free until users opt into fuel or EV stations.
- **Toggle improvements**: Fuel/EV switch stays disabled until stations are available; clicking it automatically reveals stations when possible.
- **UI separation**: Fuel/EV toggle and walking button have distinct positions with cohesive styling.

---

## What's New in v2.0.0

- **Unified Menu Controls**: The UI is now cleaner with a single collapsible top-right menu containing Statistics, the walking button, Fuel/EV toggle, "Gerobak Online," and the new "Warga Terdaftar" (Registered Resident) login/registration access.
- **Gerobak Online Launch**: Mobile cart vendors can now broadcast their real-time location, allowing residents to discover nearby sellers and their products instantly.
- **Warga Terdaftar (Registered Resident) System**: Residents can register to help legitimize "Gerobak Online" vendors by awarding a "Verified by Warga" badge, building a trusted community marketplace.
- **Guaranteed Freshness**: The service worker is updated to ensure all users receive the latest app features and assets immediately.

---

## What's New in v2.1.0

- **Gerobak Online Profile Editor**: Vendors can update their name, brand, description, hero photo, and WhatsApp visibility right from the map; live markers refresh instantly with each change.
- **Menu Photo Gallery**: Registration and profile forms now accept up to three menu photos (max 4 MB each) and display them in an expandable gallery within the marker popup.
- **Live Cart Statistics**: The stats panel highlights the number of Gerobak Online carts currently live with animated updates, including a reminder when the WhatsApp number is hidden.
- **Large Upload-Ready Backend**: The JSON payload limit is raised to 20 MB, and the new `PUT /sellers/me` endpoint enforces photo/menu validation while sanitizing responses for seller privacy.

---

## What's New in v2.1.1

- **Reliable Live Toggle**: Initial heartbeats now wait for backend persistence, auto-retry when a session is warming up, and cancel cleanly on logout so going live/offline works the first time.
- **Cleaner Popups**: Seller descriptions in the live marker popup honor line breaks, improving readability for multi-line bios and menus.

---

## What's New in v2.1.2

- **Terms Improvement**: Warga Terdaftar become Warga Ayanaon and Badge become Rekomendasi. 
- **Incentives**: Gerobak Online can get up to 1 million rupiah by getting recommendations from Warga.



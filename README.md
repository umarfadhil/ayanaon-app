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
3.  **Install dependencies:**
    ```bash
    npm install
    ```
4.  **Deploy to Netlify:** This app is designed for easy deployment on Netlify. Connect your GitHub repository to Netlify, and it will automatically build and deploy your functions and frontend.

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
*   **Enhanced Welcome Message:** Added a ðŸ“ emoji to the welcome pop-up for a more engaging user experience.
*   **Improved Info Window Display:** Adjusted the spacing between marker icons and pop-up descriptions for better visual clarity.
*   **Interactive Markers:** Enabled toggling of info window visibility by clicking the marker icon, allowing users to open and close pop-ups with a single click.
---

## What's New in v1.3.0

*   **Smart Filter Search:** Added keyword, single-date, and date-range filters inside the map drawer for faster pin discovery.
*   **Navigation Shortcuts:** Introduced the â€œGet Me Hereâ€ button with an app selector that surfaces Google Maps, Apple Maps, Waze, or the browser based on your device.
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

- **Date range for events**: Users can now select either a single date or a start–end range when creating or editing a pin.
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

- **Category refresh**: Replaced the old traffic/weather categories with `🏡 Akomodasi Pilihan` and `⚡ SPKLU`, including updated icons.
- **Curated submissions**: Restricted categories remain visible in filters and existing pins but are omitted from the public submission form.
- **Docs & build**: Version bump and cache version update to deliver the latest assets.

---

## What's New in v1.7.0

- **Fuel vs EV toggle**: Added a dedicated switch so users can focus on `⛽ SPBU/SPBG` or `⚡ SPKLU` locations with a single tap.
- **Location-aware filtering**: Fuel/EV pins only display when location access is granted and the station is within 30 km of the user.
- **Marker clustering**: Integrated Google MarkerClusterer with a zoom threshold so high-density areas stay responsive while still supporting full-text search.
- **Map polish**: Toggle styling aligned with map controls, fullscreen shortcut removed, and service worker cache bumped to deliver the latest assets reliably.

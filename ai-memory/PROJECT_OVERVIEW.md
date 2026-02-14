# Project Overview

## What
- **AyaNaon** = community-driven map app ("What's happening?" in Sundanese)
- Users drop pins on a Google Maps interface to share events, promos, traffic, lost+found, etc.
- **Gerobak Online** = live vendor location broadcasting (mobile cart sellers)
- **Warga** = registered residents who verify vendors and save pins
- PWA (installable, service worker, offline-capable)
- Live site: **ayanaon.app**
- Current version: **v2.4.14**

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
- Admin dashboard: manage pins, SEO, categories, tabs, brands, areas, mass promotions, analytics
- Light/dark theme
- SEO: server-rendered pin detail pages, sitemap, robots.txt

## Environment Variables
- `MONGODB_URI` - MongoDB connection string
- `GOOGLE_MAPS_API_KEY` - Google Maps API key
- `JWT_SECRET` - JWT signing secret (default: `ayanaon-dev-secret`)
- `MONGODB_DASHBOARD_PASSWORD` - embedded MongoDB Charts password

## MongoDB Collections
- `pins` - map pins (events, promos, etc.)
- `sellers` - Gerobak Online vendor accounts
- `residents` - Warga (registered resident) accounts
- `unique_ips` - anonymous visitor tracking
- `settings` - app config (maintenance, features, tabs, categories, SEO)
- `analytics_events` - page views, pin views, referrers
- `brands` - brand directory with locations
- `areas` - Indonesian provinces and cities

## User Roles
- `admin` - full access to admin dashboard
- `pin_manager` - can manage pins
- `resident` - regular Warga user

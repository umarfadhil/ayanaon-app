# File Map

## Root
- `package.json` - deps: express, mongodb, serverless-http, bcryptjs, jsonwebtoken, axios, ws
- `netlify.toml` - build config: functions from `netlify/functions/`, publish from `public/`
- `.gitignore` - ignores: node_modules, .env, .netlify

## Backend (single file)
- `netlify/functions/api.js` - **THE ENTIRE BACKEND** (~6800+ lines)
  - Express router mounted at `/api/*` via Netlify redirect
  - MongoDB connection + index setup
  - All REST endpoints (see API Routes below)
  - Server-rendered HTML for `/pin/:id`, sitemap, robots.txt

## Frontend (`public/`)

### Main App
- `index.html` - main page (map, pin list, forms, modals)
- `app.js` - all map/pin/UI logic (large monolith)
- `style.css` - all main styles

### Admin
- `admin.html` - admin dashboard page
- `admin.js` - admin logic (manage pins, SEO, categories, brands, areas, mass promos, analytics)
- `admin.css` - admin styles

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
- `GET /pins` - list active pins
- `GET /pins/count` - active pin count
- `GET /pins/search` - server-side search with pagination
- `GET /pins/:id` - single pin
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
- `GET /admin/residents` | `PUT /:id/role` | `DELETE /:id`
- `POST /admin/pins/backfill-city` | `backfill-provinces`
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

### SEO (server-rendered)
- `GET /seo/sitemap` | `robots`
- `GET /pin/:id` - server-rendered pin detail page

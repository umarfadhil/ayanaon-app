# Code Rules & Conventions

## Architecture
- **No build step** - vanilla HTML/CSS/JS served directly from `public/`
- **No frontend framework** - DOM manipulation with `document.getElementById` etc.
- **Monolith backend** - everything in one `api.js` file with Express router
- **Monolith frontend** - `app.js` is one large file with global variables
- **Serverless** - runs as Netlify Functions via `serverless-http`

## Language & Naming
- UI text is in **Bahasa Indonesia** (Indonesian)
- Code comments and variable names are in **English**
- Error messages from API are in **Bahasa Indonesia**
- Collection/field names are in English

## Backend Patterns
- `connectToDatabase()` - singleton MongoDB connection, called on cold start
- Collection helpers: `getSellersCollection()`, `getResidentsCollection()`, `getSettingsCollection()`
- Auth: JWT tokens verified inline per route (no middleware), `req.headers.authorization` Bearer token
- Settings stored in `settings` collection with `{ key: string, value: any }` pattern
- Photos stored as base64 data URIs in MongoDB documents directly
- Mass promo pins share images via `sharedImagesFromGroup` referencing `massPromotionGroupId` — only the first pin in a group stores actual image data; resolved at read time by `resolveSharedImages()`
- IP address used for anonymous voting and visitor tracking (`x-nf-client-connection-ip` header)

## Frontend Patterns
- Global variables at top of `app.js` for all state
- Google Maps loaded via script tag with callback
- DOM elements cached in global variables, looked up in `initializeApp()` or similar
- Event listeners attached imperatively
- API calls via `fetch()` to `/api/...`
- Resident session: JWT stored in `localStorage` as `warga_token`
- Seller session: JWT stored in `localStorage` as `seller_token`
- Theme preference: `localStorage` key `ayanaon_theme`

## Deployment
- `npm run dev` = `netlify dev` (local development)
- Deploy by pushing to GitHub; Netlify auto-builds
- No test suite (`npm test` exits with error)
- Service worker cache version must be bumped on each release

## Constraints
- JSON payload limit: 20 MB (for photo uploads)
- Main photo max: 1 MB, menu photo max: 4 MB, up to 3 menu photos
- Resident photo max: 1 MB
- Pin images: up to 3 photos
- Roles: `admin`, `pin_manager`, `resident`

## Release Process
- Version in `package.json`
- Update release notes in `README.md`
- Bump service worker cache version in `public/service-worker.js`
- Commit message format: `chore: release vX.Y.Z`

## Memory Maintenance
- After finishing a task, append durable knowledge to `/ai-memory/SESSION_LEARNINGS.md`
- Never rewrite or refactor memory files

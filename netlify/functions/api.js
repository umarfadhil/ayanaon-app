const express = require('express');
const bodyParser = require('body-parser');
const serverless = require('serverless-http');
const { MongoClient, ObjectId } = require('mongodb');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const router = express.Router();

app.use(bodyParser.json({ limit: '20mb' }));

const {
    MONGODB_URI,
    GOOGLE_MAPS_API_KEY,
    JWT_SECRET = 'ayanaon-dev-secret',
    DASHBOARD_PASSWORD = process.env.MONGODB_DASHBOARD_PASSWORD || ''
} = process.env;

// Establish the database connection outside of the handler
const client = new MongoClient(MONGODB_URI);
let db;
let indexesEnsured = false;

async function connectToDatabase() {
    if (db) return db;
    try {
        await client.connect();
        db = client.db('ayanaon-db');
        await ensureIndexes(db);
        return db;
    } catch (error) {
        console.error("Failed to connect to the database", error);
        throw new Error("Failed to connect to the database");
    }
}

// Immediately connect to the database when the function is initialized
connectToDatabase();

function isTruthy(value) {
    if (value === undefined || value === null) return false;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function computeImageCount(doc) {
    if (!doc || !Array.isArray(doc.images)) return 0;
    return doc.images.length;
}

async function ensureIndexes(database) {
    if (indexesEnsured || !database) return;
    try {
        await database.collection('sellers').createIndex({ usernameLower: 1 }, { unique: true });
        await database.collection('sellers').createIndex({ 'liveStatus.isLive': 1, 'liveStatus.lastPingAt': 1 });
        await database.collection('sellers').createIndex({ 'communityVerification.voterIps': 1 });
        await database.collection('residents').createIndex({ usernameLower: 1 }, { unique: true });
        await database.collection('analytics_events').createIndex({ createdAt: 1, eventType: 1 });
        await database.collection('analytics_events').createIndex({ pinId: 1 });
        await database.collection('analytics_events').createIndex({ referrer: 1 });
        await database.collection('analytics_events').createIndex({ lat: 1, lng: 1 });
        indexesEnsured = true;
    } catch (error) {
        console.error('Failed to ensure indexes', error);
    }
}

async function recordIpAddress(ip) {
    if (!ip) return;
    const db = await connectToDatabase();
    const collection = db.collection('unique_ips');
    // Use updateOne with upsert for an atomic and efficient operation
    await collection.updateOne({ ip: ip }, { $set: { timestamp: new Date() } }, { upsert: true });
}

async function getSellersCollection() {
    const database = await connectToDatabase();
    return database.collection('sellers');
}

async function getResidentsCollection() {
    const database = await connectToDatabase();
    return database.collection('residents');
}

async function getSettingsCollection() {
    const database = await connectToDatabase();
    return database.collection('settings');
}

function normalizePhoneNumber(rawPhone) {
    if (!rawPhone) return '';
    const trimmed = String(rawPhone).trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('+')) {
        const digits = trimmed.slice(1).replace(/\D/g, '');
        return digits ? `+${digits}` : '';
    }
    const digits = trimmed.replace(/\D/g, '');
    return digits ? `+${digits}` : '';
}

const MAX_MAIN_PHOTO_BYTES = 1024 * 1024;
const MAX_MENU_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_MENU_PHOTO_COUNT = 3;
const MAX_RESIDENT_PHOTO_BYTES = 1024 * 1024;
const RESIDENT_ROLE_ADMIN = 'admin';
const RESIDENT_ROLE_PIN_MANAGER = 'pin_manager';
const RESIDENT_ROLE_RESIDENT = 'resident';

function parseSellerPhoto(photoPayload, options = {}) {
    const {
        maxBytes = MAX_MAIN_PHOTO_BYTES,
        fieldLabel = 'Foto'
    } = options;
    if (!photoPayload) {
        return null;
    }
    if (typeof photoPayload !== 'string') {
        throw new Error(`${fieldLabel} tidak valid.`);
    }
    let base64Segment = photoPayload;
    let contentType = 'image/jpeg';
    const dataUrlMatch = /^data:(.+);base64,(.+)$/i.exec(photoPayload);
    if (dataUrlMatch) {
        contentType = dataUrlMatch[1];
        base64Segment = dataUrlMatch[2];
    }
    const buffer = Buffer.from(base64Segment, 'base64');
    if (!buffer.length) {
        throw new Error(`${fieldLabel} tidak dapat diproses.`);
    }
    if (buffer.length > maxBytes) {
        const maxMb = (maxBytes / (1024 * 1024)).toFixed(maxBytes >= 1024 * 1024 ? 0 : 2);
        throw new Error(`${fieldLabel} melebihi ${maxMb}MB.`);
    }
    return {
        contentType,
        data: base64Segment,
        size: buffer.length
    };
}

function parseSellerMenuPhotos(menuPayload) {
    if (!menuPayload) {
        return [];
    }
    if (!Array.isArray(menuPayload)) {
        throw new Error('Format foto menu tidak valid.');
    }
    if (menuPayload.length > MAX_MENU_PHOTO_COUNT) {
        throw new Error(`Maksimal ${MAX_MENU_PHOTO_COUNT} foto menu.`);
    }
    const parsed = [];
    menuPayload.forEach((item, index) => {
        if (!item) {
            return;
        }
        const photo = parseSellerPhoto(item, {
            maxBytes: MAX_MENU_PHOTO_BYTES,
            fieldLabel: `Foto menu #${index + 1}`
        });
        parsed.push(photo);
    });
    return parsed;
}

function parseResidentPhoto(photoPayload) {
    return parseSellerPhoto(photoPayload, {
        maxBytes: MAX_RESIDENT_PHOTO_BYTES,
        fieldLabel: 'Foto profil warga'
    });
}

function sanitizeSeller(doc) {
    if (!doc) return null;
    const {
        passwordHash,
        usernameLower,
        communityVerification = {},
        ...rest
    } = doc;
    const sanitized = { ...rest };
    if (doc._id) {
        sanitized.id = doc._id.toString();
    }
    delete sanitized._id;
    if (sanitized.photo && sanitized.photo.data) {
        sanitized.photo = {
            contentType: sanitized.photo.contentType,
            data: sanitized.photo.data,
            size: sanitized.photo.size
        };
    }
    if (Array.isArray(sanitized.menuPhotos)) {
        sanitized.menuPhotos = sanitized.menuPhotos.map((photo) => ({
            contentType: photo.contentType,
            data: photo.data,
            size: photo.size
        }));
    } else {
        sanitized.menuPhotos = [];
    }
    const votes = Number(communityVerification?.votes) || 0;
    sanitized.communityVerification = {
        votes,
        verifiedAt: communityVerification?.verifiedAt || null
    };
    sanitized.isCommunityVerified = votes > 0;
    sanitized.showPhone = Boolean(sanitized.showPhone);
    return sanitized;
}

function isAdminResident(doc) {
    if (!doc) return false;
    if (doc.isAdmin === true) {
        return true;
    }
    const username = typeof doc.username === 'string' ? doc.username : '';
    const usernameLower = typeof doc.usernameLower === 'string' ? doc.usernameLower : username.toLowerCase();
    return usernameLower === 'admin';
}

function normalizeResidentRole(role) {
    if (role === RESIDENT_ROLE_PIN_MANAGER) {
        return RESIDENT_ROLE_PIN_MANAGER;
    }
    return RESIDENT_ROLE_RESIDENT;
}

function getResidentRole(doc) {
    if (isAdminResident(doc)) {
        return RESIDENT_ROLE_ADMIN;
    }
    const rawRole = typeof doc?.role === 'string' ? doc.role.toLowerCase().trim() : '';
    if (rawRole === RESIDENT_ROLE_PIN_MANAGER) {
        return RESIDENT_ROLE_PIN_MANAGER;
    }
    return RESIDENT_ROLE_RESIDENT;
}

function isPinManagerResident(doc) {
    return getResidentRole(doc) === RESIDENT_ROLE_PIN_MANAGER;
}

function canManagePinsResident(doc) {
    return isAdminResident(doc) || isPinManagerResident(doc);
}

function sanitizeResident(doc) {
    if (!doc) return null;
    const {
        passwordHash,
        usernameLower,
        ...rest
    } = doc;
    const shareFlag = !(doc.shareLocation === false || doc.shareLocation === 'false');
    const sanitized = { ...rest };
    if (doc._id) {
        sanitized.id = doc._id.toString();
    }
    delete sanitized._id;
    sanitized.badgesGiven = Number(sanitized.badgesGiven) || 0;
    sanitized.shareLocation = shareFlag;
    sanitized.statusMessage = typeof sanitized.statusMessage === 'string' ? sanitized.statusMessage.trim() : '';
    if (sanitized.photo && sanitized.photo.data) {
        sanitized.photo = {
            contentType: sanitized.photo.contentType,
            data: sanitized.photo.data,
            size: sanitized.photo.size
        };
    } else {
        delete sanitized.photo;
    }
    if (sanitized.lastLocation && typeof sanitized.lastLocation === 'object') {
        const lat = Number(sanitized.lastLocation.lat);
        const lng = Number(sanitized.lastLocation.lng);
        sanitized.lastLocation =
            Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    } else {
        sanitized.lastLocation = null;
    }
    if (!shareFlag) {
        sanitized.lastLocation = null;
    }
    sanitized.displayName = sanitized.displayName || sanitized.username;
    const savedPins = Array.isArray(doc.savedPins) ? doc.savedPins : [];
    sanitized.savedPins = Array.from(
        new Set(
            savedPins
                .map((entry) => String(entry || '').trim())
                .filter(Boolean)
        )
    );
    const role = getResidentRole(doc);
    sanitized.isAdmin = role === RESIDENT_ROLE_ADMIN;
    sanitized.isPinManager = role === RESIDENT_ROLE_PIN_MANAGER;
    sanitized.role = role;
    return sanitized;
}

function getRangeStart(range) {
    const now = new Date();
    if (range === 'day') {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (range === 'month') {
        return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    if (range === 'year') {
        return new Date(now.getFullYear(), 0, 1);
    }
    return new Date(now.getFullYear(), now.getMonth(), 1);
}

function getMonthRange(year, month) {
    const y = Number(year);
    const m = Number(month) - 1;
    return {
        start: new Date(y, m, 1),
        end: new Date(y, m + 1, 1)
    };
}

function getYearRange(year) {
    const y = Number(year);
    return {
        start: new Date(y, 0, 1),
        end: new Date(y + 1, 0, 1)
    };
}

function buildDateRangeFromQuery(query = {}) {
    const granularity = (query.granularity || 'month').toString();
    const now = new Date();
    if (granularity === 'day') {
        const year = Number(query.year) || now.getFullYear();
        const month = Number(query.month) || now.getMonth() + 1;
        const { start, end } = getMonthRange(year, month);
        const daysInMonth = new Date(year, month, 0).getDate();
        return { start, end, periods: daysInMonth, granularity };
    }
    if (granularity === 'year') {
        const startYear = Number(query.startYear) || now.getFullYear();
        const endYear = Number(query.endYear) || startYear;
        const start = new Date(startYear, 0, 1);
        const end = new Date(endYear + 1, 0, 1);
        return { start, end, periods: Math.max(1, endYear - startYear + 1), granularity };
    }
    const year = Number(query.year) || now.getFullYear();
    const { start, end } = getYearRange(year);
    return { start, end, periods: 12, granularity: 'month' };
}

const geocodeCityCache = new Map();

async function reverseGeocodeCity(lat, lng) {
    const key = `${lat},${lng}`;
    if (geocodeCityCache.has(key)) {
        return geocodeCityCache.get(key);
    }
    const useGoogle = Boolean(GOOGLE_MAPS_API_KEY);
    try {
        if (useGoogle) {
            const response = await axios.get(
                `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`
            );
            const results = response.data?.results || [];
            if (results.length) {
                let city = '';
                let country = '';
                const components = results[0].address_components || [];
                components.forEach((component) => {
                    if (component.types.includes('locality') || component.types.includes('administrative_area_level_2')) {
                        city = city || component.long_name || '';
                    }
                    if (component.types.includes('country')) {
                        country = component.short_name || component.long_name || '';
                    }
                });
                const label = [city, country].filter(Boolean).join(', ');
                const payload = { city, country, label };
                geocodeCityCache.set(key, payload);
                return payload;
            }
        }
        // Fallback: free OpenStreetMap Nominatim
        const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
            params: {
                format: 'json',
                lat,
                lon: lng,
                zoom: 10,
                addressdetails: 1
            },
            headers: {
                'User-Agent': 'ayanaon-analytics/1.0'
            }
        });
        const addr = response.data?.address || {};
        const city =
            addr.city ||
            addr.town ||
            addr.village ||
            addr.county ||
            '';
        const country = addr.country_code ? addr.country_code.toUpperCase() : (addr.country || '');
        const label = [city, country].filter(Boolean).join(', ') || response.data?.display_name || 'Unknown';
        const payload = { city, country, label };
        geocodeCityCache.set(key, payload);
        return payload;
    } catch (error) {
        console.error('Reverse geocode failed', error);
        return null;
    }
}

const DEFAULT_FEATURE_FLAGS = {
    gerobakOnline: true
};

const DEFAULT_SEO_SETTINGS = {
    title: 'AyaNaon | Cari Kegiatan Seru Di Sekitarmu!',
    description: 'Satu peta untuk cari ribuan acara olahraga, konser, edukasi, promo makanan sampai restoran legendaris ada disini, cuma dengan 1x klik!',
    keywords: 'event, lari, konser, seminar, makanan, minuman, restoran legendaris, SPBU, SPKLU, aplikasi rekomendasi tempat, rekomendasi tempat makan, rekomendasi kuliner Indonesia, aplikasi kuliner Indonesia, tempat makan terdekat, rekomendasi cafe terdekat, rekomendasi restoran terdekat, tempat nongkrong terdekat, rekomendasi tempat nongkrong, aplikasi pencari tempat makan, kuliner legendaris Indonesia, makan',
    siteUrl: 'https://ayanaon.app',
    ogTitle: '',
    ogDescription: '',
    ogImage: '',
    twitterTitle: '',
    twitterDescription: '',
    twitterImage: '',
    robotsIndex: true,
    robotsFollow: true,
    googleSiteVerification: 'NeZu1mzU6sFw3Zh8cbYsHJhjeCCY0gNEzyhwJ52WA1I'
};

const SEO_SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;
const SITEMAP_CACHE_TTL_MS = 15 * 60 * 1000;
let seoSettingsCache = null;
let seoSettingsCacheExpiresAt = 0;
let sitemapCache = { baseUrl: '', xml: '', expiresAt: 0 };

function sanitizeSeoText(value, maxLength) {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    if (!Number.isFinite(maxLength) || maxLength <= 0) {
        return trimmed;
    }
    return trimmed.slice(0, maxLength);
}

function sanitizeSeoUrl(value) {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    let normalized = trimmed.replace(/\/$/, '');
    if (!/^https?:\/\//i.test(normalized)) {
        normalized = normalized.replace(/^\/+/, '');
        normalized = `https://${normalized}`;
    }
    return normalized;
}

function normalizeSeoSettings(raw = {}) {
    return {
        title: sanitizeSeoText(raw.title, 70) || DEFAULT_SEO_SETTINGS.title,
        description: sanitizeSeoText(raw.description, 180) || DEFAULT_SEO_SETTINGS.description,
        keywords: sanitizeSeoText(raw.keywords, 400),
        siteUrl: sanitizeSeoUrl(raw.siteUrl),
        ogTitle: sanitizeSeoText(raw.ogTitle, 70),
        ogDescription: sanitizeSeoText(raw.ogDescription, 180),
        ogImage: sanitizeSeoText(raw.ogImage, 500),
        twitterTitle: sanitizeSeoText(raw.twitterTitle, 70),
        twitterDescription: sanitizeSeoText(raw.twitterDescription, 180),
        twitterImage: sanitizeSeoText(raw.twitterImage, 500),
        robotsIndex: typeof raw.robotsIndex === 'boolean' ? raw.robotsIndex : DEFAULT_SEO_SETTINGS.robotsIndex,
        robotsFollow: typeof raw.robotsFollow === 'boolean' ? raw.robotsFollow : DEFAULT_SEO_SETTINGS.robotsFollow,
        googleSiteVerification: sanitizeSeoText(raw.googleSiteVerification, 200)
    };
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function truncateText(value, maxLength) {
    const text = String(value || '').trim();
    if (!text || !Number.isFinite(maxLength) || maxLength <= 0) {
        return text;
    }
    if (text.length <= maxLength) {
        return text;
    }
    return text.slice(0, maxLength).trim();
}

function formatSitemapDate(value) {
    if (!value) {
        return new Date().toISOString().split('T')[0];
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return new Date().toISOString().split('T')[0];
    }
    return date.toISOString().split('T')[0];
}

function formatDisplayDate(value) {
    if (!value) {
        return '';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return date.toLocaleDateString('id-ID', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function formatPinWhenLabel(lifetime = {}) {
    if (!lifetime || typeof lifetime !== 'object') {
        return '';
    }
    if (lifetime.type === 'today') {
        return 'Hari ini';
    }
    if (lifetime.type === 'date') {
        const start = lifetime.start || lifetime.value;
        const end = lifetime.end || lifetime.value || lifetime.start;
        const startLabel = formatDisplayDate(start);
        const endLabel = formatDisplayDate(end);
        if (startLabel && endLabel && startLabel !== endLabel) {
            return `${startLabel} - ${endLabel}`;
        }
        return startLabel || endLabel || '';
    }
    return '';
}

function formatDateToYMD(value) {
    if (!value) {
        return '';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getPinFilterDateRange(lifetime = {}) {
    if (!lifetime || typeof lifetime !== 'object') {
        return { start: '', end: '' };
    }
    if (lifetime.type === 'today') {
        const today = formatDateToYMD(new Date());
        return { start: today, end: today };
    }
    if (lifetime.type === 'date') {
        const startValue = lifetime.start || lifetime.value || lifetime.end || '';
        const endValue = lifetime.end || lifetime.value || lifetime.start || '';
        return {
            start: formatDateToYMD(startValue),
            end: formatDateToYMD(endValue)
        };
    }
    return { start: '', end: '' };
}

function buildPinSearchText(pin = {}) {
    const parts = [
        typeof pin?.title === 'string' ? pin.title.trim() : '',
        typeof pin?.description === 'string' ? pin.description.trim() : '',
        typeof pin?.category === 'string' ? pin.category.trim() : '',
        typeof pin?.city === 'string' ? pin.city.trim() : ''
    ].filter(Boolean);
    return parts.join(' ').toLowerCase();
}

function normalizeExternalUrl(value) {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    if (!/^https?:\/\//i.test(trimmed)) {
        return '';
    }
    return trimmed;
}

function normalizeFeatureFlags(flags = {}) {
    const raw = flags?.gerobakOnline;
    const disabled = raw === false || raw === 'false' || raw === 0 || raw === '0';
    return {
        gerobakOnline: !disabled
    };
}

async function readFeatureFlags() {
    try {
        const settings = await getSettingsCollection();
        const doc = await settings.findOne({ key: 'features' });
        return normalizeFeatureFlags(doc || DEFAULT_FEATURE_FLAGS);
    } catch (error) {
        console.error('Failed to read feature flags', error);
        return { ...DEFAULT_FEATURE_FLAGS };
    }
}

async function writeFeatureFlags(flags = {}) {
    const settings = await getSettingsCollection();
    const normalized = normalizeFeatureFlags(flags);
    const payload = {
        key: 'features',
        ...normalized,
        updatedAt: new Date()
    };
    await settings.updateOne({ key: 'features' }, { $set: payload }, { upsert: true });
    return normalized;
}

async function readMaintenanceStatus() {
    try {
        const settings = await getSettingsCollection();
        const doc = await settings.findOne({ key: 'maintenance' });
        return {
            enabled: Boolean(doc?.enabled),
            message: typeof doc?.message === 'string' ? doc.message : ''
        };
    } catch (error) {
        console.error('Failed to read maintenance status', error);
        return { enabled: false, message: '' };
    }
}

async function writeMaintenanceStatus(enabled, message) {
    const settings = await getSettingsCollection();
    const sanitizedMessage = typeof message === 'string' ? message.trim().slice(0, 500) : '';
    const payload = {
        key: 'maintenance',
        enabled: Boolean(enabled),
        message: sanitizedMessage,
        updatedAt: new Date()
    };
    await settings.updateOne({ key: 'maintenance' }, { $set: payload }, { upsert: true });
    return { enabled: payload.enabled, message: payload.message };
}

async function readSeoSettings() {
    try {
        const now = Date.now();
        if (seoSettingsCache && now < seoSettingsCacheExpiresAt) {
            return seoSettingsCache;
        }
        const settings = await getSettingsCollection();
        const doc = await settings.findOne({ key: 'seo' });
        const normalized = normalizeSeoSettings(doc || {});
        seoSettingsCache = normalized;
        seoSettingsCacheExpiresAt = now + SEO_SETTINGS_CACHE_TTL_MS;
        return normalized;
    } catch (error) {
        console.error('Failed to read SEO settings', error);
        return { ...DEFAULT_SEO_SETTINGS };
    }
}

async function writeSeoSettings(payload = {}) {
    const settings = await getSettingsCollection();
    const normalized = normalizeSeoSettings(payload);
    const stored = {
        key: 'seo',
        ...normalized,
        updatedAt: new Date()
    };
    await settings.updateOne({ key: 'seo' }, { $set: stored }, { upsert: true });
    seoSettingsCache = normalized;
    seoSettingsCacheExpiresAt = Date.now() + SEO_SETTINGS_CACHE_TTL_MS;
    return normalized;
}

function resolveSeoBaseUrl(seo, req) {
    const configured = sanitizeSeoUrl(seo?.siteUrl);
    const protoHeader = req.headers['x-forwarded-proto'] || 'https';
    const proto = protoHeader.split(',')[0].trim() || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    const requestBase = host ? `${proto}://${host}` : '';
    if (!configured) {
        return requestBase;
    }
    if (!host) {
        return configured;
    }
    try {
        const configuredUrl = new URL(configured);
        const configuredHost = configuredUrl.host.toLowerCase();
        const requestHost = host.toLowerCase();
        const normalizedConfiguredHost = configuredHost.replace(/^www\./, '');
        const normalizedRequestHost = requestHost.replace(/^www\./, '');
        if (normalizedConfiguredHost === normalizedRequestHost) {
            const configuredIsHttps = configuredUrl.protocol === 'https:';
            const requestIsHttps = proto === 'https';
            const configuredHasWww = configuredHost.startsWith('www.');
            const requestHasWww = requestHost.startsWith('www.');
            if ((requestIsHttps && !configuredIsHttps) || (configuredHasWww && !requestHasWww)) {
                return requestBase;
            }
        }
    } catch (error) {
        return configured;
    }
    return configured;
}

function buildSitemapXml(baseUrl, entries = []) {
    const safeBase = sanitizeSeoUrl(baseUrl);
    const urls = [];
    if (safeBase) {
        urls.push({
            loc: `${safeBase}/`,
            lastmod: formatSitemapDate(new Date()),
            changefreq: 'daily',
            priority: '1.0'
        });
    }
    const seen = new Set(urls.map((entry) => entry.loc));
    entries.forEach((entry) => {
        if (!entry || !entry.loc || seen.has(entry.loc)) {
            return;
        }
        seen.add(entry.loc);
        urls.push(entry);
    });
    const body = urls
        .map((entry) => {
            const lastmod = entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : '';
            const changefreq = entry.changefreq ? `<changefreq>${entry.changefreq}</changefreq>` : '';
            const priority = entry.priority ? `<priority>${entry.priority}</priority>` : '';
            return `  <url>\n    <loc>${entry.loc}</loc>\n    ${lastmod}\n    ${changefreq}\n    ${priority}\n  </url>`;
        })
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        `${body}\n` +
        `</urlset>\n`;
}

function buildRobotsTxt(seo, baseUrl) {
    const allowIndex = seo?.robotsIndex !== false;
    const lines = [
        'User-agent: *',
        allowIndex ? 'Allow: /' : 'Disallow: /'
    ];
    if (allowIndex) {
        const safeBase = sanitizeSeoUrl(baseUrl);
        if (safeBase) {
            lines.push(`Sitemap: ${safeBase}/sitemap.xml`);
        }
    }
    return `${lines.join('\n')}\n`;
}

async function fetchActivePinsForSitemap() {
    const db = await connectToDatabase();
    return db.collection('pins')
        .find({ $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }] })
        .project({ _id: 1, createdAt: 1, updatedAt: 1, category: 1, city: 1 })
        .toArray();
}

function normalizeLandingText(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim();
}

function slugifyText(value) {
    const normalized = normalizeLandingText(value).toLowerCase();
    if (!normalized) {
        return '';
    }
    const ascii = normalized
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '');
    return ascii
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function buildLandingEntriesFromPins(pins = [], baseUrl = '') {
    if (!baseUrl) {
        return [];
    }
    const categories = new Map();
    const regionsByCategory = new Map();
    pins.forEach((pin) => {
        const category = normalizeLandingText(pin?.category);
        const categorySlug = slugifyText(category);
        if (!categorySlug) {
            return;
        }
        if (!categories.has(categorySlug)) {
            categories.set(categorySlug, category);
        }
        const city = normalizeLandingText(pin?.city);
        const regionSlug = slugifyText(city);
        if (!regionSlug) {
            return;
        }
        if (!regionsByCategory.has(categorySlug)) {
            regionsByCategory.set(categorySlug, new Map());
        }
        const regionMap = regionsByCategory.get(categorySlug);
        if (!regionMap.has(regionSlug)) {
            regionMap.set(regionSlug, city);
        }
    });
    const lastmod = formatSitemapDate(new Date());
    const entries = [];
    entries.push({
        loc: `${baseUrl}/kategori`,
        lastmod,
        changefreq: 'weekly',
        priority: '0.6'
    });
    categories.forEach((_label, slug) => {
        entries.push({
            loc: `${baseUrl}/kategori/${slug}`,
            lastmod,
            changefreq: 'weekly',
            priority: '0.6'
        });
    });
    regionsByCategory.forEach((regionMap, categorySlug) => {
        regionMap.forEach((_label, regionSlug) => {
            entries.push({
                loc: `${baseUrl}/kategori/${categorySlug}/${regionSlug}`,
                lastmod,
                changefreq: 'weekly',
                priority: '0.5'
            });
        });
    });
    return entries;
}

async function fetchCategoryIndexData() {
    const db = await connectToDatabase();
    const activeQuery = { $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }] };
    const categoriesRaw = await db.collection('pins')
        .aggregate([
            { $match: activeQuery },
            { $group: { _id: '$category', count: { $sum: 1 } } }
        ])
        .toArray();
    const categories = categoriesRaw
        .map((doc) => {
            const label = normalizeLandingText(doc?._id);
            const slug = slugifyText(label);
            if (!slug) {
                return null;
            }
            return {
                label,
                slug,
                count: Number(doc?.count) || 0
            };
        })
        .filter(Boolean)
        .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));

    const regionsRaw = await db.collection('pins')
        .aggregate([
            { $match: activeQuery },
            { $group: { _id: { category: '$category', city: '$city' }, count: { $sum: 1 } } }
        ])
        .toArray();
    const regionsByCategory = new Map();
    regionsRaw.forEach((doc) => {
        const categoryLabel = normalizeLandingText(doc?._id?.category);
        const cityLabel = normalizeLandingText(doc?._id?.city);
        const categorySlug = slugifyText(categoryLabel);
        const regionSlug = slugifyText(cityLabel);
        if (!categorySlug || !regionSlug) {
            return;
        }
        if (!regionsByCategory.has(categorySlug)) {
            regionsByCategory.set(categorySlug, new Map());
        }
        const regionMap = regionsByCategory.get(categorySlug);
        const existing = regionMap.get(regionSlug);
        if (existing) {
            existing.count += Number(doc?.count) || 0;
        } else {
            regionMap.set(regionSlug, {
                label: cityLabel,
                slug: regionSlug,
                count: Number(doc?.count) || 0
            });
        }
    });
    const regionLists = new Map();
    regionsByCategory.forEach((regionMap, categorySlug) => {
        const list = Array.from(regionMap.values()).sort(
            (a, b) => (b.count - a.count) || a.label.localeCompare(b.label)
        );
        regionLists.set(categorySlug, list);
    });
    const totalPins = categories.reduce((sum, item) => sum + (item.count || 0), 0);
    const regionTotals = new Map();
    regionLists.forEach((list) => {
        list.forEach((region) => {
            if (!region || !region.label) {
                return;
            }
            const slug = slugifyText(region.slug || region.label);
            if (!slug) {
                return;
            }
            if (!regionTotals.has(slug)) {
                regionTotals.set(slug, {
                    label: region.label,
                    slug,
                    count: Number(region.count) || 0
                });
            } else {
                const existing = regionTotals.get(slug);
                existing.count += Number(region.count) || 0;
            }
        });
    });
    const regions = Array.from(regionTotals.values()).sort(
        (a, b) => (b.count - a.count) || a.label.localeCompare(b.label)
    );
    const pins = await db.collection('pins')
        .find(activeQuery)
        .project({
            _id: 1,
            title: 1,
            description: 1,
            category: 1,
            city: 1,
            lifetime: 1,
            createdAt: 1,
            updatedAt: 1
        })
        .sort({ _id: -1 })
        .limit(200)
        .toArray();
    return {
        categories,
        regionsByCategory: regionLists,
        totalPins,
        pins,
        regions
    };
}

async function fetchCategoryLandingData(categorySlug, regionSlug) {
    const safeCategorySlug = slugifyText(categorySlug);
    const safeRegionSlug = slugifyText(regionSlug);
    if (!safeCategorySlug) {
        return null;
    }
    const db = await connectToDatabase();
    const activeQuery = { $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }] };
    const categories = await db.collection('pins').distinct('category', activeQuery);
    let categoryLabel = '';
    for (const entry of categories) {
        const normalized = normalizeLandingText(entry);
        if (!normalized) {
            continue;
        }
        if (slugifyText(normalized) === safeCategorySlug) {
            categoryLabel = normalized;
            break;
        }
    }
    if (!categoryLabel) {
        return null;
    }
    const categoryQuery = { ...activeQuery, category: categoryLabel };
    const regionDocs = await db.collection('pins')
        .aggregate([
            { $match: categoryQuery },
            { $group: { _id: '$city', count: { $sum: 1 } } }
        ])
        .toArray();
    const regions = regionDocs
        .map((doc) => {
            const label = normalizeLandingText(doc?._id);
            const slug = slugifyText(label);
            if (!label || !slug) {
                return null;
            }
            return {
                label,
                slug,
                count: Number(doc?.count) || 0
            };
        })
        .filter(Boolean)
        .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));
    const query = { ...categoryQuery };
    let regionLabel = '';
    if (safeRegionSlug) {
        const cities = await db.collection('pins').distinct('city', query);
        for (const entry of cities) {
            const normalized = normalizeLandingText(entry);
            if (!normalized) {
                continue;
            }
            if (slugifyText(normalized) === safeRegionSlug) {
                regionLabel = normalized;
                break;
            }
        }
        if (!regionLabel) {
            return null;
        }
        query.city = regionLabel;
    }
    const totalCount = await db.collection('pins').countDocuments(query);
    const pins = await db.collection('pins')
        .find(query)
        .project({
            _id: 1,
            title: 1,
            description: 1,
            category: 1,
            city: 1,
            lifetime: 1,
            createdAt: 1,
            updatedAt: 1
        })
        .sort({ _id: -1 })
        .limit(200)
        .toArray();
    return {
        categoryLabel,
        regionLabel,
        categorySlug: safeCategorySlug,
        regionSlug: safeRegionSlug,
        pins,
        totalCount,
        regions
    };
}

function getPinImageSource(image) {
    if (!image) {
        return '';
    }
    if (typeof image === 'string') {
        return image;
    }
    const directSourceKeys = [
        'dataUrl',
        'dataURL',
        'url',
        'src',
        'secureUrl',
        'secureURL',
        'secure_url',
        'imageUrl',
        'imageURL',
        'path',
        'filePath',
        'fileURL',
        'fileUrl',
        'signedUrl',
        'signedURL',
        'signed_url',
        'cdnUrl',
        'cdnURL',
        'assetUrl',
        'assetURL',
        'location',
        'href'
    ];
    for (const key of directSourceKeys) {
        const value = image[key];
        if (typeof value === 'string' && value) {
            return value;
        }
    }
    if (typeof image.data === 'string' && image.data) {
        if (image.data.startsWith('data:')) {
            return image.data;
        }
        const mimeType = image.contentType || image.mimeType || 'image/jpeg';
        return `data:${mimeType};base64,${image.data}`;
    }
    if (image.data && typeof image.data === 'object' && image.data !== image) {
        const nested = getPinImageSource(image.data);
        if (nested) {
            return nested;
        }
    }
    return '';
}

function buildPinPageHtml(pin, seo, baseUrl) {
    const title = String(pin?.title || 'Informasi Pin').trim();
    const description = String(pin?.description || '').trim();
    const metaDescription = truncateText(description || seo?.description || '', 160);
    const pageTitle = title ? `${title} | ${seo?.title || ''}`.trim() : (seo?.title || '');
    const pinId = pin?._id ? String(pin._id) : '';
    const canonicalUrl = baseUrl ? `${baseUrl}/pin/${pinId}` : '';
    const categoryIndexUrl = baseUrl ? `${baseUrl}/kategori` : '/kategori';
    const mapFocusUrl = baseUrl
        ? (pinId ? `${baseUrl}/?pin=${encodeURIComponent(pinId)}` : `${baseUrl}/`)
        : '';
    const robots = `${seo?.robotsIndex !== false ? 'index' : 'noindex'},${seo?.robotsFollow !== false ? 'follow' : 'nofollow'}`;
    const ogImage = seo?.ogImage || (baseUrl ? `${baseUrl}/icon-512.png` : '');
    const twitterImage = seo?.twitterImage || ogImage;
    const whenLabel = formatPinWhenLabel(pin?.lifetime);
    const city = pin?.city ? String(pin.city).trim() : '';
    const hasCoords = Number.isFinite(pin?.lat) && Number.isFinite(pin?.lng);
    const lat = hasCoords ? Number(pin.lat) : null;
    const lng = hasCoords ? Number(pin.lng) : null;
    const coords = hasCoords ? `${lat}, ${lng}` : '';
    const externalLink = normalizeExternalUrl(pin?.link);
    const createdAt = pin?.createdAt ? new Date(pin.createdAt) : null;
    const updatedAt = pin?.updatedAt ? new Date(pin.updatedAt) : null;
    const mapLink = hasCoords
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`
        : '';
    const mapEmbedUrl = hasCoords
        ? `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}&z=15&output=embed`
        : '';
    const images = Array.isArray(pin?.images) ? pin.images : [];
    const galleryImages = images
        .map((image, index) => {
            const src = getPinImageSource(image);
            if (!src) {
                return null;
            }
            const alt = title ? `${title} foto ${index + 1}` : `Foto pin ${index + 1}`;
            return { src, alt };
        })
        .filter(Boolean)
        .slice(0, 6);

    const structuredData = {
        '@context': 'https://schema.org',
        '@type': 'CreativeWork',
        name: title,
        description: description || seo?.description || '',
        url: canonicalUrl || undefined,
        datePublished: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString() : undefined,
        dateModified: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toISOString() : undefined,
        about: pin?.category || undefined
    };
    if (Number.isFinite(pin?.lat) && Number.isFinite(pin?.lng)) {
        structuredData.location = {
            '@type': 'Place',
            name: city || title,
            geo: {
                '@type': 'GeoCoordinates',
                latitude: pin.lat,
                longitude: pin.lng
            }
        };
    }

    const descriptionHtml = description
        ? escapeHtml(description).replace(/\n/g, '<br>')
        : escapeHtml(seo?.description || '');

    const metaKeywords = seo?.keywords ? escapeHtml(seo.keywords) : '';
    const categoryLabel = pin?.category ? escapeHtml(pin.category) : '';
    const whenLabelHtml = whenLabel ? escapeHtml(whenLabel) : '';
    const cityHtml = city ? escapeHtml(city) : '';
    const coordsHtml = coords ? escapeHtml(coords) : '';
    const linkLabel = (externalLink && typeof pin?.link === 'string')
        ? pin.link.trim()
        : '';
    let linkButtonLabel = '';
    if (externalLink) {
        linkButtonLabel = 'Buka tautan';
        try {
            const parsedUrl = new URL(externalLink);
            const hostname = parsedUrl.hostname.replace(/^www\./, '');
            if (hostname) {
                linkButtonLabel = `Buka ${hostname}`;
            }
        } catch (error) {
            // Keep the default label when URL parsing fails.
        }
    }
    const galleryHtml = galleryImages.length
        ? `<section class="pin-detail-gallery">
            ${galleryImages.map(({ src, alt }) => {
                const safeSrc = escapeHtml(src);
                const safeAlt = escapeHtml(alt || 'Foto pin');
                return `<figure class="pin-detail-gallery__item">
                    <button type="button" class="pin-detail-gallery__button" data-full="${safeSrc}" data-alt="${safeAlt}" aria-label="Lihat foto lebih besar">
                        <img src="${safeSrc}" alt="${safeAlt}" loading="lazy">
                    </button>
                </figure>`;
            }).join('')}
        </section>`
        : '';
    const metaItems = [
        { label: 'Kategori', value: categoryLabel },
        { label: 'Waktu', value: whenLabelHtml },
        { label: 'Kota', value: cityHtml },
        { label: 'Koordinat', value: coordsHtml }
    ].filter((item) => item.value);
    const metaHtml = metaItems.length
        ? `<div class="pin-detail-meta">
            ${metaItems.map((item) => (
                `<div class="pin-detail-meta__item">
                    <div class="pin-detail-meta__label">${item.label}</div>
                    <div class="pin-detail-meta__value">${item.value}</div>
                </div>`
            )).join('')}
        </div>`
        : '';
    const mapHtml = mapEmbedUrl
        ? `<div class="pin-detail-map">
            <div class="pin-detail-map__label">Lokasi</div>
            <div class="pin-detail-map__frame">
                <iframe
                    src="${escapeHtml(mapEmbedUrl)}"
                    title="${escapeHtml(`Peta lokasi ${title}`)}"
                    loading="lazy"
                    referrerpolicy="no-referrer-when-downgrade"
                    allowfullscreen
                ></iframe>
            </div>
        </div>`
        : '';
    const actionItems = [
        mapLink ? { href: mapLink, label: 'Buka di Google Maps', external: true } : null,
        externalLink ? { href: externalLink, label: linkButtonLabel || linkLabel || 'Buka tautan', external: true } : null,
        mapFocusUrl ? { href: mapFocusUrl, label: 'Lihat di peta AyaNaon', external: false } : null
    ].filter(Boolean);
    const actionsHtml = actionItems.length
        ? `<div class="pin-detail-actions">
            ${actionItems.map((item) => {
                const safeHref = escapeHtml(item.href);
                const safeLabel = escapeHtml(item.label);
                const rel = item.external ? ' rel="noopener"' : '';
                const target = item.external ? ' target="_blank"' : '';
                return `<a class="pin-detail-action" href="${safeHref}"${target}${rel}>${safeLabel}</a>`;
            }).join('')}
        </div>`
        : '';
    const lightboxHtml = galleryImages.length
        ? `<div class="pin-detail-lightbox" role="dialog" aria-modal="true" aria-hidden="true">
            <div class="pin-detail-lightbox__content">
                <button type="button" class="pin-detail-lightbox__close">Tutup</button>
                <img class="pin-detail-lightbox__image" alt="">
            </div>
        </div>`
        : '';
    const lightboxScript = galleryImages.length
        ? `<script>
            (function () {
              const lightbox = document.querySelector('.pin-detail-lightbox');
              if (!lightbox) {
                return;
              }
              const imageEl = lightbox.querySelector('.pin-detail-lightbox__image');
              const closeButton = lightbox.querySelector('.pin-detail-lightbox__close');
              const openButtons = document.querySelectorAll('.pin-detail-gallery__button');
              const openLightbox = (src, alt) => {
                if (!imageEl) {
                  return;
                }
                imageEl.src = src;
                imageEl.alt = alt || 'Foto pin';
                lightbox.classList.add('is-visible');
                lightbox.setAttribute('aria-hidden', 'false');
                document.body.classList.add('pin-detail-lightbox-open');
                if (closeButton) {
                  closeButton.focus({ preventScroll: true });
                }
              };
              const closeLightbox = () => {
                lightbox.classList.remove('is-visible');
                lightbox.setAttribute('aria-hidden', 'true');
                document.body.classList.remove('pin-detail-lightbox-open');
                if (imageEl) {
                  imageEl.src = '';
                  imageEl.alt = '';
                }
              };
              openButtons.forEach((btn) => {
                btn.addEventListener('click', () => {
                  const src = btn.getAttribute('data-full') || '';
                  const alt = btn.getAttribute('data-alt') || '';
                  if (src) {
                    openLightbox(src, alt);
                  }
                });
              });
              if (closeButton) {
                closeButton.addEventListener('click', closeLightbox);
              }
              lightbox.addEventListener('click', (event) => {
                if (event.target === lightbox) {
                  closeLightbox();
                }
              });
              document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && lightbox.classList.contains('is-visible')) {
                  closeLightbox();
                }
              });
            })();
        </script>`
        : '';

    return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle || title)}</title>
  <meta name="description" content="${escapeHtml(metaDescription)}">
  ${metaKeywords ? `<meta name="keywords" content="${metaKeywords}">` : ''}
  <meta name="robots" content="${robots}">
  ${seo?.googleSiteVerification ? `<meta name="google-site-verification" content="${escapeHtml(seo.googleSiteVerification)}">` : ''}
  ${canonicalUrl ? `<link rel="canonical" href="${canonicalUrl}">` : ''}
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(pageTitle || title)}">
  <meta property="og:description" content="${escapeHtml(metaDescription)}">
  ${canonicalUrl ? `<meta property="og:url" content="${canonicalUrl}">` : ''}
  ${ogImage ? `<meta property="og:image" content="${ogImage}">` : ''}
  <meta name="twitter:card" content="${twitterImage ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:title" content="${escapeHtml(pageTitle || title)}">
  <meta name="twitter:description" content="${escapeHtml(metaDescription)}">
  ${twitterImage ? `<meta name="twitter:image" content="${twitterImage}">` : ''}
  <link rel="stylesheet" href="/style.css">
  <style>
    body.pin-detail-page {
      overflow-y: auto;
    }
    body.pin-detail-page.pin-detail-lightbox-open {
      overflow: hidden;
    }
    .pin-detail-bg {
      position: fixed;
      inset: 0;
      background:
        radial-gradient(circle at top right, rgba(59, 130, 246, 0.22), transparent 50%),
        radial-gradient(circle at 15% 20%, rgba(14, 165, 233, 0.18), transparent 45%),
        linear-gradient(160deg, rgba(15, 23, 42, 0.9), rgba(2, 6, 23, 0.92));
      z-index: 0;
    }
    .pin-detail-shell {
      position: relative;
      z-index: 1;
      min-height: 100vh;
      padding: clamp(20px, 5vw, 56px);
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .pin-detail-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .pin-detail-brand {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      text-decoration: none;
      color: var(--app-text-strong);
      font-weight: 800;
      letter-spacing: -0.01em;
      font-size: 18px;
    }
    .pin-detail-brand img {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      border: 1px solid var(--app-panel-border);
      background: rgba(15, 23, 42, 0.6);
      padding: 6px;
    }
    .pin-detail-header-actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .pin-detail-header-actions a {
      text-decoration: none;
    }
    .pin-detail-ghost {
      color: var(--app-text);
      border: 1px solid var(--app-panel-border);
      background: var(--app-panel-bg);
      border-radius: 999px;
      padding: 10px 16px;
      font-weight: 700;
      font-size: 13px;
      transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
    }
    .pin-detail-ghost:hover,
    .pin-detail-ghost:focus-visible {
      transform: translateY(-1px);
      background: rgba(59, 130, 246, 0.12);
      border-color: rgba(59, 130, 246, 0.4);
      outline: none;
    }
    .pin-detail-main {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
      gap: 24px;
    }
    .pin-detail-card {
      background: var(--app-panel-bg);
      border: 1px solid var(--app-panel-border);
      border-radius: var(--app-panel-radius);
      padding: clamp(20px, 4vw, 28px);
      box-shadow: var(--app-panel-shadow);
      backdrop-filter: var(--app-panel-blur);
    }
    .pin-detail-eyebrow {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 14px;
    }
    .pin-detail-chip {
      background: var(--app-chip-bg);
      border: 1px solid var(--app-chip-border);
      color: var(--app-text-soft);
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 700;
    }
    .pin-detail-title {
      margin: 0 0 12px;
      font-size: clamp(24px, 3vw, 40px);
      color: var(--app-text-strong);
    }
    .pin-detail-description {
      font-size: 15px;
      line-height: 1.6;
      color: var(--app-text);
    }
    .pin-detail-gallery {
      margin-top: 18px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
    }
    .pin-detail-gallery__item {
      margin: 0;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid var(--app-card-border);
      background: var(--app-card-bg);
      box-shadow: var(--app-card-shadow);
    }
    .pin-detail-gallery__button {
      border: none;
      padding: 0;
      background: transparent;
      width: 100%;
      display: block;
      cursor: zoom-in;
    }
    .pin-detail-gallery__button:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: 2px;
    }
    .pin-detail-gallery__button img {
      width: 100%;
      height: 140px;
      object-fit: cover;
      display: block;
    }
    .pin-detail-meta {
      display: grid;
      gap: 12px;
    }
    .pin-detail-meta__item {
      background: var(--app-card-bg);
      border: 1px solid var(--app-card-border);
      border-radius: 14px;
      padding: 12px 14px;
    }
    .pin-detail-meta__label {
      font-size: 12px;
      font-weight: 700;
      color: var(--app-text-muted);
      margin-bottom: 6px;
    }
    .pin-detail-meta__value {
      font-size: 14px;
      color: var(--app-text-strong);
      word-break: break-word;
    }
    .pin-detail-map {
      margin-top: 18px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .pin-detail-map__label {
      font-size: 12px;
      font-weight: 700;
      color: var(--app-text-muted);
    }
    .pin-detail-map__frame {
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid var(--app-card-border);
      background: var(--app-card-bg);
      box-shadow: var(--app-card-shadow);
      height: 180px;
    }
    .pin-detail-map__frame iframe {
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
    }
    .pin-detail-actions {
      margin-top: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .pin-detail-action {
      text-decoration: none;
      background: var(--app-button-bg);
      color: var(--app-button-text);
      padding: 12px 16px;
      border-radius: 12px;
      font-weight: 700;
      text-align: center;
      border: 1px solid transparent;
      transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
    }
    .pin-detail-action:hover,
    .pin-detail-action:focus-visible {
      background: var(--app-button-hover);
      border-color: rgba(59, 130, 246, 0.3);
      transform: translateY(-1px);
      outline: none;
    }
    .pin-detail-lightbox {
      position: fixed;
      inset: 0;
      background: rgba(2, 6, 23, 0.75);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      z-index: 20;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .pin-detail-lightbox.is-visible {
      opacity: 1;
      pointer-events: auto;
    }
    .pin-detail-lightbox__content {
      background: var(--app-panel-bg);
      border: 1px solid var(--app-panel-border);
      border-radius: 18px;
      padding: 16px;
      max-width: min(900px, 92vw);
      max-height: 82vh;
      width: 100%;
      box-shadow: var(--app-panel-shadow);
      backdrop-filter: var(--app-panel-blur);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .pin-detail-lightbox__close {
      align-self: flex-end;
      border: 1px solid transparent;
      border-radius: 999px;
      background: var(--app-button-bg);
      color: var(--app-button-text);
      padding: 8px 14px;
      font-weight: 700;
      cursor: pointer;
    }
    .pin-detail-lightbox__close:hover,
    .pin-detail-lightbox__close:focus-visible {
      background: var(--app-button-hover);
      outline: none;
    }
    .pin-detail-lightbox__image {
      width: 100%;
      height: auto;
      max-height: 68vh;
      object-fit: contain;
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.6);
    }
    .pin-detail-footer {
      margin-top: auto;
      text-align: center;
      font-size: 12px;
      color: var(--app-text-muted);
    }
    @media (max-width: 900px) {
      .pin-detail-main {
        grid-template-columns: 1fr;
      }
    }
  </style>
  <script type="application/ld+json">${JSON.stringify(structuredData)}</script>
</head>
<body class="pin-detail-page">
  <div class="pin-detail-bg"></div>
  <div class="pin-detail-shell">
    <header class="pin-detail-header">
      <a class="pin-detail-brand" href="${baseUrl ? `${baseUrl}/` : '/'}">
        <img src="/icon-192.png" alt="AyaNaon">
        <span>AyaNaon</span>
      </a>
      <div class="pin-detail-header-actions">
        <a class="pin-detail-ghost" href="${categoryIndexUrl}">Lihat kategori</a>
        ${mapFocusUrl ? `<a class="pin-detail-ghost" href="${mapFocusUrl}">Lihat di peta</a>` : ''}
      </div>
    </header>
    <main class="pin-detail-main">
      <section class="pin-detail-card">
        <div class="pin-detail-eyebrow">
          ${categoryLabel ? `<span class="pin-detail-chip">${categoryLabel}</span>` : ''}
          ${whenLabelHtml ? `<span class="pin-detail-chip">${whenLabelHtml}</span>` : ''}
        </div>
        <h1 class="pin-detail-title">${escapeHtml(title)}</h1>
        <div class="pin-detail-description">${descriptionHtml}</div>
        ${galleryHtml}
      </section>
      <aside class="pin-detail-card">
        ${metaHtml}
        ${mapHtml}
        ${actionsHtml}
      </aside>
    </main>
    <footer class="pin-detail-footer">AyaNaon pin detail page</footer>
  </div>
  ${lightboxHtml}
  ${lightboxScript}
</body>
</html>`;
}

function buildPinLandingListItem(pin, options = {}) {
    if (!pin || !pin._id) {
        return '';
    }
    const includeCategory = Boolean(options.includeCategory);
    const pinTitle = typeof pin?.title === 'string' && pin.title.trim()
        ? pin.title.trim()
        : 'Pin tanpa judul';
    const pinUrl = `/pin/${pin._id}`;
    const pinCity = normalizeLandingText(pin?.city);
    const pinCategory = normalizeLandingText(pin?.category);
    const pinWhen = formatPinWhenLabel(pin?.lifetime);
    const metaParts = [];
    if (includeCategory && pinCategory) {
        metaParts.push(pinCategory);
    }
    if (pinCity) {
        metaParts.push(pinCity);
    }
    if (pinWhen) {
        metaParts.push(pinWhen);
    }
    const metaLabel = metaParts.join(' - ');
    const description = typeof pin?.description === 'string' ? pin.description.trim() : '';
    const descriptionText = truncateText(description, 140);
    const searchText = buildPinSearchText(pin);
    const regionSlug = slugifyText(pinCity);
    const { start, end } = getPinFilterDateRange(pin?.lifetime);
    const dataAttrs = [
        `data-search="${escapeHtml(searchText)}"`,
        regionSlug ? `data-region="${escapeHtml(regionSlug)}"` : '',
        start ? `data-start="${escapeHtml(start)}"` : '',
        end ? `data-end="${escapeHtml(end)}"` : ''
    ].filter(Boolean).join(' ');
    return `<li class="pin-landing-item" ${dataAttrs}>
        <a class="pin-landing-link" href="${pinUrl}">${escapeHtml(pinTitle)}</a>
        ${metaLabel ? `<div class="pin-landing-meta">${escapeHtml(metaLabel)}</div>` : ''}
        ${descriptionText ? `<p class="pin-landing-desc">${escapeHtml(descriptionText)}</p>` : ''}
    </li>`;
}

function buildCategoryIndexHtml({
    seo,
    baseUrl,
    categories,
    regionsByCategory,
    totalPins,
    pins,
    regions
}) {
    const heading = 'Kategori dan Wilayah';
    const totalCount = Number(totalPins) || 0;
    const pageTitle = truncateText(
        [heading, seo?.title || ''].filter(Boolean).join(' | '),
        70
    );
    const introText = totalCount
        ? `Jelajahi ${totalCount} pin berdasarkan kategori dan wilayah di AyaNaon. Pilih kategori untuk melihat daftar pin terkait.`
        : 'Jelajahi kategori dan wilayah di AyaNaon. Pilih kategori untuk melihat daftar pin terkait.';
    const metaDescription = truncateText(introText, 160);
    const canonicalUrl = baseUrl ? `${baseUrl}/kategori` : '';
    const backHref = baseUrl ? `${baseUrl}/` : '/';
    const backLabel = 'Kembali ke peta';
    const robots = `${seo?.robotsIndex !== false ? 'index' : 'noindex'},${seo?.robotsFollow !== false ? 'follow' : 'nofollow'}`;
    const ogImage = seo?.ogImage || (baseUrl ? `${baseUrl}/icon-512.png` : '');
    const twitterImage = seo?.twitterImage || ogImage;
    const categoriesList = Array.isArray(categories) ? categories : [];
    const maxRegions = 6;
    const listHtml = categoriesList.map((category) => {
        const categoryLabel = typeof category?.label === 'string' && category.label.trim()
            ? category.label.trim()
            : 'Kategori';
        const categorySlug = slugifyText(category?.slug || categoryLabel);
        if (!categorySlug) {
            return '';
        }
        const categoryCount = Number(category?.count) || 0;
        const countLabel = `${categoryCount} pin`;
        let regionList = [];
        if (regionsByCategory instanceof Map) {
            regionList = regionsByCategory.get(categorySlug) || [];
        } else if (regionsByCategory && Array.isArray(regionsByCategory[categorySlug])) {
            regionList = regionsByCategory[categorySlug];
        }
        const allRegions = Array.isArray(regionList) ? regionList : [];
        const displayRegions = allRegions.slice(0, maxRegions);
        const regionHtml = allRegions.map((region) => {
            const regionLabel = typeof region?.label === 'string' && region.label.trim()
                ? region.label.trim()
                : 'Wilayah';
            const regionSlug = slugifyText(region?.slug || regionLabel);
            if (!regionSlug) {
                return '';
            }
            const regionCount = Number(region?.count) || 0;
            const regionCountLabel = regionCount ? `${regionCount} pin` : '';
            return `<a class="category-card-region" href="/kategori/${categorySlug}/${regionSlug}">
                <span class="category-card-region-name">${escapeHtml(regionLabel)}</span>
                ${regionCountLabel ? `<span class="category-card-region-count">${regionCountLabel}</span>` : ''}
            </a>`;
        }).filter(Boolean).join('');
        const moreCount = allRegions.length - displayRegions.length;
        const regionListClass = moreCount > 0
            ? 'category-card-region-list is-collapsed'
            : 'category-card-region-list is-full';
        const toggleHtml = moreCount > 0
            ? `<button type="button" class="category-card-toggle" data-more-count="${moreCount}" aria-expanded="false">+${moreCount} wilayah lain</button>`
            : '';
        const regionSection = regionHtml
            ? `<div class="category-card-regions">
                <div class="category-card-subtitle">Wilayah tersedia</div>
                <div class="${regionListClass}">${regionHtml}</div>
                ${toggleHtml}
            </div>`
            : '<div class="category-card-empty">Belum ada wilayah untuk kategori ini.</div>';
        return `<article class="category-card">
            <div class="category-card-top">
                <a class="category-card-link" href="/kategori/${categorySlug}">${escapeHtml(categoryLabel)}</a>
                <span class="category-card-count">${escapeHtml(countLabel)}</span>
            </div>
            ${regionSection}
        </article>`;
    }).filter(Boolean).join('');
    const pinList = Array.isArray(pins) ? pins : [];
    const pinDisplayCount = pinList.length;
    const pinListHtml = pinList
        .map((pin) => buildPinLandingListItem(pin, { includeCategory: true }))
        .filter(Boolean)
        .join('');
    const regionOptions = (Array.isArray(regions) ? regions : [])
        .map((region) => {
            const regionLabel = typeof region?.label === 'string' && region.label.trim()
                ? region.label.trim()
                : '';
            const regionSlug = slugifyText(region?.slug || regionLabel);
            if (!regionLabel || !regionSlug) {
                return '';
            }
            const countLabel = Number(region?.count) ? ` (${region.count})` : '';
            return `<option value="${escapeHtml(regionSlug)}">${escapeHtml(regionLabel)}${countLabel}</option>`;
        })
        .filter(Boolean)
        .join('');
    const structuredData = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: heading,
        itemListElement: categoriesList.map((category, index) => {
            const categoryLabel = typeof category?.label === 'string' && category.label.trim()
                ? category.label.trim()
                : 'Kategori';
            const categorySlug = slugifyText(category?.slug || categoryLabel);
            if (!categorySlug) {
                return null;
            }
            return {
                '@type': 'ListItem',
                position: index + 1,
                url: baseUrl ? `${baseUrl}/kategori/${categorySlug}` : `/kategori/${categorySlug}`,
                name: categoryLabel
            };
        }).filter(Boolean)
    };

    return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(metaDescription)}">
  <meta name="robots" content="${robots}">
  ${seo?.googleSiteVerification ? `<meta name="google-site-verification" content="${escapeHtml(seo.googleSiteVerification)}">` : ''}
  ${canonicalUrl ? `<link rel="canonical" href="${canonicalUrl}">` : ''}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(metaDescription)}">
  ${canonicalUrl ? `<meta property="og:url" content="${canonicalUrl}">` : ''}
  ${ogImage ? `<meta property="og:image" content="${ogImage}">` : ''}
  <meta name="twitter:card" content="${twitterImage ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}">
  <meta name="twitter:description" content="${escapeHtml(metaDescription)}">
  ${twitterImage ? `<meta name="twitter:image" content="${twitterImage}">` : ''}
  <link rel="stylesheet" href="/style.css">
  <style>
    body.pin-landing-page {
      overflow-y: auto;
    }
    .pin-landing-bg {
      position: fixed;
      inset: 0;
      background:
        radial-gradient(circle at top right, rgba(59, 130, 246, 0.22), transparent 50%),
        radial-gradient(circle at 15% 20%, rgba(14, 165, 233, 0.18), transparent 45%),
        linear-gradient(160deg, rgba(15, 23, 42, 0.9), rgba(2, 6, 23, 0.92));
      z-index: 0;
    }
    .pin-landing-shell {
      position: relative;
      z-index: 1;
      min-height: 100vh;
      padding: clamp(20px, 5vw, 56px);
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .pin-landing-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .pin-landing-brand {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      text-decoration: none;
      color: var(--app-text-strong);
      font-weight: 800;
      letter-spacing: -0.01em;
      font-size: 18px;
    }
    .pin-landing-brand img {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      border: 1px solid var(--app-panel-border);
      background: rgba(15, 23, 42, 0.6);
      padding: 6px;
    }
    .pin-landing-back {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border-radius: 999px;
      border: 1px solid var(--app-card-border);
      background: var(--app-card-bg);
      color: var(--app-text);
      font-size: 12px;
      font-weight: 700;
      text-decoration: none;
      white-space: nowrap;
    }
    .pin-landing-back:hover {
      border-color: var(--app-accent);
      color: var(--app-text-strong);
    }
    .pin-landing-hero {
      background: var(--app-panel-bg);
      border: 1px solid var(--app-panel-border);
      border-radius: var(--app-panel-radius);
      padding: clamp(20px, 4vw, 28px);
      box-shadow: var(--app-panel-shadow);
      backdrop-filter: var(--app-panel-blur);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .pin-landing-chip {
      align-self: flex-start;
      background: var(--app-chip-bg);
      border: 1px solid var(--app-chip-border);
      color: var(--app-text-soft);
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 700;
    }
    .pin-landing-title {
      margin: 0;
      font-size: clamp(26px, 3.2vw, 42px);
      color: var(--app-text-strong);
    }
    .pin-landing-intro {
      margin: 0;
      font-size: 15px;
      line-height: 1.6;
      color: var(--app-text);
    }
    .pin-landing-count {
      font-size: 12px;
      font-weight: 700;
      color: var(--app-text-soft);
      background: var(--app-card-bg);
      border: 1px solid var(--app-card-border);
      border-radius: 12px;
      padding: 8px 12px;
      width: fit-content;
    }
    .pin-landing-list-card {
      background: var(--app-panel-bg);
      border: 1px solid var(--app-panel-border);
      border-radius: var(--app-panel-radius);
      padding: clamp(18px, 3vw, 24px);
      box-shadow: var(--app-panel-shadow);
      backdrop-filter: var(--app-panel-blur);
    }
    .pin-landing-section-head {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 16px;
    }
    .pin-landing-section-title {
      margin: 0;
      font-size: 18px;
      color: var(--app-text-strong);
    }
    .pin-landing-section-subtitle {
      margin: 0;
      font-size: 13px;
      color: var(--app-text-soft);
    }
    .category-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 16px;
    }
    .category-card {
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: var(--app-card-bg);
      border: 1px solid var(--app-card-border);
      border-radius: 16px;
      padding: 16px;
      box-shadow: var(--app-card-shadow);
      min-height: 180px;
    }
    .category-card-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }
    .category-card-link {
      font-size: 16px;
      font-weight: 700;
      color: var(--app-text-strong);
      text-decoration: none;
    }
    .category-card-link:hover {
      color: var(--app-accent);
    }
    .category-card-count {
      font-size: 11px;
      font-weight: 700;
      color: var(--app-text-soft);
      border: 1px solid var(--app-card-border);
      background: rgba(15, 23, 42, 0.5);
      padding: 6px 10px;
      border-radius: 999px;
      white-space: nowrap;
    }
    .category-card-regions {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .category-card-subtitle {
      font-size: 11px;
      font-weight: 700;
      color: var(--app-text-soft);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .category-card-region-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      max-height: 96px;
      overflow: hidden;
    }
    .category-card-region-list.is-full {
      max-height: none;
      overflow: visible;
    }
    .category-card.is-expanded .category-card-region-list {
      max-height: 220px;
      overflow-y: auto;
      padding-right: 4px;
    }
    .category-card-region {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--app-panel-border);
      background: rgba(15, 23, 42, 0.35);
      color: var(--app-text);
      font-size: 12px;
      text-decoration: none;
    }
    .category-card-region:hover {
      border-color: var(--app-accent);
      color: var(--app-text-strong);
    }
    .category-card-region-count {
      font-size: 11px;
      color: var(--app-text-soft);
    }
    .category-card-toggle {
      align-self: flex-start;
      font-size: 12px;
      color: var(--app-text-soft);
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
    }
    .category-card-toggle:hover {
      color: var(--app-text-strong);
    }
    .category-card-empty {
      font-size: 13px;
      color: var(--app-text-soft);
    }
    .category-empty {
      padding: 16px;
      border-radius: 12px;
      border: 1px dashed var(--app-card-border);
      color: var(--app-text-soft);
      font-size: 14px;
    }
    .pin-landing-filters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }
    .pin-landing-filter {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .pin-landing-filter label {
      font-size: 11px;
      font-weight: 700;
      color: var(--app-text-soft);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .pin-landing-filter input,
    .pin-landing-filter select {
      border-radius: 12px;
      border: 1px solid var(--app-card-border);
      background: var(--app-card-bg);
      color: var(--app-text);
      padding: 10px 12px;
      font-size: 13px;
    }
    .pin-landing-filter input::placeholder {
      color: var(--app-text-muted);
    }
    .pin-landing-filter-range {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pin-landing-filter-range span {
      font-size: 12px;
      color: var(--app-text-muted);
    }
    .pin-landing-filter-summary {
      font-size: 12px;
      color: var(--app-text-muted);
      margin-bottom: 14px;
    }
    .pin-landing-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 14px;
    }
    .pin-landing-item {
      background: var(--app-card-bg);
      border: 1px solid var(--app-card-border);
      border-radius: 14px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-shadow: var(--app-card-shadow);
    }
    .pin-landing-link {
      text-decoration: none;
      font-weight: 800;
      color: var(--app-text-strong);
      font-size: 16px;
    }
    .pin-landing-link:hover,
    .pin-landing-link:focus-visible {
      color: var(--app-accent);
      outline: none;
    }
    .pin-landing-meta {
      font-size: 12px;
      color: var(--app-text-muted);
    }
    .pin-landing-desc {
      margin: 0;
      font-size: 13px;
      color: var(--app-text);
      line-height: 1.5;
    }
    .pin-landing-empty {
      padding: 16px;
      border-radius: 12px;
      border: 1px dashed var(--app-card-border);
      color: var(--app-text-soft);
      font-size: 14px;
      text-align: center;
    }
  </style>
  <script type="application/ld+json">${JSON.stringify(structuredData)}</script>
</head>
<body class="pin-landing-page">
  <div class="pin-landing-bg"></div>
  <div class="pin-landing-shell">
    <header class="pin-landing-header">
      <a class="pin-landing-brand" href="${baseUrl ? `${baseUrl}/` : '/'}">
        <img src="/icon-192.png" alt="AyaNaon">
        <span>AyaNaon</span>
      </a>
      <a class="pin-landing-back" href="${backHref}">${backLabel}</a>
    </header>
    <section class="pin-landing-hero">
      <span class="pin-landing-chip">Kategori</span>
      <h1 class="pin-landing-title">${escapeHtml(heading)}</h1>
      <p class="pin-landing-intro">${escapeHtml(introText)}</p>
      <span class="pin-landing-count">${totalCount} pin tersedia</span>
    </section>
      <section class="pin-landing-list-card">
        <div class="pin-landing-section-head">
          <h2 class="pin-landing-section-title">Pilih kategori</h2>
          <p class="pin-landing-section-subtitle">Gunakan kategori dan wilayah untuk menemukan pin.</p>
        </div>
        <div class="category-grid">
        ${listHtml || '<div class="category-empty">Belum ada kategori untuk ditampilkan.</div>'}
        </div>
      </section>
      <section class="pin-landing-list-card">
        <div class="pin-landing-section-head">
          <h2 class="pin-landing-section-title">Cari pin</h2>
          <p class="pin-landing-section-subtitle">Gunakan pencarian, wilayah, dan rentang tanggal untuk menyaring pin.</p>
        </div>
        <div class="pin-landing-filters" data-pin-filter>
          <div class="pin-landing-filter">
            <label for="pin-filter-search">Search</label>
            <input type="search" id="pin-filter-search" placeholder="Cari judul, kategori, atau kota" aria-label="Cari pin">
          </div>
          <div class="pin-landing-filter">
            <label for="pin-filter-region">Region</label>
            <select id="pin-filter-region" aria-label="Filter wilayah">
              <option value="">Semua wilayah</option>
              ${regionOptions}
            </select>
          </div>
          <div class="pin-landing-filter">
            <label for="pin-filter-start">Range tanggal</label>
            <div class="pin-landing-filter-range">
              <input type="date" id="pin-filter-start" aria-label="Tanggal mulai">
              <span>-</span>
              <input type="date" id="pin-filter-end" aria-label="Tanggal akhir">
            </div>
          </div>
        </div>
        <div class="pin-landing-filter-summary" id="pin-filter-summary"></div>
        <ul class="pin-landing-list" id="pin-filter-list">
          ${pinListHtml}
        </ul>
        <p class="pin-landing-empty" id="pin-filter-empty"${pinDisplayCount ? ' hidden' : ''}>Belum ada pin untuk ditampilkan.</p>
        ${totalCount > pinDisplayCount ? `<p class="pin-landing-intro">Menampilkan ${pinDisplayCount} dari ${totalCount} pin.</p>` : ''}
      </section>
    </div>
    <script>
      (function () {
        var buttons = document.querySelectorAll('.category-card-toggle');
        for (var i = 0; i < buttons.length; i += 1) {
          buttons[i].addEventListener('click', function (event) {
            var button = event.currentTarget;
            var card = button.closest('.category-card');
            if (!card) {
              return;
            }
            var expanded = card.classList.toggle('is-expanded');
            button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            var moreCount = button.getAttribute('data-more-count') || '0';
            button.textContent = expanded
              ? 'Sembunyikan wilayah'
              : ('+' + moreCount + ' wilayah lain');
          });
        }

        var filterContainer = document.querySelector('[data-pin-filter]');
        if (!filterContainer) {
          return;
        }
        var searchInput = document.getElementById('pin-filter-search');
        var regionSelect = document.getElementById('pin-filter-region');
        var startInput = document.getElementById('pin-filter-start');
        var endInput = document.getElementById('pin-filter-end');
        var list = document.getElementById('pin-filter-list');
        var items = list ? list.querySelectorAll('.pin-landing-item') : [];
        var emptyEl = document.getElementById('pin-filter-empty');
        var summaryEl = document.getElementById('pin-filter-summary');

        function normalize(value) {
          return (value || '').toString().toLowerCase().trim();
        }

        function parseDate(value) {
          if (!value) {
            return null;
          }
          var parts = value.split('-');
          if (parts.length !== 3) {
            return null;
          }
          var year = parseInt(parts[0], 10);
          var month = parseInt(parts[1], 10);
          var day = parseInt(parts[2], 10);
          if (!year || !month || !day) {
            return null;
          }
          return new Date(year, month - 1, day);
        }

        function matchesDate(itemStart, itemEnd, filterStart, filterEnd) {
          if (!filterStart && !filterEnd) {
            return true;
          }
          var pinStart = parseDate(itemStart);
          var pinEnd = parseDate(itemEnd || itemStart);
          if (!pinStart && !pinEnd) {
            return false;
          }
          if (filterStart && pinEnd && pinEnd < filterStart) {
            return false;
          }
          if (filterEnd && pinStart && pinStart > filterEnd) {
            return false;
          }
          return true;
        }

        function applyFilters() {
          var query = normalize(searchInput && searchInput.value);
          var region = regionSelect ? regionSelect.value : '';
          var startDate = parseDate(startInput && startInput.value);
          var endDate = parseDate(endInput && endInput.value);
          if (startDate && !endDate) {
            endDate = startDate;
          }
          if (endDate && !startDate) {
            startDate = endDate;
          }
          var visibleCount = 0;
          for (var i = 0; i < items.length; i += 1) {
            var item = items[i];
            var searchText = normalize(item.getAttribute('data-search'));
            var matchesSearch = !query || searchText.indexOf(query) !== -1;
            var itemRegion = item.getAttribute('data-region') || '';
            var matchesRegion = !region || itemRegion === region;
            var itemStart = item.getAttribute('data-start') || '';
            var itemEnd = item.getAttribute('data-end') || itemStart;
            var matchesRange = matchesDate(itemStart, itemEnd, startDate, endDate);
            var isVisible = matchesSearch && matchesRegion && matchesRange;
            item.style.display = isVisible ? '' : 'none';
            if (isVisible) {
              visibleCount += 1;
            }
          }
          if (summaryEl) {
            if (!items.length) {
              summaryEl.textContent = 'Belum ada pin untuk ditampilkan.';
            } else {
              summaryEl.textContent = 'Menampilkan ' + visibleCount + ' dari ' + items.length + ' pin.';
            }
          }
          if (emptyEl) {
            emptyEl.hidden = visibleCount !== 0;
          }
        }

        if (searchInput) {
          searchInput.addEventListener('input', applyFilters);
        }
        if (regionSelect) {
          regionSelect.addEventListener('change', applyFilters);
        }
        if (startInput) {
          startInput.addEventListener('change', applyFilters);
        }
        if (endInput) {
          endInput.addEventListener('change', applyFilters);
        }
        applyFilters();
      })();
    </script>
  </body>
  </html>`;
}

function buildCategoryLandingHtml({
    seo,
    baseUrl,
    categoryLabel,
    regionLabel,
    categorySlug,
    regionSlug,
    pins,
    totalCount,
    regions
}) {
    const heading = regionLabel
        ? `${categoryLabel} di ${regionLabel}`
        : categoryLabel;
    const pageTitle = truncateText(
        [heading, seo?.title || ''].filter(Boolean).join(' | '),
        70
    );
    const introText = `Temukan ${totalCount} pin ${heading} di AyaNaon. Klik salah satu pin untuk melihat detail.`;
    const metaDescription = truncateText(introText, 160);
    const canonicalPath = regionSlug
        ? `/kategori/${categorySlug}/${regionSlug}`
        : `/kategori/${categorySlug}`;
    const canonicalUrl = baseUrl ? `${baseUrl}${canonicalPath}` : '';
    const backHref = regionSlug
        ? `/kategori/${categorySlug}`
        : '/kategori';
    const backLabel = regionSlug
        ? 'Kembali ke kategori'
        : 'Kembali ke semua kategori';
    const robots = `${seo?.robotsIndex !== false ? 'index' : 'noindex'},${seo?.robotsFollow !== false ? 'follow' : 'nofollow'}`;
    const ogImage = seo?.ogImage || (baseUrl ? `${baseUrl}/icon-512.png` : '');
    const twitterImage = seo?.twitterImage || ogImage;
    const pinList = Array.isArray(pins) ? pins : [];
    const displayCount = pinList.length;
    const listHtml = pinList
        .map((pin) => buildPinLandingListItem(pin))
        .filter(Boolean)
        .join('');
    const regionOptions = (Array.isArray(regions) ? regions : [])
        .map((region) => {
            const regionLabel = typeof region?.label === 'string' && region.label.trim()
                ? region.label.trim()
                : '';
            const regionSlug = slugifyText(region?.slug || regionLabel);
            if (!regionLabel || !regionSlug) {
                return '';
            }
            const countLabel = Number(region?.count) ? ` (${region.count})` : '';
            return `<option value="${escapeHtml(regionSlug)}">${escapeHtml(regionLabel)}${countLabel}</option>`;
        })
        .filter(Boolean)
        .join('');
    const structuredData = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: heading,
        itemListElement: (pins || []).map((pin, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            url: baseUrl ? `${baseUrl}/pin/${pin._id}` : `/pin/${pin._id}`,
            name: typeof pin?.title === 'string' && pin.title.trim() ? pin.title.trim() : 'Pin tanpa judul'
        }))
    };

    return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(metaDescription)}">
  <meta name="robots" content="${robots}">
  ${seo?.googleSiteVerification ? `<meta name="google-site-verification" content="${escapeHtml(seo.googleSiteVerification)}">` : ''}
  ${canonicalUrl ? `<link rel="canonical" href="${canonicalUrl}">` : ''}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(metaDescription)}">
  ${canonicalUrl ? `<meta property="og:url" content="${canonicalUrl}">` : ''}
  ${ogImage ? `<meta property="og:image" content="${ogImage}">` : ''}
  <meta name="twitter:card" content="${twitterImage ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}">
  <meta name="twitter:description" content="${escapeHtml(metaDescription)}">
  ${twitterImage ? `<meta name="twitter:image" content="${twitterImage}">` : ''}
  <link rel="stylesheet" href="/style.css">
  <style>
    body.pin-landing-page {
      overflow-y: auto;
    }
    .pin-landing-bg {
      position: fixed;
      inset: 0;
      background:
        radial-gradient(circle at top right, rgba(59, 130, 246, 0.22), transparent 50%),
        radial-gradient(circle at 15% 20%, rgba(14, 165, 233, 0.18), transparent 45%),
        linear-gradient(160deg, rgba(15, 23, 42, 0.9), rgba(2, 6, 23, 0.92));
      z-index: 0;
    }
    .pin-landing-shell {
      position: relative;
      z-index: 1;
      min-height: 100vh;
      padding: clamp(20px, 5vw, 56px);
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .pin-landing-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .pin-landing-brand {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      text-decoration: none;
      color: var(--app-text-strong);
      font-weight: 800;
      letter-spacing: -0.01em;
      font-size: 18px;
    }
      .pin-landing-brand img {
        width: 42px;
        height: 42px;
        border-radius: 12px;
        border: 1px solid var(--app-panel-border);
        background: rgba(15, 23, 42, 0.6);
        padding: 6px;
      }
      .pin-landing-back {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        border-radius: 999px;
        border: 1px solid var(--app-card-border);
        background: var(--app-card-bg);
        color: var(--app-text);
        font-size: 12px;
        font-weight: 700;
        text-decoration: none;
        white-space: nowrap;
      }
      .pin-landing-back:hover {
        border-color: var(--app-accent);
        color: var(--app-text-strong);
      }
      .pin-landing-hero {
        background: var(--app-panel-bg);
        border: 1px solid var(--app-panel-border);
        border-radius: var(--app-panel-radius);
        padding: clamp(20px, 4vw, 28px);
      box-shadow: var(--app-panel-shadow);
      backdrop-filter: var(--app-panel-blur);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .pin-landing-chip {
      align-self: flex-start;
      background: var(--app-chip-bg);
      border: 1px solid var(--app-chip-border);
      color: var(--app-text-soft);
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 700;
    }
    .pin-landing-title {
      margin: 0;
      font-size: clamp(26px, 3.2vw, 42px);
      color: var(--app-text-strong);
    }
    .pin-landing-intro {
      margin: 0;
      font-size: 15px;
      line-height: 1.6;
      color: var(--app-text);
    }
    .pin-landing-count {
      font-size: 12px;
      font-weight: 700;
      color: var(--app-text-soft);
      background: var(--app-card-bg);
      border: 1px solid var(--app-card-border);
      border-radius: 12px;
      padding: 8px 12px;
      width: fit-content;
    }
    .pin-landing-list-card {
      background: var(--app-panel-bg);
      border: 1px solid var(--app-panel-border);
      border-radius: var(--app-panel-radius);
      padding: clamp(18px, 3vw, 24px);
      box-shadow: var(--app-panel-shadow);
      backdrop-filter: var(--app-panel-blur);
    }
    .pin-landing-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 14px;
    }
    .pin-landing-item {
      background: var(--app-card-bg);
      border: 1px solid var(--app-card-border);
      border-radius: 14px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-shadow: var(--app-card-shadow);
    }
    .pin-landing-link {
      text-decoration: none;
      font-weight: 800;
      color: var(--app-text-strong);
      font-size: 16px;
    }
    .pin-landing-link:hover,
    .pin-landing-link:focus-visible {
      color: var(--app-accent);
      outline: none;
    }
    .pin-landing-meta {
      font-size: 12px;
      color: var(--app-text-muted);
    }
    .pin-landing-desc {
      margin: 0;
      font-size: 13px;
      color: var(--app-text);
      line-height: 1.5;
    }
    .pin-landing-filters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }
    .pin-landing-filter {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .pin-landing-filter label {
      font-size: 11px;
      font-weight: 700;
      color: var(--app-text-soft);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .pin-landing-filter input,
    .pin-landing-filter select {
      border-radius: 12px;
      border: 1px solid var(--app-card-border);
      background: var(--app-card-bg);
      color: var(--app-text);
      padding: 10px 12px;
      font-size: 13px;
    }
    .pin-landing-filter input::placeholder {
      color: var(--app-text-muted);
    }
    .pin-landing-filter-range {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pin-landing-filter-range span {
      font-size: 12px;
      color: var(--app-text-muted);
    }
    .pin-landing-filter-summary {
      font-size: 12px;
      color: var(--app-text-muted);
      margin-bottom: 14px;
    }
    .pin-landing-empty {
      padding: 16px;
      border-radius: 12px;
      border: 1px dashed var(--app-card-border);
      color: var(--app-text-soft);
      font-size: 14px;
      text-align: center;
      margin-top: 12px;
    }
    .pin-landing-section-head {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 16px;
    }
    .pin-landing-section-title {
      margin: 0;
      font-size: 18px;
      color: var(--app-text-strong);
    }
    .pin-landing-section-subtitle {
      margin: 0;
      font-size: 13px;
      color: var(--app-text-soft);
    }
    .pin-landing-footer {
      margin-top: auto;
      text-align: center;
      font-size: 12px;
      color: var(--app-text-muted);
    }
  </style>
  <script type="application/ld+json">${JSON.stringify(structuredData)}</script>
</head>
<body class="pin-landing-page">
  <div class="pin-landing-bg"></div>
  <div class="pin-landing-shell">
  <header class="pin-landing-header">
    <a class="pin-landing-brand" href="${baseUrl ? `${baseUrl}/` : '/'}">
      <img src="/icon-192.png" alt="AyaNaon">
      <span>AyaNaon</span>
    </a>
    <a class="pin-landing-back" href="${backHref}">${backLabel}</a>
  </header>
    <section class="pin-landing-hero">
      <span class="pin-landing-chip">Kategori</span>
      <h1 class="pin-landing-title">${escapeHtml(heading)}</h1>
      <p class="pin-landing-intro">${escapeHtml(introText)}</p>
      <span class="pin-landing-count">${totalCount} pin tersedia</span>
    </section>
    <section class="pin-landing-list-card">
      <div class="pin-landing-section-head">
        <h2 class="pin-landing-section-title">Daftar pin</h2>
        <p class="pin-landing-section-subtitle">Gunakan pencarian, wilayah, dan rentang tanggal untuk menyaring pin.</p>
      </div>
      <div class="pin-landing-filters" data-pin-filter data-default-region="${escapeHtml(regionSlug || '')}">
        <div class="pin-landing-filter">
          <label for="pin-filter-search">Search</label>
          <input type="search" id="pin-filter-search" placeholder="Cari judul, deskripsi, atau kota" aria-label="Cari pin">
        </div>
        <div class="pin-landing-filter">
          <label for="pin-filter-region">Region</label>
          <select id="pin-filter-region" aria-label="Filter wilayah">
            <option value="">Semua wilayah</option>
            ${regionOptions}
          </select>
        </div>
        <div class="pin-landing-filter">
          <label for="pin-filter-start">Range tanggal</label>
          <div class="pin-landing-filter-range">
            <input type="date" id="pin-filter-start" aria-label="Tanggal mulai">
            <span>-</span>
            <input type="date" id="pin-filter-end" aria-label="Tanggal akhir">
          </div>
        </div>
      </div>
      <div class="pin-landing-filter-summary" id="pin-filter-summary"></div>
      <ul class="pin-landing-list" id="pin-filter-list">
        ${listHtml}
      </ul>
      <p class="pin-landing-empty" id="pin-filter-empty"${displayCount ? ' hidden' : ''}>Belum ada pin untuk kategori ini.</p>
      ${totalCount > displayCount ? `<p class="pin-landing-intro">Menampilkan ${displayCount} dari ${totalCount} pin. Lihat peta AyaNaon untuk jelajah lebih lengkap.</p>` : ''}
    </section>
    <footer class="pin-landing-footer">AyaNaon category page</footer>
  </div>
  <script>
    (function () {
      var filterContainer = document.querySelector('[data-pin-filter]');
      if (!filterContainer) {
        return;
      }
      var searchInput = document.getElementById('pin-filter-search');
      var regionSelect = document.getElementById('pin-filter-region');
      var startInput = document.getElementById('pin-filter-start');
      var endInput = document.getElementById('pin-filter-end');
      var list = document.getElementById('pin-filter-list');
      var items = list ? list.querySelectorAll('.pin-landing-item') : [];
      var emptyEl = document.getElementById('pin-filter-empty');
      var summaryEl = document.getElementById('pin-filter-summary');

      function normalize(value) {
        return (value || '').toString().toLowerCase().trim();
      }

      function parseDate(value) {
        if (!value) {
          return null;
        }
        var parts = value.split('-');
        if (parts.length !== 3) {
          return null;
        }
        var year = parseInt(parts[0], 10);
        var month = parseInt(parts[1], 10);
        var day = parseInt(parts[2], 10);
        if (!year || !month || !day) {
          return null;
        }
        return new Date(year, month - 1, day);
      }

      function matchesDate(itemStart, itemEnd, filterStart, filterEnd) {
        if (!filterStart && !filterEnd) {
          return true;
        }
        var pinStart = parseDate(itemStart);
        var pinEnd = parseDate(itemEnd || itemStart);
        if (!pinStart && !pinEnd) {
          return false;
        }
        if (filterStart && pinEnd && pinEnd < filterStart) {
          return false;
        }
        if (filterEnd && pinStart && pinStart > filterEnd) {
          return false;
        }
        return true;
      }

      function applyFilters() {
        var query = normalize(searchInput && searchInput.value);
        var region = regionSelect ? regionSelect.value : '';
        var startDate = parseDate(startInput && startInput.value);
        var endDate = parseDate(endInput && endInput.value);
        if (startDate && !endDate) {
          endDate = startDate;
        }
        if (endDate && !startDate) {
          startDate = endDate;
        }
        var visibleCount = 0;
        for (var i = 0; i < items.length; i += 1) {
          var item = items[i];
          var searchText = normalize(item.getAttribute('data-search'));
          var matchesSearch = !query || searchText.indexOf(query) !== -1;
          var itemRegion = item.getAttribute('data-region') || '';
          var matchesRegion = !region || itemRegion === region;
          var itemStart = item.getAttribute('data-start') || '';
          var itemEnd = item.getAttribute('data-end') || itemStart;
          var matchesRange = matchesDate(itemStart, itemEnd, startDate, endDate);
          var isVisible = matchesSearch && matchesRegion && matchesRange;
          item.style.display = isVisible ? '' : 'none';
          if (isVisible) {
            visibleCount += 1;
          }
        }
        if (summaryEl) {
          if (!items.length) {
            summaryEl.textContent = 'Belum ada pin untuk ditampilkan.';
          } else {
            summaryEl.textContent = 'Menampilkan ' + visibleCount + ' dari ' + items.length + ' pin.';
          }
        }
        if (emptyEl) {
          emptyEl.hidden = visibleCount !== 0;
        }
      }

      var defaultRegion = filterContainer.getAttribute('data-default-region') || '';
      if (regionSelect && defaultRegion) {
        regionSelect.value = defaultRegion;
      }
      if (searchInput) {
        searchInput.addEventListener('input', applyFilters);
      }
      if (regionSelect) {
        regionSelect.addEventListener('change', applyFilters);
      }
      if (startInput) {
        startInput.addEventListener('change', applyFilters);
      }
      if (endInput) {
        endInput.addEventListener('change', applyFilters);
      }
      applyFilters();
    })();
  </script>
</body>
</html>`;
}

async function authenticateRequest(req, res) {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
        res.status(401).json({ message: 'Token tidak ditemukan.' });
        return null;
    }
    const token = authHeader.slice(7);
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (!payload?.sub) {
            res.status(401).json({ message: 'Token tidak valid.' });
            return null;
        }
        const sellers = await getSellersCollection();
        const seller = await sellers.findOne({ _id: new ObjectId(payload.sub) });
        if (!seller) {
            res.status(401).json({ message: 'Token tidak dikenal.' });
            return null;
        }
        return seller;
    } catch (error) {
        console.error('Authentication failed', error);
        res.status(401).json({ message: 'Token tidak valid.' });
        return null;
    }
}

function createResidentToken(resident) {
    if (!resident?._id) {
        throw new Error('Resident document tidak valid.');
    }
    const role = getResidentRole(resident);
    return jwt.sign(
        {
            sub: resident._id.toString(),
            role,
            username: resident.username
        },
        JWT_SECRET,
        { expiresIn: '30d' }
    );
}

async function authenticateResidentRequest(req, res, options = {}) {
    const { optional = false } = options;
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
        if (!optional) {
            res.status(401).json({ message: 'Token tidak ditemukan.' });
        }
        return null;
    }
    const token = authHeader.slice(7);
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        const allowedRoles = new Set([RESIDENT_ROLE_RESIDENT, RESIDENT_ROLE_ADMIN, RESIDENT_ROLE_PIN_MANAGER, undefined]);
        if (!payload?.sub || (payload.role && !allowedRoles.has(payload.role))) {
            res.status(401).json({ message: 'Token tidak valid.' });
            return null;
        }
        const residents = await getResidentsCollection();
        const resident = await residents.findOne({ _id: new ObjectId(payload.sub) });
        if (!resident) {
            res.status(401).json({ message: 'Token tidak dikenal.' });
            return null;
        }
        const role = getResidentRole(resident);
        return {
            ...resident,
            isAdmin: role === RESIDENT_ROLE_ADMIN,
            isPinManager: role === RESIDENT_ROLE_PIN_MANAGER,
            role
        };
    } catch (error) {
        console.error('Resident authentication failed', error);
        res.status(401).json({ message: 'Token tidak valid.' });
        return null;
    }
}

router.post('/residents/register', async (req, res) => {
    try {
        const { username, password, displayName, photo } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ message: 'Username dan password wajib diisi.' });
        }
        const usernameTrimmed = String(username).trim();
        if (!usernameTrimmed) {
            return res.status(400).json({ message: 'Username tidak boleh kosong.' });
        }
        if (String(password).length < 4) {
            return res.status(400).json({ message: 'Password minimal 4 karakter.' });
        }

        const residents = await getResidentsCollection();
        const usernameLower = usernameTrimmed.toLowerCase();
        const existing = await residents.findOne({ usernameLower });
        if (existing) {
            return res.status(409).json({ message: 'Username sudah digunakan warga lain.' });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        let parsedPhoto = null;
        try {
            parsedPhoto = parseResidentPhoto(photo);
        } catch (error) {
            return res.status(400).json({ message: error.message || 'Foto profil tidak dapat diproses.' });
        }
        const now = new Date();
        const residentDoc = {
            username: usernameTrimmed,
            usernameLower,
            passwordHash,
            displayName: String(displayName || '').trim() || usernameTrimmed,
            role: RESIDENT_ROLE_RESIDENT,
            statusMessage: '',
            badgesGiven: 0,
            savedPins: [],
            shareLocation: false,
            lastLocation: null,
            createdAt: now,
            updatedAt: now,
            lastLoginAt: now
        };
        if (parsedPhoto) {
            residentDoc.photo = parsedPhoto;
        }

        const insertResult = await residents.insertOne(residentDoc);
        const inserted = await residents.findOne({ _id: insertResult.insertedId });
        if (!inserted) {
            return res.status(500).json({ message: 'Registrasi gagal. Coba lagi.' });
        }

        const token = createResidentToken(inserted);
        res.status(201).json({
            message: 'Registrasi berhasil.',
            token,
            resident: sanitizeResident(inserted)
        });
    } catch (error) {
        console.error('Failed to register resident', error);
        res.status(500).json({ message: 'Gagal mendaftarkan warga. Coba lagi.' });
    }
});

router.post('/residents/login', async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ message: 'Username dan password wajib diisi.' });
        }
        const residents = await getResidentsCollection();
        const usernameLower = String(username).trim().toLowerCase();
        const resident = await residents.findOne({ usernameLower });
        if (!resident) {
            return res.status(401).json({ message: 'Username atau password tidak cocok.' });
        }
        const isMatch = await bcrypt.compare(password, resident.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Username atau password tidak cocok.' });
        }
        const now = new Date();
        await residents.updateOne({ _id: resident._id }, { $set: { lastLoginAt: now, updatedAt: now } });
        const fresh = await residents.findOne({ _id: resident._id }) || resident;
        const token = createResidentToken(fresh);
        res.json({
            message: 'Login berhasil.',
            token,
            resident: sanitizeResident(fresh)
        });
    } catch (error) {
        console.error('Failed to login resident', error);
        res.status(500).json({ message: 'Gagal masuk. Coba lagi.' });
    }
});

router.get('/residents/me', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    res.json({ resident: sanitizeResident(resident) });
});

router.put('/residents/me', async (req, res) => {
    try {
        const resident = await authenticateResidentRequest(req, res);
        if (!resident) return;
        const residents = await getResidentsCollection();
        const payload = req.body || {};
        const { displayName, photo, removePhoto } = payload;
        const { statusMessage, savedPins } = payload;
        const setFields = {};
        const unsetFields = {};
        let hasChanges = false;

        if (Object.prototype.hasOwnProperty.call(payload, 'displayName')) {
            if (typeof displayName !== 'string') {
                return res.status(400).json({ message: 'Nama tampilan tidak valid.' });
            }
            const trimmedName = displayName.trim();
            if (!trimmedName) {
                return res.status(400).json({ message: 'Nama tampilan tidak boleh kosong.' });
            }
            if (trimmedName.length > 60) {
                return res.status(400).json({ message: 'Nama tampilan maksimal 60 karakter.' });
            }
            setFields.displayName = trimmedName;
            hasChanges = true;
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'statusMessage')) {
            if (typeof statusMessage !== 'string') {
                return res.status(400).json({ message: 'Status tidak valid.' });
            }
            const trimmedStatus = statusMessage.trim();
            if (trimmedStatus.length > 30) {
                return res.status(400).json({ message: 'Status maksimal 30 karakter.' });
            }
            setFields.statusMessage = trimmedStatus;
            hasChanges = true;
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'savedPins')) {
            if (!Array.isArray(savedPins)) {
                return res.status(400).json({ message: 'Daftar pin tersimpan tidak valid.' });
            }
            const normalizedSavedPins = Array.from(
                new Set(
                    savedPins
                        .map((entry) => String(entry || '').trim())
                        .filter(Boolean)
                )
            );
            setFields.savedPins = normalizedSavedPins;
            hasChanges = true;
        }

        if (typeof photo === 'string' && photo.trim()) {
            try {
                setFields.photo = parseResidentPhoto(photo);
                hasChanges = true;
            } catch (error) {
                return res.status(400).json({ message: error.message || 'Foto profil tidak dapat diproses.' });
            }
        } else if (photo === null || photo === '') {
            unsetFields.photo = '';
            hasChanges = true;
        } else if (removePhoto === true) {
            unsetFields.photo = '';
            hasChanges = true;
        }

        if (!hasChanges) {
            return res.status(400).json({ message: 'Tidak ada perubahan data.' });
        }

        const now = new Date();
        setFields.updatedAt = now;

        const updateDoc = {};
        if (Object.keys(setFields).length) {
            updateDoc.$set = setFields;
        }
        if (Object.keys(unsetFields).length) {
            updateDoc.$unset = unsetFields;
        }

        await residents.updateOne({ _id: resident._id }, updateDoc);
        const updated = await residents.findOne({ _id: resident._id });
        res.json({
            message: 'Profil warga diperbarui.',
            resident: sanitizeResident(updated)
        });
    } catch (error) {
        console.error('Failed to update resident profile', error);
        res.status(500).json({ message: 'Gagal memperbarui profil warga. Coba lagi.' });
    }
});

router.post('/residents/share', async (req, res) => {
    try {
        const resident = await authenticateResidentRequest(req, res);
        if (!resident) return;
        const residents = await getResidentsCollection();
        const { shareLocation, lat, lng } = req.body || {};
        const now = new Date();

        const setFields = { updatedAt: now };
        const unsetFields = {};
        let locationProvided = false;

        const latProvided = lat !== undefined && lat !== null;
        const lngProvided = lng !== undefined && lng !== null;
        if (latProvided || lngProvided) {
            const latNum = Number(lat);
            const lngNum = Number(lng);
            if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
                return res.status(400).json({ message: 'Lokasi tidak valid.' });
            }
            setFields.lastLocation = { lat: latNum, lng: lngNum };
            locationProvided = true;
        }

        if (typeof shareLocation === 'boolean') {
            setFields.shareLocation = shareLocation;
            if (!shareLocation) {
                setFields.lastLocation = null;
            } else if (!locationProvided && (!resident.lastLocation || typeof resident.lastLocation !== 'object')) {
                return res.status(400).json({ message: 'Lokasi wajib diisi saat menyalakan berbagi lokasi.' });
            }
        }

        const updateDoc = {};
        if (Object.keys(setFields).length) {
            updateDoc.$set = setFields;
        }
        if (Object.keys(unsetFields).length) {
            updateDoc.$unset = unsetFields;
        }

        if (Object.keys(updateDoc).length) {
            await residents.updateOne({ _id: resident._id }, updateDoc);
        }

        const updated = await residents.findOne({ _id: resident._id });
        res.json({ resident: sanitizeResident(updated) });
    } catch (error) {
        console.error('Failed to update resident sharing', error);
        res.status(500).json({ message: 'Gagal memperbarui pengaturan lokasi warga.' });
    }
});

router.get('/residents/share', async (req, res) => {
    try {
        const residents = await getResidentsCollection();
        const docs = await residents
            .find(
                {
                    shareLocation: { $ne: false },
                    lastLocation: { $ne: null }
                },
                {
                    projection: {
                        username: 1,
                        displayName: 1,
                        badgesGiven: 1,
                        lastLocation: 1,
                        statusMessage: 1,
                        photo: 1
                    }
                }
            )
            .toArray();

        const payload = docs
            .map((doc) => sanitizeResident(doc))
            .filter((resident) => resident && resident.lastLocation)
            .map((resident) => ({
                username: resident.username,
                displayName: resident.displayName,
                badgesGiven: resident.badgesGiven,
                lastLocation: resident.lastLocation,
                statusMessage: resident.statusMessage || '',
                photo: resident.photo || null
            }));

        res.json({ residents: payload });
    } catch (error) {
        console.error('Failed to fetch shared residents', error);
        res.status(500).json({ message: 'Gagal mengambil lokasi warga.' });
    }
});

router.post('/residents/badges/increment', async (req, res) => {
    try {
        const resident = await authenticateResidentRequest(req, res);
        if (!resident) return;
        const residents = await getResidentsCollection();
        const result = await residents.findOneAndUpdate(
            { _id: resident._id },
            {
                $inc: { badgesGiven: 1 },
                $set: { updatedAt: new Date() }
            },
            { returnDocument: 'after' }
        );
        if (!result.value) {
            return res.status(404).json({ message: 'Warga tidak ditemukan.' });
        }
        const sanitized = sanitizeResident(result.value);
        res.json({
            badgesGiven: sanitized.badgesGiven,
            resident: sanitized
        });
    } catch (error) {
        console.error('Failed to increment resident badges', error);
        res.status(500).json({ message: 'Gagal memperbarui badge warga.' });
    }
});

router.post('/register-seller', async (req, res) => {
    try {
        const {
            username,
            password,
            nama,
            merk,
            deskripsi,
            phoneNumber,
            photo,
            menuPhotos,
            consent
        } = req.body || {};

        if (!username || !password || !nama || !merk || !deskripsi || !phoneNumber || typeof consent === 'undefined') {
            return res.status(400).json({ message: 'Semua kolom wajib diisi.' });
        }
        if (!consent) {
            return res.status(400).json({ message: 'Persetujuan wajib dicentang.' });
        }

        const usernameTrimmed = String(username).trim();
        if (!usernameTrimmed) {
            return res.status(400).json({ message: 'Username tidak boleh kosong.' });
        }
        const usernameLower = usernameTrimmed.toLowerCase();

        const sellers = await getSellersCollection();
        const existing = await sellers.findOne({ usernameLower });
        if (existing) {
            return res.status(409).json({ message: 'Username sudah digunakan.' });
        }

        const normalizedPhone = normalizePhoneNumber(phoneNumber);
        if (!normalizedPhone) {
            return res.status(400).json({ message: 'Nomor WhatsApp tidak valid. Gunakan format dengan kode negara, misal +628xxx.' });
        }

        let sellerPhoto;
        try {
            sellerPhoto = parseSellerPhoto(photo, { fieldLabel: 'Foto gerobak' });
        } catch (error) {
            return res.status(400).json({ message: error.message || 'Foto gerobak tidak valid.' });
        }

        let menuPhotoDocs = [];
        try {
            menuPhotoDocs = parseSellerMenuPhotos(menuPhotos || []);
        } catch (error) {
            return res.status(400).json({ message: error.message || 'Foto menu tidak valid.' });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const now = new Date();

        const sellerDoc = {
            username: usernameTrimmed,
            usernameLower,
            passwordHash,
            nama: String(nama).trim(),
            merk: String(merk).trim(),
            deskripsi: String(deskripsi).trim(),
            phoneNumber: normalizedPhone,
            consentAccepted: Boolean(consent),
            showPhone: false,
            photo: sellerPhoto,
            menuPhotos: menuPhotoDocs,
            isVerified: true,
            communityVerification: {
                votes: 0,
                voterIps: [],
                verifiedAt: null
            },
            liveStatus: {
                isLive: false
            },
            createdAt: now,
            updatedAt: now
        };

        await sellers.insertOne(sellerDoc);

        const responsePayload = {
            message: 'Registrasi berhasil. Gerobak Online kamu siap tampil!',
            requiresVerification: false
        };

        res.status(201).json(responsePayload);
    } catch (error) {
        console.error('Failed to register seller', error);
        res.status(500).json({ message: 'Gagal mendaftarkan penjual. Coba lagi beberapa saat.' });
    }
});

router.post('/verify-seller', async (req, res) => {
    res.json({ message: 'Akun Gerobak Online kini aktif tanpa verifikasi tambahan. Silakan langsung login.' });
});

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ message: 'Username dan password wajib diisi.' });
        }
        const usernameLower = String(username).trim().toLowerCase();
        const sellers = await getSellersCollection();
        const seller = await sellers.findOne({ usernameLower });
        if (!seller) {
            return res.status(401).json({ message: 'Username atau password salah.' });
        }
        const passwordMatches = await bcrypt.compare(password, seller.passwordHash);
        if (!passwordMatches) {
            return res.status(401).json({ message: 'Username atau password salah.' });
        }
        const token = jwt.sign(
            {
                sub: seller._id.toString(),
                username: seller.username
            },
            JWT_SECRET,
            { expiresIn: '12h' }
        );

        await sellers.updateOne({ _id: seller._id }, { $set: { lastLoginAt: new Date() } });

        res.json({
            token,
            seller: sanitizeSeller(seller)
        });
    } catch (error) {
        console.error('Login failed', error);
        res.status(500).json({ message: 'Gagal masuk. Silakan coba lagi.' });
    }
});

router.get('/sellers/me', async (req, res) => {
    const seller = await authenticateRequest(req, res);
    if (!seller) return;
    res.json({ seller: sanitizeSeller(seller) });
});

router.put('/sellers/me', async (req, res) => {
    const seller = await authenticateRequest(req, res);
    if (!seller) return;

    try {
        const payload = req.body || {};
        const { nama, merk, deskripsi, phoneNumber } = payload;

        if (typeof nama !== 'string' || !nama.trim()) {
            return res.status(400).json({ message: 'Nama gerobak wajib diisi.' });
        }
        if (typeof merk !== 'string' || !merk.trim()) {
            return res.status(400).json({ message: 'Brand atau menu utama wajib diisi.' });
        }
        if (typeof deskripsi !== 'string' || !deskripsi.trim()) {
            return res.status(400).json({ message: 'Deskripsi wajib diisi.' });
        }
        if (typeof phoneNumber !== 'string' || !phoneNumber.trim()) {
            return res.status(400).json({ message: 'Nomor WhatsApp wajib diisi.' });
        }

        const normalizedPhone = normalizePhoneNumber(phoneNumber);
        if (!normalizedPhone) {
            return res.status(400).json({ message: 'Nomor WhatsApp tidak valid.' });
        }

        const photoProvided = Object.prototype.hasOwnProperty.call(payload, 'photo');
        let parsedPhoto = null;
        if (photoProvided && payload.photo) {
            try {
                parsedPhoto = parseSellerPhoto(payload.photo);
            } catch (error) {
                return res.status(400).json({ message: error.message || 'Foto tidak valid.' });
            }
        }

        const sellers = await getSellersCollection();
        const updateDoc = {
            $set: {
                nama: nama.trim(),
                merk: merk.trim(),
                deskripsi: deskripsi.trim(),
                phoneNumber: normalizedPhone,
                updatedAt: new Date()
            }
        };
        if (typeof payload.showPhone === 'boolean') {
            updateDoc.$set.showPhone = Boolean(payload.showPhone);
        }
        if (photoProvided) {
            if (parsedPhoto) {
                updateDoc.$set.photo = parsedPhoto;
            } else {
                updateDoc.$unset = { photo: '' };
            }
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'menuPhotos')) {
            let parsedMenuPhotos = [];
            try {
                parsedMenuPhotos = parseSellerMenuPhotos(payload.menuPhotos || []);
            } catch (error) {
                return res.status(400).json({ message: error.message || 'Foto menu tidak valid.' });
            }
            updateDoc.$set.menuPhotos = parsedMenuPhotos;
        }

        const sellerObjectId = seller._id instanceof ObjectId
            ? seller._id
            : new ObjectId(seller._id);

        const result = await sellers.findOneAndUpdate(
            { _id: sellerObjectId },
            updateDoc,
            { returnDocument: 'after' }
        );
        let nextSellerDoc = result.value;
        if (!nextSellerDoc) {
            nextSellerDoc = await sellers.findOne({ _id: sellerObjectId });
            if (!nextSellerDoc) {
                return res.status(404).json({ message: 'Profil penjual tidak ditemukan.' });
            }
        }
        res.json({
            seller: sanitizeSeller(nextSellerDoc),
            message: 'Profil Gerobak berhasil diperbarui.'
        });
    } catch (error) {
        console.error('Failed to update seller profile', error);
        res.status(500).json({ message: 'Gagal memperbarui profil Gerobak.' });
    }
});

router.post('/live-sellers/status', async (req, res) => {
    const seller = await authenticateRequest(req, res);
    if (!seller) return;

    const { isLive, lat, lng } = req.body || {};
    const sellers = await getSellersCollection();
    const now = new Date();

    if (isLive) {
        const latNum = Number(lat);
        const lngNum = Number(lng);
        if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
            return res.status(400).json({ message: 'Lokasi tidak valid.' });
        }
        const since = seller.liveStatus && seller.liveStatus.isLive ? (seller.liveStatus.since || now) : now;
        await sellers.updateOne(
            { _id: seller._id },
            {
                $set: {
                    'liveStatus.isLive': true,
                    'liveStatus.location': { lat: latNum, lng: lngNum },
                    'liveStatus.since': since,
                    'liveStatus.lastPingAt': now,
                    updatedAt: now
                }
            }
        );
        return res.json({ message: 'Gerobak Online aktif.' });
    }

    await sellers.updateOne(
        { _id: seller._id },
        {
            $set: {
                'liveStatus.isLive': false,
                'liveStatus.lastPingAt': now,
                updatedAt: now
            },
            $unset: {
                'liveStatus.location': '',
                'liveStatus.since': ''
            }
        }
    );
    res.json({ message: 'Gerobak Online dimatikan.' });
});

router.post('/live-sellers/heartbeat', async (req, res) => {
    const seller = await authenticateRequest(req, res);
    if (!seller) return;

    const { lat, lng } = req.body || {};
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
        return res.status(400).json({ message: 'Lokasi tidak valid.' });
    }

    const sellers = await getSellersCollection();
    const currentSeller = await sellers.findOne({ _id: seller._id });
    if (!currentSeller?.liveStatus?.isLive) {
        return res.status(400).json({ message: 'Gerobak Online belum diaktifkan.' });
    }

    await sellers.updateOne(
        { _id: seller._id },
        {
            $set: {
                'liveStatus.location': { lat: latNum, lng: lngNum },
                'liveStatus.lastPingAt': new Date()
            }
        }
    );

    res.json({ message: 'Lokasi diperbarui.' });
});

router.get('/live-sellers', async (req, res) => {
    try {
        const database = await connectToDatabase();
        const cutoff = new Date(Date.now() - 3 * 60 * 1000);
        const requesterIp = req.headers['x-nf-client-connection-ip'] || '';
        const sellers = await database
            .collection('sellers')
            .find(
                {
                    'liveStatus.isLive': true,
                    'liveStatus.lastPingAt': { $gte: cutoff }
                },
                {
                    projection: {
                        username: 1,
                        nama: 1,
                        merk: 1,
                        deskripsi: 1,
                        phoneNumber: 1,
                        showPhone: 1,
                        menuPhotos: 1,
                        photo: 1,
                        liveStatus: 1,
                        communityVerification: 1
                    }
                }
            )
            .toArray();

        const payload = sellers.map((sellerDoc) => {
            const sanitized = sanitizeSeller(sellerDoc);
            const hasCommunityVoted = Array.isArray(sellerDoc.communityVerification?.voterIps)
                ? sellerDoc.communityVerification.voterIps.includes(requesterIp)
                : false;
            if (!sanitized.showPhone) {
                delete sanitized.phoneNumber;
            }
            return {
                ...sanitized,
                sellerId: sanitized.id,
                hasCommunityVoted
            };
        });

        res.json({ sellers: payload });
    } catch (error) {
        console.error('Failed to fetch Gerobak Online data', error);
        res.status(500).json({ message: 'Gagal mengambil data Gerobak Online.' });
    }
});

router.post('/live-sellers/:id/community-verify', async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'ID penjual tidak valid.' });
        }
        const voterIp = req.headers['x-nf-client-connection-ip'];
        if (!voterIp) {
            return res.status(400).json({ message: 'Tidak dapat memverifikasi tanpa identitas pengunjung.' });
        }
        const sellers = await getSellersCollection();
        const sellerObjectId = new ObjectId(id);
        const seller = await sellers.findOne({ _id: sellerObjectId });
        if (!seller) {
            return res.status(404).json({ message: 'Penjual tidak ditemukan.' });
        }

        const existingIps = Array.isArray(seller.communityVerification?.voterIps)
            ? seller.communityVerification.voterIps
            : [];
        if (existingIps.includes(voterIp)) {
            return res.status(409).json({ message: 'Kamu sudah memverifikasi gerobak ini. Terima kasih!' });
        }

        const now = new Date();
        const update = {
            $inc: { 'communityVerification.votes': 1 },
            $push: { 'communityVerification.voterIps': voterIp },
            $set: { updatedAt: now }
        };
        if (!seller.communityVerification || !seller.communityVerification.verifiedAt) {
            update.$set['communityVerification.verifiedAt'] = now;
        }

        const updated = await sellers.findOneAndUpdate(
            { _id: sellerObjectId },
            update,
            { returnDocument: 'after', projection: { communityVerification: 1 } }
        );

        const votes = Number(updated.value?.communityVerification?.votes) || 0;
        res.json({
            message: 'Terima kasih! Gerobak telah divalidasi oleh warga.',
            votes,
            isCommunityVerified: votes > 0
        });
    } catch (error) {
        console.error('Failed to record community verification', error);
        res.status(500).json({ message: 'Gagal menyimpan verifikasi warga.' });
    }
});

function computeExpiresAtFromLifetime(lifetime) {
    if (!lifetime || typeof lifetime !== 'object') {
        return null;
    }
    if (lifetime.type === 'today') {
        const expiresAt = new Date();
        expiresAt.setHours(23, 59, 59, 999);
        return expiresAt;
    }
    if (lifetime.type === 'date') {
        const basis = lifetime.end || lifetime.value || lifetime.start;
        if (basis) {
            const expiresAt = new Date(basis);
            if (!Number.isNaN(expiresAt.getTime())) {
                expiresAt.setHours(23, 59, 59, 999);
                return expiresAt;
            }
        }
    }
    return null;
}

async function resolveCityFromCoords(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }
    try {
        const geo = await reverseGeocodeCity(lat, lng);
        if (!geo) {
            return null;
        }
        const city = normalizeLandingText(geo.city);
        if (city) {
            return city;
        }
        const label = normalizeLandingText(geo.label);
        if (!label || label.toLowerCase() === 'unknown') {
            return null;
        }
        const primary = label.split(',')[0].trim();
        return primary || label;
    } catch (error) {
        console.error('Failed to resolve city from coordinates', error);
        return null;
    }
}

function getPinImageIdentifier(image) {
    if (!image) {
        return null;
    }
    if (typeof image === 'string') {
        return image;
    }
    if (typeof image !== 'object') {
        return null;
    }
    const keys = [
        '_id',
        'id',
        'uid',
        'imageId',
        'imageID',
        'existingId',
        'url',
        'src',
        'path',
        'dataUrl',
        'dataURL',
        'fileUrl',
        'fileURL',
        'filePath',
        'secureUrl',
        'secureURL',
        'secure_url',
        'signedUrl',
        'signedURL',
        'signed_url',
        'cdnUrl',
        'cdnURL',
        'assetUrl',
        'assetURL',
        'location',
        'href'
    ];
    for (const key of keys) {
        const value = image[key];
        if (typeof value === 'string' && value) {
            return value;
        }
    }
    if (typeof image.data === 'string' && image.data) {
        return image.data;
    }
    if (image.data && typeof image.data === 'object' && image.data !== image) {
        return getPinImageIdentifier(image.data);
    }
    return null;
}

function normalizeIncomingPinImages(currentImages, incomingImages) {
    const incomingList = Array.isArray(incomingImages) ? incomingImages : [];
    const currentList = Array.isArray(currentImages) ? currentImages : [];
    const currentById = new Map();

    currentList.forEach((image) => {
        const identifier = getPinImageIdentifier(image);
        if (identifier && !currentById.has(identifier)) {
            currentById.set(identifier, image);
        }
    });

    if (!incomingList.length) {
        return [];
    }

    return incomingList.reduce((acc, raw) => {
        if (!raw || (typeof raw !== 'object' && typeof raw !== 'string')) {
            return acc;
        }

        if (typeof raw === 'string') {
            // Treat string as direct data URL or remote URL
            const identifier = raw;
            const existing = currentById.get(identifier);
            if (existing) {
                acc.push(existing);
                currentById.delete(identifier);
                return acc;
            }
            acc.push({
                _id: identifier,
                dataUrl: raw,
                contentType: 'image/jpeg',
                size: 0,
                originalName: ''
            });
            return acc;
        }

        const { existingId, ...rest } = raw;
        const candidates = [existingId, getPinImageIdentifier(raw)].filter((value) => typeof value === 'string' && value);
        let matchedImage = null;
        let matchedKey = null;
        for (const candidate of candidates) {
            if (candidate && currentById.has(candidate)) {
                matchedImage = currentById.get(candidate);
                matchedKey = candidate;
                break;
            }
        }

        if (matchedImage) {
            const merged = {
                ...matchedImage,
                ...rest,
                dataUrl: rest.dataUrl || matchedImage.dataUrl || '',
                contentType: rest.contentType || matchedImage.contentType || 'image/jpeg',
                size: typeof rest.size === 'number' ? rest.size : (matchedImage.size || 0),
                originalName: rest.originalName || matchedImage.originalName || ''
            };
            if (!merged.data && (rest.data || matchedImage.data)) {
                merged.data = rest.data || matchedImage.data;
            }
            if (merged.data === undefined) {
                delete merged.data;
            }
            if (merged.existingId) {
                delete merged.existingId;
            }
            if (!merged._id) {
                merged._id = matchedImage._id || matchedKey || new ObjectId().toString();
            }
            acc.push(merged);
            if (matchedKey) {
                currentById.delete(matchedKey);
            }
            return acc;
        }

        const dataUrl = rest.dataUrl || (typeof rest.data === 'string'
            ? (rest.data.startsWith('data:') ? rest.data : `data:${rest.contentType || 'image/jpeg'};base64,${rest.data}`)
            : '');
        if (!dataUrl) {
            return acc;
        }

        const newImageId = rest._id || existingId || new ObjectId().toString();
        const newImage = {
            ...rest,
            dataUrl,
            contentType: rest.contentType || 'image/jpeg',
            size: typeof rest.size === 'number' ? rest.size : 0,
            originalName: rest.originalName || '',
            _id: newImageId
        };
        if (newImage.data === undefined) {
            delete newImage.data;
        }
        if (newImage.existingId) {
            delete newImage.existingId;
        }
        if (rest.data && typeof rest.data === 'string') {
            newImage.data = rest.data;
        }
        acc.push(newImage);
        return acc;
    }, []);
}

router.get('/pins', async (req, res) => {
    const db = await connectToDatabase();
    const ip = req.headers['x-nf-client-connection-ip'];
    await recordIpAddress(ip);

    const { city } = req.query;
    let query = { $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }] };

    if (city) {
        query.city = city;
    }

    const includeImages = isTruthy(req.query.includeImages) && !isTruthy(req.query.lean) && !isTruthy(req.query.noImages);

    console.log('Executing pins query:', { ...query, includeImages });

    if (includeImages) {
        const pins = await db
            .collection('pins')
            .aggregate([
                { $match: query },
                { $addFields: { imageCount: { $size: { $ifNull: ['$images', []] } } } }
            ])
            .toArray();
        res.json(
            pins.map((pin) => ({
                ...pin,
                images: Array.isArray(pin.images) ? pin.images : [],
                imageCount: computeImageCount(pin)
            }))
        );
        return;
    }

    const pins = await db
        .collection('pins')
        .aggregate([
            { $match: query },
            { $addFields: { imageCount: { $size: { $ifNull: ['$images', []] } } } },
            { $project: { images: 0 } }
        ])
        .toArray();
    res.json(pins);
});

router.get('/pins/count', async (req, res) => {
    const db = await connectToDatabase();
    const count = await db.collection('pins').countDocuments({ $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }] });
    res.json({ count: count });
});

router.get('/pins/:id', async (req, res) => {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Pin id tidak valid.' });
    }
    const db = await connectToDatabase();
    const pin = await db.collection('pins').findOne({ _id: new ObjectId(id) });
    if (!pin) {
        return res.status(404).json({ message: 'Pin not found.' });
    }
    pin.imageCount = computeImageCount(pin);
    res.json(pin);
});

router.get('/maintenance', async (req, res) => {
    const status = await readMaintenanceStatus();
    res.json(status);
});

router.put('/maintenance', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat mengubah status maintenance.' });
    }
    const { enabled, message } = req.body || {};
    try {
        const status = await writeMaintenanceStatus(enabled, message);
        res.json(status);
    } catch (error) {
        console.error('Failed to update maintenance status', error);
        res.status(500).json({ message: 'Tidak dapat memperbarui status maintenance.' });
    }
});

router.get('/features', async (req, res) => {
    const flags = await readFeatureFlags();
    res.json(flags);
});

router.put('/features', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat mengubah fitur.' });
    }
    try {
        const flags = await writeFeatureFlags(req.body || {});
        res.json(flags);
    } catch (error) {
        console.error('Failed to update feature flags', error);
        res.status(500).json({ message: 'Tidak dapat memperbarui fitur.' });
    }
});

router.get('/seo', async (req, res) => {
    const seo = await readSeoSettings();
    res.json(seo);
});

router.put('/seo', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat mengubah SEO.' });
    }
    try {
        const seo = await writeSeoSettings(req.body || {});
        res.json(seo);
    } catch (error) {
        console.error('Failed to update SEO settings', error);
        res.status(500).json({ message: 'Tidak dapat memperbarui SEO.' });
    }
});

const handleSitemapRequest = async (req, res) => {
    try {
        const seo = await readSeoSettings();
        const baseUrl = resolveSeoBaseUrl(seo, req);
        const now = Date.now();
        if (sitemapCache.xml && now < sitemapCache.expiresAt && sitemapCache.baseUrl === baseUrl) {
            res.set('Content-Type', 'application/xml');
            res.set('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800');
            res.send(sitemapCache.xml);
            return;
        }
        const pins = await fetchActivePinsForSitemap();
        const pinEntries = baseUrl
            ? pins.map((pin) => ({
                loc: `${baseUrl}/pin/${pin._id}`,
                lastmod: formatSitemapDate(pin.updatedAt || pin.createdAt),
                changefreq: 'monthly',
                priority: '0.7'
            }))
            : [];
        const landingEntries = buildLandingEntriesFromPins(pins, baseUrl);
        const entries = pinEntries.concat(landingEntries);
        const xml = buildSitemapXml(baseUrl, entries);
        sitemapCache = {
            baseUrl,
            xml,
            expiresAt: now + SITEMAP_CACHE_TTL_MS
        };
        res.set('Content-Type', 'application/xml');
        res.set('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800');
        res.send(xml);
    } catch (error) {
        console.error('Failed to build sitemap', error);
        res.status(500).send('');
    }
};

const handleRobotsRequest = async (req, res) => {
    const seo = await readSeoSettings();
    const baseUrl = resolveSeoBaseUrl(seo, req);
    const text = buildRobotsTxt(seo, baseUrl);
    res.set('Content-Type', 'text/plain');
    res.set('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800');
    res.send(text);
};

const handlePinPageRequest = async (req, res) => {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
        res.status(404).send('Not found');
        return;
    }
    try {
        const db = await connectToDatabase();
        const pin = await db.collection('pins').findOne({
            _id: new ObjectId(id),
            $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }]
        });
        if (!pin) {
            res.status(404).send('Not found');
            return;
        }
        const seo = await readSeoSettings();
        const baseUrl = resolveSeoBaseUrl(seo, req);
        const html = buildPinPageHtml(pin, seo, baseUrl);
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800');
        res.send(html);
    } catch (error) {
        console.error('Failed to render pin page', error);
        res.status(500).send('Error');
    }
};

const handleCategoryIndexRequest = async (req, res) => {
    try {
        const data = await fetchCategoryIndexData();
        const seo = await readSeoSettings();
        const baseUrl = resolveSeoBaseUrl(seo, req);
        const html = buildCategoryIndexHtml({
            seo,
            baseUrl,
            ...data
        });
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800');
        res.send(html);
    } catch (error) {
        console.error('Failed to render category index page', error);
        res.status(500).send('Error');
    }
};

const handleCategoryLandingRequest = async (req, res) => {
    const categorySlug = slugifyText(req.params?.category || '');
    const regionSlug = slugifyText(req.params?.region || '');
    if (!categorySlug) {
        res.status(404).send('Not found');
        return;
    }
    try {
        const data = await fetchCategoryLandingData(categorySlug, regionSlug);
        if (!data) {
            res.status(404).send('Not found');
            return;
        }
        const seo = await readSeoSettings();
        const baseUrl = resolveSeoBaseUrl(seo, req);
        const html = buildCategoryLandingHtml({
            seo,
            baseUrl,
            ...data
        });
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800');
        res.send(html);
    } catch (error) {
        console.error('Failed to render category landing page', error);
        res.status(500).send('Error');
    }
};

router.get('/seo/sitemap', handleSitemapRequest);

router.get('/seo/robots', handleRobotsRequest);

router.get('/pin/:id', handlePinPageRequest);

router.get('/admin/residents', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat melihat daftar warga.' });
    }
    try {
        const residents = await getResidentsCollection();
        const docs = await residents
            .find({})
            .sort({ lastLoginAt: -1 })
            .toArray();
        const payload = docs.map((doc) => ({
            id: doc._id ? doc._id.toString() : '',
            displayName: doc.displayName || doc.username || '',
            username: doc.username || '',
            lastLoginAt: doc.lastLoginAt || null,
            role: getResidentRole(doc),
            isAdmin: isAdminResident(doc)
        }));
        res.json({ residents: payload });
    } catch (error) {
        console.error('Failed to fetch residents', error);
        res.status(500).json({ message: 'Tidak dapat memuat daftar warga.' });
    }
});

router.put('/admin/residents/:id/role', async (req, res) => {
    const authResident = await authenticateResidentRequest(req, res);
    if (!authResident) return;
    if (!authResident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat mengubah status warga.' });
    }
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Resident id tidak valid.' });
    }
    const requestedRole = typeof req.body?.role === 'string'
        ? req.body.role.toLowerCase().trim()
        : '';
    if (![RESIDENT_ROLE_RESIDENT, RESIDENT_ROLE_PIN_MANAGER].includes(requestedRole)) {
        return res.status(400).json({ message: 'Status warga tidak valid.' });
    }
    try {
        const residents = await getResidentsCollection();
        const target = await residents.findOne({ _id: new ObjectId(id) });
        if (!target) {
            return res.status(404).json({ message: 'Warga tidak ditemukan.' });
        }
        if (isAdminResident(target)) {
            return res.status(403).json({ message: 'Status admin tidak dapat diubah.' });
        }
        const nextRole = normalizeResidentRole(requestedRole);
        const now = new Date();
        await residents.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role: nextRole, updatedAt: now } }
        );
        const updated = await residents.findOne({ _id: new ObjectId(id) });
        if (!updated) {
            return res.status(404).json({ message: 'Warga tidak ditemukan.' });
        }
        res.json({
            resident: {
                id: updated._id ? updated._id.toString() : '',
                displayName: updated.displayName || updated.username || '',
                username: updated.username || '',
                lastLoginAt: updated.lastLoginAt || null,
                role: getResidentRole(updated),
                isAdmin: isAdminResident(updated)
            }
        });
    } catch (error) {
        console.error('Failed to update resident role', error);
        res.status(500).json({ message: 'Tidak dapat memperbarui status warga.' });
    }
});

router.delete('/admin/residents/:id', async (req, res) => {
    const authResident = await authenticateResidentRequest(req, res);
    if (!authResident) return;
    if (!authResident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat menghapus warga.' });
    }
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Resident id tidak valid.' });
    }
    try {
        const residents = await getResidentsCollection();
        const target = await residents.findOne({ _id: new ObjectId(id) });
        if (!target) {
            return res.status(404).json({ message: 'Warga tidak ditemukan.' });
        }
        if (isAdminResident(target)) {
            return res.status(403).json({ message: 'Akun admin tidak dapat dihapus.' });
        }
        await residents.deleteOne({ _id: new ObjectId(id) });
        res.json({ ok: true });
    } catch (error) {
        console.error('Failed to delete resident', error);
        res.status(500).json({ message: 'Tidak dapat menghapus warga.' });
    }
});

router.post('/admin/pins/backfill-city', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat melakukan backfill lokasi.' });
    }
    const payload = req.body || {};
    const limitQuery = parseInt(req.query.limit, 10);
    const limitBody = parseInt(payload.limit, 10);
    const rawLimit = Number.isFinite(limitQuery)
        ? limitQuery
        : (Number.isFinite(limitBody) ? limitBody : 25);
    const limit = Math.min(Math.max(rawLimit, 1), 100);
    const dryRun = isTruthy(req.query.dryRun) || isTruthy(payload.dryRun);
    try {
        const db = await connectToDatabase();
        const missingCityQuery = {
            $or: [
                { city: { $exists: false } },
                { city: null },
                { city: '' }
            ],
            lat: { $exists: true },
            lng: { $exists: true }
        };
        const remainingBefore = await db.collection('pins').countDocuments(missingCityQuery);
        if (dryRun) {
            return res.json({
                dryRun: true,
                limit,
                remaining: remainingBefore
            });
        }
        const pins = await db.collection('pins')
            .find(missingCityQuery)
            .limit(limit)
            .toArray();
        const summary = {
            processed: 0,
            updated: 0,
            skipped: 0,
            errors: 0
        };
        const sampleUpdatedIds = [];
        for (const pin of pins) {
            summary.processed += 1;
            const lat = Number(pin?.lat);
            const lng = Number(pin?.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                summary.skipped += 1;
                continue;
            }
            try {
                const resolvedCity = await resolveCityFromCoords(lat, lng);
                if (!resolvedCity) {
                    summary.skipped += 1;
                    continue;
                }
                const updateResult = await db.collection('pins').updateOne(
                    { _id: pin._id },
                    { $set: { city: resolvedCity } }
                );
                if (updateResult.modifiedCount) {
                    summary.updated += 1;
                    if (sampleUpdatedIds.length < 20) {
                        sampleUpdatedIds.push(pin._id.toString());
                    }
                } else {
                    summary.skipped += 1;
                }
            } catch (error) {
                summary.errors += 1;
                console.error('Failed to backfill city for pin', pin?._id, error);
            }
        }
        const remainingAfter = await db.collection('pins').countDocuments(missingCityQuery);
        res.json({
            dryRun: false,
            limit,
            remainingBefore,
            remainingAfter,
            ...summary,
            sampleUpdatedIds
        });
    } catch (error) {
        console.error('Failed to backfill pin cities', error);
        res.status(500).json({ message: 'Tidak dapat melakukan backfill kota.' });
    }
});

router.get('/unique-ips', async (req, res) => {
    try {
        const db = await connectToDatabase();
        // Use estimatedDocumentCount for a faster count
        const count = await db.collection('unique_ips').estimatedDocumentCount();
        res.json({ count: count });
    } catch (error) {
        console.error('Error fetching unique IP count:', error);
        res.status(500).json({ message: 'Error fetching unique IP count' });
    }
});

router.get('/config', (req, res) => {
    res.json({ googleMapsApiKey: GOOGLE_MAPS_API_KEY });
});

router.get('/ip', (req, res) => {
    const ip = req.headers['x-nf-client-connection-ip'];
    res.json({ ip: ip });
});

router.get('/analytics/dashboard-password', (req, res) => {
    if (!DASHBOARD_PASSWORD) {
        return res.status(404).json({ message: 'Password belum disetel.' });
    }
    res.json({ password: DASHBOARD_PASSWORD });
});

function normalizeReferrer(referrer) {
    if (!referrer || typeof referrer !== 'string') {
        return '';
    }
    try {
        const url = new URL(referrer);
        return url.hostname || referrer;
    } catch (error) {
        return referrer;
    }
}

router.post('/analytics/track', async (req, res) => {
    try {
        const db = await connectToDatabase();
        const events = db.collection('analytics_events');
        const {
            eventType = 'pageview',
            path = '',
            pinId = null,
            referrer = '',
            lat,
            lng,
            city,
            country
        } = req.body || {};
        const ip = req.headers['x-nf-client-connection-ip'] || '';
        const userAgent = req.headers['user-agent'] || '';
        const doc = {
            eventType: String(eventType || 'pageview'),
            path: typeof path === 'string' ? path : '',
            pinId: pinId || null,
            referrer: typeof referrer === 'string' ? referrer : '',
            createdAt: new Date(),
            ip,
            userAgent
        };
        const latNum = Number(lat);
        const lngNum = Number(lng);
        if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
            doc.lat = latNum;
            doc.lng = lngNum;
        }
        const cityLabel = [city, country].filter(Boolean).join(', ').trim();
        if (cityLabel) {
            doc.cityLabel = cityLabel;
        }
        if (city) {
            doc.city = city;
        }
        if (country) {
            doc.country = country;
        }
        await events.insertOne(doc);
        res.json({ ok: true });
    } catch (error) {
        console.error('Failed to track analytics event', error);
        res.status(500).json({ message: 'Gagal menyimpan data analitik.' });
    }
});

router.get('/analytics/summary', async (req, res) => {
    try {
        const db = await connectToDatabase();
        const events = db.collection('analytics_events');
        const { start, end, granularity } = buildDateRangeFromQuery(req.query);
        const match = { createdAt: { $gte: start, $lt: end } };
        const uniqueIps = await events.distinct('ip', match);
        const pageviews = await events.countDocuments({ ...match, eventType: 'pageview' });
        res.json({
            summary: {
                [granularity]: {
                    uniqueVisitors: uniqueIps.length,
                    pageviews
                }
            }
        });
    } catch (error) {
        console.error('Failed to get analytics summary', error);
        res.status(500).json({ message: 'Gagal mengambil ringkasan analitik.' });
    }
});

router.get('/analytics/top-pins', async (req, res) => {
    try {
        const db = await connectToDatabase();
        const events = db.collection('analytics_events');
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);
        const { start, end, granularity } = buildDateRangeFromQuery(req.query);
        const cursor = await events
            .aggregate([
                {
                    $match: {
                        createdAt: { $gte: start, $lt: end },
                        eventType: { $in: ['pin_view', 'pin_click'] },
                        pinId: { $ne: null }
                    }
                },
                { $group: { _id: '$pinId', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: limit }
            ])
            .toArray();
        const pinIds = cursor.map((item) => item._id).filter(Boolean);
        const objectIds = pinIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
        const categories = [];
        if (objectIds.length) {
            const pins = await db
                .collection('pins')
                .find({ _id: { $in: objectIds } }, { projection: { category: 1 } })
                .toArray();
            pins.forEach((pin) => {
                categories.push(pin.category || 'Tidak diketahui');
            });
        }
        const agg = cursor.reduce((map, item, index) => {
            const cat = categories[index] || 'Tidak diketahui';
            map.set(cat, (map.get(cat) || 0) + (item.count || 0));
            return map;
        }, new Map());
        const topPins = Array.from(agg.entries())
            .map(([category, count]) => ({
                category,
                count
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
        res.json({
            granularity,
            start,
            end,
            topPins
        });
    } catch (error) {
        console.error('Failed to get top pins', error);
        res.status(500).json({ message: 'Gagal mengambil daftar pin teratas.' });
    }
});

router.get('/analytics/top-referrers', async (req, res) => {
    try {
        const db = await connectToDatabase();
        const events = db.collection('analytics_events');
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);
        const { start, end, granularity } = buildDateRangeFromQuery(req.query);
        const match = {
            createdAt: { $gte: start, $lt: end },
            eventType: 'pageview',
            referrer: { $nin: [null, '', '-'] }
        };
        const docs = await events.find(match, { projection: { referrer: 1 } }).toArray();
        const counts = new Map();
        docs.forEach((doc) => {
            const host = normalizeReferrer(doc.referrer || '');
            const key = host || 'direct';
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        const sorted = Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([source, count]) => ({
                source,
                count
            }));
        res.json({ granularity, topSources: sorted });
    } catch (error) {
        console.error('Failed to get top referrers', error);
        res.status(500).json({ message: 'Gagal mengambil sumber trafik teratas.' });
    }
});

router.get('/analytics/top-cities', async (req, res) => {
    try {
        const db = await connectToDatabase();
        const events = db.collection('analytics_events');
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);
        const { start, end, granularity } = buildDateRangeFromQuery(req.query);
        const docs = await events
            .aggregate([
                {
                    $match: {
                        createdAt: { $gte: start, $lt: end },
                        $or: [
                            { cityLabel: { $exists: true, $ne: '' } },
                            { lat: { $exists: true }, lng: { $exists: true } }
                        ]
                    }
                },
                {
                    $group: {
                        _id: {
                            cityLabel: '$cityLabel',
                            lat: { $round: ['$lat', 2] },
                            lng: { $round: ['$lng', 2] }
                        },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: limit }
            ])
            .toArray();
        const cities = [];
        for (const doc of docs) {
            let label = (doc?._id?.cityLabel && doc._id.cityLabel.trim()) || '';
            let city = '';
            let country = '';
            if (!label && doc?._id?.lat !== undefined && doc?._id?.lng !== undefined) {
                const geo = await reverseGeocodeCity(doc._id.lat, doc._id.lng);
                if (geo?.label) {
                    label = geo.label;
                    city = geo.city || '';
                    country = geo.country || '';
                } else {
                    label = `Lat ${doc._id.lat}, Lng ${doc._id.lng}`;
                }
            }
            cities.push({
                label: label || 'Unknown',
                city,
                country,
                lat: doc?._id?.lat,
                lng: doc?._id?.lng,
                count: doc.count
            });
        }
        const merged = cities.reduce((map, entry) => {
            const key = entry.label || 'Unknown';
            const current = map.get(key) || { ...entry, count: 0 };
            current.count += entry.count || 0;
            map.set(key, current);
            return map;
        }, new Map());
        res.json({ granularity, topCities: Array.from(merged.values()).sort((a, b) => b.count - a.count) });
    } catch (error) {
        console.error('Failed to get top cities', error);
        res.status(500).json({ message: 'Gagal mengambil lokasi teratas.' });
    }
});

router.get('/analytics/heatmap', async (req, res) => {
    try {
        const db = await connectToDatabase();
        const events = db.collection('analytics_events');
        const { start, end, granularity } = buildDateRangeFromQuery(req.query);
        const points = await events
            .aggregate([
                {
                    $match: {
                        createdAt: { $gte: start, $lt: end },
                        lat: { $exists: true },
                        lng: { $exists: true }
                    }
                },
                {
                    $project: {
                        lat: { $round: ['$lat', 4] },
                        lng: { $round: ['$lng', 4] }
                    }
                },
                {
                    $group: {
                        _id: { lat: '$lat', lng: '$lng' },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 200 }
            ])
            .toArray();
        res.json({
            granularity,
            points: points.map((p) => ({
                lat: p._id.lat,
                lng: p._id.lng,
                count: p.count
            }))
        });
    } catch (error) {
        console.error('Failed to get heatmap data', error);
        res.status(500).json({ message: 'Gagal mengambil data heatmap.' });
    }
});

router.get('/analytics/timeseries', async (req, res) => {
    try {
        const { start, end, granularity } = buildDateRangeFromQuery(req.query);
        const events = (await connectToDatabase()).collection('analytics_events');
        let groupId;
        if (granularity === 'day') {
            groupId = {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
                day: { $dayOfMonth: '$createdAt' }
            };
        } else if (granularity === 'year') {
            groupId = {
                year: { $year: '$createdAt' }
            };
        } else {
            groupId = {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' }
            };
        }
        const pipeline = [
            {
                $match: {
                    createdAt: { $gte: start, $lt: end }
                }
            },
            {
                $group: {
                    _id: groupId,
                    ipSet: { $addToSet: '$ip' },
                    pageviews: {
                        $sum: {
                            $cond: [{ $eq: ['$eventType', 'pageview'] }, 1, 0]
                        }
                    }
                }
            },
            {
                $project: {
                    _id: 1,
                    uniqueVisitors: { $size: '$ipSet' },
                    pageviews: 1
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
        ];
        const docs = await events.aggregate(pipeline).toArray();
        const series = docs.map((doc) => {
            const id = doc._id || {};
            let label = '';
            if (granularity === 'day') {
                const y = id.year || start.getFullYear();
                const m = id.month || start.getMonth() + 1;
                const d = id.day || 1;
                label = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            } else if (granularity === 'year') {
                label = String(id.year || '');
            } else {
                const y = id.year || start.getFullYear();
                const m = id.month || 1;
                label = `${y}-${String(m).padStart(2, '0')}`;
            }
            return {
                label,
                uniqueVisitors: doc.uniqueVisitors || 0,
                pageviews: doc.pageviews || 0
            };
        });
        res.json({ granularity, series });
    } catch (error) {
        console.error('Failed to get timeseries', error);
        res.status(500).json({ message: 'Gagal mengambil data grafik.' });
    }
});

router.post('/pins', async (req, res) => {
    const db = await connectToDatabase();
    const pin = req.body;
    pin.createdAt = new Date();
    pin.reporter = req.headers['x-nf-client-connection-ip']; // Add this line
    pin.upvotes = 0;
    pin.downvotes = 0;
    pin.upvoterIps = [];
    pin.downvoterIps = [];

    pin.expiresAt = computeExpiresAtFromLifetime(pin.lifetime);

    if (Array.isArray(pin.images) && pin.images.length) {
        pin.images = normalizeIncomingPinImages([], pin.images);
    }
    pin.imageCount = Array.isArray(pin.images) ? pin.images.length : 0;

    // Get city from lat/lng (with OSM fallback)
    const resolvedCity = await resolveCityFromCoords(Number(pin.lat), Number(pin.lng));
    if (resolvedCity) {
        pin.city = resolvedCity;
    }

    const result = await db.collection('pins').insertOne(pin);
    const insertedPin = await db.collection('pins').findOne({ _id: result.insertedId });
    res.json(insertedPin);
});

router.put('/pins/:id', async (req, res) => {
    const db = await connectToDatabase();
    const { id } = req.params;
    const ip = req.headers['x-nf-client-connection-ip'];
    const authResident = await authenticateResidentRequest(req, res, { optional: true });
    if (!authResident && req.headers.authorization) {
        // Sudah diberi respons oleh authenticateResidentRequest ketika token tidak valid
        return;
    }
    const pin = await db.collection('pins').findOne({ _id: new ObjectId(id) });

    if (!pin) {
        return res.status(404).json({ message: 'Pin not found.' });
    }

    const isReporter = pin.reporter === ip;
    const canManagePins = canManagePinsResident(authResident);
    if (!isReporter && !canManagePins) {
        return res.status(403).json({ message: 'You are not authorized to edit this pin.' });
    }

    const { title, description, category, link, lifetime, images: incomingImages } = req.body;
    const rawLat = req.body?.lat;
    const rawLng = req.body?.lng;
    const parsedLat = Number(rawLat);
    const parsedLng = Number(rawLng);
    const updatedPin = {};
    let latLngUpdated = false;

    if (typeof title !== 'undefined') {
        updatedPin.title = title;
    }
    if (typeof description !== 'undefined') {
        updatedPin.description = description;
    }
    if (typeof category !== 'undefined') {
        updatedPin.category = category;
    }
    if (typeof link !== 'undefined') {
        updatedPin.link = link;
    }
    if (typeof lifetime !== 'undefined') {
        updatedPin.lifetime = lifetime;
        updatedPin.expiresAt = computeExpiresAtFromLifetime(lifetime);
    }
    if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
        updatedPin.lat = parsedLat;
        updatedPin.lng = parsedLng;
        latLngUpdated = true;
    }
    if (Array.isArray(incomingImages)) {
        updatedPin.images = normalizeIncomingPinImages(pin.images, incomingImages);
        updatedPin.imageCount = Array.isArray(updatedPin.images) ? updatedPin.images.length : 0;
    } else if (incomingImages === null) {
        updatedPin.images = [];
        updatedPin.imageCount = 0;
    }

    if (latLngUpdated) {
        const resolvedCity = await resolveCityFromCoords(parsedLat, parsedLng);
        if (resolvedCity) {
            updatedPin.city = resolvedCity;
        }
    }

    const result = await db.collection('pins').updateOne({ _id: new ObjectId(id) }, { $set: updatedPin });
    if (!result.matchedCount) {
        return res.status(404).json({ message: 'Pin not found.' });
    }
    const refreshedPin = await db.collection('pins').findOne({ _id: new ObjectId(id) });
    res.json(refreshedPin);
});

router.delete('/pins/:id', async (req, res) => {
    const db = await connectToDatabase();
    const { id } = req.params;
    const ip = req.headers['x-nf-client-connection-ip'];
    const authResident = await authenticateResidentRequest(req, res, { optional: true });
    if (!authResident && req.headers.authorization) {
        return;
    }
    const pin = await db.collection('pins').findOne({ _id: new ObjectId(id) });
    if (!pin) {
        return res.status(404).json({ message: 'Pin not found.' });
    }
    const isReporter = pin.reporter === ip;
    const canManagePins = canManagePinsResident(authResident);
    if (!canManagePins && !isReporter) {
        return res.status(403).json({ message: 'You are not authorized to delete this pin.' });
    }
    await db.collection('pins').deleteOne({ _id: new ObjectId(id) });
    res.json({ message: 'Pin deleted.' });
});

router.post('/pins/:id/upvote', async (req, res) => {
    const db = await connectToDatabase();
    const { id } = req.params;
    const ip = req.headers['x-nf-client-connection-ip'];
    const pin = await db.collection('pins').findOne({ _id: new ObjectId(id) });

    if (pin.upvoterIps.includes(ip)) {
        return res.status(403).json({ message: 'You have already upvoted this pin.' });
    }

    if (pin.downvoterIps.includes(ip)) {
        // Remove from downvoters and decrement downvotes
        await db.collection('pins').updateOne({ _id: new ObjectId(id) }, { $pull: { downvoterIps: ip }, $inc: { downvotes: -1 } });
    }

    const result = await db.collection('pins').updateOne({ _id: new ObjectId(id) }, { $inc: { upvotes: 1 }, $push: { upvoterIps: ip } });
    res.json(result);
});

router.post('/pins/:id/downvote', async (req, res) => {
    const db = await connectToDatabase();
    const { id } = req.params;
    const ip = req.headers['x-nf-client-connection-ip'];
    const pin = await db.collection('pins').findOne({ _id: new ObjectId(id) });

    if (pin.downvoterIps.includes(ip)) {
        return res.status(403).json({ message: 'You have already downvoted this pin.' });
    }

    if (pin.upvoterIps.includes(ip)) {
        // Remove from upvoters and decrement upvotes
        await db.collection('pins').updateOne({ _id: new ObjectId(id) }, { $pull: { upvoterIps: ip }, $inc: { upvotes: -1 } });
    }

    const result = await db.collection('pins').updateOne({ _id: new ObjectId(id) }, { $inc: { downvotes: 1 }, $push: { downvoterIps: ip } });
    res.json(result);
});

app.get('/sitemap.xml', handleSitemapRequest);
app.get('/robots.txt', handleRobotsRequest);
app.get('/pin/:id', handlePinPageRequest);
app.get('/kategori', handleCategoryIndexRequest);
app.get('/kategori/', handleCategoryIndexRequest);
app.get('/kategori/:category', handleCategoryLandingRequest);
app.get('/kategori/:category/:region', handleCategoryLandingRequest);

app.use('/api', router);

module.exports.handler = serverless(app);

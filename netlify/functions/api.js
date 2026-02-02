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
        await database.collection('brands').createIndex({ name: 1 });
        await database.collection('areas').createIndex({ nameId: 1 });
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

const geocodeProvinceCityCache = new Map();

async function reverseGeocodeProvinceCity(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const key = `${lat},${lng}`;
    if (geocodeProvinceCityCache.has(key)) {
        return geocodeProvinceCityCache.get(key);
    }
    const useGoogle = Boolean(GOOGLE_MAPS_API_KEY);
    try {
        let rawProvince = '';
        let rawCity = '';
        if (useGoogle) {
            const response = await axios.get(
                `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`
            );
            const results = response.data?.results || [];
            if (results.length) {
                const components = results[0].address_components || [];
                components.forEach((component) => {
                    if (component.types.includes('administrative_area_level_1')) {
                        rawProvince = rawProvince || component.long_name || '';
                    }
                    if (component.types.includes('locality') || component.types.includes('administrative_area_level_2')) {
                        rawCity = rawCity || component.long_name || '';
                    }
                });
            }
        }
        if (!rawProvince && !rawCity) {
            // Fallback: free OpenStreetMap Nominatim
            const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
                params: { format: 'json', lat, lon: lng, zoom: 10, addressdetails: 1 },
                headers: { 'User-Agent': 'ayanaon-analytics/1.0' }
            });
            const addr = response.data?.address || {};
            rawProvince = addr.state || '';
            rawCity = addr.city || addr.town || addr.village || addr.county || '';
        }
        // Translate English names to Indonesian using areas directory
        const areas = await getAreasDirectory();
        const translated = translateProvinceCity(rawProvince, rawCity, areas);
        const payload = { province: translated.province, city: translated.city };
        geocodeProvinceCityCache.set(key, payload);
        return payload;
    } catch (error) {
        console.error('Reverse geocode province/city failed', error);
        return { province: '', city: '' };
    }
}

// ── Area Directory Cache & Translation ────────────────────────────
let areasCache = null;
let areasCacheExpiresAt = 0;
const AREAS_CACHE_TTL_MS = 10 * 60 * 1000;

async function getAreasDirectory() {
    const now = Date.now();
    if (areasCache && now < areasCacheExpiresAt) return areasCache;
    try {
        const db = await connectToDatabase();
        areasCache = await db.collection('areas').find({}).toArray();
        areasCacheExpiresAt = now + AREAS_CACHE_TTL_MS;
    } catch (_) {
        areasCache = areasCache || [];
    }
    return areasCache;
}

function normalizeForAreaMatch(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function translateProvinceCity(province, city, areas) {
    let translatedProvince = province || '';
    let translatedCity = city || '';
    if (!areas || !areas.length) return { province: translatedProvince, city: translatedCity };
    const normProv = normalizeForAreaMatch(province);
    const normCity = normalizeForAreaMatch(city);
    if (!normProv && !normCity) return { province: translatedProvince, city: translatedCity };
    for (const area of areas) {
        const provAliases = (area.aliases || []).map(normalizeForAreaMatch);
        provAliases.push(normalizeForAreaMatch(area.nameId), normalizeForAreaMatch(area.nameEn));
        const provMatch = normProv && provAliases.some(a => a && (a === normProv || normProv.includes(a) || a.includes(normProv)));
        if (provMatch) {
            translatedProvince = area.nameId;
            if (normCity) {
                for (const c of (area.cities || [])) {
                    const cityAliases = (c.aliases || []).map(normalizeForAreaMatch);
                    cityAliases.push(normalizeForAreaMatch(c.nameId), normalizeForAreaMatch(c.nameEn));
                    const cityMatch = cityAliases.some(a => a && (a === normCity || normCity.includes(a) || a.includes(normCity)));
                    if (cityMatch) {
                        translatedCity = c.nameId;
                        break;
                    }
                }
            }
            break;
        }
    }
    return { province: translatedProvince, city: translatedCity };
}

const INDONESIA_AREAS_SEED = [
    { nameId: 'Aceh', nameEn: 'Aceh', aliases: ['aceh', 'nanggroe aceh darussalam', 'nad', 'special region of aceh'], cities: [
        { nameId: 'Kota Banda Aceh', nameEn: 'Banda Aceh City', aliases: ['banda aceh', 'kota banda aceh'] },
        { nameId: 'Kota Sabang', nameEn: 'Sabang City', aliases: ['sabang', 'kota sabang'] },
        { nameId: 'Kota Langsa', nameEn: 'Langsa City', aliases: ['langsa', 'kota langsa'] },
        { nameId: 'Kota Lhokseumawe', nameEn: 'Lhokseumawe City', aliases: ['lhokseumawe', 'kota lhokseumawe'] },
        { nameId: 'Kota Subulussalam', nameEn: 'Subulussalam City', aliases: ['subulussalam', 'kota subulussalam'] },
        { nameId: 'Kabupaten Aceh Besar', nameEn: 'Aceh Besar Regency', aliases: ['aceh besar', 'kabupaten aceh besar'] },
        { nameId: 'Kabupaten Pidie', nameEn: 'Pidie Regency', aliases: ['pidie', 'kabupaten pidie'] },
        { nameId: 'Kabupaten Aceh Utara', nameEn: 'North Aceh Regency', aliases: ['aceh utara', 'north aceh', 'kabupaten aceh utara'] },
        { nameId: 'Kabupaten Aceh Timur', nameEn: 'East Aceh Regency', aliases: ['aceh timur', 'east aceh', 'kabupaten aceh timur'] },
        { nameId: 'Kabupaten Aceh Selatan', nameEn: 'South Aceh Regency', aliases: ['aceh selatan', 'south aceh', 'kabupaten aceh selatan'] },
        { nameId: 'Kabupaten Aceh Barat', nameEn: 'West Aceh Regency', aliases: ['aceh barat', 'west aceh', 'kabupaten aceh barat'] },
        { nameId: 'Kabupaten Aceh Tengah', nameEn: 'Central Aceh Regency', aliases: ['aceh tengah', 'central aceh', 'kabupaten aceh tengah'] },
    ]},
    { nameId: 'Sumatera Utara', nameEn: 'North Sumatra', aliases: ['sumatera utara', 'north sumatra', 'north sumatera', 'sumut'], cities: [
        { nameId: 'Kota Medan', nameEn: 'Medan City', aliases: ['medan', 'kota medan'] },
        { nameId: 'Kota Binjai', nameEn: 'Binjai City', aliases: ['binjai', 'kota binjai'] },
        { nameId: 'Kota Pematang Siantar', nameEn: 'Pematang Siantar City', aliases: ['pematang siantar', 'kota pematang siantar'] },
        { nameId: 'Kota Tebing Tinggi', nameEn: 'Tebing Tinggi City', aliases: ['tebing tinggi', 'kota tebing tinggi'] },
        { nameId: 'Kota Padang Sidempuan', nameEn: 'Padang Sidempuan City', aliases: ['padang sidempuan', 'kota padang sidempuan'] },
        { nameId: 'Kota Tanjung Balai', nameEn: 'Tanjung Balai City', aliases: ['tanjung balai', 'kota tanjung balai'] },
        { nameId: 'Kota Sibolga', nameEn: 'Sibolga City', aliases: ['sibolga', 'kota sibolga'] },
        { nameId: 'Kota Gunungsitoli', nameEn: 'Gunungsitoli City', aliases: ['gunungsitoli', 'kota gunungsitoli'] },
        { nameId: 'Kabupaten Deli Serdang', nameEn: 'Deli Serdang Regency', aliases: ['deli serdang', 'kabupaten deli serdang'] },
        { nameId: 'Kabupaten Langkat', nameEn: 'Langkat Regency', aliases: ['langkat', 'kabupaten langkat'] },
        { nameId: 'Kabupaten Karo', nameEn: 'Karo Regency', aliases: ['karo', 'kabupaten karo'] },
        { nameId: 'Kabupaten Simalungun', nameEn: 'Simalungun Regency', aliases: ['simalungun', 'kabupaten simalungun'] },
    ]},
    { nameId: 'Sumatera Barat', nameEn: 'West Sumatra', aliases: ['sumatera barat', 'west sumatra', 'west sumatera', 'sumbar'], cities: [
        { nameId: 'Kota Padang', nameEn: 'Padang City', aliases: ['padang', 'kota padang'] },
        { nameId: 'Kota Bukittinggi', nameEn: 'Bukittinggi City', aliases: ['bukittinggi', 'kota bukittinggi'] },
        { nameId: 'Kota Payakumbuh', nameEn: 'Payakumbuh City', aliases: ['payakumbuh', 'kota payakumbuh'] },
        { nameId: 'Kota Solok', nameEn: 'Solok City', aliases: ['solok', 'kota solok'] },
        { nameId: 'Kota Sawahlunto', nameEn: 'Sawahlunto City', aliases: ['sawahlunto', 'kota sawahlunto'] },
        { nameId: 'Kota Padang Panjang', nameEn: 'Padang Panjang City', aliases: ['padang panjang', 'kota padang panjang'] },
        { nameId: 'Kota Pariaman', nameEn: 'Pariaman City', aliases: ['pariaman', 'kota pariaman'] },
    ]},
    { nameId: 'Riau', nameEn: 'Riau', aliases: ['riau'], cities: [
        { nameId: 'Kota Pekanbaru', nameEn: 'Pekanbaru City', aliases: ['pekanbaru', 'kota pekanbaru'] },
        { nameId: 'Kota Dumai', nameEn: 'Dumai City', aliases: ['dumai', 'kota dumai'] },
        { nameId: 'Kabupaten Kampar', nameEn: 'Kampar Regency', aliases: ['kampar', 'kabupaten kampar'] },
        { nameId: 'Kabupaten Bengkalis', nameEn: 'Bengkalis Regency', aliases: ['bengkalis', 'kabupaten bengkalis'] },
        { nameId: 'Kabupaten Indragiri Hilir', nameEn: 'Indragiri Hilir Regency', aliases: ['indragiri hilir', 'kabupaten indragiri hilir'] },
        { nameId: 'Kabupaten Indragiri Hulu', nameEn: 'Indragiri Hulu Regency', aliases: ['indragiri hulu', 'kabupaten indragiri hulu'] },
        { nameId: 'Kabupaten Siak', nameEn: 'Siak Regency', aliases: ['siak', 'kabupaten siak'] },
        { nameId: 'Kabupaten Rokan Hilir', nameEn: 'Rokan Hilir Regency', aliases: ['rokan hilir', 'kabupaten rokan hilir'] },
        { nameId: 'Kabupaten Rokan Hulu', nameEn: 'Rokan Hulu Regency', aliases: ['rokan hulu', 'kabupaten rokan hulu'] },
    ]},
    { nameId: 'Jambi', nameEn: 'Jambi', aliases: ['jambi'], cities: [
        { nameId: 'Kota Jambi', nameEn: 'Jambi City', aliases: ['kota jambi'] },
        { nameId: 'Kota Sungai Penuh', nameEn: 'Sungai Penuh City', aliases: ['sungai penuh', 'kota sungai penuh'] },
        { nameId: 'Kabupaten Muaro Jambi', nameEn: 'Muaro Jambi Regency', aliases: ['muaro jambi', 'kabupaten muaro jambi'] },
        { nameId: 'Kabupaten Batanghari', nameEn: 'Batanghari Regency', aliases: ['batanghari', 'kabupaten batanghari'] },
        { nameId: 'Kabupaten Kerinci', nameEn: 'Kerinci Regency', aliases: ['kerinci', 'kabupaten kerinci'] },
    ]},
    { nameId: 'Sumatera Selatan', nameEn: 'South Sumatra', aliases: ['sumatera selatan', 'south sumatra', 'south sumatera', 'sumsel'], cities: [
        { nameId: 'Kota Palembang', nameEn: 'Palembang City', aliases: ['palembang', 'kota palembang'] },
        { nameId: 'Kota Prabumulih', nameEn: 'Prabumulih City', aliases: ['prabumulih', 'kota prabumulih'] },
        { nameId: 'Kota Pagar Alam', nameEn: 'Pagar Alam City', aliases: ['pagar alam', 'kota pagar alam'] },
        { nameId: 'Kota Lubuklinggau', nameEn: 'Lubuklinggau City', aliases: ['lubuklinggau', 'kota lubuklinggau'] },
    ]},
    { nameId: 'Bengkulu', nameEn: 'Bengkulu', aliases: ['bengkulu'], cities: [
        { nameId: 'Kota Bengkulu', nameEn: 'Bengkulu City', aliases: ['kota bengkulu'] },
    ]},
    { nameId: 'Lampung', nameEn: 'Lampung', aliases: ['lampung'], cities: [
        { nameId: 'Kota Bandar Lampung', nameEn: 'Bandar Lampung City', aliases: ['bandar lampung', 'kota bandar lampung'] },
        { nameId: 'Kota Metro', nameEn: 'Metro City', aliases: ['metro', 'kota metro'] },
        { nameId: 'Kabupaten Lampung Selatan', nameEn: 'South Lampung Regency', aliases: ['lampung selatan', 'south lampung'] },
        { nameId: 'Kabupaten Lampung Tengah', nameEn: 'Central Lampung Regency', aliases: ['lampung tengah', 'central lampung'] },
        { nameId: 'Kabupaten Lampung Utara', nameEn: 'North Lampung Regency', aliases: ['lampung utara', 'north lampung'] },
    ]},
    { nameId: 'Kepulauan Bangka Belitung', nameEn: 'Bangka Belitung Islands', aliases: ['kepulauan bangka belitung', 'bangka belitung islands', 'bangka belitung', 'babel'], cities: [
        { nameId: 'Kota Pangkal Pinang', nameEn: 'Pangkal Pinang City', aliases: ['pangkal pinang', 'kota pangkal pinang', 'pangkalpinang'] },
        { nameId: 'Kabupaten Bangka', nameEn: 'Bangka Regency', aliases: ['bangka', 'kabupaten bangka'] },
        { nameId: 'Kabupaten Belitung', nameEn: 'Belitung Regency', aliases: ['belitung', 'kabupaten belitung'] },
    ]},
    { nameId: 'Kepulauan Riau', nameEn: 'Riau Islands', aliases: ['kepulauan riau', 'riau islands', 'kepri'], cities: [
        { nameId: 'Kota Batam', nameEn: 'Batam City', aliases: ['batam', 'kota batam'] },
        { nameId: 'Kota Tanjung Pinang', nameEn: 'Tanjung Pinang City', aliases: ['tanjung pinang', 'kota tanjung pinang', 'tanjungpinang'] },
        { nameId: 'Kabupaten Bintan', nameEn: 'Bintan Regency', aliases: ['bintan', 'kabupaten bintan'] },
        { nameId: 'Kabupaten Karimun', nameEn: 'Karimun Regency', aliases: ['karimun', 'kabupaten karimun'] },
    ]},
    { nameId: 'DKI Jakarta', nameEn: 'Jakarta', aliases: ['dki jakarta', 'jakarta', 'special capital region of jakarta', 'jakarta special capital region'], cities: [
        { nameId: 'Jakarta Pusat', nameEn: 'Central Jakarta', aliases: ['jakarta pusat', 'central jakarta'] },
        { nameId: 'Jakarta Utara', nameEn: 'North Jakarta', aliases: ['jakarta utara', 'north jakarta'] },
        { nameId: 'Jakarta Selatan', nameEn: 'South Jakarta', aliases: ['jakarta selatan', 'south jakarta'] },
        { nameId: 'Jakarta Timur', nameEn: 'East Jakarta', aliases: ['jakarta timur', 'east jakarta'] },
        { nameId: 'Jakarta Barat', nameEn: 'West Jakarta', aliases: ['jakarta barat', 'west jakarta'] },
        { nameId: 'Kepulauan Seribu', nameEn: 'Thousand Islands', aliases: ['kepulauan seribu', 'thousand islands'] },
    ]},
    { nameId: 'Jawa Barat', nameEn: 'West Java', aliases: ['jawa barat', 'west java', 'jabar'], cities: [
        { nameId: 'Kota Bandung', nameEn: 'Bandung City', aliases: ['bandung', 'kota bandung', 'bandung city'] },
        { nameId: 'Kota Bekasi', nameEn: 'Bekasi City', aliases: ['bekasi', 'kota bekasi'] },
        { nameId: 'Kota Depok', nameEn: 'Depok City', aliases: ['depok', 'kota depok'] },
        { nameId: 'Kota Bogor', nameEn: 'Bogor City', aliases: ['bogor', 'kota bogor'] },
        { nameId: 'Kota Cimahi', nameEn: 'Cimahi City', aliases: ['cimahi', 'kota cimahi'] },
        { nameId: 'Kota Tasikmalaya', nameEn: 'Tasikmalaya City', aliases: ['tasikmalaya', 'kota tasikmalaya'] },
        { nameId: 'Kota Cirebon', nameEn: 'Cirebon City', aliases: ['cirebon', 'kota cirebon'] },
        { nameId: 'Kota Sukabumi', nameEn: 'Sukabumi City', aliases: ['sukabumi', 'kota sukabumi'] },
        { nameId: 'Kota Banjar', nameEn: 'Banjar City', aliases: ['banjar', 'kota banjar'] },
        { nameId: 'Kabupaten Bandung', nameEn: 'Bandung Regency', aliases: ['kabupaten bandung'] },
        { nameId: 'Kabupaten Bogor', nameEn: 'Bogor Regency', aliases: ['kabupaten bogor'] },
        { nameId: 'Kabupaten Bekasi', nameEn: 'Bekasi Regency', aliases: ['kabupaten bekasi'] },
        { nameId: 'Kabupaten Karawang', nameEn: 'Karawang Regency', aliases: ['karawang', 'kabupaten karawang'] },
        { nameId: 'Kabupaten Subang', nameEn: 'Subang Regency', aliases: ['subang', 'kabupaten subang'] },
        { nameId: 'Kabupaten Garut', nameEn: 'Garut Regency', aliases: ['garut', 'kabupaten garut'] },
        { nameId: 'Kabupaten Cianjur', nameEn: 'Cianjur Regency', aliases: ['cianjur', 'kabupaten cianjur'] },
        { nameId: 'Kabupaten Purwakarta', nameEn: 'Purwakarta Regency', aliases: ['purwakarta', 'kabupaten purwakarta'] },
    ]},
    { nameId: 'Jawa Tengah', nameEn: 'Central Java', aliases: ['jawa tengah', 'central java', 'jateng'], cities: [
        { nameId: 'Kota Semarang', nameEn: 'Semarang City', aliases: ['semarang', 'kota semarang'] },
        { nameId: 'Kota Surakarta', nameEn: 'Surakarta City', aliases: ['surakarta', 'solo', 'kota surakarta', 'kota solo'] },
        { nameId: 'Kota Salatiga', nameEn: 'Salatiga City', aliases: ['salatiga', 'kota salatiga'] },
        { nameId: 'Kota Magelang', nameEn: 'Magelang City', aliases: ['magelang', 'kota magelang'] },
        { nameId: 'Kota Pekalongan', nameEn: 'Pekalongan City', aliases: ['pekalongan', 'kota pekalongan'] },
        { nameId: 'Kota Tegal', nameEn: 'Tegal City', aliases: ['tegal', 'kota tegal'] },
        { nameId: 'Kabupaten Banyumas', nameEn: 'Banyumas Regency', aliases: ['banyumas', 'kabupaten banyumas'] },
        { nameId: 'Kabupaten Cilacap', nameEn: 'Cilacap Regency', aliases: ['cilacap', 'kabupaten cilacap'] },
        { nameId: 'Kabupaten Kudus', nameEn: 'Kudus Regency', aliases: ['kudus', 'kabupaten kudus'] },
        { nameId: 'Kabupaten Jepara', nameEn: 'Jepara Regency', aliases: ['jepara', 'kabupaten jepara'] },
        { nameId: 'Kabupaten Klaten', nameEn: 'Klaten Regency', aliases: ['klaten', 'kabupaten klaten'] },
        { nameId: 'Kabupaten Kebumen', nameEn: 'Kebumen Regency', aliases: ['kebumen', 'kabupaten kebumen'] },
    ]},
    { nameId: 'DI Yogyakarta', nameEn: 'Yogyakarta', aliases: ['di yogyakarta', 'yogyakarta', 'special region of yogyakarta', 'diy', 'daerah istimewa yogyakarta'], cities: [
        { nameId: 'Kota Yogyakarta', nameEn: 'Yogyakarta City', aliases: ['yogyakarta', 'kota yogyakarta', 'jogja', 'jogjakarta'] },
        { nameId: 'Kabupaten Sleman', nameEn: 'Sleman Regency', aliases: ['sleman', 'kabupaten sleman'] },
        { nameId: 'Kabupaten Bantul', nameEn: 'Bantul Regency', aliases: ['bantul', 'kabupaten bantul'] },
        { nameId: 'Kabupaten Gunungkidul', nameEn: 'Gunungkidul Regency', aliases: ['gunungkidul', 'gunung kidul', 'kabupaten gunungkidul'] },
        { nameId: 'Kabupaten Kulon Progo', nameEn: 'Kulon Progo Regency', aliases: ['kulon progo', 'kabupaten kulon progo'] },
    ]},
    { nameId: 'Jawa Timur', nameEn: 'East Java', aliases: ['jawa timur', 'east java', 'jatim'], cities: [
        { nameId: 'Kota Surabaya', nameEn: 'Surabaya City', aliases: ['surabaya', 'kota surabaya'] },
        { nameId: 'Kota Malang', nameEn: 'Malang City', aliases: ['malang', 'kota malang'] },
        { nameId: 'Kota Batu', nameEn: 'Batu City', aliases: ['batu', 'kota batu'] },
        { nameId: 'Kota Kediri', nameEn: 'Kediri City', aliases: ['kediri', 'kota kediri'] },
        { nameId: 'Kota Blitar', nameEn: 'Blitar City', aliases: ['blitar', 'kota blitar'] },
        { nameId: 'Kota Madiun', nameEn: 'Madiun City', aliases: ['madiun', 'kota madiun'] },
        { nameId: 'Kota Mojokerto', nameEn: 'Mojokerto City', aliases: ['mojokerto', 'kota mojokerto'] },
        { nameId: 'Kota Pasuruan', nameEn: 'Pasuruan City', aliases: ['pasuruan', 'kota pasuruan'] },
        { nameId: 'Kota Probolinggo', nameEn: 'Probolinggo City', aliases: ['probolinggo', 'kota probolinggo'] },
        { nameId: 'Kabupaten Sidoarjo', nameEn: 'Sidoarjo Regency', aliases: ['sidoarjo', 'kabupaten sidoarjo'] },
        { nameId: 'Kabupaten Gresik', nameEn: 'Gresik Regency', aliases: ['gresik', 'kabupaten gresik'] },
        { nameId: 'Kabupaten Jember', nameEn: 'Jember Regency', aliases: ['jember', 'kabupaten jember'] },
        { nameId: 'Kabupaten Banyuwangi', nameEn: 'Banyuwangi Regency', aliases: ['banyuwangi', 'kabupaten banyuwangi'] },
        { nameId: 'Kabupaten Lamongan', nameEn: 'Lamongan Regency', aliases: ['lamongan', 'kabupaten lamongan'] },
        { nameId: 'Kabupaten Tuban', nameEn: 'Tuban Regency', aliases: ['tuban', 'kabupaten tuban'] },
    ]},
    { nameId: 'Banten', nameEn: 'Banten', aliases: ['banten'], cities: [
        { nameId: 'Kota Tangerang', nameEn: 'Tangerang City', aliases: ['tangerang', 'kota tangerang'] },
        { nameId: 'Kota Tangerang Selatan', nameEn: 'South Tangerang City', aliases: ['tangerang selatan', 'south tangerang', 'tangsel', 'kota tangerang selatan'] },
        { nameId: 'Kota Serang', nameEn: 'Serang City', aliases: ['serang', 'kota serang'] },
        { nameId: 'Kota Cilegon', nameEn: 'Cilegon City', aliases: ['cilegon', 'kota cilegon'] },
        { nameId: 'Kabupaten Tangerang', nameEn: 'Tangerang Regency', aliases: ['kabupaten tangerang'] },
        { nameId: 'Kabupaten Serang', nameEn: 'Serang Regency', aliases: ['kabupaten serang'] },
        { nameId: 'Kabupaten Pandeglang', nameEn: 'Pandeglang Regency', aliases: ['pandeglang', 'kabupaten pandeglang'] },
        { nameId: 'Kabupaten Lebak', nameEn: 'Lebak Regency', aliases: ['lebak', 'kabupaten lebak'] },
    ]},
    { nameId: 'Bali', nameEn: 'Bali', aliases: ['bali'], cities: [
        { nameId: 'Kota Denpasar', nameEn: 'Denpasar City', aliases: ['denpasar', 'kota denpasar'] },
        { nameId: 'Kabupaten Badung', nameEn: 'Badung Regency', aliases: ['badung', 'kabupaten badung'] },
        { nameId: 'Kabupaten Gianyar', nameEn: 'Gianyar Regency', aliases: ['gianyar', 'kabupaten gianyar'] },
        { nameId: 'Kabupaten Tabanan', nameEn: 'Tabanan Regency', aliases: ['tabanan', 'kabupaten tabanan'] },
        { nameId: 'Kabupaten Buleleng', nameEn: 'Buleleng Regency', aliases: ['buleleng', 'kabupaten buleleng', 'singaraja'] },
        { nameId: 'Kabupaten Karangasem', nameEn: 'Karangasem Regency', aliases: ['karangasem', 'kabupaten karangasem'] },
        { nameId: 'Kabupaten Klungkung', nameEn: 'Klungkung Regency', aliases: ['klungkung', 'kabupaten klungkung'] },
        { nameId: 'Kabupaten Bangli', nameEn: 'Bangli Regency', aliases: ['bangli', 'kabupaten bangli'] },
        { nameId: 'Kabupaten Jembrana', nameEn: 'Jembrana Regency', aliases: ['jembrana', 'kabupaten jembrana'] },
    ]},
    { nameId: 'Nusa Tenggara Barat', nameEn: 'West Nusa Tenggara', aliases: ['nusa tenggara barat', 'west nusa tenggara', 'ntb'], cities: [
        { nameId: 'Kota Mataram', nameEn: 'Mataram City', aliases: ['mataram', 'kota mataram'] },
        { nameId: 'Kota Bima', nameEn: 'Bima City', aliases: ['bima', 'kota bima'] },
        { nameId: 'Kabupaten Lombok Barat', nameEn: 'West Lombok Regency', aliases: ['lombok barat', 'west lombok'] },
        { nameId: 'Kabupaten Lombok Tengah', nameEn: 'Central Lombok Regency', aliases: ['lombok tengah', 'central lombok'] },
        { nameId: 'Kabupaten Lombok Timur', nameEn: 'East Lombok Regency', aliases: ['lombok timur', 'east lombok'] },
        { nameId: 'Kabupaten Sumbawa', nameEn: 'Sumbawa Regency', aliases: ['sumbawa', 'kabupaten sumbawa'] },
    ]},
    { nameId: 'Nusa Tenggara Timur', nameEn: 'East Nusa Tenggara', aliases: ['nusa tenggara timur', 'east nusa tenggara', 'ntt'], cities: [
        { nameId: 'Kota Kupang', nameEn: 'Kupang City', aliases: ['kupang', 'kota kupang'] },
        { nameId: 'Kabupaten Manggarai', nameEn: 'Manggarai Regency', aliases: ['manggarai', 'kabupaten manggarai'] },
        { nameId: 'Kabupaten Ende', nameEn: 'Ende Regency', aliases: ['ende', 'kabupaten ende'] },
        { nameId: 'Kabupaten Flores Timur', nameEn: 'East Flores Regency', aliases: ['flores timur', 'east flores'] },
        { nameId: 'Kabupaten Sikka', nameEn: 'Sikka Regency', aliases: ['sikka', 'kabupaten sikka', 'maumere'] },
    ]},
    { nameId: 'Kalimantan Barat', nameEn: 'West Kalimantan', aliases: ['kalimantan barat', 'west kalimantan', 'kalbar'], cities: [
        { nameId: 'Kota Pontianak', nameEn: 'Pontianak City', aliases: ['pontianak', 'kota pontianak'] },
        { nameId: 'Kota Singkawang', nameEn: 'Singkawang City', aliases: ['singkawang', 'kota singkawang'] },
        { nameId: 'Kabupaten Kubu Raya', nameEn: 'Kubu Raya Regency', aliases: ['kubu raya', 'kabupaten kubu raya'] },
        { nameId: 'Kabupaten Sambas', nameEn: 'Sambas Regency', aliases: ['sambas', 'kabupaten sambas'] },
    ]},
    { nameId: 'Kalimantan Tengah', nameEn: 'Central Kalimantan', aliases: ['kalimantan tengah', 'central kalimantan', 'kalteng'], cities: [
        { nameId: 'Kota Palangka Raya', nameEn: 'Palangka Raya City', aliases: ['palangka raya', 'kota palangka raya', 'palangkaraya'] },
        { nameId: 'Kabupaten Kotawaringin Timur', nameEn: 'East Kotawaringin Regency', aliases: ['kotawaringin timur', 'sampit'] },
        { nameId: 'Kabupaten Kotawaringin Barat', nameEn: 'West Kotawaringin Regency', aliases: ['kotawaringin barat', 'pangkalan bun'] },
    ]},
    { nameId: 'Kalimantan Selatan', nameEn: 'South Kalimantan', aliases: ['kalimantan selatan', 'south kalimantan', 'kalsel'], cities: [
        { nameId: 'Kota Banjarmasin', nameEn: 'Banjarmasin City', aliases: ['banjarmasin', 'kota banjarmasin'] },
        { nameId: 'Kota Banjarbaru', nameEn: 'Banjarbaru City', aliases: ['banjarbaru', 'kota banjarbaru'] },
        { nameId: 'Kabupaten Banjar', nameEn: 'Banjar Regency', aliases: ['kabupaten banjar'] },
        { nameId: 'Kabupaten Tanah Laut', nameEn: 'Tanah Laut Regency', aliases: ['tanah laut', 'kabupaten tanah laut'] },
    ]},
    { nameId: 'Kalimantan Timur', nameEn: 'East Kalimantan', aliases: ['kalimantan timur', 'east kalimantan', 'kaltim'], cities: [
        { nameId: 'Kota Samarinda', nameEn: 'Samarinda City', aliases: ['samarinda', 'kota samarinda'] },
        { nameId: 'Kota Balikpapan', nameEn: 'Balikpapan City', aliases: ['balikpapan', 'kota balikpapan'] },
        { nameId: 'Kota Bontang', nameEn: 'Bontang City', aliases: ['bontang', 'kota bontang'] },
        { nameId: 'Kabupaten Kutai Kartanegara', nameEn: 'Kutai Kartanegara Regency', aliases: ['kutai kartanegara', 'tenggarong'] },
        { nameId: 'Kabupaten Berau', nameEn: 'Berau Regency', aliases: ['berau', 'kabupaten berau'] },
    ]},
    { nameId: 'Kalimantan Utara', nameEn: 'North Kalimantan', aliases: ['kalimantan utara', 'north kalimantan', 'kaltara'], cities: [
        { nameId: 'Kota Tarakan', nameEn: 'Tarakan City', aliases: ['tarakan', 'kota tarakan'] },
        { nameId: 'Kabupaten Bulungan', nameEn: 'Bulungan Regency', aliases: ['bulungan', 'tanjung selor'] },
        { nameId: 'Kabupaten Malinau', nameEn: 'Malinau Regency', aliases: ['malinau', 'kabupaten malinau'] },
        { nameId: 'Kabupaten Nunukan', nameEn: 'Nunukan Regency', aliases: ['nunukan', 'kabupaten nunukan'] },
    ]},
    { nameId: 'Sulawesi Utara', nameEn: 'North Sulawesi', aliases: ['sulawesi utara', 'north sulawesi', 'sulut'], cities: [
        { nameId: 'Kota Manado', nameEn: 'Manado City', aliases: ['manado', 'kota manado'] },
        { nameId: 'Kota Bitung', nameEn: 'Bitung City', aliases: ['bitung', 'kota bitung'] },
        { nameId: 'Kota Tomohon', nameEn: 'Tomohon City', aliases: ['tomohon', 'kota tomohon'] },
        { nameId: 'Kota Kotamobagu', nameEn: 'Kotamobagu City', aliases: ['kotamobagu', 'kota kotamobagu'] },
        { nameId: 'Kabupaten Minahasa', nameEn: 'Minahasa Regency', aliases: ['minahasa', 'kabupaten minahasa'] },
    ]},
    { nameId: 'Sulawesi Tengah', nameEn: 'Central Sulawesi', aliases: ['sulawesi tengah', 'central sulawesi', 'sulteng'], cities: [
        { nameId: 'Kota Palu', nameEn: 'Palu City', aliases: ['palu', 'kota palu'] },
        { nameId: 'Kabupaten Donggala', nameEn: 'Donggala Regency', aliases: ['donggala', 'kabupaten donggala'] },
        { nameId: 'Kabupaten Poso', nameEn: 'Poso Regency', aliases: ['poso', 'kabupaten poso'] },
    ]},
    { nameId: 'Sulawesi Selatan', nameEn: 'South Sulawesi', aliases: ['sulawesi selatan', 'south sulawesi', 'sulsel'], cities: [
        { nameId: 'Kota Makassar', nameEn: 'Makassar City', aliases: ['makassar', 'kota makassar', 'ujung pandang'] },
        { nameId: 'Kota Parepare', nameEn: 'Parepare City', aliases: ['parepare', 'kota parepare', 'pare pare'] },
        { nameId: 'Kota Palopo', nameEn: 'Palopo City', aliases: ['palopo', 'kota palopo'] },
        { nameId: 'Kabupaten Gowa', nameEn: 'Gowa Regency', aliases: ['gowa', 'kabupaten gowa'] },
        { nameId: 'Kabupaten Maros', nameEn: 'Maros Regency', aliases: ['maros', 'kabupaten maros'] },
        { nameId: 'Kabupaten Bone', nameEn: 'Bone Regency', aliases: ['bone', 'kabupaten bone'] },
    ]},
    { nameId: 'Sulawesi Tenggara', nameEn: 'Southeast Sulawesi', aliases: ['sulawesi tenggara', 'southeast sulawesi', 'sultra'], cities: [
        { nameId: 'Kota Kendari', nameEn: 'Kendari City', aliases: ['kendari', 'kota kendari'] },
        { nameId: 'Kota Bau-Bau', nameEn: 'Bau-Bau City', aliases: ['bau bau', 'baubau', 'kota bau bau'] },
    ]},
    { nameId: 'Gorontalo', nameEn: 'Gorontalo', aliases: ['gorontalo'], cities: [
        { nameId: 'Kota Gorontalo', nameEn: 'Gorontalo City', aliases: ['kota gorontalo'] },
        { nameId: 'Kabupaten Gorontalo', nameEn: 'Gorontalo Regency', aliases: ['kabupaten gorontalo'] },
        { nameId: 'Kabupaten Bone Bolango', nameEn: 'Bone Bolango Regency', aliases: ['bone bolango', 'kabupaten bone bolango'] },
    ]},
    { nameId: 'Sulawesi Barat', nameEn: 'West Sulawesi', aliases: ['sulawesi barat', 'west sulawesi', 'sulbar'], cities: [
        { nameId: 'Kabupaten Mamuju', nameEn: 'Mamuju Regency', aliases: ['mamuju', 'kabupaten mamuju'] },
        { nameId: 'Kabupaten Polewali Mandar', nameEn: 'Polewali Mandar Regency', aliases: ['polewali mandar', 'polman'] },
        { nameId: 'Kabupaten Majene', nameEn: 'Majene Regency', aliases: ['majene', 'kabupaten majene'] },
    ]},
    { nameId: 'Maluku', nameEn: 'Maluku', aliases: ['maluku', 'moluccas'], cities: [
        { nameId: 'Kota Ambon', nameEn: 'Ambon City', aliases: ['ambon', 'kota ambon'] },
        { nameId: 'Kota Tual', nameEn: 'Tual City', aliases: ['tual', 'kota tual'] },
        { nameId: 'Kabupaten Maluku Tengah', nameEn: 'Central Maluku Regency', aliases: ['maluku tengah', 'central maluku'] },
    ]},
    { nameId: 'Maluku Utara', nameEn: 'North Maluku', aliases: ['maluku utara', 'north maluku'], cities: [
        { nameId: 'Kota Ternate', nameEn: 'Ternate City', aliases: ['ternate', 'kota ternate'] },
        { nameId: 'Kota Tidore Kepulauan', nameEn: 'Tidore Islands City', aliases: ['tidore', 'tidore kepulauan', 'kota tidore kepulauan'] },
        { nameId: 'Kabupaten Halmahera Utara', nameEn: 'North Halmahera Regency', aliases: ['halmahera utara', 'north halmahera'] },
    ]},
    { nameId: 'Papua', nameEn: 'Papua', aliases: ['papua'], cities: [
        { nameId: 'Kota Jayapura', nameEn: 'Jayapura City', aliases: ['jayapura', 'kota jayapura'] },
        { nameId: 'Kabupaten Jayapura', nameEn: 'Jayapura Regency', aliases: ['kabupaten jayapura'] },
        { nameId: 'Kabupaten Merauke', nameEn: 'Merauke Regency', aliases: ['merauke', 'kabupaten merauke'] },
        { nameId: 'Kabupaten Mimika', nameEn: 'Mimika Regency', aliases: ['mimika', 'timika', 'kabupaten mimika'] },
    ]},
    { nameId: 'Papua Barat', nameEn: 'West Papua', aliases: ['papua barat', 'west papua'], cities: [
        { nameId: 'Kota Manokwari', nameEn: 'Manokwari City', aliases: ['manokwari', 'kota manokwari'] },
        { nameId: 'Kabupaten Sorong', nameEn: 'Sorong Regency', aliases: ['kabupaten sorong'] },
        { nameId: 'Kota Sorong', nameEn: 'Sorong City', aliases: ['sorong', 'kota sorong'] },
    ]},
    { nameId: 'Papua Selatan', nameEn: 'South Papua', aliases: ['papua selatan', 'south papua'], cities: [
        { nameId: 'Kabupaten Merauke', nameEn: 'Merauke Regency', aliases: ['merauke'] },
        { nameId: 'Kabupaten Boven Digoel', nameEn: 'Boven Digoel Regency', aliases: ['boven digoel'] },
        { nameId: 'Kabupaten Mappi', nameEn: 'Mappi Regency', aliases: ['mappi'] },
        { nameId: 'Kabupaten Asmat', nameEn: 'Asmat Regency', aliases: ['asmat'] },
    ]},
    { nameId: 'Papua Tengah', nameEn: 'Central Papua', aliases: ['papua tengah', 'central papua'], cities: [
        { nameId: 'Kabupaten Nabire', nameEn: 'Nabire Regency', aliases: ['nabire'] },
        { nameId: 'Kabupaten Paniai', nameEn: 'Paniai Regency', aliases: ['paniai'] },
        { nameId: 'Kabupaten Mimika', nameEn: 'Mimika Regency', aliases: ['mimika', 'timika'] },
    ]},
    { nameId: 'Papua Pegunungan', nameEn: 'Highland Papua', aliases: ['papua pegunungan', 'highland papua', 'papua highlands'], cities: [
        { nameId: 'Kabupaten Jayawijaya', nameEn: 'Jayawijaya Regency', aliases: ['jayawijaya', 'wamena'] },
        { nameId: 'Kabupaten Puncak Jaya', nameEn: 'Puncak Jaya Regency', aliases: ['puncak jaya'] },
        { nameId: 'Kabupaten Lanny Jaya', nameEn: 'Lanny Jaya Regency', aliases: ['lanny jaya'] },
    ]},
    { nameId: 'Papua Barat Daya', nameEn: 'Southwest Papua', aliases: ['papua barat daya', 'southwest papua'], cities: [
        { nameId: 'Kota Sorong', nameEn: 'Sorong City', aliases: ['sorong', 'kota sorong'] },
        { nameId: 'Kabupaten Sorong', nameEn: 'Sorong Regency', aliases: ['kabupaten sorong'] },
        { nameId: 'Kabupaten Raja Ampat', nameEn: 'Raja Ampat Regency', aliases: ['raja ampat', 'kabupaten raja ampat'] },
    ]},
];

const DEFAULT_FEATURE_FLAGS = {
    gerobakOnline: true
};

const CATEGORY_SETTINGS_KEY = 'pinCategories';

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

function normalizeTabVisibility(payload = {}) {
    const visibility = {};
    Object.entries(payload || {}).forEach(([tabId, roles]) => {
        if (!roles || typeof roles !== 'object') {
            return;
        }
        visibility[tabId] = {
            admin: Boolean(roles.admin),
            pin_manager: Boolean(roles.pin_manager),
            resident: Boolean(roles.resident)
        };
    });
    return visibility;
}

async function readTabVisibility() {
    try {
        const settings = await getSettingsCollection();
        const doc = await settings.findOne({ key: 'adminTabs' });
        const raw = doc?.visibility || doc || {};
        const { key, updatedAt, ...rest } = raw;
        return normalizeTabVisibility(rest);
    } catch (error) {
        console.error('Failed to read tab visibility', error);
        return {};
    }
}

async function writeTabVisibility(payload = {}) {
    const settings = await getSettingsCollection();
    const visibility = normalizeTabVisibility(payload);
    const stored = {
        key: 'adminTabs',
        visibility,
        updatedAt: new Date()
    };
    await settings.updateOne({ key: 'adminTabs' }, { $set: stored }, { upsert: true });
    return visibility;
}

function normalizeCategoryName(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim();
}

function normalizeCategoryKey(value) {
    return normalizeCategoryName(value).toLowerCase();
}

function normalizeCategoryRoles(raw = {}) {
    if (!raw || typeof raw !== 'object') {
        return { admin: true, pin_manager: true, resident: true };
    }
    return {
        admin: raw.admin !== false,
        pin_manager: raw.pin_manager !== false,
        resident: raw.resident !== false
    };
}

function normalizeCategoryPayload(rawList = []) {
    if (!Array.isArray(rawList)) {
        return [];
    }
    return rawList
        .map((entry) => {
            if (!entry) {
                return null;
            }
            if (typeof entry === 'string') {
                const name = normalizeCategoryName(entry);
                if (!name) {
                    return null;
                }
                return {
                    id: new ObjectId().toString(),
                    name,
                    roles: normalizeCategoryRoles(),
                    originalName: name
                };
            }
            const name = normalizeCategoryName(entry.name || entry.label || entry.value || '');
            if (!name) {
                return null;
            }
            const id = normalizeCategoryName(entry.id || '') || new ObjectId().toString();
            const originalName = normalizeCategoryName(entry.originalName || entry.previousName || entry.original || '');
            const roles = normalizeCategoryRoles(entry.roles || entry.permissions || entry.allowedRoles || {});
            return {
                id,
                name,
                roles,
                originalName
            };
        })
        .filter(Boolean);
}

function normalizeStoredCategories(rawList = []) {
    return normalizeCategoryPayload(rawList).map((entry) => ({
        id: entry.id,
        name: entry.name,
        roles: normalizeCategoryRoles(entry.roles)
    }));
}

function validateCategoryList(list = []) {
    const seen = new Set();
    for (const entry of list) {
        const name = normalizeCategoryName(entry?.name || '');
        if (!name) {
            return { ok: false, message: 'Nama kategori wajib diisi.' };
        }
        const roles = normalizeCategoryRoles(entry?.roles || {});
        if (!roles.admin && !roles.pin_manager && !roles.resident) {
            return { ok: false, message: `Kategori "${name}" harus punya minimal satu role.` };
        }
        const key = normalizeCategoryKey(name);
        if (seen.has(key)) {
            return { ok: false, message: `Kategori "${name}" sudah ada.` };
        }
        seen.add(key);
    }
    return { ok: true };
}

async function buildCategoriesFromPins() {
    const db = await connectToDatabase();
    const categories = await db.collection('pins').distinct('category');
    const unique = new Map();
    categories.forEach((entry) => {
        const name = normalizeCategoryName(entry || '');
        if (!name) {
            return;
        }
        const key = normalizeCategoryKey(name);
        if (!unique.has(key)) {
            unique.set(key, name);
        }
    });
    const list = Array.from(unique.values()).sort((a, b) => a.localeCompare(b, 'id', { sensitivity: 'base' }));
    return list.map((name) => ({
        id: new ObjectId().toString(),
        name,
        roles: normalizeCategoryRoles()
    }));
}

async function readPinCategories() {
    try {
        const settings = await getSettingsCollection();
        const doc = await settings.findOne({ key: CATEGORY_SETTINGS_KEY });
        const stored = normalizeStoredCategories(doc?.categories || doc?.list || []);
        if (stored.length) {
            return stored.map((entry) => ({
                id: entry.id,
                name: entry.name,
                roles: normalizeCategoryRoles(entry.roles)
            }));
        }
    } catch (error) {
        console.error('Failed to read category settings', error);
    }
    try {
        return await buildCategoriesFromPins();
    } catch (error) {
        console.error('Failed to build categories from pins', error);
        return [];
    }
}

async function writePinCategories(rawCategories = []) {
    const settings = await getSettingsCollection();
    const incoming = normalizeCategoryPayload(rawCategories);
    const validation = validateCategoryList(incoming);
    if (!validation.ok) {
        const err = new Error(validation.message || 'Data kategori tidak valid.');
        err.status = 400;
        throw err;
    }
    const stored = normalizeStoredCategories(incoming).map((entry) => ({
        id: entry.id,
        name: entry.name,
        roles: normalizeCategoryRoles(entry.roles)
    }));
    const currentDoc = await settings.findOne({ key: CATEGORY_SETTINGS_KEY });
    const currentList = normalizeStoredCategories(currentDoc?.categories || []);
    const currentById = new Map(currentList.map((entry) => [entry.id, entry.name]));
    const renamePairs = [];
    incoming.forEach((entry) => {
        const previous = normalizeCategoryName(entry.originalName || '') || currentById.get(entry.id) || '';
        if (!previous) {
            return;
        }
        if (normalizeCategoryName(previous) !== normalizeCategoryName(entry.name)) {
            renamePairs.push({ from: previous, to: entry.name });
        }
    });
    if (renamePairs.length) {
        const db = await connectToDatabase();
        const pins = db.collection('pins');
        for (const rename of renamePairs) {
            await pins.updateMany({ category: rename.from }, { $set: { category: rename.to } });
        }
    }
    await settings.updateOne(
        { key: CATEGORY_SETTINGS_KEY },
        { $set: { key: CATEGORY_SETTINGS_KEY, categories: stored, updatedAt: new Date() } },
        { upsert: true }
    );
    return stored;
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
        .project({ _id: 1, createdAt: 1, updatedAt: 1, category: 1, province: 1, city: 1 })
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
        const province = normalizeLandingText(pin?.province);
        const provinceSlug = slugifyText(province);
        const city = normalizeLandingText(pin?.city);
        const regionSlug = slugifyText(city);
        if (!regionSlug) {
            return;
        }
        if (!regionsByCategory.has(categorySlug)) {
            regionsByCategory.set(categorySlug, new Map());
        }
        const regionMap = regionsByCategory.get(categorySlug);
        const regionKey = provinceSlug ? `${provinceSlug}/${regionSlug}` : regionSlug;
        if (!regionMap.has(regionKey)) {
            regionMap.set(regionKey, { provinceSlug, regionSlug });
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
    const addedProvincePaths = new Set();
    regionsByCategory.forEach((regionMap, categorySlug) => {
        regionMap.forEach(({ provinceSlug, regionSlug }) => {
            // Add province-level entry if not already added
            if (provinceSlug) {
                const provincePath = `${baseUrl}/kategori/${categorySlug}/${provinceSlug}`;
                if (!addedProvincePaths.has(provincePath)) {
                    addedProvincePaths.add(provincePath);
                    entries.push({
                        loc: provincePath,
                        lastmod,
                        changefreq: 'weekly',
                        priority: '0.55'
                    });
                }
            }
            const path = provinceSlug
                ? `${baseUrl}/kategori/${categorySlug}/${provinceSlug}/${regionSlug}`
                : `${baseUrl}/kategori/${categorySlug}/${regionSlug}`;
            entries.push({
                loc: path,
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
    const countBySlug = new Map();
    const labelBySlug = new Map();
    categoriesRaw.forEach((doc) => {
        const label = normalizeLandingText(doc?._id);
        const slug = slugifyText(label);
        if (!slug) {
            return;
        }
        const current = countBySlug.get(slug) || 0;
        countBySlug.set(slug, current + (Number(doc?.count) || 0));
        if (!labelBySlug.has(slug) && label) {
            labelBySlug.set(slug, label);
        }
    });
    const configured = await readPinCategories();
    const configuredList = [];
    const configuredSlugs = new Set();
    configured.forEach((entry) => {
        const label = normalizeLandingText(entry?.name || entry || '');
        const slug = slugifyText(label);
        if (!slug || configuredSlugs.has(slug)) {
            return;
        }
        configuredSlugs.add(slug);
        configuredList.push({ label, slug });
    });
    const categories = configuredList
        .map((item) => ({
            label: item.label,
            slug: item.slug,
            count: countBySlug.get(item.slug) || 0
        }));
    const extras = Array.from(countBySlug.entries())
        .filter(([slug]) => !configuredSlugs.has(slug))
        .map(([slug, count]) => ({
            label: labelBySlug.get(slug) || slug,
            slug,
            count: Number(count) || 0
        }))
        .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));
    categories.push(...extras);

    const regionsRaw = await db.collection('pins')
        .aggregate([
            { $match: activeQuery },
            { $group: { _id: { category: '$category', province: '$province' }, count: { $sum: 1 } } }
        ])
        .toArray();
    const regionsByCategory = new Map();
    regionsRaw.forEach((doc) => {
        const categoryLabel = normalizeLandingText(doc?._id?.category);
        const provinceLabel = normalizeLandingText(doc?._id?.province);
        const categorySlug = slugifyText(categoryLabel);
        const provinceSlug = slugifyText(provinceLabel);
        if (!categorySlug || !provinceSlug) {
            return;
        }
        if (!regionsByCategory.has(categorySlug)) {
            regionsByCategory.set(categorySlug, new Map());
        }
        const regionMap = regionsByCategory.get(categorySlug);
        const existing = regionMap.get(provinceSlug);
        if (existing) {
            existing.count += Number(doc?.count) || 0;
        } else {
            regionMap.set(provinceSlug, {
                label: provinceLabel,
                slug: provinceSlug,
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
    const totalPins = categoriesRaw.reduce((sum, item) => sum + (Number(item?.count) || 0), 0);
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

    const regionTreeRaw = await db.collection('pins')
        .aggregate([
            { $match: activeQuery },
            { $group: { _id: { province: '$province', city: '$city' }, count: { $sum: 1 } } }
        ])
        .toArray();
    const provinceMap = new Map();
    regionTreeRaw.forEach((doc) => {
        const provLabel = normalizeLandingText(doc?._id?.province);
        const cityLabel = normalizeLandingText(doc?._id?.city);
        const provSlug = slugifyText(provLabel);
        if (!provSlug) return;
        if (!provinceMap.has(provSlug)) {
            provinceMap.set(provSlug, { label: provLabel, slug: provSlug, count: 0, cities: new Map() });
        }
        const prov = provinceMap.get(provSlug);
        const cnt = Number(doc?.count) || 0;
        prov.count += cnt;
        const citySlug = slugifyText(cityLabel);
        if (citySlug) {
            const existing = prov.cities.get(citySlug);
            if (existing) {
                existing.count += cnt;
            } else {
                prov.cities.set(citySlug, { label: cityLabel, slug: citySlug, count: cnt });
            }
        }
    });
    const regionTree = Array.from(provinceMap.values())
        .map(p => ({
            label: p.label,
            slug: p.slug,
            count: p.count,
            cities: Array.from(p.cities.values()).sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label))
        }))
        .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));

    const pins = await db.collection('pins')
        .find(activeQuery)
        .project({
            _id: 1,
            title: 1,
            description: 1,
            category: 1,
            province: 1,
            city: 1,
            lifetime: 1,
            createdAt: 1
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();
    return {
        categories,
        regionsByCategory: regionLists,
        totalPins,
        pins,
        regions,
        regionTree
    };
}

async function fetchCategoryLandingData(categorySlug, provinceSlug, regionSlug) {
    const safeCategorySlug = slugifyText(categorySlug);
    const safeProvinceSlug = slugifyText(provinceSlug);
    const safeRegionSlug = slugifyText(regionSlug);
    if (!safeCategorySlug) {
        return null;
    }
    const db = await connectToDatabase();
    const activeQuery = { $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }] };
    let categoryLabel = '';
    const configured = await readPinCategories();
    for (const entry of configured) {
        const normalized = normalizeLandingText(entry?.name || entry || '');
        if (!normalized) {
            continue;
        }
        if (slugifyText(normalized) === safeCategorySlug) {
            categoryLabel = normalized;
            break;
        }
    }
    if (!categoryLabel) {
        const categories = await db.collection('pins').distinct('category', activeQuery);
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
    }
    if (!categoryLabel) {
        return null;
    }
    const categoryQuery = { ...activeQuery, category: categoryLabel };
    // Resolve province label if province slug provided
    let provinceLabel = '';
    if (safeProvinceSlug) {
        const provinces = await db.collection('pins').distinct('province', categoryQuery);
        for (const entry of provinces) {
            const normalized = normalizeLandingText(entry);
            if (!normalized) {
                continue;
            }
            if (slugifyText(normalized) === safeProvinceSlug) {
                provinceLabel = normalized;
                break;
            }
        }
        if (!provinceLabel) {
            return null;
        }
        categoryQuery.province = provinceLabel;
    }
    const regionDocs = await db.collection('pins')
        .aggregate([
            { $match: categoryQuery },
            { $group: { _id: { province: '$province', city: '$city' }, count: { $sum: 1 } } }
        ])
        .toArray();
    const regions = regionDocs
        .map((doc) => {
            const label = normalizeLandingText(doc?._id?.city);
            const slug = slugifyText(label);
            const provLabel = normalizeLandingText(doc?._id?.province);
            const provSlug = slugifyText(provLabel);
            if (!label || !slug) {
                return null;
            }
            return {
                label,
                slug,
                provinceLabel: provLabel || '',
                provinceSlug: provSlug || '',
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
            province: 1,
            city: 1,
            lifetime: 1,
            createdAt: 1,
            updatedAt: 1
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();
    // Build province→city region tree for filter dropdowns
    const regionTreeRaw = await db.collection('pins')
        .aggregate([
            { $match: categoryQuery },
            { $group: { _id: { province: '$province', city: '$city' }, count: { $sum: 1 } } }
        ])
        .toArray();
    const regionTreeMap = new Map();
    for (const doc of regionTreeRaw) {
        const provLabel = normalizeLandingText(doc?._id?.province);
        const provSlug = slugifyText(provLabel);
        const cityLabel = normalizeLandingText(doc?._id?.city);
        const citySlug = slugifyText(cityLabel);
        const count = Number(doc?.count) || 0;
        if (!provLabel || !provSlug) continue;
        if (!regionTreeMap.has(provSlug)) {
            regionTreeMap.set(provSlug, { label: provLabel, slug: provSlug, count: 0, cities: [] });
        }
        const prov = regionTreeMap.get(provSlug);
        prov.count += count;
        if (cityLabel && citySlug) {
            prov.cities.push({ label: cityLabel, slug: citySlug, count });
        }
    }
    const regionTree = Array.from(regionTreeMap.values())
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    for (const prov of regionTree) {
        prov.cities.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    }
    return {
        categoryLabel,
        provinceLabel,
        regionLabel,
        categorySlug: safeCategorySlug,
        provinceSlug: safeProvinceSlug,
        regionSlug: safeRegionSlug,
        pins,
        totalCount,
        regions,
        regionTree
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
    const ogImage = seo?.ogImage || (baseUrl ? `${baseUrl}/icon-512-v2.png` : '');
    const twitterImage = seo?.twitterImage || ogImage;
    const whenLabel = formatPinWhenLabel(pin?.lifetime);
    const province = pin?.province ? String(pin.province).trim() : '';
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
    const provinceHtml = province ? escapeHtml(province) : '';
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
        { label: 'Provinsi', value: provinceHtml },
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
    const ctaAction = mapFocusUrl
        ? `<a class="pin-detail-action pin-detail-action--cta" href="${escapeHtml(mapFocusUrl)}">Temukan lebih banyak di AyaNaon</a>`
        : '';
    const secondaryItems = [
        mapLink ? { href: mapLink, label: 'Arahkan', external: true } : null,
        externalLink ? { href: externalLink, label: 'Website', external: true } : null
    ].filter(Boolean);
    const secondaryHtml = secondaryItems.length
        ? `<div class="pin-detail-actions-row">
            ${secondaryItems.map((item) => {
                const safeHref = escapeHtml(item.href);
                const safeLabel = escapeHtml(item.label);
                return `<a class="pin-detail-action pin-detail-action--secondary" href="${safeHref}" target="_blank" rel="noopener">${safeLabel}</a>`;
            }).join('')}
        </div>`
        : '';
    const actionsHtml = (ctaAction || secondaryHtml)
        ? `<div class="pin-detail-actions">${ctaAction}${secondaryHtml}</div>`
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
  <link rel="icon" href="/favicon-v2.svg" type="image/svg+xml">
  <link rel="icon" href="/icon-192-v2.png" sizes="192x192" type="image/png">
  <link rel="apple-touch-icon" href="/icon-192-v2.png">
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
    .pin-detail-action--cta {
      background: var(--app-accent-strong);
      color: #fff;
      font-size: 15px;
      padding: 14px 16px;
      border-color: var(--app-accent-strong);
    }
    .pin-detail-action--cta:hover,
    .pin-detail-action--cta:focus-visible {
      background: var(--app-accent);
      border-color: var(--app-accent);
    }
    .pin-detail-actions-row {
      display: flex;
      gap: 10px;
    }
    .pin-detail-action--secondary {
      flex: 1;
      font-size: 13px;
      padding: 10px 12px;
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
        <img src="/icon-192-v2.png" alt="AyaNaon">
        <span>AyaNaon</span>
      </a>
      <div class="pin-detail-header-actions">
        <a class="pin-detail-ghost" href="${categoryIndexUrl}">Lihat Kategori</a>
        ${mapFocusUrl ? `<a class="pin-detail-ghost" href="${mapFocusUrl}">Lihat di Peta</a>` : ''}
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
    <footer class="pin-detail-footer">AyaNaon.app powered by Petalytix</footer>
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
    regions,
    regionTree
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
    const backLabel = 'Kembali ke Peta';
    const robots = `${seo?.robotsIndex !== false ? 'index' : 'noindex'},${seo?.robotsFollow !== false ? 'follow' : 'nofollow'}`;
    const ogImage = seo?.ogImage || (baseUrl ? `${baseUrl}/icon-512-v2.png` : '');
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
            const regionHref = `/kategori/${categorySlug}/${regionSlug}`;
            return `<a class="category-card-region" href="${regionHref}">
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
        .map((pin) => {
            if (!pin || !pin._id) return '';
            const pinTitle = typeof pin.title === 'string' && pin.title.trim() ? pin.title.trim() : 'Pin tanpa judul';
            const pinUrl = `/pin/${pin._id}`;
            const pinCity = normalizeLandingText(pin.city);
            const pinCategory = normalizeLandingText(pin.category);
            const pinWhen = formatPinWhenLabel(pin.lifetime);
            const metaParts = [];
            if (pinCategory) metaParts.push(pinCategory);
            if (pinCity) metaParts.push(pinCity);
            if (pinWhen) metaParts.push(pinWhen);
            const metaLabel = metaParts.join(' - ');
            const description = typeof pin.description === 'string' ? pin.description.trim() : '';
            const descriptionText = truncateText(description, 140);
            return `<li class="pin-landing-item">
                <a class="pin-landing-link" href="${pinUrl}">${escapeHtml(pinTitle)}</a>
                ${metaLabel ? `<div class="pin-landing-meta">${escapeHtml(metaLabel)}</div>` : ''}
                ${descriptionText ? `<p class="pin-landing-desc">${escapeHtml(descriptionText)}</p>` : ''}
            </li>`;
        })
        .filter(Boolean)
        .join('');
    const safeRegionTree = Array.isArray(regionTree) ? regionTree : [];
    const provinceOptions = safeRegionTree
        .map((prov) => {
            if (!prov || !prov.slug || !prov.label) return '';
            const countLabel = Number(prov.count) ? ` (${prov.count})` : '';
            return `<option value="${escapeHtml(prov.slug)}">${escapeHtml(prov.label)}${countLabel}</option>`;
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
  <link rel="icon" href="/favicon-v2.svg" type="image/svg+xml">
  <link rel="icon" href="/icon-192-v2.png" sizes="192x192" type="image/png">
  <link rel="apple-touch-icon" href="/icon-192-v2.png">
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
    .pin-landing-filter-reset-col {
      min-width: 0;
      flex: 0 0 auto;
      justify-self: end;
      max-width: 140px;
    }
    .pin-filter-reset {
      border-radius: 12px;
      border: 1px solid var(--app-panel-border);
      background: var(--app-panel-bg);
      color: var(--app-text);
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      backdrop-filter: var(--app-panel-blur);
      transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
    }
    .pin-filter-reset:hover,
    .pin-filter-reset:focus-visible {
      transform: translateY(-1px);
      background: rgba(59, 130, 246, 0.12);
      border-color: rgba(59, 130, 246, 0.4);
      outline: none;
    }
    .pin-landing-pagination {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 20px;
    }
    .pin-page-btn {
      border-radius: 12px;
      border: 1px solid var(--app-panel-border);
      background: var(--app-button-bg);
      color: var(--app-button-text);
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
    }
    .pin-page-btn:hover,
    .pin-page-btn:focus-visible {
      transform: translateY(-1px);
      background: var(--app-button-hover);
      border-color: rgba(59, 130, 246, 0.3);
      outline: none;
    }
    .pin-page-info {
      font-size: 13px;
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
        <img src="/icon-192-v2.png" alt="AyaNaon">
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
          <p class="pin-landing-section-subtitle">Gunakan pencarian, wilayah, dan tanggal untuk menyaring pin.</p>
        </div>
        <div class="pin-landing-filters" data-pin-filter>
          <div class="pin-landing-filter">
            <label for="pin-filter-search">Cari</label>
            <input type="search" id="pin-filter-search" placeholder="Cari judul, kategori, atau kota" aria-label="Cari pin">
          </div>
          <div class="pin-landing-filter">
            <label for="pin-filter-province">Provinsi</label>
            <select id="pin-filter-province" aria-label="Filter provinsi">
              <option value="">Semua provinsi</option>
              ${provinceOptions}
            </select>
          </div>
          <div class="pin-landing-filter">
            <label for="pin-filter-city">Kota</label>
            <select id="pin-filter-city" aria-label="Filter kota">
              <option value="">Semua kota</option>
            </select>
          </div>
          <div class="pin-landing-filter">
            <label for="pin-filter-start">Pilih Tanggal</label>
            <div class="pin-landing-filter-range">
              <input type="date" id="pin-filter-start" aria-label="Tanggal mulai">
              <span>-</span>
              <input type="date" id="pin-filter-end" aria-label="Tanggal akhir">
            </div>
          </div>
          <div class="pin-landing-filter pin-landing-filter-reset-col">
            <label>&nbsp;</label>
            <button type="button" class="pin-filter-reset" id="pin-filter-reset" aria-label="Reset filter">Reset</button>
          </div>
        </div>
        <div class="pin-landing-filter-summary" id="pin-filter-summary"></div>
        <ul class="pin-landing-list" id="pin-filter-list">
          ${pinListHtml}
        </ul>
        <p class="pin-landing-empty" id="pin-filter-empty"${pinDisplayCount ? ' hidden' : ''}>Belum ada pin untuk ditampilkan.</p>
        <div class="pin-landing-pagination" id="pin-pagination"></div>
      </section>
      <script>window.__regionTree = ${JSON.stringify(safeRegionTree)};</script>
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

        var regionTree = window.__regionTree || [];
        var searchInput = document.getElementById('pin-filter-search');
        var provinceSelect = document.getElementById('pin-filter-province');
        var citySelect = document.getElementById('pin-filter-city');
        var startInput = document.getElementById('pin-filter-start');
        var endInput = document.getElementById('pin-filter-end');
        var resetBtn = document.getElementById('pin-filter-reset');
        var list = document.getElementById('pin-filter-list');
        var emptyEl = document.getElementById('pin-filter-empty');
        var summaryEl = document.getElementById('pin-filter-summary');
        var paginationEl = document.getElementById('pin-pagination');
        var currentPage = 1;
        var userLat = null;
        var userLng = null;
        var searchTimer = null;
        var isLoading = false;

        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(function (pos) {
            userLat = pos.coords.latitude;
            userLng = pos.coords.longitude;
            doSearch(1);
          }, function () {});
        }

        function populateCities() {
          var prov = provinceSelect ? provinceSelect.value : '';
          if (!citySelect) return;
          citySelect.innerHTML = '<option value="">Semua kota</option>';
          if (!prov) return;
          for (var i = 0; i < regionTree.length; i++) {
            if (regionTree[i].slug === prov && regionTree[i].cities) {
              for (var j = 0; j < regionTree[i].cities.length; j++) {
                var c = regionTree[i].cities[j];
                var opt = document.createElement('option');
                opt.value = c.slug;
                opt.textContent = c.label + (c.count ? ' (' + c.count + ')' : '');
                citySelect.appendChild(opt);
              }
              break;
            }
          }
        }

        function escapeHtml(str) {
          var div = document.createElement('div');
          div.appendChild(document.createTextNode(str));
          return div.innerHTML;
        }

        function renderPins(data) {
          if (!list) return;
          var pins = data.pins || [];
          if (pins.length === 0) {
            list.innerHTML = '';
            if (emptyEl) emptyEl.hidden = false;
            if (summaryEl) summaryEl.textContent = 'Tidak ada pin ditemukan.';
            if (paginationEl) paginationEl.innerHTML = '';
            return;
          }
          if (emptyEl) emptyEl.hidden = true;
          var html = '';
          for (var i = 0; i < pins.length; i++) {
            var p = pins[i];
            html += '<li class="pin-landing-item">';
            html += '<a class="pin-landing-link" href="' + escapeHtml(p.url || '/pin/' + p._id) + '">' + escapeHtml(p.title || 'Pin tanpa judul') + '</a>';
            if (p.meta) {
              html += '<div class="pin-landing-meta">' + escapeHtml(p.meta) + '</div>';
            }
            if (p.description) {
              html += '<p class="pin-landing-desc">' + escapeHtml(p.description) + '</p>';
            }
            html += '</li>';
          }
          list.innerHTML = html;

          var total = data.total || 0;
          var page = data.page || 1;
          var totalPages = data.totalPages || 1;
          var start = (page - 1) * 10 + 1;
          var end = Math.min(page * 10, total);
          if (summaryEl) {
            summaryEl.textContent = 'Menampilkan ' + start + '-' + end + ' dari ' + total + ' pin.';
          }
          if (paginationEl) {
            if (totalPages <= 1) {
              paginationEl.innerHTML = '';
            } else {
              var pagHtml = '';
              if (page > 1) {
                pagHtml += '<button type="button" class="pin-page-btn" data-page="' + (page - 1) + '">&laquo; Sebelumnya</button>';
              }
              pagHtml += '<span class="pin-page-info">Halaman ' + page + ' dari ' + totalPages + '</span>';
              if (page < totalPages) {
                pagHtml += '<button type="button" class="pin-page-btn" data-page="' + (page + 1) + '">Berikutnya &raquo;</button>';
              }
              paginationEl.innerHTML = pagHtml;
              var pagBtns = paginationEl.querySelectorAll('.pin-page-btn');
              for (var b = 0; b < pagBtns.length; b++) {
                pagBtns[b].addEventListener('click', function (e) {
                  var pg = parseInt(e.currentTarget.getAttribute('data-page'), 10);
                  if (pg) doSearch(pg);
                });
              }
            }
          }
        }

        function doSearch(page) {
          if (isLoading) return;
          currentPage = page || 1;
          var params = [];
          params.push('page=' + currentPage);
          params.push('limit=10');
          var q = searchInput ? searchInput.value.trim() : '';
          if (q) params.push('q=' + encodeURIComponent(q));
          var prov = provinceSelect ? provinceSelect.value : '';
          if (prov) params.push('province=' + encodeURIComponent(prov));
          var city = citySelect ? citySelect.value : '';
          if (city) params.push('city=' + encodeURIComponent(city));
          var dateStart = startInput ? startInput.value : '';
          var dateEnd = endInput ? endInput.value : '';
          if (dateStart) params.push('dateStart=' + encodeURIComponent(dateStart));
          if (dateEnd) params.push('dateEnd=' + encodeURIComponent(dateEnd));
          if (userLat !== null && userLng !== null) {
            params.push('lat=' + userLat);
            params.push('lng=' + userLng);
          }
          isLoading = true;
          if (summaryEl) summaryEl.textContent = 'Memuat...';
          fetch('/api/pins/search?' + params.join('&'))
            .then(function (res) { return res.json(); })
            .then(function (data) {
              isLoading = false;
              renderPins(data);
            })
            .catch(function () {
              isLoading = false;
              if (summaryEl) summaryEl.textContent = 'Gagal memuat pin.';
            });
        }

        if (provinceSelect) {
          provinceSelect.addEventListener('change', function () {
            populateCities();
            doSearch(1);
          });
        }
        if (citySelect) {
          citySelect.addEventListener('change', function () {
            doSearch(1);
          });
        }
        if (searchInput) {
          searchInput.addEventListener('input', function () {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function () { doSearch(1); }, 300);
          });
        }
        if (startInput) {
          startInput.addEventListener('change', function () {
            doSearch(1);
          });
        }
        if (endInput) {
          endInput.addEventListener('change', function () {
            doSearch(1);
          });
        }
        if (resetBtn) {
          resetBtn.addEventListener('click', function () {
            if (searchInput) searchInput.value = '';
            if (provinceSelect) provinceSelect.value = '';
            if (startInput) startInput.value = '';
            if (endInput) endInput.value = '';
            populateCities();
            doSearch(1);
          });
        }
      })();
    </script>
  </body>
  </html>`;
}

function buildCategoryLandingHtml({
    seo,
    baseUrl,
    categoryLabel,
    provinceLabel,
    regionLabel,
    categorySlug,
    provinceSlug,
    regionSlug,
    pins,
    totalCount,
    regions,
    regionTree
}) {
    const heading = regionLabel
        ? `${categoryLabel} di ${regionLabel}${provinceLabel ? `, ${provinceLabel}` : ''}`
        : provinceLabel
            ? `${categoryLabel} di ${provinceLabel}`
            : categoryLabel;
    const pageTitle = truncateText(
        [heading, seo?.title || ''].filter(Boolean).join(' | '),
        70
    );
    const introText = `Temukan ${totalCount} pin ${heading} di AyaNaon. Klik salah satu pin untuk melihat detail.`;
    const metaDescription = truncateText(introText, 160);
    const canonicalPath = regionSlug
        ? `/kategori/${categorySlug}${provinceSlug ? `/${provinceSlug}` : ''}/${regionSlug}`
        : provinceSlug
            ? `/kategori/${categorySlug}/${provinceSlug}`
            : `/kategori/${categorySlug}`;
    const canonicalUrl = baseUrl ? `${baseUrl}${canonicalPath}` : '';
    const backHref = regionSlug
        ? (provinceSlug ? `/kategori/${categorySlug}/${provinceSlug}` : `/kategori/${categorySlug}`)
        : provinceSlug
            ? `/kategori/${categorySlug}`
            : '/kategori';
    const backLabel = regionSlug
        ? (provinceSlug ? `Kembali ke ${provinceLabel || 'provinsi'}` : 'Kembali ke kategori')
        : provinceSlug
            ? 'Kembali ke kategori'
            : 'Kembali ke semua kategori';
    const robots = `${seo?.robotsIndex !== false ? 'index' : 'noindex'},${seo?.robotsFollow !== false ? 'follow' : 'nofollow'}`;
    const ogImage = seo?.ogImage || (baseUrl ? `${baseUrl}/icon-512-v2.png` : '');
    const twitterImage = seo?.twitterImage || ogImage;
    const pinList = Array.isArray(pins) ? pins : [];
    const displayCount = pinList.length;
    const listHtml = pinList
        .map((pin) => buildPinLandingListItem(pin))
        .filter(Boolean)
        .join('');
    const safeRegionTree = (Array.isArray(regionTree) ? regionTree : []).map(p => ({
        label: String(p.label || ''),
        slug: String(p.slug || ''),
        count: Number(p.count) || 0,
        cities: Array.isArray(p.cities) ? p.cities.map(c => ({
            label: String(c.label || ''),
            slug: String(c.slug || ''),
            count: Number(c.count) || 0
        })) : []
    }));
    const provinceOptions = safeRegionTree
        .map((p) => `<option value="${escapeHtml(p.slug)}">${escapeHtml(p.label)}${p.count ? ` (${p.count})` : ''}</option>`)
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
  <link rel="icon" href="/favicon-v2.svg" type="image/svg+xml">
  <link rel="icon" href="/icon-192-v2.png" sizes="192x192" type="image/png">
  <link rel="apple-touch-icon" href="/icon-192-v2.png">
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
    .pin-landing-filter-reset-col {
      min-width: 0;
      flex: 0 0 auto;
      justify-self: end;
      max-width: 140px;
    }
    .pin-filter-reset {
      border-radius: 12px;
      border: 1px solid var(--app-card-border);
      background: var(--app-panel-bg);
      color: var(--app-text);
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .pin-filter-reset:hover,
    .pin-filter-reset:focus-visible {
      background: var(--app-accent-strong);
      color: #fff;
      border-color: var(--app-accent-strong);
    }
    .pin-landing-pagination {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 20px;
    }
    .pin-page-btn {
      border-radius: 12px;
      border: 1px solid var(--app-card-border);
      background: var(--app-button-bg);
      color: var(--app-text);
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .pin-page-btn:hover,
    .pin-page-btn:focus-visible {
      background: var(--app-accent-strong);
      color: #fff;
      border-color: var(--app-accent-strong);
    }
    .pin-page-info {
      font-size: 12px;
      color: var(--app-text-muted);
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
      <img src="/icon-192-v2.png" alt="AyaNaon">
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
      <div class="pin-landing-filters" data-pin-filter>
        <div class="pin-landing-filter">
          <label for="pin-filter-search">Cari</label>
          <input type="search" id="pin-filter-search" placeholder="Cari judul, deskripsi, atau kota" aria-label="Cari pin">
        </div>
        <div class="pin-landing-filter">
          <label for="pin-filter-province">Provinsi</label>
          <select id="pin-filter-province" aria-label="Filter provinsi">
            <option value="">Semua provinsi</option>
            ${provinceOptions}
          </select>
        </div>
        <div class="pin-landing-filter">
          <label for="pin-filter-city">Kota</label>
          <select id="pin-filter-city" aria-label="Filter kota">
            <option value="">Semua kota</option>
          </select>
        </div>
        <div class="pin-landing-filter">
          <label for="pin-filter-start">Pilih Tanggal</label>
          <div class="pin-landing-filter-range">
            <input type="date" id="pin-filter-start" aria-label="Tanggal mulai">
            <span>-</span>
            <input type="date" id="pin-filter-end" aria-label="Tanggal akhir">
          </div>
        </div>
        <div class="pin-landing-filter pin-landing-filter-reset-col">
          <label>&nbsp;</label>
          <button type="button" class="pin-filter-reset" id="pin-filter-reset" aria-label="Reset filter">Reset</button>
        </div>
      </div>
      <div class="pin-landing-filter-summary" id="pin-filter-summary"></div>
      <ul class="pin-landing-list" id="pin-filter-list">
        ${listHtml}
      </ul>
      <p class="pin-landing-empty" id="pin-filter-empty"${displayCount ? ' hidden' : ''}>Belum ada pin untuk kategori ini.</p>
      <div class="pin-landing-pagination" id="pin-pagination"></div>
    </section>
    <footer class="pin-landing-footer">AyaNaon category page</footer>
  </div>
  <script>window.__regionTree = ${JSON.stringify(safeRegionTree)};window.__categorySlug = ${JSON.stringify(categorySlug)};</script>
  <script>
    (function () {
      var regionTree = window.__regionTree || [];
      var categorySlug = window.__categorySlug || '';
      var searchInput = document.getElementById('pin-filter-search');
      var provinceSelect = document.getElementById('pin-filter-province');
      var citySelect = document.getElementById('pin-filter-city');
      var startInput = document.getElementById('pin-filter-start');
      var endInput = document.getElementById('pin-filter-end');
      var resetBtn = document.getElementById('pin-filter-reset');
      var list = document.getElementById('pin-filter-list');
      var emptyEl = document.getElementById('pin-filter-empty');
      var summaryEl = document.getElementById('pin-filter-summary');
      var paginationEl = document.getElementById('pin-pagination');
      var currentPage = 1;
      var userLat = null;
      var userLng = null;
      var searchTimer = null;
      var isLoading = false;

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function (pos) {
          userLat = pos.coords.latitude;
          userLng = pos.coords.longitude;
          doSearch(1);
        }, function () {});
      }

      function populateCities() {
        var prov = provinceSelect ? provinceSelect.value : '';
        if (!citySelect) return;
        citySelect.innerHTML = '<option value="">Semua kota</option>';
        if (!prov) return;
        for (var i = 0; i < regionTree.length; i++) {
          if (regionTree[i].slug === prov && regionTree[i].cities) {
            for (var j = 0; j < regionTree[i].cities.length; j++) {
              var c = regionTree[i].cities[j];
              var opt = document.createElement('option');
              opt.value = c.slug;
              opt.textContent = c.label + (c.count ? ' (' + c.count + ')' : '');
              citySelect.appendChild(opt);
            }
            break;
          }
        }
      }

      function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
      }

      function renderPins(data) {
        if (!list) return;
        var pins = data.pins || [];
        if (pins.length === 0) {
          list.innerHTML = '';
          if (emptyEl) emptyEl.hidden = false;
          if (summaryEl) summaryEl.textContent = 'Tidak ada pin ditemukan.';
          if (paginationEl) paginationEl.innerHTML = '';
          return;
        }
        if (emptyEl) emptyEl.hidden = true;
        var html = '';
        for (var i = 0; i < pins.length; i++) {
          var p = pins[i];
          html += '<li class="pin-landing-item">';
          html += '<a class="pin-landing-link" href="' + escapeHtml(p.url || '/pin/' + p._id) + '">' + escapeHtml(p.title || 'Pin tanpa judul') + '</a>';
          if (p.meta) {
            html += '<div class="pin-landing-meta">' + escapeHtml(p.meta) + '</div>';
          }
          if (p.description) {
            html += '<p class="pin-landing-desc">' + escapeHtml(p.description) + '</p>';
          }
          html += '</li>';
        }
        list.innerHTML = html;

        var total = data.total || 0;
        var page = data.page || 1;
        var totalPages = data.totalPages || 1;
        var start = (page - 1) * 10 + 1;
        var end = Math.min(page * 10, total);
        if (summaryEl) {
          summaryEl.textContent = 'Menampilkan ' + start + '-' + end + ' dari ' + total + ' pin.';
        }
        if (paginationEl) {
          if (totalPages <= 1) {
            paginationEl.innerHTML = '';
          } else {
            var pagHtml = '';
            if (page > 1) {
              pagHtml += '<button type="button" class="pin-page-btn" data-page="' + (page - 1) + '">&laquo; Sebelumnya</button>';
            }
            pagHtml += '<span class="pin-page-info">Halaman ' + page + ' dari ' + totalPages + '</span>';
            if (page < totalPages) {
              pagHtml += '<button type="button" class="pin-page-btn" data-page="' + (page + 1) + '">Berikutnya &raquo;</button>';
            }
            paginationEl.innerHTML = pagHtml;
            var pagBtns = paginationEl.querySelectorAll('.pin-page-btn');
            for (var b = 0; b < pagBtns.length; b++) {
              pagBtns[b].addEventListener('click', function (e) {
                var pg = parseInt(e.currentTarget.getAttribute('data-page'), 10);
                if (pg) doSearch(pg);
              });
            }
          }
        }
      }

      function doSearch(page) {
        if (isLoading) return;
        currentPage = page || 1;
        var params = [];
        params.push('page=' + currentPage);
        params.push('limit=10');
        if (categorySlug) params.push('category=' + encodeURIComponent(categorySlug));
        var q = searchInput ? searchInput.value.trim() : '';
        if (q) params.push('q=' + encodeURIComponent(q));
        var prov = provinceSelect ? provinceSelect.value : '';
        if (prov) params.push('province=' + encodeURIComponent(prov));
        var city = citySelect ? citySelect.value : '';
        if (city) params.push('city=' + encodeURIComponent(city));
        var dateStart = startInput ? startInput.value : '';
        var dateEnd = endInput ? endInput.value : '';
        if (dateStart) params.push('dateStart=' + encodeURIComponent(dateStart));
        if (dateEnd) params.push('dateEnd=' + encodeURIComponent(dateEnd));
        if (userLat !== null && userLng !== null) {
          params.push('lat=' + userLat);
          params.push('lng=' + userLng);
        }
        isLoading = true;
        if (summaryEl) summaryEl.textContent = 'Memuat...';
        fetch('/api/pins/search?' + params.join('&'))
          .then(function (res) { return res.json(); })
          .then(function (data) {
            isLoading = false;
            renderPins(data);
          })
          .catch(function () {
            isLoading = false;
            if (summaryEl) summaryEl.textContent = 'Gagal memuat pin.';
          });
      }

      if (provinceSelect) {
        provinceSelect.addEventListener('change', function () {
          populateCities();
          doSearch(1);
        });
      }
      if (citySelect) {
        citySelect.addEventListener('change', function () {
          doSearch(1);
        });
      }
      if (searchInput) {
        searchInput.addEventListener('input', function () {
          clearTimeout(searchTimer);
          searchTimer = setTimeout(function () { doSearch(1); }, 300);
        });
      }
      if (startInput) {
        startInput.addEventListener('change', function () {
          doSearch(1);
        });
      }
      if (endInput) {
        endInput.addEventListener('change', function () {
          doSearch(1);
        });
      }
      if (resetBtn) {
        resetBtn.addEventListener('click', function () {
          if (searchInput) searchInput.value = '';
          if (provinceSelect) provinceSelect.value = '';
          if (startInput) startInput.value = '';
          if (endInput) endInput.value = '';
          populateCities();
          doSearch(1);
        });
      }
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

async function resolveProvinceCityFromCoords(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }
    try {
        const result = await reverseGeocodeProvinceCity(lat, lng);
        if (!result) {
            return null;
        }
        const province = normalizeLandingText(result.province);
        const city = normalizeLandingText(result.city);
        if (!city) {
            // Fallback to old method for city
            const fallbackCity = await resolveCityFromCoords(lat, lng);
            return fallbackCity ? { province: province || '', city: fallbackCity } : null;
        }
        return { province: province || '', city };
    } catch (error) {
        console.error('Failed to resolve province/city from coordinates', error);
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

router.get('/pins/search', async (req, res) => {
    const db = await connectToDatabase();
    const activeQuery = { $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }] };
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const categorySlugs = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const provinceSlugs = typeof req.query.province === 'string' ? req.query.province.trim() : '';
    const citySlugs = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    const dateStart = typeof req.query.dateStart === 'string' ? req.query.dateStart.trim() : '';
    const dateEnd = typeof req.query.dateEnd === 'string' ? req.query.dateEnd.trim() : '';
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);

    const filter = { ...activeQuery };

    if (q) {
        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = { $regex: escaped, $options: 'i' };
        filter.$and = [
            { $or: [{ title: regex }, { description: regex }, { category: regex }, { city: regex }, { province: regex }] }
        ];
    }

    if (categorySlugs) {
        const allCategories = await db.collection('pins').distinct('category', activeQuery);
        const matched = allCategories.filter(c => c && slugifyText(c) === categorySlugs);
        if (matched.length > 0) {
            filter.category = { $in: matched };
        } else {
            filter.category = '__no_match__';
        }
    }

    if (provinceSlugs) {
        const allPins = await db.collection('pins').distinct('province', activeQuery);
        const matched = allPins.filter(p => p && slugifyText(p) === provinceSlugs);
        if (matched.length > 0) {
            filter.province = { $in: matched };
        } else {
            filter.province = '__no_match__';
        }
    }

    if (citySlugs) {
        const allCities = await db.collection('pins').distinct('city', activeQuery);
        const matched = allCities.filter(c => c && slugifyText(c) === citySlugs);
        if (matched.length > 0) {
            filter.city = { $in: matched };
        } else {
            filter.city = '__no_match__';
        }
    }

    if (dateStart || dateEnd) {
        const todayStr = formatDateToYMD(new Date());
        const rangeStart = dateStart || dateEnd;
        const rangeEnd = dateEnd || dateStart;
        const touchesToday = rangeStart <= todayStr && rangeEnd >= todayStr;
        const dateConditions = [
            {
                'lifetime.type': 'date',
                $or: [
                    { 'lifetime.start': { $lte: rangeEnd }, 'lifetime.end': { $gte: rangeStart } },
                    { 'lifetime.value': { $gte: rangeStart, $lte: rangeEnd } },
                    { 'lifetime.start': { $gte: rangeStart, $lte: rangeEnd } },
                    { 'lifetime.end': { $gte: rangeStart, $lte: rangeEnd } }
                ]
            }
        ];
        if (touchesToday) {
            dateConditions.push({ 'lifetime.type': 'today' });
        }
        if (filter.$and) {
            filter.$and.push({ $or: dateConditions });
        } else {
            filter.$and = [{ $or: dateConditions }];
        }
    }

    const total = await db.collection('pins').countDocuments(filter);

    const sortStage = { createdAt: -1 };

    const pins = await db.collection('pins')
        .find(filter)
        .project({
            _id: 1,
            title: 1,
            description: 1,
            category: 1,
            province: 1,
            city: 1,
            lifetime: 1,
            createdAt: 1,
            lat: 1,
            lng: 1
        })
        .sort(sortStage)
        .skip(skip)
        .limit(limit)
        .toArray();

    let sortedPins = pins;
    if (hasGeo) {
        const toRad = (d) => d * Math.PI / 180;
        const haversine = (lat1, lng1, lat2, lng2) => {
            const R = 6371;
            const dLat = toRad(lat2 - lat1);
            const dLng = toRad(lng2 - lng1);
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        };
        sortedPins = pins.map(p => {
            const pLat = parseFloat(p.lat);
            const pLng = parseFloat(p.lng);
            const dist = (Number.isFinite(pLat) && Number.isFinite(pLng))
                ? haversine(lat, lng, pLat, pLng)
                : 99999;
            return { ...p, _dist: dist };
        }).sort((a, b) => a._dist - b._dist);
        sortedPins.forEach(p => delete p._dist);
    }

    const resultPins = sortedPins.map(p => {
        const pinCity = normalizeLandingText(p.city);
        const pinCategory = normalizeLandingText(p.category);
        const pinProvince = normalizeLandingText(p.province);
        const pinWhen = formatPinWhenLabel(p.lifetime);
        const metaParts = [];
        if (pinCategory) metaParts.push(pinCategory);
        if (pinCity) metaParts.push(pinCity);
        if (pinWhen) metaParts.push(pinWhen);
        return {
            _id: p._id,
            title: typeof p.title === 'string' ? p.title.trim() : 'Pin tanpa judul',
            description: typeof p.description === 'string' ? truncateText(p.description.trim(), 140) : '',
            category: pinCategory,
            province: pinProvince,
            city: pinCity,
            meta: metaParts.join(' - '),
            url: `/pin/${p._id}`
        };
    });

    res.json({
        pins: resultPins,
        total,
        page,
        totalPages: Math.ceil(total / limit) || 1
    });
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

router.get('/tabs-visibility', async (req, res) => {
    const visibility = await readTabVisibility();
    res.json({ visibility });
});

router.put('/tabs-visibility', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat mengubah tab.' });
    }
    try {
        const payload = req.body?.visibility ?? req.body ?? {};
        const visibility = await writeTabVisibility(payload);
        res.json({ visibility });
    } catch (error) {
        console.error('Failed to update tab visibility', error);
        res.status(500).json({ message: 'Tidak dapat memperbarui pengaturan tab.' });
    }
});

router.get('/categories', async (req, res) => {
    const categories = await readPinCategories();
    res.json({ categories });
});

router.put('/categories', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat mengubah kategori.' });
    }
    try {
        const payload = req.body?.categories ?? req.body ?? [];
        const categories = await writePinCategories(payload);
        res.json({ categories });
    } catch (error) {
        console.error('Failed to update categories', error);
        res.status(error.status || 500).json({ message: error.message || 'Tidak dapat memperbarui kategori.' });
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
    const provinceSlug = slugifyText(req.params?.province || '');
    const regionSlug = slugifyText(req.params?.region || '');
    if (!categorySlug) {
        res.status(404).send('Not found');
        return;
    }
    try {
        const data = await fetchCategoryLandingData(categorySlug, provinceSlug, regionSlug);
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

const handleCategoryLegacyRedirect = async (req, res) => {
    const categorySlug = slugifyText(req.params?.category || '');
    const secondSegment = slugifyText(req.params?.region || '');
    if (!categorySlug || !secondSegment) {
        res.status(404).send('Not found');
        return;
    }
    try {
        const db = await connectToDatabase();
        const activeQuery = { $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }] };
        // Check if the second segment is a province slug
        const provinces = await db.collection('pins').distinct('province', activeQuery);
        let isProvince = false;
        for (const entry of provinces) {
            const normalized = normalizeLandingText(entry);
            if (normalized && slugifyText(normalized) === secondSegment) {
                isProvince = true;
                break;
            }
        }
        if (isProvince) {
            // Serve as province page: /kategori/:category/:province
            const data = await fetchCategoryLandingData(categorySlug, secondSegment, '');
            if (!data) {
                res.status(404).send('Not found');
                return;
            }
            const seo = await readSeoSettings();
            const baseUrl = resolveSeoBaseUrl(seo, req);
            const html = buildCategoryLandingHtml({ seo, baseUrl, ...data });
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.set('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800');
            res.send(html);
            return;
        }
        // Not a province — treat as legacy city URL, try to find its province and redirect
        const cityPins = await db.collection('pins')
            .find({ ...activeQuery, province: { $exists: true, $ne: '' } })
            .project({ province: 1, city: 1 })
            .toArray();
        let provinceSlug = '';
        for (const p of cityPins) {
            const cityLabel = normalizeLandingText(p.city);
            if (slugifyText(cityLabel) === secondSegment) {
                const provLabel = normalizeLandingText(p.province);
                provinceSlug = slugifyText(provLabel);
                break;
            }
        }
        if (provinceSlug) {
            res.redirect(301, `/kategori/${categorySlug}/${provinceSlug}/${secondSegment}`);
        } else {
            // Province not found yet (not backfilled), serve the page with province-less data
            const data = await fetchCategoryLandingData(categorySlug, '', secondSegment);
            if (!data) {
                res.status(404).send('Not found');
                return;
            }
            const seo = await readSeoSettings();
            const baseUrl = resolveSeoBaseUrl(seo, req);
            const html = buildCategoryLandingHtml({ seo, baseUrl, ...data });
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.set('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800');
            res.send(html);
        }
    } catch (error) {
        console.error('Failed to handle legacy category redirect', error);
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
                const resolvedLocation = await resolveProvinceCityFromCoords(lat, lng);
                if (!resolvedLocation || !resolvedLocation.city) {
                    summary.skipped += 1;
                    continue;
                }
                const setFields = { city: resolvedLocation.city };
                if (resolvedLocation.province) {
                    setFields.province = resolvedLocation.province;
                }
                const updateResult = await db.collection('pins').updateOne(
                    { _id: pin._id },
                    { $set: setFields }
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

router.post('/admin/pins/backfill-provinces', async (req, res) => {
    try {
        const authResident = await authenticateResidentRequest(req, res, { optional: true });
        if (!authResident || authResident.role !== 'admin') {
            const admin = await authenticateRequest(req, res);
            if (!admin) return;
        }
        const db = await connectToDatabase();
        const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 500);
        const dryRun = req.query?.dryRun === 'true';
        const missingProvinceQuery = {
            $or: [
                { province: { $exists: false } },
                { province: null },
                { province: '' }
            ],
            lat: { $exists: true },
            lng: { $exists: true }
        };
        const remainingBefore = await db.collection('pins').countDocuments(missingProvinceQuery);
        if (dryRun) {
            return res.json({
                dryRun: true,
                limit,
                remaining: remainingBefore
            });
        }
        const pins = await db.collection('pins')
            .find(missingProvinceQuery)
            .limit(limit)
            .toArray();
        const summary = {
            processed: 0,
            updated: 0,
            skipped: 0,
            errors: 0
        };
        // Build areas directory for fuzzy city-to-province lookup
        const areas = await getAreasDirectory();
        function findProvinceByCity(cityName) {
            if (!cityName || !areas || !areas.length) return '';
            const normCity = normalizeForAreaMatch(cityName);
            if (!normCity) return '';
            for (const area of areas) {
                const provinceName = area.nameId || '';
                if (!provinceName) continue;
                for (const c of (area.cities || [])) {
                    const cityAliases = (c.aliases || []).map(normalizeForAreaMatch);
                    cityAliases.push(normalizeForAreaMatch(c.nameId), normalizeForAreaMatch(c.nameEn));
                    const match = cityAliases.some(a => a && (a === normCity || normCity.includes(a) || a.includes(normCity)));
                    if (match) return provinceName;
                }
            }
            return '';
        }
        const sampleUpdatedIds = [];
        for (const pin of pins) {
            summary.processed += 1;
            try {
                let province = '';
                // First try to resolve province from existing city via areas directory
                const pinCity = typeof pin.city === 'string' ? pin.city.trim() : '';
                if (pinCity) {
                    province = findProvinceByCity(pinCity);
                }
                // Fallback to geocode if city lookup didn't find province
                if (!province) {
                    const lat = Number(pin?.lat);
                    const lng = Number(pin?.lng);
                    if (Number.isFinite(lat) && Number.isFinite(lng)) {
                        const result = await reverseGeocodeProvinceCity(lat, lng);
                        if (result && result.province) {
                            province = result.province;
                        }
                    }
                }
                if (!province) {
                    summary.skipped += 1;
                    continue;
                }
                const setFields = { province };
                const updateResult = await db.collection('pins').updateOne(
                    { _id: pin._id },
                    { $set: setFields }
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
                console.error('Failed to backfill province for pin', pin?._id, error);
            }
        }
        const remainingAfter = await db.collection('pins').countDocuments(missingProvinceQuery);
        res.json({
            dryRun: false,
            limit,
            remainingBefore,
            remainingAfter,
            ...summary,
            sampleUpdatedIds
        });
    } catch (error) {
        console.error('Failed to backfill pin provinces', error);
        res.status(500).json({ message: 'Tidak dapat melakukan backfill provinsi.' });
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
    try {
        const db = await connectToDatabase();
        const pin = req.body || {};
        const title = typeof pin.title === 'string' ? pin.title.trim() : '';
        const description = typeof pin.description === 'string' ? pin.description.trim() : '';
        const category = typeof pin.category === 'string' ? pin.category.trim() : '';
        const lat = Number(pin.lat);
        const lng = Number(pin.lng);
        if (!title || !description || !category) {
            return res.status(400).json({ message: 'Judul, deskripsi, dan kategori wajib diisi.' });
        }
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return res.status(400).json({ message: 'Koordinat pin tidak valid.' });
        }
        pin.title = title;
        pin.description = description;
        pin.category = category;
        pin.lat = lat;
        pin.lng = lng;
        pin.createdAt = new Date();
        pin.reporter = req.headers['x-nf-client-connection-ip'];
        pin.upvotes = 0;
        pin.downvotes = 0;
        pin.upvoterIps = [];
        pin.downvoterIps = [];

        pin.expiresAt = computeExpiresAtFromLifetime(pin.lifetime);

        if (Array.isArray(pin.images) && pin.images.length) {
            pin.images = normalizeIncomingPinImages([], pin.images);
        }
        pin.imageCount = Array.isArray(pin.images) ? pin.images.length : 0;

        // Get province and city from lat/lng (with OSM fallback)
        const resolvedLocation = await resolveProvinceCityFromCoords(lat, lng);
        if (resolvedLocation) {
            pin.province = resolvedLocation.province;
            pin.city = resolvedLocation.city;
        }

        const result = await db.collection('pins').insertOne(pin);
        const insertedPin = await db.collection('pins').findOne({ _id: result.insertedId });
        res.json(insertedPin);
    } catch (error) {
        console.error('Failed to create pin', error);
        res.status(500).json({ message: 'Gagal menambahkan pin. Coba lagi.' });
    }
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
        const resolvedLocation = await resolveProvinceCityFromCoords(parsedLat, parsedLng);
        if (resolvedLocation) {
            updatedPin.province = resolvedLocation.province;
            updatedPin.city = resolvedLocation.city;
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

// ── Brand Management Endpoints ───────────────────

router.get('/admin/brands', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat mengelola brand.' });
    }
    try {
        const db = await connectToDatabase();
        const brands = await db.collection('brands').find({}).sort({ name: 1 }).toArray();
        const payload = brands.map((b) => ({
            id: b._id.toString(),
            name: b.name,
            locations: b.locations || [],
            createdAt: b.createdAt,
            updatedAt: b.updatedAt
        }));
        res.json({ brands: payload });
    } catch (error) {
        console.error('Failed to fetch brands', error);
        res.status(500).json({ message: 'Tidak dapat memuat daftar brand.' });
    }
});

router.post('/admin/brands', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat mengelola brand.' });
    }
    try {
        const db = await connectToDatabase();
        const { name, locations } = req.body || {};
        const brandName = typeof name === 'string' ? name.trim() : '';
        if (!brandName) {
            return res.status(400).json({ message: 'Nama brand wajib diisi.' });
        }
        if (!Array.isArray(locations) || !locations.length) {
            return res.status(400).json({ message: 'Pilih setidaknya satu lokasi.' });
        }
        // Find or create the brand (case-insensitive match)
        let brand = await db.collection('brands').findOne({
            name: { $regex: new RegExp('^' + brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
        });
        const now = new Date();
        if (!brand) {
            const insertResult = await db.collection('brands').insertOne({
                name: brandName,
                locations: [],
                createdAt: now,
                updatedAt: now
            });
            brand = await db.collection('brands').findOne({ _id: insertResult.insertedId });
        }
        const existingLocations = brand.locations || [];
        const DUPLICATE_THRESHOLD = 0.0005; // ~50 meters
        const added = [];
        const skipped = [];

        // First pass: filter out invalid/duplicate locations
        const toProcess = [];
        for (const loc of locations) {
            const placeId = loc.placeId || loc.id || '';
            const lat = Number(loc.lat);
            const lng = Number(loc.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                skipped.push(loc.name || 'Unknown');
                continue;
            }
            const isDuplicate = existingLocations.some((existing) => {
                if (existing.placeId && existing.placeId === placeId) return true;
                const dLat = Math.abs(existing.lat - lat);
                const dLng = Math.abs(existing.lng - lng);
                if (existing.name === (loc.name || '') && dLat < DUPLICATE_THRESHOLD && dLng < DUPLICATE_THRESHOLD) return true;
                return false;
            });
            if (isDuplicate) {
                skipped.push(loc.name || placeId);
                continue;
            }
            toProcess.push({ loc, placeId, lat, lng });
        }

        // Second pass: resolve province/city in parallel for locations that need geocoding
        const geoPromises = toProcess.map(async ({ loc, placeId, lat, lng }) => {
            const clientProvince = typeof loc.province === 'string' ? loc.province.trim() : '';
            const clientCity = typeof loc.city === 'string' ? loc.city.trim() : '';
            let province = clientProvince;
            let city = clientCity;
            if (!province || !city) {
                try {
                    const geo = await reverseGeocodeProvinceCity(lat, lng);
                    if (!province) province = geo?.province || '';
                    if (!city) city = geo?.city || '';
                } catch (_) {
                    // Geocode failed, leave empty
                }
            }
            return {
                placeId,
                name: loc.name || '',
                address: loc.address || '',
                lat,
                lng,
                province,
                city,
                addedAt: now
            };
        });

        const resolvedLocations = await Promise.all(geoPromises);
        for (const newLoc of resolvedLocations) {
            existingLocations.push(newLoc);
            added.push(newLoc);
        }
        await db.collection('brands').updateOne(
            { _id: brand._id },
            { $set: { locations: existingLocations, updatedAt: now } }
        );
        const updated = await db.collection('brands').findOne({ _id: brand._id });
        res.json({
            brand: {
                id: updated._id.toString(),
                name: updated.name,
                locations: updated.locations,
                createdAt: updated.createdAt,
                updatedAt: updated.updatedAt
            },
            added: added.length,
            skipped: skipped.length,
            skippedNames: skipped
        });
    } catch (error) {
        console.error('Failed to create/update brand', error);
        res.status(500).json({ message: 'Gagal menyimpan brand.' });
    }
});

router.put('/admin/brands/:id', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat mengelola brand.' });
    }
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Brand id tidak valid.' });
    }
    const newName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!newName) {
        return res.status(400).json({ message: 'Nama brand wajib diisi.' });
    }
    try {
        const db = await connectToDatabase();
        const result = await db.collection('brands').findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: { name: newName, updatedAt: new Date() } },
            { returnDocument: 'after' }
        );
        const brand = result.value || result;
        if (!brand) {
            return res.status(404).json({ message: 'Brand tidak ditemukan.' });
        }
        res.json({
            brand: {
                id: brand._id.toString(),
                name: brand.name,
                locations: brand.locations || [],
                createdAt: brand.createdAt,
                updatedAt: brand.updatedAt
            }
        });
    } catch (error) {
        console.error('Failed to rename brand', error);
        res.status(500).json({ message: 'Gagal mengubah nama brand.' });
    }
});

router.delete('/admin/brands/:id', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat mengelola brand.' });
    }
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Brand id tidak valid.' });
    }
    try {
        const db = await connectToDatabase();
        const result = await db.collection('brands').deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Brand tidak ditemukan.' });
        }
        res.json({ ok: true });
    } catch (error) {
        console.error('Failed to delete brand', error);
        res.status(500).json({ message: 'Gagal menghapus brand.' });
    }
});

router.delete('/admin/brands/:id/locations/:placeId', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat mengelola brand.' });
    }
    const { id, placeId } = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Brand id tidak valid.' });
    }
    try {
        const db = await connectToDatabase();
        const result = await db.collection('brands').findOneAndUpdate(
            { _id: new ObjectId(id) },
            {
                $pull: { locations: { placeId: placeId } },
                $set: { updatedAt: new Date() }
            },
            { returnDocument: 'after' }
        );
        const brand = result.value || result;
        if (!brand) {
            return res.status(404).json({ message: 'Brand tidak ditemukan.' });
        }
        res.json({
            brand: {
                id: brand._id.toString(),
                name: brand.name,
                locations: brand.locations || [],
                createdAt: brand.createdAt,
                updatedAt: brand.updatedAt
            }
        });
    } catch (error) {
        console.error('Failed to remove location from brand', error);
        res.status(500).json({ message: 'Gagal menghapus lokasi dari brand.' });
    }
});

// ── Area Directory Endpoints ──────────────────────────────────────

router.get('/areas', async (req, res) => {
    try {
        const areas = await getAreasDirectory();
        res.json({ areas: areas.map(a => ({ id: a._id.toString(), nameId: a.nameId, nameEn: a.nameEn, aliases: a.aliases || [], cities: a.cities || [] })) });
    } catch (error) {
        console.error('Failed to fetch areas', error);
        res.status(500).json({ message: 'Tidak dapat memuat daftar area.' });
    }
});

router.get('/admin/areas', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat mengelola area.' });
    }
    try {
        const db = await connectToDatabase();
        const areas = await db.collection('areas').find({}).sort({ nameId: 1 }).toArray();
        res.json({ areas: areas.map(a => ({ id: a._id.toString(), nameId: a.nameId, nameEn: a.nameEn, aliases: a.aliases || [], cities: a.cities || [], updatedAt: a.updatedAt })) });
    } catch (error) {
        console.error('Failed to fetch areas', error);
        res.status(500).json({ message: 'Tidak dapat memuat daftar area.' });
    }
});

router.post('/admin/areas/seed', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat mengelola area.' });
    }
    try {
        const db = await connectToDatabase();
        const existing = await db.collection('areas').countDocuments();
        if (existing > 0 && req.query.force !== 'true') {
            return res.status(400).json({ message: `Sudah ada ${existing} provinsi. Gunakan ?force=true untuk menimpa.` });
        }
        if (req.query.force === 'true' && existing > 0) {
            await db.collection('areas').deleteMany({});
        }
        const now = new Date();
        const docs = INDONESIA_AREAS_SEED.map(p => ({ ...p, updatedAt: now }));
        await db.collection('areas').insertMany(docs);
        areasCache = null;
        areasCacheExpiresAt = 0;
        res.json({ message: `Berhasil menambahkan ${docs.length} provinsi.`, count: docs.length });
    } catch (error) {
        console.error('Failed to seed areas', error);
        res.status(500).json({ message: 'Gagal seed data area.' });
    }
});

router.post('/admin/areas', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat mengelola area.' });
    }
    try {
        const { nameId, nameEn, aliases, cities } = req.body;
        if (!nameId || !nameEn) {
            return res.status(400).json({ message: 'nameId dan nameEn wajib diisi.' });
        }
        const db = await connectToDatabase();
        const doc = {
            nameId: nameId.trim(),
            nameEn: nameEn.trim(),
            aliases: (aliases || []).map(a => a.toLowerCase().trim()).filter(Boolean),
            cities: (cities || []).map(c => ({
                nameId: (c.nameId || '').trim(),
                nameEn: (c.nameEn || '').trim(),
                aliases: (c.aliases || []).map(a => a.toLowerCase().trim()).filter(Boolean)
            })),
            updatedAt: new Date()
        };
        const result = await db.collection('areas').insertOne(doc);
        areasCache = null;
        areasCacheExpiresAt = 0;
        res.json({ area: { id: result.insertedId.toString(), ...doc } });
    } catch (error) {
        console.error('Failed to create area', error);
        res.status(500).json({ message: 'Gagal menambah provinsi.' });
    }
});

router.put('/admin/areas/:id', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat mengelola area.' });
    }
    try {
        const db = await connectToDatabase();
        let oid;
        try { oid = new ObjectId(req.params.id); } catch (_) {
            return res.status(400).json({ message: 'ID tidak valid.' });
        }
        const { nameId, nameEn, aliases, cities } = req.body;
        const update = { updatedAt: new Date() };
        if (nameId !== undefined) update.nameId = nameId.trim();
        if (nameEn !== undefined) update.nameEn = nameEn.trim();
        if (aliases !== undefined) update.aliases = aliases.map(a => a.toLowerCase().trim()).filter(Boolean);
        if (cities !== undefined) update.cities = cities.map(c => ({
            nameId: (c.nameId || '').trim(),
            nameEn: (c.nameEn || '').trim(),
            aliases: (c.aliases || []).map(a => a.toLowerCase().trim()).filter(Boolean)
        }));
        const result = await db.collection('areas').findOneAndUpdate(
            { _id: oid },
            { $set: update },
            { returnDocument: 'after' }
        );
        if (!result.value && !result) {
            return res.status(404).json({ message: 'Provinsi tidak ditemukan.' });
        }
        areasCache = null;
        areasCacheExpiresAt = 0;
        const doc = result.value || result;
        res.json({ area: { id: doc._id.toString(), nameId: doc.nameId, nameEn: doc.nameEn, aliases: doc.aliases || [], cities: doc.cities || [], updatedAt: doc.updatedAt } });
    } catch (error) {
        console.error('Failed to update area', error);
        res.status(500).json({ message: 'Gagal memperbarui provinsi.' });
    }
});

router.delete('/admin/areas/:id', async (req, res) => {
    const resident = await authenticateResidentRequest(req, res);
    if (!resident) return;
    if (!resident.isAdmin) {
        return res.status(403).json({ message: 'Hanya admin yang dapat mengelola area.' });
    }
    try {
        const db = await connectToDatabase();
        let oid;
        try { oid = new ObjectId(req.params.id); } catch (_) {
            return res.status(400).json({ message: 'ID tidak valid.' });
        }
        const result = await db.collection('areas').deleteOne({ _id: oid });
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Provinsi tidak ditemukan.' });
        }
        areasCache = null;
        areasCacheExpiresAt = 0;
        res.json({ message: 'Provinsi berhasil dihapus.' });
    } catch (error) {
        console.error('Failed to delete area', error);
        res.status(500).json({ message: 'Gagal menghapus provinsi.' });
    }
});

app.get('/sitemap.xml', handleSitemapRequest);
app.get('/robots.txt', handleRobotsRequest);
app.get('/pin/:id', handlePinPageRequest);
app.get('/kategori', handleCategoryIndexRequest);
app.get('/kategori/', handleCategoryIndexRequest);
app.get('/kategori/:category', handleCategoryLandingRequest);
app.get('/kategori/:category/:province/:region', handleCategoryLandingRequest);
app.get('/kategori/:category/:region', handleCategoryLegacyRedirect);

app.use('/api', router);

module.exports.handler = serverless(app);

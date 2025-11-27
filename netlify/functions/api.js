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
const client = new MongoClient(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
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
    const adminFlag = isAdminResident(doc);
    sanitized.isAdmin = adminFlag;
    sanitized.role = adminFlag ? 'admin' : 'resident';
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
    const isAdmin = isAdminResident(resident);
    const role = isAdmin ? 'admin' : 'resident';
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
        const allowedRoles = new Set(['resident', 'admin', undefined]);
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
        const isAdmin = isAdminResident(resident);
        return {
            ...resident,
            isAdmin,
            role: isAdmin ? 'admin' : 'resident'
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
            statusMessage: '',
            badgesGiven: 0,
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
        const { statusMessage } = payload;
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
    if (!GOOGLE_MAPS_API_KEY) {
        return null;
    }
    try {
        const response = await axios.get(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`
        );
        const results = response.data?.results || [];
        if (!results.length) {
            return null;
        }
        for (const component of results[0].address_components || []) {
            if (component.types && component.types.includes('administrative_area_level_2')) {
                return component.long_name;
            }
        }
    } catch (error) {
        console.error('Failed to resolve city from coordinates', error);
    }
    return null;
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

    console.log('Executing pins query:', query);
    const pins = await db.collection('pins').find(query).toArray();
    res.json(pins);
});

router.get('/pins/count', async (req, res) => {
    const db = await connectToDatabase();
    const count = await db.collection('pins').countDocuments({ $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }] });
    res.json({ count: count });
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

    // Get city from lat/lng
    try {
        const response = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${pin.lat},${pin.lng}&key=${GOOGLE_MAPS_API_KEY}`);
        const results = response.data.results;
        if (results.length > 0) {
            for (const component of results[0].address_components) {
                if (component.types.includes('administrative_area_level_2')) {
                    pin.city = component.long_name;
                    break;
                }
            }
        }
    } catch (error) {
        console.error('Error getting city from geocoding API:', error);
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

    const isAdmin = Boolean(authResident?.isAdmin);
    const isReporter = pin.reporter === ip;

    if (!isReporter && !isAdmin) {
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
    } else if (incomingImages === null) {
        updatedPin.images = [];
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
    const isAdmin = Boolean(authResident?.isAdmin);
    const isReporter = pin.reporter === ip;
    if (!isAdmin && !isReporter) {
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

app.use('/api', router);

module.exports.handler = serverless(app);

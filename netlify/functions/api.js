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
    JWT_SECRET = 'ayanaon-dev-secret'
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
    return sanitized;
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
    return jwt.sign(
        {
            sub: resident._id.toString(),
            role: 'resident',
            username: resident.username
        },
        JWT_SECRET,
        { expiresIn: '30d' }
    );
}

async function authenticateResidentRequest(req, res) {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
        res.status(401).json({ message: 'Token tidak ditemukan.' });
        return null;
    }
    const token = authHeader.slice(7);
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (!payload?.sub || (payload.role && payload.role !== 'resident')) {
            res.status(401).json({ message: 'Token tidak valid.' });
            return null;
        }
        const residents = await getResidentsCollection();
        const resident = await residents.findOne({ _id: new ObjectId(payload.sub) });
        if (!resident) {
            res.status(401).json({ message: 'Token tidak dikenal.' });
            return null;
        }
        return resident;
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

router.post('/pins', async (req, res) => {
    const db = await connectToDatabase();
    const pin = req.body;
    pin.createdAt = new Date();
    pin.reporter = req.headers['x-nf-client-connection-ip']; // Add this line
    pin.upvotes = 0;
    pin.downvotes = 0;
    pin.upvoterIps = [];
    pin.downvoterIps = [];

    // Calculate expiresAt (support single date or range)
    if (pin.lifetime) {
        let expiresAt = null;
        if (pin.lifetime.type === 'today') {
            expiresAt = new Date();
            expiresAt.setHours(23, 59, 59, 999);
        } else if (pin.lifetime.type === 'date') {
            if (pin.lifetime.end) {
                expiresAt = new Date(pin.lifetime.end);
                expiresAt.setHours(23, 59, 59, 999);
            } else if (pin.lifetime.value || pin.lifetime.start) {
                const basis = pin.lifetime.value || pin.lifetime.start;
                expiresAt = new Date(basis);
                expiresAt.setHours(23, 59, 59, 999);
            }
        }
        pin.expiresAt = expiresAt;
    } else {
        pin.expiresAt = null; // Or a default expiration if you want
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
    const pin = await db.collection('pins').findOne({ _id: new ObjectId(id) });

    if (pin.reporter !== ip) {
        return res.status(403).json({ message: 'You are not authorized to edit this pin.' });
    }

    const { title, description, category, link, lifetime } = req.body;
    const updatedPin = {
        title,
        description,
        category,
        link,
        lifetime
    };

    const result = await db.collection('pins').updateOne({ _id: new ObjectId(id) }, { $set: updatedPin });
    res.json(result);
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

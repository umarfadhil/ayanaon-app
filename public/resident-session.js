(function () {
    const STORAGE_KEY = 'ayanaon_resident_session';
    const SHARED_RESIDENTS_TTL_MS = 15000;
    const listeners = new Set();

    let currentSession = loadSession();
    let sharedResidentsCache = [];
    let sharedResidentsFetchedAt = 0;
    let sharedResidentsPromise = null;
    let profileRefreshPromise = null;

    function loadSession() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return { token: '', resident: null };
            }
            const parsed = JSON.parse(raw);
            return {
                token: typeof parsed?.token === 'string' ? parsed.token : '',
                resident: parsed?.resident && typeof parsed.resident === 'object' ? parsed.resident : null
            };
        } catch (error) {
            console.warn('ResidentSession: gagal memuat sesi dari storage', error);
            return { token: '', resident: null };
        }
    }

    function persistSession(session) {
        try {
            if (!session || !session.token) {
                localStorage.removeItem(STORAGE_KEY);
                return;
            }
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    token: session.token,
                    resident: session.resident || null
                })
            );
        } catch (error) {
            console.warn('ResidentSession: gagal menyimpan sesi', error);
        }
    }

    function getState() {
        return {
            token: currentSession.token,
            resident: currentSession.resident,
            isLoggedIn: Boolean(currentSession.token && currentSession.resident)
        };
    }

    function notifyListeners() {
        const state = getState();
        listeners.forEach((listener) => {
            try {
                listener(state);
            } catch (error) {
                console.warn('ResidentSession: listener error', error);
            }
        });
    }

    function clearSession() {
        if (currentSession?.resident?.username) {
            const key = String(currentSession.resident.username).toLowerCase();
            const index = sharedResidentsCache.findIndex(
                (entry) => String(entry.username).toLowerCase() === key
            );
            if (index !== -1) {
                sharedResidentsCache.splice(index, 1);
            }
        }
        currentSession = { token: '', resident: null };
        sharedResidentsFetchedAt = 0;
        persistSession(null);
        notifyListeners();
    }

    function setSession(session) {
        if (!session || !session.token) {
            clearSession();
            return;
        }
        currentSession = {
            token: session.token,
            resident: session.resident || null
        };
        persistSession(currentSession);
        if (session.resident) {
            upsertSharedResidentEntry(session.resident);
        }
        notifyListeners();
    }

    function updateResidentState(resident) {
        currentSession = {
            token: currentSession.token,
            resident: resident || null
        };
        if (currentSession.token) {
            persistSession(currentSession);
        } else {
            persistSession(null);
        }
        if (resident) {
            upsertSharedResidentEntry(resident);
        }
        notifyListeners();
    }

    function normalizeSharedResident(resident) {
        if (!resident || !resident.username) {
            return null;
        }
        const { lastLocation } = resident;
        if (!lastLocation || typeof lastLocation !== 'object') {
            return null;
        }
        const lat = Number(lastLocation.lat);
        const lng = Number(lastLocation.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return null;
        }
        let photoUrl = null;
        const photo = resident.photo;
        const statusMessage = typeof resident.statusMessage === 'string' ? resident.statusMessage.trim() : '';
        if (photo && photo.data) {
            const contentType = photo.contentType || 'image/jpeg';
            photoUrl = `data:${contentType};base64,${photo.data}`;
        }
        return {
            username: resident.username,
            displayName: resident.displayName || resident.username,
            badgesGiven: Number(resident.badgesGiven) || 0,
            lastLocation: { lat, lng },
            photoUrl,
            statusMessage
        };
    }

    function upsertSharedResidentEntry(resident) {
        const key = String(resident?.username || '').toLowerCase();
        if (!key) {
            return;
        }
        const normalized = normalizeSharedResident(resident);
        const index = sharedResidentsCache.findIndex(
            (entry) => String(entry.username || '').toLowerCase() === key
        );
    if (!normalized || resident.shareLocation === false) {
        if (index !== -1) {
            sharedResidentsCache.splice(index, 1);
        }
        sharedResidentsFetchedAt = Date.now();
        return;
    }
        if (index !== -1) {
            sharedResidentsCache[index] = normalized;
        } else {
            sharedResidentsCache.push(normalized);
        }
        sharedResidentsFetchedAt = Date.now();
    }

    async function apiRequest(path, options = {}) {
        const {
            method = 'GET',
            body,
            auth = true,
            headers: customHeaders = {}
        } = options;

        const headers = new Headers(customHeaders);
        if (body && !(body instanceof FormData) && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }
        if (auth) {
            if (!currentSession.token) {
                throw new Error('Sesi warga belum tersedia. Silakan login kembali.');
            }
            headers.set('Authorization', `Bearer ${currentSession.token}`);
        }

        const response = await fetch(path, {
            method,
            body,
            headers
        });

        const payload = await response.json().catch(() => ({}));
        if (response.status === 401 && auth) {
            clearSession();
            throw new Error(payload?.message || 'Sesi telah kadaluarsa. Silakan login lagi.');
        }
        if (!response.ok) {
            throw new Error(payload?.message || 'Permintaan gagal diproses.');
        }
        return payload;
    }

    async function registerResident({ username, password, displayName, photo }) {
        const body = { username, password, displayName };
        if (photo) {
            body.photo = photo;
        }
        const payload = await apiRequest('/api/residents/register', {
            method: 'POST',
            auth: false,
            body: JSON.stringify(body)
        });
        if (payload?.token) {
            setSession({ token: payload.token, resident: payload.resident || null });
        } else if (payload?.resident) {
            updateResidentState(payload.resident);
        }
        return payload?.resident || null;
    }

    async function loginResident({ username, password }) {
        const payload = await apiRequest('/api/residents/login', {
            method: 'POST',
            auth: false,
            body: JSON.stringify({ username, password })
        });
        if (payload?.token) {
            setSession({ token: payload.token, resident: payload.resident || null });
        } else if (payload?.resident) {
            updateResidentState(payload.resident);
        }
        return payload?.resident || null;
    }

    async function updateResidentProfile(params = {}) {
        const { displayName, photo, removePhoto, statusMessage } = params || {};
        const body = {};
        if (Object.prototype.hasOwnProperty.call(params, 'displayName')) {
            body.displayName = displayName;
        }
        if (Object.prototype.hasOwnProperty.call(params, 'photo')) {
            body.photo = photo;
        }
        if (removePhoto === true) {
            body.removePhoto = true;
        }
        if (Object.prototype.hasOwnProperty.call(params, 'statusMessage')) {
            body.statusMessage = statusMessage;
        }
        if (!Object.keys(body).length) {
            throw new Error('Tidak ada perubahan yang dikirim.');
        }
        const payload = await apiRequest('/api/residents/me', {
            method: 'PUT',
            body: JSON.stringify(body)
        });
        if (payload?.resident) {
            updateResidentState(payload.resident);
        }
        return payload?.resident || null;
    }

    async function refreshProfile() {
        if (!currentSession.token) {
            return null;
        }
        if (profileRefreshPromise) {
            return profileRefreshPromise;
        }
        profileRefreshPromise = (async () => {
            try {
                const payload = await apiRequest('/api/residents/me');
                if (payload?.resident) {
                    updateResidentState(payload.resident);
                    return payload.resident;
                }
                return null;
            } catch (error) {
                throw error;
            } finally {
                profileRefreshPromise = null;
            }
        })();
        return profileRefreshPromise;
    }

    async function logoutResident() {
        if (currentSession.token) {
            try {
                await apiRequest('/api/residents/share', {
                    method: 'POST',
                    body: JSON.stringify({ shareLocation: false })
                });
            } catch (error) {
                console.warn('ResidentSession: gagal menonaktifkan lokasi saat logout', error);
            }
        }
        clearSession();
    }

    async function setShareLocation(enabled, options = {}) {
        const body = {
            shareLocation: Boolean(enabled)
        };
        if (options.lat !== undefined && options.lng !== undefined) {
            body.lat = options.lat;
            body.lng = options.lng;
        }
        const payload = await apiRequest('/api/residents/share', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        if (payload?.resident) {
            updateResidentState(payload.resident);
        }
        return payload?.resident || null;
    }

    async function updateLastLocation(location, { forceShare = false } = {}) {
        if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
            return null;
        }
        const body = {
            lat: location.lat,
            lng: location.lng
        };
        if (forceShare) {
            body.shareLocation = true;
        }
        const payload = await apiRequest('/api/residents/share', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        if (payload?.resident) {
            updateResidentState(payload.resident);
        }
        return payload?.resident || null;
    }

    async function incrementBadgeCount() {
        const payload = await apiRequest('/api/residents/badges/increment', {
            method: 'POST'
        });
        if (payload?.resident) {
            updateResidentState(payload.resident);
        }
        return Number(payload?.badgesGiven) || 0;
    }

    async function fetchSharedResidents(force = false) {
        const now = Date.now();
        if (!force && sharedResidentsCache.length && now - sharedResidentsFetchedAt < SHARED_RESIDENTS_TTL_MS) {
            return sharedResidentsCache.slice();
        }
        if (sharedResidentsPromise) {
            const list = await sharedResidentsPromise;
            return list.slice();
        }
        sharedResidentsPromise = (async () => {
            try {
                const response = await fetch('/api/residents/share');
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(payload?.message || 'Gagal memuat lokasi warga.');
                }
                const residents = Array.isArray(payload?.residents) ? payload.residents : [];
                sharedResidentsCache = residents
                    .map((resident) => normalizeSharedResident(resident))
                    .filter(Boolean);
                sharedResidentsFetchedAt = Date.now();
                return sharedResidentsCache;
            } catch (error) {
                throw error;
            } finally {
                sharedResidentsPromise = null;
            }
        })();
        const list = await sharedResidentsPromise;
        return list.slice();
    }

    function getSharedResidentsSnapshot() {
        return sharedResidentsCache.slice();
    }

    function getCurrentResident() {
        return currentSession.resident;
    }

    function isLoggedIn() {
        return Boolean(currentSession.token && currentSession.resident);
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') {
            return () => undefined;
        }
        listeners.add(listener);
        try {
            listener(getState());
        } catch (error) {
            console.warn('ResidentSession: immediate listener error', error);
        }
        return () => {
            listeners.delete(listener);
        };
    }

    window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY) {
            currentSession = loadSession();
            if (currentSession?.resident) {
                upsertSharedResidentEntry(currentSession.resident);
            }
            notifyListeners();
        }
    });

    if (currentSession.token) {
        refreshProfile().catch((error) => {
            console.warn('ResidentSession: gagal memuat profil awal', error);
        });
    }

    window.ResidentSession = {
        registerResident,
        loginResident,
        logoutResident,
        refreshProfile,
        updateResidentProfile,
        setShareLocation,
        updateLastLocation,
        incrementBadgeCount,
        fetchSharedResidents,
        getSharedResidentsSnapshot,
        getCurrentResident,
        isLoggedIn,
        subscribe
    };
})();

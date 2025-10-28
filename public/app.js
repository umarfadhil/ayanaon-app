﻿const DEFAULT_MAP_CENTER = { lat: -6.2088, lng: 106.8456 };

let map;
let temporaryMarker;
let userMarker;
let userCity;
let markers = [];
let isFetchingPins = false;
let pendingPinsRefresh = false;
let lastKnownPinsCount = null;
let refreshPins = () => Promise.resolve();
let lastKnownVisitorCount = null;
let isFetchingVisitorCount = false;
let lastKnownActivePinsCount = null;
let deferredInstallPrompt = null;
let userIp;
let editingPinId = null;
let currentSearchQuery = '';
let currentSearchTokens = [];
let selectedStartDate = '';
let selectedEndDate = '';
let navigationModal;
let navigationOptionsContainer;
let navigationCancelBtn;
let clusterManager;
let userLocation = null;
let fuelToggle;
let fuelToggleFuelLabel;
let fuelToggleEvLabel;
let fuelToggleContainer;
let fuelCheckbox;
let evCheckbox;
let suppressSpecialCategorySync = false;
let fuelToggleMode = 'fuel';

let specialCategoryOffButton;
let showSpecialCategories = false;

let liveSellerMarkers = [];
let liveSellerRefreshTimer = null;
let liveSellerWatchId = null;
let liveSellerHeartbeatTimer = null;
let lastLiveSellerLocation = null;
let liveSellerToggleButton;
let liveSellerLoginButton;
let liveSellerLogoutButton;
let liveSellerStatusText;
let liveSellerProfileContainer;
let liveSellerNameLabel;
let liveSellerBrandLabel;
let liveSellerPhoneLink;
let liveSellerPhotoElement;
let liveSellerCommunityBadge;
let liveSellerPanel;
let liveSellerLinksAuthenticated;
let liveSellerAuthLinks;
let liveSellerAuthPrimaryLink;
let liveSellerAuthSecondaryLink;
let liveSellerSessionUnsubscribe = null;
let liveSellerPrimaryLogoutHandler = null;
let residentSessionState = { isLoggedIn: false, resident: null };
let residentSessionUnsubscribe = null;
let residentAuthenticatedContainer;
let residentAuthLinksContainer;
let residentNameLabel;
let residentBadgeCountLabel;
let residentLogoutButton;
let residentPromptText;
let residentLogoutHandler = null;
let gerobakMenuSection;
let residentMenuSection;
let residentShareControlsContainer;
let residentShareToggleButton;
let residentShareStatusLabel;
const residentShareMarkers = new Map();
let residentShareRefreshTimer = null;
let residentShareRefreshInFlight = false;
let residentShareRefreshPending = false;
let isLiveSellerActive = false;
let liveSellerRequestInFlight = false;
let liveSellerHeartbeatFailureCount = 0;
let sellerSessionState = { isLoggedIn: false, seller: null };
let LiveSellerMarkerCtor = null;
let isFetchingLiveSellers = false;
let pendingLiveSellerRefresh = false;
let activeLiveSellerInfoWindow = null;

let actionMenu;
let actionMenuToggleButton;
let actionMenuContent;

document.addEventListener('DOMContentLoaded', () => {
    actionMenu = document.getElementById('action-menu');
    actionMenuToggleButton = document.getElementById('action-menu-toggle');
    actionMenuContent = document.getElementById('action-menu-content');

    if (actionMenuToggleButton) {
        actionMenuToggleButton.addEventListener('click', (event) => {
            event.stopPropagation();
            if (actionMenu) {
                actionMenu.classList.toggle('open');
            }
        });
    }

    document.addEventListener('click', (event) => {
        if (actionMenu && !actionMenu.contains(event.target) && actionMenu.classList.contains('open')) {
            actionMenu.classList.remove('open');
        }
    });
});

const LIVE_SELLER_REFRESH_INTERVAL_MS = 30000;
const LIVE_SELLER_HEARTBEAT_MS = 15000;

const FUEL_CATEGORY = '⛽ SPBU/SPBG';
const EV_CATEGORY = '⚡ SPKLU';
const SPECIAL_CATEGORY_DISTANCE_KM = 30;

const DEBUG_LOGGER = (() => {
    let enabled = true;
    try {
        const stored = localStorage.getItem('ayan_debug');
        if (stored === 'false') {
            enabled = false;
        } else if (stored === 'true') {
            enabled = true;
        }
    } catch (error) {
        enabled = true;
    }
    const emit = (...args) => {
        if (enabled) {
            console.log('[AyaNaon]', ...args);
        }
    };
    const api = {
        enable() {
            enabled = true;
            try {
                localStorage.setItem('ayan_debug', 'true');
            } catch (error) {
                emit('Unable to persist debug flag:', error);
            }
            emit('Debug logging enabled');
        },
        disable() {
            enabled = false;
            try {
                localStorage.setItem('ayan_debug', 'false');
            } catch (error) {
                emit('Unable to clear debug flag:', error);
            }
            console.log('[AyaNaon]', 'Debug logging disabled');
        },
        log: emit,
        isEnabled: () => enabled
    };
    try {
        window.ayanaonDebug = api;
    } catch (error) {
        emit('Unable to expose debug API:', error);
    }
    return api;
})();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js')
            .then((registration) => {
                DEBUG_LOGGER.log('Service worker registered', { scope: registration.scope });
            })
            .catch((error) => {
                console.error('Service worker registration failed:', error);
                DEBUG_LOGGER.log('Service worker registration failed', error);
            });
    });
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function clearMarkers() {
    if (clusterManager && typeof clusterManager.clearMarkers === 'function') {
        clusterManager.clearMarkers();
    }
    if (!Array.isArray(markers) || !markers.length) {
        markers = [];
        return;
    }
    markers.forEach(marker => {
        if (marker.infoWindow && typeof marker.infoWindow.setMap === 'function') {
            marker.infoWindow.setMap(null);
        }
        if (marker.infoWindow && marker.infoWindow.container) {
            marker.infoWindow.container.style.display = 'none';
        }
        marker.isVisible = false;
        if (marker.map) {
            marker.map = null;
        }
    });
    markers = [];
}

function refreshMarkerCluster(visibleMarkers) {
    if (clusterManager && typeof clusterManager.clearMarkers === 'function') {
        clusterManager.clearMarkers();
        if (Array.isArray(visibleMarkers) && visibleMarkers.length) {
            visibleMarkers.forEach(marker => {
                if (marker.map) {
                    marker.map = null;
                }
            });
            clusterManager.addMarkers(visibleMarkers);
        }
    } else if (map) {
        markers.forEach(marker => {
            marker.map = marker.isVisible ? map : null;
        });
    }
}

function isSpecialCategory(category) {
    return category === FUEL_CATEGORY || category === EV_CATEGORY;
}

function passesSpecialCategoryRules(marker) {
    const category = marker.category;
    if (!isSpecialCategory(category)) {
        return true;
    }
    if (!showSpecialCategories) {
        return false;
    }
    if (!userLocation) {
        return false;
    }
    const pinData = marker.pin || {};
    const hasPinCoordinates = typeof pinData.lat === 'number' && typeof pinData.lng === 'number';
    const markerPosition = hasPinCoordinates ? { lat: pinData.lat, lng: pinData.lng } : toLatLngLiteral(marker.position);
    if (!markerPosition) {
        return false;
    }
    const distanceKm = calculateDistanceKm(userLocation, markerPosition);
    if (!Number.isFinite(distanceKm) || distanceKm > SPECIAL_CATEGORY_DISTANCE_KM) {
        return false;
    }
    if (fuelToggleMode === 'fuel' && category !== FUEL_CATEGORY) {
        return false;
    }
    if (fuelToggleMode === 'ev' && category !== EV_CATEGORY) {
        return false;
    }
    return true;
}

function updateFuelToggleUI() {
    const allowSpecialSelection = showSpecialCategories && Boolean(userLocation);

    if (fuelToggle) {
        fuelToggle.disabled = !allowSpecialSelection;
        fuelToggle.checked = allowSpecialSelection && fuelToggleMode === 'ev';
    }
    if (fuelToggleContainer) {
        fuelToggleContainer.dataset.mode = fuelToggleMode;
        fuelToggleContainer.dataset.disabled = allowSpecialSelection ? 'false' : 'true';
    }
    if (fuelToggleFuelLabel) {
        fuelToggleFuelLabel.classList.toggle('active', allowSpecialSelection && fuelToggleMode === 'fuel');
    }
    if (fuelToggleEvLabel) {
        fuelToggleEvLabel.classList.toggle('active', allowSpecialSelection && fuelToggleMode === 'ev');
    }
    if (specialCategoryOffButton) {
        specialCategoryOffButton.classList.toggle('active', !showSpecialCategories);
        specialCategoryOffButton.disabled = Boolean(userLocation) ? false : true;
    }

    if (!suppressSpecialCategorySync) {
        suppressSpecialCategorySync = true;
        if (fuelCheckbox) {
            fuelCheckbox.disabled = !allowSpecialSelection;
            fuelCheckbox.checked = allowSpecialSelection && fuelToggleMode === 'fuel';
        }
        if (evCheckbox) {
            evCheckbox.disabled = !allowSpecialSelection;
            evCheckbox.checked = allowSpecialSelection && fuelToggleMode === 'ev';
        }
        suppressSpecialCategorySync = false;
    }
}

function handleLocationEnabled() {
    updateFuelToggleUI();
    syncResidentShareMarkersFromCache();
    refreshResidentShareMarkers();
}

function handleLocationDisabled() {
    userLocation = null;
    updateFuelToggleUI();
    if (typeof window.applyFilters === 'function') {
        window.applyFilters();
    }
    refreshResidentShareMarkers({ force: true });
}

function setSpecialCategoryVisibility(enabled) {
    if (showSpecialCategories === enabled) {
        return;
    }
    showSpecialCategories = enabled;
    updateFuelToggleUI();
    if (typeof window.applyFilters === 'function') {
        window.applyFilters();
    }
}

function animateMetricChange(element) {
    if (!element) {
        return;
    }
    element.classList.remove('metric-updated');
    void element.offsetWidth;
    element.classList.add('metric-updated');
    setTimeout(() => element.classList.remove('metric-updated'), 600);
}

function initializeLiveSellerControls() {
    if (typeof window.SellerSession === 'undefined' || typeof SellerSession.subscribe !== 'function') {
        DEBUG_LOGGER.log('SellerSession API unavailable; skipping Gerobak Online controls');
        return;
    }

    if (liveSellerLoginButton) {
        liveSellerLoginButton.addEventListener('click', () => {
            window.location.href = 'login.html';
        });
    }

    if (liveSellerLogoutButton) {
        liveSellerLogoutButton.addEventListener('click', (event) => {
            event.preventDefault();
            handleSellerLogout().catch(() => undefined);
        });
    }

    if (liveSellerToggleButton) {
        liveSellerToggleButton.addEventListener('click', () => {
            if (liveSellerRequestInFlight) {
                return;
            }
            if (isLiveSellerActive) {
                stopLiveSellerBroadcast();
            } else {
                startLiveSellerBroadcast();
            }
        });
    }

    if (liveSellerSessionUnsubscribe) {
        liveSellerSessionUnsubscribe();
    }
    liveSellerSessionUnsubscribe = SellerSession.subscribe(handleSellerSessionChange);
}

function handleSellerSessionChange(state) {
    sellerSessionState = state || { isLoggedIn: false, seller: null };
    updateLiveSellerUI(sellerSessionState);
}

function updateLiveSellerUI(state) {
    const isLoggedIn = Boolean(state && state.isLoggedIn);
    const seller = state ? state.seller : null;

    if (liveSellerPanel) {
        liveSellerPanel.classList.toggle('hidden', !isLoggedIn);
    }
    if (liveSellerLoginButton) {
        liveSellerLoginButton.hidden = isLoggedIn;
    }
    if (liveSellerLogoutButton) {
        liveSellerLogoutButton.hidden = !isLoggedIn;
    }
    if (liveSellerLinksAuthenticated) {
        liveSellerLinksAuthenticated.classList.toggle('hidden', !isLoggedIn);
    }

    if (liveSellerAuthLinks) {
        liveSellerAuthLinks.classList.toggle('hidden', isLoggedIn);
    }

    configureLiveSellerLinks(isLoggedIn);

    if (liveSellerToggleButton) {
        liveSellerToggleButton.disabled = !isLoggedIn || liveSellerRequestInFlight;
    }

    const isCurrentlyLive = Boolean(seller?.liveStatus?.isLive);
    isLiveSellerActive = isCurrentlyLive;
    setLiveSellerStatusIndicator(isCurrentlyLive);

    if (liveSellerToggleButton && !liveSellerRequestInFlight) {
        liveSellerToggleButton.textContent = isCurrentlyLive ? 'Selesai Live' : 'Mulai';
    }

    updateLiveSellerProfile(seller, isLoggedIn);

    if (isCurrentlyLive) {
        scheduleLiveSellerHeartbeat();
    } else {
        clearLiveSellerHeartbeat();
    }

    if (isLoggedIn && !seller && typeof SellerSession !== 'undefined' && typeof SellerSession.refreshProfile === 'function') {
        SellerSession.refreshProfile().catch(() => undefined);
    }

    syncMenuVisibility();
    syncResidentShareMarkersFromCache();
    refreshResidentShareMarkers();
}

function configureLiveSellerLinks(isLoggedIn) {
    if (!liveSellerAuthPrimaryLink) {
        return;
    }

    if (liveSellerPrimaryLogoutHandler) {
        liveSellerAuthPrimaryLink.removeEventListener('click', liveSellerPrimaryLogoutHandler);
        liveSellerPrimaryLogoutHandler = null;
    }

    if (isLoggedIn) {
        return;
    } else {
        if (liveSellerAuthLinks) {
            liveSellerAuthLinks.classList.remove('hidden');
        }
        liveSellerAuthPrimaryLink.textContent = 'Masuk';
        liveSellerAuthPrimaryLink.setAttribute('href', 'login.html');
        liveSellerAuthPrimaryLink.removeAttribute('role');
    }

    if (liveSellerAuthSecondaryLink) {
        liveSellerAuthSecondaryLink.textContent = 'Daftar';
        liveSellerAuthSecondaryLink.setAttribute('href', 'register.html');
    }
}

function syncMenuVisibility() {
    if (gerobakMenuSection) {
        gerobakMenuSection.classList.toggle('hidden', Boolean(residentSessionState?.isLoggedIn));
    }
    if (residentMenuSection) {
        residentMenuSection.classList.toggle('hidden', Boolean(sellerSessionState?.isLoggedIn));
    }
}

function isValidLatLng(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const lat = Number(value.lat);
    const lng = Number(value.lng);
    return Number.isFinite(lat) && Number.isFinite(lng);
}

function applyResidentShareMarkerSnapshot(residents) {
    if (!map || typeof google === 'undefined' || !google.maps) {
        return;
    }
    const MarkerCtor = google.maps?.marker?.AdvancedMarkerElement || window.AdvancedMarkerElement || null;
    if (!MarkerCtor) {
        return;
    }
    const activeKeys = new Set();
    if (Array.isArray(residents)) {
        residents.forEach((resident) => {
            const username = String(resident?.username || '').trim();
            const key = username.toLowerCase();
            const location = resident?.lastLocation;
            if (!key || !isValidLatLng(location)) {
                return;
            }
            const position = {
                lat: Number(location.lat),
                lng: Number(location.lng)
            };
            activeKeys.add(key);
            const existingEntry = residentShareMarkers.get(key);
            if (existingEntry && existingEntry.marker) {
                existingEntry.marker.position = position;
                existingEntry.marker.map = map;
                const title = `Lokasi ${resident.displayName || username}`;
                if (existingEntry.marker.title !== title) {
                    existingEntry.marker.title = title;
                }
                existingEntry.displayName = resident.displayName || username;
                return;
            }
            const markerElement = document.createElement('div');
            markerElement.className = 'resident-share-marker';
            const pulse = document.createElement('div');
            pulse.className = 'resident-share-marker__pulse';
            const dot = document.createElement('div');
            dot.className = 'resident-share-marker__dot';
            markerElement.appendChild(pulse);
            markerElement.appendChild(dot);
            const marker = new MarkerCtor({
                map,
                position,
                title: `Lokasi ${resident.displayName || username}`,
                content: markerElement
            });
            residentShareMarkers.set(key, { marker, displayName: resident.displayName || username });
        });
    }
    Array.from(residentShareMarkers.keys()).forEach((key) => {
        if (!activeKeys.has(key)) {
            const entry = residentShareMarkers.get(key);
            if (entry?.marker) {
                entry.marker.map = null;
            }
            residentShareMarkers.delete(key);
        }
    });
}

async function refreshResidentShareMarkers(options = {}) {
    if (typeof window.ResidentSession === 'undefined' || typeof ResidentSession.fetchSharedResidents !== 'function') {
        return;
    }
    if (residentShareRefreshInFlight) {
        residentShareRefreshPending = true;
        return;
    }
    residentShareRefreshInFlight = true;
    try {
        const residents = await ResidentSession.fetchSharedResidents(Boolean(options.force));
        applyResidentShareMarkerSnapshot(residents);
    } catch (error) {
        DEBUG_LOGGER.log('Tidak dapat memuat lokasi warga', error);
    } finally {
        residentShareRefreshInFlight = false;
        if (residentShareRefreshPending) {
            residentShareRefreshPending = false;
            refreshResidentShareMarkers(options);
        }
    }
}

function syncResidentShareMarkersFromCache() {
    if (typeof window.ResidentSession === 'undefined' || typeof ResidentSession.getSharedResidentsSnapshot !== 'function') {
        return;
    }
    const snapshot = ResidentSession.getSharedResidentsSnapshot();
    applyResidentShareMarkerSnapshot(snapshot);
}

function startResidentShareRefreshLoop() {
    if (residentShareRefreshTimer) {
        clearInterval(residentShareRefreshTimer);
    }
    residentShareRefreshTimer = setInterval(() => {
        Promise.resolve(refreshResidentShareMarkers()).catch(() => undefined);
    }, 30000);
}

function handleResidentLocationUpdate() {
    if (!isValidLatLng(userLocation)) {
        return;
    }
    if (typeof window.ResidentSession !== 'undefined' && typeof ResidentSession.updateLastLocation === 'function' && residentSessionState?.resident?.shareLocation) {
        Promise.resolve(ResidentSession.updateLastLocation(userLocation))
            .then(() => {
                syncResidentShareMarkersFromCache();
                refreshResidentShareMarkers();
            })
            .catch((error) => {
                DEBUG_LOGGER.log('Tidak dapat menyimpan lokasi warga', error);
            });
    }
}

function toggleResidentLocationSharing() {
    if (typeof window.ResidentSession === 'undefined' || typeof ResidentSession.setShareLocation !== 'function') {
        alert('Fitur warga belum siap. Muat ulang halaman dan coba lagi.');
        return;
    }
    const currentlySharing = Boolean(residentSessionState?.resident?.shareLocation);
    const sharePayload = {};
    if (isValidLatLng(userLocation)) {
        sharePayload.lat = userLocation.lat;
        sharePayload.lng = userLocation.lng;
    }
    Promise.resolve(ResidentSession.setShareLocation(!currentlySharing, sharePayload))
        .then(() => {
            if (!currentlySharing && isValidLatLng(userLocation) && typeof ResidentSession.updateLastLocation === 'function') {
                return ResidentSession.updateLastLocation(userLocation);
            }
            return null;
        })
        .then(() => {
            syncResidentShareMarkersFromCache();
            refreshResidentShareMarkers({ force: true });
        })
        .catch((error) => {
            DEBUG_LOGGER.log('Tidak dapat mengubah status berbagi lokasi', error);
            alert(error?.message || 'Tidak dapat mengubah status berbagi lokasi.');
        });
}

function initializeResidentControls() {
    if (typeof window.ResidentSession === 'undefined' || typeof ResidentSession.subscribe !== 'function') {
        DEBUG_LOGGER.log('ResidentSession API unavailable; skipping Warga Terdaftar controls');
        return;
    }

    if (residentLogoutHandler && residentLogoutButton) {
        residentLogoutButton.removeEventListener('click', residentLogoutHandler);
        residentLogoutHandler = null;
    }

    if (residentLogoutButton && typeof ResidentSession.logoutResident === 'function') {
        residentLogoutHandler = async (event) => {
            event.preventDefault();
            try {
                await ResidentSession.logoutResident();
            } catch (error) {
                DEBUG_LOGGER.log('Tidak dapat keluar dari akun warga', error);
            }
        };
        residentLogoutButton.addEventListener('click', residentLogoutHandler);
    }

    if (residentShareToggleButton) {
        residentShareToggleButton.addEventListener('click', (event) => {
            event.preventDefault();
            toggleResidentLocationSharing();
        });
    }

    if (residentSessionUnsubscribe) {
        residentSessionUnsubscribe();
    }
    residentSessionUnsubscribe = ResidentSession.subscribe(handleResidentSessionChange);
}

function handleResidentSessionChange(state) {
    residentSessionState = state || { isLoggedIn: false, resident: null };
    updateResidentUI(residentSessionState);
    syncMenuVisibility();
}

function updateResidentUI(state) {
    const isLoggedIn = Boolean(state && state.isLoggedIn);
    const resident = state ? state.resident : null;

    if (residentAuthLinksContainer) {
        residentAuthLinksContainer.classList.toggle('hidden', isLoggedIn);
    }
    if (residentAuthenticatedContainer) {
        residentAuthenticatedContainer.classList.toggle('hidden', !isLoggedIn);
    }
    if (residentPromptText) {
        residentPromptText.textContent = isLoggedIn
            ? 'Terima kasih sudah menebarkan badge kebaikan ke sesama warga.'
            : 'Bagikan badge ke penjual favoritmu dan lihat seberapa dermawan kamu.';
    }
    if (residentNameLabel) {
        residentNameLabel.textContent = resident?.displayName || resident?.username || '';
    }
    if (residentBadgeCountLabel) {
        const badges = Number(resident?.badgesGiven) || 0;
        residentBadgeCountLabel.textContent = badges;
    }
    if (residentShareControlsContainer) {
        residentShareControlsContainer.classList.toggle('hidden', !isLoggedIn);
    }
    const isSharing = Boolean(resident?.shareLocation);
    if (residentShareToggleButton) {
        residentShareToggleButton.textContent = isSharing ? 'Matikan Berbagi Lokasi' : 'Bagikan Lokasi Saya';
        residentShareToggleButton.classList.toggle('resident-share-btn--off', !isSharing);
    }
    if (residentShareStatusLabel) {
        residentShareStatusLabel.textContent = isSharing
            ? 'Lokasi kamu sedang dibagikan ke Gerobak Online.'
            : 'Lokasi kamu tidak sedang dibagikan.';
        residentShareStatusLabel.classList.toggle('resident-share-status--off', !isSharing);
    }
    syncResidentShareMarkersFromCache();
    refreshResidentShareMarkers(isLoggedIn ? { force: true } : {});
}

function setLiveSellerStatusIndicator(isLive) {
    if (!liveSellerStatusText) {
        return;
    }
    liveSellerStatusText.textContent = isLive ? 'Live' : 'Offline';
    liveSellerStatusText.classList.toggle('online', isLive);
    liveSellerStatusText.classList.toggle('offline', !isLive);
}

function updateLiveSellerProfile(seller, isLoggedIn) {
    if (!liveSellerProfileContainer) {
        return;
    }

    if (!isLoggedIn || !seller) {
        liveSellerProfileContainer.classList.add('hidden');
        if (liveSellerPhotoElement) {
            liveSellerPhotoElement.classList.add('hidden');
            liveSellerPhotoElement.removeAttribute('src');
        }
        if (liveSellerBrandLabel) {
            liveSellerBrandLabel.textContent = '';
            liveSellerBrandLabel.classList.add('hidden');
        }
        if (liveSellerPhoneLink) {
            liveSellerPhoneLink.classList.add('hidden');
            liveSellerPhoneLink.removeAttribute('href');
            liveSellerPhoneLink.textContent = '';
        }
        if (liveSellerCommunityBadge) {
            liveSellerCommunityBadge.classList.add('hidden');
        }
        return;
    }

    liveSellerProfileContainer.classList.remove('hidden');

    if (liveSellerNameLabel) {
        liveSellerNameLabel.textContent = seller.nama || seller.username || 'Gerobak Online';
    }

    if (liveSellerBrandLabel) {
        if (seller.merk) {
            liveSellerBrandLabel.textContent = seller.merk;
            liveSellerBrandLabel.classList.remove('hidden');
        } else {
            liveSellerBrandLabel.textContent = '';
            liveSellerBrandLabel.classList.add('hidden');
        }
    }

    if (liveSellerPhotoElement) {
        if (seller.photo && seller.photo.data) {
            const contentType = seller.photo.contentType || 'image/jpeg';
            liveSellerPhotoElement.src = `data:${contentType};base64,${seller.photo.data}`;
            liveSellerPhotoElement.classList.remove('hidden');
        } else {
            liveSellerPhotoElement.removeAttribute('src');
            liveSellerPhotoElement.classList.add('hidden');
        }
    }

    if (liveSellerPhoneLink) {
        if (seller.phoneNumber) {
            const normalizedPhone = seller.phoneNumber.replace(/\s+/g, '');
            const phoneTarget = seller.phoneNumber.startsWith('http') ? seller.phoneNumber : `tel:${normalizedPhone}`;
            liveSellerPhoneLink.href = phoneTarget;
            liveSellerPhoneLink.textContent = seller.phoneNumber;
            liveSellerPhoneLink.classList.remove('hidden');
        } else {
            liveSellerPhoneLink.classList.add('hidden');
            liveSellerPhoneLink.removeAttribute('href');
            liveSellerPhoneLink.textContent = '';
        }
    }

    if (liveSellerCommunityBadge) {
        const votes = Number(seller.communityVerification?.votes) || 0;
        liveSellerCommunityBadge.classList.toggle('hidden', votes <= 0);
    }
}

function buildSellerContactHref(rawPhone) {
    if (typeof rawPhone !== 'string') {
        return '#';
    }
    const trimmed = rawPhone.trim();
    const digitsOnly = trimmed.replace(/[^\d\+]/g, '');
    const numeric = trimmed.replace(/\D/g, '');
    if (!numeric) {
        return `tel:${encodeURIComponent(trimmed)}`;
    }
    let normalized = numeric;
    if (trimmed.startsWith('+')) {
        normalized = trimmed.replace(/\D/g, '');
    } else if (numeric.startsWith('0') && numeric.length > 1) {
        normalized = `62${numeric.slice(1)}`;
    }
    return normalized ? `https://wa.me/${normalized}` : `tel:${encodeURIComponent(trimmed)}`;
}

function buildLiveSellerPopupNode(seller, entry) {
    const container = document.createElement('div');
    container.className = 'live-seller-popup';

    if (seller?.photo && seller.photo.data) {
        const photoElement = document.createElement('img');
        photoElement.className = 'live-seller-popup-photo';
        const contentType = seller.photo.contentType || 'image/jpeg';
        photoElement.src = `data:${contentType};base64,${seller.photo.data}`;
        photoElement.alt = `Foto ${seller.nama || seller.username || 'Gerobak Online'}`;
        container.appendChild(photoElement);
    }

    const body = document.createElement('div');
    body.className = 'live-seller-popup-body';
    container.appendChild(body);

    const nameRow = document.createElement('div');
    nameRow.className = 'live-seller-popup-name-row';
    const nameElement = document.createElement('div');
    nameElement.className = 'live-seller-popup-name';
    nameElement.textContent = seller?.nama || seller?.username || 'Gerobak Online';
    nameRow.appendChild(nameElement);

    const votes = Number(seller?.communityVerification?.votes) || 0;
    if (votes > 0) {
        const badge = document.createElement('span');
        badge.className = 'live-seller-verified-badge';
        badge.textContent = 'Verified by Warga';
        nameRow.appendChild(badge);
    }

    body.appendChild(nameRow);

    if (seller?.merk) {
        const brand = document.createElement('div');
        brand.className = 'live-seller-popup-brand';
        brand.textContent = seller.merk;
        body.appendChild(brand);
    }

    if (seller?.deskripsi) {
        const description = document.createElement('div');
        description.className = 'live-seller-popup-desc';
        description.textContent = seller.deskripsi;
        body.appendChild(description);
    }

    if (seller?.liveStatus?.since) {
        const sinceDate = new Date(seller.liveStatus.since);
        if (!Number.isNaN(sinceDate.getTime())) {
            const sinceElement = document.createElement('div');
            sinceElement.className = 'live-seller-popup-desc';
            sinceElement.textContent = `Live sejak ${sinceDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
            body.appendChild(sinceElement);
        }
    }

    if (seller?.phoneNumber) {
        const phoneText = document.createElement('div');
        phoneText.className = 'live-seller-popup-phone';
        phoneText.textContent = seller.phoneNumber;
        body.appendChild(phoneText);

        const contactLink = document.createElement('a');
        contactLink.className = 'live-seller-popup-contact';
        contactLink.textContent = 'Hubungi via WhatsApp';
        contactLink.href = buildSellerContactHref(seller.phoneNumber);
        contactLink.target = '_blank';
        contactLink.rel = 'noopener noreferrer';
        body.appendChild(contactLink);
    }

    const sellerId = seller?.sellerId || seller?.id;
    const isOwner = Boolean(sellerSessionState?.seller && sellerId && sellerSessionState.seller.id === sellerId);
    if (sellerId) {
        const verificationSection = document.createElement('div');
        verificationSection.className = 'live-seller-verification';

        const voteCount = document.createElement('div');
        voteCount.className = 'live-seller-vote-count';
        voteCount.textContent = votes > 0 ? `Badge Warga: ${votes}` : 'Belum ada badge dari warga';
        verificationSection.appendChild(voteCount);

        const statusElement = document.createElement('div');
        statusElement.className = 'live-seller-vote-status';
        if (seller.hasCommunityVoted) {
            statusElement.textContent = 'Kamu sudah memberi badge.';
        } else {
            statusElement.style.display = 'none';
        }
        verificationSection.appendChild(statusElement);

        const verifyButton = document.createElement('button');
        verifyButton.type = 'button';
        verifyButton.className = 'live-seller-verify-btn';
        verifyButton.textContent = 'Kasih Badge Warga';
        if (seller.hasCommunityVoted || isOwner) {
            verifyButton.disabled = true;
            verifyButton.textContent = seller.hasCommunityVoted ? 'Terima kasih!' : 'Gerobak milik kamu';
        } else {
            verifyButton.addEventListener('click', () => {
                handleLiveSellerVerification(entry, seller, {
                    button: verifyButton,
                    voteCountElement: voteCount,
                    statusElement
                }).catch(() => undefined);
            });
        }
        verificationSection.appendChild(verifyButton);
        body.appendChild(verificationSection);
    }

    return container;
}

function setLiveSellerInfoWindowContent(entry, seller) {
    if (!entry || !entry.infoWindow) {
        return;
    }
    const popupNode = buildLiveSellerPopupNode(seller, entry);
    entry.infoWindow.setContent(popupNode);
}

async function handleLiveSellerVerification(entry, seller, context = {}) {
    const sellerId = seller?.sellerId || seller?.id;
    if (!sellerId || !context.button) {
        return;
    }
    const button = context.button;
    const voteCountElement = context.voteCountElement || null;
    const statusElement = context.statusElement || null;

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Mengirim...';

    try {
        const response = await fetch(`/api/live-sellers/${encodeURIComponent(sellerId)}/community-verify`, {
            method: 'POST'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.message || 'Gagal memberi badge warga.');
        }

        const previousVotes = Number(seller?.communityVerification?.votes) || 0;
        const newVotes = previousVotes + 1;
        if (voteCountElement) {
            voteCountElement.textContent = newVotes > 0 ? `Badge Warga: ${newVotes}` : 'Belum ada badge dari warga';
        }
        if (statusElement) {
            statusElement.textContent = payload.message || 'Terima kasih! Badge berhasil diberikan.';
            statusElement.style.display = '';
        }

        button.textContent = 'Terima kasih!';
        button.disabled = true;

        if (typeof window.ResidentSession !== 'undefined' && typeof ResidentSession.incrementBadgeCount === 'function') {
            Promise.resolve(ResidentSession.incrementBadgeCount())
                .then(() => {
                    syncResidentShareMarkersFromCache();
                    refreshResidentShareMarkers();
                })
                .catch((error) => {
                    DEBUG_LOGGER.log('Tidak dapat menambah hitungan badge warga', error);
                });
        }

        entry.seller = {
            ...seller,
            hasCommunityVoted: true,
            communityVerification: {
                ...(seller.communityVerification || {}),
                votes: newVotes
            }
        };
        setLiveSellerInfoWindowContent(entry, entry.seller);
        fetchLiveSellers().catch(() => undefined);
    } catch (error) {
        button.disabled = false;
        button.textContent = originalText;
        alert(error.message || 'Tidak dapat memberi badge warga. Coba lagi nanti.');
    }
}

function getLiveSellerPosition(seller) {
    if (!seller || !seller.liveStatus || !seller.liveStatus.location) {
        return null;
    }
    const lat = Number(seller.liveStatus.location.lat);
    const lng = Number(seller.liveStatus.location.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }
    return { lat, lng };
}

function createLiveSellerMarkerEntry(seller) {
    if (!map || !LiveSellerMarkerCtor) {
        return null;
    }
    const position = getLiveSellerPosition(seller);
    if (!position) {
        return null;
    }

    const markerElement = document.createElement('div');
    markerElement.className = 'live-seller-marker';
    markerElement.textContent = '🛒';

    const marker = new LiveSellerMarkerCtor({
        map,
        position,
        content: markerElement,
        title: seller?.nama || seller?.username || 'Gerobak Online'
    });

    const infoWindow = new google.maps.InfoWindow();
    const entry = {
        sellerId: seller?.sellerId || seller?.id || seller?.username,
        marker,
        infoWindow,
        seller,
        listener: null
    };

    setLiveSellerInfoWindowContent(entry, seller);

    entry.listener = marker.addListener('gmp-click', () => {
        if (activeLiveSellerInfoWindow && activeLiveSellerInfoWindow !== infoWindow) {
            activeLiveSellerInfoWindow.close();
        }
        setLiveSellerInfoWindowContent(entry, entry.seller);
        infoWindow.open({ map, anchor: marker });
        activeLiveSellerInfoWindow = infoWindow;
    });

    infoWindow.addListener('closeclick', () => {
        if (activeLiveSellerInfoWindow === infoWindow) {
            activeLiveSellerInfoWindow = null;
        }
    });

    return entry;
}

function updateLiveSellerMarker(entry, seller) {
    if (!entry) {
        return;
    }
    entry.seller = seller;
    const position = getLiveSellerPosition(seller);
    if (position && entry.marker) {
        entry.marker.position = position;
        entry.marker.title = seller?.nama || seller?.username || 'Gerobak Online';
    }
    setLiveSellerInfoWindowContent(entry, seller);
}

function removeLiveSellerMarker(entry) {
    if (!entry) {
        return;
    }
    if (entry.listener && typeof entry.listener.remove === 'function') {
        entry.listener.remove();
    }
    if (entry.infoWindow) {
        entry.infoWindow.close();
        if (activeLiveSellerInfoWindow === entry.infoWindow) {
            activeLiveSellerInfoWindow = null;
        }
    }
    if (entry.marker) {
        entry.marker.map = null;
    }
}

function updateLiveSellerMarkers(sellers) {
    if (!Array.isArray(sellers) || !map || !LiveSellerMarkerCtor) {
        liveSellerMarkers.forEach(removeLiveSellerMarker);
        liveSellerMarkers = [];
        return;
    }

    const existingById = new Map();
    liveSellerMarkers.forEach(entry => {
        if (entry && entry.sellerId) {
            existingById.set(entry.sellerId, entry);
        }
    });

    const nextEntries = [];

    sellers.forEach(seller => {
        const sellerId = seller?.sellerId || seller?.id || seller?.username;
        if (!sellerId) {
            return;
        }
        const position = getLiveSellerPosition(seller);
        if (!position) {
            return;
        }
        const existing = existingById.get(sellerId);
        if (existing) {
            existingById.delete(sellerId);
            updateLiveSellerMarker(existing, seller);
            nextEntries.push(existing);
        } else {
            const entry = createLiveSellerMarkerEntry(seller);
            if (entry) {
                nextEntries.push(entry);
            }
        }
    });

    existingById.forEach(entry => {
        removeLiveSellerMarker(entry);
    });

    liveSellerMarkers = nextEntries;
}

async function fetchLiveSellers() {
    if (!map) {
        return;
    }
    if (isFetchingLiveSellers) {
        pendingLiveSellerRefresh = true;
        return;
    }
    isFetchingLiveSellers = true;
    try {
        const response = await fetch('/api/live-sellers');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.message || 'Gagal memuat data Gerobak Online.');
        }
        const sellers = Array.isArray(payload?.sellers) ? payload.sellers : [];
        updateLiveSellerMarkers(sellers);
    } catch (error) {
        DEBUG_LOGGER.log('Live seller fetch failed', error);
    } finally {
        isFetchingLiveSellers = false;
        if (pendingLiveSellerRefresh) {
            pendingLiveSellerRefresh = false;
            fetchLiveSellers().catch(() => undefined);
        }
    }
}

function stopLiveSellerRefreshLoop() {
    if (liveSellerRefreshTimer !== null) {
        clearInterval(liveSellerRefreshTimer);
        liveSellerRefreshTimer = null;
    }
}

function startLiveSellerRefreshLoop() {
    stopLiveSellerRefreshLoop();
    fetchLiveSellers().catch(() => undefined);
    liveSellerRefreshTimer = setInterval(() => {
        fetchLiveSellers().catch(() => undefined);
    }, LIVE_SELLER_REFRESH_INTERVAL_MS);
}

function getSellerAuthHeaders() {
    if (typeof window.SellerSession === 'undefined' || typeof SellerSession.getToken !== 'function') {
        return null;
    }
    const token = SellerSession.getToken();
    if (!token) {
        return null;
    }
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
    };
}

function getLatestUserLocation() {
    if (userLocation && Number.isFinite(userLocation.lat) && Number.isFinite(userLocation.lng)) {
        return Promise.resolve(userLocation);
    }
    if (!navigator.geolocation) {
        return Promise.reject(new Error('Geolocation tidak tersedia.'));
    }
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                });
            },
            (error) => {
                reject(error || new Error('Tidak dapat mengambil lokasi.'));
            },
            {
                maximumAge: 10000,
                timeout: 7000,
                enableHighAccuracy: true
            }
        );
    });
}

async function startLiveSellerBroadcast() {
    if (liveSellerRequestInFlight) {
        return;
    }
    if (typeof window.SellerSession === 'undefined' || typeof SellerSession.isLoggedIn !== 'function' || !SellerSession.isLoggedIn()) {
        window.location.href = 'login.html';
        return;
    }

    const headers = getSellerAuthHeaders();
    if (!headers) {
        await handleSellerLogout();
        return;
    }

    let latestLocation;
    try {
        latestLocation = await getLatestUserLocation();
    } catch (error) {
        alert('Aktifkan izin lokasi untuk membagikan posisi Gerobak Online.');
        return;
    }
    if (!latestLocation) {
        alert('Lokasi tidak tersedia.');
        return;
    }

    liveSellerRequestInFlight = true;
    if (liveSellerToggleButton) {
        liveSellerToggleButton.disabled = true;
        liveSellerToggleButton.textContent = 'Mengaktifkan...';
    }

    try {
        const response = await fetch('/api/live-sellers/status', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                isLive: true,
                lat: latestLocation.lat,
                lng: latestLocation.lng
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.message || 'Gagal mengaktifkan Gerobak Online.');
        }

        isLiveSellerActive = true;
        lastLiveSellerLocation = latestLocation;
        liveSellerHeartbeatFailureCount = 0;
        setLiveSellerStatusIndicator(true);
        if (liveSellerToggleButton) {
            liveSellerToggleButton.textContent = 'Selesai Live';
        }
        scheduleLiveSellerHeartbeat();
        fetchLiveSellers().catch(() => undefined);
        if (typeof SellerSession !== 'undefined' && typeof SellerSession.refreshProfile === 'function') {
            SellerSession.refreshProfile().catch(() => undefined);
        }
    } catch (error) {
        alert(error.message || 'Tidak dapat mengaktifkan Gerobak Online.');
        DEBUG_LOGGER.log('Failed to activate live seller', error);
        setLiveSellerStatusIndicator(false);
        isLiveSellerActive = false;
    } finally {
        liveSellerRequestInFlight = false;
        if (liveSellerToggleButton) {
            liveSellerToggleButton.disabled = false;
            if (!isLiveSellerActive) {
                liveSellerToggleButton.textContent = 'Mulai';
            }
        }
    }
}

async function stopLiveSellerBroadcast(options = {}) {
    if (liveSellerRequestInFlight) {
        return;
    }

    const { silent = false, skipLogoutOnAuthFailure = false } = options;

    const headers = getSellerAuthHeaders();
    if (!headers) {
        if (!skipLogoutOnAuthFailure) {
            await handleSellerLogout();
        }
        return;
    }

    liveSellerRequestInFlight = true;
    if (liveSellerToggleButton) {
        liveSellerToggleButton.disabled = true;
        liveSellerToggleButton.textContent = 'Mematikan...';
    }

    try {
        const response = await fetch('/api/live-sellers/status', {
            method: 'POST',
            headers,
            body: JSON.stringify({ isLive: false })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.message || 'Gagal mematikan Gerobak Online.');
        }
    } catch (error) {
        if (!silent) {
            alert(error.message || 'Tidak dapat mematikan Gerobak Online.');
        }
        DEBUG_LOGGER.log('Failed to deactivate live seller', error);
    } finally {
        isLiveSellerActive = false;
        clearLiveSellerHeartbeat();
        liveSellerHeartbeatFailureCount = 0;
        setLiveSellerStatusIndicator(false);
        liveSellerRequestInFlight = false;
        if (liveSellerToggleButton) {
            liveSellerToggleButton.disabled = false;
            liveSellerToggleButton.textContent = 'Mulai';
        }
        if (typeof SellerSession !== 'undefined' && typeof SellerSession.refreshProfile === 'function') {
            SellerSession.refreshProfile().catch(() => undefined);
        }
        fetchLiveSellers().catch(() => undefined);
    }
}

async function sendLiveSellerHeartbeat() {
    if (!isLiveSellerActive || liveSellerRequestInFlight) {
        return;
    }
    const headers = getSellerAuthHeaders();
    if (!headers) {
        await handleSellerLogout();
        return;
    }

    let latestLocation;
    try {
        latestLocation = await getLatestUserLocation();
    } catch (error) {
        liveSellerHeartbeatFailureCount += 1;
        if (liveSellerHeartbeatFailureCount >= 3) {
            alert('Lokasi tidak dapat diperbarui. Gerobak Online dimatikan.');
            await stopLiveSellerBroadcast({ silent: true });
        }
        return;
    }
    if (!latestLocation) {
        return;
    }
    lastLiveSellerLocation = latestLocation;

    try {
        const response = await fetch('/api/live-sellers/heartbeat', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                lat: latestLocation.lat,
                lng: latestLocation.lng
            })
        });
        if (!response.ok) {
            if (response.status === 401) {
                await handleSellerLogout();
                return;
            }
            throw new Error('Heartbeat gagal.');
        }
        liveSellerHeartbeatFailureCount = 0;
    } catch (error) {
        DEBUG_LOGGER.log('Live seller heartbeat error', error);
        liveSellerHeartbeatFailureCount += 1;
        if (liveSellerHeartbeatFailureCount >= 3) {
            await stopLiveSellerBroadcast({ silent: true });
            alert('Koneksi live terputus. Gerobak Online dimatikan.');
        }
    }
}

function scheduleLiveSellerHeartbeat() {
    clearLiveSellerHeartbeat();
    if (!isLiveSellerActive) {
        return;
    }
    // Send immediate heartbeat to keep location fresh
    sendLiveSellerHeartbeat();
    liveSellerHeartbeatTimer = setInterval(() => {
        sendLiveSellerHeartbeat();
    }, LIVE_SELLER_HEARTBEAT_MS);
}

function clearLiveSellerHeartbeat() {
    if (liveSellerHeartbeatTimer !== null) {
        clearInterval(liveSellerHeartbeatTimer);
        liveSellerHeartbeatTimer = null;
    }
}

async function handleSellerLogout() {
    try {
        if (isLiveSellerActive) {
            await stopLiveSellerBroadcast({ silent: true, skipLogoutOnAuthFailure: true });
        }
    } catch (error) {
        DEBUG_LOGGER.log('Error stopping live seller during logout', error);
    } finally {
        clearLiveSellerHeartbeat();
        isLiveSellerActive = false;
        setLiveSellerStatusIndicator(false);
        if (typeof window.SellerSession !== 'undefined' && typeof SellerSession.clearSession === 'function') {
            SellerSession.clearSession();
        }
        fetchLiveSellers().catch(() => undefined);
    }
}

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    DEBUG_LOGGER.log('beforeinstallprompt captured');
    const installButton = document.getElementById('install-app-btn');
    if (installButton) {
        installButton.hidden = false;
        installButton.disabled = false;
    }
});

window.addEventListener('appinstalled', () => {
    DEBUG_LOGGER.log('PWA installed');
    deferredInstallPrompt = null;
    const installButton = document.getElementById('install-app-btn');
    if (installButton) {
        installButton.hidden = true;
        installButton.disabled = false;
    }
});

function toLatLngLiteral(position) {
    if (!position) {
        return null;
    }
    if (typeof position.lat === 'function' && typeof position.lng === 'function') {
        return { lat: position.lat(), lng: position.lng() };
    }
    return { lat: position.lat, lng: position.lng };
}

function getDistanceSquared(origin, target) {
    if (!origin || !target) {
        return Number.POSITIVE_INFINITY;
    }
    const latDiff = origin.lat - target.lat;
    const lngDiff = origin.lng - target.lng;
    return latDiff * latDiff + lngDiff * lngDiff;
}

function calculateDistanceKm(origin, target) {
    if (!origin || !target) {
        return Number.POSITIVE_INFINITY;
    }
    const toRadians = (value) => value * Math.PI / 180;
    const R = 6371; // Earth radius in km
    const dLat = toRadians(target.lat - origin.lat);
    const dLng = toRadians(target.lng - origin.lng);
    const lat1 = toRadians(origin.lat);
    const lat2 = toRadians(target.lat);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function formatDateToYMD(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return '';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function normalizeSearchText(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function tokenizeSearchQuery(query) {
    const normalized = normalizeSearchText(query);
    if (!normalized) {
        return [];
    }
    return normalized
        .split(/\s+/)
        .filter(Boolean);
}

function buildSearchableBlob(pin) {
    return [
        pin.title,
        pin.description,
        pin.category,
        pin.link
    ]
        .filter(Boolean)
        .map(normalizeSearchText)
        .join(' ');
}

function initializeNavigationModal() {
    if (navigationModal) {
        return;
    }

    navigationModal = document.createElement('div');
    navigationModal.id = 'navigation-modal';
    navigationModal.className = 'navigation-modal';
    navigationModal.innerHTML = `
        <div class="navigation-modal__sheet">
            <div class="navigation-modal__handle"></div>
            <h3 class="navigation-modal__title">Pilih Aplikasi</h3>
            <div class="navigation-modal__options"></div>
            <button type="button" class="navigation-modal__cancel">Batal</button>
        </div>
    `;

    document.body.appendChild(navigationModal);

    navigationOptionsContainer = navigationModal.querySelector('.navigation-modal__options');
    navigationCancelBtn = navigationModal.querySelector('.navigation-modal__cancel');

    navigationModal.addEventListener('click', (event) => {
        if (event.target === navigationModal) {
            hideNavigationModal();
        }
    });

    navigationCancelBtn.addEventListener('click', () => {
        hideNavigationModal();
    });
}

function hideNavigationModal() {
    if (!navigationModal) {
        return;
    }
    navigationModal.classList.remove('navigation-modal--open');
}

function openNavigationOption(option) {
    if (!option) {
        return;
    }

    hideNavigationModal();

    if (option.scheme) {
        const fallbackUrl = option.fallback || option.web || null;
        try {
            window.location.href = option.scheme;
        } catch (error) {
            if (fallbackUrl) {
                window.open(fallbackUrl, '_blank', 'noopener');
            }
            return;
        }

        if (fallbackUrl) {
            setTimeout(() => {
                if (document.visibilityState === 'visible') {
                    window.open(fallbackUrl, '_blank', 'noopener');
                }
            }, 1500);
        }
        return;
    }

    if (option.web) {
        window.open(option.web, '_blank', 'noopener');
    }
}

function buildNavigationOptions(pin) {
    const destination = `${pin.lat},${pin.lng}`;
    const encodedTitle = encodeURIComponent(pin.title || 'Tujuan');
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    const options = [];

    if (isIOS) {
        options.push({
            key: 'apple',
            label: 'Apple Maps',
            hint: 'Arahkan melalui Apple Maps',
            scheme: `maps://?daddr=${destination}&dirflg=d`,
            fallback: `https://maps.apple.com/?daddr=&q=${destination}`
        });
        options.push({
            key: 'google',
            label: 'Google Maps',
            hint: 'Arahkan melalui Google Maps',
            scheme: `comgooglemaps://?daddr=${destination}&directionsmode=driving`,
            fallback: `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`
        });
    } else if (isAndroid) {
        options.push({
            key: 'google',
            label: 'Google Maps',
            hint: 'Arahkan melalui Google Maps',
            scheme: `google.navigation:q=${destination}`,
            fallback: `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`
        });
    }

    options.push({
        key: 'waze',
        label: 'Waze',
        hint: 'Arahkan melalui Waze',
        scheme: `waze://?ll=${destination}&navigate=yes`,
        fallback: `https://waze.com/ul?ll=${destination}&navigate=yes`
    });

    options.push({
        key: 'browser',
        label: 'Browser',
        hint: 'Arahkan melalui browser',
        web: `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`
    });

    return options;
}

function showNavigationOptions(pin) {
    initializeNavigationModal();

    const options = buildNavigationOptions(pin);
    if (!navigationOptionsContainer) {
        return;
    }

    navigationOptionsContainer.innerHTML = '';

    options.forEach(option => {
        const optionButton = document.createElement('button');
        optionButton.type = 'button';
        optionButton.className = 'navigation-modal__option';
        optionButton.innerHTML = `
            <div class="navigation-modal__option-text">
                <span class="navigation-modal__option-title">${option.label}</span>
                ${option.hint ? `<span class="navigation-modal__option-hint">${option.hint}</span>` : ''}
            </div>
            <span class="navigation-modal__option-arrow">\u203a</span>
        `;
        optionButton.addEventListener('click', () => openNavigationOption(option));
        navigationOptionsContainer.appendChild(optionButton);
    });

    navigationModal.classList.add('navigation-modal--open');
}

function parseDateInput(value, endOfDay = false) {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date)) {
        return null;
    }
    if (endOfDay) {
        date.setHours(23, 59, 59, 999);
    } else {
        date.setHours(0, 0, 0, 0);
    }
    return date;
}

function getPinDateForFilter(pin) {
    if (!pin) {
        return null;
    }

    const { lifetime } = pin;
    if (lifetime) {
        if (lifetime.type === 'date' && lifetime.value) {
            const date = new Date(lifetime.value);
            if (!Number.isNaN(date)) {
                date.setHours(0, 0, 0, 0);
                return date;
            }
        }
        if (lifetime.type === 'today') {
            const fallbackToday = new Date();
            fallbackToday.setHours(0, 0, 0, 0);
            if (lifetime.value) {
                const lifetimeDate = new Date(lifetime.value);
                if (!Number.isNaN(lifetimeDate)) {
                    lifetimeDate.setHours(0, 0, 0, 0);
                    return lifetimeDate;
                }
            }
            return fallbackToday;
        }
    }

    const possibleFields = [
        'date',
        'eventDate',
        'startDate',
        'start_date',
        'createdAt',
        'created_at',
        'updatedAt',
        'updated_at',
        'timestamp'
    ];

    for (const field of possibleFields) {
        if (pin[field]) {
            const candidate = new Date(pin[field]);
            if (!Number.isNaN(candidate)) {
                candidate.setHours(0, 0, 0, 0);
                return candidate;
            }
        }
    }

    return null;
}

function getPinDateRangeForFilter(pin) {
    if (!pin) {
        return null;
    }
    const { lifetime } = pin;
    if (lifetime) {
        if (lifetime.type === 'date') {
            if (lifetime.start || lifetime.end) {
                const start = lifetime.start ? parseDateInput(lifetime.start) : null;
                const end = parseDateInput(lifetime.end || lifetime.start || lifetime.value, true);
                if (start && end) {
                    return { start, end };
                }
            }
            if (lifetime.value) {
                const start = parseDateInput(lifetime.value);
                const end = parseDateInput(lifetime.value, true);
                if (start && end) {
                    return { start, end };
                }
            }
        }
        if (lifetime.type === 'today') {
            const today = new Date();
            const y = today.getFullYear();
            const m = String(today.getMonth() + 1).padStart(2, '0');
            const d = String(today.getDate()).padStart(2, '0');
            const ymd = `${y}-${m}-${d}`;
            const start = parseDateInput(ymd);
            const end = parseDateInput(ymd, true);
            if (start && end) {
                return { start, end };
            }
        }
    }
    const single = getPinDateForFilter(pin);
    if (single) {
        const end = new Date(single);
        end.setHours(23, 59, 59, 999);
        return { start: single, end };
    }
    return null;
}

function removeDeveloperOnlyCategoryOptions() {
    const categorySelect = document.getElementById('category');
    if (!categorySelect) {
        return;
    }
    Array.from(categorySelect.querySelectorAll('option[data-developer-only="true"]')).forEach(option => option.remove());
}

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('welcome-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const infoBtn = document.getElementById('info-btn');
    const locateMeBtn = document.getElementById('locate-me-btn');
    const filterBtn = document.getElementById('filter-btn');
    const installAppBtn = document.getElementById('install-app-btn');
    const filterDropdown = document.getElementById('filter-dropdown');
    const selectAllCategories = document.getElementById('select-all-categories');
    const categoryCheckboxes = document.querySelectorAll('.category-checkbox');
    const categoryCheckboxList = Array.from(categoryCheckboxes);
    const filterSearchInput = document.getElementById('filter-search-input');
    const filterSearchButton = document.getElementById('filter-search-btn');
    const filterDateRangeInput = document.getElementById('filter-date-range-input');
    const resetFilterBtn = document.getElementById('reset-filter-btn');
    liveSellerPanel = document.getElementById('live-seller-panel');
    liveSellerToggleButton = document.getElementById('live-seller-toggle-btn');
    liveSellerLoginButton = document.getElementById('live-seller-login-btn');
    liveSellerLogoutButton = document.getElementById('live-seller-logout-btn');
    liveSellerStatusText = document.getElementById('live-seller-status-text');
    liveSellerProfileContainer = document.getElementById('live-seller-profile');
    liveSellerNameLabel = document.getElementById('live-seller-name');
    liveSellerBrandLabel = document.getElementById('live-seller-brand');
    liveSellerPhoneLink = document.getElementById('live-seller-phone');
    liveSellerPhotoElement = document.getElementById('live-seller-photo');
    liveSellerCommunityBadge = document.getElementById('live-seller-community-badge');
    liveSellerLinksAuthenticated = document.querySelector('.live-seller-links-authenticated');
    liveSellerAuthLinks = document.getElementById('live-seller-auth-links');
    liveSellerAuthPrimaryLink = document.getElementById('live-seller-auth-primary');
    liveSellerAuthSecondaryLink = document.getElementById('live-seller-auth-secondary');
    gerobakMenuSection = document.getElementById('menu-gerobak-section');
    residentMenuSection = document.getElementById('menu-resident-section');
    residentAuthenticatedContainer = document.getElementById('resident-authenticated');
    residentAuthLinksContainer = document.getElementById('resident-auth-links');
    residentNameLabel = document.getElementById('resident-name');
    residentBadgeCountLabel = document.getElementById('resident-badge-count');
    residentShareControlsContainer = document.getElementById('resident-share-controls');
    residentShareToggleButton = document.getElementById('resident-share-toggle-btn');
    residentShareStatusLabel = document.getElementById('resident-share-status');
    residentLogoutButton = document.getElementById('resident-logout-btn');
    residentPromptText = document.getElementById('resident-prompt');
    fuelToggleContainer = document.getElementById('fuel-toggle-container');
    fuelToggle = document.getElementById('fuel-toggle');
    fuelToggleFuelLabel = document.querySelector('#fuel-toggle-container .toggle-label-fuel');
    fuelToggleEvLabel = document.querySelector('#fuel-toggle-container .toggle-label-ev');
    fuelCheckbox = categoryCheckboxList.find(checkbox => checkbox.value === FUEL_CATEGORY) || null;
    evCheckbox = categoryCheckboxList.find(checkbox => checkbox.value === EV_CATEGORY) || null;
    let filterDatePicker = null;

    initializeNavigationModal();
    initializeLiveSellerControls();
    initializeResidentControls();
    updateLiveSellerUI(sellerSessionState);
    updateResidentUI(residentSessionState);
    syncMenuVisibility();

    if (fuelToggle) {
        fuelToggle.addEventListener('change', () => {
            if (!userLocation) {
                updateFuelToggleUI();
                return;
            }
            if (!showSpecialCategories) {
                setSpecialCategoryVisibility(true);
            }
            fuelToggleMode = fuelToggle.checked ? 'ev' : 'fuel';
            updateFuelToggleUI();
            filterMarkers();
        });
    }

    specialCategoryOffButton = document.getElementById('special-category-off-btn');
    if (specialCategoryOffButton) {
        specialCategoryOffButton.addEventListener('click', () => {
            setSpecialCategoryVisibility(!showSpecialCategories);
        });
    }

    updateFuelToggleUI();

    if (installAppBtn) {
        if (deferredInstallPrompt) {
            installAppBtn.hidden = false;
            installAppBtn.disabled = false;
        }
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
        if (isStandalone) {
            installAppBtn.hidden = true;
        }
        installAppBtn.addEventListener('click', async () => {
            if (!deferredInstallPrompt) {
                DEBUG_LOGGER.log('Install prompt not available');
                alert('Untuk memasang aplikasi, buka menu browser dan pilih "Add to Home Screen" atau "Install".');
                return;
            }
            installAppBtn.disabled = true;
            try {
                deferredInstallPrompt.prompt();
                const choiceResult = await deferredInstallPrompt.userChoice;
                DEBUG_LOGGER.log('Install prompt choice', choiceResult);
                if (choiceResult.outcome === 'accepted') {
                    installAppBtn.hidden = true;
                } else {
                    installAppBtn.disabled = false;
                }
            } catch (error) {
                DEBUG_LOGGER.log('Install prompt error', error);
                installAppBtn.disabled = false;
            } finally {
                deferredInstallPrompt = null;
                installAppBtn.disabled = false;
                installAppBtn.hidden = true;
            }
        });
    }

    const hasVisited = localStorage.getItem('hasVisited');

    if (!hasVisited) {
        modal.classList.remove('hidden');
    }

    closeModalBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
        localStorage.setItem('hasVisited', 'true');
    });

    infoBtn.addEventListener('click', () => {
        modal.classList.remove('hidden');
    });

    locateMeBtn.addEventListener('click', () => {
        if (userMarker) {
            map.setCenter(userMarker.position);
            map.setZoom(15);
        } else {
            alert('Akses lokasi ditolak. Silahkan buka akses lokasi untuk website ini agar dapat menggunakan fitur Locate Me');
        }
    });

    filterBtn.addEventListener('click', () => {
        filterDropdown.classList.toggle('hidden');
    });

    selectAllCategories.addEventListener('change', (e) => {
        const shouldCheck = e.target.checked;
        const allowSpecialSelection = showSpecialCategories && Boolean(userLocation);
        categoryCheckboxes.forEach(checkbox => {
            if (isSpecialCategory(checkbox.value)) {
                suppressSpecialCategorySync = true;
                checkbox.checked = allowSpecialSelection && (fuelToggleMode === 'ev'
                    ? checkbox.value === EV_CATEGORY
                    : checkbox.value === FUEL_CATEGORY);
                suppressSpecialCategorySync = false;
            } else {
                checkbox.checked = shouldCheck;
            }
        });
        filterMarkers();
    });

    categoryCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const value = checkbox.value;
            const allowSpecialSelection = showSpecialCategories && Boolean(userLocation);
            if (isSpecialCategory(value)) {
                if (!allowSpecialSelection) {
                    suppressSpecialCategorySync = true;
                    checkbox.checked = false;
                    suppressSpecialCategorySync = false;
                    return;
                }
                if (suppressSpecialCategorySync) {
                    filterMarkers();
                    return;
                }
                if (!checkbox.checked) {
                    suppressSpecialCategorySync = true;
                    checkbox.checked = true;
                    suppressSpecialCategorySync = false;
                    return;
                }
                fuelToggleMode = value === EV_CATEGORY ? 'ev' : 'fuel';
                updateFuelToggleUI();
                filterMarkers();
                return;
            }
            if (!checkbox.checked) {
                selectAllCategories.checked = false;
            }
            filterMarkers();
        });
    });

    if (filterSearchInput) {
        const debouncedFilter = debounce(() => {
            currentSearchQuery = filterSearchInput.value.trim().toLowerCase();
            currentSearchTokens = tokenizeSearchQuery(currentSearchQuery);
            filterMarkers();
        }, 300);
        
        filterSearchInput.addEventListener('input', debouncedFilter);
    }

    if (filterSearchButton) {
        filterSearchButton.addEventListener('click', () => {
            executeSearch();
        });
    }

    if (filterDateRangeInput) {
        if (typeof flatpickr === 'function') {
            filterDatePicker = flatpickr(filterDateRangeInput, {
                mode: 'range',
                dateFormat: 'Y-m-d',
                allowInput: false,
                onChange(selectedDates) {
                    if (!selectedDates.length) {
                        selectedStartDate = '';
                        selectedEndDate = '';
                    } else if (selectedDates.length === 1) {
                        const single = formatDateToYMD(selectedDates[0]);
                        selectedStartDate = single;
                        selectedEndDate = single;
                    } else {
                        const [start, end] = selectedDates;
                        selectedStartDate = formatDateToYMD(start);
                        selectedEndDate = formatDateToYMD(end);
                    }
                    filterMarkers();
                },
                onClose(selectedDates) {
                    if (!selectedDates.length) {
                        filterDateRangeInput.value = '';
                    }
                }
            });
        } else {
            filterDateRangeInput.removeAttribute('readonly');
            filterDateRangeInput.addEventListener('change', () => {
                const raw = filterDateRangeInput.value.trim();
                if (!raw) {
                    selectedStartDate = '';
                    selectedEndDate = '';
                    filterMarkers();
                    return;
                }
                const parts = raw.split(/\s*(?:to|—|-)\s*/);
                const first = parts[0] ? parts[0].trim() : '';
                const second = parts[1] ? parts[1].trim() : '';
                selectedStartDate = first;
                selectedEndDate = second || first;
                filterMarkers();
            });
        }
    }

    if (resetFilterBtn) {
        resetFilterBtn.addEventListener('click', () => {
            resetFilters();
            resetFilterBtn.classList.remove('reset-rotating');
            // Force reflow to restart animation
            void resetFilterBtn.offsetWidth;
            resetFilterBtn.classList.add('reset-rotating');
        });
    }

    function filterMarkers() {
        const selectedCategories = Array.from(categoryCheckboxes)
            .filter(checkbox => checkbox.checked)
            .map(checkbox => checkbox.value);
        const startDateBoundary = parseDateInput(selectedStartDate);
        const endDateBoundary = parseDateInput(selectedEndDate, true);

        const visibleMarkers = [];

        markers.forEach(marker => {
            const matchesCategory = selectedCategories.includes(marker.category);
            const pin = marker.pin || {};
            let searchableText = marker.searchText;
            if (typeof searchableText !== 'string') {
                searchableText = buildSearchableBlob(pin);
                marker.searchText = searchableText;
            }
            const matchesSearch = currentSearchTokens.length === 0 ||
                currentSearchTokens.every(token => searchableText.includes(token));
            const pinRange = getPinDateRangeForFilter(pin);
            const matchesDate = (() => {
                if (!startDateBoundary && !endDateBoundary) {
                    return true;
                }
                if (!pinRange) {
                    return false;
                }
                if (startDateBoundary && pinRange.end < startDateBoundary) {
                    return false;
                }
                if (endDateBoundary && pinRange.start > endDateBoundary) {
                    return false;
                }
                return true;
            })();

            const passesSpecialCategory = passesSpecialCategoryRules(marker);

            if (matchesCategory && matchesSearch && matchesDate && passesSpecialCategory) {
                marker.isVisible = true;
                visibleMarkers.push(marker);
            } else {
                marker.isVisible = false;
                if (marker.infoWindow && typeof marker.infoWindow.hide === 'function') {
                    marker.infoWindow.hide();
                } else if (marker.infoWindow && marker.infoWindow.container) {
                    marker.infoWindow.container.style.display = 'none';
                }
            }
        });

        refreshMarkerCluster(visibleMarkers);
    }

    function executeSearch() {
        if (!filterDropdown) {
            return;
        }

        if (filterSearchInput) {
            currentSearchQuery = filterSearchInput.value.trim().toLowerCase();
        }
        currentSearchTokens = tokenizeSearchQuery(currentSearchQuery);

        filterMarkers();

        if (!map) {
            return;
        }

        const visibleMarkers = markers.filter(marker => marker.isVisible);

        if (!visibleMarkers.length) {
            alert('Pencarian tidak ditemukan. Coba kata kunci lainnya yuk!');
            return;
        }

        if (filterSearchInput) {
            filterSearchInput.blur();
        }
        filterDropdown.classList.add('hidden');

        const referencePosition = toLatLngLiteral(userMarker ? userMarker.position : map.getCenter());
        const nearestMarker = visibleMarkers.reduce((closest, marker) => {
            const closestDistance = getDistanceSquared(referencePosition, toLatLngLiteral(closest.position));
            const candidateDistance = getDistanceSquared(referencePosition, toLatLngLiteral(marker.position));
            return candidateDistance < closestDistance ? marker : closest;
        }, visibleMarkers[0]);

        const targetPosition = toLatLngLiteral(nearestMarker.position);
        if (targetPosition) {
            map.panTo(targetPosition);
            if (typeof map.getZoom === 'function' && typeof map.setZoom === 'function') {
                const desiredZoom = 15;
                const currentZoom = map.getZoom();
                if (!currentZoom || currentZoom < desiredZoom) {
                    map.setZoom(desiredZoom);
                }
            }
        }
    }

    function resetFilters() {
        selectAllCategories.checked = true;
        categoryCheckboxes.forEach(checkbox => {
            checkbox.checked = true;
        });
        currentSearchQuery = '';
        currentSearchTokens = [];
        if (filterSearchInput) {
            filterSearchInput.value = '';
        }
        selectedStartDate = '';
        selectedEndDate = '';
        if (filterDatePicker) {
            filterDatePicker.clear();
            if (filterDateRangeInput) {
                filterDateRangeInput.setAttribute('readonly', 'readonly');
            }
        } else if (filterDateRangeInput) {
            filterDateRangeInput.value = '';
        }
        filterMarkers();
        if (filterDropdown) {
            filterDropdown.classList.add('hidden');
        }
        if (map && typeof map.setZoom === 'function' && typeof map.panTo === 'function') {
            const targetPosition = userMarker ? toLatLngLiteral(userMarker.position) : DEFAULT_MAP_CENTER;
            map.panTo(targetPosition);
            const desiredZoom = userMarker ? Math.min(map.getZoom() || 12, 13) : 12;
            map.setZoom(desiredZoom);
        }
    }

    window.applyFilters = filterMarkers;

    // Lifetime options logic
    const lifetimeSelect = document.getElementById('lifetime-select');
    const lifetimeDatePicker = document.getElementById('lifetime-date-picker');
    let lifetimePicker = null;

    if (lifetimeDatePicker && typeof flatpickr === 'function') {
        lifetimePicker = flatpickr(lifetimeDatePicker, {
            mode: 'range',
            dateFormat: 'Y-m-d',
            allowInput: false
        });
        lifetimeDatePicker.setAttribute('readonly', 'readonly');
    }

    // Hide date picker by default
    if (lifetimeDatePicker) {
        lifetimeDatePicker.style.display = 'none';
    }

    if (lifetimeSelect) {
        lifetimeSelect.addEventListener('change', (e) => {
            if (!lifetimeDatePicker) return;
            if (e.target.value === 'date') {
                lifetimeDatePicker.style.display = 'block';
            } else {
                lifetimeDatePicker.style.display = 'none';
                if (lifetimePicker) {
                    lifetimePicker.clear();
                } else {
                    lifetimeDatePicker.value = '';
                }
            }
        });
    }
});

async function initMap() {
    const { Map } = await google.maps.importLibrary("maps");
    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
    const clusterLibrary = (typeof window !== 'undefined' && window.markerClusterer) ? window.markerClusterer : null;
    const MarkerClustererCtor = clusterLibrary && typeof clusterLibrary.MarkerClusterer === 'function'
        ? clusterLibrary.MarkerClusterer
        : null;
    const SuperClusterAlgorithmCtor = clusterLibrary && typeof clusterLibrary.SuperClusterAlgorithm === 'function'
        ? clusterLibrary.SuperClusterAlgorithm
        : null;
    LiveSellerMarkerCtor = google.maps?.marker?.AdvancedMarkerElement || AdvancedMarkerElement || LiveSellerMarkerCtor;

    class CustomInfoWindow extends google.maps.OverlayView {
        constructor(pin, content) {
            super();
            this.pin = pin;
            this.position = new google.maps.LatLng(pin.lat, pin.lng);
            this.content = content;
            this.container = document.createElement('div');
            this.container.classList.add('custom-info-window');
            this.container.innerHTML = content;
    
            this.container.style.position = 'absolute';
            this.container.style.display = 'none';
        }
    
        onAdd() {
            this.getPanes().floatPane.appendChild(this.container);
        }
    
        onRemove() {
            if (this.container.parentElement) {
                this.container.parentElement.removeChild(this.container);
            }
        }
    
        draw() {
            const overlayProjection = this.getProjection();
            const sw = overlayProjection.fromLatLngToDivPixel(this.position);
            this.container.style.left = sw.x + 'px';
            this.container.style.top = sw.y + 'px';
        }
    
        show() {
            this.container.style.display = 'block';
        }
    
        hide() {
            this.container.style.display = 'none';
        }
    }

    map = new Map(document.getElementById('map'), {
        center: DEFAULT_MAP_CENTER,
        zoom: 12,
        mapId: '4504f8b37365c3d0',
        gestureHandling: 'greedy',
        disableDefaultUI: true,
        zoomControl: false,
        fullscreenControl: false
    });

    // Add Traffic Layer
    const trafficLayer = new google.maps.TrafficLayer();
    trafficLayer.setMap(map);

    const clusterRenderer = {
        render({ count, position }) {
            const clusterElement = document.createElement('div');
            clusterElement.className = 'cluster-marker';
            clusterElement.textContent = String(count);
            return new google.maps.marker.AdvancedMarkerElement({
                position,
                content: clusterElement
            });
        }
    };

    if (MarkerClustererCtor) {
        const clustererOptions = {
            map,
            markers: [],
            renderer: clusterRenderer
        };
        if (SuperClusterAlgorithmCtor) {
            clustererOptions.algorithm = new SuperClusterAlgorithmCtor({
                maxZoom: 10
            });
        }
        clusterManager = new MarkerClustererCtor(clustererOptions);
    } else {
        console.warn('MarkerClusterer library is unavailable; markers will not be clustered.');
    }
    refreshMarkerCluster(markers);
    startLiveSellerRefreshLoop();
    syncResidentShareMarkersFromCache();
    refreshResidentShareMarkers({ force: true });
    startResidentShareRefreshLoop();

    function addPinToMap(pin) {
        const icon = getIconForCategory(pin.category);
        const markerElement = document.createElement('div');
        markerElement.textContent = icon;
        markerElement.style.fontSize = '24px';
    
        const searchableText = buildSearchableBlob(pin);
        const marker = new google.maps.marker.AdvancedMarkerElement({
            position: { lat: pin.lat, lng: pin.lng },
            title: pin.title,
            content: markerElement
        });
    
        // Store category on marker object
        marker.category = pin.category;
        marker.pin = pin;
        marker.searchText = searchableText;
        marker.isVisible = true;
    
        let linkElement = '';
        if (pin.link) {
            linkElement = `<div class="info-window-link"><a href="${pin.link}" target="_blank" style="text-decoration: none; color: #90f2a8">${pin.link}</a></div>`;
        }

        let editButton = '';
        if (userIp === pin.reporter) {
            editButton = `<button class="edit-btn" onclick="editPin('${pin._id}')" style="background-color: #4285f4; font-size: 15px">edit</button>`;
        }
    
        let when = 'N/A';
        if (pin.lifetime) {
            if (pin.lifetime.type === 'today') {
                when = 'Hari ini';
            } else if (pin.lifetime.type === 'date') {
                if (pin.lifetime.start && pin.lifetime.end && pin.lifetime.start !== pin.lifetime.end) {
                    when = `${formatDate(pin.lifetime.start)} - ${formatDate(pin.lifetime.end)}`;
                } else if (pin.lifetime.value) {
                    when = formatDate(pin.lifetime.value);
                } else if (pin.lifetime.start) {
                    when = formatDate(pin.lifetime.start);
                }
            }
        }
    
        const descriptionWithBreaks = pin.description.replace(/\n/g, '<br>');
        const safeTitleForData = (pin.title || '').replace(/"/g, '&quot;');

        const contentString = `
            <div class="info-window-content">
                <div class="info-window-header">
                    <div class="info-window-category">${pin.category}</div>
                    <button class="close-info-window">&times;</button>
                </div>
                <div class="info-window-title">${pin.title}</div>
                <div class="info-window-description">${descriptionWithBreaks}</div>
                <div class="info-window-when">${when}</div>
                ${linkElement}
                <div class="info-window-actions">
                    ${editButton}
                </div>
                <div class="info-window-vote-actions">
                    <div class="info-window-vote">
                        <button id="upvote-btn-${pin._id}">&#128077;</button>
                        <span id="upvotes-${pin._id}">${pin.upvotes}</span>
                        <button id="downvote-btn-${pin._id}">&#128078;</button>
                        <span id="downvotes-${pin._id}">${pin.downvotes}</span>
                    </div>
                    <button class="navigate-btn" data-lat="${pin.lat}" data-lng="${pin.lng}" data-title="${safeTitleForData}">Arahkan</button>
                </div>
            </div>
        `;
    
        const infowindow = new CustomInfoWindow(pin, contentString);
        infowindow.setMap(map);
        marker.infoWindow = infowindow;
    
        // Attach event listeners programmatically
        const upvoteButton = infowindow.container.querySelector(`#upvote-btn-${pin._id}`);
        if (upvoteButton) {
            upvoteButton.addEventListener('click', () => upvotePin(pin._id));
        }

        const downvoteButton = infowindow.container.querySelector(`#downvote-btn-${pin._id}`);
        if (downvoteButton) {
            downvoteButton.addEventListener('click', () => downvotePin(pin._id));
        }

        const navigateButton = infowindow.container.querySelector('.navigate-btn');
        if (navigateButton) {
            navigateButton.addEventListener('click', () => showNavigationOptions(pin));
        }

        const closeButton = infowindow.container.querySelector('.close-info-window');
        closeButton.addEventListener('click', () => {
            infowindow.hide();
        });
    
        marker.addListener('gmp-click', () => {
            if (infowindow.container.style.display === 'block') {
                infowindow.hide();
            } else {
                infowindow.show();
            }
        });

        markers.push(marker);
    }

    function fetchPins() {
        if (isFetchingPins) {
            pendingPinsRefresh = true;
            return Promise.resolve();
        }
        isFetchingPins = true;
        DEBUG_LOGGER.log('Fetching pins from server');
        const url = '/api/pins';
        return fetch(url)
        .then(response => response.json())
        .then(pins => {
            clearMarkers();
            const normalizedPins = Array.isArray(pins) ? pins : [];
            normalizedPins.forEach(pin => {
                addPinToMap(pin);
            });
            if (typeof window.applyFilters === 'function') {
                window.applyFilters();
            }
            lastKnownPinsCount = normalizedPins.length;
            DEBUG_LOGGER.log('Pins synchronized', { count: lastKnownPinsCount });
        })
        .catch(error => {
            console.error('Error fetching pins:', error);
            DEBUG_LOGGER.log('Failed to fetch pins', error);
        })
        .finally(() => {
            isFetchingPins = false;
            if (pendingPinsRefresh) {
                pendingPinsRefresh = false;
                fetchPins();
            }
        });
    }
    refreshPins = fetchPins;

    function submitPin(e) {
        e.preventDefault();

        if (editingPinId) {
            updatePin(editingPinId);
            return;
        }
    
        const title = document.getElementById('title').value;
        const description = document.getElementById('description').value;
        const category = document.getElementById('category').value;
        const link = document.getElementById('link').value;
        const lifetimeType = document.getElementById('lifetime-select').value;
        const lifetimeInputEl = document.getElementById('lifetime-date-picker');
    
        if (!title || !description || !category || !lifetimeType) {
            alert('Please fill out all fields');
            return;
        }
        
        // Build lifetime payload supporting single date or range
        let lifetime = { type: lifetimeType };
        if (lifetimeType === 'date') {
            let startStr = '';
            let endStr = '';
            if (typeof flatpickr === 'function' && lifetimeInputEl && lifetimeInputEl._flatpickr) {
                const dates = lifetimeInputEl._flatpickr.selectedDates || [];
                if (dates.length === 1) {
                    startStr = endStr = formatDateToYMD(dates[0]);
                } else if (dates.length >= 2) {
                    startStr = formatDateToYMD(dates[0]);
                    endStr = formatDateToYMD(dates[1]);
                }
            } else if (lifetimeInputEl && lifetimeInputEl.value) {
                const raw = lifetimeInputEl.value.trim();
                const parts = raw.split(/\s*(?:to|–|-|—)\s*/);
                const first = parts[0] ? parts[0].trim() : '';
                const second = parts[1] ? parts[1].trim() : '';
                startStr = first;
                endStr = second || first;
            }
            if (!startStr) {
                alert('Please select a date or date range.');
                return;
            }
            if (startStr && endStr && startStr !== endStr) {
                lifetime.start = startStr;
                lifetime.end = endStr;
            } else {
                lifetime.value = startStr;
            }
        }
    
        if (!temporaryMarker) {
            alert('Please select a location on the map first');
            return;
        }
    
        const pin = {
            title,
            description,
            category,
            link,
            lat: temporaryMarker.position.lat,
            lng: temporaryMarker.position.lng,
            lifetime
        };
    
        fetch('/api/pins', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(pin)
        })
        .then(response => response.json())
        .then(data => {
            if (data.message) {
                alert('Error: ' + data.message);
                return;
            }
            if (temporaryMarker) {
                temporaryMarker.map = null;
            }
            addPinToMap(data);
            if (typeof window.applyFilters === 'function') {
                window.applyFilters();
            }
            document.getElementById('add-pin-form').reset();
            removeDeveloperOnlyCategoryOptions();
            document.getElementById('lifetime-date-picker').style.display = 'none';
            alert('Pin dropped successfully!');
        });
    }

function handleLocationError(browserHasGeolocation) {
    // You can handle the error here, e.g., show a message to the user
    console.error(browserHasGeolocation ?
        'Error: The Geolocation service failed.' :
        'Error: Your browser\'s doesn\'t support geolocation.');
    handleLocationDisabled();
}

    // Get user's current location

    // Custom Map Type Controls
    const mapViewBtn = document.getElementById('map-view-btn');
    const satelliteViewBtn = document.getElementById('satellite-view-btn');

    mapViewBtn.addEventListener('click', () => {
        map.setMapTypeId('terrain');
        mapViewBtn.classList.add('active');
        satelliteViewBtn.classList.remove('active');
    });

    satelliteViewBtn.addEventListener('click', () => {
        map.setMapTypeId('hybrid');
        satelliteViewBtn.classList.add('active');
        mapViewBtn.classList.remove('active');
    });

    let locationWatchId = null;

    function stopLocationWatch() {
        if (locationWatchId !== null && navigator.geolocation && typeof navigator.geolocation.clearWatch === 'function') {
            navigator.geolocation.clearWatch(locationWatchId);
            locationWatchId = null;
        }
    }

    function startLocationWatch() {
        if (!navigator.geolocation || locationWatchId !== null) {
            return;
        }
        locationWatchId = navigator.geolocation.watchPosition(position => {
            const newLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            userLocation = newLocation;
            if (userMarker) {
                userMarker.position = newLocation;
            }
            handleLocationEnabled();
            handleResidentLocationUpdate();
            if (typeof window.applyFilters === 'function') {
                window.applyFilters();
            }
        }, () => {
            handleLocationError(false);
            stopLocationWatch();
        }, { maximumAge: 30000, timeout: 10000 });
    }

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(position => {
        const newLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };
        userLocation = newLocation;
        map.setCenter(newLocation);
            // Build animated pulsing marker
            const userMarkerContainer = document.createElement('div');
            userMarkerContainer.className = 'user-marker';
            const userPulse = document.createElement('div');
            userPulse.className = 'user-marker__pulse';
            const userDot = document.createElement('div');
            userDot.className = 'user-marker__dot';
            userMarkerContainer.appendChild(userPulse);
            userMarkerContainer.appendChild(userDot);

            userMarker = new AdvancedMarkerElement({
                position: newLocation,
                map: map,
                title: 'Your Location',
                content: userMarkerContainer,
            });



            handleLocationEnabled();
            handleResidentLocationUpdate();
            if (typeof window.applyFilters === 'function') {
                window.applyFilters();
            }
        }, () => {
            handleLocationError(true);
        });

        // Watch user's location
        startLocationWatch();
    } else {
        // Browser doesn't support Geolocation
        handleLocationError(false);
    }


    map.addListener('click', (e) => {
        if (temporaryMarker) {
            temporaryMarker.map = null;
        }
        temporaryMarker = new AdvancedMarkerElement({
            position: e.latLng,
            map: map,
        });
    });

    document.getElementById('add-pin-form').addEventListener('submit', submitPin);
    document.getElementById('add-pin-btn').addEventListener('click', () => {
        const pinForm = document.getElementById('pin-form');
        pinForm.classList.toggle('hidden');
        editingPinId = null; // Reset editing state
        document.getElementById('add-pin-form').reset();
            removeDeveloperOnlyCategoryOptions();
    });

    fetchPins();
    getUserIp();
    fetchActivePinsCount(); // Call the new function
    setInterval(() => fetchActivePinsCount({ checkForChanges: true, enableAnimation: true }), 180000); // Check for changes every 3 minutes
}

function upvotePin(id) {
    fetch(`/api/pins/${id}/upvote`, { method: 'POST' })
        .then(response => {
            if (response.ok) {
                const upvotesSpan = document.getElementById(`upvotes-${id}`);
                upvotesSpan.textContent = parseInt(upvotesSpan.textContent) + 1;
            } else if (response.status === 403) {
                alert('You have already voted for this pin.');
            }
        });
}

function downvotePin(id) {
    fetch(`/api/pins/${id}/downvote`, { method: 'POST' })
        .then(response => {
            if (response.ok) {
                const downvotesSpan = document.getElementById(`downvotes-${id}`);
                downvotesSpan.textContent = parseInt(downvotesSpan.textContent) + 1;
            } else if (response.status === 403) {
                alert('You have already voted for this pin.');
            }
        });
}

function getIconForCategory(category) {
    const icons = {
        '🏆 Restoran Legendaris': '🏆',
        '🏃🏻 Olahraga & Aktivitas Hobi': '🏃🏻',
        '🎉 Konser Musik & Acara': '🎉',
        '🍔 Promo & Diskon Makanan / Minuman': '🍔',
        '💸 Promo & Diskon Lainnya': '💸',
        '🛍️ Pasar Lokal & Pameran': '🛍️',
        '🎭 Budaya & Hiburan': '🎭',
        '🎓 Edukasi': '🎓',
        '🧑‍🤝‍🧑 Sosial & Kopdar': '🧑‍🤝‍🧑',
        '🤝 Jual-Beli Barang': '🤝',
        '🐾 Barang & Hewan Hilang': '🐾',
        '🏡 Akomodasi Pilihan': '🏡',
        '⚡ SPKLU': '⚡',
        '⛽ SPBU/SPBG': '⛽',
        '💡 Lain-lain': '💡'
    };
    return icons[category] || '💡';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    
    const dayName = days[date.getDay()];
    const day = date.getDate();
    const monthName = months[date.getMonth()];
    const year = date.getFullYear();
    
    return `${dayName}, ${day} ${monthName} ${year}`;
}

function getUserIp() {
    fetch('/api/ip')
        .then(response => response.json())
        .then(data => {
            userIp = data.ip;
        });
}

function editPin(id) {
    const pin = markers.find(marker => marker.pin._id === id).pin;
    document.getElementById('title').value = pin.title;
    document.getElementById('description').value = pin.description;
    const categorySelect = document.getElementById('category');
    if (categorySelect) {
        let categoryOption = Array.from(categorySelect.options).find(option => option.value === pin.category);
        if (!categoryOption) {
            categoryOption = new Option(pin.category, pin.category);
            categoryOption.dataset.developerOnly = 'true';
            categorySelect.add(categoryOption);
        }
        categorySelect.value = pin.category;
    }
    document.getElementById('link').value = pin.link;
    document.getElementById('lifetime-select').value = pin.lifetime.type;
    const lifetimeInputEl = document.getElementById('lifetime-date-picker');
    if (pin.lifetime.type === 'date') {
        lifetimeInputEl.style.display = 'block';
        const fp = lifetimeInputEl && lifetimeInputEl._flatpickr ? lifetimeInputEl._flatpickr : null;
        if (pin.lifetime.start && pin.lifetime.end) {
            if (fp) {
                fp.setDate([pin.lifetime.start, pin.lifetime.end], true);
            } else {
                lifetimeInputEl.value = `${pin.lifetime.start} to ${pin.lifetime.end}`;
            }
        } else if (pin.lifetime.value) {
            if (fp) {
                fp.setDate([pin.lifetime.value], true);
            } else {
                lifetimeInputEl.value = pin.lifetime.value.split('T')[0];
            }
        }
    } else {
        lifetimeInputEl.style.display = 'none';
        if (lifetimeInputEl && lifetimeInputEl._flatpickr) {
            lifetimeInputEl._flatpickr.clear();
        } else if (lifetimeInputEl) {
            lifetimeInputEl.value = '';
        }
    }

    editingPinId = id;
    document.getElementById('pin-form').classList.remove('hidden');
}

function updatePin(id) {
    const title = document.getElementById('title').value;
    const description = document.getElementById('description').value;
    const category = document.getElementById('category').value;
    const link = document.getElementById('link').value;
    const lifetimeType = document.getElementById('lifetime-select').value;
    const lifetimeValue = document.getElementById('lifetime-date-picker').value;

    const updatedPin = {
        title,
        description,
        category,
        link,
        lifetime: (() => {
            const lifetimeInputEl = document.getElementById('lifetime-date-picker');
            if (lifetimeType !== 'date') {
                return { type: lifetimeType };
            }
            let startStr = '';
            let endStr = '';
            if (typeof flatpickr === 'function' && lifetimeInputEl && lifetimeInputEl._flatpickr) {
                const dates = lifetimeInputEl._flatpickr.selectedDates || [];
                if (dates.length === 1) {
                    startStr = endStr = formatDateToYMD(dates[0]);
                } else if (dates.length >= 2) {
                    startStr = formatDateToYMD(dates[0]);
                    endStr = formatDateToYMD(dates[1]);
                }
            } else if (lifetimeInputEl && lifetimeInputEl.value) {
                const raw = lifetimeInputEl.value.trim();
                const parts = raw.split(/\s*(?:to|–|-|—)\s*/);
                const first = parts[0] ? parts[0].trim() : '';
                const second = parts[1] ? parts[1].trim() : '';
                startStr = first;
                endStr = second || first;
            }
            if (startStr && endStr && startStr !== endStr) {
                return { type: 'date', start: startStr, end: endStr };
            }
            return { type: 'date', value: startStr || endStr };
        })()
    };

    fetch(`/api/pins/${id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatedPin)
    })
    .then(response => response.json())
    .then(data => {
        if (data.message) {
            alert('Error: ' + data.message);
            return;
        }
        alert('Pin updated successfully!');
        document.getElementById('add-pin-form').reset();
            removeDeveloperOnlyCategoryOptions();
        document.getElementById('pin-form').classList.add('hidden');
        editingPinId = null;
        refreshPins();
    });
}

function fetchActivePinsCount(options = {}) {
    const { checkForChanges = false, enableAnimation = false } = options;
    DEBUG_LOGGER.log('Fetching active pin count');
    fetch('/api/pins/count')
        .then(response => response.json())
        .then(data => {
            const count = data.count;
            const activePinsElement = document.getElementById('active-pins-count');
            if (activePinsElement) {
                activePinsElement.textContent = `Lokasi Aktif  : ${count} Pin`;
                if (enableAnimation && lastKnownActivePinsCount !== null && count !== lastKnownActivePinsCount) {
                    animateMetricChange(activePinsElement);
                }
            }
            lastKnownActivePinsCount = count;
            DEBUG_LOGGER.log('Active pin count', { count });
            if (checkForChanges && lastKnownPinsCount !== null && count !== lastKnownPinsCount) {
                refreshPins();
            }
        })
        .catch(error => {
            console.error('Error fetching active pins count:', error);
            DEBUG_LOGGER.log('Active pin count fetch failed', error);
        });
}

// Fetch the API key and load the Google Maps script
fetch('/api/config')
    .then(response => response.json())
    .then(config => {
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${config.googleMapsApiKey}&callback=initMap&libraries=marker&loading=async`;
            script.async = true;
            script.defer = true;
            document.head.appendChild(script);    });

function scheduleDailyRefresh() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timeUntilMidnight = tomorrow - now;

    setTimeout(() => {
        location.reload();
    }, timeUntilMidnight);
}

scheduleDailyRefresh();

function fetchUniqueIpCount(options = {}) {
    const { enableAnimation = false } = options;
    if (isFetchingVisitorCount) {
        return Promise.resolve();
    }
    isFetchingVisitorCount = true;
    DEBUG_LOGGER.log('Fetching visitor count');
    return fetch('/api/unique-ips')
        .then(response => response.json())
        .then(data => {
            const count = data.count;
            const visitorElement = document.getElementById('unique-ips-count');
            if (visitorElement) {
                visitorElement.textContent = `Pengunjung : ${count} Warga`;
                if (enableAnimation && lastKnownVisitorCount !== null && count !== lastKnownVisitorCount) {
                    animateMetricChange(visitorElement);
                }
            }
            lastKnownVisitorCount = count;
            DEBUG_LOGGER.log('Visitor count', { count });
        })
        .catch(error => {
            console.error('Error fetching unique IP count:', error);
            DEBUG_LOGGER.log('Visitor count fetch failed', error);
        })
        .finally(() => {
            isFetchingVisitorCount = false;
        });
}

// Call initially
fetchUniqueIpCount();

// Check for visitor changes every 3 minutes
setInterval(() => fetchUniqueIpCount({ enableAnimation: true }), 180000);

const DEFAULT_MAP_CENTER = { lat: -6.2088, lng: 106.8456 };

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

function clearMarkers() {
    if (!Array.isArray(markers) || !markers.length) {
        return;
    }
    markers.forEach(marker => {
        if (marker.infoWindow && typeof marker.infoWindow.setMap === 'function') {
            marker.infoWindow.setMap(null);
        }
        marker.map = null;
    });
    markers = [];
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
    const filterSearchInput = document.getElementById('filter-search-input');
    const filterSearchButton = document.getElementById('filter-search-btn');
    const filterDateRangeInput = document.getElementById('filter-date-range-input');
    const resetFilterBtn = document.getElementById('reset-filter-btn');
    let filterDatePicker = null;

    initializeNavigationModal();

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
        categoryCheckboxes.forEach(checkbox => {
            checkbox.checked = e.target.checked;
        });
        filterMarkers();
    });

    categoryCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            if (!checkbox.checked) {
                selectAllCategories.checked = false;
            }
            filterMarkers();
        });
    });

    if (filterSearchInput) {
        filterSearchInput.addEventListener('input', (event) => {
            currentSearchQuery = event.target.value.trim().toLowerCase();
            currentSearchTokens = tokenizeSearchQuery(currentSearchQuery);
            filterMarkers();
        });
        filterSearchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                executeSearch();
            }
        });
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

            if (matchesCategory && matchesSearch && matchesDate) {
                marker.map = map;
            } else {
                marker.map = null;
            }
        });
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

        const visibleMarkers = markers.filter(marker => marker.map === map);

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
        fullscreenControl: true
    });

    // Add Traffic Layer
    const trafficLayer = new google.maps.TrafficLayer();
    trafficLayer.setMap(map);

    function addPinToMap(pin) {
        const icon = getIconForCategory(pin.category);
        const markerElement = document.createElement('div');
        markerElement.textContent = icon;
        markerElement.style.fontSize = '24px';
    
        const searchableText = buildSearchableBlob(pin);
        const marker = new google.maps.marker.AdvancedMarkerElement({
            position: { lat: pin.lat, lng: pin.lng },
            map: map,
            title: pin.title,
            content: markerElement
        });
    
        // Store category on marker object
        marker.category = pin.category;
        marker.pin = pin;
        marker.searchText = searchableText;
    
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
                        <button id="upvote-btn-${pin._id}">👍</button>
                        <span id="upvotes-${pin._id}">${pin.upvotes}</span>
                        <button id="downvote-btn-${pin._id}">👎</button>
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
        if (typeof window.applyFilters === 'function') {
            window.applyFilters();
        }
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
            (Array.isArray(pins) ? pins : []).forEach(pin => {
                addPinToMap(pin);
            });
            lastKnownPinsCount = Array.isArray(pins) ? pins.length : 0;
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
            const userLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            if (userMarker) {
                userMarker.position = userLocation;
            }
        }, () => {
            handleLocationError(false);
            stopLocationWatch();
        }, { maximumAge: 30000, timeout: 10000 });
    }

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(position => {
            const userLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            map.setCenter(userLocation);
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
                position: userLocation,
                map: map,
                title: 'Your Location',
                content: userMarkerContainer,
            });



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
        '🚦 Lalu Lintas & Kecelakaan': '🚦',
        '🌧️ Cuaca & Bencana Alam': '🌧️',
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

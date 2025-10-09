console.log('app.js loaded');

const DEFAULT_MAP_CENTER = { lat: -6.2088, lng: 106.8456 };

let map;
let temporaryMarker;
let userMarker;
let userCity;
let markers = [];
let userIp;
let editingPinId = null;
let currentSearchQuery = '';
let selectedStartDate = '';
let selectedEndDate = '';
let navigationModal;
let navigationOptionsContainer;
let navigationCancelBtn;

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
            <h3 class="navigation-modal__title">Buka dengan</h3>
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
            fallbackTimer = setTimeout(() => {
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
            hint: 'Aplikasi bawaan iOS',
            scheme: `maps://?daddr=${destination}&dirflg=d`,
            fallback: `https://maps.apple.com/?daddr=&q=${destination}`
        });
        options.push({
            key: 'google',
            label: 'Google Maps',
            hint: 'Aplikasi Google Maps',
            scheme: `comgooglemaps://?daddr=${destination}&directionsmode=driving`,
            fallback: `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`
        });
    } else if (isAndroid) {
        options.push({
            key: 'google',
            label: 'Google Maps',
            hint: 'Aplikasi Google Maps',
            scheme: `google.navigation:q=${destination}`,
            fallback: `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`
        });
    }

    options.push({
        key: 'waze',
        label: 'Waze',
        hint: 'Aplikasi Waze',
        scheme: `waze://?ll=${destination}&navigate=yes`,
        fallback: `https://waze.com/ul?ll=${destination}&navigate=yes`
    });

    options.push({
        key: 'browser',
        label: 'Buka di Browser',
        hint: 'Tampilkan rute di browser',
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
    const filterDropdown = document.getElementById('filter-dropdown');
    const selectAllCategories = document.getElementById('select-all-categories');
    const categoryCheckboxes = document.querySelectorAll('.category-checkbox');
    const filterSearchInput = document.getElementById('filter-search-input');
    const filterSearchButton = document.getElementById('filter-search-btn');
    const filterDateRangeInput = document.getElementById('filter-date-range-input');
    const resetFilterBtn = document.getElementById('reset-filter-btn');
    let filterDatePicker = null;

    initializeNavigationModal();

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
            const query = currentSearchQuery;
            const matchesSearch = !query || [
                pin.title,
                pin.description,
                pin.category,
                pin.link
            ].some(field => typeof field === 'string' && field.toLowerCase().includes(query));
            const pinDate = getPinDateForFilter(pin);
            const matchesDate = (() => {
                if (!startDateBoundary && !endDateBoundary) {
                    return true;
                }
                if (!pinDate) {
                    return false;
                }
                if (startDateBoundary && pinDate < startDateBoundary) {
                    return false;
                }
                if (endDateBoundary && pinDate > endDateBoundary) {
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
            map.panTo(DEFAULT_MAP_CENTER);
            map.setZoom(12);
        }
    }

    window.applyFilters = filterMarkers;

    // Lifetime options logic
    const lifetimeSelect = document.getElementById('lifetime-select');
    const lifetimeDatePicker = document.getElementById('lifetime-date-picker');

    // Hide date picker by default
    lifetimeDatePicker.style.display = 'none';

    lifetimeSelect.addEventListener('change', (e) => {
        if (e.target.value === 'date') {
            lifetimeDatePicker.style.display = 'block';
        } else {
            lifetimeDatePicker.style.display = 'none';
        }
    });
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
    
        const marker = new google.maps.marker.AdvancedMarkerElement({
            position: { lat: pin.lat, lng: pin.lng },
            map: map,
            title: pin.title,
            content: markerElement
        });
    
        // Store category on marker object
        marker.category = pin.category;
        marker.pin = pin;
    
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
            } else if (pin.lifetime.type === 'date' && pin.lifetime.value) {
                when = formatDate(pin.lifetime.value);
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
                    <button class="navigate-btn" data-lat="${pin.lat}" data-lng="${pin.lng}" data-title="${safeTitleForData}">Get Me Here</button>
                </div>
            </div>
        `;
    
        const infowindow = new CustomInfoWindow(pin, contentString);
        infowindow.setMap(map);
    
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
        // Clear existing markers
        // markers.forEach(marker => marker.map = null);
        // markers = [];
    
        let url = '/api/pins';
        fetch(url)
        .then(response => response.json())
        .then(pins => {
            console.log(pins);
            pins.forEach(pin => {
                addPinToMap(pin);
            });
        });
    }

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
        const lifetimeValue = document.getElementById('lifetime-date-picker').value;
    
        if (!title || !description || !category || !lifetimeType) {
            alert('Please fill out all fields');
            return;
        }
    
        if (lifetimeType === 'date' && !lifetimeValue) {
            alert('Please select an expiration date.');
            return;
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
            lifetime: {
                type: lifetimeType,
                value: lifetimeValue
            }
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
            console.log('Adding new pin to map:', data);
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

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(position => {
            const userLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            map.setCenter(userLocation);
            const userMarkerDiv = document.createElement('div');
            userMarkerDiv.style.width = '14px';
            userMarkerDiv.style.height = '14px';
            userMarkerDiv.style.borderRadius = '50%';
            userMarkerDiv.style.backgroundColor = '#4285F4';
            userMarkerDiv.style.border = '2px solid white';
            userMarker = new AdvancedMarkerElement({
                position: userLocation,
                map: map,
                title: 'Your Location',
                content: userMarkerDiv,
            });



        }, () => {
            handleLocationError(true);
        });

        // Watch user's location
        navigator.geolocation.watchPosition(position => {
            const userLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            if (userMarker) {
                userMarker.position = userLocation;
            }
        }, () => {
            handleLocationError(false);
        });
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
    setInterval(fetchActivePinsCount, 30000); // Update every 30 seconds
    // setInterval(fetchPins, 30000);
    setInterval(() => {
        const selectAllCheckbox = document.getElementById('select-all-categories');
        if (selectAllCheckbox && selectAllCheckbox.checked) {
            fetchPins();
        }
    }, 30000); // Refresh pins every 30 seconds
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
    if (pin.lifetime.type === 'date') {
        document.getElementById('lifetime-date-picker').style.display = 'block';
        document.getElementById('lifetime-date-picker').value = pin.lifetime.value.split('T')[0];
    } else {
        document.getElementById('lifetime-date-picker').style.display = 'none';
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
        lifetime: {
            type: lifetimeType,
            value: lifetimeValue
        }
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
        fetchPins();
    });
}

function fetchActivePinsCount() {
    fetch('/api/pins/count')
        .then(response => response.json())
        .then(data => {
            document.getElementById('active-pins-count').textContent = `Lokasi Aktif  : ${data.count} Pin`;
        })
        .catch(error => console.error('Error fetching active pins count:', error));
}

console.log('Fetching API key...');
// Fetch the API key and load the Google Maps script
fetch('/api/config')
    .then(response => response.json())
    .then(config => {
        console.log('API key fetched, loading map...');
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

function fetchUniqueIpCount() {
    fetch('/api/unique-ips')
        .then(response => response.json())
        .then(data => {
            document.getElementById('unique-ips-count').textContent = `Pengunjung : ${data.count} Warga`;
        })
        .catch(error => console.error('Error fetching unique IP count:', error));
}

// Call initially
fetchUniqueIpCount();

// Call every 5 seconds
// setInterval(fetchUniqueIpCount, 5000);

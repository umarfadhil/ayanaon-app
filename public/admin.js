(function () {
    const MAX_PIN_PHOTO_COUNT = 3;
    const MAX_PIN_PHOTO_BYTES = 4 * 1024 * 1024;
    const DEFAULT_COORDS = { lat: -6.2088, lng: 106.8456 };
    const METRICS_DEFAULT_CENTER = { lat: -2.5, lng: 118 };
    const INDONESIA_BOUNDS = {
        sw: { lat: -11, lng: 94 },
        ne: { lat: 6, lng: 141 }
    };

    const state = {
        pins: [],
        filteredPins: [],
        selectedPin: null,
        existingImages: [],
        addedImages: [],
        analyticsSummary: null,
        topPins: [],
        topSources: [],
        heatmapPoints: [],
        topCities: [],
        metricsLoaded: false,
        metricsFilter: {
            granularity: 'month',
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1,
            startYear: new Date().getFullYear() - 2,
            endYear: new Date().getFullYear()
        }
    };

    const els = {};
    let miniMap = null;
    let miniMarker = null;
    let miniGeocoder = null;
    let googleMapsPromise = null;

    function cacheElements() {
        els.pinCount = document.getElementById('pin-count');
        els.pinCountSubtext = document.getElementById('pin-count-subtext');
        els.refreshPinsBtn = document.getElementById('refresh-pins-btn');
        els.pinList = document.getElementById('pin-list');
        els.pinSearch = document.getElementById('pin-search');
        els.message = document.getElementById('admin-message');
        els.editorTitle = document.getElementById('editor-title');
        els.form = document.getElementById('pin-edit-form');
        els.titleInput = document.getElementById('pin-title');
        els.descriptionInput = document.getElementById('pin-description');
        els.categoryInput = document.getElementById('pin-category');
        els.linkInput = document.getElementById('pin-link');
        els.lifetimeSelect = document.getElementById('pin-lifetime');
        els.lifetimeStartInput = document.getElementById('pin-lifetime-start');
        els.lifetimeEndInput = document.getElementById('pin-lifetime-end');
        els.existingImages = document.getElementById('existing-images');
        els.newImages = document.getElementById('new-images');
        els.imageInput = document.getElementById('pin-image-input');
        els.photoRemaining = document.getElementById('photo-remaining');
        els.saveBtn = document.getElementById('save-pin-btn');
        els.adminName = document.getElementById('admin-name');
        els.adminUsername = document.getElementById('admin-username');
        els.logoutBtn = document.getElementById('admin-logout-btn');
        els.latInput = document.getElementById('pin-lat');
        els.lngInput = document.getElementById('pin-lng');
        els.miniMapContainer = document.getElementById('admin-mini-map');
        els.miniMapSearchInput = document.getElementById('mini-map-search-input');
        els.miniMapSearchBtn = document.getElementById('mini-map-search-btn');
        els.deletePinBtn = document.getElementById('delete-pin-btn');
        els.metricsRefreshBtn = document.getElementById('metrics-refresh-btn');
        els.uvDay = document.getElementById('uv-day');
        els.uvMonth = document.getElementById('uv-month');
        els.uvYear = document.getElementById('uv-year');
        els.pvDay = document.getElementById('pv-day');
        els.pvMonth = document.getElementById('pv-month');
        els.pvYear = document.getElementById('pv-year');
        els.uvDayMeta = document.getElementById('uv-day-meta');
        els.uvMonthMeta = document.getElementById('uv-month-meta');
        els.uvYearMeta = document.getElementById('uv-year-meta');
        els.pvDayMeta = document.getElementById('pv-day-meta');
        els.pvMonthMeta = document.getElementById('pv-month-meta');
        els.pvYearMeta = document.getElementById('pv-year-meta');
        els.topPinsList = document.getElementById('top-pins-list');
        els.topPinsRange = document.getElementById('top-pins-range');
        els.topSourcesList = document.getElementById('top-sources-list');
        els.topSourcesRange = document.getElementById('top-sources-range');
        els.heatmapRange = document.getElementById('heatmap-range');
        els.metricsHeatmap = document.getElementById('metrics-heatmap');
        els.topCitiesList = document.getElementById('top-cities-list');
        els.topCitiesRange = document.getElementById('top-cities-range');
        els.tabButtons = Array.from(document.querySelectorAll('.admin-tab')) || [];
        els.pinContent = document.getElementById('admin-pin-content');
        els.metricsContent = document.getElementById('admin-metrics-pane');
        els.metricsGranularity = document.getElementById('metrics-granularity');
        els.metricsMonth = document.getElementById('metrics-month');
        els.metricsYear = document.getElementById('metrics-year');
        els.metricsStartYear = document.getElementById('metrics-start-year');
        els.metricsEndYear = document.getElementById('metrics-end-year');
        els.metricsMonthWrap = document.getElementById('metrics-month-wrap');
        els.metricsYearWrap = document.getElementById('metrics-year-wrap');
        els.metricsYearRangeWrap = document.getElementById('metrics-year-range-wrap');
        els.metricsApply = document.getElementById('metrics-apply');
        els.uvChart = document.getElementById('uv-chart');
        els.pvChart = document.getElementById('pv-chart');
        els.dashboardFrame = document.getElementById('dashboard-frame');
        els.dashboardError = document.getElementById('dashboard-error');
        els.dashboardReloadBtn = document.getElementById('dashboard-reload-btn');
    }

    function showMessage(type, text) {
        if (!els.message) {
            return;
        }
        els.message.textContent = text || '';
        els.message.classList.remove('is-success', 'is-error', 'is-visible');
        if (!text) {
            return;
        }
        els.message.classList.add('is-visible');
        if (type === 'success') {
            els.message.classList.add('is-success');
        } else if (type === 'error') {
            els.message.classList.add('is-error');
        }
    }

    function redirectToLogin() {
        window.location.replace('warga-login.html');
    }

    function getToken() {
        if (typeof ResidentSession === 'undefined' || typeof ResidentSession.getToken !== 'function') {
            return '';
        }
        return ResidentSession.getToken();
    }

    function ensureGoogleMaps() {
        if (typeof window.google !== 'undefined' && window.google.maps) {
            return Promise.resolve(window.google.maps);
        }
        if (googleMapsPromise) {
            return googleMapsPromise;
        }
        googleMapsPromise = (async () => {
            try {
                const response = await fetch('/api/config');
                const config = await response.json().catch(() => ({}));
                const apiKey = config?.googleMapsApiKey || '';
                if (!apiKey) {
                    throw new Error('API key Maps tidak tersedia.');
                }
                await new Promise((resolve, reject) => {
                    const existing = document.querySelector('script[data-admin-gmaps="true"]');
                    if (existing) {
                        existing.addEventListener('load', resolve, { once: true });
                        existing.addEventListener('error', () => reject(new Error('Gagal memuat Maps')), { once: true });
                        return;
                    }
                    const script = document.createElement('script');
                    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
                    script.async = true;
                    script.defer = true;
                    script.dataset.adminGmaps = 'true';
                    script.onload = resolve;
                    script.onerror = () => reject(new Error('Gagal memuat Google Maps API'));
                    document.head.appendChild(script);
                });
                if (!window.google || !window.google.maps) {
                    throw new Error('Google Maps tidak siap.');
                }
                return window.google.maps;
            } catch (error) {
                googleMapsPromise = null;
                throw error;
            }
        })();
        return googleMapsPromise;
    }

    async function ensureAdminSession() {
        if (typeof ResidentSession === 'undefined') {
            throw new Error('Fitur sesi warga tidak ditemukan.');
        }
        try {
            if (typeof ResidentSession.refreshProfile === 'function') {
                await ResidentSession.refreshProfile();
            }
        } catch (error) {
            // ignore refresh error and rely on existing session
        }

        if (!ResidentSession.isLoggedIn || !ResidentSession.isLoggedIn()) {
            redirectToLogin();
            return;
        }
        if (!ResidentSession.isAdmin || !ResidentSession.isAdmin()) {
            showMessage('error', 'Halaman ini hanya untuk admin.');
            setTimeout(() => redirectToLogin(), 900);
            return;
        }
        const resident = typeof ResidentSession.getCurrentResident === 'function'
            ? ResidentSession.getCurrentResident()
            : null;
        if (resident) {
            if (els.adminName) {
                els.adminName.textContent = resident.displayName || resident.username || 'Admin';
            }
            if (els.adminUsername) {
                els.adminUsername.textContent = resident.username ? `@${resident.username}` : '';
            }
        }
    }

    function getPinId(pin) {
        if (!pin) return '';
        const candidates = ['_id', 'id', 'pinId'];
        for (const key of candidates) {
            if (pin[key]) {
                return String(pin[key]);
            }
        }
        return '';
    }

    function formatLifetime(lifetime) {
        if (!lifetime || typeof lifetime !== 'object') {
            return '';
        }
        if (lifetime.type === 'today') {
            return 'Hari ini';
        }
        if (lifetime.type === 'date') {
            const start = formatDateForInput(lifetime.start || lifetime.value || '');
            const end = formatDateForInput(lifetime.end || '');
            if (start && end && start !== end) {
                return `${start} - ${end}`;
            }
            return start || end || '';
        }
        return '';
    }

    function formatPinMeta(pin) {
        const lifetime = formatLifetime(pin.lifetime);
        const category = pin.category || 'Tanpa kategori';
        const location = pin.city || '';
        const parts = [category];
        if (location) {
            parts.push(location);
        }
        if (lifetime) {
            parts.push(lifetime);
        }
        return parts.join(' · ');
    }

    function getCurrentCoords() {
        const lat = parseCoordInput(els.latInput?.value);
        const lng = parseCoordInput(els.lngInput?.value);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return { lat, lng };
        }
        return null;
    }

    function getPinCoords(pin) {
        if (!pin) return null;
        const lat = Number(pin.lat);
        const lng = Number(pin.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return { lat, lng };
        }
        return null;
    }

    function buildMetricsQuery(filter = {}) {
        const params = new URLSearchParams();
        params.set('granularity', filter.granularity || 'month');
        if (filter.granularity === 'day') {
            params.set('year', filter.year);
            params.set('month', filter.month);
        } else if (filter.granularity === 'month') {
            params.set('year', filter.year);
        } else {
            params.set('startYear', filter.startYear);
            params.set('endYear', filter.endYear);
        }
        return params.toString();
    }

    const MONTH_NAMES = [
        'Januari',
        'Februari',
        'Maret',
        'April',
        'Mei',
        'Juni',
        'Juli',
        'Agustus',
        'September',
        'Oktober',
        'November',
        'Desember'
    ];

    function formatFilterRange(filter = state.metricsFilter) {
        if (!filter || !filter.granularity) {
            return 'Rentang tidak dikenal';
        }
        if (filter.granularity === 'day') {
            const monthIndex = Math.max(1, Math.min(12, Number(filter.month) || 1)) - 1;
            const year = filter.year || new Date().getFullYear();
            const label = `${MONTH_NAMES[monthIndex]} ${year}`;
            return `${label} - ${label}`;
        }
        if (filter.granularity === 'month') {
            const year = filter.year || new Date().getFullYear();
            return `Januari ${year} - Desember ${year}`;
        }
        const startYear = filter.startYear || new Date().getFullYear();
        const endYear = filter.endYear || startYear;
        return `Januari ${startYear} - Desember ${endYear}`;
    }

    async function fetchAnalyticsSummary(filter) {
        try {
            const qs = buildMetricsQuery(filter || state.metricsFilter);
            const response = await fetch(`/api/analytics/summary?${qs}`, { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            state.analyticsSummary = payload?.summary || null;
        } catch (error) {
            console.warn('Gagal memuat summary analytics', error);
        }
    }

    async function fetchTopPins(filter) {
        try {
            const qs = buildMetricsQuery(filter || state.metricsFilter);
            const response = await fetch(`/api/analytics/top-pins?${qs}`, { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            state.topPins = payload?.topPins || [];
            if (els.topPinsRange) {
                els.topPinsRange.textContent = formatFilterRange(state.metricsFilter);
            }
        } catch (error) {
            console.warn('Gagal memuat top pins', error);
        }
    }

    async function fetchTopSources(filter) {
        try {
            const qs = buildMetricsQuery(filter || state.metricsFilter);
            const response = await fetch(`/api/analytics/top-referrers?${qs}`, { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            state.topSources = payload?.topSources || [];
            if (els.topSourcesRange) {
                els.topSourcesRange.textContent = formatFilterRange(state.metricsFilter);
            }
        } catch (error) {
            console.warn('Gagal memuat top sources', error);
        }
    }

    async function fetchHeatmap(filter) {
        try {
            const qs = buildMetricsQuery(filter || state.metricsFilter);
            const response = await fetch(`/api/analytics/heatmap?${qs}`, { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            state.heatmapPoints = payload?.points || [];
            if (els.heatmapRange) {
                els.heatmapRange.textContent = formatFilterRange(state.metricsFilter);
            }
        } catch (error) {
            console.warn('Gagal memuat heatmap', error);
        }
    }

    async function fetchTopCities(filter) {
        try {
            const qs = buildMetricsQuery(filter || state.metricsFilter);
            const response = await fetch(`/api/analytics/top-cities?${qs}`, { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            state.topCities = payload?.topCities || [];
            if (els.topCitiesRange) {
                els.topCitiesRange.textContent = formatFilterRange(state.metricsFilter);
            }
        } catch (error) {
            console.warn('Gagal memuat top cities', error);
        }
    }

    async function fetchTimeseries(params) {
        const qs = new URLSearchParams(params || {}).toString();
        const response = await fetch(`/api/analytics/timeseries?${qs}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        return payload?.series || [];
    }

    function renderSummaryCards() {
        const summary = state.analyticsSummary || {};
        const mapping = [
            { key: 'day', uv: els.uvDay, pv: els.pvDay, uvMeta: els.uvDayMeta, pvMeta: els.pvDayMeta, label: 'Hari' },
            { key: 'month', uv: els.uvMonth, pv: els.pvMonth, uvMeta: els.uvMonthMeta, pvMeta: els.pvMonthMeta, label: 'Bulan' },
            { key: 'year', uv: els.uvYear, pv: els.pvYear, uvMeta: els.uvYearMeta, pvMeta: els.pvYearMeta, label: 'Tahun' }
        ];
        mapping.forEach(({ uv, pv, uvMeta, pvMeta }) => {
            if (uv) uv.textContent = '-';
            if (pv) pv.textContent = '-';
            if (uvMeta) uvMeta.textContent = '';
            if (pvMeta) pvMeta.textContent = '';
        });
        mapping.forEach(({ key, uv, pv, uvMeta, pvMeta, label }) => {
            const data = summary[key] || {};
            if (!data) return;
            if (uv) uv.textContent = Number.isFinite(data.uniqueVisitors) ? data.uniqueVisitors : '-';
            if (pv) pv.textContent = Number.isFinite(data.pageviews) ? data.pageviews : '-';
            if (uvMeta) uvMeta.textContent = data.uniqueVisitors >= 0 ? `Unique ${label}` : '';
            if (pvMeta) pvMeta.textContent = data.pageviews >= 0 ? `Pageviews ${label}` : '';
        });
    }

    function renderTopList(listEl, items, emptyText) {
        if (!listEl) return;
        listEl.innerHTML = '';
        if (!items || !items.length) {
            const li = document.createElement('li');
            li.textContent = emptyText;
            listEl.appendChild(li);
            return;
        }
        items.forEach((item) => {
            const li = document.createElement('li');
            const mainLabel = item.label || item.pinId || item.source || 'N/A';
            li.textContent = `${mainLabel} — ${item.count}`;
            listEl.appendChild(li);
        });
    }

    let metricsMap = null;
    let metricsMarkers = [];

    async function renderHeatmap() {
        if (!els.metricsHeatmap) return;
        try {
            const gmaps = await ensureGoogleMaps();
            if (!metricsMap) {
                metricsMap = new gmaps.Map(els.metricsHeatmap, {
                    center: METRICS_DEFAULT_CENTER,
                    zoom: 4,
                    mapTypeControl: false,
                    streetViewControl: false,
                    fullscreenControl: false
                });
                const bounds = new gmaps.LatLngBounds(
                    new gmaps.LatLng(INDONESIA_BOUNDS.sw.lat, INDONESIA_BOUNDS.sw.lng),
                    new gmaps.LatLng(INDONESIA_BOUNDS.ne.lat, INDONESIA_BOUNDS.ne.lng)
                );
                metricsMap.fitBounds(bounds);
            }
            metricsMarkers.forEach((marker) => marker.setMap(null));
            metricsMarkers = [];
            state.heatmapPoints.forEach((point) => {
                const pos = { lat: point.lat, lng: point.lng };
                const marker = new gmaps.Circle({
                    center: pos,
                    radius: Math.min(50000, 5000 + point.count * 800),
                    strokeColor: '#38bdf8',
                    strokeOpacity: 0.7,
                    strokeWeight: 1,
                    fillColor: '#38bdf8',
                    fillOpacity: 0.25,
                    map: metricsMap
                });
                metricsMarkers.push(marker);
            });
            metricsMap.setCenter(METRICS_DEFAULT_CENTER);
            metricsMap.setZoom(4);
        } catch (error) {
            console.warn('Render heatmap gagal', error);
        }
    }

    async function refreshAnalytics(filter = state.metricsFilter) {
        await Promise.all([
            fetchAnalyticsSummary(filter),
            fetchTopPins(filter),
            fetchTopSources(filter),
            fetchHeatmap(filter),
            fetchTopCities(filter)
        ]);
        renderSummaryCards();
        renderTopList(
            els.topPinsList,
            state.topPins.map((item) => ({
                label: item.category || 'Tidak diketahui',
                count: item.count
            })),
            'Belum ada data pin.'
        );
        renderTopList(
            els.topSourcesList,
            state.topSources.map((item) => ({ label: item.source, count: item.count })),
            'Belum ada data sumber trafik.'
        );
        renderTopList(
            els.topCitiesList,
            state.topCities.map((item) => ({
                label: item.label || `${item.city || ''}${item.country ? `, ${item.country}` : ''}` || 'Unknown',
                count: item.count
            })),
            'Belum ada data lokasi.'
        );
        renderHeatmap();
        state.metricsLoaded = true;
    }

    function renderLineChart(container, series = [], options = {}) {
        if (!container) return;
        container.innerHTML = '';
        const width = container.clientWidth || 320;
        const height = 200;
        const padding = 24;
        const values = series.map((item) => item.value || 0);
        const max = Math.max(...values, 1);
        const min = Math.min(...values, 0);
        const range = max - min || 1;
        const points = series.map((item, index) => {
            const x = padding + (index / Math.max(series.length - 1, 1)) * (width - padding * 2);
            const y = padding + (1 - (item.value - min) / range) * (height - padding * 2);
            return `${x},${y}`;
        });
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        // axes
        const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        yAxis.setAttribute('x1', padding);
        yAxis.setAttribute('x2', padding);
        yAxis.setAttribute('y1', padding);
        yAxis.setAttribute('y2', height - padding);
        yAxis.setAttribute('stroke', '#334155');
        yAxis.setAttribute('stroke-width', '1');
        svg.appendChild(yAxis);
        const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        axis.setAttribute('x1', padding);
        axis.setAttribute('x2', width - padding);
        axis.setAttribute('y1', height - padding);
        axis.setAttribute('y2', height - padding);
        axis.setAttribute('stroke', '#334155');
        axis.setAttribute('stroke-width', '1');
        svg.appendChild(axis);
        // y labels
        const yTicks = 4;
        for (let i = 0; i <= yTicks; i++) {
            const value = min + (range * i) / yTicks;
            const y = padding + (1 - (value - min) / range) * (height - padding * 2);
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', padding - 6);
            text.setAttribute('y', y + 4);
            text.setAttribute('text-anchor', 'end');
            text.setAttribute('fill', '#94a3b8');
            text.setAttribute('font-size', '10');
            text.textContent = Math.round(value);
            svg.appendChild(text);
        }
        // x labels
        const xStep = Math.max(1, Math.floor(series.length / 4));
        series.forEach((item, index) => {
            if (index % xStep !== 0 && index !== series.length - 1) return;
            const x = padding + (index / Math.max(series.length - 1, 1)) * (width - padding * 2);
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', x);
            text.setAttribute('y', height - padding + 12);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('fill', '#94a3b8');
            text.setAttribute('font-size', '10');
            text.textContent = item.label || '';
            svg.appendChild(text);
        });
        if (points.length) {
            const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            polyline.setAttribute('points', points.join(' '));
            polyline.setAttribute('fill', 'none');
            polyline.setAttribute('stroke', options.color || '#38bdf8');
            polyline.setAttribute('stroke-width', '2');
            svg.appendChild(polyline);
        }
        container.appendChild(svg);
    }

    async function refreshTimeseries(filter) {
        const granularity = filter?.granularity || els.metricsGranularity?.value || 'month';
        const params = { granularity };
        const now = new Date();
        if (granularity === 'day') {
            params.year = filter?.year || Number(els.metricsYear?.value) || now.getFullYear();
            params.month = filter?.month || Number(els.metricsMonth?.value) || now.getMonth() + 1;
        } else if (granularity === 'month') {
            params.year = filter?.year || Number(els.metricsYear?.value) || now.getFullYear();
        } else {
            params.startYear = filter?.startYear || Number(els.metricsStartYear?.value) || now.getFullYear() - 2;
            params.endYear = filter?.endYear || Number(els.metricsEndYear?.value) || now.getFullYear();
        }
        try {
            const series = await fetchTimeseries(params);
            const uvSeries = series.map((item) => ({ label: item.label, value: item.uniqueVisitors || 0 }));
            const pvSeries = series.map((item) => ({ label: item.label, value: item.pageviews || 0 }));
            renderLineChart(els.uvChart, uvSeries, { color: '#38bdf8' });
            renderLineChart(els.pvChart, pvSeries, { color: '#8b5cf6' });
        } catch (error) {
            console.warn('Gagal memuat grafik', error);
        }
    }

    function syncMetricsControlsVisibility() {
        const granularity = els.metricsGranularity?.value || 'month';
        if (els.metricsMonthWrap) {
            els.metricsMonthWrap.style.display = granularity === 'day' ? 'flex' : 'none';
        }
        if (els.metricsYearWrap) {
            els.metricsYearWrap.style.display = granularity === 'day' || granularity === 'month' ? 'flex' : 'none';
        }
        if (els.metricsYearRangeWrap) {
            els.metricsYearRangeWrap.style.display = granularity === 'year' ? 'flex' : 'none';
        }
    }

    function applyMetricsFilterFromInputs() {
        const granularity = els.metricsGranularity?.value || 'month';
        const now = new Date();
        const filter = { granularity };
        if (granularity === 'day') {
            filter.year = Number(els.metricsYear?.value) || now.getFullYear();
            filter.month = Number(els.metricsMonth?.value) || now.getMonth() + 1;
        } else if (granularity === 'month') {
            filter.year = Number(els.metricsYear?.value) || now.getFullYear();
        } else {
            filter.startYear = Number(els.metricsStartYear?.value) || now.getFullYear() - 2;
            filter.endYear = Number(els.metricsEndYear?.value) || now.getFullYear();
        }
        state.metricsFilter = filter;
        refreshTimeseries(filter);
        refreshAnalytics(filter);
    }

    const DASHBOARD_BASE_URL = 'https://charts.mongodb.com/charts-project-0-kbfncdr/public/dashboards/68c78cea-8f99-422a-8fe9-7dd1e7765ab1';

    async function loadDashboard() {
        if (!els.dashboardFrame) return;
        try {
            const response = await fetch('/api/analytics/dashboard-password');
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.password) {
                throw new Error(data?.message || 'Password dashboard tidak tersedia.');
            }
            const src = `${DASHBOARD_BASE_URL}?password=${encodeURIComponent(data.password)}`;
            els.dashboardFrame.src = src;
            if (els.dashboardError) {
                els.dashboardError.textContent = '';
            }
        } catch (error) {
            console.warn('Gagal memuat dashboard', error);
            if (els.dashboardError) {
                els.dashboardError.textContent = error.message || 'Dashboard tidak dapat dimuat.';
            }
        }
    }

    function setActiveTab(tabKey) {
        if (!els.tabButtons || !els.tabButtons.length) return;
        els.tabButtons.forEach((btn) => {
            const isActive = btn.dataset.tab === tabKey;
            btn.classList.toggle('admin-tab--active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        if (els.pinContent) {
            els.pinContent.classList.toggle('hidden', tabKey !== 'pins');
        }
        if (els.metricsContent) {
            els.metricsContent.classList.toggle('hidden', tabKey !== 'metrics');
        }
        if (tabKey === 'metrics' && !state.metricsLoaded) {
            refreshAnalytics();
        }
    }

    function sortPins(pins = []) {
        return pins
            .slice()
            .sort((a, b) => {
                const dateA = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
                const dateB = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
                if (dateA !== dateB) {
                    return dateB - dateA;
                }
                return String(a.title || '').localeCompare(String(b.title || ''));
            });
    }

    function renderPinList() {
        if (!els.pinList) {
            return;
        }
        els.pinList.innerHTML = '';
        const pins = sortPins(state.filteredPins);
        if (!pins.length) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'pin-list-empty';
            emptyEl.textContent = 'Tidak ada pin yang cocok.';
            els.pinList.appendChild(emptyEl);
            return;
        }
        pins.forEach((pin) => {
            const id = getPinId(pin);
            const item = document.createElement('li');
            item.className = 'pin-list-item';
            if (state.selectedPin && getPinId(state.selectedPin) === id) {
                item.classList.add('is-active');
            }
            const textContainer = document.createElement('div');
            const title = document.createElement('div');
            title.className = 'pin-list-title';
            title.textContent = pin.title || 'Tanpa judul';
            const meta = document.createElement('p');
            meta.className = 'pin-list-meta';
            meta.textContent = formatPinMeta(pin);
            textContainer.appendChild(title);
            textContainer.appendChild(meta);
            item.appendChild(textContainer);
            item.addEventListener('click', () => selectPin(id));
            els.pinList.appendChild(item);
        });
    }

    function applySearchFilter() {
        const query = (els.pinSearch?.value || '').trim().toLowerCase();
        if (!query) {
            state.filteredPins = state.pins.slice();
            renderPinList();
            return;
        }
        state.filteredPins = state.pins.filter((pin) => {
            const haystack = [pin.title, pin.description, pin.category, pin.city]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return haystack.includes(query);
        });
        renderPinList();
    }

    async function refreshPinCount() {
        if (!els.pinCount) {
            return;
        }
        try {
            const response = await fetch('/api/pins/count', { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            const count = Number(payload?.count);
            if (Number.isFinite(count)) {
                els.pinCount.textContent = count;
                if (els.pinCountSubtext) {
                    const now = new Date();
                    const time = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                    els.pinCountSubtext.textContent = `Diperbarui ${time}`;
                }
                return;
            }
        } catch (error) {
            console.warn('Gagal memuat jumlah pin', error);
        }
        els.pinCount.textContent = state.filteredPins.length || state.pins.length || '-';
        if (els.pinCountSubtext) {
            els.pinCountSubtext.textContent = 'Menggunakan data terbaru yang dimuat.';
        }
    }

    async function loadPins() {
        try {
            const response = await fetch('/api/pins', { cache: 'no-store' });
            const pins = await response.json().catch(() => []);
            state.pins = Array.isArray(pins) ? pins : [];
            state.filteredPins = state.pins.slice();
            applySearchFilter();
            await refreshPinCount();
            if (state.selectedPin) {
                const selectedId = getPinId(state.selectedPin);
                const stillExists = state.pins.some((pin) => getPinId(pin) === selectedId);
                if (stillExists) {
                    selectPin(selectedId, { silentMessage: true });
                    return;
                }
            }
            if (state.pins.length) {
                selectPin(getPinId(state.pins[0]), { silentMessage: true });
            } else {
                clearSelection();
            }
        } catch (error) {
            console.error('Gagal memuat pin', error);
            showMessage('error', 'Gagal memuat data pin. Coba refresh kembali.');
        }
    }

    function clearSelection() {
        state.selectedPin = null;
        state.existingImages = [];
        state.addedImages = [];
        setFormDisabled(true);
        if (els.lifetimeSelect) {
            els.lifetimeSelect.value = '';
        }
        setDateInputs('', '');
        setLocationInputs('', '');
        renderImages();
    }

    function setFormDisabled(disabled) {
        const controls = [
            els.titleInput,
            els.descriptionInput,
            els.categoryInput,
            els.linkInput,
            els.lifetimeSelect,
            els.lifetimeStartInput,
            els.lifetimeEndInput,
            els.latInput,
            els.lngInput,
            els.imageInput,
            els.saveBtn
        ];
        controls.forEach((el) => {
            if (el) {
                el.disabled = disabled;
            }
        });
    }

    function selectPin(id, options = {}) {
        const pin = state.pins.find((entry) => getPinId(entry) === id) || null;
        state.selectedPin = pin;
        state.addedImages = [];
        state.existingImages = normalizeImages(pin);
        if (!pin) {
            clearSelection();
            if (!options.silentMessage) {
                showMessage('error', 'Pin tidak ditemukan.');
            }
            renderPinList();
            return;
        }
        if (els.editorTitle) {
            els.editorTitle.textContent = pin.title || 'Tanpa judul';
        }
        setFormDisabled(false);
        if (els.titleInput) {
            els.titleInput.value = pin.title || '';
        }
        if (els.descriptionInput) {
            els.descriptionInput.value = pin.description || '';
        }
        if (els.categoryInput) {
            els.categoryInput.value = pin.category || '';
        }
        if (els.linkInput) {
            els.linkInput.value = pin.link || '';
        }
        if (els.lifetimeSelect) {
            const type = pin.lifetime?.type || '';
            els.lifetimeSelect.value = type === 'today' || type === 'date' ? type : '';
        }
        const lifetime = pin.lifetime || {};
        const startDisplay = formatDateForInput(lifetime.start || lifetime.value || '');
        const endDisplay = formatDateForInput(lifetime.end || '');
        setDateInputs(startDisplay, endDisplay);
        setLocationInputs(formatCoord(pin.lat), formatCoord(pin.lng));
        renderImages();
        renderPinList();
        showMessage(null, '');
        centerMiniMapOnCurrentCoords();
    }

    function formatCoord(value) {
        if (value === null || value === undefined) {
            return '';
        }
        const num = Number(value);
        if (!Number.isFinite(num)) {
            return '';
        }
        return num.toFixed(6);
    }

    function normalizeDateParts(raw) {
        if (!raw || typeof raw !== 'string') {
            return null;
        }
        const trimmed = raw.trim();
        if (!trimmed) {
            return null;
        }
        if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
            const [y, m, d] = trimmed.split('-').map((part) => parseInt(part, 10));
            if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
                return { y, m, d };
            }
            return null;
        }
        const match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/.exec(trimmed);
        if (match) {
            const d = parseInt(match[1], 10);
            const m = parseInt(match[2], 10);
            let y = parseInt(match[3], 10);
            if (y < 100) {
                y += 2000;
            }
            if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
                return { y, m, d };
            }
        }
        return null;
    }

    function formatDateForInput(raw) {
        const parts = normalizeDateParts(raw);
        if (!parts) {
            return '';
        }
        const dd = String(parts.d).padStart(2, '0');
        const mm = String(parts.m).padStart(2, '0');
        const yyyy = String(parts.y);
        return `${dd}/${mm}/${yyyy}`;
    }

    function parseDateInput(value) {
        const parts = normalizeDateParts(value);
        if (!parts) {
            return '';
        }
        const { y, m, d } = parts;
        if (m < 1 || m > 12 || d < 1 || d > 31) {
            return '';
        }
        const mm = String(m).padStart(2, '0');
        const dd = String(d).padStart(2, '0');
        return `${y}-${mm}-${dd}`;
    }

    function parseCoordInput(value) {
        if (value === null || value === undefined) {
            return null;
        }
        const num = Number(String(value).trim());
        if (!Number.isFinite(num)) {
            return null;
        }
        return num;
    }

    function setDateInputs(startValue, endValue) {
        if (els.lifetimeStartInput) {
            els.lifetimeStartInput.value = startValue || '';
        }
        if (els.lifetimeEndInput) {
            els.lifetimeEndInput.value = endValue || '';
        }
    }

    function setLocationInputs(lat, lng) {
        if (els.latInput) {
            els.latInput.value = lat || '';
        }
        if (els.lngInput) {
            els.lngInput.value = lng || '';
        }
    }

    function normalizeImages(pin) {
        if (!pin || !Array.isArray(pin.images)) {
            return [];
        }
        return pin.images
            .map((image, index) => {
                const dataUrl = resolveImageDataUrl(image);
                if (!dataUrl) {
                    return null;
                }
                const id = getImageIdentifier(image) || `img-${index}`;
                return {
                    id,
                    dataUrl,
                    contentType: image.contentType || 'image/jpeg',
                    size: Number(image.size || image.bytes || 0) || 0,
                    originalName: image.originalName || image.name || '',
                    removed: false
                };
            })
            .filter(Boolean);
    }

    function getImageIdentifier(image) {
        if (!image || typeof image !== 'object') {
            return '';
        }
        const keys = ['_id', 'id', 'existingId', 'imageId', 'uid', 'dataUrl', 'url', 'src', 'data'];
        for (const key of keys) {
            const value = image[key];
            if (typeof value === 'string' && value) {
                return value;
            }
        }
        return '';
    }

    function resolveImageDataUrl(image) {
        if (!image) {
            return '';
        }
        if (typeof image === 'string') {
            return image;
        }
        if (typeof image.dataUrl === 'string') {
            return image.dataUrl;
        }
        if (typeof image.data === 'string' && image.data) {
            if (image.data.startsWith('data:')) {
                return image.data;
            }
            return `data:${image.contentType || 'image/jpeg'};base64,${image.data}`;
        }
        return '';
    }

    function renderImages() {
        renderExistingImages();
        renderNewImages();
        updateRemainingSlots();
    }

    async function centerMiniMapOnCurrentCoords() {
        const coords = getCurrentCoords() || getPinCoords(state.selectedPin);
        if (!coords) {
            return;
        }
        try {
            await initMiniMap();
            setMiniMapPosition(coords, { pan: true });
        } catch (error) {
            console.warn('Tidak dapat memusatkan peta mini', error);
        }
    }

    async function initMiniMap() {
        if (!els.miniMapContainer || miniMap) {
            return;
        }
        try {
            const gmaps = await ensureGoogleMaps();
            miniGeocoder = new gmaps.Geocoder();
            const initial = getCurrentCoords() || getPinCoords(state.selectedPin) || DEFAULT_COORDS;
            miniMap = new gmaps.Map(els.miniMapContainer, {
                center: initial,
                zoom: 13,
                mapTypeControl: false,
                fullscreenControl: false,
                streetViewControl: false
            });
            miniMarker = new gmaps.Marker({
                position: initial,
                map: miniMap,
                draggable: true
            });
            miniMarker.addListener('dragend', (event) => {
                const pos = event.latLng;
                if (!pos) return;
                const coords = { lat: pos.lat(), lng: pos.lng() };
                setLocationInputs(formatCoord(coords.lat), formatCoord(coords.lng));
            });
            miniMap.addListener('click', (event) => {
                const pos = event.latLng;
                if (!pos) return;
                const coords = { lat: pos.lat(), lng: pos.lng() };
                setLocationInputs(formatCoord(coords.lat), formatCoord(coords.lng));
                setMiniMapPosition(coords, { pan: true });
            });
        } catch (error) {
            console.warn('Mini map gagal dimuat', error);
            showMessage('error', 'Peta mini tidak dapat dimuat, isi koordinat manual.');
        }
    }

    function setMiniMapPosition(coords, options = {}) {
        if (!miniMap || !miniMarker || !coords) {
            return;
        }
        miniMarker.setPosition(coords);
        if (options.pan !== false) {
            miniMap.panTo(coords);
        }
    }

    function updateMiniMapFromInputs() {
        const coords = getCurrentCoords();
        if (!coords) {
            return;
        }
        setMiniMapPosition(coords, { pan: false });
    }

    async function handleMiniMapSearch() {
        const query = els.miniMapSearchInput?.value.trim() || '';
        if (!query) {
            showMessage('error', 'Masukkan kata kunci lokasi untuk mencari.');
            return;
        }
        try {
            await initMiniMap();
            if (!miniGeocoder) {
                throw new Error('Geocoder belum siap.');
            }
            const result = await miniGeocoder.geocode({ address: query });
            const results = result?.results || [];
            if (!results.length) {
                showMessage('error', 'Lokasi tidak ditemukan, coba kata kunci lain.');
                return;
            }
            const loc = results[0].geometry?.location;
            if (!loc || typeof loc.lat !== 'function' || typeof loc.lng !== 'function') {
                showMessage('error', 'Lokasi tidak ditemukan, coba kata kunci lain.');
                return;
            }
            const coords = { lat: loc.lat(), lng: loc.lng() };
            setLocationInputs(formatCoord(coords.lat), formatCoord(coords.lng));
            setMiniMapPosition(coords, { pan: true });
            showMessage(null, '');
        } catch (error) {
            console.warn('Pencarian peta mini gagal', error);
            showMessage('error', error.message || 'Gagal mencari lokasi.');
        }
    }

    function renderExistingImages() {
        if (!els.existingImages) {
            return;
        }
        els.existingImages.innerHTML = '';
        if (!state.existingImages.length) {
            const empty = document.createElement('div');
            empty.className = 'pin-list-empty';
            empty.textContent = 'Belum ada foto tersimpan.';
            els.existingImages.appendChild(empty);
            return;
        }
        state.existingImages.forEach((image) => {
            const card = document.createElement('div');
            card.className = 'image-card';
            if (image.removed) {
                card.classList.add('is-removed');
            }
            const img = document.createElement('img');
            img.src = image.dataUrl;
            img.alt = image.originalName || 'Foto pin';
            card.appendChild(img);

            const actions = document.createElement('div');
            actions.className = 'image-actions';
            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.textContent = image.removed ? 'Pulihkan' : 'Hapus';
            toggleBtn.addEventListener('click', () => {
                image.removed = !image.removed;
                renderImages();
            });
            actions.appendChild(toggleBtn);
            card.appendChild(actions);

            const meta = document.createElement('div');
            meta.className = 'image-meta';
            meta.textContent = image.originalName || 'Foto tersimpan';
            card.appendChild(meta);

            els.existingImages.appendChild(card);
        });
    }

    function renderNewImages() {
        if (!els.newImages) {
            return;
        }
        els.newImages.innerHTML = '';
        if (!state.addedImages.length) {
            return;
        }
        state.addedImages.forEach((image, index) => {
            const card = document.createElement('div');
            card.className = 'image-card';
            const img = document.createElement('img');
            img.src = image.dataUrl;
            img.alt = image.originalName || 'Foto baru';
            card.appendChild(img);

            const actions = document.createElement('div');
            actions.className = 'image-actions';
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.textContent = 'Hapus';
            removeBtn.addEventListener('click', () => {
                removeAddedImage(index);
            });
            actions.appendChild(removeBtn);
            card.appendChild(actions);

            const meta = document.createElement('div');
            meta.className = 'image-meta';
            meta.textContent = image.originalName || 'Foto baru';
            card.appendChild(meta);

            els.newImages.appendChild(card);
        });
    }

    function removeAddedImage(index) {
        if (index < 0 || index >= state.addedImages.length) {
            return;
        }
        state.addedImages.splice(index, 1);
        renderImages();
    }

    function updateRemainingSlots() {
        if (!els.photoRemaining) {
            return;
        }
        const keptExisting = state.existingImages.filter((image) => !image.removed).length;
        const remaining = Math.max(0, MAX_PIN_PHOTO_COUNT - keptExisting - state.addedImages.length);
        els.photoRemaining.textContent = `Sisa ${remaining} foto lagi`;
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Tidak dapat membaca file.'));
            reader.readAsDataURL(file);
        });
    }

    async function handleImageInput(event) {
        const files = Array.from(event?.target?.files || []);
        if (els.imageInput) {
            els.imageInput.value = '';
        }
        const keptExisting = state.existingImages.filter((image) => !image.removed).length;
        let remainingSlots = Math.max(0, MAX_PIN_PHOTO_COUNT - keptExisting - state.addedImages.length);
        if (!remainingSlots) {
            showMessage('error', 'Batas 3 foto per pin. Hapus foto yang tidak dipakai terlebih dulu.');
            return;
        }
        const errors = [];
        for (const file of files) {
            if (remainingSlots <= 0) {
                break;
            }
            if (!file.type || !file.type.toLowerCase().startsWith('image/')) {
                errors.push(`"${file.name}" bukan gambar.`);
                continue;
            }
            if (file.size > MAX_PIN_PHOTO_BYTES) {
                errors.push(`"${file.name}" lebih dari 4MB.`);
                continue;
            }
            try {
                const dataUrl = await readFileAsDataUrl(file);
                state.addedImages.push({
                    dataUrl,
                    contentType: file.type || 'image/jpeg',
                    size: file.size || 0,
                    originalName: file.name || ''
                });
                remainingSlots -= 1;
            } catch (error) {
                errors.push(`"${file.name}" tidak bisa dibaca.`);
            }
        }
        if (errors.length) {
            showMessage('error', errors.join(' '));
        } else {
            showMessage(null, '');
        }
        renderImages();
    }

    function buildImagesPayload() {
        const existingPayload = state.existingImages
            .filter((image) => !image.removed)
            .map((image) => ({
                existingId: image.id,
                dataUrl: image.dataUrl,
                contentType: image.contentType,
                size: image.size,
                originalName: image.originalName
            }))
            .filter((item) => item.dataUrl);
        const remaining = Math.max(0, MAX_PIN_PHOTO_COUNT - existingPayload.length);
        const addedPayload = state.addedImages
            .slice(0, remaining)
            .map((image) => ({
                dataUrl: image.dataUrl,
                contentType: image.contentType,
                size: image.size,
                originalName: image.originalName
            }));
        return existingPayload.concat(addedPayload).slice(0, MAX_PIN_PHOTO_COUNT);
    }

    function setSavingState(isSaving) {
        if (els.saveBtn) {
            els.saveBtn.disabled = isSaving;
            els.saveBtn.textContent = isSaving ? 'Menyimpan...' : 'Simpan Perubahan';
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (!state.selectedPin) {
            showMessage('error', 'Pilih pin yang ingin diedit.');
            return;
        }
        const title = els.titleInput?.value.trim() || '';
        const description = els.descriptionInput?.value.trim() || '';
        const category = els.categoryInput?.value.trim() || '';
        const link = els.linkInput?.value.trim() || '';
        const lifetimeType = els.lifetimeSelect?.value || '';
        const lifetimeStartRaw = els.lifetimeStartInput?.value || '';
        const lifetimeEndRaw = els.lifetimeEndInput?.value || '';
        const lifetimeStart = parseDateInput(lifetimeStartRaw);
        const lifetimeEnd = parseDateInput(lifetimeEndRaw);
        const latValue = els.latInput?.value || '';
        const lngValue = els.lngInput?.value || '';
        const latNum = parseCoordInput(latValue);
        const lngNum = parseCoordInput(lngValue);

        if (!title || !description || !category) {
            showMessage('error', 'Judul, deskripsi, dan kategori wajib diisi.');
            return;
        }

        if ((latValue || lngValue) && (!Number.isFinite(latNum) || !Number.isFinite(lngNum))) {
            showMessage('error', 'Masukkan koordinat Lat dan Lng yang valid atau kosongkan keduanya.');
            return;
        }

        const payload = {
            title,
            description,
            category
        };

        payload.link = link;

        if (lifetimeType) {
            if (lifetimeType === 'date') {
                const lifetime = { type: 'date' };
                if (lifetimeStart && lifetimeEnd && lifetimeStart !== lifetimeEnd) {
                    lifetime.start = lifetimeStart;
                    lifetime.end = lifetimeEnd;
                } else if (lifetimeStart) {
                    lifetime.value = lifetimeStart;
                } else if (lifetimeEnd) {
                    lifetime.value = lifetimeEnd;
                }
                payload.lifetime = lifetime;
            } else {
                payload.lifetime = { type: lifetimeType };
            }
        } else if (lifetimeStart || lifetimeEnd) {
            const lifetime = { type: 'date' };
            if (lifetimeStart && lifetimeEnd && lifetimeStart !== lifetimeEnd) {
                lifetime.start = lifetimeStart;
                lifetime.end = lifetimeEnd;
            } else if (lifetimeStart) {
                lifetime.value = lifetimeStart;
            } else if (lifetimeEnd) {
                lifetime.value = lifetimeEnd;
            }
            payload.lifetime = lifetime;
        }

        payload.images = buildImagesPayload();
        if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
            payload.lat = latNum;
            payload.lng = lngNum;
        }

        const headers = {
            'Content-Type': 'application/json'
        };
        const token = getToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        setSavingState(true);
        showMessage(null, '');
        try {
            const pinId = getPinId(state.selectedPin);
            const response = await fetch(`/api/pins/${pinId}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify(payload)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data?.message || 'Gagal menyimpan perubahan pin.');
            }
            const updatedPin = data;
            const idx = state.pins.findIndex((pin) => getPinId(pin) === pinId);
            if (idx !== -1) {
                state.pins[idx] = updatedPin;
            }
            state.filteredPins = state.pins.slice();
            selectPin(pinId, { silentMessage: true });
            renderPinList();
            showMessage('success', 'Pin berhasil diperbarui.');
            await refreshPinCount();
        } catch (error) {
            console.error('Gagal memperbarui pin', error);
            showMessage('error', error.message || 'Terjadi kesalahan saat menyimpan.');
        } finally {
            setSavingState(false);
        }
    }

    async function handleDeletePin() {
        if (!state.selectedPin) {
            showMessage('error', 'Pilih pin yang ingin dihapus.');
            return;
        }
        const pinId = getPinId(state.selectedPin);
        if (!pinId) {
            showMessage('error', 'Pin tidak valid.');
            return;
        }
        const confirmed = window.confirm('Hapus pin ini secara permanen?');
        if (!confirmed) {
            return;
        }
        const headers = {};
        const token = getToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        try {
            setSavingState(true);
            const response = await fetch(`/api/pins/${pinId}`, {
                method: 'DELETE',
                headers
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data?.message || 'Gagal menghapus pin.');
            }
            state.pins = state.pins.filter((pin) => getPinId(pin) !== pinId);
            state.filteredPins = state.pins.slice();
            state.selectedPin = null;
            renderPinList();
            clearSelection();
            await refreshPinCount();
            showMessage('success', 'Pin berhasil dihapus.');
        } catch (error) {
            console.error('Gagal menghapus pin', error);
            showMessage('error', error.message || 'Terjadi kesalahan saat menghapus.');
        } finally {
            setSavingState(false);
        }
    }

    function bindEvents() {
        if (els.pinSearch) {
            els.pinSearch.addEventListener('input', applySearchFilter);
        }
        if (els.refreshPinsBtn) {
            els.refreshPinsBtn.addEventListener('click', () => {
                loadPins();
            });
        }
        if (els.imageInput) {
            els.imageInput.addEventListener('change', handleImageInput);
        }
        if (els.form) {
            els.form.addEventListener('submit', handleSubmit);
        }
        if (els.logoutBtn) {
            els.logoutBtn.addEventListener('click', async () => {
                try {
                    if (typeof ResidentSession !== 'undefined' && typeof ResidentSession.logoutResident === 'function') {
                        await ResidentSession.logoutResident();
                    }
                } finally {
                    redirectToLogin();
                }
            });
        }
        if (els.deletePinBtn) {
            els.deletePinBtn.addEventListener('click', handleDeletePin);
        }
        if (els.latInput) {
            els.latInput.addEventListener('change', updateMiniMapFromInputs);
            els.latInput.addEventListener('blur', updateMiniMapFromInputs);
        }
        if (els.lngInput) {
            els.lngInput.addEventListener('change', updateMiniMapFromInputs);
            els.lngInput.addEventListener('blur', updateMiniMapFromInputs);
        }
        if (els.miniMapSearchBtn) {
            els.miniMapSearchBtn.addEventListener('click', handleMiniMapSearch);
        }
        if (els.miniMapSearchInput) {
            els.miniMapSearchInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    handleMiniMapSearch();
                }
            });
        }
        if (els.metricsRefreshBtn) {
            els.metricsRefreshBtn.addEventListener('click', () => {
                refreshAnalytics();
            });
        }
        if (els.tabButtons && els.tabButtons.length) {
            els.tabButtons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    const tab = btn.dataset.tab || 'pins';
                    setActiveTab(tab);
                });
            });
        }
        if (els.metricsGranularity) {
            els.metricsGranularity.addEventListener('change', () => {
                syncMetricsControlsVisibility();
            });
        }
        if (els.metricsApply) {
            els.metricsApply.addEventListener('click', () => {
                applyMetricsFilterFromInputs();
            });
        }
        if (els.dashboardReloadBtn) {
            els.dashboardReloadBtn.addEventListener('click', loadDashboard);
        }
    }

    async function init() {
        cacheElements();
        setFormDisabled(true);
        bindEvents();
        if (els.metricsYear) {
            els.metricsYear.value = state.metricsFilter.year;
        }
        if (els.metricsMonth) {
            els.metricsMonth.value = state.metricsFilter.month;
        }
        if (els.metricsStartYear) {
            els.metricsStartYear.value = state.metricsFilter.startYear;
        }
        if (els.metricsEndYear) {
            els.metricsEndYear.value = state.metricsFilter.endYear;
        }
        try {
            await ensureAdminSession();
        } catch (error) {
            showMessage('error', error.message || 'Gagal memuat sesi admin.');
            return;
        }
        initMiniMap();
        loadPins();
        setActiveTab('pins');
        syncMetricsControlsVisibility();
        applyMetricsFilterFromInputs();
        loadDashboard();
    }

    document.addEventListener('DOMContentLoaded', init);
})();

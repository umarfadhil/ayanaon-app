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
        filters: {
            category: '',
            link: 'any',
            startDate: 'any',
            endDate: 'any',
            photo: 'any'
        },
        selectedPin: null,
        existingImages: [],
        addedImages: [],
        analyticsSummary: null,
        topPins: [],
        topSources: [],
        heatmapPoints: [],
        topCities: [],
        metricsLoaded: false,
        usersLoaded: false,
        usersLoading: false,
        metricsFilter: {
            granularity: 'day',
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1,
            startYear: new Date().getFullYear() - 2,
            endYear: new Date().getFullYear()
        },
        maintenance: {
            enabled: false,
            message: ''
        },
        features: {
            gerobakOnline: true
        },
        seo: {
            title: '',
            description: '',
            keywords: '',
            siteUrl: '',
            ogTitle: '',
            ogDescription: '',
            ogImage: '',
            twitterTitle: '',
            twitterDescription: '',
            twitterImage: '',
            robotsIndex: true,
            robotsFollow: true,
            googleSiteVerification: ''
        },
        seoLoaded: false,
        residents: [],
        permissions: {
            isAdmin: false,
            canManagePins: false,
            role: ''
        },
        tabs: {
            visibilityDraft: null,
            dirty: false,
            visibilityRemote: null,
            isSaving: false
        },
        categories: {
            list: [],
            draft: [],
            dirty: false,
            loaded: false,
            isSaving: false
        },
        mass: {
            results: [],
            selectedPlaceIds: new Set(),
            addedImages: [],
            isSearching: false,
            isCreating: false
        }
    };

    const els = {};
    let miniMap = null;
    let miniMarker = null;
    let miniGeocoder = null;
    let googleMapsPromise = null;
    let massMap = null;
    let massPlacesService = null;
    let massGeocoder = null;
    let massInfoWindow = null;
    let massMarkers = new Map();
    let massMarkerBounds = null;

    function cacheElements() {
        els.pinCount = document.getElementById('pin-count');
        els.pinCountSubtext = document.getElementById('pin-count-subtext');
        els.refreshPinsBtn = document.getElementById('refresh-pins-btn');
        els.pinList = document.getElementById('pin-list');
        els.pinSearch = document.getElementById('pin-search');
        els.pinSearchBtn = document.getElementById('pin-search-btn');
        els.filterCategory = document.getElementById('filter-category');
        els.filterLinkRadios = Array.from(document.querySelectorAll('input[name="filter-link"]')) || [];
        els.filterStartRadios = Array.from(document.querySelectorAll('input[name="filter-start"]')) || [];
        els.filterEndRadios = Array.from(document.querySelectorAll('input[name="filter-end"]')) || [];
        els.filterPhotoRadios = Array.from(document.querySelectorAll('input[name="filter-photo"]')) || [];
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
        els.maintenanceToggle = document.getElementById('maintenance-toggle');
        els.maintenanceMessage = document.getElementById('maintenance-message');
        els.maintenanceSaveBtn = document.getElementById('maintenance-save-btn');
        els.maintenanceStatusLabel = document.getElementById('maintenance-status-label');
        els.maintenanceMeta = document.getElementById('maintenance-meta');
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
        els.featuresContent = document.getElementById('admin-features-pane');
        els.featureGerobakToggle = document.getElementById('feature-gerobak-toggle');
        els.featureSaveBtn = document.getElementById('feature-save-btn');
        els.featureMessage = document.getElementById('admin-feature-message');
        els.seoContent = document.getElementById('admin-seo-pane');
        els.seoMessage = document.getElementById('admin-seo-message');
        els.seoTitleInput = document.getElementById('seo-title');
        els.seoDescriptionInput = document.getElementById('seo-description');
        els.seoKeywordsInput = document.getElementById('seo-keywords');
        els.seoSiteUrlInput = document.getElementById('seo-site-url');
        els.seoOgTitleInput = document.getElementById('seo-og-title');
        els.seoOgDescriptionInput = document.getElementById('seo-og-description');
        els.seoOgImageInput = document.getElementById('seo-og-image');
        els.seoTwitterTitleInput = document.getElementById('seo-twitter-title');
        els.seoTwitterDescriptionInput = document.getElementById('seo-twitter-description');
        els.seoTwitterImageInput = document.getElementById('seo-twitter-image');
        els.seoRobotsIndexToggle = document.getElementById('seo-robots-index');
        els.seoRobotsFollowToggle = document.getElementById('seo-robots-follow');
        els.seoGoogleVerificationInput = document.getElementById('seo-google-verification');
        els.seoSaveBtn = document.getElementById('seo-save-btn');
        els.seoPreviewTitle = document.getElementById('seo-preview-title');
        els.seoPreviewUrl = document.getElementById('seo-preview-url');
        els.seoPreviewDescription = document.getElementById('seo-preview-description');
        els.seoPreviewRobots = document.getElementById('seo-preview-robots');
        els.seoSitemapUrl = document.getElementById('seo-sitemap-url');
        els.usersContent = document.getElementById('admin-users-pane');
        els.usersRefreshBtn = document.getElementById('users-refresh-btn');
        els.usersMessage = document.getElementById('admin-users-message');
        els.usersTableBody = document.getElementById('users-table-body');
        els.tabsContent = document.getElementById('admin-tabs-pane');
        els.tabsOrderList = document.getElementById('tabs-order-list');
        els.tabsMessage = document.getElementById('tabs-message');
        els.tabsSaveBtn = document.getElementById('tabs-save-btn');
        els.categoriesContent = document.getElementById('admin-categories-pane');
        els.categoriesList = document.getElementById('categories-order-list');
        els.categoriesMessage = document.getElementById('categories-message');
        els.categoryNewInput = document.getElementById('category-new-input');
        els.categoryAddBtn = document.getElementById('category-add-btn');
        els.categoriesSaveBtn = document.getElementById('categories-save-btn');
        els.categoriesResetBtn = document.getElementById('categories-reset-btn');
        els.massContent = document.getElementById('admin-mass-pane');
        els.massMessage = document.getElementById('mass-message');
        els.massSearchInput = document.getElementById('mass-search-input');
        els.massSearchBtn = document.getElementById('mass-search-btn');
        els.massResultsList = document.getElementById('mass-search-results');
        els.massResultsCount = document.getElementById('mass-results-count');
        els.massSelectedCount = document.getElementById('mass-selected-count');
        els.massSelectAllBtn = document.getElementById('mass-select-all-btn');
        els.massClearBtn = document.getElementById('mass-clear-btn');
        els.massMap = document.getElementById('mass-results-map');
        els.massForm = document.getElementById('mass-form');
        els.massTitleInput = document.getElementById('mass-title');
        els.massDescriptionInput = document.getElementById('mass-description');
        els.massCategorySelect = document.getElementById('mass-category');
        els.massLinkInput = document.getElementById('mass-link');
        els.massLifetimeSelect = document.getElementById('mass-lifetime');
        els.massStartInput = document.getElementById('mass-start');
        els.massEndInput = document.getElementById('mass-end');
        els.massImages = document.getElementById('mass-images');
        els.massImageInput = document.getElementById('mass-image-input');
        els.massPhotoRemaining = document.getElementById('mass-photo-remaining');
        els.massCreateBtn = document.getElementById('mass-create-btn');
        els.massStatus = document.getElementById('mass-status');
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

    function showUsersMessage(type, text) {
        if (!els.usersMessage) {
            return;
        }
        els.usersMessage.textContent = text || '';
        els.usersMessage.classList.remove('is-success', 'is-error', 'is-visible');
        if (!text) {
            return;
        }
        els.usersMessage.classList.add('is-visible');
        if (type === 'success') {
            els.usersMessage.classList.add('is-success');
        } else if (type === 'error') {
            els.usersMessage.classList.add('is-error');
        }
    }

    function showTabsMessage(type, text) {
        if (!els.tabsMessage) {
            return;
        }
        els.tabsMessage.textContent = text || '';
        els.tabsMessage.classList.remove('is-success', 'is-error', 'is-visible');
        if (!text) {
            return;
        }
        els.tabsMessage.classList.add('is-visible');
        if (type === 'success') {
            els.tabsMessage.classList.add('is-success');
        } else if (type === 'error') {
            els.tabsMessage.classList.add('is-error');
        }
    }

    function showCategoriesMessage(type, text) {
        if (!els.categoriesMessage) {
            return;
        }
        els.categoriesMessage.textContent = text || '';
        els.categoriesMessage.classList.remove('is-success', 'is-error', 'is-visible');
        if (!text) {
            return;
        }
        els.categoriesMessage.classList.add('is-visible');
        if (type === 'success') {
            els.categoriesMessage.classList.add('is-success');
        } else if (type === 'error') {
            els.categoriesMessage.classList.add('is-error');
        }
    }

    function getTabVisibilityStorageKey() {
        return 'adminTabVisibility.v1';
    }

    function getTabButtons() {
        const container = document.querySelector('.admin-tabs');
        if (!container) {
            return [];
        }
        return Array.from(container.querySelectorAll('.admin-tab'));
    }

    function getCurrentTabIds() {
        return getTabButtons()
            .map((btn) => btn.dataset.tab)
            .filter(Boolean);
    }

    function getDefaultTabVisibility() {
        const visibility = {};
        getTabButtons().forEach((btn) => {
            const tabId = btn.dataset.tab;
            if (!tabId) {
                return;
            }
            const adminOnly = btn.dataset.adminOnly === 'true';
            const base = {
                admin: true,
                pin_manager: !adminOnly && (tabId === 'pins' || tabId === 'mass'),
                resident: false
            };
            if (adminOnly) {
                base.pin_manager = false;
                base.resident = false;
            }
            visibility[tabId] = base;
        });
        return visibility;
    }

    function loadTabVisibility() {
        if (state.tabs.visibilityRemote !== null) {
            return state.tabs.visibilityRemote || {};
        }
        try {
            const raw = window.localStorage?.getItem(getTabVisibilityStorageKey());
            const parsed = JSON.parse(raw || '{}');
            if (!parsed || typeof parsed !== 'object') {
                return {};
            }
            return parsed;
        } catch (error) {
            return {};
        }
    }

    function saveTabVisibility(visibility) {
        try {
            window.localStorage?.setItem(getTabVisibilityStorageKey(), JSON.stringify(visibility));
        } catch (error) {
            // ignore storage failures
        }
    }

    function getTabVisibilityConfig() {
        const defaults = getDefaultTabVisibility();
        const stored = loadTabVisibility();
        const merged = { ...defaults };
        Object.keys(stored).forEach((tabId) => {
            if (!merged[tabId]) {
                merged[tabId] = { admin: true, pin_manager: false, resident: false };
            }
            const entry = stored[tabId] || {};
            ['admin', 'pin_manager', 'resident'].forEach((role) => {
                if (typeof entry[role] === 'boolean') {
                    merged[tabId][role] = entry[role];
                }
            });
        });
        return merged;
    }

    function getTabVisibilityDraft() {
        if (!state.tabs.visibilityDraft) {
            state.tabs.visibilityDraft = getTabVisibilityConfig();
        }
        return state.tabs.visibilityDraft;
    }

    function updateTabsSaveState() {
        if (els.tabsSaveBtn) {
            els.tabsSaveBtn.disabled = !state.tabs.dirty;
        }
    }

    function setTabsSaving(isSaving) {
        state.tabs.isSaving = isSaving;
        if (!els.tabsSaveBtn) {
            return;
        }
        els.tabsSaveBtn.disabled = isSaving || !state.tabs.dirty;
        els.tabsSaveBtn.textContent = isSaving ? 'Saving...' : 'Save Changes';
    }

    function resetTabVisibilityDraft() {
        state.tabs.visibilityDraft = getTabVisibilityConfig();
        state.tabs.dirty = false;
        showTabsMessage(null, '');
        updateTabsSaveState();
    }

    function hasAnyTabForRole(draft, roleKey) {
        return getTabButtons().some((btn) => {
            const tabId = btn.dataset.tab;
            if (!tabId) {
                return false;
            }
            const adminOnly = btn.dataset.adminOnly === 'true';
            if (adminOnly && roleKey !== 'admin') {
                return false;
            }
            return Boolean(draft?.[tabId]?.[roleKey]);
        });
    }

    function updateTabVisibilityDraft(tabId, roleKey, allowed) {
        const draft = getTabVisibilityDraft();
        if (!draft[tabId]) {
            draft[tabId] = { admin: true, pin_manager: false, resident: false };
        }
        draft[tabId][roleKey] = Boolean(allowed);
        if (!hasAnyTabForRole(draft, roleKey)) {
            showTabsMessage('error', 'Setidaknya satu tab harus aktif untuk peran ini.');
            return false;
        }
        state.tabs.visibilityDraft = draft;
        state.tabs.dirty = true;
        updateTabsSaveState();
        showTabsMessage(null, '');
        return true;
    }

    async function saveTabVisibilityDraft() {
        if (!state.tabs.visibilityDraft || state.tabs.isSaving) {
            return;
        }
        const payload = { visibility: state.tabs.visibilityDraft };
        const headers = {
            'Content-Type': 'application/json'
        };
        const token = getToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        setTabsSaving(true);
        showTabsMessage(null, '');
        try {
            const response = await fetch('/api/tabs-visibility', {
                method: 'PUT',
                headers,
                body: JSON.stringify(payload)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data?.message || 'Tidak dapat menyimpan pengaturan tab.');
            }
            const visibility = data?.visibility ?? data ?? {};
            state.tabs.visibilityRemote = visibility;
            state.tabs.visibilityDraft = visibility;
            state.tabs.dirty = false;
            updateTabsSaveState();
            applyTabVisibility();
            renderTabOrderList();
            showTabsMessage('success', 'Pengaturan tab disimpan.');
        } catch (error) {
            console.error('Gagal menyimpan pengaturan tab', error);
            showTabsMessage('error', error.message || 'Tidak dapat menyimpan pengaturan tab.');
        } finally {
            setTabsSaving(false);
        }
    }

    async function fetchTabVisibilityRemote() {
        try {
            const headers = {};
            const token = getToken();
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }
            const response = await fetch('/api/tabs-visibility', {
                cache: 'no-store',
                headers
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data?.message || 'Gagal memuat pengaturan tab.');
            }
            state.tabs.visibilityRemote = data?.visibility ?? data ?? {};
        } catch (error) {
            console.warn('Gagal memuat pengaturan tab', error);
            state.tabs.visibilityRemote = null;
        }
        resetTabVisibilityDraft();
        applyTabVisibility();
        renderTabOrderList();
    }

    function getRoleKey() {
        return state.permissions?.role || 'resident';
    }

    function getAllowedTabsForRole(roleKey = getRoleKey()) {
        const visibility = getTabVisibilityConfig();
        return getTabButtons()
            .filter((btn) => {
                const tabId = btn.dataset.tab;
                if (!tabId) {
                    return false;
                }
                const adminOnly = btn.dataset.adminOnly === 'true';
                if (adminOnly && roleKey !== 'admin') {
                    return false;
                }
                return Boolean(visibility[tabId]?.[roleKey]);
            })
            .map((btn) => btn.dataset.tab);
    }

    function applyTabVisibility() {
        const visibility = getTabVisibilityConfig();
        const roleKey = getRoleKey();
        const buttons = getTabButtons();
        buttons.forEach((btn) => {
            const tabId = btn.dataset.tab;
            const adminOnly = btn.dataset.adminOnly === 'true';
            let allowed = Boolean(visibility[tabId]?.[roleKey]);
            if (adminOnly && roleKey !== 'admin') {
                allowed = false;
            }
            btn.hidden = !allowed;
            btn.setAttribute('aria-hidden', allowed ? 'false' : 'true');
        });
        const allowedTabs = getAllowedTabsForRole(roleKey);
        const currentActive = buttons.find((btn) => btn.classList.contains('admin-tab--active'))?.dataset.tab;
        if (!allowedTabs.includes(currentActive)) {
            setActiveTab(allowedTabs[0] || 'pins');
        }
    }

    function getTabOrderStorageKey() {
        return 'adminTabOrder.v1';
    }

    function loadTabOrder() {
        try {
            const raw = window.localStorage?.getItem(getTabOrderStorageKey());
            const parsed = JSON.parse(raw || '[]');
            return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
        } catch (error) {
            return [];
        }
    }

    function saveTabOrder(order) {
        try {
            window.localStorage?.setItem(getTabOrderStorageKey(), JSON.stringify(order));
        } catch (error) {
            // ignore storage failures
        }
    }

    function applyTabOrder(order) {
        const container = document.querySelector('.admin-tabs');
        if (!container) {
            return;
        }
        const buttons = getTabButtons();
        const buttonMap = new Map(buttons.map((btn) => [btn.dataset.tab, btn]));
        const nextOrder = [];
        order.forEach((tabId) => {
            const btn = buttonMap.get(tabId);
            if (btn) {
                nextOrder.push(btn);
                buttonMap.delete(tabId);
            }
        });
        buttons.forEach((btn) => {
            if (buttonMap.has(btn.dataset.tab)) {
                nextOrder.push(btn);
                buttonMap.delete(btn.dataset.tab);
            }
        });
        nextOrder.forEach((btn) => container.appendChild(btn));
        applyTabVisibility();
    }

    function moveTabOrder(tabId, direction) {
        const order = getCurrentTabIds();
        const index = order.indexOf(tabId);
        if (index === -1) {
            return;
        }
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= order.length) {
            return;
        }
        const nextOrder = order.slice();
        const temp = nextOrder[index];
        nextOrder[index] = nextOrder[nextIndex];
        nextOrder[nextIndex] = temp;
        applyTabOrder(nextOrder);
        saveTabOrder(nextOrder);
        renderTabOrderList();
    }

    function renderTabOrderList() {
        if (!els.tabsOrderList) {
            return;
        }
        const buttons = getTabButtons();
        const visibility = getTabVisibilityDraft();
        els.tabsOrderList.innerHTML = '';
        if (!buttons.length) {
            const empty = document.createElement('div');
            empty.className = 'pin-list-empty';
            empty.textContent = 'Tidak ada tab untuk diatur.';
            els.tabsOrderList.appendChild(empty);
            return;
        }
        buttons.forEach((btn, index) => {
            const item = document.createElement('li');
            item.className = 'tabs-order-item';
            const main = document.createElement('div');
            main.className = 'tabs-order-main';
            const title = document.createElement('div');
            title.className = 'tabs-order-title';
            title.textContent = btn.textContent.trim() || btn.dataset.tab || 'Tab';
            if (btn.dataset.adminOnly === 'true') {
                const tag = document.createElement('span');
                tag.className = 'tabs-order-tag';
                tag.textContent = 'Admin only';
                title.appendChild(tag);
            }
            const toggles = document.createElement('div');
            toggles.className = 'tabs-role-toggles';
            [
                { key: 'admin', label: 'Admin' },
                { key: 'pin_manager', label: 'Pin Manager' },
                { key: 'resident', label: 'Warga' }
            ].forEach((role) => {
                const label = document.createElement('label');
                label.className = 'tabs-role-option';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = Boolean(visibility[btn.dataset.tab]?.[role.key]);
                const adminOnly = btn.dataset.adminOnly === 'true';
                if (adminOnly && role.key !== 'admin') {
                    input.disabled = true;
                    input.checked = false;
                }
                input.addEventListener('change', () => {
                    const nextValue = input.checked;
                    const ok = updateTabVisibilityDraft(btn.dataset.tab, role.key, nextValue);
                    if (!ok) {
                        input.checked = !nextValue;
                    }
                });
                const span = document.createElement('span');
                span.textContent = role.label;
                label.appendChild(input);
                label.appendChild(span);
                toggles.appendChild(label);
            });
            const actions = document.createElement('div');
            actions.className = 'tabs-order-actions';
            const upBtn = document.createElement('button');
            upBtn.type = 'button';
            upBtn.textContent = 'Up';
            upBtn.disabled = index === 0;
            upBtn.addEventListener('click', () => moveTabOrder(btn.dataset.tab, -1));
            const downBtn = document.createElement('button');
            downBtn.type = 'button';
            downBtn.textContent = 'Down';
            downBtn.disabled = index === buttons.length - 1;
            downBtn.addEventListener('click', () => moveTabOrder(btn.dataset.tab, 1));
            actions.appendChild(upBtn);
            actions.appendChild(downBtn);
            main.appendChild(title);
            main.appendChild(toggles);
            item.appendChild(main);
            item.appendChild(actions);
            els.tabsOrderList.appendChild(item);
        });
    }

    function normalizeCategoryName(value) {
        if (typeof value !== 'string') {
            return '';
        }
        return value.trim();
    }

    function normalizeCategoryKey(value) {
        return normalizeText(value);
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

    function hasAnyCategoryRole(roles = {}) {
        return Boolean(roles.admin || roles.pin_manager || roles.resident);
    }

    function extractCategoryEmoji(value) {
        if (typeof value !== 'string') {
            return '';
        }
        const match = value.match(/\p{Extended_Pictographic}/u);
        return match && match[0] ? match[0] : '';
    }

    const CATEGORY_SYNC_CHANNEL = 'ayanaon-categories';
    const CATEGORY_SYNC_STORAGE_KEY = 'ayanaon:categories:updated';
    const categoryBroadcast = typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(CATEGORY_SYNC_CHANNEL)
        : null;

    function broadcastCategoryUpdate() {
        const payload = { type: 'categories-updated', ts: Date.now() };
        try {
            if (categoryBroadcast) {
                categoryBroadcast.postMessage(payload);
            }
        } catch (error) {
            // ignore
        }
        try {
            window.localStorage?.setItem(CATEGORY_SYNC_STORAGE_KEY, String(payload.ts));
        } catch (error) {
            // ignore
        }
    }

    function createCategoryId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        return `cat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }

    function normalizeCategoryList(rawList = []) {
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
                    return { id: createCategoryId(), name, roles: normalizeCategoryRoles() };
                }
                const name = normalizeCategoryName(entry.name || entry.label || '');
                if (!name) {
                    return null;
                }
                const id = normalizeCategoryName(entry.id || '');
                return { id: id || createCategoryId(), name, roles: normalizeCategoryRoles(entry.roles || {}) };
            })
            .filter(Boolean);
    }

    function setCategoryDraft(list) {
        state.categories.list = (list || []).map((item) => ({
            id: item.id,
            name: item.name,
            roles: normalizeCategoryRoles(item.roles || {})
        }));
        state.categories.draft = (list || []).map((item) => ({
            id: item.id,
            name: item.name,
            originalName: item.name,
            lastValidName: item.name,
            roles: normalizeCategoryRoles(item.roles || {})
        }));
        state.categories.dirty = false;
        state.categories.loaded = true;
        showCategoriesMessage(null, '');
        updateCategoriesSaveState();
        renderCategoryManager();
    }

    function getCategoryDraft() {
        if (!Array.isArray(state.categories.draft)) {
            state.categories.draft = [];
        }
        return state.categories.draft;
    }

    function updateCategoriesSaveState() {
        const isDirty = Boolean(state.categories.dirty);
        if (els.categoriesSaveBtn) {
            els.categoriesSaveBtn.disabled = state.categories.isSaving || !isDirty;
        }
        if (els.categoriesResetBtn) {
            els.categoriesResetBtn.disabled = state.categories.isSaving || !isDirty;
        }
    }

    function setCategoriesSaving(isSaving) {
        state.categories.isSaving = isSaving;
        if (els.categoriesSaveBtn) {
            els.categoriesSaveBtn.disabled = isSaving || !state.categories.dirty;
            els.categoriesSaveBtn.textContent = isSaving ? 'Saving...' : 'Save Changes';
        }
        if (els.categoriesResetBtn) {
            els.categoriesResetBtn.disabled = isSaving || !state.categories.dirty;
        }
    }

    function markCategoriesDirty() {
        if (!state.categories.dirty) {
            state.categories.dirty = true;
        }
        updateCategoriesSaveState();
    }

    function resetCategoriesDraft() {
        state.categories.draft = (state.categories.list || []).map((item) => ({
            id: item.id,
            name: item.name,
            originalName: item.name,
            lastValidName: item.name,
            roles: normalizeCategoryRoles(item.roles || {})
        }));
        state.categories.dirty = false;
        showCategoriesMessage(null, '');
        updateCategoriesSaveState();
        renderCategoryManager();
    }

    function buildCategoryCounts() {
        const counts = new Map();
        state.pins.forEach((pin) => {
            const key = normalizeCategoryKey(pin?.category);
            if (!key) {
                return;
            }
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        return counts;
    }

    function moveCategoryOrder(categoryId, direction) {
        const list = getCategoryDraft();
        const index = list.findIndex((item) => item.id === categoryId);
        if (index === -1) {
            return;
        }
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= list.length) {
            return;
        }
        const nextOrder = list.slice();
        const temp = nextOrder[index];
        nextOrder[index] = nextOrder[nextIndex];
        nextOrder[nextIndex] = temp;
        state.categories.draft = nextOrder;
        markCategoriesDirty();
        renderCategoryManager();
    }

    function removeCategoryById(categoryId) {
        const list = getCategoryDraft();
        const index = list.findIndex((item) => item.id === categoryId);
        if (index === -1) {
            return;
        }
        const name = list[index]?.name || 'kategori ini';
        const counts = buildCategoryCounts();
        const pinCount = counts.get(normalizeCategoryKey(name)) || 0;
        if (pinCount > 0) {
            const confirmed = window.confirm(`Kategori "${name}" dipakai oleh ${pinCount} pin. Hapus dari daftar saja?`);
            if (!confirmed) {
                return;
            }
        }
        list.splice(index, 1);
        state.categories.draft = list;
        markCategoriesDirty();
        renderCategoryManager();
    }

    function updateCategoryRole(categoryId, roleKey, allowed) {
        const list = getCategoryDraft();
        const target = list.find((item) => item.id === categoryId);
        if (!target) {
            return false;
        }
        const nextRoles = {
            ...normalizeCategoryRoles(target.roles || {}),
            [roleKey]: Boolean(allowed)
        };
        if (!hasAnyCategoryRole(nextRoles)) {
            showCategoriesMessage('error', 'Setidaknya satu role harus aktif.');
            return false;
        }
        target.roles = nextRoles;
        markCategoriesDirty();
        showCategoriesMessage(null, '');
        return true;
    }

    function handleAddCategory() {
        if (!els.categoryNewInput) {
            return;
        }
        const name = normalizeCategoryName(els.categoryNewInput.value || '');
        if (!name) {
            showCategoriesMessage('error', 'Nama kategori wajib diisi.');
            return;
        }
        const key = normalizeCategoryKey(name);
        const list = getCategoryDraft();
        const hasDuplicate = list.some((item) => normalizeCategoryKey(item.name) === key);
        if (hasDuplicate) {
            showCategoriesMessage('error', 'Kategori sudah ada.');
            return;
        }
        list.push({
            id: createCategoryId(),
            name,
            originalName: '',
            lastValidName: name,
            roles: normalizeCategoryRoles()
        });
        state.categories.draft = list;
        markCategoriesDirty();
        renderCategoryManager();
        els.categoryNewInput.value = '';
        els.categoryNewInput.focus();
        showCategoriesMessage(null, '');
    }

    function prepareCategoriesForSave() {
        const list = getCategoryDraft();
        const cleaned = [];
        const seen = new Set();
        for (const item of list) {
            const name = normalizeCategoryName(item?.name || '');
            if (!name) {
                return { ok: false, message: 'Nama kategori tidak boleh kosong.' };
            }
            const roles = normalizeCategoryRoles(item?.roles || {});
            if (!hasAnyCategoryRole(roles)) {
                return { ok: false, message: `Kategori "${name}" harus punya minimal satu role.` };
            }
            const key = normalizeCategoryKey(name);
            if (seen.has(key)) {
                return { ok: false, message: `Kategori "${name}" sudah ada.` };
            }
            seen.add(key);
            cleaned.push({
                id: item?.id || createCategoryId(),
                name,
                roles,
                originalName: normalizeCategoryName(item?.originalName || '')
            });
        }
        return { ok: true, categories: cleaned };
    }

    function renderCategoryManager() {
        if (!els.categoriesList) {
            return;
        }
        const list = getCategoryDraft();
        els.categoriesList.innerHTML = '';
        if (!list.length) {
            const empty = document.createElement('div');
            empty.className = 'pin-list-empty';
            empty.textContent = 'Belum ada kategori.';
            els.categoriesList.appendChild(empty);
            return;
        }
        const counts = buildCategoryCounts();
        list.forEach((category, index) => {
            const item = document.createElement('li');
            item.className = 'category-item';
            const main = document.createElement('div');
            main.className = 'category-main';
            const inputRow = document.createElement('div');
            inputRow.className = 'category-input-row';
            const emojiBadge = document.createElement('div');
            emojiBadge.className = 'category-emoji';
            emojiBadge.textContent = extractCategoryEmoji(category.name) || '💡';
            const input = document.createElement('input');
            input.type = 'text';
            input.value = category.name || '';
            input.placeholder = 'Nama kategori';
            input.setAttribute('aria-label', 'Nama kategori');
            input.addEventListener('input', () => {
                category.name = input.value;
                emojiBadge.textContent = extractCategoryEmoji(category.name) || '💡';
                markCategoriesDirty();
            });
            input.addEventListener('blur', () => {
                const trimmed = normalizeCategoryName(category.name || '');
                const fallbackName = category.lastValidName || category.originalName || '';
                if (!trimmed) {
                    category.name = fallbackName;
                    input.value = fallbackName;
                    emojiBadge.textContent = extractCategoryEmoji(category.name) || '💡';
                    showCategoriesMessage('error', 'Nama kategori tidak boleh kosong.');
                    return;
                }
                const key = normalizeCategoryKey(trimmed);
                const duplicate = list.some((entry) =>
                    entry.id !== category.id && normalizeCategoryKey(entry.name) === key
                );
                if (duplicate) {
                    category.name = fallbackName || trimmed;
                    input.value = category.name;
                    emojiBadge.textContent = extractCategoryEmoji(category.name) || '💡';
                    showCategoriesMessage('error', 'Kategori sudah ada.');
                    return;
                }
                category.name = trimmed;
                category.lastValidName = trimmed;
                input.value = trimmed;
                emojiBadge.textContent = extractCategoryEmoji(category.name) || '💡';
            });
            inputRow.appendChild(emojiBadge);
            inputRow.appendChild(input);
            main.appendChild(inputRow);
            const toggles = document.createElement('div');
            toggles.className = 'category-role-toggles';
            const roleOptions = [
                { key: 'admin', label: 'Admin' },
                { key: 'pin_manager', label: 'Pin Manager' },
                { key: 'resident', label: 'Warga' }
            ];
            const currentRoles = normalizeCategoryRoles(category.roles || {});
            roleOptions.forEach((role) => {
                const label = document.createElement('label');
                label.className = 'category-role-option';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = Boolean(currentRoles[role.key]);
                input.addEventListener('change', () => {
                    const ok = updateCategoryRole(category.id, role.key, input.checked);
                    if (!ok) {
                        input.checked = !input.checked;
                        return;
                    }
                    category.roles = {
                        ...normalizeCategoryRoles(category.roles || {}),
                        [role.key]: input.checked
                    };
                });
                const text = document.createElement('span');
                text.textContent = role.label;
                label.appendChild(input);
                label.appendChild(text);
                toggles.appendChild(label);
            });
            main.appendChild(toggles);
            const count = counts.get(normalizeCategoryKey(category.name)) || 0;
            const meta = document.createElement('div');
            meta.className = 'category-meta';
            meta.textContent = count ? `${count} pin` : 'Belum ada pin';
            main.appendChild(meta);
            const actions = document.createElement('div');
            actions.className = 'category-actions';
            const upBtn = document.createElement('button');
            upBtn.type = 'button';
            upBtn.textContent = 'Up';
            upBtn.disabled = index === 0;
            upBtn.addEventListener('click', () => moveCategoryOrder(category.id, -1));
            const downBtn = document.createElement('button');
            downBtn.type = 'button';
            downBtn.textContent = 'Down';
            downBtn.disabled = index === list.length - 1;
            downBtn.addEventListener('click', () => moveCategoryOrder(category.id, 1));
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.textContent = 'Remove';
            removeBtn.addEventListener('click', () => removeCategoryById(category.id));
            actions.appendChild(upBtn);
            actions.appendChild(downBtn);
            actions.appendChild(removeBtn);
            item.appendChild(main);
            item.appendChild(actions);
            els.categoriesList.appendChild(item);
        });
    }

    async function loadCategories() {
        try {
            const response = await fetch('/api/categories', { cache: 'no-store' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data?.message || 'Gagal memuat kategori.');
            }
            const list = normalizeCategoryList(data?.categories ?? data ?? []);
            setCategoryDraft(list);
            populateCategoryFilter();
            populateCategorySelect();
            populateMassCategorySelect();
        } catch (error) {
            console.warn('Gagal memuat kategori', error);
            showCategoriesMessage('error', error.message || 'Tidak dapat memuat kategori.');
        }
    }

    async function saveCategoriesDraft() {
        if (!state.categories.dirty || state.categories.isSaving) {
            return;
        }
        const prepared = prepareCategoriesForSave();
        if (!prepared.ok) {
            showCategoriesMessage('error', prepared.message || 'Data kategori tidak valid.');
            return;
        }
        const headers = {
            'Content-Type': 'application/json'
        };
        const token = getToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        setCategoriesSaving(true);
        showCategoriesMessage(null, '');
        try {
            const response = await fetch('/api/categories', {
                method: 'PUT',
                headers,
                body: JSON.stringify({ categories: prepared.categories })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data?.message || 'Gagal menyimpan kategori.');
            }
            const list = normalizeCategoryList(data?.categories ?? data ?? []);
            setCategoryDraft(list);
            showCategoriesMessage('success', 'Kategori berhasil disimpan.');
            broadcastCategoryUpdate();
            await loadPins();
        } catch (error) {
            console.error('Gagal menyimpan kategori', error);
            showCategoriesMessage('error', error.message || 'Tidak dapat menyimpan kategori.');
        } finally {
            setCategoriesSaving(false);
        }
    }

    function showMassMessage(type, text) {
        if (!els.massMessage) {
            return;
        }
        els.massMessage.textContent = text || '';
        els.massMessage.classList.remove('is-success', 'is-error', 'is-visible');
        if (!text) {
            return;
        }
        els.massMessage.classList.add('is-visible');
        if (type === 'success') {
            els.massMessage.classList.add('is-success');
        } else if (type === 'error') {
            els.massMessage.classList.add('is-error');
        }
    }

    function resolveResidentRole(resident) {
        const username = typeof resident?.username === 'string' ? resident.username.toLowerCase().trim() : '';
        const role = typeof resident?.role === 'string' ? resident.role.toLowerCase().trim() : '';
        if (resident?.isAdmin || role === 'admin' || username === 'admin') {
            return 'admin';
        }
        if (resident?.isPinManager || role === 'pin_manager') {
            return 'pin_manager';
        }
        return 'resident';
    }

    function getRoleLabel(role) {
        if (role === 'admin') {
            return 'Admin';
        }
        if (role === 'pin_manager') {
            return 'Pin Manager';
        }
        return 'Warga';
    }

    function formatLastLogin(value) {
        if (!value) {
            return '-';
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return '-';
        }
        return new Intl.DateTimeFormat('id-ID', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }

    function applyAdminPermissions() {
        const isAdmin = Boolean(state.permissions?.isAdmin);
        const adminOnlyElements = Array.from(document.querySelectorAll('[data-admin-only="true"]'));
        adminOnlyElements.forEach((element) => {
            element.hidden = !isAdmin;
            element.setAttribute('aria-hidden', isAdmin ? 'false' : 'true');
        });
        if (!isAdmin) {
            if (els.metricsContent) {
                els.metricsContent.classList.add('hidden');
            }
            if (els.featuresContent) {
                els.featuresContent.classList.add('hidden');
            }
            if (els.seoContent) {
                els.seoContent.classList.add('hidden');
            }
            if (els.usersContent) {
                els.usersContent.classList.add('hidden');
            }
            if (els.tabsContent) {
                els.tabsContent.classList.add('hidden');
            }
            if (els.categoriesContent) {
                els.categoriesContent.classList.add('hidden');
            }
        }
        applyTabVisibility();
    }

    function renderMaintenanceStatus(status = state.maintenance) {
        const enabled = Boolean(status?.enabled);
        if (els.maintenanceToggle) {
            els.maintenanceToggle.checked = enabled;
        }
        if (els.maintenanceMessage && typeof status?.message === 'string') {
            els.maintenanceMessage.value = status.message;
        }
        if (els.maintenanceStatusLabel) {
            els.maintenanceStatusLabel.textContent = enabled ? 'Maintenance ON' : 'Normal';
            els.maintenanceStatusLabel.classList.toggle('is-active', enabled);
        }
        if (els.maintenanceMeta) {
            els.maintenanceMeta.textContent = enabled
                ? 'Visitors see the maintenance announcement.'
                : 'Visitors see the site as usual.';
        }
    }

    function syncMaintenancePreviewFromInputs() {
        renderMaintenanceStatus({
            enabled: Boolean(els.maintenanceToggle?.checked),
            message: els.maintenanceMessage?.value || ''
        });
    }

    function setMaintenanceSaving(isSaving) {
        if (!els.maintenanceSaveBtn) return;
        els.maintenanceSaveBtn.disabled = isSaving;
        els.maintenanceSaveBtn.textContent = isSaving ? 'Menyimpan...' : 'Simpan';
    }

    async function loadMaintenanceStatus() {
        try {
            const response = await fetch('/api/maintenance', { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            state.maintenance = {
                enabled: Boolean(payload?.enabled),
                message: typeof payload?.message === 'string' ? payload.message : ''
            };
            renderMaintenanceStatus();
        } catch (error) {
            console.warn('Gagal memuat status maintenance', error);
            showMessage('error', 'Tidak dapat memuat status maintenance.');
        }
    }

    async function saveMaintenanceStatus() {
        const enabled = Boolean(els.maintenanceToggle?.checked);
        const message = (els.maintenanceMessage?.value || '').trim();
        const headers = {
            'Content-Type': 'application/json'
        };
        const token = getToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        setMaintenanceSaving(true);
        try {
            const response = await fetch('/api/maintenance', {
                method: 'PUT',
                headers,
                body: JSON.stringify({ enabled, message })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload?.message || 'Gagal memperbarui maintenance.');
            }
            state.maintenance = {
                enabled: Boolean(payload?.enabled),
                message: typeof payload?.message === 'string' ? payload.message : message
            };
            renderMaintenanceStatus();
            showMessage('success', enabled ? 'Mode maintenance diaktifkan.' : 'Mode maintenance dimatikan.');
        } catch (error) {
            console.error('Gagal memperbarui maintenance', error);
            showMessage('error', error.message || 'Tidak dapat menyimpan status maintenance.');
        } finally {
            setMaintenanceSaving(false);
        }
    }

    function normalizeFeatureFlags(flags = {}) {
        const raw = flags?.gerobakOnline;
        const disabled = raw === false || raw === 'false' || raw === 0 || raw === '0';
        return {
            gerobakOnline: !disabled
        };
    }

    function renderFeatureFlags(flags = state.features) {
        const normalized = normalizeFeatureFlags(flags);
        state.features = normalized;
        if (els.featureGerobakToggle) {
            els.featureGerobakToggle.checked = normalized.gerobakOnline;
        }
    }

    function showFeatureMessage(type, text) {
        if (!els.featureMessage) {
            return;
        }
        els.featureMessage.textContent = text || '';
        els.featureMessage.classList.remove('is-success', 'is-error', 'is-visible');
        if (!text) {
            return;
        }
        els.featureMessage.classList.add('is-visible');
        if (type === 'success') {
            els.featureMessage.classList.add('is-success');
        } else if (type === 'error') {
            els.featureMessage.classList.add('is-error');
        }
    }

    function setFeatureSaving(isSaving) {
        if (els.featureSaveBtn) {
            els.featureSaveBtn.disabled = isSaving;
            els.featureSaveBtn.textContent = isSaving ? 'Saving...' : 'Save';
        }
        if (els.featureGerobakToggle) {
            els.featureGerobakToggle.disabled = isSaving;
        }
    }

    async function loadFeatureFlags() {
        try {
            const response = await fetch('/api/features', { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload?.message || 'Tidak dapat memuat fitur.');
            }
            renderFeatureFlags(payload);
        } catch (error) {
            console.warn('Gagal memuat fitur', error);
            showFeatureMessage('error', error.message || 'Tidak dapat memuat fitur.');
        }
    }

    async function saveFeatureFlags() {
        const payload = {
            gerobakOnline: Boolean(els.featureGerobakToggle?.checked)
        };
        const headers = {
            'Content-Type': 'application/json'
        };
        const token = getToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        setFeatureSaving(true);
        showFeatureMessage(null, '');
        try {
            const response = await fetch('/api/features', {
                method: 'PUT',
                headers,
                body: JSON.stringify(payload)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data?.message || 'Tidak dapat menyimpan fitur.');
            }
            renderFeatureFlags(data);
            showFeatureMessage('success', 'Pengaturan fitur berhasil disimpan.');
        } catch (error) {
            console.error('Gagal menyimpan fitur', error);
            showFeatureMessage('error', error.message || 'Tidak dapat menyimpan fitur.');
        } finally {
            setFeatureSaving(false);
        }
    }

    const DEFAULT_SEO_PREVIEW = {
        title: 'AyaNaon | Cari Kegiatan Seru Di Sekitarmu!',
        description: 'Satu peta untuk cari ribuan acara olahraga, konser, edukasi, promo makanan sampai restoran legendaris ada disini, cuma dengan 1x klik!'
    };

    function normalizeSeoSettings(raw = {}) {
        const stringValue = (value) => (typeof value === 'string' ? value.trim() : '');
        return {
            title: stringValue(raw.title),
            description: stringValue(raw.description),
            keywords: stringValue(raw.keywords),
            siteUrl: stringValue(raw.siteUrl),
            ogTitle: stringValue(raw.ogTitle),
            ogDescription: stringValue(raw.ogDescription),
            ogImage: stringValue(raw.ogImage),
            twitterTitle: stringValue(raw.twitterTitle),
            twitterDescription: stringValue(raw.twitterDescription),
            twitterImage: stringValue(raw.twitterImage),
            robotsIndex: typeof raw.robotsIndex === 'boolean' ? raw.robotsIndex : true,
            robotsFollow: typeof raw.robotsFollow === 'boolean' ? raw.robotsFollow : true,
            googleSiteVerification: stringValue(raw.googleSiteVerification)
        };
    }

    function showSeoMessage(type, text) {
        if (!els.seoMessage) {
            return;
        }
        els.seoMessage.textContent = text || '';
        els.seoMessage.classList.remove('is-success', 'is-error', 'is-visible');
        if (!text) {
            return;
        }
        els.seoMessage.classList.add('is-visible');
        if (type === 'success') {
            els.seoMessage.classList.add('is-success');
        } else if (type === 'error') {
            els.seoMessage.classList.add('is-error');
        }
    }

    function setSeoSaving(isSaving) {
        if (els.seoSaveBtn) {
            els.seoSaveBtn.disabled = isSaving;
            els.seoSaveBtn.textContent = isSaving ? 'Saving...' : 'Save SEO';
        }
    }

    function getSeoInputValue(input) {
        return input ? input.value.trim() : '';
    }

    function normalizeSeoUrl(value) {
        if (!value) {
            return '';
        }
        let normalized = value.trim().replace(/\/$/, '');
        if (!normalized) {
            return '';
        }
        if (!/^https?:\/\//i.test(normalized)) {
            normalized = normalized.replace(/^\/+/, '');
            normalized = `https://${normalized}`;
        }
        return normalized;
    }

    function getSeoPreviewBaseUrl() {
        const inputValue = getSeoInputValue(els.seoSiteUrlInput);
        const base = inputValue || window.location.origin;
        return normalizeSeoUrl(base);
    }

    function updateSeoPreview() {
        const title = getSeoInputValue(els.seoTitleInput) || DEFAULT_SEO_PREVIEW.title;
        const description = getSeoInputValue(els.seoDescriptionInput) || DEFAULT_SEO_PREVIEW.description;
        const baseUrl = getSeoPreviewBaseUrl();
        const robotsIndex = Boolean(els.seoRobotsIndexToggle?.checked);
        const robotsFollow = Boolean(els.seoRobotsFollowToggle?.checked);
        const robotsLabel = `${robotsIndex ? 'index' : 'noindex'}, ${robotsFollow ? 'follow' : 'nofollow'}`;

        if (els.seoPreviewTitle) {
            els.seoPreviewTitle.textContent = title;
        }
        if (els.seoPreviewDescription) {
            els.seoPreviewDescription.textContent = description;
        }
        if (els.seoPreviewUrl) {
            els.seoPreviewUrl.textContent = baseUrl || '/';
        }
        if (els.seoPreviewRobots) {
            els.seoPreviewRobots.textContent = robotsLabel;
        }
        if (els.seoSitemapUrl) {
            els.seoSitemapUrl.textContent = baseUrl ? `${baseUrl}/sitemap.xml` : '/sitemap.xml';
        }
    }

    function renderSeoSettings(raw = state.seo) {
        const normalized = normalizeSeoSettings(raw);
        state.seo = normalized;
        if (els.seoTitleInput) {
            els.seoTitleInput.value = normalized.title;
        }
        if (els.seoDescriptionInput) {
            els.seoDescriptionInput.value = normalized.description;
        }
        if (els.seoKeywordsInput) {
            els.seoKeywordsInput.value = normalized.keywords;
        }
        if (els.seoSiteUrlInput) {
            els.seoSiteUrlInput.value = normalized.siteUrl;
        }
        if (els.seoOgTitleInput) {
            els.seoOgTitleInput.value = normalized.ogTitle;
        }
        if (els.seoOgDescriptionInput) {
            els.seoOgDescriptionInput.value = normalized.ogDescription;
        }
        if (els.seoOgImageInput) {
            els.seoOgImageInput.value = normalized.ogImage;
        }
        if (els.seoTwitterTitleInput) {
            els.seoTwitterTitleInput.value = normalized.twitterTitle;
        }
        if (els.seoTwitterDescriptionInput) {
            els.seoTwitterDescriptionInput.value = normalized.twitterDescription;
        }
        if (els.seoTwitterImageInput) {
            els.seoTwitterImageInput.value = normalized.twitterImage;
        }
        if (els.seoRobotsIndexToggle) {
            els.seoRobotsIndexToggle.checked = normalized.robotsIndex;
        }
        if (els.seoRobotsFollowToggle) {
            els.seoRobotsFollowToggle.checked = normalized.robotsFollow;
        }
        if (els.seoGoogleVerificationInput) {
            els.seoGoogleVerificationInput.value = normalized.googleSiteVerification;
        }
        updateSeoPreview();
    }

    async function loadSeoSettings() {
        try {
            const response = await fetch('/api/seo', { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload?.message || 'Tidak dapat memuat SEO.');
            }
            renderSeoSettings(payload);
            state.seoLoaded = true;
        } catch (error) {
            console.warn('Gagal memuat SEO', error);
            showSeoMessage('error', error.message || 'Tidak dapat memuat SEO.');
        }
    }

    function buildSeoPayloadFromInputs() {
        return {
            title: getSeoInputValue(els.seoTitleInput),
            description: getSeoInputValue(els.seoDescriptionInput),
            keywords: getSeoInputValue(els.seoKeywordsInput),
            siteUrl: getSeoInputValue(els.seoSiteUrlInput),
            ogTitle: getSeoInputValue(els.seoOgTitleInput),
            ogDescription: getSeoInputValue(els.seoOgDescriptionInput),
            ogImage: getSeoInputValue(els.seoOgImageInput),
            twitterTitle: getSeoInputValue(els.seoTwitterTitleInput),
            twitterDescription: getSeoInputValue(els.seoTwitterDescriptionInput),
            twitterImage: getSeoInputValue(els.seoTwitterImageInput),
            robotsIndex: Boolean(els.seoRobotsIndexToggle?.checked),
            robotsFollow: Boolean(els.seoRobotsFollowToggle?.checked),
            googleSiteVerification: getSeoInputValue(els.seoGoogleVerificationInput)
        };
    }

    async function saveSeoSettings() {
        const payload = buildSeoPayloadFromInputs();
        const headers = {
            'Content-Type': 'application/json'
        };
        const token = getToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        setSeoSaving(true);
        showSeoMessage(null, '');
        try {
            const response = await fetch('/api/seo', {
                method: 'PUT',
                headers,
                body: JSON.stringify(payload)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data?.message || 'Tidak dapat menyimpan SEO.');
            }
            renderSeoSettings(data);
            showSeoMessage('success', 'Pengaturan SEO berhasil disimpan.');
        } catch (error) {
            console.error('Gagal menyimpan SEO', error);
            showSeoMessage('error', error.message || 'Tidak dapat menyimpan SEO.');
        } finally {
            setSeoSaving(false);
        }
    }

    function renderUsersTable() {
        if (!els.usersTableBody) {
            return;
        }
        els.usersTableBody.innerHTML = '';
        if (!state.residents.length) {
            const empty = document.createElement('div');
            empty.className = 'users-empty';
            empty.textContent = 'Belum ada warga terdaftar.';
            els.usersTableBody.appendChild(empty);
            return;
        }
        state.residents.forEach((resident) => {
            const row = document.createElement('div');
            row.className = 'users-table__row';

            const nameCell = document.createElement('div');
            nameCell.textContent = resident.displayName || resident.username || '-';

            const usernameCell = document.createElement('div');
            usernameCell.textContent = resident.username ? `@${resident.username}` : '-';

            const loginCell = document.createElement('div');
            loginCell.textContent = formatLastLogin(resident.lastLoginAt);

            const statusCell = document.createElement('div');
            const actionsCell = document.createElement('div');
            actionsCell.className = 'users-table__cell--actions';

            const roleValue = resolveResidentRole(resident);
            if (roleValue === 'admin') {
                const badge = document.createElement('span');
                badge.className = 'users-badge users-badge--admin';
                badge.textContent = getRoleLabel(roleValue);
                statusCell.appendChild(badge);
                actionsCell.textContent = '—';
            } else {
                const select = document.createElement('select');
                select.className = 'users-role-select';
                const residentOption = document.createElement('option');
                residentOption.value = 'resident';
                residentOption.textContent = 'Warga';
                const managerOption = document.createElement('option');
                managerOption.value = 'pin_manager';
                managerOption.textContent = 'Pin Manager';
                select.appendChild(residentOption);
                select.appendChild(managerOption);
                select.value = roleValue;
                select.dataset.originalRole = roleValue;

                const saveBtn = document.createElement('button');
                saveBtn.type = 'button';
                saveBtn.className = 'chip-btn users-save-btn';
                saveBtn.textContent = 'Save';
                saveBtn.disabled = true;

                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'ghost-btn ghost-btn--danger chip-btn users-delete-btn';
                deleteBtn.textContent = 'Delete';

                select.addEventListener('change', () => {
                    saveBtn.disabled = select.value === select.dataset.originalRole;
                });

                saveBtn.addEventListener('click', () => {
                    updateResidentRole(resident.id, select.value, select, saveBtn);
                });

                deleteBtn.addEventListener('click', () => {
                    deleteResident(resident.id, resident.username, deleteBtn, saveBtn, select);
                });

                statusCell.appendChild(select);
                actionsCell.appendChild(saveBtn);
                actionsCell.appendChild(deleteBtn);
            }

            row.appendChild(nameCell);
            row.appendChild(usernameCell);
            row.appendChild(loginCell);
            row.appendChild(statusCell);
            row.appendChild(actionsCell);
            els.usersTableBody.appendChild(row);
        });
    }

    async function loadResidents(options = {}) {
        if (!state.permissions.isAdmin || state.usersLoading) {
            return;
        }
        state.usersLoading = true;
        if (els.usersTableBody) {
            els.usersTableBody.innerHTML = '';
            const loading = document.createElement('div');
            loading.className = 'users-empty';
            loading.textContent = 'Memuat daftar warga...';
            els.usersTableBody.appendChild(loading);
        }
        showUsersMessage(null, '');
        const headers = {
            'Content-Type': 'application/json'
        };
        const token = getToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        try {
            const response = await fetch('/api/admin/residents', { headers, cache: 'no-store' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data?.message || 'Tidak dapat memuat daftar warga.');
            }
            state.residents = Array.isArray(data?.residents) ? data.residents : [];
            state.usersLoaded = true;
            renderUsersTable();
        } catch (error) {
            console.error('Gagal memuat daftar warga', error);
            showUsersMessage('error', error.message || 'Tidak dapat memuat daftar warga.');
        } finally {
            state.usersLoading = false;
        }
    }

    async function updateResidentRole(residentId, nextRole, selectEl, saveBtn) {
        if (!state.permissions.isAdmin) {
            return;
        }
        if (!residentId || !selectEl || !saveBtn) {
            return;
        }
        const headers = {
            'Content-Type': 'application/json'
        };
        const token = getToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        const originalText = saveBtn.textContent || 'Save';
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        try {
            const response = await fetch(`/api/admin/residents/${residentId}/role`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({ role: nextRole })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data?.message || 'Tidak dapat memperbarui status warga.');
            }
            const updated = data?.resident || null;
            if (updated) {
                const idx = state.residents.findIndex((entry) => entry.id === residentId);
                if (idx !== -1) {
                    state.residents[idx] = { ...state.residents[idx], ...updated };
                }
                const updatedRole = resolveResidentRole(updated);
                selectEl.value = updatedRole;
                selectEl.dataset.originalRole = updatedRole;
                showUsersMessage('success', `Status ${updated.username ? `@${updated.username}` : 'warga'} diperbarui.`);
            } else {
                selectEl.dataset.originalRole = nextRole;
                showUsersMessage('success', 'Status warga diperbarui.');
            }
        } catch (error) {
            console.error('Gagal memperbarui status warga', error);
            showUsersMessage('error', error.message || 'Tidak dapat memperbarui status warga.');
        } finally {
            saveBtn.textContent = originalText;
            saveBtn.disabled = selectEl.value === selectEl.dataset.originalRole;
        }
    }

    async function deleteResident(residentId, username, deleteBtn, saveBtn, selectEl) {
        if (!state.permissions.isAdmin) {
            return;
        }
        if (!residentId || !deleteBtn) {
            return;
        }
        const label = username ? `@${username}` : 'warga ini';
        const confirmed = window.confirm(`Hapus ${label}? Tindakan ini permanen.`);
        if (!confirmed) {
            return;
        }
        const headers = {
            'Content-Type': 'application/json'
        };
        const token = getToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        const originalText = deleteBtn.textContent || 'Delete';
        deleteBtn.textContent = 'Deleting...';
        deleteBtn.disabled = true;
        if (saveBtn) {
            saveBtn.disabled = true;
        }
        if (selectEl) {
            selectEl.disabled = true;
        }
        let deleted = false;
        try {
            const response = await fetch(`/api/admin/residents/${residentId}`, {
                method: 'DELETE',
                headers
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data?.message || 'Tidak dapat menghapus warga.');
            }
            state.residents = state.residents.filter((resident) => resident.id !== residentId);
            renderUsersTable();
            showUsersMessage('success', `Akun ${label} dihapus.`);
            deleted = true;
        } catch (error) {
            console.error('Gagal menghapus warga', error);
            showUsersMessage('error', error.message || 'Tidak dapat menghapus warga.');
        } finally {
            if (!deleted) {
                deleteBtn.textContent = originalText;
                deleteBtn.disabled = false;
                if (saveBtn && selectEl) {
                    saveBtn.disabled = selectEl.value === selectEl.dataset.originalRole;
                    selectEl.disabled = false;
                }
            }
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
                    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
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
        const resident = typeof ResidentSession.getCurrentResident === 'function'
            ? ResidentSession.getCurrentResident()
            : null;
        const role = resolveResidentRole(resident);
        const isAdmin = role === 'admin';
        const canManagePins = role === 'admin' || role === 'pin_manager';
        state.permissions = { isAdmin, canManagePins, role };
        applyAdminPermissions();
        if (!canManagePins) {
            showMessage('error', 'Halaman ini hanya untuk admin atau pin manager.');
            setTimeout(() => redirectToLogin(), 900);
            return;
        }
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
        const roleKey = getRoleKey();
        let allowedTabs = getAllowedTabsForRole(roleKey);
        if (!allowedTabs.length) {
            allowedTabs = ['pins'];
        }
        const nextTab = allowedTabs.includes(tabKey) ? tabKey : allowedTabs[0];
        els.tabButtons.forEach((btn) => {
            const isActive = btn.dataset.tab === nextTab;
            btn.classList.toggle('admin-tab--active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        if (els.pinContent) {
            els.pinContent.classList.toggle('hidden', nextTab !== 'pins');
        }
        if (els.massContent) {
            els.massContent.classList.toggle('hidden', nextTab !== 'mass');
        }
        if (els.usersContent) {
            els.usersContent.classList.toggle('hidden', nextTab !== 'users');
        }
        if (els.metricsContent) {
            els.metricsContent.classList.toggle('hidden', nextTab !== 'metrics');
        }
        if (els.featuresContent) {
            els.featuresContent.classList.toggle('hidden', nextTab !== 'features');
        }
        if (els.seoContent) {
            els.seoContent.classList.toggle('hidden', nextTab !== 'seo');
        }
        if (els.tabsContent) {
            els.tabsContent.classList.toggle('hidden', nextTab !== 'tabs');
        }
        if (els.categoriesContent) {
            els.categoriesContent.classList.toggle('hidden', nextTab !== 'categories');
        }
        if (nextTab === 'mass') {
            initMassMap();
            refreshMassMapView();
        }
        if (nextTab === 'tabs') {
            resetTabVisibilityDraft();
            renderTabOrderList();
        }
        if (nextTab === 'categories') {
            resetCategoriesDraft();
        }
        if (nextTab === 'metrics' && !state.metricsLoaded && state.permissions?.isAdmin) {
            refreshAnalytics();
        }
        if (nextTab === 'users' && !state.usersLoaded && state.permissions?.isAdmin) {
            loadResidents();
        }
        if (nextTab === 'seo' && !state.seoLoaded && state.permissions?.isAdmin) {
            loadSeoSettings();
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

    function normalizeText(value) {
        return (value || '').trim().toLowerCase();
    }

    function getCheckedValue(radios = [], fallback = '') {
        const selected = radios.find((input) => input && input.checked);
        return selected ? selected.value : fallback;
    }

    function setRadioGroupValue(radios = [], value = '') {
        if (!radios.length) return;
        let matched = false;
        radios.forEach((input) => {
            const isMatch = input.value === value;
            input.checked = isMatch;
            if (isMatch) {
                matched = true;
            }
        });
        if (!matched) {
            radios[0].checked = true;
        }
    }

    function getAvailableCategories() {
        const configured = [];
        const configuredKeys = new Set();
        (state.categories.list || []).forEach((item) => {
            const name = normalizeCategoryName(item?.name || '');
            if (!name) {
                return;
            }
            const key = normalizeCategoryKey(name);
            if (configuredKeys.has(key)) {
                return;
            }
            configuredKeys.add(key);
            configured.push(name);
        });
        const fromPins = Array.from(
            new Set(
                state.pins
                    .map((pin) => (pin.category || '').trim())
                    .filter(Boolean)
            )
        );
        const extras = fromPins
            .filter((category) => !configuredKeys.has(normalizeCategoryKey(category)))
            .sort((a, b) => a.localeCompare(b, 'id', { sensitivity: 'base' }));
        return configured.concat(extras);
    }

    function populateCategoryFilter() {
        if (!els.filterCategory) {
            return;
        }
        const current = state.filters.category || '';
        const categories = getAvailableCategories();
        els.filterCategory.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Semua kategori';
        els.filterCategory.appendChild(defaultOption);
        categories.forEach((category) => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            els.filterCategory.appendChild(option);
        });
        const matched =
            categories.find((category) => category.toLowerCase() === current.toLowerCase()) || '';
        els.filterCategory.value = matched;
        state.filters.category = matched;
    }

    function populateCategorySelect(selectedValue = '') {
        if (!els.categoryInput) {
            return;
        }
        const hasSelectedPin = Boolean(state.selectedPin);
        const current = (selectedValue || (hasSelectedPin ? els.categoryInput.value : '') || '').trim();
        const categories = getAvailableCategories();
        let list = categories.slice();
        if (current && !list.some((category) => category.toLowerCase() === current.toLowerCase())) {
            list = list.concat(current).sort((a, b) => a.localeCompare(b, 'id', { sensitivity: 'base' }));
        }

        els.categoryInput.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Pilih kategori';
        placeholder.disabled = true;
        placeholder.selected = !current;
        els.categoryInput.appendChild(placeholder);
        list.forEach((category) => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            els.categoryInput.appendChild(option);
        });
        if (current) {
            const matched = list.find((category) => category.toLowerCase() === current.toLowerCase()) || current;
            els.categoryInput.value = matched;
        }
    }

    function populateMassCategorySelect(selectedValue = '') {
        if (!els.massCategorySelect) {
            return;
        }
        const current = (selectedValue || els.massCategorySelect.value || '').trim();
        const categories = getAvailableCategories();
        let list = categories.slice();
        if (current && !list.some((category) => category.toLowerCase() === current.toLowerCase())) {
            list = list.concat(current).sort((a, b) => a.localeCompare(b, 'id', { sensitivity: 'base' }));
        }

        els.massCategorySelect.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Pilih kategori';
        placeholder.disabled = true;
        placeholder.selected = !current;
        els.massCategorySelect.appendChild(placeholder);
        list.forEach((category) => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            els.massCategorySelect.appendChild(option);
        });
        if (current) {
            const matched = list.find((category) => category.toLowerCase() === current.toLowerCase()) || current;
            els.massCategorySelect.value = matched;
        }
    }

    function applyPinFilters() {
        const query = normalizeText(els.pinSearch?.value);
        state.filters = {
            category: els.filterCategory?.value || '',
            link: getCheckedValue(els.filterLinkRadios, 'any'),
            startDate: getCheckedValue(els.filterStartRadios, 'any'),
            endDate: getCheckedValue(els.filterEndRadios, 'any'),
            photo: getCheckedValue(els.filterPhotoRadios, 'any')
        };
        state.filteredPins = state.pins.filter((pin) => {
            if (query) {
                const haystack = [pin.title, pin.description, pin.category, pin.city]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();
                if (!haystack.includes(query)) {
                    return false;
                }
            }
            if (state.filters.category && normalizeText(pin.category) !== normalizeText(state.filters.category)) {
                return false;
            }
            const hasLink = Boolean(normalizeText(pin.link));
            if (state.filters.link === 'with' && !hasLink) {
                return false;
            }
            if (state.filters.link === 'without' && hasLink) {
                return false;
            }
            const lifetime = pin.lifetime || {};
            const startFilled = Boolean(normalizeText(lifetime.start || lifetime.value));
            if (state.filters.startDate === 'filled' && !startFilled) {
                return false;
            }
            if (state.filters.startDate === 'empty' && startFilled) {
                return false;
            }
            const endFilled = Boolean(normalizeText(lifetime.end));
            if (state.filters.endDate === 'filled' && !endFilled) {
                return false;
            }
            if (state.filters.endDate === 'empty' && endFilled) {
                return false;
            }
            const hasPhoto =
                (Array.isArray(pin.images) && pin.images.length > 0) || Number(pin.imageCount || 0) > 0;
            if (state.filters.photo === 'with' && !hasPhoto) {
                return false;
            }
            if (state.filters.photo === 'without' && hasPhoto) {
                return false;
            }
            return true;
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
            const response = await fetch('/api/pins?lean=1', { cache: 'no-store' });
            const pins = await response.json().catch(() => []);
            state.pins = Array.isArray(pins) ? pins : [];
            populateCategoryFilter();
            populateMassCategorySelect();
            applyPinFilters();
            renderCategoryManager();
            await refreshPinCount();
            if (state.selectedPin) {
                const selectedId = getPinId(state.selectedPin);
                const stillExists = state.pins.some((pin) => getPinId(pin) === selectedId);
                if (stillExists) {
                    selectPin(selectedId, { silentMessage: true });
                    return;
                }
            }
            const initialList = state.filteredPins.length ? state.filteredPins : state.pins;
            if (initialList.length) {
                selectPin(getPinId(initialList[0]), { silentMessage: true });
            } else {
                clearSelection();
                populateCategorySelect();
            }
        } catch (error) {
            console.error('Gagal memuat pin', error);
            showMessage('error', 'Gagal memuat data pin. Coba refresh kembali.');
        }
    }

    async function fetchPinDetailsById(pinId) {
        if (!pinId) {
            return null;
        }
        const response = await fetch(`/api/pins/${pinId}`, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error('Gagal memuat detail pin.');
        }
        return response.json();
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
        populateCategorySelect(pin.category || '');
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

        const needsImages = (!Array.isArray(pin.images) || pin.images.length === 0) && Number(pin.imageCount || 0) > 0;
        if (needsImages) {
            fetchPinDetailsById(getPinId(pin))
                .then((fullPin) => {
                    if (!fullPin) {
                        return;
                    }
                    const targetId = getPinId(fullPin);
                    const idx = state.pins.findIndex((entry) => getPinId(entry) === targetId);
                    if (idx !== -1) {
                        state.pins[idx] = fullPin;
                    }
                    if (state.selectedPin && getPinId(state.selectedPin) === targetId) {
                        state.selectedPin = fullPin;
                        state.existingImages = normalizeImages(fullPin);
                        renderImages();
                        renderPinList();
                    }
                })
                .catch((error) => {
                    console.error('Gagal memuat detail pin', error);
                });
        }
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

    async function initMassMap() {
        if (!els.massMap || massMap) {
            return;
        }
        try {
            const gmaps = await ensureGoogleMaps();
            const center = METRICS_DEFAULT_CENTER;
            massMap = new gmaps.Map(els.massMap, {
                center,
                zoom: 5,
                mapTypeControl: false,
                fullscreenControl: false,
                streetViewControl: false
            });
            massInfoWindow = new gmaps.InfoWindow();
            if (gmaps.places?.PlacesService) {
                massPlacesService = new gmaps.places.PlacesService(massMap);
            }
        } catch (error) {
            console.warn('Peta hasil mass gagal dimuat', error);
            showMassMessage('error', 'Peta hasil tidak dapat dimuat.');
        }
    }

    function clearMassMarkers() {
        massMarkers.forEach((marker) => {
            marker.setMap(null);
        });
        massMarkers.clear();
        massMarkerBounds = null;
    }

    function renderMassMapMarkers() {
        if (!massMap || !window.google?.maps) {
            return;
        }
        clearMassMarkers();
        if (!state.mass.results.length) {
            massMap.setCenter(METRICS_DEFAULT_CENTER);
            massMap.setZoom(5);
            return;
        }
        const gmaps = window.google.maps;
        const bounds = new gmaps.LatLngBounds();
        state.mass.results.forEach((place, index) => {
            if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
                return;
            }
            const position = { lat: place.lat, lng: place.lng };
            const marker = new gmaps.Marker({
                position,
                map: massMap,
                label: `${index + 1}`,
                opacity: state.mass.selectedPlaceIds.has(place.id) ? 1 : 0.35
            });
            marker.addListener('click', () => {
                focusMassMarker(place.id);
            });
            massMarkers.set(place.id, marker);
            bounds.extend(position);
        });
        if (!bounds.isEmpty()) {
            massMarkerBounds = bounds;
            massMap.fitBounds(bounds);
        }
    }

    function focusMassMarker(placeId) {
        if (!massMap || !massInfoWindow) {
            return;
        }
        const marker = massMarkers.get(placeId);
        const place = state.mass.results.find((item) => item.id === placeId);
        if (!marker || !place) {
            return;
        }
        const wrapper = document.createElement('div');
        const title = document.createElement('div');
        title.style.fontWeight = '700';
        title.textContent = place.name || 'Lokasi';
        const meta = document.createElement('div');
        meta.style.fontSize = '12px';
        meta.style.color = '#1f2937';
        meta.textContent = place.address || '';
        wrapper.appendChild(title);
        if (place.address) {
            wrapper.appendChild(meta);
        }
        massInfoWindow.setContent(wrapper);
        massInfoWindow.open({ map: massMap, anchor: marker });
        const pos = marker.getPosition();
        if (pos) {
            massMap.panTo(pos);
        }
    }

    function syncMassMarkerSelection(placeId, selected) {
        const marker = massMarkers.get(placeId);
        if (!marker) {
            return;
        }
        marker.setOpacity(selected ? 1 : 0.35);
    }

    function syncAllMassMarkerSelection() {
        massMarkers.forEach((marker, id) => {
            marker.setOpacity(state.mass.selectedPlaceIds.has(id) ? 1 : 0.35);
        });
    }

    function refreshMassMapView() {
        if (!massMap || !window.google?.maps?.event) {
            return;
        }
        window.google.maps.event.trigger(massMap, 'resize');
        if (massMarkerBounds && !massMarkerBounds.isEmpty()) {
            massMap.fitBounds(massMarkerBounds);
        }
    }

    function setMassSearchState(isSearching) {
        state.mass.isSearching = isSearching;
        if (els.massSearchBtn) {
            els.massSearchBtn.disabled = isSearching;
            els.massSearchBtn.textContent = isSearching ? 'Searching...' : 'Search';
        }
        if (els.massSearchInput) {
            els.massSearchInput.disabled = isSearching;
        }
    }

    function setMassCreateState(isCreating) {
        state.mass.isCreating = isCreating;
        if (els.massCreateBtn) {
            els.massCreateBtn.disabled = isCreating;
            els.massCreateBtn.textContent = isCreating ? 'Adding...' : 'Add Selected Pins';
        }
    }

    function updateMassCounts() {
        const resultCount = state.mass.results.length;
        const selectedCount = state.mass.selectedPlaceIds.size;
        if (els.massResultsCount) {
            els.massResultsCount.textContent = `${resultCount} results`;
        }
        if (els.massSelectedCount) {
            els.massSelectedCount.textContent = `${selectedCount} selected`;
        }
    }

    function renderMassResults() {
        if (!els.massResultsList) {
            return;
        }
        els.massResultsList.innerHTML = '';
        if (!state.mass.results.length) {
            const empty = document.createElement('div');
            empty.className = 'pin-list-empty';
            empty.textContent = 'No results yet.';
            els.massResultsList.appendChild(empty);
            updateMassCounts();
            return;
        }
        state.mass.results.forEach((place) => {
            const item = document.createElement('li');
            item.className = 'mass-result-item';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = state.mass.selectedPlaceIds.has(place.id);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    state.mass.selectedPlaceIds.add(place.id);
                } else {
                    state.mass.selectedPlaceIds.delete(place.id);
                }
                syncMassMarkerSelection(place.id, checkbox.checked);
                updateMassCounts();
            });
            const content = document.createElement('div');
            content.addEventListener('click', () => {
                focusMassMarker(place.id);
            });
            const name = document.createElement('div');
            name.className = 'mass-result-name';
            name.textContent = place.name || 'Lokasi';
            const meta = document.createElement('div');
            meta.className = 'mass-result-meta';
            meta.textContent = place.address || 'Alamat tidak tersedia';
            content.appendChild(name);
            content.appendChild(meta);
            item.appendChild(checkbox);
            item.appendChild(content);
            els.massResultsList.appendChild(item);
        });
        syncAllMassMarkerSelection();
        updateMassCounts();
    }

    function parseMassSearchQuery(rawQuery) {
        const trimmed = (rawQuery || '').trim();
        if (!trimmed) {
            return { term: '', location: '' };
        }
        const match = /\s+di\s+(.+)$/i.exec(trimmed);
        if (match) {
            const location = match[1].trim();
            const term = trimmed.slice(0, match.index).trim();
            return { term: term || location, location };
        }
        return { term: trimmed, location: '' };
    }

    function normalizePlaceResult(place) {
        if (!place || !place.place_id) {
            return null;
        }
        const location = place.geometry?.location;
        if (!location || typeof location.lat !== 'function' || typeof location.lng !== 'function') {
            return null;
        }
        return {
            id: place.place_id,
            name: place.name || '',
            address: place.formatted_address || place.vicinity || '',
            lat: location.lat(),
            lng: location.lng()
        };
    }

    async function ensureMassPlacesService() {
        await initMassMap();
        const gmaps = await ensureGoogleMaps();
        if (!gmaps?.places?.PlacesService) {
            throw new Error('Google Places API belum tersedia.');
        }
        if (!massPlacesService) {
            massPlacesService = new gmaps.places.PlacesService(massMap || document.createElement('div'));
        }
        return massPlacesService;
    }

    function runPlacesTextSearch(service, request) {
        return new Promise((resolve, reject) => {
            const collected = [];
            const handlePage = (results, status, pagination) => {
                const okStatus = window.google?.maps?.places?.PlacesServiceStatus?.OK || 'OK';
                const zeroStatus = window.google?.maps?.places?.PlacesServiceStatus?.ZERO_RESULTS || 'ZERO_RESULTS';
                if (status !== okStatus && status !== zeroStatus) {
                    reject(new Error('Pencarian tempat gagal.'));
                    return;
                }
                if (Array.isArray(results)) {
                    collected.push(...results);
                }
                if (pagination && pagination.hasNextPage) {
                    setTimeout(() => {
                        pagination.nextPage();
                    }, 2000);
                } else {
                    resolve(collected);
                }
            };
            service.textSearch(request, handlePage);
        });
    }

    async function geocodeMassLocation(location) {
        if (!location) {
            return null;
        }
        const gmaps = await ensureGoogleMaps();
        if (!massGeocoder) {
            massGeocoder = new gmaps.Geocoder();
        }
        const result = await massGeocoder.geocode({ address: location });
        const results = result?.results || [];
        if (!results.length) {
            return null;
        }
        const first = results[0];
        return {
            location: first.geometry?.location || null,
            bounds: first.geometry?.viewport || null,
            formatted: first.formatted_address || location
        };
    }

    async function handleMassSearch() {
        const rawQuery = els.massSearchInput?.value.trim() || '';
        if (!rawQuery) {
            showMassMessage('error', 'Masukkan kata kunci pencarian.');
            return;
        }
        if (state.mass.isSearching) {
            return;
        }
        const { term, location } = parseMassSearchQuery(rawQuery);
        if (!term) {
            showMassMessage('error', 'Masukkan nama tempat atau brand yang dicari.');
            return;
        }
        setMassSearchState(true);
        showMassMessage(null, '');
        if (els.massStatus) {
            els.massStatus.textContent = '';
        }
        try {
            const service = await ensureMassPlacesService();
            let requestQuery = rawQuery;
            const request = {};
            let scopeLabel = 'di Indonesia';
            if (location) {
                const area = await geocodeMassLocation(location);
                if (!area || !area.location) {
                    throw new Error('Area lokasi tidak ditemukan. Coba perjelas nama kota/provinsi.');
                }
                requestQuery = `${term} ${location}`.trim();
                if (area.bounds) {
                    request.bounds = area.bounds;
                }
                scopeLabel = `di ${area.formatted || location}`;
            } else {
                if (!/indonesia/i.test(rawQuery)) {
                    requestQuery = `${rawQuery} Indonesia`;
                }
                request.region = 'id';
            }
            request.query = requestQuery;
            const results = await runPlacesTextSearch(service, request);
            const normalized = [];
            const seen = new Set();
            results.forEach((place) => {
                const normalizedPlace = normalizePlaceResult(place);
                if (!normalizedPlace) {
                    return;
                }
                if (seen.has(normalizedPlace.id)) {
                    return;
                }
                seen.add(normalizedPlace.id);
                normalized.push(normalizedPlace);
            });
            state.mass.results = normalized;
            state.mass.selectedPlaceIds = new Set(normalized.map((item) => item.id));
            renderMassMapMarkers();
            refreshMassMapView();
            renderMassResults();
            if (!normalized.length) {
                showMassMessage('error', `Tidak ada hasil ${scopeLabel}. Coba kata kunci lain atau ganti lokasi.`);
            } else {
                showMassMessage('success', `Menemukan ${normalized.length} lokasi ${scopeLabel}. Silakan pilih yang relevan.`);
            }
        } catch (error) {
            console.warn('Gagal mencari lokasi massal', error);
            showMassMessage('error', error.message || 'Gagal mencari lokasi.');
        } finally {
            setMassSearchState(false);
        }
    }

    function handleMassSelectAll() {
        state.mass.selectedPlaceIds = new Set(state.mass.results.map((item) => item.id));
        renderMassResults();
    }

    function handleMassClearSelection() {
        state.mass.selectedPlaceIds.clear();
        renderMassResults();
    }

    function renderMassImages() {
        if (!els.massImages) {
            return;
        }
        els.massImages.innerHTML = '';
        if (!state.mass.addedImages.length) {
            updateMassRemainingSlots();
            return;
        }
        state.mass.addedImages.forEach((image, index) => {
            const card = document.createElement('div');
            card.className = 'image-card';
            const img = document.createElement('img');
            img.src = image.dataUrl;
            img.alt = image.originalName || 'Foto';
            card.appendChild(img);

            const actions = document.createElement('div');
            actions.className = 'image-actions';
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.textContent = 'Hapus';
            removeBtn.addEventListener('click', () => {
                removeMassImage(index);
            });
            actions.appendChild(removeBtn);
            card.appendChild(actions);

            const meta = document.createElement('div');
            meta.className = 'image-meta';
            meta.textContent = image.originalName || 'Foto';
            card.appendChild(meta);

            els.massImages.appendChild(card);
        });
        updateMassRemainingSlots();
    }

    function updateMassRemainingSlots() {
        if (!els.massPhotoRemaining) {
            return;
        }
        const remaining = Math.max(0, MAX_PIN_PHOTO_COUNT - state.mass.addedImages.length);
        els.massPhotoRemaining.textContent = `${remaining} photos remaining`;
    }

    async function handleMassImageInput(event) {
        const files = Array.from(event?.target?.files || []);
        if (els.massImageInput) {
            els.massImageInput.value = '';
        }
        let remainingSlots = Math.max(0, MAX_PIN_PHOTO_COUNT - state.mass.addedImages.length);
        if (!remainingSlots) {
            showMassMessage('error', 'Batas 3 foto per pin. Hapus foto yang tidak dipakai terlebih dulu.');
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
                state.mass.addedImages.push({
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
            showMassMessage('error', errors.join(' '));
        } else {
            showMassMessage(null, '');
        }
        renderMassImages();
    }

    function removeMassImage(index) {
        if (index < 0 || index >= state.mass.addedImages.length) {
            return;
        }
        state.mass.addedImages.splice(index, 1);
        renderMassImages();
    }

    function buildMassImagesPayload() {
        return state.mass.addedImages
            .slice(0, MAX_PIN_PHOTO_COUNT)
            .map((image) => ({
                dataUrl: image.dataUrl,
                contentType: image.contentType,
                size: image.size,
                originalName: image.originalName
            }));
    }

    function buildLifetimePayload(lifetimeType, startRaw, endRaw) {
        const lifetimeStart = parseDateInput(startRaw);
        const lifetimeEnd = parseDateInput(endRaw);
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
                return lifetime;
            }
            return { type: lifetimeType };
        }
        if (lifetimeStart || lifetimeEnd) {
            const lifetime = { type: 'date' };
            if (lifetimeStart && lifetimeEnd && lifetimeStart !== lifetimeEnd) {
                lifetime.start = lifetimeStart;
                lifetime.end = lifetimeEnd;
            } else if (lifetimeStart) {
                lifetime.value = lifetimeStart;
            } else if (lifetimeEnd) {
                lifetime.value = lifetimeEnd;
            }
            return lifetime;
        }
        return null;
    }

    async function handleMassSubmit(event) {
        event.preventDefault();
        if (state.mass.isCreating) {
            return;
        }
        const selectedPlaces = state.mass.results.filter((place) => state.mass.selectedPlaceIds.has(place.id));
        if (!selectedPlaces.length) {
            showMassMessage('error', 'Pilih minimal satu lokasi dari hasil pencarian.');
            return;
        }
        const title = els.massTitleInput?.value.trim() || '';
        const description = els.massDescriptionInput?.value.trim() || '';
        const category = els.massCategorySelect?.value.trim() || '';
        const link = els.massLinkInput?.value.trim() || '';
        if (!title || !description || !category) {
            showMassMessage('error', 'Judul, deskripsi, dan kategori wajib diisi.');
            return;
        }
        const lifetimeType = els.massLifetimeSelect?.value || '';
        const lifetime = buildLifetimePayload(lifetimeType, els.massStartInput?.value || '', els.massEndInput?.value || '');
        const imagesPayload = buildMassImagesPayload();

        const confirmed = window.confirm(`Tambahkan ${selectedPlaces.length} pin sekaligus?`);
        if (!confirmed) {
            return;
        }

        const payloadBase = {
            title,
            description,
            category
        };
        if (link) {
            payloadBase.link = link;
        }
        if (lifetime) {
            payloadBase.lifetime = lifetime;
        }
        if (imagesPayload.length) {
            payloadBase.images = imagesPayload;
        }

        const headers = {
            'Content-Type': 'application/json'
        };
        const token = getToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        setMassCreateState(true);
        showMassMessage(null, '');
        let successCount = 0;
        const failures = [];
        try {
            for (let index = 0; index < selectedPlaces.length; index += 1) {
                const place = selectedPlaces[index];
                if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
                    failures.push({ place, reason: 'Koordinat tidak valid.' });
                    continue;
                }
                if (els.massStatus) {
                    els.massStatus.textContent = `Menambahkan ${index + 1} dari ${selectedPlaces.length}...`;
                }
                try {
                    const response = await fetch('/api/pins', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            ...payloadBase,
                            lat: place.lat,
                            lng: place.lng
                        })
                    });
                    const data = await response.json().catch(() => ({}));
                    if (!response.ok) {
                        throw new Error(data?.message || 'Gagal menambahkan pin.');
                    }
                    successCount += 1;
                } catch (error) {
                    failures.push({ place, reason: error.message || 'Gagal menambahkan pin.' });
                }
            }
        } finally {
            setMassCreateState(false);
        }

        if (els.massStatus) {
            els.massStatus.textContent = '';
        }

        if (successCount) {
            await loadPins();
        }

        if (failures.length) {
            showMassMessage(
                'error',
                `Berhasil menambahkan ${successCount} pin, ${failures.length} gagal. Periksa hasil dan coba lagi.`
            );
        } else {
            showMassMessage('success', `Berhasil menambahkan ${successCount} pin.`);
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
            empty.textContent = 'No saved photos.';
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
        els.photoRemaining.textContent = `${remaining} photos remaining`;
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
        const expectedExisting = Number(state.selectedPin?.imageCount || 0);
        if (expectedExisting > 0 && state.existingImages.length === 0 && state.addedImages.length === 0) {
            return null;
        }
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

        const imagesPayload = buildImagesPayload();
        if (imagesPayload !== null) {
            payload.images = imagesPayload;
        }
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
            populateCategoryFilter();
            applyPinFilters();
            selectPin(pinId, { silentMessage: true });
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
            state.selectedPin = null;
            clearSelection();
            populateCategoryFilter();
            populateCategorySelect();
            applyPinFilters();
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
            els.pinSearch.addEventListener('input', applyPinFilters);
        }
        if (els.pinSearchBtn) {
            els.pinSearchBtn.addEventListener('click', applyPinFilters);
        }
        if (els.filterCategory) {
            els.filterCategory.addEventListener('change', applyPinFilters);
        }
        (els.filterLinkRadios || []).forEach((input) => {
            input.addEventListener('change', applyPinFilters);
        });
        (els.filterStartRadios || []).forEach((input) => {
            input.addEventListener('change', applyPinFilters);
        });
        (els.filterEndRadios || []).forEach((input) => {
            input.addEventListener('change', applyPinFilters);
        });
        (els.filterPhotoRadios || []).forEach((input) => {
            input.addEventListener('change', applyPinFilters);
        });
        if (els.refreshPinsBtn) {
            els.refreshPinsBtn.addEventListener('click', () => {
                loadPins();
            });
        }
        if (els.maintenanceToggle) {
            els.maintenanceToggle.addEventListener('change', syncMaintenancePreviewFromInputs);
        }
        if (els.maintenanceMessage) {
            els.maintenanceMessage.addEventListener('input', syncMaintenancePreviewFromInputs);
        }
        if (els.maintenanceSaveBtn) {
            els.maintenanceSaveBtn.addEventListener('click', saveMaintenanceStatus);
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
        if (els.massSearchBtn) {
            els.massSearchBtn.addEventListener('click', handleMassSearch);
        }
        if (els.massSearchInput) {
            els.massSearchInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    handleMassSearch();
                }
            });
        }
        if (els.massSelectAllBtn) {
            els.massSelectAllBtn.addEventListener('click', handleMassSelectAll);
        }
        if (els.massClearBtn) {
            els.massClearBtn.addEventListener('click', handleMassClearSelection);
        }
        if (els.massImageInput) {
            els.massImageInput.addEventListener('change', handleMassImageInput);
        }
        if (els.massForm) {
            els.massForm.addEventListener('submit', handleMassSubmit);
        }
        if (els.usersRefreshBtn) {
            els.usersRefreshBtn.addEventListener('click', () => {
                loadResidents({ force: true });
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
        if (els.featureSaveBtn) {
            els.featureSaveBtn.addEventListener('click', saveFeatureFlags);
        }
        if (els.tabsSaveBtn) {
            els.tabsSaveBtn.addEventListener('click', saveTabVisibilityDraft);
        }
        if (els.categoryAddBtn) {
            els.categoryAddBtn.addEventListener('click', handleAddCategory);
        }
        if (els.categoryNewInput) {
            els.categoryNewInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    handleAddCategory();
                }
            });
        }
        if (els.categoriesSaveBtn) {
            els.categoriesSaveBtn.addEventListener('click', saveCategoriesDraft);
        }
        if (els.categoriesResetBtn) {
            els.categoriesResetBtn.addEventListener('click', resetCategoriesDraft);
        }
        if (els.seoSaveBtn) {
            els.seoSaveBtn.addEventListener('click', saveSeoSettings);
        }
        const seoInputs = [
            els.seoTitleInput,
            els.seoDescriptionInput,
            els.seoKeywordsInput,
            els.seoSiteUrlInput,
            els.seoOgTitleInput,
            els.seoOgDescriptionInput,
            els.seoOgImageInput,
            els.seoTwitterTitleInput,
            els.seoTwitterDescriptionInput,
            els.seoTwitterImageInput,
            els.seoGoogleVerificationInput
        ].filter(Boolean);
        seoInputs.forEach((input) => {
            input.addEventListener('input', updateSeoPreview);
        });
        if (els.seoRobotsIndexToggle) {
            els.seoRobotsIndexToggle.addEventListener('change', updateSeoPreview);
        }
        if (els.seoRobotsFollowToggle) {
            els.seoRobotsFollowToggle.addEventListener('change', updateSeoPreview);
        }
    }

    async function init() {
        cacheElements();
        setFormDisabled(true);
        bindEvents();
        updateSeoPreview();
        renderMassResults();
        renderMassImages();
        updateMassCounts();
        populateMassCategorySelect();
        updateTabsSaveState();
        updateCategoriesSaveState();
        if (els.metricsYear) {
            els.metricsYear.value = state.metricsFilter.year;
        }
        if (els.metricsMonth) {
            els.metricsMonth.value = state.metricsFilter.month;
        }
        if (els.metricsGranularity) {
            els.metricsGranularity.value = state.metricsFilter.granularity;
        }
        if (els.metricsStartYear) {
            els.metricsStartYear.value = state.metricsFilter.startYear;
        }
        if (els.metricsEndYear) {
            els.metricsEndYear.value = state.metricsFilter.endYear;
        }
        setRadioGroupValue(els.filterLinkRadios, state.filters.link);
        setRadioGroupValue(els.filterStartRadios, state.filters.startDate);
        setRadioGroupValue(els.filterEndRadios, state.filters.endDate);
        setRadioGroupValue(els.filterPhotoRadios, state.filters.photo);
        try {
            await ensureAdminSession();
        } catch (error) {
            showMessage('error', error.message || 'Gagal memuat sesi admin.');
            return;
        }
        await fetchTabVisibilityRemote();
        const storedTabOrder = loadTabOrder();
        if (storedTabOrder.length) {
            applyTabOrder(storedTabOrder);
        }
        if (state.permissions?.isAdmin) {
            await loadMaintenanceStatus();
            await loadFeatureFlags();
        }
        await loadCategories();
        initMiniMap();
        loadPins();
        setActiveTab('pins');
        if (state.permissions?.isAdmin) {
            syncMetricsControlsVisibility();
            applyMetricsFilterFromInputs();
            loadDashboard();
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();

(function () {
    const MAX_IMAGES = 3;
    const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
    const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);
    const state = {
        initialized: false,
        configured: false,
        sources: [],
        categories: [],
        drafts: [],
        selectedId: '',
        activeRun: null,
        pollTimer: null,
        isBusy: false
    };
    const els = {};
    const DEFAULT_MAP_CENTER = { lat: -6.2088, lng: 106.8456 };
    let googleMapsPromise = null;
    let locationMap = null;
    let locationMarker = null;
    let locationGeocoder = null;

    function cacheElements() {
        const ids = [
            'gather-service-status', 'gather-message', 'gather-source-select', 'gather-limit',
            'gather-run-btn', 'gather-refresh-btn', 'gather-run-summary', 'gather-progress-bar',
            'gather-run-metrics', 'gather-draft-count', 'gather-draft-source-filter',
            'gather-draft-search', 'gather-draft-list', 'gather-review-grid', 'gather-draft-form',
            'gather-editor-source', 'gather-editor-title', 'gather-completeness', 'gather-title',
            'gather-description', 'gather-category', 'gather-link', 'gather-start-date',
            'gather-end-date', 'gather-lat', 'gather-lng', 'gather-location-search-input',
            'gather-location-search-btn', 'gather-location-map',
            'gather-image-list', 'gather-image-input', 'gather-delete-btn', 'gather-save-btn',
            'gather-publish-btn'
        ];
        ids.forEach((id) => {
            els[id.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = document.getElementById(id);
        });
    }

    function getToken() {
        return typeof ResidentSession !== 'undefined' && typeof ResidentSession.getToken === 'function'
            ? ResidentSession.getToken()
            : '';
    }

    async function api(path, options = {}) {
        const headers = { ...(options.headers || {}), Authorization: `Bearer ${getToken()}` };
        if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
        const response = await fetch(path, { ...options, headers, cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.message || 'Permintaan Gather Pins gagal.');
        return data;
    }

    function showMessage(type, text) {
        if (!els.gatherMessage) return;
        els.gatherMessage.textContent = text || '';
        els.gatherMessage.classList.remove('is-visible', 'is-success', 'is-error');
        if (!text) return;
        els.gatherMessage.classList.add('is-visible');
        if (type === 'success') els.gatherMessage.classList.add('is-success');
        if (type === 'error') els.gatherMessage.classList.add('is-error');
    }

    function setServiceStatus(configured) {
        state.configured = configured;
        if (!els.gatherServiceStatus) return;
        els.gatherServiceStatus.dataset.state = configured ? 'online' : 'offline';
        const label = els.gatherServiceStatus.querySelector('span:last-child');
        if (label) label.textContent = configured ? 'Apify siap' : 'Apify belum dikonfigurasi';
        if (els.gatherRunBtn) els.gatherRunBtn.disabled = !configured || state.isBusy;
    }

    function populateSources() {
        const options = state.sources.map((source) => `<option value="${escapeHtml(source.id)}">${escapeHtml(source.label)}</option>`).join('');
        if (els.gatherSourceSelect) els.gatherSourceSelect.innerHTML = options;
        if (els.gatherDraftSourceFilter) {
            els.gatherDraftSourceFilter.innerHTML = `<option value="">Semua sumber</option>${options}`;
        }
    }

    function categoryName(item) {
        if (typeof item === 'string') return item.trim();
        return String(item?.name || item?.label || item?.value || '').trim();
    }

    function populateCategories(selected = '') {
        if (!els.gatherCategory) return;
        const names = [...new Set(state.categories.map(categoryName).filter(Boolean))];
        if (selected && !names.includes(selected)) names.unshift(selected);
        els.gatherCategory.innerHTML = `<option value="">Pilih kategori</option>${names.map((name) =>
            `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
        ).join('')}`;
        els.gatherCategory.value = selected;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        })[char]);
    }

    function sourceLabel(sourceId) {
        return state.sources.find((source) => source.id === sourceId)?.label || sourceId || 'Unknown';
    }

    function ensureGoogleMaps() {
        if (window.google?.maps) return Promise.resolve(window.google.maps);
        if (googleMapsPromise) return googleMapsPromise;
        googleMapsPromise = (async () => {
            const response = await fetch('/api/config', { cache: 'no-store' });
            const config = await response.json().catch(() => ({}));
            if (!response.ok || !config?.googleMapsApiKey) throw new Error('Google Maps belum dikonfigurasi.');
            await new Promise((resolve, reject) => {
                const existing = document.querySelector('script[data-admin-gmaps="true"]');
                if (existing) {
                    if (window.google?.maps) return resolve();
                    existing.addEventListener('load', resolve, { once: true });
                    existing.addEventListener('error', () => reject(new Error('Gagal memuat Google Maps.')), { once: true });
                    return;
                }
                const script = document.createElement('script');
                script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.googleMapsApiKey)}&libraries=places`;
                script.async = true;
                script.defer = true;
                script.dataset.adminGmaps = 'true';
                script.onload = resolve;
                script.onerror = () => reject(new Error('Gagal memuat Google Maps.'));
                document.head.appendChild(script);
            });
            if (!window.google?.maps) throw new Error('Google Maps belum siap.');
            return window.google.maps;
        })().catch((error) => {
            googleMapsPromise = null;
            throw error;
        });
        return googleMapsPromise;
    }

    function validCoordinates(lat, lng) {
        return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180;
    }

    function applyCoordinates(lat, lng, options = {}) {
        if (!validCoordinates(lat, lng)) return;
        if (els.gatherLat) els.gatherLat.value = Number(lat).toFixed(6);
        if (els.gatherLng) els.gatherLng.value = Number(lng).toFixed(6);
        const position = { lat: Number(lat), lng: Number(lng) };
        locationMarker?.setPosition(position);
        locationMarker?.setVisible(true);
        if (options.pan !== false) {
            locationMap?.panTo(position);
            locationMap?.setZoom(Math.max(locationMap.getZoom?.() || 15, 15));
        }
        updateCompleteness(null);
    }

    function syncMapFromFields(options = {}) {
        const lat = Number(els.gatherLat?.value);
        const lng = Number(els.gatherLng?.value);
        if (validCoordinates(lat, lng) && els.gatherLat?.value !== '' && els.gatherLng?.value !== '') {
            applyCoordinates(lat, lng, options);
            return true;
        }
        locationMarker?.setVisible(false);
        return false;
    }

    async function initializeLocationMap() {
        if (!els.gatherLocationMap) return;
        try {
            const maps = await ensureGoogleMaps();
            if (!locationMap) {
                locationMap = new maps.Map(els.gatherLocationMap, {
                    center: DEFAULT_MAP_CENTER,
                    zoom: 5,
                    streetViewControl: false,
                    mapTypeControl: false,
                    fullscreenControl: false
                });
                locationGeocoder = new maps.Geocoder();
                locationMarker = new maps.Marker({ map: locationMap, draggable: true, visible: false });
                locationMap.addListener('click', (event) => applyCoordinates(event.latLng.lat(), event.latLng.lng()));
                locationMarker.addListener('dragend', (event) => applyCoordinates(event.latLng.lat(), event.latLng.lng()));
            }
            maps.event?.trigger(locationMap, 'resize');
            if (!syncMapFromFields()) {
                locationMap.setCenter(DEFAULT_MAP_CENTER);
                locationMap.setZoom(5);
            }
        } catch (error) {
            showMessage('error', error.message);
        }
    }

    async function searchLocation() {
        const query = els.gatherLocationSearchInput?.value.trim() || '';
        if (!query) return showMessage('error', 'Masukkan nama tempat atau alamat terlebih dahulu.');
        try {
            await initializeLocationMap();
            if (!locationGeocoder) throw new Error('Pencarian lokasi belum siap.');
            const results = await new Promise((resolve, reject) => {
                locationGeocoder.geocode({ address: query, region: 'ID' }, (rows, status) => {
                    if (status === 'OK' && rows?.[0]) resolve(rows);
                    else reject(new Error('Lokasi tidak ditemukan. Coba alamat yang lebih lengkap.'));
                });
            });
            const point = results[0].geometry.location;
            applyCoordinates(point.lat(), point.lng());
            showMessage('success', `Lokasi ditemukan: ${results[0].formatted_address || query}`);
        } catch (error) {
            showMessage('error', error.message);
        }
    }

    function missingLabels(draft) {
        const labels = {
            title: 'Title', description: 'Description', category: 'Category', link: 'Link',
            startDate: 'Start Date', endDate: 'End Date', coordinates: 'Coordinates'
        };
        return (draft?.missingFields || []).map((field) => labels[field] || field);
    }

    function renderDrafts() {
        if (!els.gatherDraftList) return;
        const query = (els.gatherDraftSearch?.value || '').trim().toLowerCase();
        const source = els.gatherDraftSourceFilter?.value || '';
        const visible = state.drafts.filter((draft) => {
            if (source && draft.source !== source) return false;
            if (!query) return true;
            return `${draft.title} ${draft.category}`.toLowerCase().includes(query);
        });
        if (els.gatherDraftCount) els.gatherDraftCount.textContent = String(visible.length);
        if (!visible.length) {
            els.gatherDraftList.innerHTML = '<div class="gather-list-empty">Belum ada draft untuk filter ini.</div>';
            return;
        }
        els.gatherDraftList.innerHTML = visible.map((draft) => {
            const missing = missingLabels(draft);
            const readiness = missing.length ? `${missing.length} belum lengkap` : 'Siap publikasi';
            return `<button type="button" class="gather-draft-card${draft.id === state.selectedId ? ' is-active' : ''}" data-draft-id="${escapeHtml(draft.id)}">
                <span class="gather-draft-card__source">${escapeHtml(sourceLabel(draft.source))}</span>
                <strong>${escapeHtml(draft.title || 'Tanpa judul')}</strong>
                <span>${escapeHtml(draft.category || 'Kategori belum diisi')}</span>
                <em class="${missing.length ? 'is-incomplete' : 'is-ready'}">${escapeHtml(readiness)}</em>
            </button>`;
        }).join('');
        els.gatherDraftList.querySelectorAll('[data-draft-id]').forEach((button) => {
            button.addEventListener('click', () => selectDraft(button.dataset.draftId));
        });
    }

    function imageDataUrl(image) {
        if (!image) return '';
        if (typeof image === 'string') return image;
        if (image.dataUrl) return image.dataUrl;
        if (image.data) return image.data.startsWith('data:') ? image.data : `data:${image.contentType || 'image/jpeg'};base64,${image.data}`;
        return '';
    }

    function renderImages(draft) {
        if (!els.gatherImageList) return;
        const images = Array.isArray(draft?.images) ? draft.images : [];
        els.gatherImageList.innerHTML = images.map((image, index) => `<figure class="gather-image">
            <img src="${escapeHtml(imageDataUrl(image))}" alt="Foto pendukung ${index + 1}">
            <button type="button" data-remove-image="${index}" aria-label="Hapus foto ${index + 1}">×</button>
        </figure>`).join('');
        els.gatherImageList.querySelectorAll('[data-remove-image]').forEach((button) => {
            button.addEventListener('click', () => {
                const current = selectedDraft();
                if (!current) return;
                current.images.splice(Number(button.dataset.removeImage), 1);
                renderImages(current);
            });
        });
        if (els.gatherImageInput) els.gatherImageInput.disabled = images.length >= MAX_IMAGES;
    }

    function selectedDraft() {
        return state.drafts.find((draft) => draft.id === state.selectedId) || null;
    }

    function selectDraft(id) {
        state.selectedId = id;
        const draft = selectedDraft();
        if (!draft) return clearEditor();
        els.gatherReviewGrid?.classList.remove('is-editor-empty');
        els.gatherDraftForm?.classList.remove('hidden');
        els.gatherEditorSource.textContent = sourceLabel(draft.source);
        els.gatherEditorTitle.textContent = draft.title || 'Edit draft';
        els.gatherTitle.value = draft.title || '';
        els.gatherDescription.value = draft.description || '';
        populateCategories(draft.category || '');
        els.gatherLink.value = draft.link || '';
        els.gatherStartDate.value = draft.startDate || '';
        els.gatherEndDate.value = draft.endDate || '';
        els.gatherLat.value = Number.isFinite(Number(draft.lat)) ? draft.lat : '';
        els.gatherLng.value = Number.isFinite(Number(draft.lng)) ? draft.lng : '';
        updateCompleteness(draft);
        renderImages(draft);
        renderDrafts();
        initializeLocationMap();
    }

    function clearEditor() {
        state.selectedId = '';
        els.gatherReviewGrid?.classList.add('is-editor-empty');
        els.gatherDraftForm?.classList.add('hidden');
        renderDrafts();
    }

    function formPayload() {
        const draft = selectedDraft();
        return {
            title: els.gatherTitle?.value.trim() || '',
            description: els.gatherDescription?.value.trim() || '',
            category: els.gatherCategory?.value.trim() || '',
            link: els.gatherLink?.value.trim() || '',
            startDate: els.gatherStartDate?.value || '',
            endDate: els.gatherEndDate?.value || '',
            lat: els.gatherLat?.value === '' ? null : Number(els.gatherLat.value),
            lng: els.gatherLng?.value === '' ? null : Number(els.gatherLng.value),
            images: draft?.images || []
        };
    }

    function localMissing(payload) {
        const missing = [];
        ['title', 'description', 'category', 'link', 'startDate', 'endDate'].forEach((key) => {
            if (!payload[key]) missing.push(key);
        });
        if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) missing.push('coordinates');
        if (payload.startDate && payload.endDate && payload.endDate < payload.startDate && !missing.includes('endDate')) missing.push('endDate');
        return missing;
    }

    function updateCompleteness(draft) {
        if (!els.gatherCompleteness) return;
        const missing = draft?.missingFields || localMissing(formPayload());
        els.gatherCompleteness.classList.toggle('is-ready', !missing.length);
        els.gatherCompleteness.textContent = missing.length ? `${7 - missing.length}/7 field siap` : '7/7 siap dipublikasikan';
    }

    function setBusy(busy) {
        state.isBusy = busy;
        [els.gatherRunBtn, els.gatherSaveBtn, els.gatherPublishBtn, els.gatherDeleteBtn].forEach((button) => {
            if (button) button.disabled = busy || (button === els.gatherRunBtn && !state.configured);
        });
    }

    async function loadSources() {
        const data = await api('/api/admin/gather/sources');
        state.sources = Array.isArray(data.sources) ? data.sources : [];
        populateSources();
        setServiceStatus(Boolean(data.configured));
    }

    async function loadCategories() {
        const data = await api('/api/categories');
        state.categories = Array.isArray(data?.categories) ? data.categories : (Array.isArray(data) ? data : []);
        populateCategories(selectedDraft()?.category || '');
    }

    async function loadDrafts(options = {}) {
        const data = await api('/api/admin/gather/drafts');
        state.drafts = Array.isArray(data.drafts) ? data.drafts : [];
        const selectedStillExists = state.drafts.some((draft) => draft.id === state.selectedId);
        renderDrafts();
        if (selectedStillExists) selectDraft(state.selectedId);
        else if (options.selectFirst && state.drafts.length) selectDraft(state.drafts[0].id);
        else clearEditor();
    }

    function renderRun(run) {
        state.activeRun = run || null;
        if (!run) return;
        const status = run.status || 'READY';
        const running = !TERMINAL.has(status);
        els.gatherRunSummary.textContent = running
            ? `${sourceLabel(run.source)} sedang berjalan di layanan eksternal (${status}).`
            : `${sourceLabel(run.source)} selesai dengan status ${status}.`;
        els.gatherProgressBar.style.width = status === 'SUCCEEDED' ? '100%' : (running ? '64%' : '100%');
        els.gatherProgressBar.classList.toggle('is-running', running);
        els.gatherRunMetrics.innerHTML = [
            ['Hasil', run.itemCount || 0], ['Draft baru', run.draftCount || 0],
            ['Sudah dikenal', run.excludedItemCount || 0], ['Duplikat hasil', run.duplicateCount || 0],
            ['Perlu dilengkapi', run.invalidCount || 0]
        ].map(([label, value]) => `<span><strong>${value}</strong>${label}</span>`).join('');
        if (run.error) showMessage('error', run.error);
    }

    async function loadLatestRun() {
        const data = await api('/api/admin/gather/runs');
        const run = Array.isArray(data.runs) ? data.runs[0] : null;
        if (run) {
            renderRun(run);
            if (!TERMINAL.has(run.status) || (run.status === 'SUCCEEDED' && !run.draftCount && !run.itemCount)) pollRun(run.id);
        }
    }

    async function startRun() {
        if (state.isBusy || !state.configured) return;
        const source = els.gatherSourceSelect?.value || '';
        const limit = Number(els.gatherLimit?.value) || 50;
        setBusy(true);
        showMessage(null, '');
        try {
            const data = await api('/api/admin/gather/runs', {
                method: 'POST', body: JSON.stringify({ source, limit })
            });
            renderRun(data.run);
            showMessage('success', 'Scraper dimulai. Halaman ini akan memeriksa hasil secara otomatis.');
            pollRun(data.run.id);
        } catch (error) {
            showMessage('error', error.message);
        } finally {
            setBusy(false);
        }
    }

    function pollRun(id) {
        clearTimeout(state.pollTimer);
        const tick = async () => {
            try {
                const data = await api(`/api/admin/gather/runs/${id}`);
                renderRun(data.run);
                if (data.run.status === 'SUCCEEDED') {
                    await loadDrafts({ selectFirst: true });
                    showMessage('success', `${data.run.draftCount} draft baru siap diperiksa.`);
                    return;
                }
                if (TERMINAL.has(data.run.status)) return;
            } catch (error) {
                showMessage('error', error.message);
                return;
            }
            state.pollTimer = setTimeout(tick, 5000);
        };
        tick();
    }

    async function saveDraft(options = {}) {
        const draft = selectedDraft();
        if (!draft || state.isBusy) return null;
        setBusy(true);
        try {
            const data = await api(`/api/admin/gather/drafts/${draft.id}`, {
                method: 'PUT', body: JSON.stringify(formPayload())
            });
            const index = state.drafts.findIndex((item) => item.id === draft.id);
            if (index !== -1) state.drafts[index] = data.draft;
            selectDraft(draft.id);
            if (!options.silent) showMessage('success', 'Draft disimpan.');
            return data.draft;
        } catch (error) {
            showMessage('error', error.message);
            return null;
        } finally {
            setBusy(false);
        }
    }

    async function publishDraft() {
        const draft = selectedDraft();
        if (!draft || state.isBusy) return;
        const payload = formPayload();
        const missing = localMissing(payload);
        if (missing.length) {
            showMessage('error', `Lengkapi field wajib: ${missing.join(', ')}.`);
            updateCompleteness({ missingFields: missing });
            return;
        }
        const saved = await saveDraft({ silent: true });
        if (!saved) return;
        setBusy(true);
        try {
            await api(`/api/admin/gather/drafts/${saved.id}/publish`, { method: 'POST' });
            state.drafts = state.drafts.filter((item) => item.id !== saved.id);
            clearEditor();
            showMessage('success', 'Pin berhasil dipublikasikan ke peta AyaNaon.');
        } catch (error) {
            showMessage('error', error.message);
        } finally {
            setBusy(false);
        }
    }

    async function deleteDraft() {
        const draft = selectedDraft();
        if (!draft || state.isBusy) return;
        if (!window.confirm(`Hapus draft "${draft.title || 'Tanpa judul'}"?`)) return;
        setBusy(true);
        try {
            await api(`/api/admin/gather/drafts/${draft.id}`, { method: 'DELETE' });
            state.drafts = state.drafts.filter((item) => item.id !== draft.id);
            clearEditor();
            showMessage('success', 'Draft dihapus.');
        } catch (error) {
            showMessage('error', error.message);
        } finally {
            setBusy(false);
        }
    }

    function readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error(`Gagal membaca ${file.name}.`));
            reader.readAsDataURL(file);
        });
    }

    async function addImages(event) {
        const draft = selectedDraft();
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        if (!draft || !files.length) return;
        const available = MAX_IMAGES - (draft.images?.length || 0);
        if (files.length > available) return showMessage('error', `Hanya ${available} slot foto tersisa.`);
        if (files.some((file) => file.size > MAX_IMAGE_BYTES)) return showMessage('error', 'Setiap foto maksimal 4MB.');
        try {
            const images = await Promise.all(files.map(async (file) => ({
                dataUrl: await readFile(file), contentType: file.type || 'image/jpeg', size: file.size, originalName: file.name
            })));
            draft.images = [...(draft.images || []), ...images];
            renderImages(draft);
        } catch (error) {
            showMessage('error', error.message);
        }
    }

    function bindEvents() {
        els.gatherRunBtn?.addEventListener('click', startRun);
        els.gatherRefreshBtn?.addEventListener('click', () => loadDrafts({ selectFirst: false }).catch((error) => showMessage('error', error.message)));
        els.gatherDraftSearch?.addEventListener('input', renderDrafts);
        els.gatherDraftSourceFilter?.addEventListener('change', renderDrafts);
        els.gatherDraftForm?.addEventListener('submit', (event) => {
            event.preventDefault();
            saveDraft();
        });
        els.gatherPublishBtn?.addEventListener('click', publishDraft);
        els.gatherDeleteBtn?.addEventListener('click', deleteDraft);
        els.gatherImageInput?.addEventListener('change', addImages);
        els.gatherLocationSearchBtn?.addEventListener('click', searchLocation);
        els.gatherLocationSearchInput?.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            searchLocation();
        });
        [els.gatherLat, els.gatherLng].forEach((input) => input?.addEventListener('change', () => syncMapFromFields()));
        [els.gatherTitle, els.gatherDescription, els.gatherCategory, els.gatherLink, els.gatherStartDate, els.gatherEndDate, els.gatherLat, els.gatherLng]
            .forEach((input) => input?.addEventListener('input', () => updateCompleteness(null)));
    }

    async function initialize() {
        if (state.initialized) return;
        state.initialized = true;
        cacheElements();
        bindEvents();
        try {
            await Promise.all([loadSources(), loadCategories(), loadDrafts({ selectFirst: false }), loadLatestRun()]);
        } catch (error) {
            setServiceStatus(false);
            showMessage('error', error.message);
        }
    }

    document.addEventListener('ayanaon:gather-visible', initialize);
    if (!document.getElementById('admin-gather-pane')?.classList.contains('hidden')) initialize();
})();

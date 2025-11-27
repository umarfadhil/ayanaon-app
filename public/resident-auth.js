(function () {
    const RESIDENT_MAX_PHOTO_BYTES = 1024 * 1024;

    function getQueryParams() {
        const params = {};
        try {
            const searchParams = new URLSearchParams(window.location.search || '');
            searchParams.forEach((value, key) => {
                params[key] = value;
            });
        } catch (error) {
            console.warn('ResidentAuth: gagal membaca parameter URL', error);
        }
        return params;
    }

    function showMessage(element, type, text) {
        if (!element) {
            return;
        }
        element.textContent = text || '';
        element.classList.remove('form-message--success', 'form-message--error');
        if (!text) {
            element.classList.add('form-message--hidden');
            return;
        }
        element.classList.remove('form-message--hidden');
        if (type === 'success') {
            element.classList.add('form-message--success');
        } else if (type === 'error') {
            element.classList.add('form-message--error');
        }
    }

    function ensureSubmitState(button, isLoading, loadingText) {
        if (!button) {
            return;
        }
        if (isLoading) {
            button.dataset.originalText = button.textContent;
            button.textContent = loadingText || 'Memproses...';
            button.disabled = true;
        } else {
            if (button.dataset.originalText) {
                button.textContent = button.dataset.originalText;
                delete button.dataset.originalText;
            }
            button.disabled = false;
        }
    }

    function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            if (!file) {
                reject(new Error('File tidak ditemukan.'));
                return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Tidak dapat membaca file.'));
            reader.readAsDataURL(file);
        });
    }

    function updatePhotoPreview(previewElement, dataUrl) {
        if (!previewElement) {
            return;
        }
        const imageElement = previewElement.querySelector('.auth-photo-preview__image');
        const placeholderElement = previewElement.querySelector('.auth-photo-preview__placeholder');
        if (dataUrl) {
            if (imageElement) {
                if (imageElement.src !== dataUrl) {
                    imageElement.src = dataUrl;
                }
            }
            if (placeholderElement) {
                placeholderElement.setAttribute('aria-hidden', 'true');
            }
            previewElement.dataset.hasImage = 'true';
        } else {
            if (imageElement && imageElement.getAttribute('src')) {
                imageElement.removeAttribute('src');
            }
            if (placeholderElement) {
                placeholderElement.removeAttribute('aria-hidden');
            }
            delete previewElement.dataset.hasImage;
        }
    }

    function ensureResidentAPI() {
        if (typeof window.ResidentSession === 'undefined') {
            throw new Error('Fitur warga belum siap. Muat ulang halaman dan coba lagi.');
        }
        return ResidentSession;
    }

    function initResidentRegisterForm(form) {
        const messageEl = document.getElementById('form-message');
        const submitBtn = form.querySelector('button[type="submit"]');
        const params = getQueryParams();
        const usernameInput = form.querySelector('#resident-register-username');
        const photoInput = form.querySelector('#resident-register-photo');
        const photoPreview = document.getElementById('resident-register-photo-preview');
        let cachedPhotoDataUrl = null;
        if (params.username && usernameInput && !usernameInput.value) {
            usernameInput.value = params.username;
        }

        if (photoInput) {
            photoInput.addEventListener('change', async () => {
                cachedPhotoDataUrl = null;
                if (!photoInput.files || !photoInput.files[0]) {
                    updatePhotoPreview(photoPreview, null);
                    return;
                }
                const file = photoInput.files[0];
                if (file.size > RESIDENT_MAX_PHOTO_BYTES) {
                    showMessage(messageEl, 'error', 'Foto maksimal 1MB.');
                    photoInput.value = '';
                    updatePhotoPreview(photoPreview, null);
                    return;
                }
                try {
                    const dataUrl = await fileToDataUrl(file);
                    cachedPhotoDataUrl = dataUrl;
                    updatePhotoPreview(photoPreview, dataUrl);
                    showMessage(messageEl, null, '');
                } catch (error) {
                    showMessage(messageEl, 'error', 'Tidak dapat membaca foto profil.');
                    photoInput.value = '';
                    updatePhotoPreview(photoPreview, null);
                }
            });
        }

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = new FormData(form);
            const displayName = String(formData.get('displayName') || '').trim();
            const username = String(formData.get('username') || '').trim();
            const password = String(formData.get('password') || '');
            const confirmPassword = String(formData.get('confirmPassword') || '');

            if (!username || !password) {
                showMessage(messageEl, 'error', 'Isi username dan password kamu.');
                return;
            }
            if (password.length < 4) {
                showMessage(messageEl, 'error', 'Password wajib minimal 4 karakter.');
                return;
            }
            if (password !== confirmPassword) {
                showMessage(messageEl, 'error', 'Konfirmasi password belum cocok.');
                return;
            }

            let photoDataUrl = cachedPhotoDataUrl;
            const photoFile = photoInput?.files?.[0] || null;
            if (photoFile) {
                if (photoFile.size > RESIDENT_MAX_PHOTO_BYTES) {
                    showMessage(messageEl, 'error', 'Foto maksimal 1MB.');
                    return;
                }
                if (!photoDataUrl) {
                    try {
                        photoDataUrl = await fileToDataUrl(photoFile);
                        cachedPhotoDataUrl = photoDataUrl;
                        updatePhotoPreview(photoPreview, photoDataUrl);
                    } catch (error) {
                        showMessage(messageEl, 'error', 'Tidak dapat membaca foto profil.');
                        return;
                    }
                }
            }

            ensureSubmitState(submitBtn, true, 'Mendaftarkan...');
            try {
                const api = ensureResidentAPI();
                const resident = await api.registerResident({
                    username,
                    password,
                    displayName,
                    photo: photoDataUrl || undefined
                });
                const name = resident?.displayName || resident?.username || 'Warga Hebat';
                showMessage(messageEl, 'success', `Halo ${name}! Akun warga kamu siap dipakai.`);
                setTimeout(() => {
                    window.location.replace('index.html');
                }, 900);
            } catch (error) {
                showMessage(messageEl, 'error', error.message || 'Registrasi warga gagal. Coba lagi.');
            } finally {
                ensureSubmitState(submitBtn, false);
            }
        });
    }

    function initResidentLoginForm(form) {
        const messageEl = document.getElementById('form-message');
        const submitBtn = form.querySelector('button[type="submit"]');
        const params = getQueryParams();
        const usernameInput = form.querySelector('#resident-login-username');

        if (params.username && usernameInput && !usernameInput.value) {
            usernameInput.value = params.username;
        }

        try {
            const api = ensureResidentAPI();
            if (typeof api.isLoggedIn === 'function' && api.isLoggedIn()) {
                const resident = typeof api.getCurrentResident === 'function' ? api.getCurrentResident() : null;
                const name = resident?.displayName || resident?.username || 'warga';
                const isAdmin = typeof api.isAdmin === 'function' && api.isAdmin();
                const target = isAdmin ? 'admin.html' : 'index.html';
                const suffix = isAdmin ? ' Mengarahkan ke dashboard admin...' : '';
                showMessage(messageEl, 'success', `Kamu sudah login sebagai ${name}.${suffix}`);
                if (isAdmin) {
                    setTimeout(() => {
                        window.location.replace(target);
                    }, 700);
                }
            }
        } catch (error) {
            // if ResidentSession not available we'll handle when submitting
        }

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const username = String(form.querySelector('#resident-login-username')?.value || '').trim();
            const password = String(form.querySelector('#resident-login-password')?.value || '');
            if (!username || !password) {
                showMessage(messageEl, 'error', 'Isi username dan password kamu.');
                return;
            }
            ensureSubmitState(submitBtn, true, 'Mengautentikasi...');
            try {
                const api = ensureResidentAPI();
                const resident = await api.loginResident({ username, password });
                const usernameLower = username.toLowerCase();
                const isAdmin = Boolean(resident?.isAdmin || resident?.role === 'admin' || usernameLower === 'admin');
                const target = isAdmin ? 'admin.html' : 'index.html';
                const message = isAdmin
                    ? 'Login admin berhasil. Membuka dashboard...'
                    : 'Login berhasil. Mengarahkan ke peta...';
                showMessage(messageEl, 'success', message);
                setTimeout(() => {
                    window.location.replace(target);
                }, 900);
            } catch (error) {
                showMessage(messageEl, 'error', error.message || 'Gagal masuk. Silakan coba lagi.');
            } finally {
                ensureSubmitState(submitBtn, false);
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        const registerForm = document.getElementById('resident-register-form');
        if (registerForm) {
            try {
                initResidentRegisterForm(registerForm);
            } catch (error) {
                console.warn('ResidentAuth: registrasi tidak aktif', error);
            }
        }

        const loginForm = document.getElementById('resident-login-form');
        if (loginForm) {
            try {
                initResidentLoginForm(loginForm);
            } catch (error) {
                console.warn('ResidentAuth: login tidak aktif', error);
            }
        }
    });
})();

(function () {
    const STORAGE_KEY = 'ayanaon_seller_session';
    const listeners = new Set();
    let currentSession = loadSession();

    function loadSession() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                return null;
            }
            return {
                token: typeof parsed.token === 'string' ? parsed.token : '',
                seller: parsed.seller || null
            };
        } catch (error) {
            console.warn('Unable to load seller session from storage', error);
            return null;
        }
    }

    function persistSession(session) {
        try {
            if (!session) {
                localStorage.removeItem(STORAGE_KEY);
                return;
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        } catch (error) {
            console.warn('Unable to persist seller session', error);
        }
    }

    function getState() {
        const token = currentSession?.token || '';
        const seller = currentSession?.seller || null;
        return { token, seller, isLoggedIn: Boolean(token) };
    }

    function notifyListeners() {
        const state = getState();
        listeners.forEach((listener) => {
            try {
                listener(state);
            } catch (error) {
                console.warn('SellerSession listener error', error);
            }
        });
    }

    function setSession(session) {
        if (!session || !session.token) {
            currentSession = null;
            persistSession(null);
            notifyListeners();
            return;
        }
        currentSession = {
            token: session.token,
            seller: session.seller || null
        };
        persistSession(currentSession);
        notifyListeners();
    }

    function clearSession() {
        currentSession = null;
        persistSession(null);
        notifyListeners();
    }

    function updateSeller(partial) {
        if (!currentSession) {
            return;
        }
        currentSession = {
            token: currentSession.token,
            seller: {
                ...(currentSession.seller || {}),
                ...(partial || {})
            }
        };
        persistSession(currentSession);
        notifyListeners();
    }

    async function refreshProfile() {
        const token = getToken();
        if (!token) {
            return null;
        }
        try {
            const response = await fetch('/api/sellers/me', {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });
            if (!response.ok) {
                if (response.status === 401) {
                    clearSession();
                }
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.message || 'Gagal memuat profil.');
            }
            const payload = await response.json();
            if (payload?.seller) {
                setSession({ token, seller: payload.seller });
            }
            return payload?.seller || null;
        } catch (error) {
            console.warn('Tidak dapat memuat profil penjual', error);
            throw error;
        }
    }

    function getToken() {
        return currentSession?.token || '';
    }

    function getSeller() {
        return currentSession?.seller || null;
    }

    function isLoggedIn() {
        return Boolean(getToken());
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') {
            return () => undefined;
        }
        listeners.add(listener);
        try {
            listener(getState());
        } catch (error) {
            console.warn('SellerSession immediate listener error', error);
        }
        return () => {
            listeners.delete(listener);
        };
    }

    window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY) {
            currentSession = loadSession();
            notifyListeners();
        }
    });

    const SellerSession = {
        setSession,
        clearSession,
        updateSeller,
        refreshProfile,
        getToken,
        getSeller,
        isLoggedIn,
        subscribe
    };

    window.SellerSession = SellerSession;

    function getQueryParams() {
        const params = {};
        try {
            const searchParams = new URLSearchParams(window.location.search || '');
            searchParams.forEach((value, key) => {
                params[key] = value;
            });
        } catch (error) {
            console.warn('Failed to parse query params', error);
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
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Gagal membaca file foto.'));
            reader.readAsDataURL(file);
        });
    }

    function initRegisterForm(form) {
        const messageEl = document.getElementById('form-message');
        const submitBtn = form.querySelector('button[type="submit"]');
        const params = getQueryParams();
        const usernameInput = form.querySelector('#register-username');
        if (params.username && usernameInput && !usernameInput.value) {
            usernameInput.value = params.username;
        }

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = new FormData(form);
            const payload = {
                username: String(formData.get('username') || '').trim(),
                password: String(formData.get('password') || ''),
                nama: String(formData.get('nama') || '').trim(),
                merk: String(formData.get('merk') || '').trim(),
                deskripsi: String(formData.get('deskripsi') || '').trim(),
                phoneNumber: String(formData.get('phone') || '').trim(),
                consent: Boolean(form.querySelector('#register-consent')?.checked)
            };

            if (!payload.username || !payload.password || !payload.nama || !payload.merk || !payload.deskripsi || !payload.phoneNumber) {
                showMessage(messageEl, 'error', 'Semua kolom wajib diisi.');
                return;
            }
            if (!payload.consent) {
                showMessage(messageEl, 'error', 'Silakan centang persetujuan terlebih dahulu.');
                return;
            }

            const photoInput = form.querySelector('#register-photo');
            if (!photoInput || !photoInput.files || !photoInput.files[0]) {
                showMessage(messageEl, 'error', 'Foto gerobak/jualan wajib diunggah.');
                return;
            }
            const photoFile = photoInput.files[0];
            if (photoFile.size > 1024 * 1024) {
                showMessage(messageEl, 'error', 'Ukuran foto melebihi 1MB. Silakan kompres terlebih dahulu.');
                return;
            }

            showMessage(messageEl, null, 'Mengirim data pendaftaran...');
            ensureSubmitState(submitBtn, true, 'Mendaftarkan...');

            try {
                const photoDataUrl = await fileToDataUrl(photoFile);
                payload.photo = photoDataUrl;
                const response = await fetch('/api/register-seller', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(result.message || 'Gagal mendaftarkan Gerobak Online.');
                }
                const successMessage = result.message || 'Registrasi berhasil. Kamu siap tampil sebagai Gerobak Online.';
                showMessage(messageEl, 'success', successMessage);
                setTimeout(() => {
                    window.location.href = `login.html?username=${encodeURIComponent(payload.username)}`;
                }, 1800);
            } catch (error) {
                showMessage(messageEl, 'error', error.message || 'Gagal mendaftarkan Gerobak Online.');
            } finally {
                ensureSubmitState(submitBtn, false);
            }
        });
    }

    function initVerifyForm(form) {
        const messageEl = document.getElementById('form-message');
        const submitBtn = form.querySelector('button[type="submit"]');
        const params = getQueryParams();
        const usernameInput = form.querySelector('#verify-username');
        if (params.username && usernameInput && !usernameInput.value) {
            usernameInput.value = params.username;
        }

        showMessage(messageEl, 'success', 'Gerobak Online kamu sudah aktif. Tidak perlu memasukkan kode verifikasi.');

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const username = String(form.querySelector('#verify-username')?.value || '').trim();
            setTimeout(() => {
                const target = username ? `login.html?username=${encodeURIComponent(username)}` : 'login.html';
                window.location.href = target;
            }, 400);
        });
    }

    function initLoginForm(form) {
        const messageEl = document.getElementById('form-message');
        const submitBtn = form.querySelector('button[type="submit"]');
        const params = getQueryParams();
        const usernameInput = form.querySelector('#login-username');
        if (params.username && usernameInput && !usernameInput.value) {
            usernameInput.value = params.username;
        }

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const username = String(form.querySelector('#login-username')?.value || '').trim();
            const password = String(form.querySelector('#login-password')?.value || '');
            if (!username || !password) {
                showMessage(messageEl, 'error', 'Isi username dan password kamu.');
                return;
            }
            showMessage(messageEl, null, 'Sedang masuk...');
            ensureSubmitState(submitBtn, true, 'Mengautentikasi...');
            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username, password })
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(result.message || 'Gagal masuk. Periksa ulang data kamu.');
                }
                SellerSession.setSession({ token: result.token, seller: result.seller });
                showMessage(messageEl, 'success', 'Login berhasil. Mengarahkan ke peta...');
                setTimeout(() => {
                    window.location.replace('index.html');
                }, 800);
            } catch (error) {
                showMessage(messageEl, 'error', error.message || 'Gagal masuk. Silakan coba lagi.');
            } finally {
                ensureSubmitState(submitBtn, false);
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        const registerForm = document.getElementById('register-form');
        if (registerForm) {
            initRegisterForm(registerForm);
        }
        const verifyForm = document.getElementById('verify-form');
        if (verifyForm) {
            initVerifyForm(verifyForm);
        }
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            initLoginForm(loginForm);
        }
    });
})();

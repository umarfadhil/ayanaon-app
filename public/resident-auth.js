(function () {
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
        if (params.username && usernameInput && !usernameInput.value) {
            usernameInput.value = params.username;
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

            ensureSubmitState(submitBtn, true, 'Mendaftarkan...');
            try {
                const api = ensureResidentAPI();
                const resident = await api.registerResident({ username, password, displayName });
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
                showMessage(messageEl, 'success', `Kamu sudah login sebagai ${name}.`);
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
                await api.loginResident({ username, password });
                showMessage(messageEl, 'success', 'Login berhasil. Mengarahkan ke peta...');
                setTimeout(() => {
                    window.location.replace('index.html');
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

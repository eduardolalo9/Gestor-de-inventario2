/**
 * js/auth.js — v3.2
 * ══════════════════════════════════════════════════════════════
 * Autenticación Firebase Email/Password con control de roles.
 *
 * FIX BUG-1 (CRÍTICO — app nunca arrancaba):
 * ──────────────────────────────────────────────────────────────
 * PROBLEMA:
 *   _handleLogin() recreaba _authReady = new Promise() EN CADA
 *   llamada, incluyendo el PRIMER login.
 *
 *   Secuencia rota:
 *     1. Módulo carga → P1 creada
 *     2. DOMContentLoaded → app.js: onAuthReady.then(cb) → cb en P1
 *     3. Firebase dispara onAuthStateChanged (async, DESPUÉS del sync)
 *     4. _handleLogin() → _authReady = P2  ← P1 queda huérfana
 *     5. _authResolve(user) → resuelve P2
 *     6. cb de app.js (registrado en P1) NUNCA dispara
 *     → app se queda en "Verificando sesión…" para siempre
 *
 *  CORRECCIÓN BUG-1:
 *   Solo recrear _authReady cuando hay CAMBIO DE USUARIO
 *   (es decir, cuando _lastAuthUid ya tenía un valor diferente).
 *   En el PRIMER LOGIN (_lastAuthUid era null), no recrear P1.
 *   app.js ya tiene .then() sobre P1 → recibirá el resolve.
 *
 * FIX BUG-2 (CRÍTICO — re-login post-logout nunca notificaba a app.js):
 * ──────────────────────────────────────────────────────────────
 * PROBLEMA:
 *   _handleLogout() creaba una nueva Promise (P_logout) y la resolvía
 *   INMEDIATAMENTE con null:
 *     _authReady  = new Promise(resolve => { _authResolve = resolve; });
 *     _authResolve(null);   ← P_logout queda resuelta en el acto
 *
 *   En el siguiente login, _handleLogin encontraba _lastAuthUid === null
 *   y NO recreaba la Promise (condición correcta para el primer login).
 *   Llamaba _authResolve(user) sobre P_logout, que ya estaba resuelta
 *   → no-op. app.js nunca recibía el usuario → sin loadFromLocalStorage(),
 *   sin switchTab(), sin syncStockByAreaFromConteo() en el re-login.
 *   La UI mostraba el usuario autenticado pero la app funcionaba
 *   como si estuviera vacía.
 *
 * CORRECCIÓN BUG-2:
 *   _handleLogout() crea la nueva Promise pero NO la resuelve.
 *   La deja pendiente para que el siguiente _handleLogin la resuelva
 *   con el usuario real. app.js detecta el cambio de referencia
 *   (P1 → P_logout) vía _listenForNextLogin() y espera sobre la
 *   Promise pendiente hasta que el usuario haga login.
 *
 * Resto de correcciones (v2.2):
 * • Guard _authChangeInProgress evita eventos dobles de Firebase
 * • Timeout de 15s en initRoles como seguridad
 * • Guard contra cambio de usuario durante initRoles en progreso
 * ══════════════════════════════════════════════════════════════
 */

import { initRoles, cleanupRoles } from './auth-roles.js';

const $id = id => document.getElementById(id);

// ── Promise inicial — app.js hace .then() sobre esta ─────────
// CRÍTICO: No recrear esta Promise en el primer login.
// En logout, se recrea pero se deja PENDIENTE (no resolver con null).
let _authResolve;
let _authReady = new Promise(resolve => { _authResolve = resolve; });

export function getAuthReady() { return _authReady; }
export { _authReady as onAuthReady };

// ── Sistema de eventos de cambio de auth ──────────────────────
// Fase-3: Reemplaza el polling setInterval de 300ms en app.js.
// app.js registra _waitForUser una sola vez con onAuthChange().
// Cada vez que _authReady cambia (logout/re-login), todos los
// callbacks registrados son notificados directamente, sin polling.
const _authChangeListeners = [];

/**
 * Registra un callback que se ejecuta cada vez que la Promise
 * de auth cambia (es decir, en cada nuevo ciclo de login).
 * @param {function} cb — se llama sin argumentos
 */
export function onAuthChange(cb) {
    if (typeof cb === 'function' && !_authChangeListeners.includes(cb)) {
        _authChangeListeners.push(cb);
    }
}

function _notifyAuthChange() {
    _authChangeListeners.forEach(cb => {
        try { cb(); } catch (e) { console.error('[Auth] Error en onAuthChange listener:', e); }
    });
}

const INIT_TIMEOUT = 15000;

let _authChangeInProgress = false;
let _lastAuthUid = null;

// ─── Pantallas ─────────────────────────────────────────────────

function showLogin() {
    $id('authLoadingScreen')?.classList.add('auth-hidden');
    $id('loginScreen')?.classList.remove('auth-hidden');
    $id('appWrapper')?.classList.remove('auth-visible');
    console.info('[Auth] Mostrando pantalla de login.');
}

function showApp(user) {
    $id('authLoadingScreen')?.classList.add('auth-hidden');
    $id('loginScreen')?.classList.add('auth-hidden');
    $id('appWrapper')?.classList.add('auth-visible');
    console.info('[Auth] ✓ Usuario autenticado:', user?.email || 'N/A');
}

function showAuthLoading() {
    $id('authLoadingScreen')?.classList.remove('auth-hidden');
    $id('loginScreen')?.classList.add('auth-hidden');
    $id('appWrapper')?.classList.remove('auth-visible');
}

function showAuthError(message) {
    $id('authLoadingScreen')?.classList.add('auth-hidden');
    $id('loginScreen')?.classList.remove('auth-hidden');
    $id('appWrapper')?.classList.remove('auth-visible');
    const errEl = $id('loginError');
    if (errEl) { errEl.textContent = message; errEl.classList.add('visible'); }
    console.error('[Auth]', message);
}

// ═════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═════════════════════════════════════════════════════════════

export function initAuth() {
    // FIX BUG-FIREBASE-2: En lugar de fallar inmediatamente cuando _auth === null,
    // se espera hasta 2 segundos antes de declarar error.
    //
    // PROBLEMA ANTERIOR:
    //   initAuth() comprobaba window._auth en el instante de su llamada.
    //   En PWA con red lenta, los scripts del SDK de Firebase (cargados desde
    //   gstatic.com CDN) pueden llegar con 200-800ms de retraso. En ese
    //   momento initAuth() ya había corrido y encontrado _auth === null,
    //   mostrando "Firebase Auth no está disponible" aunque Firebase iba a
    //   inicializarse correctamente unos milisegundos después.
    //
    // SOLUCIÓN: si _auth no está disponible, se reintenta cada 200ms hasta
    //   un máximo de 2 segundos. Si al cabo de 2s sigue sin estar disponible,
    //   entonces SÍ es un error real (CDN bloqueado, sin internet, etc.) y se
    //   muestra el mensaje de error con instrucción de recarga.
    if (!window._auth) {
        const _retryStart = Date.now();
        const _retryInterval = setInterval(() => {
            if (window._auth) {
                // SDK disponible — inicializar normalmente
                clearInterval(_retryInterval);
                console.info('[Auth] Firebase Auth disponible tras espera de',
                    (Date.now() - _retryStart), 'ms.');
                _startAuthListener();
            } else if (Date.now() - _retryStart > 2000) {
                // Pasaron 2s y sigue sin haber Auth → error real
                clearInterval(_retryInterval);
                console.error('[Auth] Firebase Auth no disponible después de 2s.');
                showAuthError(
                    `⚠️ Error de conexión: Firebase no está disponible.
Verifica tu internet y recarga la página.`
                );
                _authResolve(null);
            }
        }, 200);
        return;
    }

    _startAuthListener();
}

// ── Listener real de Auth — extraído para poder llamarlo desde el retry ──
function _startAuthListener() {
    window._auth.onAuthStateChanged(async function (user) {
        if (_authChangeInProgress) {
            await new Promise(r => {
                const check = setInterval(() => {
                    if (!_authChangeInProgress) { clearInterval(check); r(); }
                }, 100);
                setTimeout(() => { clearInterval(check); r(); }, 10000);
            });
        }

        _authChangeInProgress = true;
        try {
            if (user) { await _handleLogin(user); }
            else       { _handleLogout(); }
        } catch (err) {
            console.error('[Auth] Error en onAuthStateChanged:', err);
            showLogin();
            _authResolve(null);
        } finally {
            _authChangeInProgress = false;
        }
    });
}

// ─── Handler de LOGIN ──────────────────────────────────────────

async function _handleLogin(user) {
    if (_lastAuthUid === user.uid) {
        console.debug('[Auth] Mismo usuario, ignorando re-trigger.');
        return;
    }

    // Cambio de usuario (uid A → uid B): limpiar sesión anterior Y recrear Promise.
    // Esto cubre el caso admin → otro admin o admin → usuario sin logout intermedio.
    if (_lastAuthUid !== null && _lastAuthUid !== user.uid) {
        console.info('[Auth] Cambio de usuario — limpiando sesión anterior.');
        cleanupRoles();
        _authReady = new Promise(resolve => { _authResolve = resolve; });
        // Notificar a app.js que hay una nueva Promise de auth disponible
        _notifyAuthChange();
    }

    // Si _lastAuthUid === null:
    //   • Primer login:        _authReady es P1 (original), _authResolve apunta a resolve_P1.
    //   • Re-login post-logout: _authReady es P_logout (creada en _handleLogout, pendiente),
    //                           _authResolve apunta a resolve_P_logout.
    //   En ambos casos NO recreamos — usamos la Promise pendiente que ya existe.
    //   _authResolve(user) resolverá la Promise correcta en cualquiera de los dos casos.

    _lastAuthUid = user.uid;
    showAuthLoading();

    try {
        const role = await Promise.race([
            initRoles(user),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('TIMEOUT')), INIT_TIMEOUT)
            )
        ]);

        if (_lastAuthUid !== user.uid) {
            console.warn('[Auth] Usuario cambió durante initRoles — abortando.');
            return;
        }

        console.info(`[Auth] Rol confirmado: ${role}`);
        showApp(user);
        _authResolve(user);

    } catch (err) {
        if (_lastAuthUid !== user.uid) {
            console.warn('[Auth] Usuario cambió durante initRoles (error path).');
            return;
        }
        if (err.message === 'TIMEOUT') {
            console.error('[Auth] Timeout en initRoles — app con rol por defecto.');
        } else {
            console.error('[Auth] Error en initRoles:', err);
        }
        showApp(user);
        _authResolve(user);
    }
}

// ─── Handler de LOGOUT ─────────────────────────────────────────

function _handleLogout() {
    const prevUid = _lastAuthUid;
    _lastAuthUid = null;

    cleanupRoles();
    showLogin();

    // FIX BUG-2: Crear nueva Promise pendiente para el próximo login.
    //
    // ❌ ANTES (roto):
    //   _authReady = new Promise(resolve => { _authResolve = resolve; });
    //   _authResolve(null);   ← resolvía P_logout inmediatamente
    //
    //   Consecuencia: en el siguiente _handleLogin, _lastAuthUid era null
    //   → no se recreaba la Promise → _authResolve(user) era un no-op
    //   sobre P_logout ya resuelta → app.js nunca recibía el usuario.
    //
    // ✅ AHORA (correcto):
    //   P_logout se deja PENDIENTE. _handleLogin la resolverá con el
    //   usuario real en el siguiente login. app.js detecta el cambio
    //   de referencia (P_anterior → P_logout) vía _listenForNextLogin()
    //   y espera sobre P_logout hasta que el usuario haga login.
    _authReady = new Promise(resolve => { _authResolve = resolve; });
    // Notificar a app.js que hay una nueva Promise de auth disponible.
    // app.js llamará _waitForUser() que hará .then() sobre la nueva Promise.
    _notifyAuthChange();

    if (prevUid) console.info('[Auth] Sesión cerrada.');
}

// ═════════════════════════════════════════════════════════════
// FORMULARIO DE LOGIN
// ═════════════════════════════════════════════════════════════

const AUTH_ERROR_MESSAGES = {
    'auth/user-not-found':         'No existe una cuenta con ese correo.',
    'auth/wrong-password':         'Contraseña incorrecta. Inténtalo de nuevo.',
    'auth/invalid-email':          'El formato del correo no es válido.',
    'auth/too-many-requests':      'Demasiados intentos. Espera unos minutos.',
    'auth/network-request-failed': 'Sin conexión. Verifica tu internet.',
    'auth/invalid-credential':     'Correo o contraseña incorrectos.',
    'auth/user-disabled':          'Esta cuenta ha sido deshabilitada.',
    'auth/operation-not-allowed':  'Inicio de sesión con correo no habilitado.',
};

export async function handleLogin() {
    if (!window._auth) { window.showNotification?.('⚠️ Firebase no está configurado.'); return; }

    const emailInput = $id('loginEmail');
    const passInput  = $id('loginPassword');
    const errEl      = $id('loginError');
    const btn        = $id('loginBtn');
    const btnText    = $id('loginBtnText');

    const email    = (emailInput?.value || '').trim();
    const password = passInput?.value || '';

    if (errEl) errEl.classList.remove('visible');

    if (!email || !password) {
        if (errEl) { errEl.textContent = 'Por favor ingresa tu correo y contraseña.'; errEl.classList.add('visible'); }
        return;
    }

    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = 'Iniciando sesión…';

    let spinner = null;
    if (btn) { spinner = document.createElement('span'); spinner.className = 'login-spinner'; btn.appendChild(spinner); }

    try {
        await window._auth.signInWithEmailAndPassword(email, password);
        if (passInput) passInput.value = '';
    } catch (err) {
        console.warn('[Auth] Error al iniciar sesión:', err.code);
        if (errEl) {
            errEl.textContent = AUTH_ERROR_MESSAGES[err.code] || `Error: ${err.message || err.code}`;
            errEl.classList.add('visible');
        }
    } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'Iniciar sesión';
        if (spinner) spinner.remove();
    }
}

// ═════════════════════════════════════════════════════════════
// CERRAR SESIÓN
// ═════════════════════════════════════════════════════════════

export async function signOutUser() {
    if (!window._auth) return;
    try {
        window.sbClose?.();
        await window._auth.signOut();
        window.showNotification?.('👋 Sesión cerrada correctamente.');
        console.info('[Auth] signOut ejecutado.');
    } catch (err) {
        console.error('[Auth] Error al cerrar sesión:', err);
        window.showNotification?.('❌ Error al cerrar sesión.');
    }
}

window.handleLogin = handleLogin;
window.signOutUser = signOutUser;

// ══════════════════════════════════════════════════════════════
// CORRECCIONES APLICADAS EN ESTA VERSIÓN (v3.3)
// ══════════════════════════════════════════════════════════════
// BUG-FIREBASE-2 (CRÍTICO): initAuth() fallaba inmediatamente sin retry.
//   En PWA con conexión lenta o CDN con latencia, los scripts de Firebase
//   (firebase-auth-compat.js, etc.) se cargan desde gstatic.com CDN y
//   pueden tardar 200-800ms en llegar. initAuth() se llamaba en
//   DOMContentLoaded antes de que el SDK terminara de inicializarse,
//   encontraba window._auth === null y mostraba el error de inmediato.
//
//   CORRECCIÓN: se agrega un bucle de retry de 200ms con timeout de 2s.
//   Si _auth está disponible antes de 2s (caso normal), se procede.
//   Si después de 2s sigue en null, ahí SÍ es un error real de red/config.
//   La función _startAuthListener() se extrae para poder llamarla tanto
//   desde la ruta normal como desde el retry.

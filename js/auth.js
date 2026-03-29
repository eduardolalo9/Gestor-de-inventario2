/**
 * js/auth.js
 * ══════════════════════════════════════════════════════════════
 * Autenticación Firebase Email/Password.
 *
 * Responsabilidades:
 *   • onAuthStateChanged → mostrar login o app
 *   • Al hacer login  → startRealtimeListeners()
 *   • Al hacer logout → stopRealtimeListeners()
 *   • Manejo de errores del formulario con mensajes en español
 *
 * Los listeners de Firestore se inician AQUÍ (no en app.js) porque
 * deben arrancar solo cuando hay un usuario autenticado y detenerse
 * limpiamente cuando se cierra sesión, evitando fugas de memoria.
 * ══════════════════════════════════════════════════════════════
 */

import { startRealtimeListeners, stopRealtimeListeners } from './sync.js';

// ── Helper: acceso rápido a elementos del DOM ─────────────────
const $id = id => document.getElementById(id);

// ── Pantallas de auth ─────────────────────────────────────────
function showLogin() {
    $id('authLoadingScreen').classList.add('auth-hidden');
    $id('loginScreen').classList.remove('auth-hidden');
    $id('appWrapper').classList.remove('auth-visible');
    console.info('[Auth] Mostrando pantalla de login.');
}

function showApp(user) {
    $id('authLoadingScreen').classList.add('auth-hidden');
    $id('loginScreen').classList.add('auth-hidden');
    $id('appWrapper').classList.add('auth-visible');

    // Mostrar email del usuario en el sidebar
    const emailEl = $id('sbUserEmail');
    if (emailEl && user) emailEl.textContent = user.email;

    console.info('[Auth] ✓ Usuario autenticado:', user?.email || 'N/A');
}

// ═════════════════════════════════════════════════════════════
//  INICIALIZACIÓN — onAuthStateChanged
//  Punto central de conexión entre auth y listeners Firestore.
// ═════════════════════════════════════════════════════════════

export function initAuth() {
    if (!window._auth) {
        console.warn('[Auth] Firebase Auth no disponible — mostrando app sin autenticación.');
        $id('authLoadingScreen').classList.add('auth-hidden');
        $id('appWrapper').classList.add('auth-visible');

        // Sin Firebase: iniciar listeners solo si _db existe
        if (window._db) {
            startRealtimeListeners();
        }
        return;
    }

    window._auth.onAuthStateChanged(function(user) {
        if (user) {
            showApp(user);
            // ─── LOGIN: iniciar listeners en tiempo real ───────────
            // startRealtimeListeners es idempotente:
            // si se llama dos veces solo reinicia, no duplica listeners.
            startRealtimeListeners();
            console.info('[Auth] Listeners en tiempo real iniciados para:', user.email);
        } else {
            showLogin();
            // ─── LOGOUT: detener listeners y liberar recursos ──────
            // stopRealtimeListeners llama unsub() en cada listener activo.
            stopRealtimeListeners();
            console.info('[Auth] Listeners detenidos — sesión cerrada.');
        }
    });
}

// ═════════════════════════════════════════════════════════════
//  MANEJO DEL FORMULARIO DE LOGIN
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
    if (!window._auth) {
        window.showNotification?.('⚙️ Firebase no está configurado.');
        return;
    }

    const email    = ($id('loginEmail')?.value    || '').trim();
    const password = ($id('loginPassword')?.value || '').trim();
    const errEl    = $id('loginError');
    const btn      = $id('loginBtn');
    const btnText  = $id('loginBtnText');

    // Limpiar error anterior
    errEl.classList.remove('visible');

    // Validación básica en cliente
    if (!email || !password) {
        errEl.textContent = 'Por favor ingresa tu correo y contraseña.';
        errEl.classList.add('visible');
        return;
    }

    // Mostrar estado de carga en el botón
    btn.disabled = true;
    btnText.textContent = 'Iniciando sesión…';
    const spinner = document.createElement('span');
    spinner.className = 'login-spinner';
    btn.appendChild(spinner);

    try {
        await window._auth.signInWithEmailAndPassword(email, password);
        // onAuthStateChanged se encarga de mostrar la app y arrancar listeners
    } catch (err) {
        console.warn('[Auth] Error al iniciar sesión:', err.code, err.message);
        errEl.textContent = AUTH_ERROR_MESSAGES[err.code] || `Error: ${err.message || err.code}`;
        errEl.classList.add('visible');
    } finally {
        btn.disabled        = false;
        btnText.textContent = 'Iniciar sesión';
        btn.querySelector('.login-spinner')?.remove();
    }
}

// ═════════════════════════════════════════════════════════════
//  CERRAR SESIÓN
// ═════════════════════════════════════════════════════════════

export async function signOutUser() {
    if (!window._auth) return;
    try {
        window.sbClose?.();
        // stopRealtimeListeners se llama automáticamente en onAuthStateChanged
        await window._auth.signOut();
        window.showNotification?.('👋 Sesión cerrada correctamente.');
        console.info('[Auth] Sesión cerrada.');
    } catch (err) {
        console.error('[Auth] Error al cerrar sesión:', err);
        window.showNotification?.('❌ Error al cerrar sesión.');
    }
}

// ── Bindings globales ─────────────────────────────────────────
window.handleLogin  = handleLogin;
window.signOutUser  = signOutUser;

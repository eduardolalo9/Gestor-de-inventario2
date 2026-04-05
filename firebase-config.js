/**
 * firebase-config.js
 * ══════════════════════════════════════════════════════════════
 * Inicialización de Firebase (SDK compat v10, cargado globalmente).
 *
 * Expone en window:
 *   window._db         — instancia de Firestore (o null)
 *   window._auth       — instancia de Auth      (o null)
 *   window.FIRESTORE_DOC_ID — ID del documento principal
 * ══════════════════════════════════════════════════════════════
 */

const FIREBASE_CONFIG = {
     apiKey: "AIzaSyDugu23uEgacqMUTsoBF8i7xfyDIDbiv0M",
  authDomain: "bar-inventario-1109e.firebaseapp.com",
  databaseURL: "https://bar-inventario-1109e-default-rtdb.firebaseio.com",
  projectId: "bar-inventario-1109e",
  storageBucket: "bar-inventario-1109e.firebasestorage.app",
  messagingSenderId: "450765028668",
  appId: "1:450765028668:web:54fdb19714d374ff02b239"
};

window.FIRESTORE_DOC_ID = "barra-principal";

// ─── Estado global ───────────────────────────────────────────
window._db            = null;
window._auth          = null;
window._firebaseReady = false;

(function initFirebase() {
    'use strict';

    // Verificar config válida
    const configured = Object.values(FIREBASE_CONFIG).every(
        v => typeof v === 'string' && !v.startsWith("REEMPLAZA")
    );

    if (!configured) {
        console.warn("[Firebase] Config incompleta — solo localStorage.");
        return;
    }

    try {
        // ═══ PASO 1: Inicializar App ═══
        firebase.initializeApp(FIREBASE_CONFIG);

        // ═══ PASO 2: Auth (ANTES de Firestore) ═══
        window._auth = firebase.auth();

        // ═══ PASO 3: Firestore ═══
        window._db = firebase.firestore();

        // ═══ PASO 4: Persistencia offline ═══
        // NOTA: En Firebase v10.12+, enableIndexedDbPersistence
        // puede no existir. Usar try/catch SEPARADO para que
        // un fallo aquí NO destruya _auth ni _db.
        try {
            if (typeof window._db.enableIndexedDbPersistence === 'function') {
                // Método legacy (v9-v10.11)
                window._db.enableIndexedDbPersistence()
                    .catch(err => {
                        if (err.code === 'failed-precondition') {
                            console.warn('[Firebase] Persistencia: múltiples pestañas.');
                        } else if (err.code === 'unimplemented') {
                            console.warn('[Firebase] Persistencia no soportada.');
                        } else {
                            console.warn('[Firebase] Persistencia error:', err.code);
                        }
                    });
            } else {
                // Firebase v10.12+ — persistencia ya está habilitada
                // por defecto o se configura con settings.
                // Configurar caché ilimitado:
                window._db.settings({
                    cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED,
                    merge: true
                });
                console.info("[Firebase] Persistencia: usando configuración por defecto v10.12+");
            }
        } catch (persistErr) {
            // Si falla la persistencia, NO es crítico.
            // Firestore sigue funcionando sin caché offline.
            console.warn("[Firebase] Persistencia falló (no crítico):", persistErr.message);
        }

        window._firebaseReady = true;
        console.info("[Firebase] ✓ Inicializado — proyecto:", FIREBASE_CONFIG.projectId);
        console.info("[Firebase] ✓ Auth:", window._auth ? 'OK' : 'FALLO');
        console.info("[Firebase] ✓ Firestore:", window._db ? 'OK' : 'FALLO');

    } catch (e) {
        console.error("[Firebase] Error crítico al inicializar:", e);
        window._db            = null;
        window._auth          = null;
        window._firebaseReady = false;
    }
})();
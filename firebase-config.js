/**
 * firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";══════════════════════════════════════════════════════════════
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
       // 1. Inicializar App
const app = initializeApp(firebaseConfig);

// 2. Inicializar Autenticación
const auth = getAuth(app);

// 3. Inicializar Firestore con MODO OFFLINE ACTIVADO (Local Cache)
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});

export { app, auth, db };
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
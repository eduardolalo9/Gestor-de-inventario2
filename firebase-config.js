/**
 * firebase-config.js — v2.0
 * ══════════════════════════════════════════════════════════════
 * Inicialización de Firebase con SDK COMPAT v10 (cargado globalmente).
 *
 * CORRECCIONES HISTÓRICAS:
 * ① Eliminados `import` y `export` — este archivo se carga como
 *   <script> normal (NO módulo). Los `export` dentro del IIFE
 *   causaban "Unexpected token 'export'" en el navegador.
 * ② Corregido `initializeApp(firebaseConfig)` →
 *   `firebase.initializeApp(FIREBASE_CONFIG)`
 *   El SDK compat expone `firebase` como global; no hay imports.
 * ③ Corregido `window._db` y `window._auth` — se asignan tras
 *   inicializar, no con `initializeFirestore` del SDK modular.
 * ④ Persistencia offline con try/catch aislado para no bloquear
 *   _auth/_db.
 *
 * FIX (v2.0) — Declaración truncada `const FIREBASE_CONFIG =`:
 *   El archivo comenzaba con `const FIREBASE_CONFIG = /** ...`
 *   que el parser interpretaba como:
 *     const FIREBASE_CONFIG = window.FIRESTORE_DOC_ID = "barra-principal"
 *   generando un efecto secundario silencioso en el scope global
 *   del script. Eliminada la declaración sobrante.
 *
 * CREDENCIALES FUERA DEL REPOSITORIO (v2.0):
 *   Las credenciales ya no viven en este archivo.
 *   Deben declararse en firebase-credentials.js (GITIGNOREADO)
 *   que asigna window.FIREBASE_CREDENTIALS antes de que este
 *   script cargue.
 *   Ver firebase-credentials.example.js para la plantilla.
 *
 * ORDEN DE CARGA EN index.html (sin type="module"):
 *   <script src="firebase-app-compat.js"></script>
 *   <script src="firebase-firestore-compat.js"></script>
 *   <script src="firebase-auth-compat.js"></script>
 *   <script src="firebase-credentials.js"></script>   ← gitignored
 *   <script src="firebase-config.js"></script>
 * ══════════════════════════════════════════════════════════════
 */

window.FIRESTORE_DOC_ID = "barra-principal";

window._db            = null;
window._auth          = null;
window._firebaseReady = false;

(function initFirebase() {
    'use strict';

    // ── Leer credenciales inyectadas por firebase-credentials.js ──
    // Si el archivo no existe (primer setup), el objeto estará vacío
    // y la verificación de placeholders lo detectará.
    const FIREBASE_CONFIG = (typeof window.FIREBASE_CREDENTIALS === 'object' && window.FIREBASE_CREDENTIALS)
        ? window.FIREBASE_CREDENTIALS
        : {
  apiKey: "AIzaSyDugu23uEgacqMUTsoBF8i7xfyDIDbiv0M",
  authDomain: "bar-inventario-1109e.firebaseapp.com",
  databaseURL: "https://bar-inventario-1109e-default-rtdb.firebaseio.com",
  projectId: "bar-inventario-1109e",
  storageBucket: "bar-inventario-1109e.firebasestorage.app",
  messagingSenderId: "450765028668",
  appId: "1:450765028668:web:54fdb19714d374ff02b239"
};

    // Verificar que la config no tiene valores de placeholder
    const configured = Object.values(FIREBASE_CONFIG).every(
        v => typeof v === 'string' && v.length > 0 && !v.startsWith('REEMPLAZA')
    );
    if (!configured) {
        console.warn('[Firebase] Config incompleta — revisa firebase-credentials.js.');
        console.warn('[Firebase] La app funcionará en modo solo-localStorage.');
        return;
    }

    // Verificar que el SDK compat está disponible
    if (typeof firebase === 'undefined') {
        console.error('[Firebase] SDK compat no cargado — verifica el orden de scripts en index.html.');
        return;
    }

    // ── 1. Inicializar App (compat) ──────────────────────────────
    // Evitar doble-inicialización si el módulo se recarga
    let app;
    try {
        app = firebase.apps.length === 0
            ? firebase.initializeApp(FIREBASE_CONFIG)
            : firebase.apps[0];
        console.info('[Firebase] ✓ App inicializada — proyecto:', FIREBASE_CONFIG.projectId);
    } catch (appErr) {
        console.error('[Firebase] Error crítico al inicializar App:', appErr);
        // Sin app no hay nada que hacer
        return;
    }

    // ── 2. Auth — INDEPENDIENTE del resto ────────────────────
    // FIX BUG-FIREBASE-1: Auth y Firestore ahora tienen try/catch separados.
    //
    // PROBLEMA ANTERIOR:
    //   Los tres pasos (app, auth, firestore + persistencia) estaban dentro
    //   de un único try/catch. Si CUALQUIER línea posterior a
    //   window._auth = firebase.auth(app) lanzaba un error (ej. la
    //   persistencia offline o firebase.firestore()), el bloque catch
    //   ejecutaba: window._auth = null; — reseteando Auth aunque había
    //   sido inicializado correctamente. Resultado: initAuth() encontraba
    //   window._auth === null y mostraba "Firebase Auth no está disponible".
    //
    // SOLUCIÓN: cada servicio tiene su propio try/catch. Un fallo en
    //   Firestore (o en la persistencia) NO anula la inicialización de Auth.
    try {
        window._auth = firebase.auth(app);
        console.info('[Firebase] ✓ Auth:', window._auth ? 'OK' : 'FALLO');
    } catch (authErr) {
        console.error('[Firebase] Error inicializando Auth:', authErr);
        window._auth = null;
    }

    // ── 3. Firestore — INDEPENDIENTE de Auth ─────────────────
    try {
        window._db = firebase.firestore(app);
        console.info('[Firebase] ✓ Firestore:', window._db ? 'OK' : 'FALLO');
    } catch (dbErr) {
        console.error('[Firebase] Error inicializando Firestore:', dbErr);
        window._db = null;
    }

    // ── 4. Persistencia offline — INDEPENDIENTE (no bloquea si falla) ──
    // FIX Fase-2: En Firebase SDK v10+ compat, enableIndexedDbPersistence
    // fue eliminado. Verificamos si existe antes de llamarlo.
    if (window._db) {
        try {
            const enablePersist =
                window._db.enableIndexedDbPersistence?.bind(window._db) ||
                window._db.enablePersistence?.bind(window._db);

            if (typeof enablePersist === 'function') {
                enablePersist()
                    .then(() => console.info('[Firebase] ✓ Persistencia offline habilitada.'))
                    .catch(err => {
                        if (err.code === 'failed-precondition') {
                            console.warn('[Firebase] Persistencia: múltiples pestañas activas.');
                        } else if (err.code === 'unimplemented') {
                            console.warn('[Firebase] Persistencia no soportada en este navegador.');
                        } else {
                            console.warn('[Firebase] Persistencia error:', err.code);
                        }
                    });
            } else {
                console.info('[Firebase] Persistencia offline no disponible en esta versión del SDK (no crítico).');
            }
        } catch (persistErr) {
            console.warn('[Firebase] Persistencia falló (no crítico):', persistErr.message);
        }
    }

    window._firebaseReady = !!(window._auth && window._db);
    if (window._firebaseReady) {
        console.info('[Firebase] ✓ Inicialización completa.');
    } else {
        console.warn('[Firebase] Inicialización parcial — Auth:', !!window._auth, '| Firestore:', !!window._db);
    }

})();

// ══════════════════════════════════════════════════════════════
// CORRECCIONES APLICADAS EN ESTA VERSIÓN (v3.0)
// ══════════════════════════════════════════════════════════════
// BUG-FIREBASE-1 (CRÍTICO): Auth y Firestore compartían un único try/catch.
//   window._auth = firebase.auth(app)  ← inicializaba Auth en línea 89
//   window._db   = firebase.firestore(app)  ← línea siguiente
//   // ... código de persistencia offline
//   } catch (e) {
//       window._auth = null;  ← BUG: reseteaba Auth aunque estaba OK
//   }
//
//   Si firebase.firestore() lanzaba un error (Firestore no habilitado,
//   cuota superada, error de red) o si el código de persistencia offline
//   lanzaba, el catch reseteaba window._auth a null aunque Auth se había
//   inicializado correctamente en la línea anterior. Esto causaba que
//   initAuth() en auth.js encontrara _auth === null y mostrara:
//   "⚠️ Error de configuración: Firebase Auth no está disponible."
//
//   CORRECCIÓN: cada servicio (App, Auth, Firestore, Persistencia) tiene
//   su propio try/catch independiente. Un fallo en uno no afecta a los demás.

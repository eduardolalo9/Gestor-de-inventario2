/**
 * js/app.js — v2.4
 *
 * FIX BUG-5 (v2.1): Service Worker con ruta relativa './sw.js' y scope './'
 *   en lugar de '/sw.js' absoluta — necesario para GitHub Pages /index/.
 *
 * FIX BUG-A (v2.2) — CRÍTICO: Bug de sintaxis en el bloque del SW.
 * ──────────────────────────────────────────────────────────────────
 * PROBLEMA:
 *   El listener 'beforeunload' fue insertado accidentalmente DENTRO de
 *   la cadena Promise del registro del SW, partiéndola en dos bloques
 *   sin conexión. La llamada navigator.serviceWorker.register() estaba
 *   ausente — solo existía un .then() huérfano que el parser rechazaba
 *   silenciosamente. El SW nunca se registraba.
 *   Consecuencia: sin Service Worker, sin modo offline real, sin
 *   instalación PWA. En una barra con WiFi inestable la app quedaba
 *   inoperable al caer la conexión.
 *
 * CORRECCIÓN:
 *   ① Se agrega la llamada faltante:
 *      navigator.serviceWorker.register('./sw.js', { scope: './' })
 *   ② Se elimina el beforeunload mal ubicado dentro del bloque del SW.
 *      El beforeunload correcto ya existe más abajo, fuera del bloque.
 *
 * FIX BUG-C (v2.2) — CRÍTICO: setInterval de recovery duplicado.
 * ──────────────────────────────────────────────────────────────────
 * PROBLEMA:
 *   _waitForUser() tenía un setInterval de sync-recovery SUELTO,
 *   fuera del guard if (!_appInitialized). Esto significaba que cada
 *   vez que el usuario hacía logout + re-login se creaba un nuevo
 *   interval acumulativo: 2 sesiones → 2 intervals, 3 sesiones → 3,
 *   etc. Efectos: sincronizaciones dobles/triples y memory leak.
 *   Además ese interval llamaba a syncToCloud() sin .catch(), por lo
 *   que cualquier error de red quedaba sin manejar y podía romper la
 *   Promise chain silenciosamente.
 *
 * CORRECCIÓN:
 *   Se elimina el setInterval suelto. Solo queda el correcto, dentro
 *   del guard if (!_appInitialized), que garantiza que se crea una
 *   única vez por pestaña, sin importar cuántos re-logins ocurran.
 */

import { initTheme }                  from './ui.js';
import { loadFromLocalStorage,
         smartAutoSave,
         saveToLocalStorage }          from './storage.js';
import { syncStockByAreaFromConteo,
         handleFileImport,
         importFullData }              from './products.js';
import { initAuditUser }              from './audit.js';
import { initAuth,
         onAuthReady,
         getAuthReady,
         onAuthChange }               from './auth.js';
import { switchTab }                  from './render.js';
import { updateNetworkStatus,
         syncToCloud,
         stopRealtimeListeners }       from './sync.js';
import { state }                      from './state.js';
import { INITIAL_PRODUCTS,
         AUTO_SAVE_INTERVAL_MS,
         SYNC_RECOVERY_INTERVAL_MS }   from './constants.js';
import './notificaciones.js';
import './ajustes.js';
import './reportes.js';
import './actions.js';

console.info('[App] BarInventory arrancando…');

// ── Service Worker ────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // FIX BUG-5: Ruta relativa './sw.js' — funciona en /index/ de GitHub Pages.
    // FIX BUG-A: Se agrega register() que faltaba y se elimina el beforeunload
    //            que estaba mal ubicado aquí (el correcto ya existe más abajo).
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(reg => {
        console.info('[SW] Registrado — scope:', reg.scope);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              console.info('[SW] Nueva versión disponible.');
              window.showNotification?.('🔄 Nueva versión disponible — recarga la página');
            }
          });
        });
      })
      .catch(err => console.warn('[SW] Error al registrar:', err));

    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'SYNC_PENDING' && window._db && navigator.onLine) {
        syncToCloud().catch(e => console.warn('[SW→App] syncToCloud falló:', e));
      }
    });
  });
} else {
  console.info('[SW] Service Workers no soportados.');
}

// ── ESC cierra sidebar (sin interferir con modales abiertos) ──
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const anyOpen = ['productModal', 'orderModal', 'inventarioModal']
    .some(id => !document.getElementById(id)?.classList.contains('hidden'));
  if (!anyOpen) window.sbClose?.();
});

// ── Guardar al cerrar pestaña ─────────────────────────────────
window.addEventListener('beforeunload', () => {
  stopRealtimeListeners();
  try { saveToLocalStorage(); } catch (_) {}
});

// ═══════════════════════════════════════════════════════════════
// DOMContentLoaded
// ═══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  console.info('[App] DOM listo — iniciando secuencia…');

  initTheme();

  // Enter en campos del login
  document.getElementById('loginEmail')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('loginPassword')?.focus(); }
  });
  document.getElementById('loginPassword')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); window.handleLogin?.(); }
  });

  // Iniciar autenticación
  initAuth();

  // ── Manejador de sesión re-entrante ─────────────────────────
  // FIX BUG-3 (v2.1): onAuthReady es una Promise que solo se resuelve UNA VEZ.
  // Después de logout + re-login, auth.js crea una nueva Promise (P2),
  // pero el .then() registrado aquí está en P1 y no vuelve a disparar.
  // SOLUCIÓN: usamos getAuthReady() en cada ciclo para siempre obtener
  // la Promise actual, y encadenamos un nuevo .then() en cada login.

  let _appInitialized = false; // Solo inicializar listeners globales una vez

  function _waitForUser() {
    getAuthReady().then(user => {
      if (!user) {
        console.info('[App] Sin usuario — esperando login.');
        // onAuthChange() disparará _waitForUser() cuando el usuario haga login.
        return;
      }

      console.info('[App] Usuario confirmado — cargando aplicación…');

      initAuditUser();
      loadFromLocalStorage();
      syncStockByAreaFromConteo();

      // FIX BUG-C: El setInterval de recovery que existía aquí fue eliminado.
      // Era un interval suelto fuera del guard _appInitialized que se duplicaba
      // en cada re-login (logout + login acumulaba múltiples intervals).
      // El único interval correcto está dentro del guard if (!_appInitialized).

      switchTab(state.activeTab);

      // Fase-4: Leer parámetro ?tab= de la URL para soportar shortcuts del PWA.
      // Si el usuario abre la app desde un shortcut (ej. "Inventario" en el ícono),
      // el manifest.json pasa ?tab=inventario y aquí lo aplicamos.
      // Solo se aplica en el primer arranque (cuando _appInitialized es false).
      if (!_appInitialized) {
        const urlTab = new URLSearchParams(window.location.search).get('tab');
        // FIX BUG-C3: VALID_TABS alineado con los case en render.js switch.
        // ANTES: incluía 'auditoria' y 'reportes' que NO tienen case en render.js
        // → el default los capturaba y sobreescribía activeTab a 'inicio'.
        // ANTES: excluía 'historia' que SÍ tiene case en render.js.
        // AHORA: lista exacta de los 7 case presentes en renderTab().
        const VALID_TABS = ['inicio', 'inventario', 'productos', 'pedidos',
                            'historia', 'ajustes', 'notificaciones'];
        if (urlTab && VALID_TABS.includes(urlTab)) {
          console.info(`[App] Shortcut PWA → tab: ${urlTab}`);
          switchTab(urlTab);
          // Limpiar el parámetro de la URL sin recargar la página
          const cleanUrl = window.location.pathname;
          window.history.replaceState({}, '', cleanUrl);
        }
      }

      // Inicializar listeners globales solo una vez por sesión del navegador
      if (!_appInitialized) {
        _appInitialized = true;

        // Delegación de eventos para inputs de archivo
        document.body.addEventListener('change', function(e) {
          const target = e.target;
          if (!target || target.tagName !== 'INPUT') return;
          if (target.id === 'fileInput')       { handleFileImport(e); return; }
          if (target.id === 'importDataInput') { importFullData(e);   return; }
        });

        // Red online/offline
        window.addEventListener('online',  updateNetworkStatus);
        window.addEventListener('offline', updateNetworkStatus);

        window.addEventListener('online', () => {
          if (state.adjustmentsPending?.length > 0) {
            import('./ajustes.js').then(m => m.subirAjustesPendientes()).catch(() => {});
          }
        });

        // Auto-guardado cada 30s
        setInterval(smartAutoSave, AUTO_SAVE_INTERVAL_MS);

        // Sync de recuperación cada 3 min — ÚNICO interval, creado una sola vez
        setInterval(() => {
          if (navigator.onLine && window._db && state.userRole !== null &&
              state._cloudSyncPending && !state._syncInProgress) {
            console.info('[App] Sync de recuperación…');
            syncToCloud().catch(e => console.warn('[App] Sync periódico falló:', e));
          }
        }, SYNC_RECOVERY_INTERVAL_MS);

        // Guard anti doble-click exportToExcel
        let _exportingExcel = false;
        const origExport = window.exportToExcel;
        if (origExport) {
          window.exportToExcel = function(modo) {
            if (_exportingExcel) { window.showNotification?.('⏳ Exportación en proceso…'); return; }
            _exportingExcel = true;
            try { origExport(modo); }
            catch (e) { window.showNotification?.('❌ Error al exportar Excel'); console.error(e); }
            setTimeout(() => { _exportingExcel = false; }, 3000);
          };
        }

        // Label de tema en sidebar
        const sbLabel = document.getElementById('sbThemeLabel');
        if (sbLabel) {
          sbLabel.textContent =
            document.documentElement.getAttribute('data-theme') === 'dark'
              ? 'Modo claro' : 'Modo oscuro';
        }
      }

      updateNetworkStatus();
      console.info('[App] ✓ Arranque completo.');
    }).catch(err => {
      console.error('[App] Error en getAuthReady():', err);
    });
  }

  // Fase-3: Registrar _waitForUser como listener de cambios de auth.
  // Se registra UNA SOLA VEZ. Cada vez que auth.js crea una nueva Promise
  // (logout o cambio de usuario), onAuthChange dispara _waitForUser()
  // directamente — sin polling de setInterval ni acumulación de timers.
  onAuthChange(_waitForUser);

  // Arranque inicial
  _waitForUser();
});

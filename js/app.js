/**
 * js/app.js — Versión Corregida y Estable (v2.5)
 * 
 * Compatible con carga como <script src="js/app.js"> (NO módulo)
 * Todos los demás archivos JS se cargan como scripts globales en index.html
 */

console.info('[App] BarInventory arrancando…');

// ── Service Worker Registration ─────────────────────────────────────
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' })
            .then(reg => {
                console.info('[SW] Registrado — scope:', reg.scope);
                reg.addEventListener('updatefound', () => {
                    const nw = reg.installing;
                    if (nw) {
                        nw.addEventListener('statechange', () => {
                            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                                console.info('[SW] Nueva versión disponible.');
                                window.showNotification?.('🔄 Nueva versión disponible — recarga la página');
                            }
                        });
                    }
                });
            })
            .catch(err => console.warn('[SW] Error al registrar:', err));

        // Escuchar mensajes del Service Worker
        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data?.type === 'SYNC_PENDING' && window._db && navigator.onLine) {
                syncToCloud?.().catch(e => console.warn('[SW→App] sync falló:', e));
            }
        });
    });
} else {
    console.info('[SW] Service Workers no soportados en este navegador.');
}

// ── Cerrar sidebar con tecla ESC ───────────────────────────────────
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        const anyModalOpen = ['productModal', 'orderModal', 'inventarioModal', 'ajustesModal']
            .some(id => !document.getElementById(id)?.classList.contains('hidden'));
        if (!anyModalOpen && typeof window.sbClose === 'function') {
            window.sbClose();
        }
    }
});

// ── Guardar datos antes de cerrar pestaña ───────────────────────────
window.addEventListener('beforeunload', () => {
    stopRealtimeListeners?.();
    try {
        saveToLocalStorage?.();
    } catch (e) {
        console.warn('[App] Error guardando al cerrar:', e);
    }
});

// ═══════════════════════════════════════════════════════════════════════
// DOM Loaded - Inicialización Principal
// ═══════════════════════════════════════════════════════════════════════
window.addEventListener('load', () => {
    console.info('[App] Todos los scripts cargados — iniciando aplicación...');

    // Inicializar componentes básicos
    if (typeof initTheme === 'function') initTheme();
    if (typeof initAuth === 'function') initAuth();

    // Enter en campos de login
    const loginEmail = document.getElementById('loginEmail');
    const loginPassword = document.getElementById('loginPassword');

    if (loginEmail) {
        loginEmail.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                loginPassword?.focus();
            }
        });
    }
    if (loginPassword) {
        loginPassword.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.handleLogin?.();
            }
        });
    }

    // Variables de control
    let _appInitialized = false;

    function _waitForUser() {
        getAuthReady?.().then(user => {
            if (!user) {
                console.info('[App] Esperando login...');
                return;
            }

            console.info('[App] Usuario autenticado — cargando datos...');

            initAuditUser?.();
            loadFromLocalStorage?.();
            syncStockByAreaFromConteo?.();

            switchTab(state.activeTab || 'inicio');

            // Manejo de parámetro ?tab= para shortcuts PWA
            if (!_appInitialized) {
                const urlTab = new URLSearchParams(window.location.search).get('tab');
                const VALID_TABS = ['inicio', 'inventario', 'productos', 'pedidos', 'historia', 'ajustes', 'notificaciones'];

                if (urlTab && VALID_TABS.includes(urlTab)) {
                    switchTab(urlTab);
                    window.history.replaceState({}, '', window.location.pathname);
                }
            }

            // Inicializar listeners globales SOLO UNA VEZ
            if (!_appInitialized) {
                _appInitialized = true;

                // Eventos de archivos
                document.body.addEventListener('change', function(e) {
                    if (e.target?.id === 'fileInput') handleFileImport?.(e);
                    if (e.target?.id === 'importDataInput') importFullData?.(e);
                });

                // Estado de red
                window.addEventListener('online', updateNetworkStatus);
                window.addEventListener('offline', updateNetworkStatus);

                // Auto-save
                setInterval(() => {
                    if (typeof smartAutoSave === 'function') smartAutoSave();
                }, AUTO_SAVE_INTERVAL_MS || 30000);

                // Sync de recuperación
                setInterval(() => {
                    if (navigator.onLine && window._db && state.userRole !== null && state._cloudSyncPending) {
                        syncToCloud?.().catch(e => console.warn('[Recovery] Sync falló:', e));
                    }
                }, SYNC_RECOVERY_INTERVAL_MS || 180000);

                updateNetworkStatus();
            }

            console.info('[App] ✓ Aplicación iniciada correctamente.');
        }).catch(err => {
            console.error('[App] Error en autenticación:', err);
        });
    }

    // Registrar listener de cambios de autenticación
    if (typeof onAuthChange === 'function') {
        onAuthChange(_waitForUser);
    }

    // Primer intento
    _waitForUser();
});

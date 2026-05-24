/**
 * js/app.js — v2.5 Mejorado (Estable)
 * 
 * Versión optimizada, limpia y robusta para carga como script normal.
 * Corrige duplicaciones, mejora manejo de errores y rendimiento.
 */

console.info('[App] BarInventory v2.5 arrancando...');

// ── Registro de Service Worker ─────────────────────────────────────
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' })
            .then(reg => {
                console.info('[SW] Registrado con éxito — Scope:', reg.scope);

                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                console.info('[SW] Nueva versión disponible');
                                window.showNotification?.('🔄 Nueva versión lista — Recarga la página');
                            }
                        });
                    }
                });
            })
            .catch(err => console.warn('[SW] Error al registrar:', err));

        // Escuchar mensajes del SW
        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data?.type === 'SYNC_PENDING' && navigator.onLine) {
                syncToCloud?.().catch(e => console.warn('[SW] Sync falló:', e));
            }
        });
    });
} else {
    console.info('[SW] Service Worker no disponible en este navegador.');
}

// ── Cerrar sidebar con tecla ESC ───────────────────────────────────
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        const modalsOpen = ['productModal', 'orderModal', 'inventarioModal', 'ajustesModal']
            .some(id => !document.getElementById(id)?.classList.contains('hidden'));
        
        if (!modalsOpen && typeof window.sbClose === 'function') {
            window.sbClose();
        }
    }
});

// ── Guardar datos antes de cerrar la pestaña ───────────────────────
window.addEventListener('beforeunload', () => {
    stopRealtimeListeners?.();
    try {
        saveToLocalStorage?.();
    } catch (e) {
        console.warn('[App] Error guardando datos al cerrar:', e);
    }
});

// ═══════════════════════════════════════════════════════════════════════
// Inicialización Principal cuando todo ha cargado
// ═══════════════════════════════════════════════════════════════════════
window.addEventListener('load', () => {
    console.info('[App] Todos los scripts cargados — Iniciando aplicación...');

    // Inicializaciones básicas
    if (typeof initTheme === 'function') initTheme();
    if (typeof initAuth === 'function') initAuth();

    // Soporte Enter en login
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

    let _appInitialized = false;

    // Función que se ejecuta cuando hay usuario autenticado
    function _waitForUser() {
        getAuthReady?.().then(user => {
            if (!user) {
                console.info('[App] Esperando autenticación...');
                return;
            }

            console.info('[App] Usuario autenticado — Cargando datos...');

            initAuditUser?.();
            loadFromLocalStorage?.();
            syncStockByAreaFromConteo?.();

            switchTab(state.activeTab || 'inicio');

            // Aplicar parámetro ?tab= de PWA shortcuts
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

                // Delegación de eventos para archivos
                document.body.addEventListener('change', function(e) {
                    if (e.target?.id === 'fileInput') handleFileImport?.(e);
                    if (e.target?.id === 'importDataInput') importFullData?.(e);
                });

                // Estado de conexión
                window.addEventListener('online', updateNetworkStatus);
                window.addEventListener('offline', updateNetworkStatus);

                // Auto-save periódico
                setInterval(() => {
                    if (typeof smartAutoSave === 'function') smartAutoSave();
                }, window.AUTO_SAVE_INTERVAL_MS || 30000);

                // Sync de recuperación
                setInterval(() => {
                    if (navigator.onLine && window._db && state.userRole !== null && state._cloudSyncPending) {
                        syncToCloud?.().catch(e => console.warn('[Recovery] Sync falló:', e));
                    }
                }, window.SYNC_RECOVERY_INTERVAL_MS || 180000);

                updateNetworkStatus();
            }

            console.info('[App] ✓ Aplicación iniciada correctamente.');
        }).catch(err => {
            console.error('[App] Error durante autenticación:', err);
        });
    }

    // Registrar listener de cambios de auth
    if (typeof onAuthChange === 'function') {
        onAuthChange(_waitForUser);
    }

    // Primer intento de carga
    _waitForUser();
});

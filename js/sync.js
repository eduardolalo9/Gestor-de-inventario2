/**
 * js/sync.js
 * ══════════════════════════════════════════════════════════════
 * Sincronización bidireccional en tiempo real con Firebase Firestore.
 *
 * ARQUITECTURA DE LISTENERS (10 onSnapshot activos cuando el
 * usuario está autenticado):
 *
 *   [1]   inventarioApp/{DOC_ID}            → productos, carrito,
 *                                             estado auditoría, pedidos
 *   [2-4] inventarioApp/{DOC_ID}/stockAreas/{area} x3
 *                                           → conteo operativo por área
 *   [5-7] inventarioApp/{DOC_ID}/conteoAreas/{area} x3
 *                                           → conteo de auditoría ciega
 *   [8-10] inventarioApp/{DOC_ID}/conteoPorUsuario/{area} x3
 *                                           → conteos multiusuario
 *
 * MECANISMO ANTI-BUCLE (dos capas):
 *   Capa 1 — Firebase metadata.hasPendingWrites:
 *     true  → snapshot causado por escritura LOCAL aún no confirmada
 *             por el servidor → ignorar siempre (optimistic echo)
 *   Capa 2 — comparación de timestamp _lastModified:
 *     si el timestamp del snapshot ≤ estado local → ya tenemos
 *     esos datos (o más nuevos) → ignorar
 *
 * CICLO DE VIDA:
 *   startRealtimeListeners()  — llamado por auth.js al confirmar login
 *   stopRealtimeListeners()   — llamado por auth.js al cerrar sesión
 *
 * API pública:
 *   startRealtimeListeners()
 *   stopRealtimeListeners()
 *   syncToCloud(retryCount?)
 *   syncConteoAtomicoPorArea(area)
 *   syncConteoPorUsuarioToFirestore(area)
 *   resetConteoAtomicoEnFirestore()
 *   updateCloudSyncBadge(status)
 *   updateNetworkStatus()
 * ══════════════════════════════════════════════════════════════
 */

import { state }                        from './state.js';
import { AREA_KEYS, MAX_CHUNK_SIZE }    from './constants.js';
import { showNotification }             from './ui.js';
import { syncStockByAreaFromConteo }    from './products.js';

// ═════════════════════════════════════════════════════════════
//  REGISTRO DE LISTENERS — Map<string, unsubscribeFn>
//  Claves predefinidas:
//    'main'                         → doc principal
//    'stockArea:almacen|barra1|...' → conteo operativo por área
//    'conteoArea:almacen|...'       → auditoría atómica por área
//    'userConteo:almacen|...'       → multiusuario por área
// ═════════════════════════════════════════════════════════════
const _activeListeners = new Map();

// ── Anti-bucle: timestamp de la última escritura LOCAL ────────
// syncToCloud() lo actualiza antes de cada set(). El handler del
// snapshot lo compara para detectar su propio eco de confirmación.
let _lastLocalWriteTs = 0;

// ── Debounce del re-render (múltiples snapshots en paralelo) ──
let _renderDebounceTimer = null;
const RENDER_DEBOUNCE_MS = 150;

function _scheduleRender() {
    clearTimeout(_renderDebounceTimer);
    _renderDebounceTimer = setTimeout(async () => {
        try {
            const { renderTab } = await import('./render.js');
            renderTab();
        } catch (e) {
            console.error('[Snapshot] Error en renderTab diferido:', e);
        }
    }, RENDER_DEBOUNCE_MS);
}

// ═════════════════════════════════════════════════════════════
//  HELPERS DE CHUNK (subcolecciones paginadas para orders/inventories)
// ═════════════════════════════════════════════════════════════

async function _writeChunkedSubcollection(docRef, subcollName, dataArray) {
    const colRef      = docRef.collection(subcollName);
    const totalChunks = Math.max(1, Math.ceil(dataArray.length / MAX_CHUNK_SIZE));

    // Paso 1: escribir con prefijo "new_" — los lectores siguen viendo los chunks viejos
    const writeBatch = window._db.batch();
    for (let i = 0; i < totalChunks; i++) {
        writeBatch.set(colRef.doc('new_chunk_' + i), {
            items:       dataArray.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE),
            chunkIndex:  i,
            totalChunks: totalChunks,
            _updatedAt:  Date.now(),
        });
    }
    await writeBatch.commit();

    // Paso 2: renombrar "new_" → definitivos y borrar viejos en un solo batch
    const existingSnap = await colRef.get();
    const cleanBatch   = window._db.batch();
    existingSnap.forEach(d => {
        if (d.id.startsWith('new_')) {
            cleanBatch.set(colRef.doc(d.id.replace('new_', '')), d.data());
            cleanBatch.delete(d.ref);
        } else {
            cleanBatch.delete(d.ref);
        }
    });
    if (!existingSnap.empty) await cleanBatch.commit();
    console.info(`[Firebase][Chunk] ${subcollName} → ${totalChunks} chunk(s) escritos (write-first).`);
}

async function _readChunkedSubcollection(docRef, subcollName) {
    if (!docRef) return [];
    try {
        const snap = await docRef.collection(subcollName).orderBy('chunkIndex').get();
        if (snap.empty) return [];
        const result = [];
        snap.forEach(d => {
            const items = d.data().items;
            if (Array.isArray(items)) items.forEach(i => result.push(i));
        });
        return result;
    } catch (e) {
        console.warn(`[Firebase][Chunk] Error leyendo ${subcollName}:`, e);
        return [];
    }
}

// ═════════════════════════════════════════════════════════════
//  BADGE DE SINCRONIZACIÓN (header + sidebar)
// ═════════════════════════════════════════════════════════════

export function updateCloudSyncBadge(status) {
    const badge = document.getElementById('cloudSyncBadge');
    const dot   = document.getElementById('syncDot');

    const cfg = {
        ok:       { bg: '#06d6a0', icon: '☁️',  text: 'Sincronizado',    pulse: false, dotState: 'ok',      dotTitle: 'Sincronizado ✓'          },
        syncing:  { bg: '#4cc9f0', icon: '🔄',  text: 'Sincronizando…',  pulse: true,  dotState: 'syncing', dotTitle: 'Subiendo datos…'          },
        pending:  { bg: '#ffd166', icon: '⏳',  text: 'Pendiente',        pulse: false, dotState: 'pending', dotTitle: 'Cambios pendientes'       },
        listening:{ bg: '#a78bfa', icon: '👂',  text: 'En tiempo real',  pulse: false, dotState: 'ok',      dotTitle: 'Escuchando cambios en vivo'},
        error:    { bg: '#ff6b6b', icon: '⚠️',  text: 'Error sync',      pulse: false, dotState: 'error',   dotTitle: 'Error de sincronización'  },
        offline:  { bg: '#8b8ca8', icon: '📴',  text: 'Sin conexión',    pulse: false, dotState: 'offline', dotTitle: 'Sin conexión'             },
        none:     { bg: '#50516a', icon: '☁️',  text: 'Sin Firebase',    pulse: false, dotState: 'none',    dotTitle: 'Sin Firebase'             },
    };

    if (!window._db) status = 'none';
    const c = cfg[status] || cfg.none;

    if (badge) {
        badge.style.background   = c.bg + '22';
        badge.style.borderColor  = c.bg + '66';
        badge.style.color        = c.bg;
        badge.innerHTML          = `<span style="margin-right:4px">${c.icon}</span>${c.text}`;
        badge.style.animation    = c.pulse ? 'pulse 1.5s ease-in-out infinite' : 'none';
    }
    if (dot) {
        dot.setAttribute('data-state', c.dotState);
        dot.setAttribute('title',      c.dotTitle);
        dot.setAttribute('aria-label', 'Sync: ' + c.dotTitle);
    }
}

// ═════════════════════════════════════════════════════════════
//  BARRA DE ESTADO DE RED
// ═════════════════════════════════════════════════════════════

export function updateNetworkStatus() {
    const existing = document.getElementById('networkStatus');
    if (existing) existing.remove();

    if (!navigator.onLine) {
        const bar = document.createElement('div');
        bar.id = 'networkStatus';
        bar.style.cssText =
            'position:fixed;bottom:0;left:0;right:0;background:#f59e0b;color:#fff;' +
            'text-align:center;padding:6px;font-size:13px;font-weight:600;z-index:9999;';
        bar.textContent = '⚠️ Sin conexión — los datos están guardados localmente';
        document.body.appendChild(bar);
        updateCloudSyncBadge('offline');
        console.info('[Network] Modo offline activado.');
    } else {
        // Al reconectar: sincronizar si había cambios pendientes
        if (state._cloudSyncPending && window._db) {
            console.info('[Network] Reconectado — sincronizando cambios pendientes…');
            syncToCloud().catch(e => console.warn('[Network] Sync al reconectar falló:', e));
        } else {
            // Si los listeners están activos → mostrar "en tiempo real"
            updateCloudSyncBadge(_activeListeners.size > 0 ? 'listening' : (window._db ? 'ok' : 'none'));
        }
    }
}

// ═════════════════════════════════════════════════════════════
//  HELPERS INTERNOS: aplicar snapshots al estado
// ═════════════════════════════════════════════════════════════

/**
 * Determina si un snapshot debe ignorarse.
 * Retorna true (ignorar) en dos casos:
 *   1. hasPendingWrites: es el eco optimista de una escritura local,
 *      todavía no confirmada por el servidor.
 *   2. El _lastModified del snapshot es ≤ al timestamp de la última
 *      escritura local: es la confirmación de nuestra propia escritura.
 *
 * @param {firebase.firestore.DocumentSnapshot} snap
 * @param {number} [localLastModified] - timestamp de nuestra última escritura
 */
function _shouldIgnoreSnapshot(snap, localLastModified = _lastLocalWriteTs) {
    // Capa 1: escritura local optimista (aún no confirmada por el servidor)
    if (snap.metadata.hasPendingWrites) {
        console.debug('[Snapshot] Ignorando echo local (hasPendingWrites).');
        return true;
    }

    // Capa 2: snapshot de confirmación de nuestra propia escritura
    const snapTs = snap.data()?._lastModified || 0;
    if (snapTs > 0 && snapTs <= localLastModified) {
        console.debug(`[Snapshot] Ignorando echo de confirmación (snapTs=${snapTs} ≤ local=${localLastModified}).`);
        return true;
    }

    return false;
}

/**
 * Aplica datos del doc principal al estado local.
 * Lógica compartida entre el handler de onSnapshot y _applyCloudData.
 */
async function _applyMainDocData(data) {
    if (!data) return;
    const docRef = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);

    if (Array.isArray(data.products))    state.products        = data.products;
    if (Array.isArray(data.cart))        state.cart            = data.cart;
    if (data.activeTab)                  state.activeTab       = data.activeTab;
    if (data.selectedArea)               state.selectedArea    = data.selectedArea;
    if (data.auditoriaStatus)            state.auditoriaStatus = data.auditoriaStatus;
    if (data.auditoriaConteo)            state.auditoriaConteo = data.auditoriaConteo;

    // Historiales chunkeados: una lectura puntual (get) es suficiente
    // porque el historial no cambia en tiempo real (solo append)
    if (data._ordersInChunks) {
        const r = await _readChunkedSubcollection(docRef, 'ordersChunks');
        if (r.length) state.orders = r;
    } else if (Array.isArray(data.orders)) {
        state.orders = data.orders;
    }

    if (data._inventoriesInChunks) {
        const r = await _readChunkedSubcollection(docRef, 'inventoriesChunks');
        if (r.length) state.inventories = r;
    } else if (Array.isArray(data.inventories)) {
        state.inventories = data.inventories;
    }
}

/**
 * Aplica datos de un área de stockAreas al inventarioConteo local.
 * Fusiona solo el área recibida, respetando el resto de áreas.
 */
function _applyStockAreaData(area, areaData) {
    Object.keys(areaData).forEach(prodId => {
        if (prodId === '_lastModified') return;
        if (!state.inventarioConteo[prodId]) state.inventarioConteo[prodId] = {};
        state.inventarioConteo[prodId][area] = areaData[prodId];
    });
    syncStockByAreaFromConteo();
}

/**
 * Aplica datos de un área de conteoAreas (auditoría atómica con conflictos).
 */
function _applyConteoAreaData(area, areaData) {
    state.products.forEach(p => {
        if (!areaData[p.id]) return;
        if (!state.auditoriaConteo[p.id])       state.auditoriaConteo[p.id] = {};
        if (!state.auditoriaConteo[p.id][area]) state.auditoriaConteo[p.id][area] = {};

        const cloudEntry = areaData[p.id];
        // Propagar conflictos de abiertas detectados en el servidor
        if (cloudEntry.alerta_conflicto) {
            state.auditoriaConteo[p.id][area]._conflictoAbiertas =
                cloudEntry.stock_abierto_alternativo;
            console.warn(`[Snapshot][conteoArea] Conflicto en ${p.id}/${area}`);
        } else {
            delete state.auditoriaConteo[p.id][area]._conflictoAbiertas;
        }
    });
}

/**
 * Aplica datos de un área de conteoPorUsuario (multiusuario).
 * Solo fusiona datos de OTROS dispositivos; nunca sobreescribe el userId propio.
 */
function _applyUserConteoData(area, areaData) {
    const myId = state.auditCurrentUser?.userId;

    state.products.forEach(p => {
        const prodData = areaData[p.id];
        if (!prodData) return;

        if (!state.auditoriaConteoPorUsuario[p.id])
            state.auditoriaConteoPorUsuario[p.id] = {};
        if (!state.auditoriaConteoPorUsuario[p.id][area])
            state.auditoriaConteoPorUsuario[p.id][area] = {};

        Object.keys(prodData).forEach(uid => {
            // Nunca sobreescribir nuestra propia entrada
            if (uid === myId) return;
            state.auditoriaConteoPorUsuario[p.id][area][uid] = prodData[uid];
            console.debug(`[Snapshot][multiUser] Conteo recibido de ${uid} para ${p.id}/${area}`);
        });
    });
}

/**
 * Persiste estado en localStorage y actualiza el hash sin disparar
 * syncToCloud (los datos llegaron de la nube, no del usuario local).
 */
async function _persistCloudUpdate(cloudTs) {
    const { saveToLocalStorage } = await import('./storage.js');
    // Actualizar el hash ANTES de saveToLocalStorage para que el detector
    // de cambios no marque _cloudSyncPending y no dispare syncToCloud
    state._lastDataHash =
        JSON.stringify(state.products)  +
        JSON.stringify(state.orders)    +
        JSON.stringify(state.inventories) +
        JSON.stringify(state.inventarioConteo);
    state._cloudSyncPending = false;
    saveToLocalStorage();
    if (cloudTs) localStorage.setItem('inventarioApp_lastModified', String(cloudTs));
    state._lastCloudSync = Date.now();
}

// ═════════════════════════════════════════════════════════════
//  LISTENER 1 — DOC PRINCIPAL (productos, carrito, auditoría)
// ═════════════════════════════════════════════════════════════

function _subscribeMainDoc() {
    if (!window._db) return;
    const docRef = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);

    console.info('[Snapshot] Activando listener del doc principal…');

    const unsub = docRef.onSnapshot(
        { includeMetadataChanges: true },
        async snap => {
            try {
                if (!snap.exists) {
                    console.info('[Snapshot][main] Doc no existe aún — subiendo datos locales.');
                    await syncToCloud();
                    return;
                }

                if (_shouldIgnoreSnapshot(snap)) return;

                const data    = snap.data();
                const cloudTs = data._lastModified || 0;
                const localTs = parseInt(localStorage.getItem('inventarioApp_lastModified') || '0', 10);

                // Solo aplicar si la nube tiene datos más recientes
                if (cloudTs <= localTs) {
                    console.debug(`[Snapshot][main] Sin cambios nuevos (cloudTs=${cloudTs} ≤ localTs=${localTs}).`);
                    return;
                }

                console.info(`[Snapshot][main] Cambio recibido (cloudTs=${cloudTs}). Aplicando…`);
                await _applyMainDocData(data);
                await _persistCloudUpdate(cloudTs);
                updateCloudSyncBadge('listening');
                _scheduleRender();

            } catch (err) {
                console.error('[Snapshot][main] Error al procesar snapshot:', err);
                updateCloudSyncBadge('error');
            }
        },
        err => {
            console.error('[Snapshot][main] Error en listener:', err);
            updateCloudSyncBadge('error');
        }
    );

    _activeListeners.set('main', unsub);
}

// ═════════════════════════════════════════════════════════════
//  LISTENERS 2-4 — stockAreas/{area} (conteo operativo)
// ═════════════════════════════════════════════════════════════

function _subscribeStockAreas() {
    if (!window._db) return;
    const baseRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('stockAreas');

    for (const area of AREA_KEYS) {
        const areaRef = baseRef.doc(area);

        console.info(`[Snapshot] Activando listener stockAreas/${area}…`);

        const unsub = areaRef.onSnapshot(
            { includeMetadataChanges: true },
            snap => {
                try {
                    if (!snap.exists) return;
                    if (_shouldIgnoreSnapshot(snap)) return;

                    const areaData = snap.data();
                    const cloudTs  = areaData._lastModified || 0;

                    // Comparar con el timestamp del área que teníamos localmente
                    const localAreaTs = _getLocalAreaTs(area);
                    if (cloudTs <= localAreaTs) {
                        console.debug(`[Snapshot][stockArea:${area}] Sin cambios nuevos.`);
                        return;
                    }

                    console.info(`[Snapshot][stockArea:${area}] Conteo actualizado por otro dispositivo.`);
                    _applyStockAreaData(area, areaData);
                    _storeLocalAreaTs(area, cloudTs);
                    updateCloudSyncBadge('listening');
                    _scheduleRender();

                } catch (err) {
                    console.error(`[Snapshot][stockArea:${area}] Error al procesar:`, err);
                }
            },
            err => console.error(`[Snapshot][stockArea:${area}] Error en listener:`, err)
        );

        _activeListeners.set(`stockArea:${area}`, unsub);
    }
}

// ═════════════════════════════════════════════════════════════
//  LISTENERS 5-7 — conteoAreas/{area} (auditoría atómica)
// ═════════════════════════════════════════════════════════════

function _subscribeConteoAreas() {
    if (!window._db) return;
    const baseRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoAreas');

    for (const area of AREA_KEYS) {
        const areaRef = baseRef.doc(area);

        console.info(`[Snapshot] Activando listener conteoAreas/${area}…`);

        const unsub = areaRef.onSnapshot(
            { includeMetadataChanges: true },
            snap => {
                try {
                    if (!snap.exists) return;
                    if (_shouldIgnoreSnapshot(snap)) return;

                    const areaData = snap.data();
                    const cloudTs  = areaData._lastModified || 0;
                    const localTs  = _getLocalAreaTs(`conteo:${area}`);
                    if (cloudTs <= localTs) return;

                    console.info(`[Snapshot][conteoArea:${area}] Conteo de auditoría actualizado.`);
                    _applyConteoAreaData(area, areaData);
                    _storeLocalAreaTs(`conteo:${area}`, cloudTs);
                    updateCloudSyncBadge('listening');
                    _scheduleRender();

                } catch (err) {
                    console.error(`[Snapshot][conteoArea:${area}] Error al procesar:`, err);
                }
            },
            err => console.error(`[Snapshot][conteoArea:${area}] Error en listener:`, err)
        );

        _activeListeners.set(`conteoArea:${area}`, unsub);
    }
}

// ═════════════════════════════════════════════════════════════
//  LISTENERS 8-10 — conteoPorUsuario/{area} (multiusuario)
// ═════════════════════════════════════════════════════════════

function _subscribeConteoPorUsuario() {
    if (!window._db) return;
    const baseRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoPorUsuario');

    for (const area of AREA_KEYS) {
        const areaRef = baseRef.doc(area);

        console.info(`[Snapshot] Activando listener conteoPorUsuario/${area}…`);

        const unsub = areaRef.onSnapshot(
            { includeMetadataChanges: true },
            snap => {
                try {
                    if (!snap.exists) return;
                    if (_shouldIgnoreSnapshot(snap)) return;

                    const areaData = snap.data();
                    const cloudTs  = areaData._lastModified || 0;
                    const localTs  = _getLocalAreaTs(`user:${area}`);
                    if (cloudTs <= localTs) return;

                    console.info(`[Snapshot][userConteo:${area}] Conteo de otro dispositivo recibido.`);
                    _applyUserConteoData(area, areaData);
                    _storeLocalAreaTs(`user:${area}`, cloudTs);
                    updateCloudSyncBadge('listening');
                    _scheduleRender();

                } catch (err) {
                    console.error(`[Snapshot][userConteo:${area}] Error al procesar:`, err);
                }
            },
            err => console.error(`[Snapshot][userConteo:${area}] Error en listener:`, err)
        );

        _activeListeners.set(`userConteo:${area}`, unsub);
    }
}

// ─── Timestamps por área (clave → sessionStorage para no contaminar LS) ──────
function _getLocalAreaTs(key) {
    try { return parseInt(sessionStorage.getItem(`_areaTs:${key}`) || '0', 10); } catch (_) { return 0; }
}
function _storeLocalAreaTs(key, ts) {
    try { sessionStorage.setItem(`_areaTs:${key}`, String(ts)); } catch (_) {}
}

// ═════════════════════════════════════════════════════════════
//  API PÚBLICA — CICLO DE VIDA DE LISTENERS
// ═════════════════════════════════════════════════════════════

/**
 * Inicia todos los listeners en tiempo real.
 * Debe llamarse DESPUÉS de confirmar que el usuario está autenticado.
 * Si ya hay listeners activos, primero los detiene (idempotente).
 */
export function startRealtimeListeners() {
    if (!window._db) {
        console.warn('[Snapshot] Firebase no disponible — listeners no iniciados.');
        return;
    }

    // Idempotente: si ya corren, limpiar primero
    if (_activeListeners.size > 0) {
        console.info('[Snapshot] Listeners ya activos — reiniciando…');
        stopRealtimeListeners();
    }

    console.info('[Snapshot] ══ Iniciando 10 listeners en tiempo real ══');

    _subscribeMainDoc();          // [1]   doc principal
    _subscribeStockAreas();       // [2-4] conteo operativo
    _subscribeConteoAreas();      // [5-7] auditoría atómica
    _subscribeConteoPorUsuario(); // [8-10] multiusuario

    updateCloudSyncBadge('listening');
    console.info(`[Snapshot] ✓ ${_activeListeners.size} listeners activos.`);
}

/**
 * Detiene todos los listeners y libera los recursos.
 * Debe llamarse al cerrar sesión (auth.js → signOutUser).
 * También limpia los timers de debounce pendientes.
 */
export function stopRealtimeListeners() {
    if (_activeListeners.size === 0) return;

    console.info(`[Snapshot] Deteniendo ${_activeListeners.size} listeners…`);
    _activeListeners.forEach((unsub, key) => {
        try {
            unsub();
            console.debug(`[Snapshot] Listener "${key}" detenido.`);
        } catch (e) {
            console.warn(`[Snapshot] Error al detener listener "${key}":`, e);
        }
    });
    _activeListeners.clear();

    // Limpiar debounce pendiente
    clearTimeout(_renderDebounceTimer);
    _renderDebounceTimer = null;

    // Limpiar timestamps de área de sessionStorage
    try {
        const keysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k?.startsWith('_areaTs:')) keysToRemove.push(k);
        }
        keysToRemove.forEach(k => sessionStorage.removeItem(k));
    } catch (_) {}

    updateCloudSyncBadge('none');
    console.info('[Snapshot] ✓ Todos los listeners detenidos.');
}

/** Retorna true si los listeners de tiempo real están activos. */
export function isListening() {
    return _activeListeners.size > 0;
}

// ═════════════════════════════════════════════════════════════
//  SYNC WRITE — SUBIR DATOS A FIRESTORE
// ═════════════════════════════════════════════════════════════

/**
 * Sube el estado actual a Firestore (estrategia último-gana).
 * Actualiza _lastLocalWriteTs antes de escribir para que el
 * listener onSnapshot no procese el eco de confirmación.
 *
 * @param {number} [retryCount=0] — back-off interno, no usar directamente
 */
export async function syncToCloud(retryCount = 0) {
    if (!window._db)             return;
    if (state._syncInProgress)   return;
    if (!navigator.onLine) {
        state._cloudSyncPending = true;
        updateCloudSyncBadge('pending');
        return;
    }

    state._syncInProgress = true;
    updateCloudSyncBadge('syncing');
    console.info('[Firebase] syncToCloud iniciado…');

    try {
        const localTs = parseInt(localStorage.getItem('inventarioApp_lastModified') || '0', 10);
        const docRef  = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);

        // Consulta previa: ¿la nube tiene datos más recientes?
        // (útil en la carga inicial cuando aún no hay listener activo)
        const snap = await docRef.get();
        if (snap.exists) {
            const cloudTs = snap.data()._lastModified || 0;
            if (cloudTs > localTs) {
                console.info('[Firebase] Nube más reciente — aplicando antes de subir.');
                state._syncInProgress = false;
                await _applyMainDocData(snap.data());
                await _persistCloudUpdate(cloudTs);
                _scheduleRender();
                return;
            }
        }

        // Marcar el timestamp que vamos a escribir ANTES del set()
        // para que el handler onSnapshot pueda detectar su eco
        _lastLocalWriteTs = localTs;

        const payload = {
            products:             state.products,
            cart:                 state.cart,
            activeTab:            state.activeTab,
            selectedArea:         state.selectedArea,
            auditoriaStatus:      state.auditoriaStatus,
            auditoriaConteo:      state.auditoriaConteo,
            _lastModified:        localTs,
            _syncedAt:            Date.now(),
            _ordersInChunks:      true,
            _inventoriesInChunks: true,
            _conteoInSubcol:      true,
        };

        // Escribir inventarioConteo por área (merge:true = no sobreescribe otras áreas)
        const stockAreaRef = docRef.collection('stockAreas');
        const areaWrites   = AREA_KEYS.map(area => {
            const ap = { _lastModified: localTs };
            Object.keys(state.inventarioConteo).forEach(prodId => {
                if (state.inventarioConteo[prodId]?.[area]) {
                    ap[prodId] = state.inventarioConteo[prodId][area];
                }
            });
            // Registrar el timestamp localmente para que el listener no lo procese
            _storeLocalAreaTs(area, localTs);
            return stockAreaRef.doc(area).set(ap, { merge: true });
        });

        // Escritura paralela: doc principal + áreas + historiales chunkeados
        await Promise.all([
            docRef.set(payload, { merge: true }),
            ...areaWrites,
            _writeChunkedSubcollection(docRef, 'ordersChunks',      state.orders),
            _writeChunkedSubcollection(docRef, 'inventoriesChunks', state.inventories),
        ]);

        state._cloudSyncPending = false;
        state._lastCloudSync    = Date.now();
        state._syncInProgress   = false;
        updateCloudSyncBadge(_activeListeners.size > 0 ? 'listening' : 'ok');
        console.info(`[Firebase] ✓ Sincronizado: ${new Date(state._lastCloudSync).toLocaleTimeString()}`);

    } catch (err) {
        state._syncInProgress = false;
        console.error('[Firebase] Error en syncToCloud:', err);

        if (retryCount < 3) {
            const delay = Math.pow(2, retryCount + 1) * 1000;
            console.info(`[Firebase] Reintentando en ${delay / 1000}s… (intento ${retryCount + 1}/3)`);
            setTimeout(() => syncToCloud(retryCount + 1), delay);
        } else {
            state._cloudSyncPending = true;
            updateCloudSyncBadge('error');
            showNotification('☁️ Sin sync — datos guardados localmente');
        }
    }
}

// ═════════════════════════════════════════════════════════════
//  ESCRITURA ATÓMICA DE CONTEO POR ÁREA (anticolisión)
// ═════════════════════════════════════════════════════════════

/**
 * Escribe el conteo de auditoría de UN área en Firestore de forma atómica.
 * Registra el timestamp en _storeLocalAreaTs para que el listener
 * onSnapshot de conteoAreas no procese el eco de nuestra propia escritura.
 *
 * @param {string} area - 'almacen' | 'barra1' | 'barra2'
 */
export async function syncConteoAtomicoPorArea(area) {
    if (!window._db) {
        console.info('[Atomico] Firebase no disponible — solo local.');
        return;
    }
    if (!navigator.onLine) {
        showNotification('📴 Sin conexión — conteo guardado localmente');
        updateCloudSyncBadge('offline');
        return;
    }

    updateCloudSyncBadge('syncing');
    const areaRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoAreas')
        .doc(area);

    try {
        const productosConDatos = state.products.filter(p =>
            state.auditoriaConteo[p.id]?.[area]
        );
        if (productosConDatos.length === 0) {
            updateCloudSyncBadge(_activeListeners.size > 0 ? 'listening' : 'ok');
            return;
        }

        const writeTs = Date.now();

        await window._db.runTransaction(async tx => {
            const snap     = await tx.get(areaRef);
            const existing = snap.exists ? snap.data() : {};
            const newData  = { _lastModified: writeTs };

            for (const p of productosConDatos) {
                const local   = state.auditoriaConteo[p.id][area];
                const cloud   = existing[p.id] || {};
                const cloudAb = cloud.abiertas || [];

                newData[p.id] = {
                    enteras:  (local.enteras || 0) + (cloud.enteras || 0),
                    abiertas: local.abiertas || [],
                };

                // Detectar conflicto en botellas abiertas
                if (cloudAb.length > 0) {
                    const ls = (local.abiertas || []).reduce((a, b) => a + b, 0);
                    const cs = cloudAb.reduce((a, b) => a + b, 0);
                    if (Math.abs(ls - cs) > 0.01) {
                        newData[p.id].stock_abierto_alternativo = cloudAb;
                        newData[p.id].alerta_conflicto = true;
                        console.warn(`[Atomico] Conflicto en abiertas — ${p.id}/${area}: local=${ls.toFixed(2)} cloud=${cs.toFixed(2)}`);
                    }
                }
            }
            tx.set(areaRef, newData, { merge: true });
        });

        // Registrar el timestamp para bloquear el eco en el listener
        _storeLocalAreaTs(`conteo:${area}`, writeTs);

        updateCloudSyncBadge(_activeListeners.size > 0 ? 'listening' : 'ok');
        console.info(`[Atomico] ✓ Conteo sincronizado — área: ${area}`);

    } catch (err) {
        console.error('[Atomico] Error en syncConteoAtomicoPorArea:', err);
        updateCloudSyncBadge('error');
        showNotification('⚠️ Error al sincronizar conteo — guardado localmente');
    }
}

// ═════════════════════════════════════════════════════════════
//  ESCRITURA MULTIUSUARIO (conteo por dispositivo)
// ═════════════════════════════════════════════════════════════

export async function syncConteoPorUsuarioToFirestore(area) {
    if (!window._db || !state.auditCurrentUser || !navigator.onLine) return;

    const { userId } = state.auditCurrentUser;
    const userRef    = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoPorUsuario')
        .doc(area);

    const writeTs     = Date.now();
    const userPayload = { _lastModified: writeTs };

    state.products.forEach(p => {
        const byArea = state.auditoriaConteoPorUsuario[p.id]?.[area];
        if (byArea?.[userId]) {
            if (!userPayload[p.id]) userPayload[p.id] = {};
            userPayload[p.id][userId] = byArea[userId];
        }
    });

    try {
        await userRef.set(userPayload, { merge: true });
        // Registrar timestamp para bloquear el eco
        _storeLocalAreaTs(`user:${area}`, writeTs);
        console.info(`[MultiUser] ✓ Conteo de ${state.auditCurrentUser.userName} subido — área: ${area}`);
    } catch (err) {
        console.warn('[MultiUser] Error en syncConteoPorUsuarioToFirestore:', err);
    }
}

// ═════════════════════════════════════════════════════════════
//  RESET DE AUDITORÍA EN FIRESTORE
// ═════════════════════════════════════════════════════════════

export async function resetConteoAtomicoEnFirestore() {
    if (!window._db) return;

    const docRef  = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);
    const baseRef = docRef.collection('conteoAreas');
    const userRef = docRef.collection('conteoPorUsuario');

    try {
        for (const area of AREA_KEYS) {
            await baseRef.doc(area).delete();
            await userRef.doc(area).delete();
            // Limpiar timestamps locales para que no bloqueen la próxima lectura
            _storeLocalAreaTs(`conteo:${area}`, 0);
            _storeLocalAreaTs(`user:${area}`,   0);
        }
        console.info('[Atomico] ✓ Conteo reseteado en Firestore.');
    } catch (err) {
        console.warn('[Atomico] Error al resetear Firestore:', err);
    }
}

// ── Bindings globales (requeridos por el sidebar HTML) ────────
window.syncToCloud = syncToCloud;

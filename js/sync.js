/**
 * js/sync.js
 * ══════════════════════════════════════════════════════════════
 * Sincronización bidireccional en tiempo real con Firebase Firestore.
 *
 * ─── ARQUITECTURA DE LISTENERS (10 onSnapshot activos) ───────
 *   [1]    inventarioApp/{DOC_ID}                  → doc principal
 *   [2-4]  inventarioApp/{DOC_ID}/stockAreas/{area} x3
 *   [5-7]  inventarioApp/{DOC_ID}/conteoAreas/{area} x3
 *   [8-10] inventarioApp/{DOC_ID}/conteoPorUsuario/{area} x3
 *
 * ─── GARANTÍAS TRANSACCIONALES (runTransaction) ──────────────
 *
 *   [T1] txCloseZone(area)
 *        Cierra una zona de auditoría de forma atómica.
 *        Usa update() con dot-notation ('auditoriaStatus.almacen')
 *        para NO sobreescribir el estado de otras zonas.
 *        Idempotente: si la zona ya estaba cerrada, no reescribe.
 *        → Corrige RC-1 y RC-5
 *
 *   [T2] txSyncStockArea(docRef, area, localTs) [privada]
 *        Fusiona el conteo operativo de un área producto por producto.
 *        Lee el doc actual, aplica solo los productos que este
 *        dispositivo tiene datos, preserva el resto.
 *        → Corrige RC-2 para stockAreas
 *
 *   [T3] syncConteoAtomicoPorArea(area) [mejorada]
 *        Rastrea las enteras por userId con _userEntradas:{uid:n}.
 *        Re-envíos REEMPLAZAN la entrada del usuario (no acumulan).
 *        Detecta conflictos en abiertas entre distintos usuarios.
 *        → Corrige RC-3
 *
 *   [T4] syncConteoPorUsuarioToFirestore(area) [mejorada]
 *        Envuelta en runTransaction. Lee, fusiona SOLO el userId
 *        propio (preserva entradas de otros) y escribe.
 *        → Corrige RC-4
 *
 *   [T5] syncToCloud(retryCount) [mejorada]
 *        Doc principal en runTransaction: lee, aplica "completada wins"
 *        en auditoriaStatus, escribe el resultado fusionado.
 *        → Corrige RC-2
 *
 *   [T6] resetConteoAtomicoEnFirestore() [mejorada]
 *        Batch único para los 6 deletes (3 conteoAreas + 3 userConteo)
 *        + runTransaction para resetear auditoriaStatus en el doc.
 *        → Corrige RC-6
 *
 * ─── ANTI-BUCLE (dos capas) ──────────────────────────────────
 *   Capa 1 — metadata.hasPendingWrites: ignora ecos optimistas.
 *   Capa 2 — _lastLocalWriteTs / _storeLocalAreaTs: ignora ecos
 *            de confirmación basándose en timestamps.
 *
 * ─── CICLO DE VIDA ───────────────────────────────────────────
 *   startRealtimeListeners()  ← auth.js al confirmar login
 *   stopRealtimeListeners()   ← auth.js al cerrar sesión
 * ══════════════════════════════════════════════════════════════
 */

import { state }                        from './state.js';
import { AREA_KEYS, MAX_CHUNK_SIZE }    from './constants.js';
import { showNotification }             from './ui.js';
import { syncStockByAreaFromConteo }    from './products.js';

// ─── Registro de listeners ────────────────────────────────────
const _activeListeners = new Map();

// ─── Anti-bucle: timestamp de la última escritura local ───────
let _lastLocalWriteTs = 0;

// ─── Debounce de re-render (múltiples snapshots en paralelo) ──
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
//  HELPERS DE CHUNK (órdenes e inventarios históricos)
// ═════════════════════════════════════════════════════════════

async function _writeChunkedSubcollection(docRef, subcollName, dataArray) {
    const colRef      = docRef.collection(subcollName);
    const totalChunks = Math.max(1, Math.ceil(dataArray.length / MAX_CHUNK_SIZE));

    // Paso 1: escribir con prefijo "new_" (lectores ven chunks viejos)
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

    // Paso 2: renombrar "new_" → definitivos y borrar viejos (write-first)
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
    console.info(`[Firebase][Chunk] ${subcollName} → ${totalChunks} chunk(s) escritos.`);
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
//  BADGE DE SINCRONIZACIÓN
// ═════════════════════════════════════════════════════════════

export function updateCloudSyncBadge(status) {
    const badge = document.getElementById('cloudSyncBadge');
    const dot   = document.getElementById('syncDot');

    const cfg = {
        ok:        { bg: '#06d6a0', icon: '☁️',  text: 'Sincronizado',    pulse: false, dotState: 'ok',      dotTitle: 'Sincronizado ✓' },
        syncing:   { bg: '#4cc9f0', icon: '🔄',  text: 'Sincronizando…',  pulse: true,  dotState: 'syncing', dotTitle: 'Subiendo datos…' },
        pending:   { bg: '#ffd166', icon: '⏳',  text: 'Pendiente',        pulse: false, dotState: 'pending', dotTitle: 'Cambios pendientes' },
        listening: { bg: '#a78bfa', icon: '👂',  text: 'En tiempo real',  pulse: false, dotState: 'ok',      dotTitle: 'Escuchando cambios en vivo' },
        tx:        { bg: '#38bdf8', icon: '🔒',  text: 'Transacción…',    pulse: true,  dotState: 'syncing', dotTitle: 'Transacción en curso' },
        error:     { bg: '#ff6b6b', icon: '⚠️',  text: 'Error sync',      pulse: false, dotState: 'error',   dotTitle: 'Error de sincronización' },
        conflict:  { bg: '#fb923c', icon: '⚡',  text: 'Conflicto',       pulse: false, dotState: 'error',   dotTitle: 'Conflicto detectado' },
        offline:   { bg: '#8b8ca8', icon: '📴',  text: 'Sin conexión',    pulse: false, dotState: 'offline', dotTitle: 'Sin conexión' },
        none:      { bg: '#50516a', icon: '☁️',  text: 'Sin Firebase',    pulse: false, dotState: 'none',    dotTitle: 'Sin Firebase' },
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
//  BARRA DE RED
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
        if (state._cloudSyncPending && window._db) {
            console.info('[Network] Reconectado — sincronizando cambios pendientes…');
            syncToCloud().catch(e => console.warn('[Network] Sync al reconectar falló:', e));
        } else {
            updateCloudSyncBadge(_activeListeners.size > 0 ? 'listening' : (window._db ? 'ok' : 'none'));
        }
    }
}

// ═════════════════════════════════════════════════════════════
//  HELPERS INTERNOS: ignorar snapshots propios
// ═════════════════════════════════════════════════════════════

function _shouldIgnoreSnapshot(snap, localLastModified = _lastLocalWriteTs) {
    // Capa 1: eco optimista (escritura local aún no confirmada)
    if (snap.metadata.hasPendingWrites) {
        console.debug('[Snapshot] Ignorando eco local (hasPendingWrites).');
        return true;
    }
    // Capa 2: confirmación de nuestra propia escritura
    const snapTs = snap.data()?._lastModified || 0;
    if (snapTs > 0 && snapTs <= localLastModified) {
        console.debug(`[Snapshot] Ignorando eco de confirmación (snapTs=${snapTs} ≤ local=${localLastModified}).`);
        return true;
    }
    return false;
}

// ─── Timestamps por área en sessionStorage (no contaminar LS) ─
function _getLocalAreaTs(key) {
    try { return parseInt(sessionStorage.getItem(`_areaTs:${key}`) || '0', 10); } catch (_) { return 0; }
}
function _storeLocalAreaTs(key, ts) {
    try { sessionStorage.setItem(`_areaTs:${key}`, String(ts)); } catch (_) {}
}

// ═════════════════════════════════════════════════════════════
//  HELPERS: aplicar snapshots al estado local
// ═════════════════════════════════════════════════════════════

async function _applyMainDocData(data) {
    if (!data) return;
    const docRef = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);

    if (Array.isArray(data.products))  state.products        = data.products;
    if (Array.isArray(data.cart))      state.cart            = data.cart;
    if (data.activeTab)                state.activeTab       = data.activeTab;
    if (data.selectedArea)             state.selectedArea    = data.selectedArea;
    if (data.auditoriaConteo)          state.auditoriaConteo = data.auditoriaConteo;

    // auditoriaStatus: aplicar "completada wins" al fusionar
    if (data.auditoriaStatus) {
        const mergedStatus = { ...state.auditoriaStatus };
        AREA_KEYS.forEach(a => {
            if (data.auditoriaStatus[a] === 'completada') mergedStatus[a] = 'completada';
        });
        state.auditoriaStatus = mergedStatus;
    }

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

function _applyStockAreaData(area, areaData) {
    Object.keys(areaData).forEach(prodId => {
        if (prodId === '_lastModified') return;
        if (!state.inventarioConteo[prodId]) state.inventarioConteo[prodId] = {};
        state.inventarioConteo[prodId][area] = areaData[prodId];
    });
    syncStockByAreaFromConteo();
}

function _applyConteoAreaData(area, areaData) {
    state.products.forEach(p => {
        if (!areaData[p.id]) return;
        if (!state.auditoriaConteo[p.id])       state.auditoriaConteo[p.id] = {};
        if (!state.auditoriaConteo[p.id][area]) state.auditoriaConteo[p.id][area] = {};

        const cloudEntry = areaData[p.id];
        if (cloudEntry.alerta_conflicto) {
            state.auditoriaConteo[p.id][area]._conflictoAbiertas =
                cloudEntry.stock_abierto_alternativo;
            console.warn(`[Snapshot][conteoArea] Conflicto detectado: ${p.id}/${area}`);
        } else {
            delete state.auditoriaConteo[p.id][area]._conflictoAbiertas;
        }

        // Actualizar el totalizador local con los datos de la nube
        if (typeof cloudEntry.enteras === 'number') {
            state.auditoriaConteo[p.id][area].enteras = cloudEntry.enteras;
        }
    });
}

function _applyUserConteoData(area, areaData) {
    const myId = state.auditCurrentUser?.userId;
    state.products.forEach(p => {
        const prodData = areaData[p.id];
        if (!prodData) return;
        if (!state.auditoriaConteoPorUsuario[p.id])       state.auditoriaConteoPorUsuario[p.id] = {};
        if (!state.auditoriaConteoPorUsuario[p.id][area]) state.auditoriaConteoPorUsuario[p.id][area] = {};
        Object.keys(prodData).forEach(uid => {
            if (uid === myId) return; // nunca sobreescribir el propio
            if (uid.startsWith('_')) return; // ignorar campos internos
            state.auditoriaConteoPorUsuario[p.id][area][uid] = prodData[uid];
            console.debug(`[Snapshot][multiUser] Conteo de ${uid} para ${p.id}/${area}`);
        });
    });
}

async function _persistCloudUpdate(cloudTs) {
    const { saveToLocalStorage } = await import('./storage.js');
    // Hash actualizado ANTES de saveToLocalStorage para no disparar syncToCloud
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
//  LISTENERS onSnapshot
// ═════════════════════════════════════════════════════════════

function _subscribeMainDoc() {
    if (!window._db) return;
    const docRef = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);
    console.info('[Snapshot] Activando listener del doc principal…');

    const unsub = docRef.onSnapshot(
        { includeMetadataChanges: true },
        async snap => {
            try {
                if (!snap.exists) { await syncToCloud(); return; }
                if (_shouldIgnoreSnapshot(snap)) return;
                const data    = snap.data();
                const cloudTs = data._lastModified || 0;
                const localTs = parseInt(localStorage.getItem('inventarioApp_lastModified') || '0', 10);
                if (cloudTs <= localTs) return;
                console.info(`[Snapshot][main] Cambio recibido (Δts=${cloudTs - localTs}ms). Aplicando…`);
                await _applyMainDocData(data);
                await _persistCloudUpdate(cloudTs);
                updateCloudSyncBadge('listening');
                _scheduleRender();
            } catch (err) {
                console.error('[Snapshot][main] Error al procesar:', err);
                updateCloudSyncBadge('error');
            }
        },
        err => { console.error('[Snapshot][main] Error en listener:', err); updateCloudSyncBadge('error'); }
    );
    _activeListeners.set('main', unsub);
}

function _subscribeStockAreas() {
    if (!window._db) return;
    const baseRef = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID).collection('stockAreas');

    for (const area of AREA_KEYS) {
        console.info(`[Snapshot] Activando listener stockAreas/${area}…`);
        const unsub = baseRef.doc(area).onSnapshot(
            { includeMetadataChanges: true },
            snap => {
                try {
                    if (!snap.exists) return;
                    if (_shouldIgnoreSnapshot(snap, _getLocalAreaTs(area))) return;
                    const areaData = snap.data();
                    const cloudTs  = areaData._lastModified || 0;
                    if (cloudTs <= _getLocalAreaTs(area)) return;
                    console.info(`[Snapshot][stockArea:${area}] Conteo actualizado por otro dispositivo.`);
                    _applyStockAreaData(area, areaData);
                    _storeLocalAreaTs(area, cloudTs);
                    updateCloudSyncBadge('listening');
                    _scheduleRender();
                } catch (err) {
                    console.error(`[Snapshot][stockArea:${area}] Error:`, err);
                }
            },
            err => console.error(`[Snapshot][stockArea:${area}] Error en listener:`, err)
        );
        _activeListeners.set(`stockArea:${area}`, unsub);
    }
}

function _subscribeConteoAreas() {
    if (!window._db) return;
    const baseRef = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID).collection('conteoAreas');

    for (const area of AREA_KEYS) {
        console.info(`[Snapshot] Activando listener conteoAreas/${area}…`);
        const unsub = baseRef.doc(area).onSnapshot(
            { includeMetadataChanges: true },
            snap => {
                try {
                    if (!snap.exists) return;
                    if (_shouldIgnoreSnapshot(snap, _getLocalAreaTs(`conteo:${area}`))) return;
                    const areaData = snap.data();
                    const cloudTs  = areaData._lastModified || 0;
                    if (cloudTs <= _getLocalAreaTs(`conteo:${area}`)) return;
                    console.info(`[Snapshot][conteoArea:${area}] Conteo de auditoría actualizado.`);
                    _applyConteoAreaData(area, areaData);
                    _storeLocalAreaTs(`conteo:${area}`, cloudTs);
                    updateCloudSyncBadge('listening');
                    _scheduleRender();
                } catch (err) {
                    console.error(`[Snapshot][conteoArea:${area}] Error:`, err);
                }
            },
            err => console.error(`[Snapshot][conteoArea:${area}] Error en listener:`, err)
        );
        _activeListeners.set(`conteoArea:${area}`, unsub);
    }
}

function _subscribeConteoPorUsuario() {
    if (!window._db) return;
    const baseRef = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID).collection('conteoPorUsuario');

    for (const area of AREA_KEYS) {
        console.info(`[Snapshot] Activando listener conteoPorUsuario/${area}…`);
        const unsub = baseRef.doc(area).onSnapshot(
            { includeMetadataChanges: true },
            snap => {
                try {
                    if (!snap.exists) return;
                    if (_shouldIgnoreSnapshot(snap, _getLocalAreaTs(`user:${area}`))) return;
                    const areaData = snap.data();
                    const cloudTs  = areaData._lastModified || 0;
                    if (cloudTs <= _getLocalAreaTs(`user:${area}`)) return;
                    console.info(`[Snapshot][userConteo:${area}] Conteo de otro dispositivo recibido.`);
                    _applyUserConteoData(area, areaData);
                    _storeLocalAreaTs(`user:${area}`, cloudTs);
                    updateCloudSyncBadge('listening');
                    _scheduleRender();
                } catch (err) {
                    console.error(`[Snapshot][userConteo:${area}] Error:`, err);
                }
            },
            err => console.error(`[Snapshot][userConteo:${area}] Error en listener:`, err)
        );
        _activeListeners.set(`userConteo:${area}`, unsub);
    }
}

// ═════════════════════════════════════════════════════════════
//  CICLO DE VIDA DE LISTENERS
// ═════════════════════════════════════════════════════════════

export function startRealtimeListeners() {
    if (!window._db) { console.warn('[Snapshot] Firebase no disponible.'); return; }
    if (_activeListeners.size > 0) { console.info('[Snapshot] Reiniciando listeners…'); stopRealtimeListeners(); }
    console.info('[Snapshot] ══ Iniciando 10 listeners en tiempo real ══');
    _subscribeMainDoc();
    _subscribeStockAreas();
    _subscribeConteoAreas();
    _subscribeConteoPorUsuario();
    updateCloudSyncBadge('listening');
    console.info(`[Snapshot] ✓ ${_activeListeners.size} listeners activos.`);
}

export function stopRealtimeListeners() {
    if (_activeListeners.size === 0) return;
    console.info(`[Snapshot] Deteniendo ${_activeListeners.size} listeners…`);
    _activeListeners.forEach((unsub, key) => {
        try { unsub(); console.debug(`[Snapshot] Listener "${key}" detenido.`); }
        catch (e) { console.warn(`[Snapshot] Error al detener "${key}":`, e); }
    });
    _activeListeners.clear();
    clearTimeout(_renderDebounceTimer);
    _renderDebounceTimer = null;
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

export function isListening() {
    return _activeListeners.size > 0;
}

// ═════════════════════════════════════════════════════════════
//  [T1] txCloseZone — CIERRE ATÓMICO DE ZONA
// ═════════════════════════════════════════════════════════════
/**
 * Cierra atómicamente una zona de auditoría en Firestore.
 *
 * PROBLEMA RESUELTO (RC-1, RC-5):
 *   Sin transacción, dos dispositivos cerrando zonas distintas al mismo
 *   tiempo sobreescriben el campo auditoriaStatus completo. El dispositivo
 *   que escribe último "re-abre" la zona cerrada por el otro.
 *
 * SOLUCIÓN:
 *   1. runTransaction lee el estado actual de auditoriaStatus.
 *   2. Aplica regla "completada always wins": si la zona ya estaba cerrada
 *      en Firestore (por otro dispositivo), no vuelve a escribir (idempotente).
 *   3. Usa tx.update() con dot-notation ('auditoriaStatus.almacen') en lugar
 *      de tx.set({auditoriaStatus: {...}}) para escribir SOLO el campo de
 *      esta zona, dejando intactos los de las otras zonas.
 *
 * @param {string} area - 'almacen' | 'barra1' | 'barra2'
 * @returns {{ wasAlreadyClosed: boolean, mergedStatus: object }}
 */
export async function txCloseZone(area) {
    if (!window._db) {
        console.info('[TxCloseZone] Firebase no disponible — solo local.');
        return { wasAlreadyClosed: false, mergedStatus: state.auditoriaStatus };
    }
    if (!navigator.onLine) {
        console.info('[TxCloseZone] Sin conexión — cierre guardado localmente.');
        return { wasAlreadyClosed: false, mergedStatus: state.auditoriaStatus };
    }

    const docRef  = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);
    const writeTs = Date.now();
    updateCloudSyncBadge('tx');

    try {
        const result = await window._db.runTransaction(async tx => {
            const snap        = await tx.get(docRef);
            const cloudStatus = snap.exists ? (snap.data()?.auditoriaStatus || {}) : {};

            // ── Idempotencia: la zona ya fue cerrada en Firestore ──────────
            if (cloudStatus[area] === 'completada') {
                console.info(`[TxCloseZone] Zona "${area}" ya estaba cerrada en Firestore (idempotente).`);
                return { wasAlreadyClosed: true, mergedStatus: cloudStatus };
            }

            // ── Escritura con dot-notation: solo toca este campo ──────────
            // tx.update() con 'auditoriaStatus.almacen' NO toca barra1/barra2
            // tx.set({auditoriaStatus: {...}}) SOBREESCRIBIRÍA toda la sub-map
            tx.update(docRef, {
                [`auditoriaStatus.${area}`]: 'completada',
                _lastModified: writeTs,
            });

            // Construir el estado fusionado que tendrá Firestore después
            const mergedStatus = {
                almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente',
                ...cloudStatus,
                [area]: 'completada',
            };
            return { wasAlreadyClosed: false, mergedStatus };
        });

        // Registrar nuestro timestamp para bloquear el eco del onSnapshot
        _lastLocalWriteTs = writeTs;
        _storeLocalAreaTs('mainDoc', writeTs);

        // Sincronizar el estado local con el resultado de Firestore
        if (result.mergedStatus) {
            state.auditoriaStatus = result.mergedStatus;
        }

        const badge = result.wasAlreadyClosed ? 'listening' : 'listening';
        updateCloudSyncBadge(badge);
        console.info(`[TxCloseZone] ✓ Zona "${area}" cerrada${result.wasAlreadyClosed ? ' (ya estaba, idempotente)' : ' en Firestore'}.`);
        return result;

    } catch (err) {
        console.error('[TxCloseZone] Error en transacción:', err.code || err.message, err);
        updateCloudSyncBadge('error');
        showNotification('⚠️ Error al cerrar zona — estado guardado localmente');
        // Devolver el estado local para que audit.js siga funcionando
        return { wasAlreadyClosed: false, mergedStatus: state.auditoriaStatus, error: err };
    }
}

// ═════════════════════════════════════════════════════════════
//  [T2] HELPER PRIVADO: _txMergeStockArea
// ═════════════════════════════════════════════════════════════
/**
 * Fusiona el conteo operativo de un área dentro de una transacción.
 *
 * PROBLEMA RESUELTO (RC-2 para stockAreas):
 *   set(ap, {merge:true}) fusiona a nivel de documento, pero no a nivel
 *   de campo dentro del mapa. Si dos dispositivos actualizan productos
 *   distintos del mismo área simultáneamente, uno puede sobreescribir
 *   los productos del otro.
 *
 * SOLUCIÓN:
 *   Leer el documento de área dentro de la transacción, fusionar
 *   producto a producto (este dispositivo solo actualiza sus propios
 *   productos, preserva los demás), y escribir el resultado.
 *
 * @param {firebase.firestore.Transaction} tx
 * @param {firebase.firestore.DocumentReference} areaRef
 * @param {string} area
 * @param {number} localTs
 */
async function _txMergeStockArea(tx, areaRef, area, localTs) {
    const snap        = await tx.get(areaRef);
    const cloudData   = snap.exists ? snap.data() : {};
    const cloudAreaTs = cloudData._lastModified || 0;

    // Si la nube tiene datos más recientes para esta área, no sobreescribir
    if (cloudAreaTs > localTs) {
        console.debug(`[TxStockArea] Área "${area}" más reciente en nube (${cloudAreaTs} > ${localTs}). No sobreescribir.`);
        return false; // sin escritura
    }

    // Fusionar: este dispositivo escribe sus productos, preserva los del resto
    const mergedData = { ...cloudData, _lastModified: localTs };
    Object.keys(state.inventarioConteo).forEach(prodId => {
        if (state.inventarioConteo[prodId]?.[area]) {
            mergedData[prodId] = state.inventarioConteo[prodId][area];
        }
    });

    tx.set(areaRef, mergedData);
    console.debug(`[TxStockArea] Área "${area}" fusionada correctamente.`);
    return true; // escritura realizada
}

// ═════════════════════════════════════════════════════════════
//  [T5] syncToCloud — SUBIDA PRINCIPAL (TRANSACCIONAL)
// ═════════════════════════════════════════════════════════════
/**
 * Sube el estado local a Firestore usando runTransaction para el doc
 * principal. Garantiza atomicidad en el par lectura-escritura.
 *
 * PROBLEMAS RESUELTOS:
 *   RC-1: auditoriaStatus se fusiona campo a campo con "completada wins".
 *         Ningún dispositivo puede re-abrir una zona que otro ya cerró.
 *   RC-2: La transacción elimina la ventana TOCTOU entre get() y set().
 *
 * FUSIÓN DE auditoriaStatus dentro de la transacción:
 *   La regla "completada always wins" se aplica tanto a datos locales como
 *   a datos de Firestore. Si Firestore tiene una zona como completada y el
 *   estado local la tiene como pendiente (porque ese dispositivo no la
 *   cerró), la zona permanece completada en el resultado final.
 *
 * @param {number} [retryCount=0]
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
    console.info('[Firebase] syncToCloud (transaccional) iniciado…');

    try {
        const localTs  = parseInt(localStorage.getItem('inventarioApp_lastModified') || '0', 10);
        const docRef   = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);
        const stockRef = docRef.collection('stockAreas');

        // Referencias de áreas para incluir en la transacción
        const areaRefs = AREA_KEYS.map(a => stockRef.doc(a));

        // ── Transacción: doc principal + 3 stockAreas (4 reads + 4 writes) ──
        let transactionResult = null;

        await window._db.runTransaction(async tx => {
            // Lee el doc principal y las 3 áreas en paralelo dentro de la tx
            const [mainSnap, ...areaSnaps] = await Promise.all([
                tx.get(docRef),
                ...areaRefs.map(r => tx.get(r)),
            ]);

            // ── Verificar timestamp: ¿la nube tiene datos más recientes? ──
            if (mainSnap.exists) {
                const cloudTs = mainSnap.data()._lastModified || 0;
                if (cloudTs > localTs) {
                    console.info(`[Firebase][Tx] Nube más reciente (Δ${cloudTs - localTs}ms). Abortando escritura.`);
                    transactionResult = { action: 'applyCloud', cloudData: mainSnap.data() };
                    // No escribir nada: transacción solo de lectura
                    return;
                }
            }

            // ── Fusionar auditoriaStatus: "completada always wins" ────────
            const cloudStatus = mainSnap.exists ? (mainSnap.data()?.auditoriaStatus || {}) : {};
            const mergedStatus = {};
            AREA_KEYS.forEach(a => {
                // La zona se marca completada si CUALQUIERA de los dos
                // (local o cloud) la tiene como completada. Nunca se re-abre.
                mergedStatus[a] =
                    (cloudStatus[a] === 'completada' || state.auditoriaStatus[a] === 'completada')
                        ? 'completada'
                        : (state.auditoriaStatus[a] || cloudStatus[a] || 'pendiente');
            });

            // ── Construir payload del doc principal ───────────────────────
            _lastLocalWriteTs = localTs; // anti-eco ANTES de la escritura
            const payload = {
                products:             state.products,
                cart:                 state.cart,
                activeTab:            state.activeTab,
                selectedArea:         state.selectedArea,
                auditoriaStatus:      mergedStatus, // fusionado, no sobrescrito
                auditoriaConteo:      state.auditoriaConteo,
                _lastModified:        localTs,
                _syncedAt:            Date.now(),
                _ordersInChunks:      true,
                _inventoriesInChunks: true,
                _conteoInSubcol:      true,
            };
            tx.set(docRef, payload, { merge: true });

            // ── Fusionar stockAreas producto a producto ───────────────────
            areaSnaps.forEach((areaSnap, idx) => {
                const area      = AREA_KEYS[idx];
                const cloudArea = areaSnap.exists ? areaSnap.data() : {};
                const cloudAreaTs = cloudArea._lastModified || 0;

                // Si el área es más reciente en nube, preservarla
                if (cloudAreaTs > localTs) {
                    console.debug(`[Firebase][Tx] stockArea "${area}" más reciente en nube — preservando.`);
                    return;
                }

                const mergedArea = { ...cloudArea, _lastModified: localTs };
                Object.keys(state.inventarioConteo).forEach(prodId => {
                    if (state.inventarioConteo[prodId]?.[area]) {
                        mergedArea[prodId] = state.inventarioConteo[prodId][area];
                    }
                });
                tx.set(areaRefs[idx], mergedArea);
                _storeLocalAreaTs(area, localTs); // anti-eco para stockArea listener
            });

            transactionResult = { action: 'wrote', mergedStatus };
        });

        // ── Después de la transacción: acciones según resultado ───────────
        if (transactionResult?.action === 'applyCloud') {
            // La nube tiene datos más recientes → aplicar y no subir
            state._syncInProgress = false;
            await _applyMainDocData(transactionResult.cloudData);
            await _persistCloudUpdate(transactionResult.cloudData._lastModified);
            _scheduleRender();
            return;
        }

        if (transactionResult?.mergedStatus) {
            // Actualizar estado local con el auditoriaStatus fusionado
            state.auditoriaStatus = transactionResult.mergedStatus;
        }

        // Historiales chunkeados: fuera de la transacción (son batch separados)
        // Es seguro hacerlo fuera porque son datos históricos append-only.
        await Promise.all([
            _writeChunkedSubcollection(docRef, 'ordersChunks',      state.orders),
            _writeChunkedSubcollection(docRef, 'inventoriesChunks', state.inventories),
        ]);

        state._cloudSyncPending = false;
        state._lastCloudSync    = Date.now();
        state._syncInProgress   = false;
        updateCloudSyncBadge(_activeListeners.size > 0 ? 'listening' : 'ok');
        console.info(`[Firebase] ✓ syncToCloud completado: ${new Date(state._lastCloudSync).toLocaleTimeString()}`);

    } catch (err) {
        state._syncInProgress = false;
        console.error('[Firebase] Error en syncToCloud:', err.code || err.message, err);

        if (retryCount < 3) {
            const delay = Math.pow(2, retryCount + 1) * 1000;
            console.info(`[Firebase] Reintentando en ${delay / 1000}s… (${retryCount + 1}/3)`);
            setTimeout(() => syncToCloud(retryCount + 1), delay);
        } else {
            state._cloudSyncPending = true;
            updateCloudSyncBadge('error');
            showNotification('☁️ Sin sync — datos guardados localmente');
        }
    }
}

// ═════════════════════════════════════════════════════════════
//  [T3] syncConteoAtomicoPorArea — CONTEO SIN ACUMULACIÓN
// ═════════════════════════════════════════════════════════════
/**
 * Sincroniza el conteo de auditoría de un área en Firestore.
 *
 * PROBLEMA RESUELTO (RC-3 — acumulación incorrecta de enteras):
 *   El código anterior hacía:
 *     enteras = (local.enteras || 0) + (cloud.enteras || 0)
 *   Si un usuario re-enviaba su conteo, sus botellas se SUMABAN dos
 *   veces al total. Con 10 usuarios, un re-envío producía totales
 *   completamente incorrectos.
 *
 * SOLUCIÓN — _userEntradas:
 *   Se mantiene un mapa { userId → enteras } por producto y área:
 *     _userEntradas: { "usr-abc": 10, "usr-def": 8 }
 *   El total visible (enteras) = Σ(values de _userEntradas).
 *   Cuando un usuario re-envía, se REEMPLAZA su entrada anterior.
 *   El total se recalcula desde cero sobre el mapa actualizado.
 *
 * DETECCIÓN DE CONFLICTOS EN ABIERTAS:
 *   Se mantiene un mapa { userId → [pesos en oz] } (_abiertasByUser).
 *   Si dos o más usuarios tienen sumas distintas de abiertas, se
 *   activa alerta_conflicto y se guarda la alternativa en
 *   stock_abierto_alternativo (backward compatible con la UI).
 *
 * @param {string} area - 'almacen' | 'barra1' | 'barra2'
 */
export async function syncConteoAtomicoPorArea(area) {
    if (!window._db) {
        console.info('[TxConteo] Firebase no disponible — solo local.');
        return;
    }
    if (!navigator.onLine) {
        showNotification('📴 Sin conexión — conteo guardado localmente');
        updateCloudSyncBadge('offline');
        return;
    }

    const userId   = state.auditCurrentUser?.userId   || 'usr-anon';
    const userName = state.auditCurrentUser?.userName  || 'Anónimo';

    const areaRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoAreas')
        .doc(area);

    const productosConDatos = state.products.filter(p =>
        state.auditoriaConteo[p.id]?.[area]
    );

    if (productosConDatos.length === 0) {
        console.debug(`[TxConteo] Sin datos locales para área "${area}".`);
        return;
    }

    const writeTs = Date.now();
    updateCloudSyncBadge('tx');

    try {
        await window._db.runTransaction(async tx => {
            const snap     = await tx.get(areaRef);
            const existing = snap.exists ? snap.data() : {};
            const newData  = { _lastModified: writeTs, _area: area };

            for (const p of productosConDatos) {
                const localConteo = state.auditoriaConteo[p.id][area];
                const cloudEntry  = existing[p.id] || {};

                // ── Fusionar _userEntradas: REEMPLAZAR, no acumular ──────────
                // Clonar el mapa existente de otros usuarios y reemplazar solo
                // la entrada de ESTE usuario. Preserva las de los demás.
                const userEntradas = { ...(cloudEntry._userEntradas || {}) };
                userEntradas[userId] = localConteo.enteras || 0;

                // Total = suma de TODAS las entradas del mapa (incluye este usuario)
                const totalEnteras = Object.values(userEntradas)
                    .reduce((acc, n) => acc + (typeof n === 'number' ? n : 0), 0);

                // ── Fusionar _abiertasByUser: mismo patrón ────────────────────
                const abiertasByUser = { ...(cloudEntry._abiertasByUser || {}) };
                abiertasByUser[userId] = localConteo.abiertas || [];

                // ── Detectar conflictos en abiertas ───────────────────────────
                // Conflicto = dos o más usuarios con sumas de abiertas distintas
                const userAbiertas = Object.entries(abiertasByUser);
                let alertaConflicto   = false;
                let stockAlternativo  = null;

                if (userAbiertas.length >= 2) {
                    const sums = userAbiertas.map(([, arr]) =>
                        (Array.isArray(arr) ? arr : []).reduce((a, b) => a + b, 0)
                    );
                    const minSum = Math.min(...sums);
                    const maxSum = Math.max(...sums);

                    if (maxSum - minSum > 0.01) {
                        alertaConflicto = true;
                        // Stock alternativo = primer usuario diferente al actual
                        const otherEntry = userAbiertas.find(([uid]) => uid !== userId);
                        stockAlternativo = otherEntry ? otherEntry[1] : [];
                        console.warn(
                            `[TxConteo] Conflicto en abiertas — ${p.id}/${area}:`,
                            `usuarios=[${userAbiertas.map(([uid]) => uid.slice(0,8)).join(',')}]`,
                            `sums=[${sums.map(s => s.toFixed(2)).join(',')}]`
                        );
                    }
                }

                // ── Construir entrada del producto en Firestore ───────────────
                const productData = {
                    // Totales visibles (usados por onSnapshot → _applyConteoAreaData)
                    enteras:       totalEnteras,
                    abiertas:      localConteo.abiertas || [], // abiertas de este usuario
                    // Mapas de trazabilidad (para detección de conflictos y re-envíos)
                    _userEntradas:   userEntradas,
                    _abiertasByUser: abiertasByUser,
                    _lastContadorId:   userId,
                    _lastContadorName: userName,
                    _lastTs:           writeTs,
                    _totalContadores:  Object.keys(userEntradas).length,
                };

                if (alertaConflicto) {
                    productData.alerta_conflicto          = true;
                    productData.stock_abierto_alternativo = stockAlternativo;
                } else {
                    // Limpiar conflicto previo si ya no existe
                    productData.alerta_conflicto          = false;
                    productData.stock_abierto_alternativo = null;
                }

                newData[p.id] = productData;
            }

            // Usar set(merge:true) para preservar productos de otras transacciones
            // que podrían estar escribiendo en paralelo para otros productos
            tx.set(areaRef, newData, { merge: true });
        });

        // Registrar timestamp para bloquear eco en el listener onSnapshot
        _storeLocalAreaTs(`conteo:${area}`, writeTs);

        updateCloudSyncBadge(_activeListeners.size > 0 ? 'listening' : 'ok');
        console.info(
            `[TxConteo] ✓ Conteo de "${userName}" guardado en "${area}"`,
            `(${productosConDatos.length} productos, userId=${userId.slice(0,12)}…)`
        );

    } catch (err) {
        console.error('[TxConteo] Error en transacción:', err.code || err.message, err);
        updateCloudSyncBadge('error');
        showNotification('⚠️ Error al sincronizar conteo — guardado localmente');
        throw err; // re-lanzar para que audit.js pueda manejarlo
    }
}

// ═════════════════════════════════════════════════════════════
//  [T4] syncConteoPorUsuarioToFirestore — TRANSACCIONAL
// ═════════════════════════════════════════════════════════════
/**
 * Guarda el conteo individual de ESTE dispositivo en conteoPorUsuario.
 *
 * PROBLEMA RESUELTO (RC-4):
 *   set(userPayload, {merge:true}) sin transacción tiene una ventana
 *   de race condition si el mismo usuario envía dos veces rápido
 *   (doble tap), o si dos llamadas de syncConteoPorUsuarioToFirestore
 *   corren en paralelo por algún motivo.
 *
 * SOLUCIÓN:
 *   runTransaction lee el documento actual, aplica SOLO los cambios
 *   de este userId (preservando los de otros), y escribe el resultado
 *   de forma atómica. Incluye un contador _version para detectar
 *   re-envíos y registrar la evolución del conteo.
 *
 * @param {string} area - 'almacen' | 'barra1' | 'barra2'
 */
export async function syncConteoPorUsuarioToFirestore(area) {
    if (!window._db || !state.auditCurrentUser || !navigator.onLine) return;

    const { userId, userName } = state.auditCurrentUser;
    const userRef    = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoPorUsuario')
        .doc(area);

    const writeTs = Date.now();

    // Recopilar los conteos de este usuario para esta área
    const misConteos = {};
    state.products.forEach(p => {
        const byArea = state.auditoriaConteoPorUsuario[p.id]?.[area];
        if (byArea?.[userId]) misConteos[p.id] = byArea[userId];
    });

    if (Object.keys(misConteos).length === 0) {
        console.debug(`[TxUserConteo] Sin conteos propios para área "${area}". Omitiendo.`);
        return;
    }

    try {
        await window._db.runTransaction(async tx => {
            const snap     = await tx.get(userRef);
            const existing = snap.exists ? snap.data() : {};

            // Clonar el documento preservando TODOS los otros usuarios
            const merged = { ...existing, _lastModified: writeTs, _area: area };

            // Escribir SOLO los productos de este usuario
            Object.entries(misConteos).forEach(([prodId, conteo]) => {
                if (!merged[prodId]) merged[prodId] = {};

                const prevVersion = existing[prodId]?.[userId]?._version || 0;
                merged[prodId][userId] = {
                    ...conteo,
                    userId:   userId,
                    userName: userName,
                    ts:       writeTs,
                    _version: prevVersion + 1, // contador de re-envíos (debug)
                };
            });

            tx.set(userRef, merged);
        });

        // Registrar timestamp para bloquear eco en el listener onSnapshot
        _storeLocalAreaTs(`user:${area}`, writeTs);

        console.info(
            `[TxUserConteo] ✓ Conteo de "${userName}" guardado en conteoPorUsuario/${area}`,
            `(${Object.keys(misConteos).length} productos)`
        );

    } catch (err) {
        console.warn('[TxUserConteo] Error en transacción:', err.code || err.message, err);
        // No re-lanzar: este sync es secundario y no debe bloquear el flujo
    }
}

// ═════════════════════════════════════════════════════════════
//  [T6] resetConteoAtomicoEnFirestore — BATCH + TRANSACTION
// ═════════════════════════════════════════════════════════════
/**
 * Reinicia todos los documentos de conteo en Firestore.
 *
 * PROBLEMA RESUELTO (RC-6):
 *   Los deletes secuenciales con await entre cada uno dejan ventanas
 *   donde los listeners onSnapshot pueden recibir documentos parcialmente
 *   borrados y re-aplicar datos inconsistentes al estado local.
 *
 * SOLUCIÓN:
 *   1. Batch atómico para los 6 deletes (conteoAreas x3 + conteoPorUsuario x3).
 *      Si un delete falla, todos fallan. No hay estado parcial.
 *   2. runTransaction para resetear auditoriaStatus en el doc principal,
 *      asegurando que la actualización sea atómica con el _lastModified.
 */
export async function resetConteoAtomicoEnFirestore() {
    if (!window._db) return;

    const docRef  = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);
    const baseRef = docRef.collection('conteoAreas');
    const userRef = docRef.collection('conteoPorUsuario');

    const resetTs = Date.now();
    updateCloudSyncBadge('tx');

    try {
        // ── Batch: todos los deletes en una única operación atómica ──────
        const batch = window._db.batch();
        AREA_KEYS.forEach(area => {
            batch.delete(baseRef.doc(area));
            batch.delete(userRef.doc(area));
        });
        await batch.commit();
        console.info('[TxReset] Batch de deletes completado (6 documentos).');

        // ── Transaction: resetear auditoriaStatus en el doc principal ────
        await window._db.runTransaction(async tx => {
            const snap = await tx.get(docRef);
            if (!snap.exists) return;

            // Usar dot-notation para resetear cada zona independientemente
            tx.update(docRef, {
                'auditoriaStatus.almacen': 'pendiente',
                'auditoriaStatus.barra1':  'pendiente',
                'auditoriaStatus.barra2':  'pendiente',
                auditoriaConteo:           {},
                _lastModified:             resetTs,
            });
        });

        // Limpiar timestamps locales (para que los listeners procesen el reset)
        _lastLocalWriteTs = resetTs;
        AREA_KEYS.forEach(area => {
            _storeLocalAreaTs(`conteo:${area}`, 0);
            _storeLocalAreaTs(`user:${area}`,   0);
        });

        updateCloudSyncBadge(_activeListeners.size > 0 ? 'listening' : 'ok');
        console.info('[TxReset] ✓ Auditoría reseteada en Firestore (batch + transaction).');

    } catch (err) {
        console.error('[TxReset] Error al resetear Firestore:', err.code || err.message, err);
        updateCloudSyncBadge('error');
        throw err;
    }
}

// ── Binding global (sidebar HTML) ────────────────────────────
window.syncToCloud = syncToCloud;

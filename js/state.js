/**
 * js/state.js
 * ══════════════════════════════════════════════════════════════
 * Fuente única de verdad (Single Source of Truth) para el estado
 * mutable de la aplicación.
 *
 * PATRÓN: objeto `state` exportado — los módulos importan y mutan
 *   directamente las propiedades (ej. state.products = [...]).
 *   Esto funciona porque los objetos JS se pasan por referencia.
 *
 * NUNCA reasignar el objeto state completo (state = {...}) desde
 * fuera del módulo — solo mutar sus propiedades.
 * ══════════════════════════════════════════════════════════════
 */

export const state = {

    // ── Datos principales ──────────────────────────────────────
    /** @type {Array<{id:string, name:string, unit:string, group:string, stockByArea:object, capacidadMl?:number, pesoBotellaLlenaOz?:number}>} */
    products: [],

    /** @type {Array<{id:string, name:string, unit:string, group:string, quantity:number}>} */
    cart: [],

    /** @type {Array} */
    orders: [],

    /** @type {Array} */
    inventories: [],

    // ── Navegación / UI ─────────────────────────────────────────
    activeTab:      'inicio',
    editingProductId: null,
    searchTerm:     '',
    selectedGroup:  'Todos',
    selectedArea:   'almacen',

    /** @type {Set<string>} */
    expandedInventories: new Set(),

    /** @type {Set<string>} */
    expandedCards: new Set(),

    // ── Conteo de inventario operativo ──────────────────────────
    /**
     * { productId: { area: { enteras: number, abiertas: number[] } } }
     * area ∈ ['almacen', 'barra1', 'barra2']
     */
    inventarioConteo: {},
    inventarioModalProductId: null,
    isInventarioModalOpen: false,

    // ── Auditoría Física Ciega ──────────────────────────────────
    /** 'selection' | 'counting' */
    auditoriaView:      'selection',
    auditoriaAreaActiva: null,
    auditoriaStatus: {
        almacen: 'pendiente',
        barra1:  'pendiente',
        barra2:  'pendiente'
    },
    /** { productId: { area: { enteras, abiertas } } } */
    auditoriaConteo: {},
    isAuditoriaMode: false,

    // ── Multiusuario (conteo por dispositivo) ───────────────────
    /**
     * { userId: string, userName: string, createdAt: number }
     * Se genera una sola vez y persiste en localStorage.
     */
    auditCurrentUser: null,
    /**
     * { productId: { area: { userId: { userId, userName, enteras, abiertas, ts } } } }
     * Estructura aditiva — cada dispositivo escribe SOLO su userId.
     */
    auditoriaConteoPorUsuario: {},

    // ── Sincronización con la nube ───────────────────────────────
    /** true cuando hay cambios locales sin subir a Firestore */
    _cloudSyncPending: false,
    /** timestamp (ms) de la última sincronización exitosa */
    _lastCloudSync: 0,
    /** semáforo para evitar escrituras concurrentes */
    _syncInProgress: false,
    /** hash para detectar cambios reales en los datos */
    _lastDataHash: '',
};

/**
 * Helpers de selección rápida (evitan repetir state.xxx en expresiones largas)
 */
export function getDb()   { return window._db; }
export function getAuth() { return window._auth; }

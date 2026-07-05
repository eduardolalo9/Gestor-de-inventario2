/**
 * js/state.js — v2.5
 * ══════════════════════════════════════════════════════════════
 * Estado global centralizado de la aplicación.
 *
 * NUEVO v2.5:
 *   conteoFinalizadoPorUsuario — rastrea qué usuarios han
 *   finalizado su conteo en cada área (mecanismo de bloqueo).
 *   { [area]: { [userId]: { finalizado, userName, ts } } }
 *   Permite al admin ver el estado por usuario y reabrir
 *   conteos individuales sin afectar a otros usuarios.
 * ══════════════════════════════════════════════════════════════
 */

export const state = {

  // ─── Catálogo de productos ───────────────────────────────────
  products: [],

  // ─── Carrito ─────────────────────────────────────────────────
  cart: [],

  // ─── Historial ───────────────────────────────────────────────
  orders:      [],
  inventories: [],

  // ─── Navegación / UI ─────────────────────────────────────────
  activeTab:     'inicio',
  selectedArea:  'almacen',
  selectedGroup: 'Todos',
  searchTerm:    '',

  // ─── Inventario operativo ────────────────────────────────────
  // { [productId]: { almacen: number, barra1: number, barra2: number } }
  inventarioConteo: {},

  // ─── Auditoría ───────────────────────────────────────────────
  // { [productId]: { [area]: { enteras: n, abiertas: [oz, ...] } } }
  auditoriaConteo: {},

  auditoriaStatus: {
    almacen: 'pendiente',
    barra1:  'pendiente',
    barra2:  'pendiente',
  },

  // Área activa en pantalla de conteo
  auditoriaAreaActiva: null,

  // Sub-vista: 'selection' | 'counting'
  auditoriaView: 'selection',

  // FIX BUG-7: flag de modo auditoría activo.
  isAuditoriaMode: false,

  // ─── Multi-usuario ────────────────────────────────────────────
  // { [productId]: { [area]: { [userId]: { enteras, abiertas, ts } } } }
  auditoriaConteoPorUsuario: {},

  // { userId, userName, role }
  auditCurrentUser: null,

  // ─── NUEVO v2.5: Bloqueo por usuario ─────────────────────────
  // Rastrea qué usuarios han finalizado su conteo en cada área.
  // Admin puede ver y reabrir conteos individuales.
  // { [area]: { [userId]: { finalizado: bool, userName: str, ts: num } } }
  conteoFinalizadoPorUsuario: {
    almacen: {},
    barra1:  {},
    barra2:  {},
  },

  // ─── Sesión Firebase ─────────────────────────────────────────
  currentUser:  null,   // firebase.User | null
  userProfile:  null,   // { uid, email, displayName, role, ... }

  // 'admin' | 'user' | null
  userRole: null,

  // ─── Sincronización ──────────────────────────────────────────
  syncEnabled:        true,
  _cloudSyncPending:  false,
  _syncInProgress:    false,
  _lastCloudSync:     0,
  _lastDataHash:      '',

  // ─── Ajustes pendientes offline ──────────────────────────────
  adjustmentsPending: [],

  // ─── Notificaciones ──────────────────────────────────────────
  notifications:       [],
  notificationsUnread: 0,

  // ─── Ajustes del admin ───────────────────────────────────────
  ajustesPendientes: [],
  ajustes: {},

  // ─── Reportes ────────────────────────────────────────────────
  reportesPublicados: [],
};

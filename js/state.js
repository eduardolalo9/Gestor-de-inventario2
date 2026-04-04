/**
 * js/state.js — v2.1
 * ══════════════════════════════════════════════════════════════
 * Estado global centralizado de la aplicación.
 * Todas las propiedades que CUALQUIER módulo necesita deben
 * estar declaradas aquí para evitar errores de undefined.
 * ══════════════════════════════════════════════════════════════
 */

export const state = {

  // ─── Catálogo de productos (fuente: Admin) ──────────────────
  products: [],

  // ─── Carrito (pedidos en curso) ─────────────────────────────
  cart: [],

  // ─── Historial ──────────────────────────────────────────────
  orders: [],          // Pedidos completados (solo local, NO se sincronizan)
  inventories: [],     // Historiales de inventario (se sincronizan chunkeados)

  // ─── Navegación / UI ────────────────────────────────────────
  activeTab: 'inicio',
  selectedArea: 'almacen',
  selectedGroup: 'Todos',
  searchTerm: '',

  // ─── Inventario operativo (conteo diario por área) ──────────
  // Estructura: { [productId]: { almacen: number, barra1: number, barra2: number } }
  inventarioConteo: {},

  // ─── Auditoría (conteo de verificación) ─────────────────────
  // Estructura: { [productId]: { [area]: { enteras: n, abiertas: [...] } } }
  auditoriaConteo: {},

  // Estado de cada zona: 'pendiente' | 'en_progreso' | 'completada'
  auditoriaStatus: {
    almacen: 'pendiente',
    barra1: 'pendiente',
    barra2: 'pendiente',
  },

  // ─── Multi-usuario (conteo por persona) ─────────────────────
  // Estructura: { [productId]: { [area]: { [userId]: { enteras, abiertas, ts } } } }
  auditoriaConteoPorUsuario: {},

  // ─── Usuario actual de auditoría ────────────────────────────
  // { userId: string, userName: string, role: 'admin'|'user' }
  auditCurrentUser: null,

  // ─── Rol del usuario autenticado ────────────────────────────
  // 'admin' | 'user' | null (null = modo dev, se trata como admin)
  userRole: null,

  // ─── Sincronización ─────────────────────────────────────────
  syncEnabled: true,           // Toggle del usuario (pausar/activar sync)
  _cloudSyncPending: false,    // Hay cambios locales sin subir
  _syncInProgress: false,      // Mutex: evita sync simultáneos
  _lastCloudSync: 0,           // Timestamp del último sync exitoso
  _lastDataHash: '',           // Hash para detectar cambios reales

  // ─── Notificaciones ─────────────────────────────────────────
  notificaciones: [],          // Array de notificaciones recibidas

  // ─── Ajustes (config del admin) ─────────────────────────────
  ajustes: {},                 // Configuración sincronizada

  // ─── Reportes ───────────────────────────────────────────────
  reportesPublicados: [],      // Reportes publicados por admin para descarga
};
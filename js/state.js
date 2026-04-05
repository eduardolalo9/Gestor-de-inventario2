/**
 * js/state.js — v2.2 CORREGIDO
 * ══════════════════════════════════════════════════════════════
 * Estado global centralizado de la aplicación.
 * Todas las propiedades que CUALQUIER módulo necesita deben
 * estar declaradas aquí para evitar errores de undefined.
 *
 * CORRECCIONES v2.2:
 * • Añadida propiedad currentUser  — asignada por auth-roles.js
 *   en _applyRoleToState(). Sin declarar aquí causaba que el
 *   objeto state recibiera propiedades dinámicas no rastreadas.
 * • Añadida propiedad userProfile  — ídem, asignada por auth-roles.js.
 * • Añadida propiedad adjustmentsPending — usada en app.js línea:
 *   if (state.adjustmentsPending?.length > 0) { subirAjustesPendientes() }
 *   Sin declararla, la expresión siempre evalúa undefined (falsy),
 *   impidiendo que los ajustes offline se suban al reconectar.
 * • Añadida propiedad auditoriaAreaActiva — usada en render.js
 *   pero no declarada → undefined al renderizar la pantalla de auditoría.
 * ══════════════════════════════════════════════════════════════
 */

export const state = {

  // ─── Catálogo de productos (fuente: Admin) ──────────────────
  products: [],

  // ─── Carrito (pedidos en curso) ─────────────────────────────
  cart: [],

  // ─── Historial ──────────────────────────────────────────────
  orders:      [],   // Pedidos completados (solo local, NO se sincronizan)
  inventories: [],   // Historiales de inventario (se sincronizan chunkeados)

  // ─── Navegación / UI ────────────────────────────────────────
  activeTab:     'inicio',
  selectedArea:  'almacen',
  selectedGroup: 'Todos',
  searchTerm:    '',

  // ─── Inventario operativo (conteo diario por área) ──────────
  // Estructura: { [productId]: { almacen: number, barra1: number, barra2: number } }
  inventarioConteo: {},

  // ─── Auditoría (conteo de verificación) ─────────────────────
  // Estructura: { [productId]: { [area]: { enteras: n, abiertas: [...] } } }
  auditoriaConteo: {},

  // Estado de cada zona: 'pendiente' | 'en_progreso' | 'completada'
  auditoriaStatus: {
    almacen: 'pendiente',
    barra1:  'pendiente',
    barra2:  'pendiente',
  },

  // Área actualmente activa en la pantalla de conteo de auditoría
  // FIX: no estaba declarada → render.js fallaba al intentar leer state.auditoriaAreaActiva
  auditoriaAreaActiva: null,

  // ─── Multi-usuario (conteo por persona) ─────────────────────
  // Estructura: { [productId]: { [area]: { [userId]: { enteras, abiertas, ts } } } }
  auditoriaConteoPorUsuario: {},

  // ─── Usuario actual de auditoría ────────────────────────────
  // { userId: string, userName: string, role: 'admin'|'user' }
  auditCurrentUser: null,

  // ─── Sesión de autenticación ─────────────────────────────────
  // FIX: currentUser y userProfile son asignados por auth-roles.js
  // (_applyRoleToState). Deben declararse aquí para que TypeScript /
  // linters y el motor de JS los rastreen correctamente como propiedades
  // propias del objeto, no como adiciones dinámicas.
  currentUser:  null,   // firebase.User | null
  userProfile:  null,   // { uid, email, displayName, role, ... } | null

  // ─── Rol del usuario autenticado ────────────────────────────
  // 'admin' | 'user' | null (null = modo dev, se trata como admin)
  userRole: null,

  // ─── Sincronización ─────────────────────────────────────────
  syncEnabled:        true,    // Toggle del usuario (pausar/activar sync)
  _cloudSyncPending:  false,   // Hay cambios locales sin subir
  _syncInProgress:    false,   // Mutex: evita sync simultáneos
  _lastCloudSync:     0,       // Timestamp del último sync exitoso
  _lastDataHash:      '',      // Hash para detectar cambios reales

  // ─── Ajustes pendientes de subir (offline) ───────────────────
  // FIX: app.js verifica state.adjustmentsPending?.length > 0 al reconectar
  // para llamar subirAjustesPendientes(). Sin esta propiedad declarada,
  // la condición nunca era verdadera → ajustes offline nunca se subían.
  // ajustes.js escribe en este array cuando está offline.
  adjustmentsPending: [],

  // ─── Notificaciones ─────────────────────────────────────────
  notificaciones: [],   // Array de notificaciones recibidas

  // ─── Ajustes (config del admin) ─────────────────────────────
  ajustes: {},          // Configuración sincronizada

  // ─── Reportes ───────────────────────────────────────────────
  reportesPublicados: [],   // Reportes publicados por admin para descarga
};

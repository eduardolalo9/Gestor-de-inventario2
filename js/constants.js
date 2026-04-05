/**
 * js/constants.js — v2.1
 * ══════════════════════════════════════════════════════════════
 * TODAS las constantes de la aplicación en un solo lugar.
 * ══════════════════════════════════════════════════════════════
 */

// ─── Áreas de inventario ──────────────────────────────────────
export const AREA_KEYS = ['almacen', 'barra1', 'barra2'];

export const AREA_LABELS = {
  almacen: 'Almacén',
  barra1: 'Barra 1',
  barra2: 'Barra 2',
};

// ─── Conversiones ─────────────────────────────────────────────
export const OZ_PER_ML = 0.033814;   // 1 ml = 0.033814 oz
export const ML_PER_OZ = 29.5735;    // 1 oz = 29.5735 ml

// ─── Firestore / Chunks ──────────────────────────────────────
export const MAX_CHUNK_SIZE = 500;

// ─── localStorage ─────────────────────────────────────────────
export const LS_WARN_BYTES = 4 * 1024 * 1024;  // 4 MB — advertencia
export const LS_MAX_BYTES  = 5 * 1024 * 1024;  // 5 MB — límite real

// ─── UI / Render ──────────────────────────────────────────────
export const RENDER_DEBOUNCE_MS = 150;
export const SEARCH_DEBOUNCE_MS = 300;

// ─── Sync ─────────────────────────────────────────────────────
export const SYNC_RETRY_MAX = 3;
export const SYNC_RETRY_BASE_MS = 2000;  // 2s, 4s, 8s (exponencial)

// ─── Auditoría ────────────────────────────────────────────────
export const AUDIT_STATUSES = {
  PENDING:   'pendiente',
  COMPLETED: 'completada',
};

// ─── Unidades por defecto ─────────────────────────────────────
export const DEFAULT_UNIT  = 'Unidad';
export const DEFAULT_GROUP = 'General';

// ─── Notificaciones ───────────────────────────────────────────
export const NOTIFICATION_DURATION_MS = 3000;
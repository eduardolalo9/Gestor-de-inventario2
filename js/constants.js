/**
 * js/constants.js — v2.1
 * ══════════════════════════════════════════════════════════════
 * Constantes globales de la aplicación.
 * Todas las "magic numbers" y configuraciones van aquí.
 * ══════════════════════════════════════════════════════════════
 */

// ─── Áreas de inventario ──────────────────────────────────────
export const AREA_KEYS = ['almacen', 'barra1', 'barra2'];

export const AREA_LABELS = {
  almacen: 'Almacén',
  barra1: 'Barra 1',
  barra2: 'Barra 2',
};

// ─── Firebase / Firestore ─────────────────────────────────────
/** Máximo de items por chunk en subcollecciones */
export const MAX_CHUNK_SIZE = 500;

/** Tiempo máximo de espera para transacciones (ms) */
export const TX_TIMEOUT_MS = 30000;

// ─── LocalStorage ─────────────────────────────────────────────
/** Clave principal de localStorage */
export const LS_KEY = 'inventarioApp_data';

/** Umbral de advertencia: 4 MB (localStorage suele tener 5-10 MB) */
export const LS_WARN_BYTES = 4 * 1024 * 1024;

/** Umbral crítico: 4.5 MB */
export const LS_CRITICAL_BYTES = 4.5 * 1024 * 1024;

// ─── Sincronización ───────────────────────────────────────────
/** Debounce para auto-sync después de cambios locales (ms) */
export const SYNC_DEBOUNCE_MS = 2000;

/** Máximo de reintentos en syncToCloud */
export const SYNC_MAX_RETRIES = 3;

// ─── UI / Render ──────────────────────────────────────────────
/** Debounce de búsqueda en el buscador de productos (ms) */
export const SEARCH_DEBOUNCE_MS = 300;

/** Máximo de productos visibles antes de paginar */
export const MAX_VISIBLE_PRODUCTS = 50;

// ─── Auditoría ────────────────────────────────────────────────
/** Tolerancia para detectar conflicto en botellas abiertas (oz) */
export const CONFLICT_TOLERANCE_OZ = 0.01;

// ─── Conversiones ─────────────────────────────────────────────
/** 1 onza = 29.5735 ml */
export const OZ_TO_ML = 29.5735;

/** 1 ml = 0.033814 oz */
export const ML_TO_OZ = 0.033814;
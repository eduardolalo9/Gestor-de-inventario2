/**
 * js/constants.js — v2.1
 * ══════════════════════════════════════════════════════════════
 * Constantes globales de la aplicación.
 * ══════════════════════════════════════════════════════════════
 */

/** Claves de las 3 áreas de inventario */
export const AREA_KEYS = ['almacen', 'barra1', 'barra2'];

/** Nombres legibles para UI */
export const AREA_LABELS = {
  almacen: 'Almacén',
  barra1: 'Barra 1',
  barra2: 'Barra 2',
};

/** Máximo de productos por chunk en Firestore (límite 1MB por doc) */
export const MAX_CHUNK_SIZE = 400;

/** Onzas por mililitro (conversión estándar) */
export const OZ_PER_ML = 0.033814;

/** Peso de una botella vacía promedio en oz (para cálculo de contenido) */
export const PESO_BOTELLA_VACIA_OZ = 14.0;

/** Grupos/categorías por defecto */
export const DEFAULT_GROUPS = [
  'Todos',
  'General',
  'Licores',
  'Cervezas',
  'Vinos',
  'Refrescos',
  'Alimentos',
  'Desechables',
  'Limpieza',
];

/** Tabs de navegación */
export const TABS = [
  { id: 'inicio',      icon: '📦', label: 'Productos' },
  { id: 'inventario',  icon: '📋', label: 'Inventario' },
  { id: 'auditoria',   icon: '🔍', label: 'Auditoría' },
  { id: 'historial',   icon: '📊', label: 'Historial' },
  { id: 'ajustes',     icon: '⚙️', label: 'Ajustes' },
];
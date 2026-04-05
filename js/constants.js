// constants.js - Configuración Global y Reglas de Negocio

// 1. Pesos de Referencia (Fundamentales para cálculos de botellas abiertas)
// Este es el valor que te faltaba y causaba el error en la consola
export const PESO_BOTELLA_VACIA_OZ = 25.0; 

// 2. Factores de Conversión
export const OZ_A_ML = 29.5735; // Para convertir el peso medido a volumen líquido

// 3. Roles de Usuario (Para tu Arquitectura Profesional)
export const ROLES = {
    ADMIN: 'admin',
    USUARIO: 'usuario'
};

// 4. Estados de Sincronización
export const SYNC_STATUS = {
    PENDIENTE: 'pendiente',
    SINCRONIZADO: 'sincronizado',
    ERROR: 'error'
};

// 5. Categorías de Inventario (Para mantener consistencia en Firestore)
export const CATEGORIAS = [
    "Destilados",
    "Vinos",
    "Cervezas",
    "Refrescos",
    "Cristalería",
    "Insumos"
];

// 6. Configuración de Almacenamiento Local (Offline-First)
export const LOCAL_STORAGE_KEYS = {
    CONTEOS_PENDIENTES: 'inventario_offline_queue',
    CATALOGO_PRODUCTOS: 'inventario_catalogo_cache',
    SESION_USUARIO: 'inventario_user_session'
};

// 7. Estructura base de un Producto (Como guía para tu módulo 2.1)
export const PRODUCTO_TEMPLATE = {
    id: "",
    nombre: "",
    capacidad_ml: 750,
    peso_lleno_oz: 0,
    peso_vacio_oz: PESO_BOTELLA_VACIA_OZ, // Usamos la constante aquí también
    categoria: "",
    activo: true
};
/**
 * js/products.js — v2.1 COMPLETO
 * ══════════════════════════════════════════════════════════════
 * Gestión de productos: CRUD, importación Excel, cálculos de
 * stock, sincronización de conteo desde la nube.
 *
 * EXPORTS:
 *   - syncStockByAreaFromConteo()    → sync.js
 *   - calcularTotalConAbiertas()     → reportes.js
 *   - calcularContenidoMl()          → reportes.js, render.js
 *   - handleFileImport()             → render.js, ui.js
 *   - addProduct()                   → render.js
 *   - updateProduct()                → render.js
 *   - deleteProduct()                → render.js
 *   - getProductById()               → varios módulos
 *   - getProductsByGroup()           → render.js
 *   - getUniqueGroups()              → render.js
 *   - parseExcelNumber()             → helper público
 * ══════════════════════════════════════════════════════════════
 */

// ═══ IMPORTS ══════════════════════════════════════════════════
import { state } from './state.js';
import { showNotification } from './ui.js';
import { saveToLocalStorage } from './storage.js';
import { AREA_KEYS, OZ_PER_ML, PESO_BOTELLA_VACIA_OZ } from './constants.js';

// ═════════════════════════════════════════════════════════════
// HELPER: parsear números de Excel
// ═════════════════════════════════════════════════════════════

export function parseExcelNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return isNaN(value) ? 0 : value;

  let str = String(value).trim();
  str = str.replace(/\s/g, '');

  // Formato europeo: 1.234,56 → 1234.56
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(str)) {
    str = str.replace(/\./g, '').replace(',', '.');
  }
  // Coma decimal simple: 12,5 → 12.5
  else if (/^\d+,\d+$/.test(str)) {
    str = str.replace(',', '.');
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

// ═════════════════════════════════════════════════════════════
// CRUD DE PRODUCTOS
// ═════════════════════════════════════════════════════════════

/**
 * Busca un producto por ID.
 * @param {string} id
 * @returns {object|undefined}
 */
export function getProductById(id) {
  return state.products.find(p => p.id === id);
}

/**
 * Devuelve las categorías únicas de los productos actuales.
 * @returns {string[]}
 */
export function getUniqueGroups() {
  const groups = new Set(state.products.map(p => p.group || 'General'));
  return ['Todos', ...Array.from(groups).sort()];
}

/**
 * Filtra productos por grupo (categoría).
 * @param {string} group — 'Todos' devuelve todos
 * @returns {object[]}
 */
export function getProductsByGroup(group = 'Todos') {
  if (group === 'Todos') return [...state.products];
  return state.products.filter(p => (p.group || 'General') === group);
}

/**
 * Agrega un nuevo producto al catálogo.
 * @param {object} productData — { name, unit, group, capacidadMl?, pesoBotellaLlenaOz? }
 * @returns {object} producto creado
 */
export function addProduct(productData) {
  // Generar ID único
  let maxNum = 0;
  state.products.forEach(p => {
    const m = String(p.id).match(/^PRD-(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  const id = 'PRD-' + String(maxNum + 1).padStart(3, '0');

  const product = {
    id,
    name: (productData.name || 'Sin nombre').trim(),
    unit: (productData.unit || 'Unidad').trim(),
    group: (productData.group || 'General').trim(),
    stockByArea: { almacen: 0, barra1: 0, barra2: 0 },
  };

  if (productData.capacidadMl > 0) {
    product.capacidadMl = parseFloat(productData.capacidadMl);
  }
  if (productData.pesoBotellaLlenaOz > 0) {
    product.pesoBotellaLlenaOz = parseFloat(productData.pesoBotellaLlenaOz);
  }

  state.products.push(product);
  saveToLocalStorage();
  showNotification(`✅ Producto "${product.name}" agregado`);
  console.info('[Products] Producto creado:', id, product.name);
  return product;
}

/**
 * Actualiza un producto existente.
 * @param {string} id
 * @param {object} updates — campos a actualizar
 * @returns {object|null}
 */
export function updateProduct(id, updates) {
  const product = state.products.find(p => p.id === id);
  if (!product) {
    showNotification('⚠️ Producto no encontrado');
    return null;
  }

  if (updates.name !== undefined) product.name = String(updates.name).trim();
  if (updates.unit !== undefined) product.unit = String(updates.unit).trim();
  if (updates.group !== undefined) product.group = String(updates.group).trim();
  if (updates.capacidadMl !== undefined) {
    product.capacidadMl = parseFloat(updates.capacidadMl) || null;
  }
  if (updates.pesoBotellaLlenaOz !== undefined) {
    product.pesoBotellaLlenaOz = parseFloat(updates.pesoBotellaLlenaOz) || null;
  }
  if (updates.stockByArea) {
    product.stockByArea = { ...product.stockByArea, ...updates.stockByArea };
  }

  saveToLocalStorage();
  console.info('[Products] Producto actualizado:', id);
  return product;
}

/**
 * Elimina un producto por ID.
 * @param {string} id
 * @returns {boolean}
 */
export function deleteProduct(id) {
  const index = state.products.findIndex(p => p.id === id);
  if (index === -1) {
    showNotification('⚠️ Producto no encontrado');
    return false;
  }

  const name = state.products[index].name;
  state.products.splice(index, 1);

  // Limpiar datos de conteo asociados
  delete state.inventarioConteo[id];
  delete state.auditoriaConteo[id];
  delete state.auditoriaConteoPorUsuario[id];

  saveToLocalStorage();
  showNotification(`🗑️ "${name}" eliminado`);
  console.info('[Products] Producto eliminado:', id, name);
  return true;
}

// ═════════════════════════════════════════════════════════════
// CÁLCULOS DE STOCK (funciones que reportes.js necesita)
// ═════════════════════════════════════════════════════════════

/**
 * Calcula el stock total de un producto en un área,
 * sumando unidades enteras + equivalente decimal de abiertas.
 *
 * Lógica de botellas abiertas:
 *   - Cada valor en el array "abiertas" es el peso en oz de esa botella
 *   - Se resta el peso de la botella vacía para obtener contenido neto
 *   - Se convierte a fracción de botella llena
 *
 * @param {string} productId
 * @param {string} area — 'almacen' | 'barra1' | 'barra2'
 * @returns {number} total con decimales (ej: 5.73)
 */
export function calcularTotalConAbiertas(productId, area) {
  const product = getProductById(productId);
  if (!product) return 0;

  // ── Obtener conteo del área ─────────────────────────────────
  const conteo = state.auditoriaConteo[productId]?.[area];
  if (!conteo) {
    // Sin conteo de auditoría → usar stockByArea directo
    return product.stockByArea?.[area] || 0;
  }

  const enteras = typeof conteo.enteras === 'number' ? conteo.enteras : 0;
  const abiertas = Array.isArray(conteo.abiertas) ? conteo.abiertas : [];

  if (abiertas.length === 0) return enteras;

  // ── Calcular fracción de cada botella abierta ───────────────
  const pesoLlena = product.pesoBotellaLlenaOz || 0;
  const pesoVacia = PESO_BOTELLA_VACIA_OZ || 14.0;

  if (pesoLlena <= pesoVacia) {
    // Sin datos de peso → cada abierta cuenta como 0.5
    return enteras + (abiertas.length * 0.5);
  }

  const contenidoLlena = pesoLlena - pesoVacia; // oz de líquido cuando está llena

  let totalAbiertas = 0;
  abiertas.forEach(pesoActual => {
    const peso = parseFloat(pesoActual) || 0;
    if (peso <= pesoVacia) {
      // Botella vacía o inválida → 0
      totalAbiertas += 0;
    } else if (peso >= pesoLlena) {
      // Pesa igual o más que llena → cuenta como 1
      totalAbiertas += 1;
    } else {
      // Fracción: (contenido actual) / (contenido llena)
      const contenidoActual = peso - pesoVacia;
      totalAbiertas += contenidoActual / contenidoLlena;
    }
  });

  return parseFloat((enteras + totalAbiertas).toFixed(4));
}

/**
 * Calcula el contenido en mililitros de un producto en un área.
 *
 * @param {string} productId
 * @param {string} area
 * @returns {number} mililitros totales
 */
export function calcularContenidoMl(productId, area) {
  const product = getProductById(productId);
  if (!product || !product.capacidadMl) return 0;

  const totalUnidades = calcularTotalConAbiertas(productId, area);
  return parseFloat((totalUnidades * product.capacidadMl).toFixed(2));
}

/**
 * Calcula el stock total de un producto en TODAS las áreas.
 *
 * @param {string} productId
 * @returns {{ total: number, porArea: object, totalMl: number }}
 */
export function calcularStockTotal(productId) {
  const porArea = {};
  let total = 0;

  AREA_KEYS.forEach(area => {
    const val = calcularTotalConAbiertas(productId, area);
    porArea[area] = val;
    total += val;
  });

  const product = getProductById(productId);
  const totalMl = product?.capacidadMl
    ? parseFloat((total * product.capacidadMl).toFixed(2))
    : 0;

  return { total: parseFloat(total.toFixed(4)), porArea, totalMl };
}

// ═════════════════════════════════════════════════════════════
// MULTI-USUARIO: manejo de conteos de diferentes usuarios
// ═════════════════════════════════════════════════════════════

/**
 * Calcula el total con abiertas considerando datos de MÚLTIPLES
 * usuarios (para admin que ve todos los conteos).
 *
 * Regla de negocio:
 *   - Enteras: se toma el MAYOR valor entre usuarios (no se suma)
 *   - Abiertas: se CONCATENAN las de todos los usuarios (nunca sobrescribir)
 *
 * @param {string} productId
 * @param {string} area
 * @returns {number}
 */
export function calcularTotalMultiUsuario(productId, area) {
  const product = getProductById(productId);
  if (!product) return 0;

  const porUsuario = state.auditoriaConteoPorUsuario[productId]?.[area];
  if (!porUsuario || Object.keys(porUsuario).length === 0) {
    // Sin datos multi-usuario → usar cálculo normal
    return calcularTotalConAbiertas(productId, area);
  }

  // ── Enteras: tomar el mayor ─────────────────────────────────
  let maxEnteras = 0;
  // ── Abiertas: concatenar todas ──────────────────────────────
  let todasAbiertas = [];

  Object.values(porUsuario).forEach(conteo => {
    if (typeof conteo === 'object' && conteo !== null) {
      const ent = typeof conteo.enteras === 'number' ? conteo.enteras : 0;
      if (ent > maxEnteras) maxEnteras = ent;

      if (Array.isArray(conteo.abiertas)) {
        todasAbiertas = todasAbiertas.concat(conteo.abiertas);
      }
    }
  });

  if (todasAbiertas.length === 0) return maxEnteras;

  // Calcular fracción de abiertas (misma lógica que calcularTotalConAbiertas)
  const pesoLlena = product.pesoBotellaLlenaOz || 0;
  const pesoVacia = PESO_BOTELLA_VACIA_OZ || 14.0;

  if (pesoLlena <= pesoVacia) {
    return maxEnteras + (todasAbiertas.length * 0.5);
  }

  const contenidoLlena = pesoLlena - pesoVacia;
  let totalAbiertas = 0;

  todasAbiertas.forEach(pesoActual => {
    const peso = parseFloat(pesoActual) || 0;
    if (peso <= pesoVacia) {
      totalAbiertas += 0;
    } else if (peso >= pesoLlena) {
      totalAbiertas += 1;
    } else {
      totalAbiertas += (peso - pesoVacia) / contenidoLlena;
    }
  });

  return parseFloat((maxEnteras + totalAbiertas).toFixed(4));
}

// ═════════════════════════════════════════════════════════════
// syncStockByAreaFromConteo() — Sync desde la nube
// ═════════════════════════════════════════════════════════════

/**
 * Recorre state.inventarioConteo y aplica los valores al
 * stockByArea de cada producto en state.products.
 *
 * Llamada desde sync.js cuando llegan datos de la nube
 * (stockAreas snapshot) para mantener el estado local
 * sincronizado con Firestore.
 */
export function syncStockByAreaFromConteo() {
  if (!state.inventarioConteo) return;

  let updated = 0;

  state.products.forEach(product => {
    const conteo = state.inventarioConteo[product.id];
    if (!conteo) return;

    if (!product.stockByArea) {
      product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
    }

    AREA_KEYS.forEach(area => {
      if (conteo[area] !== undefined && conteo[area] !== null) {
        const valor = parseFloat(conteo[area]);
        if (!isNaN(valor)) {
          product.stockByArea[area] = valor;
          updated++;
        }
      }
    });
  });

  if (updated > 0) {
    console.info(`[Products] syncStockByAreaFromConteo: ${updated} campos actualizados.`);
  }
}

// ═════════════════════════════════════════════════════════════
// handleFileImport() — Importación desde Excel
// ═════════════════════════════════════════════════════════════

/**
 * Maneja la importación de productos desde un archivo Excel.
 * Solo disponible para Administradores.
 *
 * @param {Event} event — evento del input[type=file]
 */
export function handleFileImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const fileInput = event.target;

  console.info('[Import] Archivo recibido:', file.name, file.size, 'bytes');

  // ── Validar rol (solo admin) ────────────────────────────────
  if (state.userRole === 'user') {
    showNotification('⛔ Solo el administrador puede importar productos');
    fileInput.value = '';
    return;
  }

  // ── Validar extensión ───────────────────────────────────────
  const validExtensions = ['.xlsx', '.xls', '.csv'];
  const fileName = file.name.toLowerCase();
  const isValid = validExtensions.some(ext => fileName.endsWith(ext));
  if (!isValid) {
    showNotification('⚠️ Selecciona un archivo Excel (.xlsx, .xls, .csv)');
    fileInput.value = '';
    return;
  }

  // ── Validar que XLSX esté disponible ────────────────────────
  if (typeof window.XLSX === 'undefined' || !window.XLSX.read) {
    showNotification('❌ La librería XLSX no está cargada. Recarga la página.');
    fileInput.value = '';
    return;
  }

  const reader = new FileReader();

  reader.onerror = function () {
    showNotification('❌ Error al leer el archivo');
    fileInput.value = '';
  };

  reader.onload = function (e) {
    try {
      console.info('[Import] FileReader completado, parseando XLSX...');
      const data = new Uint8Array(e.target.result);
      const workbook = window.XLSX.read(data, { type: 'array' });

      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        showNotification('El archivo no contiene hojas válidas');
        fileInput.value = '';
        return;
      }

      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) {
        showNotification('La primera hoja del archivo está vacía');
        fileInput.value = '';
        return;
      }

      const jsonData = window.XLSX.utils.sheet_to_json(firstSheet);
      console.info('[Import] Filas encontradas:', jsonData.length);

      if (!jsonData || jsonData.length === 0) {
        showNotification('El archivo no contiene datos válidos');
        fileInput.value = '';
        return;
      }

      // ── Mapa de columnas (multi-nombre) ─────────────────────
      const columnMap = {
        id: ['ID', 'Id', 'id', 'Código', 'codigo'],
        name: [
          'Producto', 'Nombre', 'Descripción', 'descripcion', 'producto',
          'nombre', 'Name', 'name', 'PRODUCTO', 'NOMBRE',
        ],
        unit: ['Unidad', 'unidad', 'Medida', 'medida', 'Unit', 'UNIDAD'],
        group: ['Grupo', 'grupo', 'Categoría', 'categoria', 'Group', 'GRUPO'],
        stock: [
          'Cantidad', 'cantidad', 'Stock', 'stock', 'Enteras',
          'CANTIDAD', 'STOCK',
        ],
        capacidadMl: [
          'CapacidadML', 'capacidadMl', 'CapacidadMl',
          'Capacidad_ML', 'CapML', 'capacidadML', 'capacidadml',
        ],
        pesoBotellaLlenaOz: [
          'PesoBotellaOz', 'pesoBotellaOz', 'PesoLlenaOz',
          'PesoBotella_Oz', 'PesoOz', 'PesoBotella0z',
          'pesobotella0z', 'pesoBotella0z',
          'pesoBotellaLlenaOz', 'PesoBotellaLlenaOz',
        ],
      };

      /** Busca el valor de una columna por nombre */
      const findCol = (row, keys) => {
        for (const key of keys) {
          if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
            return row[key];
          }
        }
        const rowKeys = Object.keys(row);
        for (const key of keys) {
          const found = rowKeys.find(rk => rk.toLowerCase() === key.toLowerCase());
          if (found && row[found] !== undefined && row[found] !== null && row[found] !== '') {
            return row[found];
          }
        }
        return undefined;
      };

      // ── Preparar IDs únicos ─────────────────────────────────
      const existingIds = new Set(state.products.map(p => p.id));
      let maxNum = 0;
      state.products.forEach(p => {
        const m = String(p.id).match(/^PRD-(\d+)$/);
        if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
      });
      let nextNum = maxNum + 1;

      const toImport = [];
      const usedInBatch = new Set();
      let skipped = 0;

      // ── Procesar cada fila ──────────────────────────────────
      jsonData.forEach((row) => {
        const nameRaw = findCol(row, columnMap.name);
        const name = nameRaw !== undefined ? String(nameRaw).trim() : '';
        if (!name) { skipped++; return; }

        const rawId = findCol(row, columnMap.id);
        let id = rawId !== undefined ? String(rawId).trim() : '';

        if (!id || existingIds.has(id) || usedInBatch.has(id)) {
          do {
            id = 'PRD-' + String(nextNum++).padStart(3, '0');
          } while (existingIds.has(id) || usedInBatch.has(id));
        }
        usedInBatch.add(id);

        const unitRaw = findCol(row, columnMap.unit);
        const unit = unitRaw !== undefined ? String(unitRaw).trim() : 'Unidad';

        const groupRaw = findCol(row, columnMap.group);
        const group = groupRaw !== undefined ? String(groupRaw).trim() : 'General';

        const stockRaw = findCol(row, columnMap.stock);
        const stock = stockRaw !== undefined ? parseExcelNumber(stockRaw) : 0;

        const capRaw = findCol(row, columnMap.capacidadMl);
        const capacidadMl = capRaw !== undefined
          ? (isNaN(parseFloat(capRaw)) ? null : parseFloat(capRaw))
          : null;

        const pesoRaw = findCol(row, columnMap.pesoBotellaLlenaOz);
        const pesoBotellaLlenaOz = pesoRaw !== undefined
          ? (isNaN(parseFloat(pesoRaw)) ? null : parseFloat(pesoRaw))
          : null;

        const product = {
          id, name, unit, group,
          stockByArea: { almacen: stock, barra1: 0, barra2: 0 },
        };
        if (capacidadMl !== null && capacidadMl > 0) product.capacidadMl = capacidadMl;
        if (pesoBotellaLlenaOz !== null && pesoBotellaLlenaOz > 0) product.pesoBotellaLlenaOz = pesoBotellaLlenaOz;

        toImport.push(product);
      });

      if (toImport.length === 0) {
        showNotification('⚠️ No se encontraron productos válidos. Verifica las columnas.');
        fileInput.value = '';
        return;
      }

      state.products = state.products.concat(toImport);

      console.info(`[Import] ✅ ${toImport.length} productos importados, ${skipped} filas omitidas`);
      showNotification(
        `✅ ${toImport.length} productos importados.${skipped ? ' ' + skipped + ' filas omitidas.' : ''}`
      );

      state.activeTab = 'inicio';
      state.selectedGroup = 'Todos';
      state.searchTerm = '';
      state.selectedArea = 'almacen';
      saveToLocalStorage();

      // Sync a la nube si está habilitado
      if (state.syncEnabled && window._db) {
        import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
      }

      import('./render.js').then(m => m.renderTab());
      fileInput.value = '';

    } catch (error) {
      showNotification('❌ Error al importar archivo: ' + error.message);
      console.error('[Import] Error:', error);
      fileInput.value = '';
    }
  };

  reader.readAsArrayBuffer(file);
}

// ═════════════════════════════════════════════════════════════
// AJUSTE DE PRODUCTO (con notificación al admin)
// ═════════════════════════════════════════════════════════════

/**
 * Ajusta el stock de un producto en un área específica.
 * Si el usuario es 'user', envía notificación al admin.
 *
 * @param {string} productId
 * @param {string} area
 * @param {number} nuevoValor
 * @param {string} [motivo='']
 */
export async function ajustarProducto(productId, area, nuevoValor, motivo = '') {
  const product = getProductById(productId);
  if (!product) {
    showNotification('⚠️ Producto no encontrado');
    return;
  }

  const valorAnterior = product.stockByArea?.[area] || 0;
  if (!product.stockByArea) {
    product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
  }
  product.stockByArea[area] = parseFloat(nuevoValor) || 0;

  saveToLocalStorage();
  console.info(`[Products] Ajuste: ${product.name} [${area}] ${valorAnterior} → ${nuevoValor}`);

  // ── Notificar al admin si el usuario es 'user' ──────────────
  if (state.userRole === 'user') {
    try {
      const { enviarNotificacionAjuste } = await import('./notificaciones.js');
      await enviarNotificacionAjuste({
        productId,
        productName: product.name,
        area,
        valorAnterior,
        nuevoValor,
        motivo,
        userId: state.auditCurrentUser?.userId || 'unknown',
        userName: state.auditCurrentUser?.userName || 'Anónimo',
        timestamp: Date.now(),
      });
    } catch (e) {
      console.warn('[Products] No se pudo enviar notificación de ajuste:', e);
    }
  }

  showNotification(`✅ ${product.name} ajustado en ${AREA_KEYS.includes(area) ? area : 'área'}`);
}

// ═════════════════════════════════════════════════════════════
// FINALIZAR CONTEO (reset para próximo inventario)
// ═════════════════════════════════════════════════════════════

/**
 * Finaliza el conteo actual:
 *  1. Guarda snapshot en historial (inventories)
 *  2. Limpia conteos en ceros
 *  3. Mantiene catálogo de productos intacto
 *
 * Regla de negocio: "Evita mezcla de inventarios"
 */
export function finalizarInventario() {
  // ── 1. Guardar reporte en historial ─────────────────────────
  const snapshot = {
    id: 'INV-' + Date.now(),
    fecha: new Date().toISOString(),
    usuario: state.auditCurrentUser?.userName || 'Sistema',
    productos: state.products.map(p => ({
      id: p.id,
      nombre: p.name,
      grupo: p.group,
      stockByArea: { ...p.stockByArea },
      totalUnidades: calcularStockTotal(p.id).total,
      totalMl: calcularStockTotal(p.id).totalMl,
    })),
  };

  state.inventories.push(snapshot);

  // ── 2. Limpiar conteos ──────────────────────────────────────
  state.inventarioConteo = {};
  state.auditoriaConteo = {};
  state.auditoriaConteoPorUsuario = {};
  state.auditoriaStatus = {
    almacen: 'pendiente',
    barra1: 'pendiente',
    barra2: 'pendiente',
  };

  // Reset stockByArea a ceros
  state.products.forEach(p => {
    p.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
  });

  saveToLocalStorage();
  console.info('[Products] ✓ Inventario finalizado. Historial guardado:', snapshot.id);
  showNotification('✅ Inventario finalizado y guardado en historial');

  return snapshot;
}
/**
 * js/products.js — v2.2 (completo y corregido)
 * ══════════════════════════════════════════════════════════════
 * Gestión de productos: CRUD, importación Excel, cálculos de
 * stock, sincronización de conteo por área.
 * ══════════════════════════════════════════════════════════════
 */

// ═══ IMPORTS ══════════════════════════════════════════════════
import { state } from './state.js';
import { showNotification } from './ui.js';
import { saveToLocalStorage } from './storage.js';
import { AREA_KEYS } from './constants.js';

// ═════════════════════════════════════════════════════════════
// HELPER: parsear números de Excel
// ═════════════════════════════════════════════════════════════

export function parseExcelNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return isNaN(value) ? 0 : value;

  let str = String(value).trim().replace(/\s/g, '');

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
 * Genera un ID único para un producto nuevo.
 * Formato: PRD-001, PRD-002, etc.
 */
export function generateProductId() {
  let maxNum = 0;
  state.products.forEach(p => {
    const m = String(p.id).match(/^PRD-(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  return 'PRD-' + String(maxNum + 1).padStart(3, '0');
}

/**
 * Agrega un producto nuevo al estado.
 * @param {object} productData — { name, unit, group, stock, capacidadMl, pesoBotellaLlenaOz }
 * @returns {object} el producto creado
 */
export function addProduct(productData) {
  const { name, unit, group, stock, capacidadMl, pesoBotellaLlenaOz } = productData;

  if (!name || !name.trim()) {
    showNotification('⚠️ El nombre del producto es obligatorio');
    return null;
  }

  const id = generateProductId();
  const product = {
    id,
    name: name.trim(),
    unit: unit || 'Unidad',
    group: group || 'General',
    stockByArea: {
      almacen: parseFloat(stock) || 0,
      barra1: 0,
      barra2: 0,
    },
  };

  if (capacidadMl && parseFloat(capacidadMl) > 0) {
    product.capacidadMl = parseFloat(capacidadMl);
  }
  if (pesoBotellaLlenaOz && parseFloat(pesoBotellaLlenaOz) > 0) {
    product.pesoBotellaLlenaOz = parseFloat(pesoBotellaLlenaOz);
  }

  state.products.push(product);
  saveToLocalStorage();
  showNotification(`✅ "${product.name}" agregado`);
  console.info(`[Products] Producto agregado: ${id} — ${product.name}`);
  return product;
}

/**
 * Edita un producto existente.
 * @param {string} productId
 * @param {object} updates — campos a actualizar
 * @returns {boolean}
 */
export function editProduct(productId, updates) {
  const idx = state.products.findIndex(p => p.id === productId);
  if (idx === -1) {
    showNotification('⚠️ Producto no encontrado');
    return false;
  }

  const product = state.products[idx];

  if (updates.name !== undefined) product.name = String(updates.name).trim();
  if (updates.unit !== undefined) product.unit = String(updates.unit).trim();
  if (updates.group !== undefined) product.group = String(updates.group).trim();

  if (updates.stock !== undefined && state.selectedArea) {
    if (!product.stockByArea) {
      product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
    }
    product.stockByArea[state.selectedArea] = parseFloat(updates.stock) || 0;
  }

  if (updates.capacidadMl !== undefined) {
    const val = parseFloat(updates.capacidadMl);
    if (val > 0) product.capacidadMl = val;
    else delete product.capacidadMl;
  }

  if (updates.pesoBotellaLlenaOz !== undefined) {
    const val = parseFloat(updates.pesoBotellaLlenaOz);
    if (val > 0) product.pesoBotellaLlenaOz = val;
    else delete product.pesoBotellaLlenaOz;
  }

  saveToLocalStorage();
  showNotification(`✅ "${product.name}" actualizado`);
  return true;
}

/**
 * Elimina un producto por ID.
 * @param {string} productId
 * @returns {boolean}
 */
export function deleteProduct(productId) {
  const idx = state.products.findIndex(p => p.id === productId);
  if (idx === -1) {
    showNotification('⚠️ Producto no encontrado');
    return false;
  }

  const name = state.products[idx].name;
  state.products.splice(idx, 1);

  // Limpiar conteos relacionados
  delete state.inventarioConteo[productId];
  delete state.auditoriaConteo[productId];
  if (state.auditoriaConteoPorUsuario) {
    delete state.auditoriaConteoPorUsuario[productId];
  }

  // Limpiar del carrito
  state.cart = state.cart.filter(item => item.id !== productId);

  saveToLocalStorage();
  showNotification(`🗑️ "${name}" eliminado`);
  console.info(`[Products] Producto eliminado: ${productId}`);
  return true;
}

// ═════════════════════════════════════════════════════════════
// CONSULTAS
// ═════════════════════════════════════════════════════════════

/**
 * Obtiene la lista de grupos únicos.
 * @returns {string[]}
 */
export function getGroups() {
  const groups = new Set();
  state.products.forEach(p => {
    if (p.group) groups.add(p.group);
  });
  return ['Todos', ...Array.from(groups).sort()];
}

/**
 * Filtra productos por grupo, término de búsqueda y área.
 * @param {object} [filters] — { group, search, area }
 * @returns {object[]}
 */
export function getFilteredProducts(filters = {}) {
  const group = filters.group || state.selectedGroup || 'Todos';
  const search = (filters.search || state.searchTerm || '').toLowerCase().trim();
  const area = filters.area || state.selectedArea || 'almacen';

  return state.products.filter(p => {
    // Filtro por grupo
    if (group !== 'Todos' && p.group !== group) return false;
    // Filtro por búsqueda
    if (search && !p.name.toLowerCase().includes(search) && !p.id.toLowerCase().includes(search)) {
      return false;
    }
    return true;
  });
}

/**
 * Obtiene productos agrupados por grupo.
 * @returns {object} { 'General': [...], 'Licores': [...] }
 */
export function getProductsByGroup() {
  const grouped = {};
  state.products.forEach(p => {
    const g = p.group || 'General';
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(p);
  });
  return grouped;
}

/**
 * Busca un producto por ID.
 * @param {string} productId
 * @returns {object|null}
 */
export function getProductById(productId) {
  return state.products.find(p => p.id === productId) || null;
}

// ═════════════════════════════════════════════════════════════
// CÁLCULOS DE STOCK
// ═════════════════════════════════════════════════════════════

/**
 * Obtiene el stock de un producto en un área específica.
 * @param {string} productId
 * @param {string} [area] — default: state.selectedArea
 * @returns {number}
 */
export function getStock(productId, area) {
  const product = state.products.find(p => p.id === productId);
  if (!product) return 0;
  const a = area || state.selectedArea || 'almacen';
  return product.stockByArea?.[a] ?? 0;
}

/**
 * Obtiene el stock total de un producto sumando todas las áreas.
 * @param {string} productId
 * @returns {number}
 */
export function getTotalStock(productId) {
  const product = state.products.find(p => p.id === productId);
  if (!product || !product.stockByArea) return 0;
  return AREA_KEYS.reduce((total, area) => {
    return total + (product.stockByArea[area] || 0);
  }, 0);
}

/**
 * calcularTotalConAbiertas()
 * ─────────────────────────────────────────────────────────────
 * Calcula el stock total de un producto en un área,
 * sumando unidades enteras + equivalente decimal de botellas
 * abiertas (medidas en oz → convertidas a fracción de botella).
 *
 * Fórmula abiertas:
 *   Si el producto tiene pesoBotellaLlenaOz, cada abierta (oz)
 *   se divide entre pesoBotellaLlenaOz para obtener la fracción.
 *   Si no, cada valor en abiertas[] se toma como fracción directa.
 *
 * @param {string} productId
 * @param {string} area — 'almacen' | 'barra1' | 'barra2'
 * @param {object} [conteoOverride] — { enteras, abiertas[] }
 * @returns {{ enteras: number, abiertas: number[], totalDecimal: number, display: string }}
 * ─────────────────────────────────────────────────────────────
 */
export function calcularTotalConAbiertas(productId, area, conteoOverride) {
  const product = state.products.find(p => p.id === productId);

  // Obtener datos del conteo: override > auditoriaConteo > inventarioConteo
  const conteo = conteoOverride
    || state.auditoriaConteo?.[productId]?.[area]
    || state.inventarioConteo?.[productId]?.[area]
    || {};

  const enteras = parseInt(conteo.enteras) || 0;
  const abiertas = Array.isArray(conteo.abiertas) ? conteo.abiertas : [];

  // Calcular fracción de cada botella abierta
  let totalAbiertas = 0;
  const pesoLlena = product?.pesoBotellaLlenaOz;

  if (pesoLlena && pesoLlena > 0) {
    // Cada valor en abiertas[] es peso en oz → convertir a fracción
    totalAbiertas = abiertas.reduce((sum, ozValue) => {
      const oz = parseFloat(ozValue) || 0;
      return sum + (oz / pesoLlena);
    }, 0);
  } else {
    // Sin peso de referencia: asumir que cada valor ya es fracción (0-1)
    totalAbiertas = abiertas.reduce((sum, frac) => {
      const f = parseFloat(frac) || 0;
      return sum + Math.min(f, 1); // cap a 1 por seguridad
    }, 0);
  }

  const totalDecimal = enteras + totalAbiertas;

  // Display legible: "5 + 2 abiertas (5.73)"
  let display = String(enteras);
  if (abiertas.length > 0) {
    display += ` + ${abiertas.length} abierta${abiertas.length > 1 ? 's' : ''} (${totalDecimal.toFixed(2)})`;
  }

  return {
    enteras,
    abiertas,
    totalAbiertas: Math.round(totalAbiertas * 100) / 100,
    totalDecimal: Math.round(totalDecimal * 100) / 100,
    display,
  };
}

/**
 * Calcula el stock total con abiertas de TODAS las áreas.
 * @param {string} productId
 * @returns {number}
 */
export function calcularTotalGlobalConAbiertas(productId) {
  let total = 0;
  AREA_KEYS.forEach(area => {
    const result = calcularTotalConAbiertas(productId, area);
    total += result.totalDecimal;
  });
  return Math.round(total * 100) / 100;
}

// ═════════════════════════════════════════════════════════════
// ACTUALIZACIÓN DE STOCK
// ═════════════════════════════════════════════════════════════

/**
 * Actualiza el stock de un producto en un área.
 * @param {string} productId
 * @param {string} area
 * @param {number} newStock
 */
export function updateStock(productId, area, newStock) {
  const product = state.products.find(p => p.id === productId);
  if (!product) return;

  if (!product.stockByArea) {
    product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
  }

  const oldStock = product.stockByArea[area] || 0;
  product.stockByArea[area] = parseFloat(newStock) || 0;

  console.debug(`[Products] Stock actualizado: ${productId}/${area}: ${oldStock} → ${product.stockByArea[area]}`);
  saveToLocalStorage();
}

/**
 * Transfiere stock entre áreas.
 * @param {string} productId
 * @param {string} fromArea
 * @param {string} toArea
 * @param {number} cantidad
 * @returns {boolean}
 */
export function transferStock(productId, fromArea, toArea, cantidad) {
  const product = state.products.find(p => p.id === productId);
  if (!product) {
    showNotification('⚠️ Producto no encontrado');
    return false;
  }

  if (!product.stockByArea) {
    product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
  }

  const available = product.stockByArea[fromArea] || 0;
  const qty = parseFloat(cantidad) || 0;

  if (qty <= 0) {
    showNotification('⚠️ La cantidad debe ser mayor a 0');
    return false;
  }

  if (qty > available) {
    showNotification(`⚠️ Solo hay ${available} disponibles en ${fromArea}`);
    return false;
  }

  product.stockByArea[fromArea] = Math.round((available - qty) * 100) / 100;
  product.stockByArea[toArea] = Math.round(((product.stockByArea[toArea] || 0) + qty) * 100) / 100;

  saveToLocalStorage();
  showNotification(`✅ ${qty} transferidas de ${fromArea} a ${toArea}`);
  console.info(`[Products] Transferencia: ${productId} — ${qty} de ${fromArea} → ${toArea}`);
  return true;
}

// ═════════════════════════════════════════════════════════════
// syncStockByAreaFromConteo — Llamada desde sync.js
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
        }
      }
    });
  });
}

// ═════════════════════════════════════════════════════════════
// IMPORTACIÓN DESDE EXCEL
// ═════════════════════════════════════════════════════════════

/**
 * Maneja la importación de productos desde un archivo Excel.
 * Soporta .xlsx, .xls y .csv
 *
 * @param {Event} event — evento del input[type=file]
 */
export function handleFileImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const fileInput = event.target;

  console.info('[Import] Archivo recibido:', file.name, file.size, 'bytes');

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

      // ── Mapa de columnas ──────────────────────────────────────
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

      // ── IDs únicos ────────────────────────────────────────────
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

      // ── Procesar filas ────────────────────────────────────────
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
// EXPORTACIÓN A EXCEL
// ═════════════════════════════════════════════════════════════

/**
 * Exporta los productos actuales a un archivo Excel.
 */
export function exportToExcel() {
  if (typeof window.XLSX === 'undefined') {
    showNotification('❌ La librería XLSX no está cargada');
    return;
  }

  if (state.products.length === 0) {
    showNotification('⚠️ No hay productos para exportar');
    return;
  }

  try {
    const data = state.products.map(p => ({
      ID: p.id,
      Producto: p.name,
      Unidad: p.unit || 'Unidad',
      Grupo: p.group || 'General',
      'Stock Almacén': p.stockByArea?.almacen || 0,
      'Stock Barra 1': p.stockByArea?.barra1 || 0,
      'Stock Barra 2': p.stockByArea?.barra2 || 0,
      'Stock Total': (p.stockByArea?.almacen || 0) + (p.stockByArea?.barra1 || 0) + (p.stockByArea?.barra2 || 0),
      CapacidadML: p.capacidadMl || '',
      PesoBotellaOz: p.pesoBotellaLlenaOz || '',
    }));

    const ws = window.XLSX.utils.json_to_sheet(data);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Productos');

    const fileName = `inventario_${new Date().toISOString().slice(0, 10)}.xlsx`;
    window.XLSX.writeFile(wb, fileName);

    showNotification(`✅ Archivo "${fileName}" descargado`);
    console.info(`[Export] ${data.length} productos exportados a ${fileName}`);
  } catch (error) {
    showNotification('❌ Error al exportar: ' + error.message);
    console.error('[Export] Error:', error);
  }
}

// ═════════════════════════════════════════════════════════════
// BINDING GLOBAL (para onclick en HTML)
// ═════════════════════════════════════════════════════════════

window.handleFileImport = handleFileImport;
window.exportToExcel = exportToExcel;
window.addProduct = addProduct;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.transferStock = transferStock;
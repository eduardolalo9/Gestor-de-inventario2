/**
 * js/products.js — v2.1
 * ══════════════════════════════════════════════════════════════
 * Gestión de productos: CRUD, importación Excel, sincronización
 * de stock por área desde conteo.
 * ══════════════════════════════════════════════════════════════
 */

// ═══ IMPORTS (siempre al inicio del módulo) ═══════════════════
import { state } from './state.js';
import { showNotification } from './ui.js';
import { saveToLocalStorage } from './storage.js';

// ═════════════════════════════════════════════════════════════
// HELPER: parsear números de Excel (maneja comas, espacios, etc.)
// ═════════════════════════════════════════════════════════════

function parseExcelNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return isNaN(value) ? 0 : value;

  let str = String(value).trim();

  // Remover espacios internos
  str = str.replace(/\s/g, '');

  // Detectar formato europeo: 1.234,56 → 1234.56
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(str)) {
    str = str.replace(/\./g, '').replace(',', '.');
  }
  // Detectar formato con coma decimal simple: 12,5 → 12.5
  else if (/^\d+,\d+$/.test(str)) {
    str = str.replace(',', '.');
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

// ═════════════════════════════════════════════════════════════
// syncStockByAreaFromConteo()
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

  const AREAS = ['almacen', 'barra1', 'barra2'];

  state.products.forEach(product => {
    const conteo = state.inventarioConteo[product.id];
    if (!conteo) return;

    // Asegurar que stockByArea existe
    if (!product.stockByArea) {
      product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
    }

    // Aplicar cada área del conteo al stockByArea del producto
    AREAS.forEach(area => {
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
// handleFileImport() — Importación desde Excel
// ═════════════════════════════════════════════════════════════

/**
 * Maneja la importación de productos desde un archivo Excel.
 * Soporta .xlsx, .xls y .csv
 * Detecta columnas automáticamente por nombre (case-insensitive).
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

      // ── Validar hojas ─────────────────────────────────────────
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

      // ── Mapa de columnas (multi-nombre) ───────────────────────
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

      /**
       * Busca el valor de una columna por nombre.
       * Primero exacto, luego case-insensitive como fallback.
       */
      const findCol = (row, keys) => {
        for (const key of keys) {
          if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
            return row[key];
          }
        }
        // Fallback case-insensitive
        const rowKeys = Object.keys(row);
        for (const key of keys) {
          const found = rowKeys.find(rk => rk.toLowerCase() === key.toLowerCase());
          if (found && row[found] !== undefined && row[found] !== null && row[found] !== '') {
            return row[found];
          }
        }
        return undefined;
      };

      // ── Preparar IDs únicos ───────────────────────────────────
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

      // ── Procesar cada fila ────────────────────────────────────
      jsonData.forEach((row, rowIdx) => {
        const nameRaw = findCol(row, columnMap.name);
        const name = nameRaw !== undefined ? String(nameRaw).trim() : '';
        if (!name) {
          skipped++;
          return;
        }

        // ID: usar el del archivo o generar uno nuevo
        const rawId = findCol(row, columnMap.id);
        let id = rawId !== undefined ? String(rawId).trim() : '';

        if (!id || existingIds.has(id) || usedInBatch.has(id)) {
          do {
            id = 'PRD-' + String(nextNum++).padStart(3, '0');
          } while (existingIds.has(id) || usedInBatch.has(id));
        }
        usedInBatch.add(id);

        // Unidad
        const unitRaw = findCol(row, columnMap.unit);
        const unit = unitRaw !== undefined ? String(unitRaw).trim() : 'Unidad';

        // Grupo
        const groupRaw = findCol(row, columnMap.group);
        const group = groupRaw !== undefined ? String(groupRaw).trim() : 'General';

        // Stock
        const stockRaw = findCol(row, columnMap.stock);
        const stock = stockRaw !== undefined ? parseExcelNumber(stockRaw) : 0;

        // Capacidad ML
        const capRaw = findCol(row, columnMap.capacidadMl);
        const capacidadMl = capRaw !== undefined
          ? (isNaN(parseFloat(capRaw)) ? null : parseFloat(capRaw))
          : null;

        // Peso botella llena Oz
        const pesoRaw = findCol(row, columnMap.pesoBotellaLlenaOz);
        const pesoBotellaLlenaOz = pesoRaw !== undefined
          ? (isNaN(parseFloat(pesoRaw)) ? null : parseFloat(pesoRaw))
          : null;

        // ── Crear producto ────────────────────────────────────────
        const product = {
          id,
          name,
          unit,
          group,
          stockByArea: { almacen: stock, barra1: 0, barra2: 0 },
        };
        if (capacidadMl !== null && capacidadMl > 0) {
          product.capacidadMl = capacidadMl;
        }
        if (pesoBotellaLlenaOz !== null && pesoBotellaLlenaOz > 0) {
          product.pesoBotellaLlenaOz = pesoBotellaLlenaOz;
        }

        toImport.push(product);
      });

      // ── Resultado ─────────────────────────────────────────────
      if (toImport.length === 0) {
        showNotification('⚠️ No se encontraron productos válidos en el archivo. Verifica las columnas.');
        fileInput.value = '';
        return;
      }

      state.products = state.products.concat(toImport);

      console.info(`[Import] ✅ ${toImport.length} productos importados, ${skipped} filas omitidas`);
      showNotification(
        `✅ ${toImport.length} productos importados.${skipped ? ' ' + skipped + ' filas omitidas.' : ''}`
      );

      // ── Reset de UI y guardar ─────────────────────────────────
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
// EXPORTS ADICIONALES (si los necesitas en otros módulos)
// ═════════════════════════════════════════════════════════════

/**
 * Utilidad pública para parsear números de Excel.
 * Útil si otros módulos necesitan la misma lógica.
 */
export { parseExcelNumber };
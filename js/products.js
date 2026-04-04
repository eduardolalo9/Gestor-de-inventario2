export function handleFileImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const fileInput = event.target;

  console.info('[Import] Archivo recibido:', file.name, file.size, 'bytes');

  // Validar que sea Excel
  const validExtensions = ['.xlsx', '.xls', '.csv'];
  const fileName = file.name.toLowerCase();
  const isValid = validExtensions.some(ext => fileName.endsWith(ext));
  if (!isValid) {
    showNotification('⚠️ Selecciona un archivo Excel (.xlsx, .xls, .csv)');
    fileInput.value = '';
    return;
  }

  // Validar que XLSX esté disponible
  if (typeof window.XLSX === 'undefined' || !window.XLSX.read) {
    showNotification('❌ La librería XLSX no está cargada. Recarga la página.');
    fileInput.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onerror = function() {
    showNotification('❌ Error al leer el archivo');
    fileInput.value = '';
  };

  reader.onload = function(e) {
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

      const columnMap = {
        id:   ['ID','Id','id','Código','codigo'],
        name: ['Producto','Nombre','Descripción','descripcion','producto',
               'nombre','Name','name','PRODUCTO','NOMBRE'],
        unit: ['Unidad','unidad','Medida','medida','Unit','UNIDAD'],
        group:['Grupo','grupo','Categoría','categoria','Group','GRUPO'],
        stock:['Cantidad','cantidad','Stock','stock','Enteras',
               'CANTIDAD','STOCK'],
        capacidadMl: ['CapacidadML','capacidadMl','CapacidadMl',
                      'Capacidad_ML','CapML','capacidadML','capacidadml'],
        pesoBotellaLlenaOz: ['PesoBotellaOz','pesoBotellaOz',
                             'PesoLlenaOz','PesoBotella_Oz','PesoOz',
                             'PesoBotella0z','pesobotella0z',
                             'pesoBotella0z','pesoBotellaLlenaOz',
                             'PesoBotellaLlenaOz'],
      };

      const findCol = (row, keys) => {
        for (const key of keys) {
          if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
            return row[key];
          }
        }
        // Búsqueda case-insensitive como fallback
        const rowKeys = Object.keys(row);
        for (const key of keys) {
          const found = rowKeys.find(rk => rk.toLowerCase() === key.toLowerCase());
          if (found && row[found] !== undefined && row[found] !== null && row[found] !== '') {
            return row[found];
          }
        }
        return undefined;
      };

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

      jsonData.forEach((row, rowIdx) => {
        const nameRaw = findCol(row, columnMap.name);
        const name = nameRaw !== undefined ? String(nameRaw).trim() : '';
        if (!name) { skipped++; return; }

        const rawId = findCol(row, columnMap.id);
        let id = rawId !== undefined ? String(rawId).trim() : '';

        // Si el ID ya existe o está vacío, generar uno nuevo
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
        const capacidadMl = (capRaw !== undefined)
          ? (isNaN(parseFloat(capRaw)) ? null : parseFloat(capRaw))
          : null;

        const pesoRaw = findCol(row, columnMap.pesoBotellaLlenaOz);
        const pesoBotellaLlenaOz = (pesoRaw !== undefined)
          ? (isNaN(parseFloat(pesoRaw)) ? null : parseFloat(pesoRaw))
          : null;

        const product = {
          id, name, unit, group,
          stockByArea: { almacen: stock, barra1: 0, barra2: 0 }
        };
        if (capacidadMl !== null && capacidadMl > 0) product.capacidadMl = capacidadMl;
        if (pesoBotellaLlenaOz !== null && pesoBotellaLlenaOz > 0) product.pesoBotellaLlenaOz = pesoBotellaLlenaOz;

        toImport.push(product);
      });

      if (toImport.length === 0) {
        showNotification('⚠️ No se encontraron productos válidos en el archivo. Verifica las columnas.');
        fileInput.value = '';
        return;
      }

      state.products = state.products.concat(toImport);

      console.info(`[Import] ✅ ${toImport.length} productos importados, ${skipped} filas omitidas`);
      showNotification(`✅ ${toImport.length} productos importados.${skipped ? ' ' + skipped + ' filas omitidas.' : ''}`);

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
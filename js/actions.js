/**
 * js/actions.js — v3.3
 * ══════════════════════════════════════════════════════════════
 * NUEVO v3.3:
 *   exportarAuditoriaExcel() — CORRECCIÓN de cálculo de totales.
 *   El total por área se obtiene vía calcularTotalMultiUsuario()
 *   (corregido en products.js v2.4). La columna "Abiertas (oz)"
 *   sigue mostrando el promedio de oz entre bartenders como valor
 *   informativo; el Total usa la conversión correcta por botella.
 *   Ver fix detallado en products.js v2.4.
 *
 * NUEVO v3.2:
 *   Cantidad de pedido con decimales (step 0.001):
 *   - Input numérico reemplaza al <span> en openOrderModal()
 *   - _cartSetQty() permite editar la cantidad directamente en el campo
 *   - _cartInc / _cartDec mantienen precisión de 3 decimales
 *   - _fmtQty() ya formateaba decimales correctamente (sin cambios)
 *
 * NUEVO v3.1:
 *   exportarAuditoriaExcel() — Formato EXACTO según especificación:
 *     Hoja "Auditoría"
 *     Columnas: ID | Nombre | Unidad | Grupo | CapacidadML | PesoBotellaOz
 *               | [Área Enteras | Área Abiertas (oz) | Área Total] x3
 *               | Total General | Estado
 *     Subtotales por categoría después de cada grupo de productos.
 *     Gran Total al final.
 *     Estado: "Conversión realizada" | "Falta capacidadMl o pesoBotellaLlenaOz"
 *
 *   Los cálculos usan calcularTotalMultiUsuario para consolidar
 *   los conteos de múltiples bartenders (promedio de enteras,
 *   fracción de abiertas calculada botella a botella).
 * ══════════════════════════════════════════════════════════════
 */

import { state }                    from './state.js';
import { saveToLocalStorage }       from './storage.js';
import { showNotification,
         showConfirm,
         escapeHtml }               from './ui.js';
import { deleteProduct as _deleteProduct,
         addProduct,
         updateProduct,
         calcularStockTotal,
         calcularTotalMultiUsuario } from './products.js';
import { AREAS, AREA_KEYS,
         PESO_BOTELLA_VACIA_OZ }    from './constants.js';

const _render = () => import('./render.js').then(m => m.renderTab()).catch(() => {});

function _commit() {
  saveToLocalStorage();
  _render();
  if (state.syncEnabled && window._db && navigator.onLine) {
    import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
  }
}

const _el = id => document.getElementById(id);
function _showModal(id) { _el(id)?.classList.remove('hidden'); }
function _hideModal(id) { _el(id)?.classList.add('hidden'); }

function _fmtQty(qty) {
  const n = parseFloat(qty) || 0;
  if (Number.isInteger(n)) return String(n);
  let s = n.toFixed(3);
  if (s.startsWith('0.')) s = s.slice(1);
  return s;
}

function _fmtTotal(qty) {
  const n = parseFloat(qty) || 0;
  return parseFloat(n.toFixed(3)).toString();
}

let _editingProductId = null;
let _invProductId = null;
let _invArea      = null;

// ══════════════════════════════════════════════════════════════
// MODAL DE PRODUCTO
// ══════════════════════════════════════════════════════════════

function openProductModal(productId = null) {
  if (state.userRole !== 'admin') {
    showNotification('⛔ Solo el administrador puede modificar productos');
    return;
  }

  _editingProductId = productId || null;
  const isEdit  = !!productId;
  const product = isEdit ? state.products.find(p => p.id === productId) : null;
  if (isEdit && !product) { showNotification('⚠️ Producto no encontrado'); return; }

  const titleEl = _el('productModalTitle');
  if (titleEl) titleEl.textContent = isEdit ? '✏️ Editar producto' : '➕ Nuevo producto';

  const fId    = _el('productId');
  const fName  = _el('productName');
  const fUnit  = _el('productUnit');
  const fGroup = _el('productGroup');
  const fCap   = _el('productCapacidadMl');
  const fPeso  = _el('productPesoLlenaOz');

  if (fId)   { fId.value = product?.id || '';  fId.disabled = isEdit; }
  if (fName)  fName.value  = product?.name  || '';
  if (fUnit && product?.unit) fUnit.value  = product.unit;
  if (fGroup) fGroup.value = product?.group || '';
  if (fCap)   fCap.value   = product?.capacidadMl        || '';
  if (fPeso)  fPeso.value  = product?.pesoBotellaLlenaOz || '';

  _showModal('productModal');
  setTimeout(() => fName?.focus(), 60);
}

function editProduct(id) { openProductModal(id); }

function closeProductModal() {
  _hideModal('productModal');
  _editingProductId = null;
}

function saveProduct() {
  if (state.userRole !== 'admin') { showNotification('⛔ Solo el administrador'); return; }

  const name  = _el('productName')?.value.trim();
  const unit  = _el('productUnit')?.value.trim();
  const group = _el('productGroup')?.value.trim();
  // FIX BUG-PROD-1 (ver también products.js updateProduct): `parseFloat(x) || null`
  // convertía un 0 real en null porque 0 es falsy en JS. Usamos un parseo explícito
  // que solo cae a null cuando el campo está vacío o no es un número válido.
  const capRaw  = _el('productCapacidadMl')?.value;
  const pesoRaw = _el('productPesoLlenaOz')?.value;
  const capV  = (capRaw  === '' || isNaN(parseFloat(capRaw)))  ? null : parseFloat(capRaw);
  const pesoV = (pesoRaw === '' || isNaN(parseFloat(pesoRaw))) ? null : parseFloat(pesoRaw);
  const idVal = _el('productId')?.value.trim();

  if (!name) { showNotification('⚠️ Ingresa un nombre'); return; }
  if (!unit) { showNotification('⚠️ Selecciona una unidad'); return; }

  if (_editingProductId) {
    updateProduct(_editingProductId, {
      name, unit,
      group:              group || 'General',
      capacidadMl:        capV,
      pesoBotellaLlenaOz: pesoV,
    });
  } else {
    addProduct({
      id:                 idVal,
      name, unit,
      group:              group || 'General',
      capacidadMl:        capV,
      pesoBotellaLlenaOz: pesoV,
    });
  }

  closeProductModal();
  _commit();
}

async function deleteProduct(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;
  const ok = await showConfirm(`¿Eliminar "${product.name}"?\nSe borrará de todas las áreas.`);
  if (!ok) return;
  _deleteProduct(id);
  _commit();
}

async function deleteAllProducts() {
  if (state.userRole !== 'admin') return;
  const ok = await showConfirm('⚠️ ¿Eliminar TODOS los productos?\nEsta acción no se puede deshacer.');
  if (!ok) return;
  state.products                   = [];
  state.inventarioConteo           = {};
  state.auditoriaConteo            = {};
  // FIX BUG-A1: limpiar también los mapas multi-usuario para que los bartenders
  // no aparezcan bloqueados en el siguiente ciclo sin haber contado nada.
  state.auditoriaConteoPorUsuario  = {};
  state.conteoFinalizadoPorUsuario = { almacen: {}, barra1: {}, barra2: {} };
  _commit();
}

// ══════════════════════════════════════════════════════════════
// CARRITO / PEDIDOS
// ══════════════════════════════════════════════════════════════

function addToCart(productId) {
  const product = state.products.find(p => p.id === productId);
  if (!product) return;
  const item = state.cart.find(i => i.id === productId);
  if (item) { item.quantity++; }
  else { state.cart.push({ id: productId, name: product.name, unit: product.unit || 'Unidad', quantity: 1 }); }
  showNotification(`🛒 ${product.name} (+1)`);
  _commit();
}

function openOrderModal() {
  if (state.cart.length === 0) { showNotification('⚠️ El carrito está vacío'); return; }
  const tbody  = _el('orderProductsTable');
  const empty  = _el('emptyCart');
  const total  = _el('orderTotal');
  if (tbody) {
    tbody.innerHTML = '';
    state.cart.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-4 py-3 text-gray-900 text-sm">${escapeHtml(item.name)}</td>
        <td class="px-4 py-3 text-center text-gray-600 text-sm">${escapeHtml(item.unit)}</td>
        <td class="px-4 py-3 text-center font-semibold text-gray-900 text-sm">
          <div class="flex items-center justify-center gap-2">
            <button onclick="window._cartDec('${escapeHtml(item.id)}')"
              class="w-6 h-6 bg-gray-100 rounded-full text-gray-600 font-bold">-</button>
            <input type="number" min="0.001" step="0.001"
              value="${_fmtQty(item.quantity)}"
              data-cart-id="${escapeHtml(item.id)}"
              onchange="window._cartSetQty(this.dataset.cartId, this.value)"
              style="width:64px;text-align:center;border:1px solid #d1d5db;border-radius:6px;padding:2px 4px;font-size:0.85rem;font-weight:600;color:#111827;background:#fff;">
            <button onclick="window._cartInc('${escapeHtml(item.id)}')"
              class="w-6 h-6 bg-gray-100 rounded-full text-gray-600 font-bold">+</button>
          </div>
        </td>
        <td class="px-4 py-3 text-center">
          <button onclick="window._cartRemove('${escapeHtml(item.id)}')"
            class="text-red-500 text-xs">✕</button>
        </td>`;
      tbody.appendChild(tr);
    });
  }
  if (empty) empty.classList.toggle('hidden', state.cart.length > 0);
  const t = state.cart.reduce((s, i) => s + i.quantity, 0);
  if (total) total.textContent = `Total: ${t}`;
  _showModal('orderModal');
}

window._cartInc    = id => { const i = state.cart.find(x => x.id === id); if (i) { i.quantity = Math.round((i.quantity + 1) * 1000) / 1000; openOrderModal(); } };
window._cartDec    = id => { const i = state.cart.find(x => x.id === id); if (i && i.quantity > 1) { i.quantity = Math.round((i.quantity - 1) * 1000) / 1000; openOrderModal(); } };
// FIX BUG-ACT-1: _cartRemove llamaba openOrderModal() incluso cuando el carrito
// quedaba vacío. openOrderModal tiene un guard que muestra notificación y hace
// return, pero el modal ya estaba abierto → el usuario veía el modal sin cerrarse
// con la notificación "El carrito está vacío". Ahora: si el carrito queda vacío
// tras el filtrado, se cierra el modal directamente en lugar de intentar reabrirlo.
window._cartRemove = id => {
  state.cart = state.cart.filter(x => x.id !== id);
  if (state.cart.length === 0) {
    closeOrderModal();
    showNotification('🛒 Carrito vacío');
  } else {
    openOrderModal();
  }
};
window._cartSetQty = (id, val) => {
  const i = state.cart.find(x => x.id === id);
  if (!i) return;
  const n = Math.round(parseFloat(val) * 1000) / 1000;
  if (isNaN(n) || n <= 0) { openOrderModal(); return; }
  i.quantity = n;
  // Actualizar total sin re-renderizar la tabla completa para no perder el foco
  const totalEl = document.getElementById('orderTotal');
  if (totalEl) {
    const t = state.cart.reduce((s, x) => s + x.quantity, 0);
    totalEl.textContent = 'Total: ' + (Math.round(t * 1000) / 1000);
  }
  import('./storage.js').then(m => m.saveToLocalStorage()).catch(() => {});
};

function closeOrderModal() { _hideModal('orderModal'); }

function createOrder() {
  const supplier     = _el('orderSupplier')?.value.trim();
  const deliveryDate = _el('orderDeliveryDate')?.value;
  const note         = _el('orderNote')?.value.trim();

  if (!supplier) { showNotification('⚠️ Ingresa el nombre del proveedor'); return; }
  if (state.cart.length === 0) { showNotification('⚠️ El carrito está vacío'); return; }

  const now    = new Date();
  const order  = {
    id:           'PED-' + now.getTime(),
    date:         now.toLocaleDateString('es-MX'),
    time:         now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
    supplier,
    deliveryDate: deliveryDate || null,
    note:         note || null,
    products:     state.cart.map(i => ({ ...i })),
    total:        state.cart.reduce((s, i) => s + i.quantity, 0),
  };

  state.orders.unshift(order);
  state.cart = [];

  const lines = [
    `📦 *PEDIDO BarInventory*`,
    `🏪 Proveedor: ${order.supplier}`,
    `📅 Fecha: ${order.date} ${order.time}`,
    deliveryDate ? `Entrega: ${deliveryDate}` : null,
    note ? `📝 Nota: ${note}` : null,
    ``,
    ...order.products.map(p => `• ${p.name} (${p.unit}): *${_fmtQty(p.quantity)}*`),
    ``,
    `Total: *${_fmtTotal(order.total)}*`,
  ].filter(l => l !== null).join('\n');

  const url = `https://wa.me/?text=${encodeURIComponent(lines)}`;
  window.open(url, '_blank');

  closeOrderModal();
  _commit();
}

function shareOrderWhatsApp(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;
  const lines = [
    `📦 *PEDIDO BarInventory* (Reenvío)`,
    `🏪 Proveedor: ${order.supplier}`,
    `📅 Fecha original: ${order.date} ${order.time}`,
    ``,
    ...order.products.map(p => `• ${p.name} (${p.unit}): *${_fmtQty(p.quantity)}*`),
    ``,
    `Total: *${_fmtTotal(order.total)}*`,
  ].join('\n');
  window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, '_blank');
}

async function deleteOrder(id) {
  const ok = await showConfirm('¿Eliminar este pedido del historial?');
  if (!ok) return;
  state.orders = state.orders.filter(o => o.id !== id);
  _commit();
}

// ══════════════════════════════════════════════════════════════
// INVENTARIO OPERATIVO (MODAL)
// ══════════════════════════════════════════════════════════════

function openInventarioModal(productId) {
  const product = state.products.find(p => p.id === productId);
  if (!product) { showNotification('⚠️ Producto no encontrado'); return; }

  const area  = state.auditoriaAreaActiva || state.selectedArea || 'almacen';
  const modal = _el('inventarioModal');
  if (!modal) { _openInventarioFallback(productId, area, product); return; }

  _invProductId = productId;
  _invArea      = area;

  const titleEl    = _el('inventarioModalTitle');
  const subtitleEl = _el('inventarioModalSubtitle');
  const hintEl     = _el('inv_abiertasUnidadHint');

  if (titleEl)    titleEl.textContent    = product.name;
  if (subtitleEl) subtitleEl.textContent = `Área: ${AREAS[area] || area}`;
  if (hintEl) {
    hintEl.textContent = product.pesoBotellaLlenaOz
      ? `(oz — llena: ${product.pesoBotellaLlenaOz} oz)` : '(oz)';
  }

  const enterasInput = _el('inv_enteras');
  if (enterasInput) {
    const current =
      state.auditoriaConteo[productId]?.[area]?.enteras ??
      state.inventarioConteo[productId]?.[area]         ??
      product.stockByArea?.[area] ?? 0;
    enterasInput.value = String(current);
  }

  const container = _el('inv_abiertasContainer');
  if (container) {
    container.innerHTML = '';
    const abiertas = state.auditoriaConteo[productId]?.[area]?.abiertas ?? [];
    abiertas.forEach(oz => _addAbiertaRow(container, oz));
  }

  _showModal('inventarioModal');
  setTimeout(() => { enterasInput?.focus(); enterasInput?.select(); }, 60);
}

function _addAbiertaRow(container, valorOz = '') {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
  row.innerHTML = `
    <input type="number" min="0" step="0.1" value="${valorOz}"
      placeholder="Peso actual (oz)"
      style="flex:1;padding:8px 10px;background:#f9fafb;border:2px solid #f97316;
             border-radius:8px;color:#111827;font-size:0.9rem;text-align:center;"
      oninput="if(parseFloat(this.value)<0||isNaN(parseFloat(this.value)))this.value='';">
    <button type="button" onclick="this.parentElement.remove()"
      style="width:30px;height:30px;flex-shrink:0;border-radius:50%;
             border:none;background:#fee2e2;color:#dc2626;font-size:0.8rem;cursor:pointer;">✕</button>`;
  container.appendChild(row);
  row.querySelector('input')?.focus();
}

function addAbiertaInModal() {
  const container = _el('inv_abiertasContainer');
  if (container) _addAbiertaRow(container);
}

function closeInventarioModal() {
  _hideModal('inventarioModal');
  _invProductId = null;
  _invArea      = null;
}

function saveInventarioModal() {
  if (!_invProductId || !_invArea) { closeInventarioModal(); return; }
  const productId = _invProductId;
  const area      = _invArea;
  const product   = state.products.find(p => p.id === productId);
  if (!product) { closeInventarioModal(); return; }

  const enteras = Math.max(0, parseFloat(_el('inv_enteras')?.value) || 0);

  const container = _el('inv_abiertasContainer');
  const abiertas  = [];
  const maxOz     = (product.pesoBotellaLlenaOz || 200) + 5;
  let rangeError  = false;

  if (container) {
    container.querySelectorAll('input[type="number"]').forEach(inp => {
      const val = parseFloat(inp.value);
      if (isNaN(val) || val <= 0) return;
      if (val > maxOz) { inp.style.borderColor = '#ef4444'; rangeError = true; return; }
      inp.style.borderColor = '#f97316';
      abiertas.push(Math.round(val * 100) / 100);
    });
  }

  if (rangeError) {
    showNotification(`⚠️ Algún peso supera ${maxOz} oz — verifica los valores`);
    return;
  }

  if (!state.auditoriaConteo[productId])       state.auditoriaConteo[productId] = {};
  state.auditoriaConteo[productId][area] = { enteras, abiertas };

  if (!state.inventarioConteo[productId]) state.inventarioConteo[productId] = {};
  state.inventarioConteo[productId][area] = enteras;

  if (!product.stockByArea) product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
  product.stockByArea[area] = enteras;

  const totalText = abiertas.length > 0
    ? `${enteras} ent. + ${abiertas.length} ab.`
    : `${enteras} uds`;
  showNotification(`✅ ${product.name}: ${totalText} en ${AREAS[area] || area}`);

  closeInventarioModal();
  _commit();
}

function _openInventarioFallback(productId, area, product) {
  const current = product.stockByArea?.[area] || 0;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:var(--card,#fff);border-radius:12px;padding:24px;max-width:320px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.3);">
      <p style="font-weight:700;font-size:0.9rem;color:#111;margin:0 0 4px;">${escapeHtml(product.name)}</p>
      <p style="font-size:0.72rem;color:#6b7280;margin:0 0 16px;">Área: ${AREAS[area] || area}</p>
      <input id="_inv_fb" type="number" min="0" step="0.5" value="${current}"
        style="width:100%;padding:10px;font-size:1.1rem;background:#f9fafb;border:2px solid #c4b5fd;border-radius:8px;text-align:center;box-sizing:border-box;">
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="_inv_fb_cancel" style="flex:1;padding:9px;border-radius:8px;background:#f9fafb;border:1px solid #e5e7eb;cursor:pointer;">Cancelar</button>
        <button id="_inv_fb_save" style="flex:2;padding:9px;border-radius:8px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);border:none;color:#fff;font-weight:700;cursor:pointer;">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#_inv_fb_cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#_inv_fb_save').addEventListener('click', () => {
    const qty = parseFloat(overlay.querySelector('#_inv_fb').value);
    if (isNaN(qty) || qty < 0) { showNotification('⚠️ Valor inválido'); return; }
    if (!product.stockByArea) product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
    product.stockByArea[area] = qty;
    if (!state.inventarioConteo[productId]) state.inventarioConteo[productId] = {};
    state.inventarioConteo[productId][area] = qty;
    if (!state.auditoriaConteo[productId]) state.auditoriaConteo[productId] = {};
    if (!state.auditoriaConteo[productId][area]) state.auditoriaConteo[productId][area] = { enteras: 0, abiertas: [] };
    state.auditoriaConteo[productId][area].enteras = qty;
    close(); _commit();
  });
  setTimeout(() => { const i = overlay.querySelector('#_inv_fb'); i?.focus(); i?.select(); }, 50);
}

// ══════════════════════════════════════════════════════════════
// HISTORIAL DE INVENTARIO
// ══════════════════════════════════════════════════════════════

function switchArea(area) {
  state.selectedArea = area;
  saveToLocalStorage();
  _render();
}

function saveInventory(area) {
  const areaLabel = AREAS[area] || area;
  const snapshot = {
    id:            'INV-' + Date.now(),
    date:          new Date().toLocaleString('es-MX'),
    area,
    totalProducts: 0,
    products:      [],
  };
  let total = 0;
  state.products.forEach(p => {
    const stock = p.stockByArea?.[area] || 0;
    if (stock > 0) {
      snapshot.products.push({ id: p.id, name: p.name, unit: p.unit, stock });
      total += stock;
    }
  });
  snapshot.totalProducts = total;
  state.inventories.unshift(snapshot);
  showNotification(`✅ Inventario de ${areaLabel} guardado`);
  _commit();
}

function shareInventoryWhatsApp(invId) {
  const inv = state.inventories.find(i => i.id === invId);
  if (!inv) return;
  const lines = [
    `📊 *INVENTARIO BarInventory*`,
    `Área: ${AREAS[inv.area] || inv.area}`,
    `Fecha: ${inv.date}`,
    ``,
    ...inv.products.map(p => `• ${p.name}: *${_fmtQty(p.stock)} ${p.unit}*`),
    ``,
    `Total: *${_fmtTotal(inv.totalProducts)}*`,
  ].join('\n');
  window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, '_blank');
}

async function deleteInventory(id) {
  const ok = await showConfirm('¿Eliminar este registro de inventario?');
  if (!ok) return;
  state.inventories = state.inventories.filter(i => i.id !== id);
  _commit();
}

async function resetAllInventario() {
  if (state.userRole !== 'admin') return;
  const ok = await showConfirm('⚠️ ¿Resetear TODO el inventario a cero?\nSe perderán todos los conteos actuales.');
  if (!ok) return;
  state.products.forEach(p => { p.stockByArea = { almacen: 0, barra1: 0, barra2: 0 }; });
  state.inventarioConteo           = {};
  state.auditoriaConteo            = {};
  // FIX BUG-A1: limpiar también los mapas multi-usuario para que los bartenders
  // no aparezcan bloqueados en el siguiente ciclo sin haber contado nada.
  state.auditoriaConteoPorUsuario  = {};
  state.conteoFinalizadoPorUsuario = { almacen: {}, barra1: {}, barra2: {} };
  _commit();
  showNotification('✅ Inventario reseteado');
}

// ══════════════════════════════════════════════════════════════
// EXPORTAR EXCEL — INVENTARIO OPERATIVO
// ══════════════════════════════════════════════════════════════

function exportToExcel(modo = 'INVENTARIO') {
  if (typeof window.XLSX === 'undefined') { showNotification('❌ Librería XLSX no disponible'); return; }
  if (modo !== 'INVENTARIO') { showNotification(`⚠️ Modo "${modo}" desconocido`); return; }
  const rows = [
    ['ID','Producto','Unidad','Grupo','Almacén','Barra 1','Barra 2','Total'],
    ...state.products.map(p => {
      const { porArea, total } = calcularStockTotal(p.id);
      return [p.id, p.name, p.unit||'', p.group||'General',
        (porArea.almacen||0).toFixed(4),(porArea.barra1||0).toFixed(4),
        (porArea.barra2||0).toFixed(4),total.toFixed(4)];
    }),
  ];
  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  const fileName = `inventario_${new Date().toISOString().slice(0,10)}.xlsx`;
  window.XLSX.writeFile(wb, fileName);
  showNotification(`📊 Excel exportado: ${fileName}`);
}

// ══════════════════════════════════════════════════════════════
// EXPORTAR EXCEL — AUDITORÍA (FORMATO EXACTO)
// ══════════════════════════════════════════════════════════════

/**
 * Genera la hoja "Auditoría" con el formato exacto especificado:
 *
 *   ID | Nombre | Unidad | Grupo | CapacidadML | PesoBotellaOz
 *   [Almacén Enteras | Almacén Abiertas (oz) | Almacén Total]
 *   [Barra1 Enteras  | Barra1 Abiertas (oz)  | Barra1 Total]
 *   [Barra2 Enteras  | Barra2 Abiertas (oz)  | Barra2 Total]
 *   Total General | Estado
 *
 *   - Enteras:       promedio redondeado de todos los bartenders en esa área
 *   - Abiertas (oz): suma total de los pesos oz de todas las botellas abiertas
 *                    de todos los bartenders (no solo el count)
 *   - Total:         enteras + fracciones calculadas por conversión oz→fracción
 *   - Estado:        "Conversión realizada" | "Falta capacidadMl o pesoBotellaLlenaOz"
 *
 *   Filas de subtotal por categoría/grupo.
 *   Gran Total al final.
 */
function exportarAuditoriaExcel() {
  if (typeof window.XLSX === 'undefined') { showNotification('❌ Librería XLSX no disponible'); return; }

  // ── Cabecera ─────────────────────────────────────────────────
  const AREA_LABELS = { almacen: 'Almacén', barra1: 'Barra 1', barra2: 'Barra 2' };

  const header = ['ID', 'Nombre', 'Unidad', 'Grupo', 'CapacidadML', 'PesoBotellaOz'];
  AREA_KEYS.forEach(area => {
    const lbl = AREA_LABELS[area] || area;
    header.push(`${lbl} Enteras`, `${lbl} Abiertas (oz)`, `${lbl} Total`);
  });
  header.push('Total General', 'Estado');

  const NUM_COLS = header.length;

  // ── Agrupar productos por grupo ───────────────────────────────
  const groupMap = new Map(); // preserva orden de inserción
  state.products.forEach(p => {
    const g = (p.group || 'General').trim();
    if (!groupMap.has(g)) groupMap.set(g, []);
    groupMap.get(g).push(p);
  });

  const sortedGroups = [...groupMap.keys()].sort((a, b) => a.localeCompare(b, 'es'));

  // ── Construir filas ───────────────────────────────────────────
  const rows   = [header];
  let   granTotal = 0;

  sortedGroups.forEach(groupName => {
    const products = groupMap.get(groupName);
    let subtotal   = 0;

    products.forEach(p => {
      const row = [
        p.id,
        p.name,
        p.unit  || '',
        p.group || 'General',
        p.capacidadMl        != null ? p.capacidadMl        : '',
        p.pesoBotellaLlenaOz != null ? p.pesoBotellaLlenaOz : '',
      ];

      let totalGeneral = 0;

      AREA_KEYS.forEach(area => {
        // ── Consolidar multi-usuario ──────────────────────────
        const porUsuario = state.auditoriaConteoPorUsuario[p.id]?.[area] || {};
        const usuarios   = Object.values(porUsuario);

        let enteras, totalOzAbiertas, total;

        if (usuarios.length > 0) {
          // Promedio de enteras
          const sumEnteras  = usuarios.reduce((s, u) => s + (u.enteras || 0), 0);
          enteras = Math.round(sumEnteras / usuarios.length);

          // ── Columna "Abiertas (oz)": promedio de oz entre bartenders ──────
          // Este valor es informativo: muestra el peso promedio consensuado
          // de las botellas abiertas. El cálculo de Total usa la conversión
          // correcta botella-a-botella vía calcularTotalMultiUsuario (v2.4).
          const userOzSums = usuarios.map(u =>
            Array.isArray(u.abiertas)
              ? u.abiertas.reduce((s, v) => s + (parseFloat(v) || 0), 0)
              : 0
          );
          totalOzAbiertas = userOzSums.length > 0
            ? Math.round((userOzSums.reduce((a, b) => a + b, 0) / userOzSums.length) * 100) / 100
            : 0;

          // Total consolidado: calcularTotalMultiUsuario (v2.4) calcula la
          // fracción de cada botella abierta individualmente descontando
          // pesoVacia por botella, luego promedia entre bartenders.
          total = parseFloat((calcularTotalMultiUsuario(p.id, area) || 0).toFixed(4));
        } else {
          // Fallback: auditoriaConteo (conteo del dispositivo local)
          const c     = state.auditoriaConteo[p.id]?.[area] || {};
          enteras     = c.enteras || 0;
          const abArr = Array.isArray(c.abiertas) ? c.abiertas : [];
          totalOzAbiertas = Math.round(abArr.reduce((s, v) => s + (parseFloat(v) || 0), 0) * 100) / 100;
          total       = parseFloat((_calcLocalTotal(p, enteras, abArr)).toFixed(4));
        }

        row.push(enteras, totalOzAbiertas, total);
        totalGeneral += total;
      });

      const tg     = Math.round(totalGeneral * 10000) / 10000;
      const estado = (p.capacidadMl && p.capacidadMl > 0 && p.pesoBotellaLlenaOz && p.pesoBotellaLlenaOz > 0)
        ? 'Conversión realizada'
        : 'Falta capacidadMl o pesoBotellaLlenaOz';

      row.push(tg, estado);
      rows.push(row);
      subtotal    += tg;
      granTotal   += tg;
    });

    // ── Fila de subtotal por grupo ────────────────────────────
    const subtotalRow = new Array(NUM_COLS).fill('');
    subtotalRow[1] = `SUBTOTAL — ${groupName}`;
    subtotalRow[NUM_COLS - 2] = Math.round(subtotal * 100) / 100;
    subtotalRow[NUM_COLS - 1] = '';
    rows.push(subtotalRow);
  });

  // ── Gran Total ────────────────────────────────────────────────
  const granTotalRow = new Array(NUM_COLS).fill('');
  granTotalRow[1] = 'GRAN TOTAL';
  granTotalRow[NUM_COLS - 2] = Math.round(granTotal * 100) / 100;
  rows.push(granTotalRow);

  // ── Construir hoja ────────────────────────────────────────────
  const ws = window.XLSX.utils.aoa_to_sheet(rows);

  // Anchos de columna
  ws['!cols'] = [
    { wch: 10 }, // ID
    { wch: 32 }, // Nombre
    { wch: 10 }, // Unidad
    { wch: 16 }, // Grupo
    { wch: 12 }, // CapacidadML
    { wch: 14 }, // PesoBotellaOz
    ...AREA_KEYS.flatMap(() => [{ wch: 14 }, { wch: 16 }, { wch: 12 }]),
    { wch: 14 }, // Total General
    { wch: 34 }, // Estado
  ];

  // Estilos básicos para filas de totales (negrita en col 1)
  const totalRowIdxs = [];
  let ri = 1;
  sortedGroups.forEach(g => {
    const products = groupMap.get(g);
    ri += products.length;
    totalRowIdxs.push(ri); // subtotal row
    ri++;
  });
  totalRowIdxs.push(ri); // gran total

  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Auditoría');

  const fecha    = new Date().toLocaleDateString('es-MX').replace(/\//g, '-');
  const fileName = `Auditoria_${fecha}.xlsx`;
  window.XLSX.writeFile(wb, fileName);
  showNotification(`📊 Auditoría exportada: ${fileName}`);
}

// ── Cálculo local de total (fallback sin multiusuario) ────────
function _calcLocalTotal(product, enteras, abiertasArr) {
  if (!abiertasArr || abiertasArr.length === 0) return enteras;
  const pesoLlena = product.pesoBotellaLlenaOz || 0;
  const pesoVacia = PESO_BOTELLA_VACIA_OZ || 14.0;
  if (pesoLlena <= pesoVacia) return enteras + abiertasArr.length * 0.5;
  const contenidoLlena = pesoLlena - pesoVacia;
  let totalAbiertas = 0;
  abiertasArr.forEach(oz => {
    const p = parseFloat(oz) || 0;
    if      (p <= pesoVacia) totalAbiertas += 0;
    else if (p >= pesoLlena) totalAbiertas += 1;
    else    totalAbiertas += (p - pesoVacia) / contenidoLlena;
  });
  return parseFloat((enteras + totalAbiertas).toFixed(4));
}

// ══════════════════════════════════════════════════════════════
// EXPORTAR JSON COMPLETO
// ══════════════════════════════════════════════════════════════

function exportFullData() {
  try {
    const backup = {
      _exportedAt:                 new Date().toISOString(),
      _version:                    '3.1',
      products:                    state.products,
      inventories:                 state.inventories,
      orders:                      state.orders,
      inventarioConteo:            state.inventarioConteo,
      auditoriaConteo:             state.auditoriaConteo,
      auditoriaStatus:             state.auditoriaStatus,
      auditoriaConteoPorUsuario:   state.auditoriaConteoPorUsuario,
      conteoFinalizadoPorUsuario:  state.conteoFinalizadoPorUsuario,
      ajustes:                     state.ajustes,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `BarInventory_backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification(`✅ Respaldo exportado — ${state.products.length} productos`);
  } catch (err) {
    showNotification('❌ Error al exportar: ' + err.message);
    console.error('[Export]', err);
  }
}

// ══════════════════════════════════════════════════════════════
// BINDINGS GLOBALES
// ══════════════════════════════════════════════════════════════

window.openProductModal       = openProductModal;
window.editProduct            = editProduct;
window.deleteProduct          = deleteProduct;
window.deleteAllProducts      = deleteAllProducts;
window.addToCart              = addToCart;
window.openOrderModal         = openOrderModal;
window.shareOrderWhatsApp     = shareOrderWhatsApp;
window.deleteOrder            = deleteOrder;
window.switchArea             = switchArea;
window.saveInventory          = saveInventory;
window.shareInventoryWhatsApp = shareInventoryWhatsApp;
window.deleteInventory        = deleteInventory;
window.resetAllInventario     = resetAllInventario;
window.openInventarioModal    = openInventarioModal;
window.exportToExcel          = exportToExcel;
window.exportarAuditoriaExcel = exportarAuditoriaExcel;
window.exportFullData         = exportFullData;

window.closeProductModal      = closeProductModal;
window.saveProduct            = saveProduct;
window.closeOrderModal        = closeOrderModal;
window.createOrder            = createOrder;
window.addAbiertaInModal      = addAbiertaInModal;
window.closeInventarioModal   = closeInventarioModal;
window.saveInventarioModal    = saveInventarioModal;

console.info('[Actions] ✓ v3.4 — _cartRemove cierra modal cuando carrito queda vacío (BUG-ACT-1).');

// ══════════════════════════════════════════════════════════════
// CORRECCIONES APLICADAS EN ESTA VERSIÓN (v3.4)
// ══════════════════════════════════════════════════════════════
// BUG-ACT-1: _cartRemove llamaba openOrderModal() incluso cuando el carrito
//   quedaba vacío tras eliminar el último item. openOrderModal() tiene un guard
//   que hace return si cart.length === 0, pero sin cerrar el modal primero → el
//   modal permanecía abierto sin contenido y con una notificación flotante.
//   CORRECCIÓN: si cart.length === 0 después del filtrado, se llama
//   closeOrderModal() + showNotification directamente, sin pasar por openOrderModal().

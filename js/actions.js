/**
 * js/actions.js — v1.0
 * ══════════════════════════════════════════════════════════════
 * Implementa y expone en window TODAS las funciones de acción
 * llamadas desde los onclick del HTML generado por render.js.
 *
 * PROBLEMA RESUELTO:
 *   render.js genera botones como:
 *     onclick="window.openProductModal()"
 *     onclick="window.addToCart(this.dataset.id)"
 *     onclick="window.editProduct(this.dataset.id)"
 *     ... etc.
 *   Pero ninguna de estas funciones estaba definida ni expuesta
 *   en window → "TypeError: window.X is not a function".
 *
 * CÓMO USARLO:
 *   En app.js, añadir al inicio de los imports:
 *     import './actions.js';
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
         AREA_KEYS }                from './products.js';
import { AREAS }                    from './constants.js';

// ── Lazy import de render para evitar circularidad ─────────────
const _render = () => import('./render.js').then(m => m.renderTab()).catch(() => {});

// ═════════════════════════════════════════════════════════════
//  PRODUCTOS — Modal de alta / edición
// ═════════════════════════════════════════════════════════════

/**
 * Abre el modal de producto.
 * Sin argumento → modo "Agregar nuevo".
 * Con productId  → modo "Editar existente".
 */
function openProductModal(productId = null) {
    if (state.userRole !== 'admin') {
        showNotification('⛔ Solo el administrador puede modificar productos');
        return;
    }

    const isEdit  = !!productId;
    const product = isEdit ? state.products.find(p => p.id === productId) : null;

    if (isEdit && !product) {
        showNotification('⚠️ Producto no encontrado');
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = '_productModalOverlay';
    overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;' +
        'display:flex;align-items:center;justify-content:center;' +
        'animation:fadeIn 0.15s ease both;';

    overlay.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border-mid);
                  border-radius:var(--r-lg);padding:24px 24px 20px;
                  max-width:400px;width:92%;box-shadow:var(--shadow-modal);
                  max-height:90vh;overflow-y:auto;">

        <p style="font-weight:700;font-size:0.95rem;color:var(--txt-primary);margin:0 0 16px;">
          ${isEdit ? '✏️ Editar producto' : '➕ Nuevo producto'}
        </p>

        <div style="display:flex;flex-direction:column;gap:12px;">

          <div>
            <label style="display:block;font-size:0.7rem;font-weight:700;
                          text-transform:uppercase;letter-spacing:.07em;
                          color:var(--txt-secondary);margin-bottom:4px;">
              Nombre *
            </label>
            <input id="_pm_name" type="text" value="${escapeHtml(product?.name || '')}"
              placeholder="Ej: Bacardí Blanco"
              style="width:100%;box-sizing:border-box;padding:8px 10px;
                     background:var(--surface);border:1px solid var(--border-mid);
                     border-radius:var(--r-md);color:var(--txt-primary);font-size:0.85rem;">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <label style="display:block;font-size:0.7rem;font-weight:700;
                            text-transform:uppercase;letter-spacing:.07em;
                            color:var(--txt-secondary);margin-bottom:4px;">
                Unidad
              </label>
              <input id="_pm_unit" type="text" value="${escapeHtml(product?.unit || 'Botella')}"
                placeholder="Botella, Caja, etc."
                style="width:100%;box-sizing:border-box;padding:8px 10px;
                       background:var(--surface);border:1px solid var(--border-mid);
                       border-radius:var(--r-md);color:var(--txt-primary);font-size:0.85rem;">
            </div>
            <div>
              <label style="display:block;font-size:0.7rem;font-weight:700;
                            text-transform:uppercase;letter-spacing:.07em;
                            color:var(--txt-secondary);margin-bottom:4px;">
                Grupo / Categoría
              </label>
              <input id="_pm_group" type="text" value="${escapeHtml(product?.group || 'Destilados')}"
                placeholder="Destilados, Cervezas…"
                style="width:100%;box-sizing:border-box;padding:8px 10px;
                       background:var(--surface);border:1px solid var(--border-mid);
                       border-radius:var(--r-md);color:var(--txt-primary);font-size:0.85rem;">
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <label style="display:block;font-size:0.7rem;font-weight:700;
                            text-transform:uppercase;letter-spacing:.07em;
                            color:var(--txt-secondary);margin-bottom:4px;">
                Capacidad (mL)
              </label>
              <input id="_pm_capacidad" type="number" min="0" step="1"
                value="${product?.capacidadMl || ''}"
                placeholder="750"
                style="width:100%;box-sizing:border-box;padding:8px 10px;
                       background:var(--surface);border:1px solid var(--border-mid);
                       border-radius:var(--r-md);color:var(--txt-primary);font-size:0.85rem;">
            </div>
            <div>
              <label style="display:block;font-size:0.7rem;font-weight:700;
                            text-transform:uppercase;letter-spacing:.07em;
                            color:var(--txt-secondary);margin-bottom:4px;">
                Peso lleno (oz)
              </label>
              <input id="_pm_peso" type="number" min="0" step="0.1"
                value="${product?.pesoBotellaLlenaOz || ''}"
                placeholder="55.0"
                style="width:100%;box-sizing:border-box;padding:8px 10px;
                       background:var(--surface);border:1px solid var(--border-mid);
                       border-radius:var(--r-md);color:var(--txt-primary);font-size:0.85rem;">
            </div>
          </div>

        </div>

        <div style="display:flex;gap:10px;margin-top:20px;">
          <button id="_pm_cancel"
            style="flex:1;padding:9px;border-radius:var(--r-md);
                   background:var(--surface);border:1px solid var(--border-mid);
                   color:var(--txt-secondary);font-size:0.82rem;cursor:pointer;">
            Cancelar
          </button>
          <button id="_pm_save"
            style="flex:2;padding:9px;border-radius:var(--r-md);
                   background:linear-gradient(135deg,#8b5cf6,#3b82f6);
                   border:none;color:#fff;font-size:0.82rem;
                   font-weight:700;cursor:pointer;">
            ${isEdit ? 'Guardar cambios' : 'Agregar producto'}
          </button>
        </div>

      </div>`;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    overlay.querySelector('#_pm_cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#_pm_save').addEventListener('click', () => {
        const name      = (overlay.querySelector('#_pm_name').value || '').trim();
        const unit      = (overlay.querySelector('#_pm_unit').value || 'Botella').trim();
        const group     = (overlay.querySelector('#_pm_group').value || 'General').trim();
        const capacidad = parseFloat(overlay.querySelector('#_pm_capacidad').value) || null;
        const peso      = parseFloat(overlay.querySelector('#_pm_peso').value) || null;

        if (!name) {
            showNotification('⚠️ El nombre del producto es obligatorio');
            return;
        }

        if (isEdit) {
            updateProduct(productId, {
                name, unit, group,
                capacidadMl:        capacidad,
                pesoBotellaLlenaOz: peso,
            });
        } else {
            addProduct({ name, unit, group,
                capacidadMl:        capacidad,
                pesoBotellaLlenaOz: peso,
            });
        }

        close();
        _render();

        if (state.syncEnabled && window._db) {
            import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
        }
    });

    // Foco automático en nombre
    setTimeout(() => overlay.querySelector('#_pm_name')?.focus(), 50);
}

// ── editProduct: alias que abre el modal en modo edición ───────
function editProduct(id) {
    openProductModal(id);
}

// ── deleteProduct: llama al service y re-renderiza ─────────────
async function deleteProduct(id) {
    const product = state.products.find(p => p.id === id);
    if (!product) { showNotification('⚠️ Producto no encontrado'); return; }

    const ok = await showConfirm(
        `¿Eliminar "${product.name}"?`,
        'Esta acción no se puede deshacer.'
    );
    if (!ok) return;

    _deleteProduct(id);
    _render();

    if (state.syncEnabled && window._db) {
        import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
    }
}

// ── deleteAllProducts ──────────────────────────────────────────
async function deleteAllProducts() {
    if (state.userRole !== 'admin') return;
    const ok = await showConfirm(
        '¿Eliminar TODOS los productos?',
        'Esta acción borrará el catálogo completo y no se puede deshacer.'
    );
    if (!ok) return;

    state.products                  = [];
    state.inventarioConteo          = {};
    state.auditoriaConteo           = {};
    state.auditoriaConteoPorUsuario = {};
    saveToLocalStorage();
    showNotification('🗑️ Todos los productos eliminados');
    _render();

    if (state.syncEnabled && window._db) {
        import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
    }
}

// ═════════════════════════════════════════════════════════════
//  CARRITO
// ═════════════════════════════════════════════════════════════

function addToCart(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) { showNotification('⚠️ Producto no encontrado'); return; }

    const existing = state.cart.find(i => i.id === productId);
    if (existing) {
        existing.quantity += 1;
        showNotification(`🛒 ${product.name} → ${existing.quantity}`);
    } else {
        state.cart.push({
            id:       product.id,
            name:     product.name,
            unit:     product.unit || 'Unidad',
            quantity: 1,
        });
        showNotification(`🛒 ${product.name} agregado al carrito`);
    }

    saveToLocalStorage();
    _render();
}

// ═════════════════════════════════════════════════════════════
//  PEDIDOS
// ═════════════════════════════════════════════════════════════

function shareOrderWhatsApp(orderId) {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) { showNotification('⚠️ Pedido no encontrado'); return; }

    const lines = [
        `📦 *Pedido ${order.id}*`,
        `Proveedor: ${order.supplier || '—'}`,
        `Fecha: ${order.date || '—'}`,
        '',
        '*Productos:*',
        ...(order.products || []).map(p =>
            `• ${p.name} (${p.unit || 'Unid'}): *${p.quantity}*`
        ),
        '',
        order.note ? `📝 ${order.note}` : '',
    ].filter(l => l !== undefined).join('\n');

    const url = `https://wa.me/?text=${encodeURIComponent(lines)}`;
    window.open(url, '_blank');
}

async function deleteOrder(orderId) {
    const ok = await showConfirm('¿Eliminar este pedido?', 'No se puede deshacer.');
    if (!ok) return;

    state.orders = state.orders.filter(o => o.id !== orderId);
    saveToLocalStorage();
    showNotification('🗑️ Pedido eliminado');
    _render();
}

// ═════════════════════════════════════════════════════════════
//  INVENTARIO (Historia)
// ═════════════════════════════════════════════════════════════

function switchArea(area) {
    state.selectedArea = area;
    _render();
}

function saveInventory(area) {
    if (!area) area = state.selectedArea;

    const productosConStock = state.products.filter(p =>
        p.stockByArea && (p.stockByArea[area] || 0) > 0
    );

    if (productosConStock.length === 0) {
        showNotification('⚠️ No hay conteo en esta área para guardar');
        return;
    }

    const snapshot = {
        id:            'INV-' + Date.now(),
        date:          new Date().toLocaleDateString('es-MX'),
        area,
        usuario:       state.currentUser?.email || state.auditCurrentUser?.userName || 'Sistema',
        totalProducts: state.products.reduce((s, p) => {
            return s + (p.stockByArea?.[area] || 0);
        }, 0),
        products: state.products
            .filter(p => p.stockByArea?.[area] > 0)
            .map(p => ({
                id:    p.id,
                name:  p.name,
                unit:  p.unit,
                group: p.group,
                stock: p.stockByArea?.[area] || 0,
            })),
    };

    state.inventories.unshift(snapshot);      // más reciente primero
    if (state.inventories.length > 50) state.inventories.pop(); // límite de 50

    saveToLocalStorage();
    showNotification(`💾 Inventario de ${AREAS[area] || area} guardado`);
    _render();

    if (state.syncEnabled && window._db) {
        import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
    }
}

function shareInventoryWhatsApp(inventoryId) {
    const inv = state.inventories.find(i => i.id === inventoryId);
    if (!inv) { showNotification('⚠️ Inventario no encontrado'); return; }

    const areaLabel = AREAS[inv.area] || inv.area || '—';
    const lines = [
        `📊 *Inventario ${inv.id}*`,
        `Área: ${areaLabel}`,
        `Fecha: ${inv.date || '—'}`,
        `Usuario: ${inv.usuario || '—'}`,
        '',
        '*Productos:*',
        ...(inv.products || []).map(p =>
            `• ${p.name}: *${(p.stock || 0).toFixed(2)}* ${p.unit || ''}`
        ),
        '',
        `Total unidades: *${(inv.totalProducts || 0).toFixed(2)}*`,
    ].join('\n');

    const url = `https://wa.me/?text=${encodeURIComponent(lines)}`;
    window.open(url, '_blank');
}

async function deleteInventory(inventoryId) {
    if (state.userRole !== 'admin') return;
    const ok = await showConfirm('¿Eliminar este registro de inventario?', 'No se puede deshacer.');
    if (!ok) return;

    state.inventories = state.inventories.filter(i => i.id !== inventoryId);
    saveToLocalStorage();
    showNotification('🗑️ Registro eliminado');
    _render();
}

async function resetAllInventario() {
    if (state.userRole !== 'admin') return;
    const ok = await showConfirm(
        '¿Resetear TODO el inventario?',
        'Se pondrán en cero todos los conteos. No se puede deshacer.'
    );
    if (!ok) return;

    state.inventarioConteo = {};
    state.products.forEach(p => {
        p.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
    });
    saveToLocalStorage();
    showNotification('🔄 Inventario reseteado a cero');
    _render();

    if (state.syncEnabled && window._db) {
        import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
    }
}

// ── openInventarioModal — modal para contar producto en área ───
function openInventarioModal(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) { showNotification('⚠️ Producto no encontrado'); return; }

    const area    = state.selectedArea || 'almacen';
    const current = product.stockByArea?.[area] || 0;

    const overlay = document.createElement('div');
    overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;' +
        'display:flex;align-items:center;justify-content:center;';

    overlay.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border-mid);
                  border-radius:var(--r-lg);padding:24px;max-width:320px;width:90%;
                  box-shadow:var(--shadow-modal);">
        <p style="font-weight:700;font-size:0.9rem;color:var(--txt-primary);margin:0 0 4px;">
          📦 ${escapeHtml(product.name)}
        </p>
        <p style="font-size:0.72rem;color:var(--txt-muted);margin:0 0 16px;">
          Área: ${AREAS[area] || area}
        </p>
        <label style="display:block;font-size:0.7rem;font-weight:700;
                      text-transform:uppercase;color:var(--txt-secondary);margin-bottom:5px;">
          Cantidad
        </label>
        <input id="_inv_qty" type="number" min="0" step="0.5" value="${current}"
          style="width:100%;box-sizing:border-box;padding:10px;font-size:1.1rem;
                 background:var(--surface);border:1px solid var(--border-mid);
                 border-radius:var(--r-md);color:var(--txt-primary);text-align:center;">
        <div style="display:flex;gap:10px;margin-top:16px;">
          <button id="_inv_cancel"
            style="flex:1;padding:9px;border-radius:var(--r-md);
                   background:var(--surface);border:1px solid var(--border-mid);
                   color:var(--txt-secondary);cursor:pointer;">
            Cancelar
          </button>
          <button id="_inv_save"
            style="flex:2;padding:9px;border-radius:var(--r-md);
                   background:linear-gradient(135deg,#8b5cf6,#3b82f6);
                   border:none;color:#fff;font-weight:700;cursor:pointer;">
            Guardar
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    const close = () => overlay.remove();

    overlay.querySelector('#_inv_cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#_inv_save').addEventListener('click', () => {
        const qty = parseFloat(overlay.querySelector('#_inv_qty').value);
        if (isNaN(qty) || qty < 0) { showNotification('⚠️ Valor inválido'); return; }

        if (!product.stockByArea) product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
        product.stockByArea[area] = qty;

        if (!state.inventarioConteo[productId]) state.inventarioConteo[productId] = {};
        state.inventarioConteo[productId][area] = qty;

        saveToLocalStorage();
        showNotification(`✅ ${product.name}: ${qty} en ${AREAS[area] || area}`);
        close();
        _render();

        if (state.syncEnabled && window._db) {
            import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
        }
    });

    setTimeout(() => {
        const input = overlay.querySelector('#_inv_qty');
        input?.focus();
        input?.select();
    }, 50);
}

// ═════════════════════════════════════════════════════════════
//  EXPORTAR EXCEL
// ═════════════════════════════════════════════════════════════

function exportToExcel(modo = 'INVENTARIO') {
    if (typeof window.XLSX === 'undefined') {
        showNotification('❌ Librería XLSX no disponible — recarga la página');
        return;
    }

    let rows = [];
    let sheetName = 'Inventario';
    let fileName  = `inventario_${new Date().toISOString().slice(0,10)}.xlsx`;

    if (modo === 'INVENTARIO') {
        sheetName = 'Inventario';
        rows = [
            ['ID', 'Producto', 'Unidad', 'Grupo', 'Almacén', 'Barra 1', 'Barra 2', 'Total'],
            ...state.products.map(p => {
                const { porArea, total } = calcularStockTotal(p.id);
                return [
                    p.id,
                    p.name,
                    p.unit  || '',
                    p.group || 'General',
                    (porArea.almacen || 0).toFixed(4),
                    (porArea.barra1  || 0).toFixed(4),
                    (porArea.barra2  || 0).toFixed(4),
                    total.toFixed(4),
                ];
            }),
        ];
    } else {
        showNotification(`⚠️ Modo de exportación "${modo}" desconocido`);
        return;
    }

    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
    window.XLSX.writeFile(wb, fileName);
    showNotification(`📊 Excel exportado: ${fileName}`);
}

function exportarAuditoriaExcel() {
    if (typeof window.XLSX === 'undefined') {
        showNotification('❌ Librería XLSX no disponible — recarga la página');
        return;
    }

    const rows = [
        ['ID', 'Producto', 'Unidad', 'Grupo',
         'Almacén Enteras', 'Almacén Abiertas',
         'Barra1 Enteras',  'Barra1 Abiertas',
         'Barra2 Enteras',  'Barra2 Abiertas',
         'Total General'],
    ];

    state.products.forEach(p => {
        const row = [p.id, p.name, p.unit || '', p.group || 'General'];
        let total = 0;
        ['almacen', 'barra1', 'barra2'].forEach(area => {
            const c = state.auditoriaConteo[p.id]?.[area];
            const enteras  = c?.enteras  || 0;
            const abiertas = Array.isArray(c?.abiertas) ? c.abiertas.length : 0;
            row.push(enteras, abiertas);
            total += enteras + abiertas * 0.5;
        });
        row.push(total.toFixed(4));
        rows.push(row);
    });

    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Auditoría');
    const fileName = `auditoria_${new Date().toISOString().slice(0,10)}.xlsx`;
    window.XLSX.writeFile(wb, fileName);
    showNotification(`📊 Auditoría exportada: ${fileName}`);
}

// ═════════════════════════════════════════════════════════════
//  BINDINGS GLOBALES — exponer TODO en window
// ═════════════════════════════════════════════════════════════

window.openProductModal       = openProductModal;
window.editProduct            = editProduct;
window.deleteProduct          = deleteProduct;
window.deleteAllProducts      = deleteAllProducts;
window.addToCart              = addToCart;
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

console.info('[Actions] ✓ 15 funciones expuestas en window.');

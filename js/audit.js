/**
 * js/audit.js — v2.1
 * ══════════════════════════════════════════════════════════════
 * Auditoría Física Ciega — Conteo Multiusuario con Bloqueo por Usuario
 *
 * NUEVO v2.0:
 * ──────────────────────────────────────────────────────────────
 * ① Mecanismo de bloqueo por usuario (conteoFinalizadoPorUsuario):
 *    - auditoriaEntrarArea()     verifica si el usuario ya finalizó.
 *    - auditoriaFinalizarConteo() copia conteo a auditoriaConteoPorUsuario
 *      y marca al usuario como finalizado en esa área.
 *    - reabrirConteoUsuario()    admin desbloquea un usuario específico.
 *
 * ② renderAuditUserPanel (admin):
 *    Muestra estado por usuario (✓ Finalizado / ⏳ En curso) con
 *    botón 🔓 Reabrir por área. Antes mostraba solo la identidad del
 *    dispositivo local.
 *
 * ③ renderAuditComparePanel:
 *    Muestra resumen de discrepancias por área + botón "Publicar
 *    reporte final" (solo admin, solo cuando todas las áreas están
 *    completadas por al menos un usuario).
 *
 * ④ auditoriaResetear():
 *    Envía notificación broadcast a todos los usuarios para
 *    informarles que el admin inició un nuevo ciclo.
 *
 * ⑤ renderAuditUserPanel (usuario):
 *    Muestra su propio estado (bloqueado / libre) y su nombre.
 *    Sin cambios en la funcionalidad de renombrar.
 *
 * FLUJO COMPLETO:
 *   Admin → auditoriaResetear()     → ciclo nuevo, notifica a todos
 *   User  → auditoriaEntrarArea()   → verifica lock
 *   User  → [cuenta productos]
 *   User  → auditoriaFinalizarConteo() → bloquea su conteo
 *   Admin → reabrirConteoUsuario()  → desbloquea a usuario específico
 *   Admin → openPublicarReporteModal() → publica reporte final
 * ══════════════════════════════════════════════════════════════
 */

import { state }                    from './state.js';
import { AREAS_AUDITORIA,
         AREAS_AUDITORIA_FA,
         AREA_KEYS,
         AUDIT_TOLERANCE }          from './constants.js';
import { showNotification, showConfirm, escapeHtml } from './ui.js';
import { saveToLocalStorage }       from './storage.js';
import {
    txCloseZone,
    syncConteoAtomicoPorArea,
    syncConteoPorUsuarioToFirestore,
    resetConteoAtomicoEnFirestore,
    updateCloudSyncBadge,
}                                   from './sync.js';

// ═════════════════════════════════════════════════════════════
//  IDENTIDAD DEL DISPOSITIVO
// ═════════════════════════════════════════════════════════════

export function initAuditUser() {
    try {
        const raw = localStorage.getItem('inventarioApp_auditUser');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.userId) {
                state.auditCurrentUser = parsed;
                console.info('[MultiUser] Identidad recuperada:', parsed.userName,
                    '(' + parsed.userId.slice(0, 16) + '…)');
                return;
            }
        }
    } catch (_) {}

    const uid   = 'usr-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 6);
    const uName = 'Contador-' + Math.random().toString(36).substr(2, 4).toUpperCase();
    state.auditCurrentUser = { userId: uid, userName: uName, createdAt: Date.now() };
    try { localStorage.setItem('inventarioApp_auditUser', JSON.stringify(state.auditCurrentUser)); }
    catch (_) {}
    console.info('[MultiUser] Nueva identidad creada:', uName, '(' + uid.slice(0, 16) + '…)');
}

export function setAuditUserName(newName) {
    if (!newName || !newName.trim()) { showNotification('⚠️ El nombre no puede estar vacío'); return; }
    if (!state.auditCurrentUser) initAuditUser();
    state.auditCurrentUser.userName = newName.trim().slice(0, 32);
    try { localStorage.setItem('inventarioApp_auditUser', JSON.stringify(state.auditCurrentUser)); } catch (_) {}
    const panel = document.getElementById('auditRenameInline');
    if (panel) panel.classList.remove('visible');
    showNotification('✅ Nombre actualizado: ' + state.auditCurrentUser.userName);
    import('./render.js').then(m => m.renderTab());
}

export function toggleAuditRename() {
    const panel = document.getElementById('auditRenameInline');
    if (!panel) return;
    const opening = !panel.classList.contains('visible');
    panel.classList.toggle('visible', opening);
    if (opening) {
        const inp = document.getElementById('auditRenameInput');
        if (inp) {
            inp.value = state.auditCurrentUser ? state.auditCurrentUser.userName : '';
            setTimeout(() => inp.focus(), 60);
        }
    }
}

export function auditSaveName() {
    const inp = document.getElementById('auditRenameInput');
    if (inp) setAuditUserName(inp.value);
}

// ─── Helper: obtener userId y userName del usuario actual ─────

function _getCurrentUserId() {
    return state.currentUser?.uid
        || state.auditCurrentUser?.userId
        || 'anon';
}

function _getCurrentUserName() {
    return state.currentUser?.displayName
        || state.currentUser?.email?.split('@')[0]
        || state.auditCurrentUser?.userName
        || 'Bartender';
}

// ═════════════════════════════════════════════════════════════
//  ESTADÍSTICAS DE MULTI-CONTEO
// ═════════════════════════════════════════════════════════════

export function calcAuditStats(productId, area) {
    const byArea  = state.auditoriaConteoPorUsuario[productId]?.[area];
    const entries = byArea ? Object.values(byArea) : [];
    if (entries.length === 0) return null;

    const totals = entries.map(u => {
        const enteras     = typeof u.enteras === 'number' ? u.enteras : 0;
        const sumAbiertas = Array.isArray(u.abiertas)
            ? u.abiertas.reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0)
            : 0;
        return {
            userId:        u.userId,
            userName:      u.userName || u.userId,
            ts:            u.ts || 0,
            enteras,
            totalAbiertas: Math.round(sumAbiertas * 1000) / 1000,
            total:         Math.round((enteras + sumAbiertas) * 10000) / 10000,
        };
    });

    totals.sort((a, b) => a.ts - b.ts);
    const vals = totals.map(t => t.total);
    const sum  = Math.round(vals.reduce((a, b) => a + b, 0) * 10000) / 10000;
    const avg  = Math.round((sum / vals.length) * 10000) / 10000;
    const min  = Math.min(...vals);
    const max  = Math.max(...vals);
    const diff = Math.round((max - min) * 10000) / 10000;

    return {
        totals,
        sum, avg, min, max, diff,
        hasConflict: vals.length >= 2 && diff > AUDIT_TOLERANCE,
        count:       vals.length,
    };
}

function formatAuditTs(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return ''; }
}

// ═════════════════════════════════════════════════════════════
//  RENDER: TRAIL DE TRAZABILIDAD (por producto)
// ═════════════════════════════════════════════════════════════

export function renderAuditTrailForProduct(productId, area) {
    const stats = calcAuditStats(productId, area);
    if (!stats || stats.count === 0) return '';
    const myId  = _getCurrentUserId();

    let html = '<div class="audit-trail">';
    html += '<div class="audit-trail-header">';
    html += `<span>${stats.count} conteo${stats.count !== 1 ? 's' : ''} registrado${stats.count !== 1 ? 's' : ''}</span>`;

    if (stats.count >= 2) {
        const badgeCls = stats.hasConflict ? 'error' : 'ok';
        const badgeLbl = stats.hasConflict
            ? `⚠️ DIFERENCIA (${stats.diff.toFixed(2)})`
            : '✓ OK';
        html += `<span class="audit-status-badge ${badgeCls}">${badgeLbl}</span>`;
    }
    html += '</div>';

    stats.totals.forEach(entry => {
        const isMe  = myId && entry.userId === myId;
        const meTxt = isMe ? ' <em style="opacity:.5;font-size:.58rem;font-style:normal">(tú)</em>' : '';
        html += `<div class="audit-trail-entry${isMe ? ' is-me' : ''}">`;
        html += `<span class="audit-entry-name">${escapeHtml(entry.userName)}${meTxt}</span>`;
        html += `<span class="audit-entry-count">${entry.enteras} ent + ${entry.totalAbiertas.toFixed(2)} ab = <strong>${entry.total.toFixed(2)}</strong></span>`;
        html += `<span class="audit-entry-ts">${formatAuditTs(entry.ts)}</span>`;
        html += '</div>';
    });

    if (stats.count >= 2) {
        const diffColor = stats.hasConflict ? 'var(--red-text)' : 'var(--green-text)';
        html += '<div class="audit-stats-row">';
        html += `<span>Σ ${stats.sum.toFixed(2)}</span>`;
        html += `<span>μ ${stats.avg.toFixed(2)}</span>`;
        html += `<span>min ${stats.min.toFixed(2)}</span>`;
        html += `<span>max ${stats.max.toFixed(2)}</span>`;
        html += `<span style="color:${diffColor}">Δ ${stats.diff.toFixed(2)}</span>`;
        html += '</div>';
    }

    html += '</div>';
    return html;
}

// ═════════════════════════════════════════════════════════════
//  RENDER: PANEL DE IDENTIDAD / ESTADO DE USUARIOS
// ═════════════════════════════════════════════════════════════

/**
 * Renderiza el panel de usuarios.
 * - Admin: tabla de todos los usuarios con estado por área y botón Reabrir.
 * - Usuario: muestra su nombre, estado de bloqueo y opción de renombrar.
 */
export function renderAuditUserPanel() {
    const isAdmin = state.userRole === 'admin';

    if (isAdmin) {
        return _renderAdminUserPanel();
    } else {
        return _renderUserSelfPanel();
    }
}

function _renderUserSelfPanel() {
    const user     = state.auditCurrentUser || { userName: '—', userId: '?' };
    const initials = user.userName.slice(0, 2).toUpperCase();
    let html = '';

    html += '<div id="auditRenameInline" class="audit-rename-inline">';
    html += '<p style="font-size:0.68rem;color:var(--txt-muted);margin-bottom:0;">Nuevo nombre (máx. 32 caracteres)</p>';
    html += '<div class="audit-rename-row">';
    html += '<input id="auditRenameInput" class="audit-rename-input" type="text" maxlength="32" placeholder="Tu nombre…" onkeydown="if(event.key===\'Enter\'){event.preventDefault();window.auditSaveName();}">';
    html += '<button onclick="window.auditSaveName()" style="padding:6px 12px;background:var(--accent);color:#fff;border-radius:var(--r-sm);font-size:.75rem;font-weight:600;cursor:pointer;min-height:auto;">Guardar</button>';
    html += '<button onclick="window.toggleAuditRename()" style="padding:6px 10px;background:var(--surface);border:1px solid var(--border-mid);border-radius:var(--r-sm);color:var(--txt-secondary);font-size:.75rem;cursor:pointer;min-height:auto;">Cancelar</button>';
    html += '</div></div>';

    // Mostrar estado de bloqueo por área
    const userId = _getCurrentUserId();
    const lockStatus = state.conteoFinalizadoPorUsuario || {};

    html += '<div class="audit-user-panel">';
    html += `<div class="audit-user-avatar">${escapeHtml(initials)}</div>`;
    html += '<div class="audit-user-info" style="flex:1;">';
    html += '<div class="audit-user-label">Dispositivo actual</div>';
    html += `<div class="audit-user-name-text">${escapeHtml(user.userName)}</div>`;
    html += `<div class="audit-user-id-text">${escapeHtml(user.userId.slice(0, 22))}…</div>`;

    // Estado por área para este usuario
    html += '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:5px;">';
    AREA_KEYS.forEach(area => {
        const st = lockStatus[area]?.[userId];
        const finalizado = st?.finalizado;
        const label = AREAS_AUDITORIA[area];
        if (finalizado) {
            html += `<span style="font-size:0.60rem;font-weight:700;padding:2px 7px;border-radius:100px;background:var(--green-dim);color:var(--green-text);border:1px solid rgba(34,197,94,.20);">✓ ${label}</span>`;
        }
    });
    html += '</div>';

    html += '</div>';
    html += '<button class="audit-rename-btn" onclick="window.toggleAuditRename()"><i class="fa-solid fa-pen" style="font-size:.65rem;margin-right:4px;"></i>Renombrar</button>';
    html += '</div>';

    return html;
}

function _renderAdminUserPanel() {
    const finalizados = state.conteoFinalizadoPorUsuario || { almacen: {}, barra1: {}, barra2: {} };

    // Recopilar todos los usuarios que han participado
    const allUsers = new Map();
    AREA_KEYS.forEach(area => {
        // De conteoFinalizadoPorUsuario
        Object.entries(finalizados[area] || {}).forEach(([uid, data]) => {
            if (!allUsers.has(uid)) allUsers.set(uid, data.userName || uid.slice(0, 12));
        });
        // De auditoriaConteoPorUsuario
        state.products.forEach(p => {
            const porArea = state.auditoriaConteoPorUsuario[p.id]?.[area] || {};
            Object.entries(porArea).forEach(([uid, conteo]) => {
                if (!allUsers.has(uid)) allUsers.set(uid, conteo.userName || uid.slice(0, 12));
            });
        });
    });

    if (allUsers.size === 0) {
        return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px;margin-bottom:12px;">
            <p style="font-size:0.72rem;color:var(--txt-muted);">Esperando que los bartenders inicien su conteo…</p>
        </div>`;
    }

    let html = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px;margin-bottom:12px;">
        <div style="font-size:0.68rem;font-weight:700;color:var(--txt-secondary);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px;">
            👥 Estado de bartenders
        </div>`;

    allUsers.forEach((userName, uid) => {
        html += `<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border);">`;
        html += `<div style="font-size:0.78rem;font-weight:600;color:var(--txt-primary);margin-bottom:6px;">
            <span style="display:inline-block;width:26px;height:26px;border-radius:50%;background:var(--accent-dim);color:var(--accent);font-size:0.7rem;font-weight:700;text-align:center;line-height:26px;margin-right:6px;">${escapeHtml(userName.slice(0,2).toUpperCase())}</span>
            ${escapeHtml(userName)}
        </div>`;
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';

        AREA_KEYS.forEach(area => {
            const status     = finalizados[area]?.[uid];
            const finalizado = status?.finalizado;
            const areaLabel  = AREAS_AUDITORIA[area];
            const hasConteo  = state.products.some(p =>
                state.auditoriaConteoPorUsuario[p.id]?.[area]?.[uid] !== undefined
            );

            if (finalizado) {
                const ts = status.ts
                    ? new Date(status.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '';
                html += `<div style="display:flex;align-items:center;gap:4px;padding:4px 8px;
                            background:var(--green-dim);border:1px solid rgba(34,197,94,.20);
                            border-radius:100px;font-size:0.65rem;color:var(--green-text);">
                    <i class="${AREAS_AUDITORIA_FA[area]}" style="font-size:0.6rem;"></i>
                    ${areaLabel} ✓${ts ? ' ' + ts : ''}
                    <button data-uid="${escapeHtml(uid)}" data-area="${area}"
                        onclick="window.reabrirConteoUsuario(this.dataset.uid, this.dataset.area)"
                        style="background:none;border:none;cursor:pointer;color:var(--amber);
                               font-size:0.65rem;padding:0 2px;min-height:auto;"
                        title="Reabrir conteo de ${areaLabel} para ${escapeHtml(userName)}">
                        🔓
                    </button>
                </div>`;
            } else if (hasConteo) {
                html += `<span style="padding:4px 8px;background:var(--amber-dim);border:1px solid rgba(251,191,36,.20);
                            border-radius:100px;font-size:0.65rem;color:var(--amber);">
                    <i class="${AREAS_AUDITORIA_FA[area]}" style="font-size:0.6rem;"></i>
                    ${areaLabel} ⏳
                </span>`;
            } else {
                html += `<span style="padding:4px 8px;background:var(--surface);border:1px solid var(--border);
                            border-radius:100px;font-size:0.65rem;color:var(--txt-muted);">
                    ${areaLabel}
                </span>`;
            }
        });

        html += '</div></div>';
    });

    html += '</div>';
    return html;
}

// ═════════════════════════════════════════════════════════════
//  RENDER: PANEL DE COMPARACIÓN + PUBLICAR REPORTE
// ═════════════════════════════════════════════════════════════

export function renderAuditComparePanel() {
    const isAdmin = state.userRole === 'admin';

    const hasAny = state.products.some(p =>
        AREA_KEYS.some(area =>
            Object.keys(state.auditoriaConteoPorUsuario[p.id]?.[area] || {}).length > 1
        )
    );

    let conflictos = 0;
    if (hasAny) {
        state.products.forEach(p => {
            AREA_KEYS.forEach(area => {
                const stats = calcAuditStats(p.id, area);
                if (stats?.count >= 2 && stats.hasConflict) conflictos++;
            });
        });
    }

    let html = '';

    if (hasAny) {
        html += '<div class="bg-white rounded-xl p-4 mb-4 shadow-md" style="border:1px solid var(--border-mid);">';
        html += '<p style="font-size:0.72rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--accent);margin-bottom:10px;">📊 Comparación multiusuario</p>';
        html += conflictos > 0
            ? `<p style="color:var(--red-text);font-size:0.75rem;font-weight:600;">⚠️ ${conflictos} diferencia${conflictos !== 1 ? 's' : ''} detectada${conflictos !== 1 ? 's' : ''}</p>`
            : '<p style="color:var(--green-text);font-size:0.75rem;font-weight:600;">✓ Sin conflictos detectados</p>';
        html += '</div>';
    }

    // Botón publicar reporte (admin + todas las áreas completadas)
    if (isAdmin && auditoriaTodasCompletas()) {
        html += `<button onclick="window.openPublicarReporteModal()"
            style="width:100%;padding:12px;margin-bottom:12px;
                   background:linear-gradient(135deg,#065f46,#047857);
                   border:1px solid rgba(34,197,94,.28);border-radius:var(--r-md);
                   color:#86efac;font-size:0.85rem;font-weight:700;cursor:pointer;
                   display:flex;align-items:center;justify-content:center;gap:8px;">
            📊 Publicar reporte final y notificar usuarios
        </button>`;
    }

    return html;
}

// ═════════════════════════════════════════════════════════════
//  FLUJO DE AUDITORÍA
// ═════════════════════════════════════════════════════════════

/**
 * Entra al modo de conteo de un área.
 * Si el usuario ya finalizó esa área (y no es admin), muestra mensaje de bloqueo.
 */
export function auditoriaEntrarArea(area) {
    const userId  = _getCurrentUserId();
    const isAdmin = state.userRole === 'admin';

    // Verificar lock (no aplica a admin)
    if (!isAdmin) {
        const lock = state.conteoFinalizadoPorUsuario?.[area]?.[userId];
        if (lock?.finalizado) {
            showNotification('🔒 Ya finalizaste el conteo de esta área. Espera que el admin lo reabra si necesitas corregir algo.');
            return;
        }
    }

    state.auditoriaAreaActiva = area;
    state.auditoriaView       = 'counting';
    state.isAuditoriaMode     = true;
    state.selectedArea        = area;
    saveToLocalStorage();
    import('./render.js').then(m => m.renderTab());
}

/**
 * Finaliza el conteo del usuario en el área activa.
 *
 * FLUJO:
 *  1. Copia auditoriaConteo → auditoriaConteoPorUsuario (slot del usuario)
 *  2. Marca al usuario como finalizado en conteoFinalizadoPorUsuario
 *  3. Marca auditoriaStatus[area] = 'completada'
 *  4. Sincroniza a Firestore (txCloseZone + syncConteoPorUsuarioToFirestore)
 *  5. Envía notificación al admin
 */
export async function auditoriaFinalizarConteo() {
    if (!state.auditoriaAreaActiva) return;
    const area       = state.auditoriaAreaActiva;
    const nombreArea = AREAS_AUDITORIA[area];
    const userId     = _getCurrentUserId();
    const userName   = _getCurrentUserName();

    // FIX R-07: migrar de callback a patrón await con try/catch explícito.
    // Antes: showConfirm(msg, async () => { ... }) — errores dentro del callback
    // eran silenciosos porque showConfirm no propagaba errores de callbacks.
    // Ahora: cualquier fallo de sincronización muestra un warning al usuario.
    const confirmed = await showConfirm(
        `¿Finalizar tu conteo de ${nombreArea}?\n\nUna vez finalizado, ya no podrás modificarlo (a menos que el admin lo reabra).`
    );
    if (!confirmed) return;

    try {
            // ── 1. Copiar conteo local al slot de este usuario ─────────
            if (!state.auditoriaConteoPorUsuario) state.auditoriaConteoPorUsuario = {};

            state.products.forEach(p => {
                const conteo = state.auditoriaConteo[p.id]?.[area] || { enteras: 0, abiertas: [] };

                if (!state.auditoriaConteoPorUsuario[p.id])         state.auditoriaConteoPorUsuario[p.id] = {};
                if (!state.auditoriaConteoPorUsuario[p.id][area])   state.auditoriaConteoPorUsuario[p.id][area] = {};

                state.auditoriaConteoPorUsuario[p.id][area][userId] = {
                    enteras:  conteo.enteras || 0,
                    abiertas: Array.isArray(conteo.abiertas) ? [...conteo.abiertas] : [],
                    userId,
                    userName,
                    ts: Date.now(),
                };
            });

            // ── 2. Marcar usuario como finalizado ──────────────────────
            if (!state.conteoFinalizadoPorUsuario)          state.conteoFinalizadoPorUsuario = { almacen: {}, barra1: {}, barra2: {} };
            if (!state.conteoFinalizadoPorUsuario[area])    state.conteoFinalizadoPorUsuario[area] = {};

            state.conteoFinalizadoPorUsuario[area][userId] = {
                finalizado: true,
                userName,
                ts: Date.now(),
            };

            // ── 3. Marcar área como completada ─────────────────────────
            state.auditoriaStatus[area] = 'completada';

            // ── 4. Actualización de UI ──────────────────────────────────
            state.auditoriaView       = 'selection';
            state.auditoriaAreaActiva = null;
            state.isAuditoriaMode     = false;
            saveToLocalStorage();

            showNotification(`✅ Conteo de ${nombreArea} finalizado`);

            const { renderTab } = await import('./render.js');
            renderTab();

            // ── 5. Sincronizar a Firestore ──────────────────────────────
            if (!window._db || !navigator.onLine) {
                console.info(`[Audit] Sin Firebase — cierre de "${area}" guardado localmente.`);
                return;
            }

            // Notificar al admin
            import('./notificaciones.js').then(m => m.enviarNotificacion({
                tipo:        'conteo',
                mensaje:     `${userName} finalizó el conteo de ${nombreArea}`,
                usuarioId:   userId,
                usuarioName: userName,
                datos:       { area, status: 'completada' },
            })).catch(() => {});

            // Sincronizar lock status a Firestore junto con conteoPorUsuario
            await Promise.allSettled([
                txCloseZone(area).then(result => {
                    if (result?.mergedStatus) {
                        state.auditoriaStatus = result.mergedStatus;
                        saveToLocalStorage();
                    }
                }),
                syncConteoAtomicoPorArea(area).catch(err => {
                    console.warn('[Audit] syncConteoAtomicoPorArea falló:', err?.message);
                }),
                syncConteoPorUsuarioToFirestore(area).catch(err => {
                    console.warn('[Audit] syncConteoPorUsuarioToFirestore falló:', err?.message);
                }),
                // Sincronizar conteoFinalizadoPorUsuario directamente
                _syncLockStatusToFirestore(area),
            ]);
    } catch (err) {
        console.error('[Audit] Error al finalizar conteo:', err);
        showNotification(`⚠️ Conteo de ${nombreArea} guardado localmente — error al sincronizar`);
    }
}

/**
 * Sincroniza conteoFinalizadoPorUsuario[area] a Firestore.
 * Usa un campo especial '_finalizados' dentro del doc de conteoPorUsuario.
 */
async function _syncLockStatusToFirestore(area) {
    if (!window._db || !window.FIRESTORE_DOC_ID) return;
    try {
        const docRef = window._db
            .collection('inventarioApp')
            .doc(window.FIRESTORE_DOC_ID)
            .collection('conteoPorUsuario')
            .doc(area);
        await docRef.set(
            { _finalizados: state.conteoFinalizadoPorUsuario[area] || {} },
            { merge: true }
        );
    } catch (e) {
        console.warn('[Audit] Error al sincronizar lock status:', e?.message);
    }
}

export function auditoriaVolverSeleccion() {
    state.auditoriaView       = 'selection';
    state.auditoriaAreaActiva = null;
    state.isAuditoriaMode     = false;
    saveToLocalStorage();
    import('./render.js').then(m => m.renderTab());
}

export function auditoriaTotalAreasCompletadas() {
    return Object.values(state.auditoriaStatus).filter(s => s === 'completada').length;
}

export function auditoriaTodasCompletas() {
    return Object.values(state.auditoriaStatus).every(s => s === 'completada');
}

// ═════════════════════════════════════════════════════════════
//  REABRIR CONTEO (solo admin)
// ═════════════════════════════════════════════════════════════

/**
 * Admin desbloquea el conteo de un usuario específico en un área.
 * El usuario puede volver a contar y debe finalizar de nuevo.
 */
export async function reabrirConteoUsuario(userId, area) {
    if (state.userRole !== 'admin') {
        showNotification('⚠️ Solo el administrador puede reabrir conteos');
        return;
    }

    const areaLabel = AREAS_AUDITORIA[area] || area;
    const userName  = state.conteoFinalizadoPorUsuario?.[area]?.[userId]?.userName || userId.slice(0, 12);

    const ok = await showConfirm(
        `¿Reabrir el conteo de ${areaLabel} para "${userName}"?\n\nEl usuario deberá volver a finalizar su conteo para que sus datos queden validados.`
    );
    if (!ok) return;

    // Desbloquear al usuario
    if (!state.conteoFinalizadoPorUsuario)         state.conteoFinalizadoPorUsuario = { almacen: {}, barra1: {}, barra2: {} };
    if (!state.conteoFinalizadoPorUsuario[area])   state.conteoFinalizadoPorUsuario[area] = {};

    state.conteoFinalizadoPorUsuario[area][userId] = {
        ...(state.conteoFinalizadoPorUsuario[area][userId] || {}),
        finalizado: false,
    };

    // Si ningún usuario tiene finalizado=true en esa área, regresar a pendiente
    const anyStillFinalized = Object.values(state.conteoFinalizadoPorUsuario[area])
        .some(u => u.finalizado === true);
    if (!anyStillFinalized) {
        state.auditoriaStatus[area] = 'pendiente';
    }

    saveToLocalStorage();

    // Notificar al usuario
    if (window._db) {
        try {
            await import('./notificaciones.js').then(m => m.enviarNotificacion({
                tipo:        'sistema',
                mensaje:     `El administrador ha reabierto tu conteo de ${areaLabel}. Por favor vuelve a contar y presiona "Finalizar".`,
                usuarioId:   userId,
                usuarioName: 'Sistema',
                datos:       { area, accion: 'reabrir' },
            }));
        } catch (e) {}

        // Sincronizar el lock status a Firestore
        try {
            await _syncLockStatusToFirestore(area);
        } catch (e) {}
    }

    showNotification(`✅ Conteo de ${areaLabel} reabierto para ${userName}`);
    import('./render.js').then(m => m.renderTab());
}

// ═════════════════════════════════════════════════════════════
//  RESETEAR / NUEVO CICLO
// ═════════════════════════════════════════════════════════════

/**
 * Reinicia toda la auditoría (ciclo nuevo).
 * - Admin: borra TODO (conteos, locks, statuses) y notifica a usuarios.
 * - Usuario: solo resetea su conteo local no finalizado.
 */
/**
 * Reinicia toda la auditoría (ciclo nuevo).
 *
 * FIX BUG-2: Migrado de callback a patrón await (igual que auditoriaFinalizarConteo).
 * ANTES: showConfirm(msg, async () => {...}) — showConfirm NO awaiteaba el callback
 * async, por lo que cualquier error de Firestore era silencioso e imposible de capturar.
 * AHORA: const confirmed = await showConfirm(msg); — compatible con try/catch explícito.
 */
export async function auditoriaResetear() {
    const isAdmin = state.userRole === 'admin';

    if (!isAdmin && !navigator.onLine) {
        showNotification('⚠️ Necesitas conexión para esta operación');
        return;
    }

    const msg = isAdmin
        ? '⚠️ INICIAR NUEVO CICLO DE INVENTARIO\n\nEsto borrará TODOS los conteos actuales de TODOS los usuarios en las tres áreas.\n\nSe notificará a los bartenders automáticamente.\n\n¿Confirmar?'
        : '⚠️ ¿Resetear tu conteo actual?\n\nSe borrarán los conteos no finalizados de este dispositivo.';

    const confirmed = await showConfirm(msg);
    if (!confirmed) return;

    if (isAdmin) {
        // ── Reset completo ──────────────────────────────────────
        // FIX BUG-AUDIT-1 (CRÍTICO): NO se toca state.inventarioConteo aquí.
        // inventarioConteo es el conteo OPERATIVO diario (alimenta stockByArea,
        // usado por Inicio/Productos/Pedidos) — es un feature totalmente distinto
        // de la auditoría ciega (auditoriaConteo/auditoriaConteoPorUsuario).
        // ANTES: auditoriaResetear() ponía state.inventarioConteo = {} junto con
        // los campos de auditoría. Consecuencia: cada vez que el admin iniciaba
        // un nuevo ciclo de AUDITORÍA, se borraba también el inventario diario ya
        // capturado por todos los bartenders en todos los dispositivos — pérdida
        // de datos totalmente ajena a lo que el admin pidió confirmar en el diálogo.
        // Prueba de que era un descuido: resetConteoAtomicoEnFirestore() (la mitad
        // en la nube de este mismo reset) nunca tocó la colección stockAreas —
        // solo el reset LOCAL sobre-alcanzaba. CORRECCIÓN: se elimina la línea.
        state.auditoriaStatus           = { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' };
        state.auditoriaConteo           = {};
        state.auditoriaConteoPorUsuario = {};
        state.conteoFinalizadoPorUsuario = { almacen: {}, barra1: {}, barra2: {} };
        state.auditoriaView             = 'selection';
        state.auditoriaAreaActiva       = null;
        state.isAuditoriaMode           = false;
        saveToLocalStorage();

        showNotification('🔄 Nuevo ciclo iniciado');

        const { renderTab } = await import('./render.js');
        renderTab();

        // ── Sincronizar con Firestore ───────────────────────────
        if (window._db && navigator.onLine) {
            try {
                await resetConteoAtomicoEnFirestore();
                // Limpiar locks en Firestore
                const batch = window._db.batch();
                AREA_KEYS.forEach(area => {
                    const ref = window._db
                        .collection('inventarioApp')
                        .doc(window.FIRESTORE_DOC_ID)
                        .collection('conteoPorUsuario')
                        .doc(area);
                    batch.set(ref, { _finalizados: {} }, { merge: true });
                });
                await batch.commit();
                console.info('[Audit] ✓ Reset completo en Firestore.');
            } catch (err) {
                console.warn('[Audit] Reset en Firestore falló:', err?.message);
                showNotification('⚠️ Reset guardado localmente — error al sincronizar con la nube');
            }

            // Notificar a todos los usuarios (broadcast)
            try {
                await import('./notificaciones.js').then(m => m.enviarNotificacion({
                    tipo:        'sistema',
                    mensaje:     '🔄 El administrador ha iniciado un nuevo ciclo de inventario. Se han reseteado todos los conteos.',
                    usuarioId:   'broadcast',
                    usuarioName: 'Sistema',
                    datos:       { accion: 'nuevo_ciclo', ts: Date.now() },
                }));
            } catch (e) {
                console.warn('[Audit] Notificación broadcast falló:', e?.message);
            }
        }
    } else {
        // Usuario: solo limpia su conteo local no finalizado
        const userId = _getCurrentUserId();
        AREA_KEYS.forEach(area => {
            const lock = state.conteoFinalizadoPorUsuario?.[area]?.[userId];
            if (lock?.finalizado) return; // No tocar lo ya finalizado

            // Limpiar solo las entradas no finalizadas
            state.products.forEach(p => {
                if (state.auditoriaConteo[p.id]?.[area]) {
                    delete state.auditoriaConteo[p.id][area];
                }
            });
        });

        state.auditoriaView       = 'selection';
        state.auditoriaAreaActiva = null;
        state.isAuditoriaMode     = false;
        saveToLocalStorage();

        showNotification('🔄 Conteo local reseteado');
        const { renderTab } = await import('./render.js');
        renderTab();
    }
}

// ═════════════════════════════════════════════════════════════
//  CARGA DE LOCK STATUS DESDE FIRESTORE (en onSnapshot)
// ═════════════════════════════════════════════════════════════

/**
 * Procesa el campo _finalizados de un snapshot de conteoPorUsuario.
 * Llamado desde sync.js cuando llega un onSnapshot del área.
 *
 * @param {string} area
 * @param {object} docData  — data() del documento de Firestore
 */
export function applyLockStatusFromSnapshot(area, docData) {
    if (!docData?._finalizados) return;
    if (!state.conteoFinalizadoPorUsuario)         state.conteoFinalizadoPorUsuario = { almacen: {}, barra1: {}, barra2: {} };
    if (!state.conteoFinalizadoPorUsuario[area])   state.conteoFinalizadoPorUsuario[area] = {};

    // Merge: no sobreescribir locks locales más nuevos
    const remote = docData._finalizados;
    Object.entries(remote).forEach(([uid, data]) => {
        const local = state.conteoFinalizadoPorUsuario[area][uid];
        if (!local || (data.ts || 0) > (local.ts || 0)) {
            state.conteoFinalizadoPorUsuario[area][uid] = data;
        }
    });

    saveToLocalStorage();
}

// ═════════════════════════════════════════════════════════════
//  RESET REMOTO DESDE OTRO DISPOSITIVO
// ═════════════════════════════════════════════════════════════

/**
 * applyRemoteReset()
 *
 * FIX BUG-1 (CRÍTICO): Esta función faltaba completamente en audit.js.
 * sync.js la invocaba al detectar un nuevo _resetCicloTs en Firestore:
 *   import('./audit.js').then(m => {
 *     if (typeof m.applyRemoteReset === 'function') m.applyRemoteReset();
 *   })
 * Sin esta función, cuando el admin iniciaba un nuevo ciclo desde otro
 * dispositivo, los bartenders NO recibían el reset → seguían viendo
 * los conteos del ciclo anterior y no podían empezar un conteo nuevo.
 *
 * Aplica el reset iniciado por el admin en otro dispositivo.
 * Solo limpia el estado LOCAL; no escribe en Firestore (el admin ya lo hizo).
 * El admin no necesita este reset (fue quien lo inició).
 */
export function applyRemoteReset() {
    // Admin no necesita reset — él fue quien lo inició desde su dispositivo
    if (state.userRole === 'admin') return;

    console.info('[Audit] Aplicando reset remoto iniciado por el admin…');

    // FIX BUG-AUDIT-1 (CRÍTICO — ver auditoriaResetear() más arriba para el
    // detalle completo): no se toca state.inventarioConteo. Este reset es
    // exclusivamente de la auditoría ciega; el inventario operativo del
    // bartender (conteo diario ya guardado en este dispositivo) no debe
    // desaparecer solo porque el admin inició un nuevo ciclo de auditoría.
    state.auditoriaStatus            = { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' };
    state.auditoriaConteo            = {};
    state.auditoriaConteoPorUsuario  = {};
    state.conteoFinalizadoPorUsuario = { almacen: {}, barra1: {}, barra2: {} };
    state.auditoriaView              = 'selection';
    state.auditoriaAreaActiva        = null;
    state.isAuditoriaMode            = false;

    import('./storage.js').then(m => m.saveToLocalStorage()).catch(() => {});
    import('./render.js').then(m => m.renderTab()).catch(() => {});

    showNotification('🔄 El admin inició un nuevo ciclo — conteos reseteados');
    console.info('[Audit] ✓ Reset remoto aplicado.');
}
window.auditSaveName             = auditSaveName;
window.toggleAuditRename         = toggleAuditRename;
window.auditoriaEntrarArea       = auditoriaEntrarArea;
window.auditoriaFinalizarConteo  = auditoriaFinalizarConteo;
window.auditoriaVolverSeleccion  = auditoriaVolverSeleccion;
window.auditoriaResetear         = auditoriaResetear;
window.reabrirConteoUsuario      = reabrirConteoUsuario;

// ══════════════════════════════════════════════════════════════
// CORRECCIONES APLICADAS EN ESTA VERSIÓN (v2.2)
// ══════════════════════════════════════════════════════════════
// BUG-AUDIT-1 (CRÍTICO — pérdida de datos entre features):
//   auditoriaResetear() (rama admin) y applyRemoteReset() (bartenders)
//   incluían `state.inventarioConteo = {};` junto al resto del reset de
//   auditoría. inventarioConteo es el conteo OPERATIVO diario (alimenta
//   product.stockByArea, usado en Inicio/Productos/Pedidos) — una función
//   totalmente distinta de la auditoría ciega. Cada vez que el admin
//   iniciaba un nuevo ciclo de auditoría, TODOS los dispositivos perdían
//   su inventario diario ya contado, sin relación con lo que el diálogo
//   de confirmación anunciaba ("se borrarán los conteos de auditoría").
//   CORRECCIÓN: se eliminan ambas líneas; el reset de auditoría ahora
//   solo toca auditoriaStatus/auditoriaConteo/auditoriaConteoPorUsuario/
//   conteoFinalizadoPorUsuario/auditoriaView/auditoriaAreaActiva/
//   isAuditoriaMode — igual que ya hacía resetConteoAtomicoEnFirestore()
//   en sync.js, que nunca tocó la colección stockAreas.

/**
 * js/audit.js — Auditoría Física Ciega: identidad multiusuario,
 * estadísticas de conteo, render de panels y flujo de navegación.
 */
import { state }       from './state.js';
import { AREAS_AUDITORIA, AUDIT_TOLERANCE } from './constants.js';
import { showNotification, showConfirm, escapeHtml } from './ui.js';
import { saveToLocalStorage } from './storage.js';
import { syncConteoAtomicoPorArea, syncConteoPorUsuarioToFirestore, resetConteoAtomicoEnFirestore } from './sync.js';

/* ── Identidad del dispositivo ───────────────────────────────── */
export function initAuditUser() {
    try {
        const raw = localStorage.getItem('inventarioApp_auditUser');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.userId) {
                state.auditCurrentUser = parsed;
                console.info('[MultiUser] Identidad recuperada:', parsed.userName, '(' + parsed.userId.slice(0,16) + '…)');
                return;
            }
        }
    } catch (_) {}
    const uid   = 'usr-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 6);
    const uName = 'Contador-' + Math.random().toString(36).substr(2, 4).toUpperCase();
    state.auditCurrentUser = { userId: uid, userName: uName, createdAt: Date.now() };
    try { localStorage.setItem('inventarioApp_auditUser', JSON.stringify(state.auditCurrentUser)); } catch (_) {}
    console.info('[MultiUser] Nueva identidad creada:', uName, '(' + uid.slice(0,16) + '…)');
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
        if (inp) { inp.value = state.auditCurrentUser ? state.auditCurrentUser.userName : ''; setTimeout(() => inp.focus(), 60); }
    }
}

export function auditSaveName() {
    const inp = document.getElementById('auditRenameInput');
    if (inp) setAuditUserName(inp.value);
}

/* ── Estadísticas de multi-conteo ───────────────────────────── */
export function calcAuditStats(productId, area) {
    const byArea  = state.auditoriaConteoPorUsuario[productId] && state.auditoriaConteoPorUsuario[productId][area];
    const entries = byArea ? Object.values(byArea) : [];
    if (entries.length === 0) return null;
    const totals = entries.map(u => {
        const enteras     = typeof u.enteras === 'number' ? u.enteras : 0;
        const sumAbiertas = Array.isArray(u.abiertas) ? u.abiertas.reduce((s,v) => s+(typeof v==='number'?v:0), 0) : 0;
        return { userId: u.userId, userName: u.userName||u.userId, ts: u.ts||0, enteras, totalAbiertas: Math.round(sumAbiertas*1000)/1000, total: Math.round((enteras+sumAbiertas)*10000)/10000 };
    });
    totals.sort((a,b) => a.ts - b.ts);
    const vals = totals.map(t => t.total);
    const sum  = Math.round(vals.reduce((a,b)=>a+b,0)*10000)/10000;
    const avg  = Math.round((sum/vals.length)*10000)/10000;
    const min  = Math.min(...vals);
    const max  = Math.max(...vals);
    const diff = Math.round((max-min)*10000)/10000;
    return { totals, sum, avg, min, max, diff, hasConflict: vals.length>=2 && diff>AUDIT_TOLERANCE, count: vals.length };
}

function formatAuditTs(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }); } catch (_) { return ''; }
}

/* ── Render: trail de trazabilidad ──────────────────────────── */
export function renderAuditTrailForProduct(productId, area) {
    const stats = calcAuditStats(productId, area);
    if (!stats || stats.count === 0) return '';
    const myId = state.auditCurrentUser ? state.auditCurrentUser.userId : null;
    let html = '<div class="audit-trail">';
    html += '<div class="audit-trail-header">';
    html += '<span>' + stats.count + ' conteo' + (stats.count!==1?'s':'') + ' registrado' + (stats.count!==1?'s':'') + '</span>';
    if (stats.count >= 2) {
        const badgeCls = stats.hasConflict ? 'error' : 'ok';
        const badgeLbl = stats.hasConflict ? '⚠️ DIFERENCIA (' + stats.diff.toFixed(2) + ')' : '✓ OK';
        html += '<span class="audit-status-badge ' + badgeCls + '">' + badgeLbl + '</span>';
    }
    html += '</div>';
    stats.totals.forEach(entry => {
        const isMe  = myId && entry.userId === myId;
        const meTxt = isMe ? ' <em style="opacity:.5;font-size:.58rem;font-style:normal">(tú)</em>' : '';
        html += '<div class="audit-trail-entry' + (isMe?' is-me':'') + '">';
        html += '<span class="audit-entry-name">' + escapeHtml(entry.userName) + meTxt + '</span>';
        html += '<span class="audit-entry-count">' + entry.enteras + ' ent + ' + entry.totalAbiertas.toFixed(2) + ' ab = <strong>' + entry.total.toFixed(2) + '</strong></span>';
        html += '<span class="audit-entry-ts">' + formatAuditTs(entry.ts) + '</span>';
        html += '</div>';
    });
    if (stats.count >= 2) {
        const diffColor = stats.hasConflict ? 'var(--red-text)' : 'var(--green-text)';
        html += '<div class="audit-stats-row">';
        html += '<span>Σ ' + stats.sum.toFixed(2) + '</span>';
        html += '<span>μ '  + stats.avg.toFixed(2) + '</span>';
        html += '<span>min '+ stats.min.toFixed(2) + '</span>';
        html += '<span>max '+ stats.max.toFixed(2) + '</span>';
        html += '<span style="color:' + diffColor + '">Δ ' + stats.diff.toFixed(2) + '</span>';
        html += '</div>';
    }
    html += '</div>';
    return html;
}

/* ── Render: panel de identidad del dispositivo ─────────────── */
export function renderAuditUserPanel() {
    const user     = state.auditCurrentUser || { userName: '—', userId: '?' };
    const initials = user.userName.slice(0, 2).toUpperCase();
    let html = '';
    html += '<div id="auditRenameInline" class="audit-rename-inline">';
    html += '<p style="font-size:0.68rem;color:var(--txt-muted);margin-bottom:0;">Nuevo nombre de usuario (máx. 32 caracteres)</p>';
    html += '<div class="audit-rename-row">';
    html += '<input id="auditRenameInput" class="audit-rename-input" type="text" maxlength="32" placeholder="Tu nombre…" onkeydown="if(event.key===\"Enter\"){event.preventDefault();window.auditSaveName();}">';
    html += '<button onclick="window.auditSaveName()" style="padding:6px 12px;background:var(--accent);color:#fff;border-radius:var(--r-sm);font-size:.75rem;font-weight:600;cursor:pointer;min-height:auto;">Guardar</button>';
    html += '<button onclick="window.toggleAuditRename()" style="padding:6px 10px;background:var(--surface);border:1px solid var(--border-mid);border-radius:var(--r-sm);color:var(--txt-secondary);font-size:.75rem;cursor:pointer;min-height:auto;">Cancelar</button>';
    html += '</div></div>';
    html += '<div class="audit-user-panel">';
    html += '<div class="audit-user-avatar">' + escapeHtml(initials) + '</div>';
    html += '<div class="audit-user-info">';
    html += '<div class="audit-user-label">Dispositivo actual</div>';
    html += '<div class="audit-user-name-text">' + escapeHtml(user.userName) + '</div>';
    html += '<div class="audit-user-id-text">' + escapeHtml(user.userId.slice(0,22)) + '…</div>';
    html += '</div>';
    html += '<button class="audit-rename-btn" onclick="window.toggleAuditRename()"><i class="fa-solid fa-pen" style="font-size:.65rem;margin-right:4px;"></i>Cambiar nombre</button>';
    html += '</div>';
    return html;
}

/* ── Render: panel de comparación multiusuario ──────────────── */
export function renderAuditComparePanel() {
    const hasAny = state.products.some(p =>
        Object.keys(state.auditoriaConteoPorUsuario[p.id] || {}).some(area =>
            Object.keys((state.auditoriaConteoPorUsuario[p.id]||{})[area]||{}).length > 1
        )
    );
    if (!hasAny) return '';
    let html = '<div class="bg-white rounded-xl p-4 mb-4 shadow-md" style="border:1px solid var(--border-mid);">';
    html += '<p style="font-size:0.72rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--accent);margin-bottom:10px;">📊 Comparación multiusuario</p>';
    let conflictos = 0;
    state.products.forEach(p => {
        Object.keys(AREAS_AUDITORIA).forEach(area => {
            const stats = calcAuditStats(p.id, area);
            if (!stats || stats.count < 2) return;
            if (stats.hasConflict) conflictos++;
        });
    });
    if (conflictos > 0) html += '<p style="color:var(--red-text);font-size:0.75rem;font-weight:600;">⚠️ ' + conflictos + ' diferencia' + (conflictos!==1?'s':'') + ' detectada' + (conflictos!==1?'s':'') + '</p>';
    else html += '<p style="color:var(--green-text);font-size:0.75rem;font-weight:600;">✓ Sin conflictos detectados</p>';
    html += '</div>';
    return html;
}

/* ── Flujo de auditoría ──────────────────────────────────────── */
export function auditoriaEntrarArea(area) {
    state.auditoriaAreaActiva = area;
    state.auditoriaView       = 'counting';
    state.isAuditoriaMode     = true;
    state.selectedArea        = area;
    saveToLocalStorage();
    import('./render.js').then(m => m.renderTab());
}

export function auditoriaFinalizarConteo() {
    if (!state.auditoriaAreaActiva) return;
    const area      = state.auditoriaAreaActiva;
    const nombreArea = AREAS_AUDITORIA[area];
    showConfirm('¿Finalizar conteo de ' + nombreArea + '?\n\nEsto guardará los datos del área y te regresará al panel de áreas.', () => {
        state.auditoriaStatus[area] = 'completada';
        state.auditoriaView         = 'selection';
        state.auditoriaAreaActiva   = null;
        state.isAuditoriaMode       = false;
        saveToLocalStorage();
        syncConteoAtomicoPorArea(area).catch(err => console.warn('[Atomico] Error en sync final:', err));
        syncConteoPorUsuarioToFirestore(area).catch(err => console.warn('[MultiUser] Error en sync multiusuario:', err));
        showNotification('✅ Conteo de ' + nombreArea + ' guardado');
        import('./render.js').then(m => m.renderTab());
    });
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

export function auditoriaResetear() {
    showConfirm('⚠️ ¿Iniciar nueva auditoría?\n\nSe borrarán todos los conteos actuales de las tres áreas.', () => {
        state.auditoriaStatus            = { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' };
        state.auditoriaConteo            = {};
        state.auditoriaConteoPorUsuario  = {};
        state.auditoriaView              = 'selection';
        state.auditoriaAreaActiva        = null;
        state.isAuditoriaMode            = false;
        saveToLocalStorage();
        resetConteoAtomicoEnFirestore().catch(err => console.warn('[Atomico] No se pudo limpiar Firestore:', err));
        showNotification('Nueva auditoría iniciada');
        import('./render.js').then(m => m.renderTab());
    });
}

/* ── Bindings globales ───────────────────────────────────────── */
window.auditSaveName           = auditSaveName;
window.toggleAuditRename       = toggleAuditRename;
window.auditoriaEntrarArea     = auditoriaEntrarArea;
window.auditoriaFinalizarConteo = auditoriaFinalizarConteo;
window.auditoriaVolverSeleccion = auditoriaVolverSeleccion;
window.auditoriaResetear       = auditoriaResetear;

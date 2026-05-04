import { state } from '../core/state.js';
import * as api from '../core/api.js';
import { socket } from '../core/api.js';
import { showToast, displayResponse, escapeHtml, formatCurrencyCOP, parseLocaleNumber, round2, renderMoldPartsProgressList, fmtHours, clampPct } from '../ui/ui.js';
import { populateSelectWithFilter, setupFilterListener } from './worklogs.js';
import { getBogotaTodayISO, fetchMoldProgressDetail, loadCalendar } from './calendar.js';

export async function initPlannerTab() {
  await initPlannerGridFromCatalogs();
  renderFixedPlanningGrid();
  restorePlannerStateFromStorage();
  try { await loadPlannedMoldsList(); } catch (_) {}
  
  // Initialize date to today (Colombia)
  const startDateEl = document.getElementById('gridStartDate');
  if (startDateEl && !startDateEl.value) {
    const today = typeof getBogotaTodayISO === 'function' ? getBogotaTodayISO() : new Date().toISOString().split('T')[0];
    startDateEl.value = today;
  }
}

export function setPlannerLoadedMold(mold) {
  state.plannerLoadedMold = mold || null;
  state.plannerPreviewMode = !!state.plannerLoadedMold?.previewMode;
  const banner = document.getElementById('plannerLoadedMoldBanner');
  const clientNameEl = document.getElementById('planClientName');

  const submitBtn = document.getElementById('submitGridPlanBtn');
  if (submitBtn) {
    submitBtn.textContent = state.plannerLoadedMold
      ? (state.plannerPreviewMode ? 'Salir de vista previa' : 'Actualizar Planificación')
      : 'Crear Planificación';
  }

  if (!banner) return;
  if (!state.plannerLoadedMold) {
    applyPlannerPreviewMode(false);
    try { clearPlannerProgressLocks(); } catch (_) {}
    if (clientNameEl) clientNameEl.value = '';
    banner.innerHTML = '';
    return;
  }
  if (clientNameEl) clientNameEl.value = String(state.plannerLoadedMold.clientName || '');
  const name = escapeHtml(String(state.plannerLoadedMold.moldName || ''));
  const clientName = escapeHtml(String(state.plannerLoadedMold.clientName || ''));
  const clientText = clientName || '<span class="text-muted">(sin cliente)</span>';
  const range = `${escapeHtml(String(state.plannerLoadedMold.startDate || '—'))} → ${escapeHtml(String(state.plannerLoadedMold.endDate || '—'))}`;
  const estimatedPrice = escapeHtml(String(document.getElementById('estimated-cost-total')?.textContent || '$ 0'));
  const modeTitle = state.plannerPreviewMode ? 'Vista previa de molde planificado' : 'Editando molde planificado';
  const modeHint = state.plannerPreviewMode
    ? 'Modo solo lectura: revisa la planificación y el Precio Estimado. No se guardarán cambios.'
    : 'Al actualizar en este modo, se elimina la planificación previa del molde y se vuelve a planificar desde la fecha de inicio seleccionada.';
  const inlineBtnText = state.plannerPreviewMode ? 'Salir de vista previa' : 'Salir de edición';
  const inlineBtnTitle = state.plannerPreviewMode
    ? 'Cerrar vista previa y volver al modo normal'
    : 'Salir del modo edición de molde planificado';
  banner.innerHTML = `
    <div style="padding:10px 12px; border:1px solid var(--border-color); border-radius:10px; background: var(--card-bg);">
      <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:baseline;">
        <div style="font-weight:800;">${modeTitle}</div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <div style="color:var(--text-muted); font-size:0.9rem;">Rango: ${range}</div>
          <button class="btn btn-secondary btn-sm" id="exitPlannedMoldEditBtnInline" title="${inlineBtnTitle}">${inlineBtnText}</button>
        </div>
      </div>
      <div style="margin-top:6px;">Planificación: <strong>${name}</strong> - Cliente: <strong>${clientText}</strong></div>
      <div style="margin-top:6px;">Precio estimado total: <strong>${estimatedPrice}</strong></div>
      <div style="margin-top:6px; color:var(--text-muted); font-size:0.9rem;">${modeHint}</div>
    </div>
  `;

  applyPlannerPreviewMode(state.plannerPreviewMode);

  const exitInlineBtn = document.getElementById('exitPlannedMoldEditBtnInline');
  if (exitInlineBtn) {
    exitInlineBtn.addEventListener('click', (e) => {
      e.preventDefault();
      setPlannerLoadedMold(null);
    }, { once: true });
  }
}

export async function loadPlannedMoldsList() {
  const container = document.getElementById('plannedMoldsList');
  if (!container) return;
  if (!state.currentUser) { container.innerHTML = ''; return; }

  container.innerHTML = '<div style="color:var(--text-muted)">Cargando moldes planificados...</div>';
  try {
    const res = await fetch(`${state.API_URL}/tasks/plan/molds`, {
      credentials: 'include',
      cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      container.innerHTML = `<div style="color:var(--danger)">${escapeHtml(String(data?.error || 'No se pudo cargar la lista'))}</div>`;
      return;
    }
    const molds = Array.isArray(data?.molds) ? data.molds : [];
    if (!molds.length) {
      container.innerHTML = '<div style="color:var(--text-muted)">(No hay moldes planificados)</div>';
      return;
    }

    container.innerHTML = molds.map(m => {
      const mid = escapeHtml(String(m.moldId));
      const name = escapeHtml(String(m.moldName || ''));
      const clientName = escapeHtml(String(m.clientName || ''));
      const range = `${escapeHtml(String(m.startDate || '—'))} → ${escapeHtml(String(m.endDate || '—'))}`;
      const hours = (m.totalHours != null) ? `${Number(m.totalHours).toFixed(1)}h` : '';
      return `
        <div class="planned-mold-item" data-action="loadPlannedMold" data-mold-id="${mid}" data-mold-name="${name}" data-client-name="${clientName}" data-start-date="${escapeHtml(String(m.startDate || ''))}" data-end-date="${escapeHtml(String(m.endDate || ''))}" style="padding:10px 12px; border:1px solid var(--border-color); border-radius:10px; background: var(--card-bg); margin-bottom:8px; cursor:pointer;">
          <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
            <div style="font-weight:800;">${name}</div>
            <div style="color:var(--text-muted); font-size:0.9rem;">${range}</div>
          </div>
          <div style="margin-top:4px; color:var(--text-muted); font-size:0.9rem;">Cliente: <strong>${clientName || '—'}</strong></div>
          <div style="margin-top:6px; color:var(--text-muted); font-size:0.9rem;">${hours ? `Total planificado: <strong>${escapeHtml(hours)}</strong>` : ''}</div>
        </div>
      `;
    }).join('');
  } catch (e) {
    container.innerHTML = '<div style="color:var(--danger)">Error de conexión cargando moldes planificados</div>';
  }
}

export function buildPlannerNameToMachineIdMap() {
  const machines = (state.plannerMachinesInGrid && state.plannerMachinesInGrid.length)
    ? state.plannerMachinesInGrid
    : (state.FIXED_MACHINES || []);
  const map = new Map();
  machines.forEach(m => {
    const name = String(m?.name || '').trim().toLowerCase();
    if (!name) return;
    map.set(name, String(m.id));
  });
  return map;
}

export function fillPlannerGridFromMoldPlanTotals(moldPlan) {
  const grid = document.getElementById('planningGridFixed');
  if (!grid) return;

  // Limpiar parrilla primero
  grid.querySelectorAll('tbody tr').forEach(row => {
    const qtyInput = row.querySelector('.qty-input');
    if (qtyInput) qtyInput.value = '';
    row.querySelectorAll('.hours-input').forEach(inp => { inp.value = ''; });
    updateFixedRowTotal(row);
  });

  const nameToMachineId = buildPlannerNameToMachineIdMap();
  const totals = new Map(); // partNameLower -> Map(machineId -> hours)

  (moldPlan?.entries || []).forEach(e => {
    const part = String(e?.part || '').trim();
    const machineName = String(e?.machine || '').trim();
    const hours = Number(e?.hours || 0);
    if (!part || !machineName || !Number.isFinite(hours) || hours <= 0) return;

    const mid = nameToMachineId.get(machineName.toLowerCase());
    if (!mid) return;

    const pkey = part.toLowerCase();
    if (!totals.has(pkey)) totals.set(pkey, new Map());
    const byMachine = totals.get(pkey);
    byMachine.set(mid, (byMachine.get(mid) || 0) + hours);
  });

  grid.querySelectorAll('tbody tr').forEach(row => {
    const partName = String(row.getAttribute('data-part-name') || '').trim();
    if (!partName) return;
    const byMachine = totals.get(partName.toLowerCase());
    if (!byMachine) return;

    // En modo "cargado desde plan", usamos cantidad=1 para representar totales por máquina.
    const qtyInput = row.querySelector('.qty-input');
    if (qtyInput) qtyInput.value = '1';

    row.querySelectorAll('.hours-input').forEach(inp => {
      const mid = String(inp.getAttribute('data-machine-id') || '');
      if (!mid) return;
      const v = byMachine.get(mid);
      if (v != null && Number.isFinite(v) && v > 0) inp.value = Number(v).toFixed(2);
    });

    updateFixedRowTotal(row);
  });

  updateFixedColumnTotals();
  updateFixedGrandTotal();
  persistPlannerStateToStorage();
}

export function clearPlannerProgressLocks() {
  const grid = document.getElementById('planningGridFixed');
  if (!grid) return;
  grid.querySelectorAll('tbody tr').forEach(row => {
    const qtyInput = row.querySelector('.qty-input');
    if (qtyInput) qtyInput.disabled = false;
    row.querySelectorAll('.hours-input').forEach(inp => {
      inp.disabled = false;
      inp.classList.remove('planner-cell-done');
    });
  });
}

export function applyPlannerProgressLocksFromBreakdown(breakdown) {
  const grid = document.getElementById('planningGridFixed');
  if (!grid) return;

  const parts = Array.isArray(breakdown?.parts) ? breakdown.parts : [];
  const doneCells = new Map(); // norm(partName) -> Set(machineId)

  for (const p of parts) {
    const pKey = normKey(p?.partName);
    if (!pKey) continue;
    const machines = Array.isArray(p?.machines) ? p.machines : [];
    for (const m of machines) {
      if (!m?.isComplete) continue;
      const mid = String(m.machineId);
      if (!doneCells.has(pKey)) doneCells.set(pKey, new Set());
      doneCells.get(pKey).add(mid);
    }
  }

  grid.querySelectorAll('tbody tr').forEach(row => {
    const partName = String(row.getAttribute('data-part-name') || '');
    const pKey = normKey(partName);
    if (!pKey) return;

    const qtyInput = row.querySelector('.qty-input');

    // En edición por molde planificado, deshabilitamos cantidad siempre.
    // La parrilla representa totales por máquina (qty=1), así evitamos que cambien horas completadas indirectamente.
    if (state.plannerLoadedMold && qtyInput) qtyInput.disabled = true;
    else if (qtyInput) qtyInput.disabled = false;

    const midsDone = doneCells.get(pKey);
    row.querySelectorAll('.hours-input').forEach(inp => {
      const mid = String(inp.getAttribute('data-machine-id') || '');
      const cellDone = midsDone && mid && midsDone.has(mid);
      inp.disabled = !!cellDone;
      inp.classList.toggle('planner-cell-done', !!cellDone);
    });
  });
}

// Planificador
export function getPlannerSelectedMoldName() {
  const sel = document.getElementById('planMoldSelect');
  if (!sel || !sel.selectedOptions || !sel.selectedOptions.length) return '';
  const opt = sel.selectedOptions[0];
  return String(opt.value || opt.textContent || '').trim();
}

export function selectPlannerMoldByName(name) {
  const sel = document.getElementById('planMoldSelect');
  if (!sel) return false;
  const n = String(name || '').trim().toLowerCase();
  if (!n) return false;
  const opts = Array.from(sel.options || []);
  const idx = opts.findIndex(o => String(o.value || '').trim().toLowerCase() === n || String(o.textContent || '').trim().toLowerCase() === n);
  if (idx >= 0) {
    sel.selectedIndex = idx;
    return true;
  }
  return false;
}

export async function preloadMoldsForSearch() {
  try {
    // Preferir catálogo (tabla molds) para que lo creado en Configuración aparezca aquí
    let res = await fetch(`${state.API_URL}/catalogs/meta`, { credentials: 'include' });
    if (!res.ok) {
      // Fallback: valores únicos desde "datos" (útil si aún no sincronizas catálogos)
      res = await fetch(`${state.API_URL}/datos/meta`, { credentials: 'include' });
    }

    if (res.ok) {
      const meta = await res.json();
      const moldsRaw = Array.isArray(meta.molds) ? meta.molds : [];
      const fromCatalog = moldsRaw
        .map(m => (m && typeof m === 'object') ? m.name : m)
        .filter(Boolean);
      const fromDatos = Array.isArray(meta.moldes) ? meta.moldes : [];
      const moldes = fromCatalog.length ? fromCatalog : fromDatos;

      state.cachedMolds = Array.from(new Set(moldes.map(m => String(m).trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b));

      populateSelectWithFilter('planMoldSelect', 'planMoldFilter', state.cachedMolds);
      setupFilterListener('planMoldFilter', 'planMoldSelect');

      if (state.plannerPendingMoldName) {
        if (selectPlannerMoldByName(state.plannerPendingMoldName)) state.plannerPendingMoldName = null;
      }
      return;
    }
  } catch (_) { }
  state.cachedMolds = [];
}

export function normKey(s) {
  return String(s || '').trim().toLowerCase();
}

export function renderPlanningHistory(history, fallbackData = null) {
  let items = Array.isArray(history) ? history.slice() : [];

  if (!items.length) {
    const start = fallbackData?.planWindow?.startDate ? String(fallbackData.planWindow.startDate) : '';
    const end = fallbackData?.planWindow?.endDate ? String(fallbackData.planWindow.endDate) : '';
    if (start || end) {
      items = [{
        label: 'Plan inicial',
        eventDate: start || end || '',
        from: { startDate: null, endDate: null },
        to: { startDate: start || null, endDate: end || null },
        note: 'Plan registrado (sin historial detallado previo).'
      }];
    }
  }

  if (!items.length) {
    return '<div style="color:var(--text-muted)">(Sin historial de planificación)</div>';
  }

  const toRangeText = (r) => {
    const s = r?.startDate ? String(r.startDate) : '—';
    const e = r?.endDate ? String(r.endDate) : '—';
    return `${s} → ${e}`;
  };

  return `
    <div>
      ${items.map(it => {
        const label = String(it?.label || it?.eventType || 'Evento');
        const d = String(it?.eventDate || '').trim();
        const fromText = toRangeText(it?.from);
        const toText = toRangeText(it?.to);
        const changedRange = fromText !== toText;
        return `
          <div style="border:1px solid var(--border); border-radius:10px; padding:10px; margin-bottom:8px; background:var(--card-bg);">
            <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; align-items:baseline;">
              <strong>${escapeHtml(label)}</strong>
              <span style="color:var(--text-muted); font-size:0.85rem;">${escapeHtml(d || '—')}</span>
            </div>
            ${changedRange ? `<div style="margin-top:4px; font-size:0.9rem;"><span style="color:var(--text-muted);">Rango:</span> ${escapeHtml(fromText)} → ${escapeHtml(toText)}</div>` : ''}
            ${it?.note ? `<div style="margin-top:4px; color:var(--text-muted); font-size:0.85rem;">${escapeHtml(String(it.note))}</div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

export function buildMoldProgressContent(data, fallbackMoldName, opts) {
  const listKind = opts?.listKind ? String(opts.listKind) : '';
  const isCompletedList = listKind === 'completed';

  const pct = (data?.totals?.percentComplete == null) ? null : Number(data.totals.percentComplete);
  const plannedTotal = Number(data?.totals?.plannedTotalHours || 0);
  const actualTotal = Number(data?.totals?.actualTotalHours || 0);

  const completedParts = Number(data?.totals?.completedParts);
  const totalParts = Number(data?.totals?.totalPartsWithPlan);
  const partsLabel = (Number.isFinite(completedParts) && Number.isFinite(totalParts) && totalParts > 0)
    ? `${completedParts}/${totalParts}`
    : null;

  const completedCells = Number(data?.breakdown?.totals?.completedCells);
  const totalCells = Number(data?.breakdown?.totals?.totalCellsWithPlan);
  const cellsLabel = (Number.isFinite(completedCells) && Number.isFinite(totalCells) && totalCells > 0)
    ? `${completedCells}/${totalCells}`
    : null;

  const planStart = data?.planWindow?.startDate ? String(data.planWindow.startDate) : '';
  const planEnd = data?.planWindow?.endDate ? String(data.planWindow.endDate) : '';
  const planRange = (planStart || planEnd) ? `${planStart || '—'} → ${planEnd || '—'}` : '';

  const varianceTotalHours = actualTotal - plannedTotal;
  const varianceTotalPct = (plannedTotal > 0 && Number.isFinite(varianceTotalHours)) ? (varianceTotalHours / plannedTotal) * 100 : null;

  // En "Moldes terminados" el avance debe ser 100% (ya se sabe que terminó).
  // La diferencia vs plan se muestra aparte como desviación.
  const shownPct = isCompletedList ? 100 : pct;
  const barPct = shownPct == null ? 0 : clampPct(shownPct);

  return `
    <div style="display:flex; justify-content:space-between; gap:12px; align-items:baseline; flex-wrap:wrap;">
      <div>
        <div style="font-weight:800;">Avance vs plan${isCompletedList ? ' (Terminado)' : ''}</div>
        <div style="color:var(--text-muted); font-size:0.9rem;">Molde: <strong>${escapeHtml(String(data?.moldName || fallbackMoldName || ''))}</strong></div>
        ${(!isCompletedList && planRange) ? `<div style="color:var(--text-muted); font-size:0.85rem;">Plan: ${escapeHtml(planRange)}</div>` : ''}
      </div>
      <div style="color:var(--text-muted); font-size:0.9rem;">Hoy: ${escapeHtml(String(data?.today || ''))}</div>
    </div>

    <div class="mold-progress-bar" aria-label="Progreso">
      <div style="width:${barPct}%;"></div>
    </div>

    <div class="mold-progress-grid">
      ${isCompletedList ? `
        <div class="mold-progress-kpi">
          <div class="label">% completado (avance)</div>
          <div class="value">100.00%</div>
        </div>
        <div class="mold-progress-kpi">
          <div class="label">Plan total</div>
          <div class="value">${fmtHours(plannedTotal)}h</div>
        </div>
        <div class="mold-progress-kpi">
          <div class="label">Real total</div>
          <div class="value">${fmtHours(actualTotal)}h</div>
        </div>
        <div class="mold-progress-kpi">
          <div class="label">Desviación (real - plan)</div>
          <div class="value" style="color:${varianceTotalHours > 0.01 ? 'var(--danger)' : (varianceTotalHours < -0.01 ? 'var(--success)' : 'var(--text)')}">
            ${Number.isFinite(varianceTotalHours) ? `${varianceTotalHours >= 0 ? '+' : ''}${fmtHours(varianceTotalHours)}h` : '—'}
            ${Number.isFinite(varianceTotalPct) ? ` <span style="color:var(--text-muted); font-weight:600; font-size:0.95rem;">(${varianceTotalPct >= 0 ? '+' : ''}${Number(varianceTotalPct).toFixed(2)}%)</span>` : ''}
          </div>
        </div>
      ` : `
        <div class="mold-progress-kpi">
          <div class="label">% completado (real/plan total)</div>
          <div class="value">${pct == null ? '—' : `${pct.toFixed(2)}%`}</div>
        </div>
        <div class="mold-progress-kpi">
          <div class="label">Plan total</div>
          <div class="value">${fmtHours(plannedTotal)}h</div>
        </div>
        <div class="mold-progress-kpi">
          <div class="label">Real total</div>
          <div class="value">${fmtHours(actualTotal)}h</div>
        </div>
        <div class="mold-progress-kpi">
          <div class="label">Partes completadas</div>
          <div class="value">${partsLabel ? escapeHtml(partsLabel) : (cellsLabel ? escapeHtml(cellsLabel) : '—')}</div>
        </div>
      `}
    </div>
  `;
}

export async function renderInProgressMoldList() {
  const container = document.getElementById('inProgressMoldList');
  if (!container) return;

  if (!state.currentUser) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '<div style="color:var(--text-muted)">Cargando moldes en curso...</div>';

  try {
    const asOf = getBogotaTodayISO && getBogotaTodayISO();
    const url = asOf ? `${state.API_URL}/molds/in-progress?asOf=${encodeURIComponent(asOf)}` : `${state.API_URL}/molds/in-progress`;
    const res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      container.innerHTML = `<div style="color:var(--danger)">${escapeHtml(String(data?.error || 'No se pudo cargar moldes en curso'))}</div>`;
      return;
    }

    const molds = Array.isArray(data?.molds) ? data.molds : [];
    if (!molds.length) {
      container.innerHTML = '<div style="color:var(--text-muted)">(No hay moldes en curso)</div>';
      return;
    }

    container.innerHTML = molds.map(m => buildMoldProgressPanelWithToggle(m, 'in-progress')).join('');
    await wireMoldDetailToggles(container);
  } catch (_) {
    container.innerHTML = '<div style="color:var(--danger)">Error de conexión cargando moldes en curso</div>';
  }
}

export function buildMoldProgressPanelWithToggle(m, listKind) {
  const moldId = m?.moldId;
  const planningId = Number(m?.planning?.planningId || m?.planningId || 0) || null;
  const key = `${String(listKind || 'list')}:${String(moldId ?? '')}:${String(planningId ?? '')}`;
  return `
    <div class="mold-progress-panel" data-mold-panel="${escapeHtml(key)}" data-mold-id="${escapeHtml(String(moldId ?? ''))}" data-planning-id="${escapeHtml(String(planningId ?? ''))}">
      ${buildMoldProgressContent(m, m?.moldName, { listKind })}
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <button class="btn btn-secondary" data-toggle-mold-detail="${escapeHtml(key)}">Detalle (partes/máquinas)</button>
        ${m?.lastWorkDate ? `<span style="color:var(--text-muted); font-size:0.85rem;">Último registro: ${escapeHtml(String(m.lastWorkDate))}</span>` : ''}
      </div>
      <div data-mold-detail="${escapeHtml(key)}" style="margin-top:10px; display:none;"></div>
    </div>
  `;
}

export function safeCssEscape(v) {
  const s = String(v ?? '');
  try {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
  } catch (_) {}
  // Fallback simple (suficiente para nuestros data-attributes)
  return s.replace(/[^a-zA-Z0-9_\-]/g, '\\$&');
}

export async function wireMoldDetailToggles(container) {
  if (!container) return;
  const buttons = Array.from(container.querySelectorAll('button[data-toggle-mold-detail]'));
  if (!buttons.length) return;

  buttons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.getAttribute('data-toggle-mold-detail');
      if (!key) return;
      const panel = container.querySelector(`[data-mold-panel="${safeCssEscape(key)}"]`);
      if (!panel) return;
      const moldId = panel.getAttribute('data-mold-id');
      const planningIdRaw = panel.getAttribute('data-planning-id');
      const planningId = planningIdRaw ? Number(planningIdRaw) : null;
      const detail = panel.querySelector(`[data-mold-detail="${safeCssEscape(key)}"]`);
      if (!detail) return;

      const isOpen = detail.style.display !== 'none';
      if (isOpen) {
        detail.style.display = 'none';
        return;
      }

      // Lazy load only once
      if (detail.getAttribute('data-loaded') === '1') {
        detail.style.display = 'block';
        return;
      }

      detail.style.display = 'block';
      detail.innerHTML = '<div style="color:var(--text-muted)">Cargando detalle...</div>';
      try {
        const progress = await fetchMoldProgressDetail(moldId, { planningId });
        if (!progress || !progress.breakdown) {
          detail.innerHTML = '<div style="color:var(--text-muted)">(Sin detalle disponible)</div>';
          detail.setAttribute('data-loaded', '1');
          return;
        }
        const historyHtml = renderPlanningHistory(progress?.planningHistory, progress);
        const partsHtml = renderMoldPartsProgressList(progress.breakdown);
        detail.innerHTML = `
          <div style="margin-bottom:10px;">
            <div style="font-weight:700; margin-bottom:6px;">Mini historial</div>
            ${historyHtml}
          </div>
          <div>
            <div style="font-weight:700; margin-bottom:6px;">Detalle por partes/máquinas</div>
            ${partsHtml}
          </div>
        `;
        detail.setAttribute('data-loaded', '1');
      } catch (_) {
        detail.innerHTML = '<div style="color:var(--danger)">Error cargando detalle</div>';
      }
    });
  });
}

export async function renderCompletedMoldList() {
  const container = document.getElementById('completedMoldList');
  if (!container) return;

  if (!state.currentUser) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '<div style="color:var(--text-muted)">Cargando moldes terminados...</div>';

  try {
    const qs = new URLSearchParams();
    qs.set('limit', '200');

    const monthSel = document.getElementById('completedMoldsMonth');
    const yearInp = document.getElementById('completedMoldsYear');
    const month = monthSel ? String(monthSel.value || '').trim() : '';
    const year = yearInp ? String(yearInp.value || '').trim() : '';
    if (month && year) {
      qs.set('month', month);
      qs.set('year', year);
    }

    const url = `${state.API_URL}/molds/completed?${qs.toString()}`;
    const res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      container.innerHTML = `<div style="color:var(--danger)">${escapeHtml(String(data?.error || 'No se pudo cargar moldes terminados'))}</div>`;
      return;
    }

    let molds = Array.isArray(data?.molds) ? data.molds : [];

    const q = String(document.getElementById('completedMoldsSearch')?.value || '').trim().toLowerCase();
    if (q) {
      molds = molds.filter(m => String(m?.moldName || '').toLowerCase().includes(q));
    }

    if (!molds.length) {
      container.innerHTML = '<div style="color:var(--text-muted)">(No hay moldes terminados)</div>';
      return;
    }

    container.innerHTML = molds.map(m => buildMoldProgressPanelWithToggle(m, 'completed')).join('');
    await wireMoldDetailToggles(container);
  } catch (_) {
    container.innerHTML = '<div style="color:var(--danger)">Error de conexión cargando moldes terminados</div>';
  }
}

export function wireCompletedMoldsViewControls() {
  const list = document.getElementById('completedMoldList');
  if (!list) return;
  if (list.getAttribute('data-wired') === '1') return;
  list.setAttribute('data-wired', '1');

  // Defaults: mes/año actual (Bogotá si está disponible)
  try {
    const monthSel = document.getElementById('completedMoldsMonth');
    const yearInp = document.getElementById('completedMoldsYear');
    if (monthSel && yearInp && !monthSel.value && !yearInp.value) {
      const iso = (typeof getBogotaTodayISO === 'function') ? getBogotaTodayISO() : null;
      const now = iso ? iso : new Date().toISOString().slice(0, 10);
      const y = now.slice(0, 4);
      const m = String(Number(now.slice(5, 7)));
      yearInp.value = y;
      monthSel.value = m;
    }
  } catch (_) {}

  const refreshBtn = document.getElementById('completedMoldsRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      try { renderCompletedMoldList(); } catch (_) {}
    });
  }

  const clearBtn = document.getElementById('completedMoldsClearBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const search = document.getElementById('completedMoldsSearch');
      if (search) search.value = '';
      const monthSel = document.getElementById('completedMoldsMonth');
      const yearInp = document.getElementById('completedMoldsYear');
      if (monthSel) monthSel.value = '';
      if (yearInp) yearInp.value = '';
      try { renderCompletedMoldList(); } catch (_) {}
    });
  }

  const searchInput = document.getElementById('completedMoldsSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      try { renderCompletedMoldList(); } catch (_) {}
    });
  }

  const monthSel = document.getElementById('completedMoldsMonth');
  if (monthSel) {
    monthSel.addEventListener('change', () => {
      try { renderCompletedMoldList(); } catch (_) {}
    });
  }
  const yearInp = document.getElementById('completedMoldsYear');
  if (yearInp) {
    yearInp.addEventListener('change', () => {
      try { renderCompletedMoldList(); } catch (_) {}
    });
  }
}

export function renderFixedPlanningGrid() {
  const container = document.getElementById('planningGridContainer');
  if (!container) return;
  const machines = (state.plannerMachinesInGrid && state.plannerMachinesInGrid.length) ? state.plannerMachinesInGrid : state.FIXED_MACHINES;
  const parts = (state.plannerPartsInGrid && state.plannerPartsInGrid.length) ? state.plannerPartsInGrid.map(p => p.name) : state.FIXED_PARTS;

  let html = `
    <table id="planningGridFixed">
      <thead>
        <tr>
          <th>Parte</th>
          <th>Cantidad</th>
          ${machines.map(m => {
            const cap = (m.hoursAvailable != null)
              ? `${m.hoursAvailable}h disp.`
              : (m.daily_capacity != null && m.daily_capacity !== '' ? `${Number(m.daily_capacity)}h/día` : '');
            return `<th>${escapeHtml(m.name)}${cap ? `<br><small>${escapeHtml(cap)}</small>` : ''}</th>`;
          }).join('')}
          <th>Total Horas</th>
        </tr>
      </thead>
      <tbody>
        ${parts.map(p => `
          <tr data-part-name="${escapeHtml(p)}">
            <td class="part-name">${escapeHtml(p)}</td>
            <td><input type="number" class="qty-input" min="0" step="1" placeholder="0"></td>
            ${machines.map(m => `
              <td>
                <input type="number" class="hours-input" data-machine-id="${escapeHtml(String(m.id))}" list="hoursOptions" min="0" step="0.25" placeholder="0">
              </td>`).join('')}
            <td class="total-hours-cell">0.00</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td><strong>Totales</strong></td>
          <td></td>
          ${machines.map(m => `<td id="total-machine-${escapeHtml(String(m.id))}">0.00</td>`).join('')}
          <td id="grand-total">0.00</td>
        </tr>
        <tr>
          <td><strong>Precio Estimado</strong></td>
          <td></td>
          ${machines.map(m => `<td id="cost-machine-${escapeHtml(String(m.id))}">$ 0</td>`).join('')}
          <td id="estimated-cost-total">$ 0</td>
        </tr>
      </tfoot>
    </table>
  `;
  container.innerHTML = html;

  const startDateEl = document.getElementById('gridStartDate');
  if (startDateEl) startDateEl.addEventListener('input', persistPlannerStateToStorage);
  const clientNameEl = document.getElementById('planClientName');
  if (clientNameEl) clientNameEl.addEventListener('input', persistPlannerStateToStorage);

  const inputs = container.querySelectorAll('.qty-input, .hours-input');
  inputs.forEach(input => {
    input.addEventListener('input', () => {
      const row = input.closest('tr');
      updateFixedRowTotal(row);
      updateFixedColumnTotals();
      updateFixedGrandTotal();
      persistPlannerStateToStorage();
    });
  });
}
export function updateFixedRowTotal(row) {
  const qtyInput = row.querySelector('.qty-input');
  const qty = qtyInput ? (parseLocaleNumber(qtyInput.value) || 0) : 0;
  let sumBase = 0;
  row.querySelectorAll('.hours-input').forEach(inp => {
    const v = parseLocaleNumber(inp.value);
    sumBase += isNaN(v) ? 0 : v;
  });
  const total = qty * sumBase;
  const cell = row.querySelector('.total-hours-cell');
  if (cell) cell.textContent = Number(total).toFixed(2);
}
export function updateFixedColumnTotals() {
  const grid = document.getElementById('planningGridFixed');
  if (!grid) return;
  const machines = (state.plannerMachinesInGrid && state.plannerMachinesInGrid.length) ? state.plannerMachinesInGrid : state.FIXED_MACHINES;
  let estimatedTotalCost = 0;
  machines.forEach(m => {
    let colSum = 0;
    grid.querySelectorAll(`tbody .hours-input[data-machine-id="${String(m.id)}"]`).forEach(inp => {
      const v = parseLocaleNumber(inp.value);
      const row = inp.closest('tr');
      const qty = parseLocaleNumber(row.querySelector('.qty-input').value) || 0;
      colSum += (isNaN(v) ? 0 : v) * qty;
    });
    const cell = document.getElementById(`total-machine-${String(m.id)}`);
    if (cell) cell.textContent = Number(colSum).toFixed(2);

    const machinePrice = Number(m?.hourly_price || 0);
    const estimatedPrice = (Number.isFinite(machinePrice) && machinePrice > 0) ? (colSum * machinePrice) : 0;
    estimatedTotalCost += estimatedPrice;
    const costCell = document.getElementById(`cost-machine-${String(m.id)}`);
    if (costCell) costCell.textContent = formatCurrencyCOP(estimatedPrice);
  });

  const estimatedTotalCell = document.getElementById('estimated-cost-total');
  if (estimatedTotalCell) estimatedTotalCell.textContent = formatCurrencyCOP(estimatedTotalCost);
}
export function updateFixedGrandTotal() {
  const grid = document.getElementById('planningGridFixed');
  if (!grid) return;
  let grand = 0;
  grid.querySelectorAll('tbody .total-hours-cell').forEach(cell => {
    const v = parseLocaleNumber(cell.textContent);
    grand += isNaN(v) ? 0 : v;
  });
  const totalEl = document.getElementById('grand-total');
  if (totalEl) totalEl.textContent = Number(grand).toFixed(2);
}

// Persistencia local
export function persistPlannerStateToStorage() {
  const state = {
    moldName: getPlannerSelectedMoldName(),
    clientName: document.getElementById('planClientName')?.value || '',
    startDate: document.getElementById('gridStartDate')?.value || '',
    rows: []
  };
  const grid = document.getElementById('planningGridFixed');
  if (grid) {
    grid.querySelectorAll('tbody tr').forEach(row => {
      const partName = row.getAttribute('data-part-name');
      const qty = row.querySelector('.qty-input')?.value || '';
      const hoursByMachine = {};
      row.querySelectorAll('.hours-input').forEach(inp => {
        const mid = inp.getAttribute('data-machine-id');
        hoursByMachine[mid] = inp.value || '';
      });
      state.rows.push({ partName, qty, hoursByMachine });
    });
  }
  try { localStorage.setItem(state.LS_KEYS.plannerState, JSON.stringify(state)); } catch { }
}
export function restorePlannerStateFromStorage() {
  let raw;
  try { raw = localStorage.getItem(state.LS_KEYS.plannerState); } catch { }
  if (!raw) return;
  let state;
  try { state = JSON.parse(raw); } catch { return; }
  const startDateEl = document.getElementById('gridStartDate');
  if (typeof state.moldName === 'string' && state.moldName) {
    state.plannerPendingMoldName = state.moldName;
    selectPlannerMoldByName(state.moldName);
  }
  const clientNameEl = document.getElementById('planClientName');
  if (clientNameEl && typeof state.clientName === 'string') clientNameEl.value = state.clientName;
  if (startDateEl && typeof state.startDate === 'string' && state.startDate) startDateEl.value = state.startDate;

  const grid = document.getElementById('planningGridFixed');
  if (!grid || !Array.isArray(state.rows)) return;
  const rows = grid.querySelectorAll('tbody tr');
  state.rows.forEach((savedRow, idx) => {
    const row = rows[idx];
    if (!row) return;
    const qtyInput = row.querySelector('.qty-input');
    if (qtyInput) qtyInput.value = savedRow.qty || '';
    row.querySelectorAll('.hours-input').forEach(inp => {
      const mid = inp.getAttribute('data-machine-id');
      if (savedRow.hoursByMachine && savedRow.hoursByMachine[mid] !== undefined) {
        inp.value = savedRow.hoursByMachine[mid] || '';
      }
    });
    updateFixedRowTotal(row);
  });
  updateFixedColumnTotals();
  updateFixedGrandTotal();
}

// ================================
// Helpers de FECHA (LOCAL, NO UTC)
// ================================
export function getTodayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ================================
// SUBMIT GRID PLAN (DEBUG MODE)
// ================================
export async function submitGridPlan(e) {
  if (e) e.preventDefault();

  if (state.plannerPreviewMode) {
    setPlannerLoadedMold(null);
    displayResponse('gridResponse', { message: 'Vista previa cerrada.' }, true);
    return;
  }

  console.clear();
  console.log('========== SUBMIT GRID PLAN ==========');

  // ---------------------------
  // INPUTS PRINCIPALES
  // ---------------------------
  const startDateEl = document.getElementById('gridStartDate');
  const clientNameEl = document.getElementById('planClientName');
  const priorityEl = document.getElementById('prioritySwitch');

  const moldName = getPlannerSelectedMoldName();
  const clientName = String(clientNameEl?.value || '').trim();
  const startDate = startDateEl ? startDateEl.value : '';
  const isPriority = !!priorityEl?.checked;

  console.log('moldName:', moldName);
  console.log('clientName:', clientName);
  console.log('startDate (raw):', startDate);
  console.log('isPriority:', isPriority);

  if (state.plannerLoadedMold && isPriority) {
    displayResponse('gridResponse', 'En modo edición no se permite PRIORIDAD (para no borrar/reprogramar trabajo ya completado). Desmarca Prioridad o sal de edición.', false);
    return;
  }

  if (!moldName) {
    displayResponse('gridResponse', 'Selecciona un Molde.', false);
    return;
  }

  // ---------------------------
  // VALIDACIÓN DE FECHA
  // ---------------------------
  const todayLocal = getTodayISO();

  console.log('todayLocal:', todayLocal);
  console.log('Comparación startDate < todayLocal:', startDate < todayLocal);

  if (!isPriority) {
    if (!startDate) {
      displayResponse('gridResponse', 'Selecciona una Fecha de inicio.', false);
      return;
    }
    if (startDate < todayLocal) {
      displayResponse('gridResponse', `Fecha pasada detectada\nstartDate=${startDate}\ntoday=${todayLocal}`, false);
      return;
    }

    const laborable = await isDateLaborable(startDate);
    console.log('laborable:', laborable);

    if (!laborable) {
      displayResponse('gridResponse', 'La fecha seleccionada no es laborable.', false);
      return;
    }
  } else if (startDate) {
    if (startDate < todayLocal) {
      displayResponse('gridResponse', `Fecha pasada detectada (priority)\nstartDate=${startDate}\ntoday=${todayLocal}`, false);
      return;
    }

    const laborable = await isDateLaborable(startDate);
    console.log('laborable (priority):', laborable);

    if (!laborable) {
      displayResponse('gridResponse', 'La fecha seleccionada no es laborable.', false);
      return;
    }
  }

  // ---------------------------
  // GRID
  // ---------------------------
  const grid = document.getElementById('planningGridFixed');
  if (!grid) {
    displayResponse('gridResponse', 'La parrilla no está lista.', false);
    return;
  }

  // ---------------------------
  // CONSTRUCCIÓN DE TASKS
  // ---------------------------
  const allowDisabledInputs = Boolean(state.plannerLoadedMold) || Boolean(isPriority);
  const tasks = [];

  grid.querySelectorAll('tbody tr').forEach(row => {
    const partName = row.getAttribute('data-part-name');
    if (!partName) return;

    const qtyEl = row.querySelector('.qty-input');
    // En modo edición/reprogramación, los inputs pueden estar deshabilitados (marcados en verde)
    // pero aun así representan la planificación vigente; debemos poder moverla de fecha.
    if (qtyEl && qtyEl.disabled && !allowDisabledInputs) return;

    const qty = parseLocaleNumber(qtyEl?.value);
    if (isNaN(qty) || qty <= 0) return;

    row.querySelectorAll('.hours-input').forEach(inp => {
      if (inp.disabled && !allowDisabledInputs) return;
      const base = parseLocaleNumber(inp.value);
      if (isNaN(base) || base <= 0) return;

      const machineId = inp.getAttribute('data-machine-id');
      const machinesForPlan = (state.plannerMachinesInGrid && state.plannerMachinesInGrid.length)
        ? state.plannerMachinesInGrid
        : (state.FIXED_MACHINES || []);
      const machineName =
        machinesForPlan.find(m => String(m.id) === String(machineId))?.name
        || machineId;

  const totalHours = round2(base * qty);

      if (totalHours > 0) {
        tasks.push({ partName, machineName, totalHours });
      }
    });
  });

  console.log('tasks construidas:', tasks);

  if (!tasks.length) {
    displayResponse('gridResponse', 'No hay datos para planificar.', false);
    return;
  }

  // ---------------------------
  // PAYLOAD
  // ---------------------------
  const payload = {
    moldName,
    clientName: clientName || null,
    moldId: state.plannerLoadedMold?.moldId != null ? Number(state.plannerLoadedMold.moldId) : null,
    startDate: startDate || null,
    tasks,
    gridSnapshot: buildPlannerGridSnapshotFromUI()
  };

  console.log('PAYLOAD ENVIADO:', payload);

  const endpoint = isPriority
    ? `${state.API_URL}/tasks/plan/priority`
    : (state.plannerLoadedMold ? `${state.API_URL}/tasks/plan/replace` : `${state.API_URL}/tasks/plan/block`);

  console.log('ENDPOINT:', endpoint);

  const responseBox = document.getElementById('gridResponse');
  if (responseBox) {
    responseBox.textContent = isPriority
      ? 'Reprogramando con prioridad...'
      : 'Enviando planificación...';
  }

  const btn = document.getElementById('submitGridPlanBtn');
  if (btn) btn.disabled = true;

  // ---------------------------
  // FETCH
  // ---------------------------
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    console.log('STATUS:', res.status);
    console.log('RESPUESTA BACKEND:', data);

    // Mostrar un mensaje claro en pantalla (no bloqueante)
    if (res.ok) {
      const msg = data?.message || '✔ Planificación creada';
      displayResponse('gridResponse', msg, true);
    } else {
      const msg = data?.error || '✖ Error al planificar';
      displayResponse('gridResponse', msg, false);
    }

    if (res.ok) {
      console.log('✔ PLANIFICACIÓN OK');
      loadCalendar();
      try { await loadPlannedMoldsList(); } catch (_) {}
    } else {
      console.warn('✖ ERROR BACKEND');
    }

  } catch (err) {
    console.error('ERROR FETCH:', err);
    displayResponse('gridResponse', { error: 'Error al planificar', details: String(err) }, false);
  } finally {
    if (btn) btn.disabled = false;
  }
}



export function initPlannerEvents() {
  const wire = (id, event, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(event, fn); };
  
  wire('planMoldSelect', 'change', () => {
     // No action needed if it just updates state? Wait, usually we'd want to refresh something.
  });
  
  wire('submitGridPlanBtn', 'click', (e) => {
    e.preventDefault();
    submitGridPlan();
  });

  wire('prioritySwitch', 'change', (e) => {
    console.log('Priority changed:', e.target.checked);
    // Usually no action needed, but we ensure the listener is there if we want to add UI feedback
  });

  wire('clearPlannerBtn', 'click', (e) => {
    e.preventDefault();
    if (confirm('¿Limpiar toda la parrilla?')) {
        const grid = document.getElementById('planningGridFixed');
        if (grid) {
            grid.querySelectorAll('input').forEach(i => i.value = '');
            updateFixedColumnTotals();
            updateFixedGrandTotal();
            persistPlannerStateToStorage();
        }
    }
  });

  wire('refreshPlannedMoldsBtn', 'click', () => loadPlannedMoldsList());

  const gridContainer = document.getElementById('planningGridContainer');
  if (gridContainer) {
    gridContainer.addEventListener('input', (e) => {
      if (e.target.classList.contains('qty-input') || e.target.classList.contains('hours-input')) {
        const row = e.target.closest('tr');
        updateFixedRowTotal(row);
        updateFixedColumnTotals();
        updateFixedGrandTotal();
        persistPlannerStateToStorage();
      }
    });
  }

  const plannedList = document.getElementById('plannedMoldsList');
  if (plannedList) {
    plannedList.addEventListener('click', async (ev) => {
      const target = ev.target;
      if (!(target instanceof HTMLElement)) return;
      const item = target.closest('[data-action="loadPlannedMold"][data-mold-id]');
      if (!item) return;

      const moldId = item.getAttribute('data-mold-id');
      const moldName = item.getAttribute('data-mold-name') || '';
      const itemClientName = item.getAttribute('data-client-name') || '';
      const itemStartDate = item.getAttribute('data-start-date') || '';
      if (!moldId) return;

      const responseBox = document.getElementById('gridResponse');
      if (responseBox) responseBox.textContent = 'Cargando planificación del molde en vista previa...';

      try {
        const res = await fetch(`${state.API_URL}/tasks/plan/mold/${encodeURIComponent(moldId)}`, {
          credentials: 'include',
          cache: 'no-store'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          displayResponse('gridResponse', data?.error || 'No se pudo cargar el molde', false);
          return;
        }

        let loadedFromSnapshot = false;
        try {
          let snap = await tryLoadPlannerSnapshot(moldId, null);
          if (!snap) snap = await tryLoadPlannerSnapshot(moldId, itemStartDate || data?.startDate);
          if (snap) {
            loadedFromSnapshot = fillPlannerGridFromSnapshot(snap);
            const startDateEl = document.getElementById('gridStartDate');
            if (startDateEl && snap?.startDate) startDateEl.value = normalizeDateInputValue(snap.startDate) || String(snap.startDate);
          }
        } catch (_) {}

        if (moldName) {
          // state.plannerPendingMoldName = moldName; // Not needed if we select it below
          selectPlannerMoldByName(moldName);
        }
        const startDateEl = document.getElementById('gridStartDate');
        if (!loadedFromSnapshot && startDateEl) {
          const preferred = normalizeDateInputValue(itemStartDate) || normalizeDateInputValue(data?.startDate);
          if (preferred) startDateEl.value = preferred;
        }

        if (!loadedFromSnapshot) {
          fillPlannerGridFromMoldPlanTotals(data);
        }

        try {
          clearPlannerProgressLocks();
          const progress = await fetchMoldProgressDetail(moldId);
          if (progress?.breakdown) {
            applyPlannerProgressLocksFromBreakdown(progress.breakdown);
          }
        } catch (_) {}

        setPlannerLoadedMold({
          moldId: Number(moldId),
          moldName: data?.moldName || moldName,
          clientName: data?.clientName || itemClientName || '',
          startDate: data?.startDate,
          endDate: data?.endDate,
          previewMode: true,
        });

        displayResponse('gridResponse', { message: 'Vista previa abierta.' }, true);
      } catch (e) {
        displayResponse('gridResponse', { error: 'Error de conexión abriendo vista previa', details: String(e) }, false);
      }
    });
  }

  // Hooking up the existing view controls
  wireCompletedMoldsViewControls();
  
  // Wire detail toggles for lists
  const inProgressList = document.getElementById('inProgressMoldList');
  if (inProgressList) wireMoldDetailToggles(inProgressList);
  const completedList = document.getElementById('completedMoldList');
  if (completedList) wireMoldDetailToggles(completedList);

  // Real-time updates
  socket.on('workLog_updated', () => {
    console.log('📢 Evento workLog_updated recibido. Recargando planificador...');
    showToast('Actualización en tiempo real: el planificador se ha refrescado.', true);
    
    // Recargar vistas relevantes
    try { renderInProgressMoldList(); } catch (e) {}
    try { renderCompletedMoldList(); } catch (e) {}
    try { loadCalendar(); } catch (e) {}
  });

  // Reactividad para checkboxes de configuración de parrilla
  const boxes = [
    document.getElementById('plannerMachinesSelected'),
    document.getElementById('plannerMachinesAvailable'),
    document.getElementById('plannerPartsSelected'),
    document.getElementById('plannerPartsAvailable')
  ];
  
  boxes.forEach(box => {
    if (!box) return;
    box.addEventListener('change', (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLInputElement) || t.type !== 'checkbox') return;
      
      let cfg = readPlannerGridConfig();
      if (!cfg) cfg = getDefaultPlannerGridConfig();

      const mid = t.getAttribute('data-planner-machine-id');
      const pname = t.getAttribute('data-planner-part-name');

      if (mid) {
        const id = String(mid);
        const set = new Set((cfg.machineIds || []).map(String));
        if (t.checked) set.add(id); else set.delete(id);
        cfg.machineIds = Array.from(set);
      }

      if (pname != null) {
        const name = String(pname);
        const norm = name.trim().toLowerCase();
        const current = Array.isArray(cfg.partNames) ? cfg.partNames.map(String) : [];
        const next = current.filter(n => String(n).trim().toLowerCase() !== norm);
        if (t.checked) next.push(name);
        cfg.partNames = next;
      }

      // Estas funciones deben ejecutarse para que el cambio sea visual e instantáneo
      writePlannerGridConfig(cfg);
      applyPlannerGridConfig(cfg);
      renderPlannerGridConfigUI(cfg);

      // Repintar la parrilla de abajo preservando datos
      persistPlannerStateToStorage();
      renderFixedPlanningGrid();
      restorePlannerStateFromStorage();
    });
  });
}

export function applyPlannerPreviewMode(enabled) {
  const tab = document.getElementById('tab-plan');
  if (!tab) return;

  const controls = tab.querySelectorAll('input, select, textarea, button');
  if (enabled) {
    controls.forEach((el) => {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el instanceof HTMLButtonElement)) return;
      if (el.id === 'submitGridPlanBtn') return;
      if (el.id === 'exitPlannedMoldEditBtnInline') return;
      if (!el.hasAttribute('data-preview-prev-disabled')) {
        el.setAttribute('data-preview-prev-disabled', el.disabled ? '1' : '0');
      }
      el.disabled = true;
    });
    return;
  }

  tab.querySelectorAll('[data-preview-prev-disabled]').forEach((el) => {
    const prev = String(el.getAttribute('data-preview-prev-disabled') || '0') === '1';
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el instanceof HTMLButtonElement) {
      el.disabled = prev;
    }
    el.removeAttribute('data-preview-prev-disabled');
  });
}

export function normalizeDateInputValue(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '';
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

export function buildPlannerGridSnapshotFromUI() {
  const cfg = readPlannerGridConfig() || null;
  const snap = {
    version: 1,
    moldName: getPlannerSelectedMoldName(),
    clientName: document.getElementById('planClientName')?.value || '',
    startDate: document.getElementById('gridStartDate')?.value || '',
    gridConfig: cfg,
    rows: []
  };

  const grid = document.getElementById('planningGridFixed');
  if (!grid) return snap;

  grid.querySelectorAll('tbody tr').forEach(row => {
    const partName = String(row.getAttribute('data-part-name') || '').trim();
    if (!partName) return;
    const qty = row.querySelector('.qty-input')?.value || '';
    const hoursByMachine = {};
    row.querySelectorAll('.hours-input').forEach(inp => {
      const mid = inp.getAttribute('data-machine-id');
      if (!mid) return;
      hoursByMachine[String(mid)] = inp.value || '';
    });
    snap.rows.push({ partName, qty, hoursByMachine });
  });

  return snap;
}

export async function tryLoadPlannerSnapshot(moldId, startDate) {
  if (!moldId) return null;
  const qs = new URLSearchParams({ moldId: String(moldId) });
  if (startDate) qs.set('startDate', String(startDate));
  const res = await fetch(`${state.API_URL}/tasks/plan/snapshot?${qs.toString()}`, {
    credentials: 'include',
    cache: 'no-store'
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  let snap = data?.snapshot ?? null;
  if (typeof snap === 'string') {
    try { snap = JSON.parse(snap); } catch (_) {}
  }
  if (snap && data?.startDate) {
    try { snap.startDate = String(data.startDate); } catch (_) {}
  }
  return snap || null;
}

export function applyPlannerGridConfigFromSnapshot(gridConfig) {
  if (!gridConfig) return;
  try {
    writePlannerGridConfig(gridConfig);
    applyPlannerGridConfig(gridConfig);
    renderPlannerGridConfigUI(gridConfig);
    renderFixedPlanningGrid();
  } catch (_) {}
}

export function fillPlannerGridFromSnapshot(snapshot) {
  if (!snapshot) return false;

  const gridConfig = snapshot.gridConfig || null;
  const clientNameEl = document.getElementById('planClientName');
  if (clientNameEl) clientNameEl.value = String(snapshot.clientName || '');
  if (gridConfig) {
    applyPlannerGridConfigFromSnapshot(gridConfig);
  }

  const grid = document.getElementById('planningGridFixed');
  if (!grid) return false;

  const byPart = new Map();
  (snapshot.rows || []).forEach(r => {
    const partName = String(r?.partName || '').trim();
    if (!partName) return;
    byPart.set(partName.toLowerCase(), r);
  });

  // Limpiar primero
  grid.querySelectorAll('tbody tr').forEach(row => {
    const qtyInput = row.querySelector('.qty-input');
    if (qtyInput) qtyInput.value = '';
    row.querySelectorAll('.hours-input').forEach(inp => { inp.value = ''; });
    updateFixedRowTotal(row);
  });

  grid.querySelectorAll('tbody tr').forEach(row => {
    const partName = String(row.getAttribute('data-part-name') || '').trim();
    if (!partName) return;
    const saved = byPart.get(partName.toLowerCase());
    if (!saved) return;

    const qtyInput = row.querySelector('.qty-input');
    if (qtyInput) qtyInput.value = saved.qty || '';

    row.querySelectorAll('.hours-input').forEach(inp => {
      const mid = String(inp.getAttribute('data-machine-id') || '');
      if (!mid) return;
      const v = saved.hoursByMachine?.[mid];
      if (v !== undefined) inp.value = v || '';
    });

    updateFixedRowTotal(row);
  });

  updateFixedColumnTotals();
  updateFixedGrandTotal();
  persistPlannerStateToStorage();
  return true;
}

export function readPlannerGridConfig() {
  try {
    const raw = localStorage.getItem(state.LS_KEYS.plannerGridConfig);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    if (!cfg || typeof cfg !== 'object') return null;
    const machineIds = Array.isArray(cfg.machineIds) ? cfg.machineIds.map(v => String(v)) : [];
    const partNames = Array.isArray(cfg.partNames) ? cfg.partNames.map(v => String(v)) : [];
    return { machineIds, partNames };
  } catch { return null; }
}

export function writePlannerGridConfig(cfg) {
  try { localStorage.setItem(state.LS_KEYS.plannerGridConfig, JSON.stringify(cfg)); } catch { }
}

export function getDefaultPlannerGridConfig() {
  const fixedMachineNames = new Set((state.FIXED_MACHINES || []).map(m => String(m.name || '').trim().toLowerCase()));
  const fixedPartNames = new Set((state.FIXED_PARTS || []).map(p => String(p || '').trim().toLowerCase()));

  const machines = Array.isArray(state.plannerCatalogMachines) ? state.plannerCatalogMachines : [];
  const parts = Array.isArray(state.plannerCatalogParts) ? state.plannerCatalogParts : [];

  let machineIds = machines
    .filter(m => fixedMachineNames.has(String(m.name || '').trim().toLowerCase()))
    .slice(0, 20)
    .map(m => String(m.id));
  if (!machineIds.length) machineIds = machines.slice(0, 10).map(m => String(m.id));

  let partNames = parts
    .filter(p => fixedPartNames.has(String(p.name || '').trim().toLowerCase()))
    .slice(0, 80)
    .map(p => String(p.name));
  if (!partNames.length) partNames = parts.slice(0, 50).map(p => String(p.name));

  return { machineIds, partNames };
}

export function applyPlannerGridConfig(cfg) {
  const machines = Array.isArray(state.plannerCatalogMachines) ? state.plannerCatalogMachines : [];
  const parts = Array.isArray(state.plannerCatalogParts) ? state.plannerCatalogParts : [];

  const machineIdSet = new Set((cfg?.machineIds || []).map(v => String(v)));
  const partNameSet = new Set((cfg?.partNames || []).map(v => String(v).trim().toLowerCase()));

  state.plannerMachinesInGrid = machines.filter(m => machineIdSet.has(String(m.id)));
  state.plannerPartsInGrid = parts
    .filter(p => partNameSet.has(String(p.name || '').trim().toLowerCase()))
    .map(p => ({ name: p.name }));

  if (!state.plannerMachinesInGrid.length) state.plannerMachinesInGrid = (state.FIXED_MACHINES || []).map(m => ({ id: m.id, name: m.name, daily_capacity: null, hoursAvailable: m.hoursAvailable }));
  if (!state.plannerPartsInGrid.length) state.plannerPartsInGrid = (state.FIXED_PARTS || []).map(name => ({ name }));
}

export function renderPlannerGridConfigUI(cfg) {
  const selectedMachinesEl = document.getElementById('plannerMachinesSelected');
  const availableMachinesEl = document.getElementById('plannerMachinesAvailable');
  const selectedPartsEl = document.getElementById('plannerPartsSelected');
  const availablePartsEl = document.getElementById('plannerPartsAvailable');

  if (!selectedMachinesEl || !availableMachinesEl || !selectedPartsEl || !availablePartsEl) return;

  const machineIdSet = new Set((cfg?.machineIds || []).map(v => String(v)));
  const partNameSet = new Set((cfg?.partNames || []).map(v => String(v).trim().toLowerCase()));

  const machines = (Array.isArray(state.plannerCatalogMachines) && state.plannerCatalogMachines.length)
    ? state.plannerCatalogMachines
    : (state.FIXED_MACHINES || []).map(m => ({ id: m.id, name: m.name, daily_capacity: null, is_active: true }));
  const parts = (Array.isArray(state.plannerCatalogParts) && state.plannerCatalogParts.length)
    ? state.plannerCatalogParts
    : (state.FIXED_PARTS || []).map(name => ({ id: name, name, is_active: true }));

  const selMachines = machines.filter(m => machineIdSet.has(String(m.id)));
  const availMachines = machines.filter(m => !machineIdSet.has(String(m.id)));

  const renderMachineItem = (m, checked) => {
    const cap = m.daily_capacity != null && m.daily_capacity !== '' ? ` (${Number(m.daily_capacity)}h/día)` : '';
    return `<label style="display:flex; gap:8px; align-items:center; margin:4px 0;">
      <input type="checkbox" data-planner-machine-id="${escapeHtml(String(m.id))}" ${checked ? 'checked' : ''}>
      <span>${escapeHtml(m.name || '')}${escapeHtml(cap)}</span>
    </label>`;
  };

  selectedMachinesEl.innerHTML = selMachines.length
    ? selMachines.map(m => renderMachineItem(m, true)).join('')
    : '<div style="color:#6c757d">(ninguna)</div>';
  availableMachinesEl.innerHTML = availMachines.length
    ? availMachines.map(m => renderMachineItem(m, false)).join('')
    : '<div style="color:#6c757d">(sin máquinas)</div>';

  const selParts = parts.filter(p => partNameSet.has(String(p.name || '').trim().toLowerCase()));
  const availParts = parts.filter(p => !partNameSet.has(String(p.name || '').trim().toLowerCase()));
  const renderPartItem = (p, checked) => {
    return `<label style="display:flex; gap:8px; align-items:center; margin:4px 0;">
      <input type="checkbox" data-planner-part-name="${escapeHtml(String(p.name || ''))}" ${checked ? 'checked' : ''}>
      <span>${escapeHtml(p.name || '')}</span>
    </label>`;
  };

  selectedPartsEl.innerHTML = selParts.length
    ? selParts.map(p => renderPartItem(p, true)).join('')
    : '<div style="color:#6c757d">(ninguna)</div>';
  availablePartsEl.innerHTML = availParts.length
    ? availParts.map(p => renderPartItem(p, false)).join('')
    : '<div style="color:#6c757d">(sin partes)</div>';
}

export async function initPlannerGridFromCatalogs() {
  try {
    const res = await fetch(`${state.API_URL}/catalogs/meta`, { credentials: 'include' });
    if (res.ok) {
      const meta = await res.json();
      state.plannerCatalogMachines = Array.isArray(meta.machines) ? meta.machines : [];
      state.plannerCatalogParts = Array.isArray(meta.parts) ? meta.parts : [];
    }
  } catch (_) { }

  let cfg = readPlannerGridConfig();
  if (!cfg) {
    cfg = getDefaultPlannerGridConfig();
    writePlannerGridConfig(cfg);
  } else {
    const mset = new Set((state.plannerCatalogMachines || []).map(m => String(m.id)));
    const pset = new Set((state.plannerCatalogParts || []).map(p => String(p.name || '').trim().toLowerCase()));

    const beforeMachines = Array.isArray(cfg.machineIds) ? cfg.machineIds.map(String) : [];
    const beforeParts = Array.isArray(cfg.partNames) ? cfg.partNames.map(String) : [];

    const nextMachines = mset.size
      ? beforeMachines.filter(id => mset.has(String(id)))
      : beforeMachines;
    const nextParts = pset.size
      ? beforeParts.filter(n => pset.has(String(n).trim().toLowerCase()))
      : beforeParts;

    const changed = nextMachines.join('|') !== beforeMachines.join('|') || nextParts.join('|') !== beforeParts.join('|');
    cfg.machineIds = nextMachines;
    cfg.partNames = nextParts;
    if (changed) writePlannerGridConfig(cfg);
  }

  const defaults = getDefaultPlannerGridConfig();
  const hadMachines = Array.isArray(cfg.machineIds) && cfg.machineIds.length > 0;
  const hadParts = Array.isArray(cfg.partNames) && cfg.partNames.length > 0;
  if (!hadMachines || !hadParts) {
    cfg.machineIds = hadMachines ? cfg.machineIds : defaults.machineIds;
    cfg.partNames = hadParts ? cfg.partNames : defaults.partNames;
    writePlannerGridConfig(cfg);
  }

  applyPlannerGridConfig(cfg);
  renderPlannerGridConfigUI(cfg);
}

export async function isDateLaborable(dateStr) {
  try {
    const qs = new URLSearchParams();
    qs.set('date', String(dateStr || ''));
    const res = await fetch(`${state.API_URL}/working/check?${qs.toString()}`, {
      credentials: 'include',
      cache: 'no-store'
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.laborable;
  } catch { return false; }
}

export function clearPlannerGrid() {
  const grid = document.getElementById('planningGridFixed');
  if (!grid) return;
  grid.querySelectorAll('.qty-input').forEach(inp => { inp.value = ''; });
  grid.querySelectorAll('.hours-input').forEach(inp => { inp.value = ''; });
  grid.querySelectorAll('tbody tr').forEach(row => updateFixedRowTotal(row));
  updateFixedColumnTotals();
  updateFixedGrandTotal();
  setPlannerLoadedMold(null);
  try { localStorage.removeItem(state.LS_KEYS.plannerState); } catch { }
  displayResponse('gridResponse', { message: 'Parrilla limpiada' }, true);
}

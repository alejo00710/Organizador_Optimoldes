import { state, hasAdminPrivileges } from '../core/state.js';
import * as api from '../core/api.js';
import { showToast, displayResponse, escapeHtml, round2, capitalize, fmtDateOnly, formatDateDisplay, parseUiDateToISO, fmtDateTime, parseLocaleNumber, formatTimeHM, hoursToPayload, formatNumberCOP } from '../ui/ui.js';
import { safeCssEscape } from './planner.js';
import { getBogotaTodayISO } from './calendar.js';

// ── Module-level cache variables ──────────────────────────────────────────────
let tiemposMetaCache = null;
let tiemposPlanMonthCache = new Map();
let tiemposPlanListenersBound = false;

window._tiemposMetaCache = null; // Debug global

export function getTiemposSelectedYMD() {
  const diaSel = document.getElementById('tmDia');
  const mesSel = document.getElementById('tmMes');
  const anioSel = document.getElementById('tmAnio');
  const day = diaSel ? parseInt(diaSel.value, 10) : NaN;
  const mes = mesSel ? (mesSel.value || '').toLowerCase() : '';
  const year = anioSel ? parseInt(anioSel.value, 10) : NaN;
  const monthNo = monthNameToNumber(mes);
  return { year, monthNo, day };
}

export async function fetchTiemposPlannedMonth(year, monthNo) {
  if (!year || !monthNo) return null;
  const key = `${String(year).padStart(4, '0')}-${String(monthNo).padStart(2, '0')}`;
  if (tiemposPlanMonthCache.has(key)) return tiemposPlanMonthCache.get(key);

  try {
    const data = await api.fetchCalendarMonthView(year, monthNo);
    const events = data?.events || {};
    tiemposPlanMonthCache.set(key, events);
    return events;
  } catch (e) {
    return null;
  }
}

export function uniqueIdName(items) {
  const m = new Map();
  (items || []).forEach(it => {
    const id = it?.id;
    if (id == null) return;
    if (!m.has(String(id))) m.set(String(id), { id: Number(id), name: String(it?.name || '') });
  });
  return Array.from(m.values()).sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
}

export function setDatalistValues(dlId, values) {
  const dl = document.getElementById(dlId);
  if (!dl) return;
  dl.innerHTML = (values || []).map(v => `<option value="${escapeHtml(v)}">`).join('');
}

export function uniqueStrings(values) {
  const out = new Map();
  (values || []).forEach(v => {
    const s = String(v || '').trim();
    if (!s) return;
    const key = s.toLowerCase();
    if (!out.has(key)) out.set(key, s);
  });
  return Array.from(out.values()).sort((a, b) => String(a).localeCompare(String(b), 'es'));
}

export function normStr(v) {
  return String(v || '').trim().toLowerCase();
}

export function getWorkLogRowSelectedYMD(row) {
  const dateRaw = String(row?.querySelector('.wl-date')?.value || '').trim();
  const dateIso = parseUiDateToISO(dateRaw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    const [year, monthNo, day] = dateIso.split('-').map(Number);
    return { year, monthNo, day };
  }

  const day = parseInt(row?.querySelector('.wl-dia')?.value, 10);
  const mesLabel = String(row?.querySelector('.wl-mes')?.value || '');
  const year = parseInt(row?.querySelector('.wl-anio')?.value, 10);
  const monthNo = monthNameToNumber(normStr(mesLabel));
  return { year, monthNo, day };
}

export async function refreshWorkLogPlannedOptionsForRow(row) {
  if (!row || !state.currentUser) return;

  // Asegurar meta para poder “volver” a listas completas cuando no haya plan.
  if (!tiemposMetaCache) {
    try { await loadTiemposMeta(); } catch (_) {}
  }

  const { year, monthNo, day } = getWorkLogRowSelectedYMD(row);
  if (!year || !monthNo || !day || day < 1 || day > 31) {
    try { ensureWorkLogsMeta(); } catch (_) {}
    return;
  }

  let events = null;
  try {
    events = await fetchTiemposPlannedMonth(year, monthNo);
  } catch (_) {
    events = null;
  }

  const tasks = (events && events[String(day)] && Array.isArray(events[String(day)].tasks))
    ? events[String(day)].tasks
    : [];

  const plannedCell = row.querySelector('td.wl-planned');
  const deviationCell = row.querySelector('td.wl-deviation');
  const hoursInput = row.querySelector('input.wl-hours');

  const updateDeviationUI = (plannedHours) => {
    try {
      const realHours = hoursInput ? Number(hoursInput.value) : NaN;
      if (!Number.isFinite(plannedHours) || plannedHours <= 0 || !Number.isFinite(realHours)) {
        if (deviationCell) deviationCell.textContent = '';
        // No tocamos la clase de alerta si no hay plan válido
        return;
      }
      const diff = realHours - plannedHours;
      const pct = (diff / plannedHours) * 100;
      const sign = pct > 0.0000001 ? '+' : '';
      if (deviationCell) deviationCell.textContent = `${sign}${pct.toFixed(2)}%`;

      const isAlert = Math.abs(diff / plannedHours) > 0.05;
      row.classList.toggle('wl-alert', !!isAlert);
    } catch (_) {}
  };

  // Si no hay planificación para el día, dejamos los catálogos completos.
  if (!tasks.length) {
    try { ensureWorkLogsMeta(); } catch (_) {}
    if (plannedCell) plannedCell.textContent = '';
    updateDeviationUI(NaN);
    return;
  }

  const moldInput = row.querySelector('.wl-molde');
  const partInput = row.querySelector('.wl-parte');
  const machineInput = row.querySelector('.wl-maquina');

  const selectedMold = normStr(moldInput?.value);
  const selectedPart = normStr(partInput?.value);
  const selectedMachine = normStr(machineInput?.value);

  const molds = uniqueStrings(tasks.map(t => t?.mold).filter(Boolean));
  setDatalistValues('wlMoldes', molds);

  const partsForDay = tasks
    .filter(t => !selectedMold || normStr(t?.mold) === selectedMold)
    .map(t => t?.part)
    .filter(Boolean);
  setDatalistValues('wlPartes', uniqueStrings(partsForDay));

  const machinesForDay = tasks
    .filter(t => (!selectedMold || normStr(t?.mold) === selectedMold) && (!selectedPart || normStr(t?.part) === selectedPart))
    .map(t => t?.machine)
    .filter(Boolean);
  setDatalistValues('wlMaquinas', uniqueStrings(machinesForDay));

  // Horas planificadas del día para la combinación seleccionada.
  // Nota: en Registros se editan nombres (no IDs), así que igualamos por nombre.
  const plannedHours = tasks
    .filter(t => (!selectedMold || normStr(t?.mold) === selectedMold)
      && (!selectedPart || normStr(t?.part) === selectedPart)
      && (!selectedMachine || normStr(t?.machine) === selectedMachine))
    .reduce((acc, t) => acc + (Number(t?.hours) || 0), 0);

  if (plannedCell) {
    plannedCell.textContent = plannedHours > 0 ? Number(plannedHours).toFixed(2) : '';
  }
  updateDeviationUI(plannedHours > 0 ? plannedHours : NaN);
}

export function scheduleWorkLogPlannedRefresh(row) {
  if (!row) return;
  try { clearTimeout(row._wlPlannedRefreshTimer); } catch (_) {}
  row._wlPlannedRefreshTimer = setTimeout(() => {
    refreshWorkLogPlannedOptionsForRow(row);
  }, 200);
}

export function bindWorkLogPlannedListeners(row) {
  if (!row) return;
  if (row.dataset.wlPlannedBound === '1') return;
  row.dataset.wlPlannedBound = '1';

  const dateEl = row.querySelector('.wl-date');
  const diaEl = row.querySelector('.wl-dia');
  const mesEl = row.querySelector('.wl-mes');
  const anioEl = row.querySelector('.wl-anio');
  const moldEl = row.querySelector('.wl-molde');
  const partEl = row.querySelector('.wl-parte');
  const machineEl = row.querySelector('.wl-maquina');
  const hoursEl = row.querySelector('.wl-hours');

  if (dateEl) dateEl.addEventListener('input', () => scheduleWorkLogPlannedRefresh(row));
  if (diaEl) diaEl.addEventListener('input', () => scheduleWorkLogPlannedRefresh(row));
  if (mesEl) mesEl.addEventListener('change', () => scheduleWorkLogPlannedRefresh(row));
  if (anioEl) anioEl.addEventListener('input', () => scheduleWorkLogPlannedRefresh(row));

  // Dependencias: al cambiar molde, refrescar partes/máquinas; al cambiar parte, refrescar máquinas.
  if (moldEl) moldEl.addEventListener('input', () => scheduleWorkLogPlannedRefresh(row));
  if (partEl) partEl.addEventListener('input', () => scheduleWorkLogPlannedRefresh(row));
  if (machineEl) machineEl.addEventListener('input', () => scheduleWorkLogPlannedRefresh(row));
  if (hoursEl) hoursEl.addEventListener('input', () => scheduleWorkLogPlannedRefresh(row));
}

export async function refreshTiemposPlannedOptions() { return; }
async function _refreshTiemposPlannedOptions_DEPRECATED() {
  const { year, monthNo, day } = getTiemposSelectedYMD();
  const moldeSel = document.getElementById('tmMoldeSelect');
  const parteSel = document.getElementById('tmParteSelect');
  const maquinaSel = document.getElementById('tmMaquinaSelect');

  if (!moldeSel || !parteSel || !maquinaSel) return;

  // Guardar selección actual
  const prevMoldId = moldeSel.selectedOptions.length ? String(moldeSel.selectedOptions[0].value) : '';
  const prevPartId = parteSel.selectedOptions.length ? String(parteSel.selectedOptions[0].value) : '';
  const prevMachineId = maquinaSel.selectedOptions.length ? String(maquinaSel.selectedOptions[0].value) : '';

  // Limpiar si fecha inválida
  if (!year || !monthNo || !day || day < 1 || day > 31) {
    populateSelectWithFilterObjects('tmMoldeSelect', 'tmMoldeFilter', [], 'name');
    populateSelectWithFilterObjects('tmParteSelect', 'tmParteFilter', [], 'name');
    populateSelectWithFilterObjects('tmMaquinaSelect', 'tmMaquinaFilter', [], 'name');
    setupFilterListenerObjects('tmMaquinaFilter', 'tmMaquinaSelect', 'name');
    return;
  }

  let events = null;
  try {
    events = await fetchTiemposPlannedMonth(year, monthNo);
  } catch (_) {
    events = null;
  }

  const tasks = (events && events[String(day)] && Array.isArray(events[String(day)].tasks))
    ? events[String(day)].tasks
    : [];

  // Moldes planificados del día
  const molds = uniqueIdName(tasks.map(t => ({ id: t.moldId, name: t.mold })));
  populateSelectWithFilterObjects('tmMoldeSelect', 'tmMoldeFilter', molds, 'name');
  setupFilterListenerObjects('tmMoldeFilter', 'tmMoldeSelect', 'name');

  // Reaplicar selección de molde si sigue vigente
  if (prevMoldId && molds.some(m => String(m.id) === prevMoldId)) {
    moldeSel.value = prevMoldId;
  }

  // Partes dependen del molde
  const selectedMoldId = moldeSel.selectedOptions.length ? String(moldeSel.selectedOptions[0].value) : '';
  const parts = uniqueIdName(tasks
    .filter(t => selectedMoldId && String(t.moldId) === selectedMoldId)
    .map(t => ({ id: t.partId, name: t.part })));
  populateSelectWithFilterObjects('tmParteSelect', 'tmParteFilter', parts, 'name');
  setupFilterListenerObjects('tmParteFilter', 'tmParteSelect', 'name');

  if (prevPartId && parts.some(p => String(p.id) === prevPartId)) {
    parteSel.value = prevPartId;
  }

  // Máquinas dependen de molde + parte
  const selectedPartId = parteSel.selectedOptions.length ? String(parteSel.selectedOptions[0].value) : '';
  const machines = uniqueIdName(tasks
    .filter(t => selectedMoldId && selectedPartId && String(t.moldId) === selectedMoldId && String(t.partId) === selectedPartId)
    .map(t => ({ id: t.machineId, name: t.machine })));
  populateSelectWithFilterObjects('tmMaquinaSelect', 'tmMaquinaFilter', machines, 'name');
  setupFilterListenerObjects('tmMaquinaFilter', 'tmMaquinaSelect', 'name');

  if (prevMachineId && machines.some(m => String(m.id) === prevMachineId)) {
    maquinaSel.value = prevMachineId;
  }
}

export function bindTiemposPlannedListeners() {
  if (tiemposPlanListenersBound) return;
  tiemposPlanListenersBound = true;

  const diaSel = document.getElementById('tmDia');
  const mesSel = document.getElementById('tmMes');
  const anioSel = document.getElementById('tmAnio');
  const moldeSel = document.getElementById('tmMoldeSelect');
  const parteSel = document.getElementById('tmParteSelect');
  const maquinaSel = document.getElementById('tmMaquinaSelect');

  [diaSel, mesSel, anioSel].forEach(el => {
    if (!el) return;
    el.addEventListener('change', () => {
      // Si cambia el mes/año, invalida cache sólo si quieres forzar; por ahora cache por key.
      refreshTiemposPlannedOptions();
    });
  });

  if (moldeSel) {
    moldeSel.addEventListener('change', () => {
      // Al cambiar molde, NO reseteamos máquina ni filtramos, permitimos selección libre.
      if (parteSel) parteSel.value = '';
      refreshTiemposPlannedOptions();
    });
  }
  if (parteSel) {
    parteSel.addEventListener('change', () => {
      refreshTiemposPlannedOptions();
    });
  }
}

export function populateDayMonthYear(daySelectId, monthSelectId, yearSelectId) {
  const daySel = document.getElementById(daySelectId);
  const monthSel = document.getElementById(monthSelectId);
  const yearSel = document.getElementById(yearSelectId);

  // Defaults basados en Colombia para evitar desfaces por TZ del PC
  let currentYearLocal;
  let currentMonthIdx;
  let currentDay;
  try {
    const iso = typeof getColombiaTodayISO === 'function' ? getColombiaTodayISO() : '';
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const [yy, mm, dd] = iso.split('-').map(Number);
      currentYearLocal = yy;
      currentMonthIdx = mm - 1;
      currentDay = dd;
    }
  } catch { }
  if (!currentYearLocal || currentMonthIdx == null || !currentDay) {
    const now = new Date();
    currentDay = now.getDate();
    currentMonthIdx = now.getMonth();
    currentYearLocal = now.getFullYear();
  }

  if (daySel && !daySel.options.length) {
    daySel.innerHTML = Array.from({ length: 31 }, (_, i) => {
      const d = i + 1;
      return `<option value="${d}">${d}</option>`;
    }).join('');
  }

  if (monthSel && !monthSel.options.length) {
    monthSel.innerHTML = state.monthNames.map(m => `<option value="${m}">${capitalize(m)}</option>`).join('');
  }

  if (yearSel && !yearSel.options.length) {
    const minYear = 2016;
    const maxYear = currentYearLocal + 2;
    yearSel.innerHTML = Array.from({ length: (maxYear - minYear + 1) }, (_, i) => {
      const y = minYear + i;
      return `<option value="${y}">${y}</option>`;
    }).join('');
  }

  // Set defaults if not selected
  if (daySel && !daySel.value) daySel.value = String(currentDay);
  if (monthSel && !monthSel.value) monthSel.value = String(state.monthNames[currentMonthIdx] || '');
  if (yearSel && !yearSel.value) yearSel.value = String(currentYearLocal);
}

export function setTiemposDateToColombiaToday() {
  const iso = typeof getColombiaTodayISO === 'function' ? getColombiaTodayISO() : '';
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
  const [yy, mm, dd] = iso.split('-').map(Number);
  if (!yy || !mm || !dd) return;

  const daySel = document.getElementById('tmDia');
  const monthSel = document.getElementById('tmMes');
  const yearSel = document.getElementById('tmAnio');
  if (daySel) daySel.value = String(dd);
  if (monthSel) monthSel.value = String(state.monthNames[mm - 1] || '');
  if (yearSel) yearSel.value = String(yy);
}

export function monthNameToNumber(mesLower){
  const idx = state.monthNames.indexOf(String(mesLower || '').toLowerCase().trim());
  return idx >= 0 ? (idx + 1) : 0;
}

export function toISODate(y, m, d){
  const yy = String(y).padStart(4, '0');
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function findByName(items, name){
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return (Array.isArray(items) ? items : []).find(x => String(x?.name || '').trim().toLowerCase() === n) || null;
}

export function populateSelectWithFilterObjects(selectId, filterInputId, items, labelKey){
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const arr = Array.isArray(items) ? items : [];
  sel.dataset.allItems = JSON.stringify(arr);
  sel.innerHTML = arr.map(it => `<option value="${it.id}">${escapeHtml(it[labelKey] || it.name || '')}</option>`).join('');
  sel.selectedIndex = -1;
  const filterInput = document.getElementById(filterInputId);
  if (filterInput) filterInput.value = '';
}

export function setupFilterListenerObjects(filterInputId, selectId, labelKey){
  const input = document.getElementById(filterInputId);
  const sel = document.getElementById(selectId);
  if (!input || !sel) return;
  if (input.dataset.bound === '1') return;
  input.dataset.bound = '1';
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    const all = JSON.parse(sel.dataset.allItems || '[]');
    const filtered = q ? all.filter(it => String(it[labelKey] || it.name || '').toLowerCase().includes(q)) : all;
    sel.innerHTML = filtered.map(it => `<option value="${it.id}">${escapeHtml(it[labelKey] || it.name || '')}</option>`).join('');
    sel.selectedIndex = -1;
  });
}

export async function loadTiemposMeta(){
  if (!state.currentUser) return;
  try {
    const res = await fetch(`${state.API_URL}/catalogs/meta`, { credentials: 'include' });
    if (!res.ok) return;
    const meta = await res.json();
    tiemposMetaCache = meta;
    window._tiemposMetaCache = meta; // Sync global

    // Día / Mes / Año: no dependen de BD, pero el año puede enriquecerse con meta.years
    populateDayMonthYear('tmDia', 'tmMes', 'tmAnio');
    const tmAnioSel = document.getElementById('tmAnio');
    if (tmAnioSel) {
      const base = []; for (let y = 2016; y <= (new Date().getFullYear() + 2); y++) base.push(y);
      const merged = Array.from(new Set([...(meta.years || []), ...base])).sort((a, b) => b - a);
      tmAnioSel.innerHTML = merged.map(y => `<option value="${y}">${y}</option>`).join('');
    }

    // Por defecto hoy (Colombia), pero sigue siendo editable.
    setTiemposDateToColombiaToday();

    // Operario: si el usuario es operario, fijamos el campo al operario logueado.
    fillDatalist('tmOperarios', (meta.operators || []).map(o => o.name));
    try {
      const tmOperarioEl = document.getElementById('tmOperario');
      const isOperator = String(state.currentUser?.role || '').toLowerCase() === 'operator';
      if (tmOperarioEl) {
        if (isOperator) {
          tmOperarioEl.value = String(state.currentUser?.operatorName || '').trim();
          tmOperarioEl.disabled = true;
        } else {
          tmOperarioEl.disabled = false;
        }
      }
    } catch (_) {}

    fillDatalist('tmProcesos', (meta.processes || []).map(p => p.name));
    fillDatalist('tmOperaciones', (meta.operations || []).map(o => o.name));

    // En Tiempos, Molde/Parte/Máquina salen de catálogos (BD), no de lo planificado.
    try {
      const molds = uniqueIdName(meta.molds || []);
      const parts = uniqueIdName(meta.parts || []);
      const machines = uniqueIdName(meta.machines || []);
      populateSelectWithFilterObjects('tmMoldeSelect', 'tmMoldeFilter', molds, 'name');
      populateSelectWithFilterObjects('tmParteSelect', 'tmParteFilter', parts, 'name');
      populateSelectWithFilterObjects('tmMaquinaSelect', 'tmMaquinaFilter', machines, 'name');
      setupFilterListenerObjects('tmMoldeFilter', 'tmMoldeSelect', 'name');
      setupFilterListenerObjects('tmParteFilter', 'tmParteSelect', 'name');
      setupFilterListenerObjects('tmMaquinaFilter', 'tmMaquinaSelect', 'name');
    } catch (_) {}

    // Iniciar / refrescar el wizard con los datos cargados
  } catch (e) {
    console.error('[WorkLogs] Error in loadTiemposMeta:', e);
  } finally {
    initTiemposWizard(tiemposMetaCache || {});
  }
}

// ================================
// WIZARD TIEMPOS — controlador UI
// ================================
let _wzInitialized = false;
let _wzMeta = null; // last meta used to populate cards

// Module-level wizard state — persists across tab switches
const wz = {
  step: 1,
  operatorId: null,
  operatorName: '',
  moldId: null,
  moldName: '',
  partId: null,
  partName: '',
  machineId: null,
  machineName: '',
  proceso: '',
  operacion: '',
  horas: null,
  motivo: '',
  isFinal: false,
};

export function initTiemposWizard(meta) {
  _wzMeta = meta;

  // ---- helpers ----
  const $ = id => document.getElementById(id);
  const monthNames = state.monthNames || [];

  function setStep(n) {
    wz.step = n;
    // Update panels
    [1, 2, 3, 4].forEach(i => {
      const p = $(`wzPanel${i}`);
      if (!p) return;
      p.classList.toggle('wz-panel--hidden', i !== n);
    });
    // Update stepper
    document.querySelectorAll('#wzStepper .wz-step').forEach(el => {
      const s = Number(el.getAttribute('data-wz-step'));
      el.classList.remove('wz-step--active', 'wz-step--done', 'wz-step--pending');
      if (s < n) el.classList.add('wz-step--done');
      else if (s === n) el.classList.add('wz-step--active');
      else el.classList.add('wz-step--pending');
    });
    // Scroll to top of wizard
    const shell = $('wzShell');
    if (shell) shell.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function selectCard(grid, id) {
    grid.querySelectorAll('.wz-item-card').forEach(c => {
      c.classList.toggle('wz-item-card--selected', c.dataset.id === String(id));
    });
  }

  function buildCards(containerId, items, onSelect) {
    const grid = $(containerId);
    if (!grid) return;
    if (!items || !items.length) {
      grid.innerHTML = `<div class="wz-empty-state">Sin datos disponibles</div>`;
      return;
    }
    grid.innerHTML = items.map(it => `
      <div class="wz-item-card" data-id="${it.id}" role="button" tabindex="0">
        <div class="wz-item-card__name">${escapeHtml(it.name || '')}</div>
        <div class="wz-item-card__sub">${escapeHtml(it.sub || '')}</div>
      </div>
    `).join('');
    grid.querySelectorAll('.wz-item-card').forEach(card => {
      const activate = () => {
        const id = card.dataset.id;
        selectCard(grid, id);
        onSelect(id, card.querySelector('.wz-item-card__name')?.textContent || '');
      };
      card.addEventListener('click', activate);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') activate(); });
    });
  }

  // ---- Sync hidden inputs (bridge to saveTiempoMolde) ----
  function syncHiddenInputs() {
    // Operario
    const opEl = $('tmOperario');
    if (opEl) { opEl.value = wz.operatorName; }
    const opIdEl = document.getElementById('wzOperatorIdHidden');
    if (opIdEl && wz.operatorId != null) opIdEl.value = String(wz.operatorId);

    // Proceso (uses wz.proceso)
    const prEl = $('tmProceso');
    if (prEl) prEl.value = wz.proceso;
    // Date
    const wzDia = $('wzDia'), wzMes = $('wzMes'), wzAnio = $('wzAnio');
    if (wzDia && wzMes && wzAnio) {
      const tmDia = $('tmDia'), tmMes = $('tmMes'), tmAnio = $('tmAnio');
      if (tmDia) tmDia.value = wzDia.value;
      if (tmMes) tmMes.value = wzMes.value;
      if (tmAnio) tmAnio.value = wzAnio.value;
    }
    // Molde
    const moldeSelect = $('tmMoldeSelect');
    if (moldeSelect && wz.moldId != null) {
      const opt = moldeSelect.querySelector(`option[value="${wz.moldId}"]`);
      if (opt) opt.selected = true; else moldeSelect.selectedIndex = -1;
    }
    // Parte
    const parteSelect = $('tmParteSelect');
    if (parteSelect && wz.partId != null) {
      const opt = parteSelect.querySelector(`option[value="${wz.partId}"]`);
      if (opt) opt.selected = true; else parteSelect.selectedIndex = -1;
    }
    // Maquina
    const maqSelect = $('tmMaquinaSelect');
    if (maqSelect && wz.machineId != null) {
      const opt = maqSelect.querySelector(`option[value="${wz.machineId}"]`);
      if (opt) opt.selected = true; else maqSelect.selectedIndex = -1;
    }
    // Operacion
    const opEl2 = $('tmOperacion');
    if (opEl2) opEl2.value = wz.operacion;
    // Horas — write to dedicated hidden input for saveTiempoMolde to read
    const wzHorasHiddenEl = document.getElementById('wzHorasHidden');
    if (wzHorasHiddenEl && wz.horas != null) wzHorasHiddenEl.value = String(wz.horas);

    // Motivo
    const motivoEl = $('tmMotivo');
    if (motivoEl) motivoEl.value = wz.motivo;
    // isFinalLog
    const finalEl = $('tmIsFinalLog');
    if (finalEl) finalEl.checked = wz.isFinal;
  }

  // ---- STEP 1: Operator grid ----
  function initStep1() {
    const isOperator = String(state.currentUser?.role || '').toLowerCase() === 'operator';
    let operators = [];
    if (isOperator) {
      operators = [{ id: state.currentUser?.operatorId, name: state.currentUser?.operatorName || 'Yo', sub: 'Tu sesión activa' }];
      wz.operatorId = operators[0].id;
      wz.operatorName = operators[0].name;
    } else {
      operators = (_wzMeta?.operators || []).map(o => ({ id: o.id, name: o.name, sub: o.shift || '' }));
    }

    buildCards('wzOperatorGrid', operators, (id, name) => {
      wz.operatorId = id;
      wz.operatorName = name;
      // Also sync the text input if visible
      const wzOpText = $('wzOperatorText');
      if (wzOpText) wzOpText.value = name;
    });

    // Show text input fallback when no operators in DB (admin filling manually)
    const wzOpTextWrap = $('wzOperatorTextWrap');
    const noOperators = !isOperator && operators.length === 0;
    if (wzOpTextWrap) wzOpTextWrap.style.display = noOperators ? '' : 'none';

    // Pre-select if single operator (operator role)
    if (isOperator && operators.length === 1) {
      const grid = $('wzOperatorGrid');
      if (grid) selectCard(grid, operators[0].id);
    }

    // Date selects — always repopulate to ensure they are filled
    const now = new Date();
    const wzDia = $('wzDia'), wzMes = $('wzMes'), wzAnio = $('wzAnio');
    // Always fill (not conditional on empty)
    if (wzDia) {
      wzDia.innerHTML = Array.from({ length: 31 }, (_, i) => `<option value="${i+1}">${i+1}</option>`).join('');
    }
    if (wzMes) {
      wzMes.innerHTML = monthNames.map(m => `<option value="${m}">${capitalize(m)}</option>`).join('');
    }
    if (wzAnio) {
      const base = []; for (let y = 2016; y <= now.getFullYear() + 2; y++) base.push(y);
      const merged = Array.from(new Set([...(_wzMeta?.years || []), ...base])).sort((a, b) => b - a);
      wzAnio.innerHTML = merged.map(y => `<option value="${y}">${y}</option>`).join('');
    }
    // Set defaults to today
    try {
      const iso = (typeof getBogotaTodayISO === 'function' ? getBogotaTodayISO() : '') || '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        const [yy, mm, dd] = iso.split('-').map(Number);
        if (wzDia) wzDia.value = String(dd);
        if (wzMes) wzMes.value = monthNames[mm - 1] || '';
        if (wzAnio) wzAnio.value = String(yy);
      } else {
        if (wzDia) wzDia.value = String(now.getDate());
        if (wzMes) wzMes.value = monthNames[now.getMonth()] || '';
        if (wzAnio) wzAnio.value = String(now.getFullYear());
      }
    } catch (_) {}

    // Populate wzProcesos / wzOperaciones datalists
    const wzProcEl = $('wzProcesos');
    if (wzProcEl) wzProcEl.innerHTML = (_wzMeta?.processes || []).map(p => `<option value="${escapeHtml(p.name)}">`).join('');
    const wzOpEl = $('wzOperaciones');
    if (wzOpEl) wzOpEl.innerHTML = (_wzMeta?.operations || []).map(o => `<option value="${escapeHtml(o.name)}">`).join('');
  }

  // ---- STEP 2: Mold & part grid ----
  function buildMoldGrid() {
    // Use active molds from in-progress OR from meta
    const molds = uniqueIdName(_wzMeta?.molds || []).map(m => ({ ...m, sub: `M-${m.id}` }));
    buildCards('wzMoldGrid', molds, (id, name) => {
      wz.moldId = Number(id);
      wz.moldName = name;
      // Reveal parts
      buildPartGrid(Number(id));
      const partSection = $('wzPartSection');
      if (partSection) partSection.classList.remove('wz-part-section--hidden');
    });
    // Re-select if already chosen
    if (wz.moldId) selectCard($('wzMoldGrid'), wz.moldId);
  }

  function buildPartGrid(moldId) {
    const allParts = uniqueIdName(_wzMeta?.parts || []).map(p => ({ ...p, sub: '' }));
    buildCards('wzPartGrid', allParts, (id, name) => {
      wz.partId = Number(id);
      wz.partName = name;
      // Reveal machines
      buildMachineGrid();
      const machineSection = $('wzMachineSection');
      if (machineSection) machineSection.classList.remove('wz-part-section--hidden');
    });
    if (wz.partId) selectCard($('wzPartGrid'), wz.partId);
  }

  function buildMachineGrid() {
    const machines = uniqueIdName(_wzMeta?.machines || []).map(m => ({ ...m, sub: '' }));
    buildCards('wzMachineGrid', machines, (id, name) => {
      wz.machineId = Number(id);
      wz.machineName = name;
    });
    if (wz.machineId) selectCard($('wzMachineGrid'), wz.machineId);
  }

  // ---- STEP 3: Hours grid ----
  function initStep3() {
    const wzFinalToggle = $('wzFinalToggle');
    const wzWrapper = $('wzFinalToggleWrapper');

    if (wzFinalToggle && !wzFinalToggle.dataset.wzBound) {
      wzFinalToggle.dataset.wzBound = '1';
      wzFinalToggle.addEventListener('click', () => {
        wz.isFinal = !wz.isFinal;
        wzFinalToggle.setAttribute('aria-checked', String(wz.isFinal));
        if (wzWrapper) wzWrapper.classList.toggle('wz-final-toggle--active', wz.isFinal);
      });
    }

    const hoursInput = $('wzHoursInput');
    if (hoursInput && !hoursInput.dataset.wzBound) {
      hoursInput.dataset.wzBound = '1';
      hoursInput.addEventListener('input', () => {
        const val = parseFloat(hoursInput.value);
        wz.horas = isNaN(val) ? null : val;
      });
    }

    if (wz.horas != null && hoursInput) {
      hoursInput.value = wz.horas;
    }
  }

  // ---- STEP 4: Summary ----
  function fillSummary() {
    const wzDia = $('wzDia'), wzMes = $('wzMes'), wzAnio = $('wzAnio');
    const dia = wzDia?.value || '—';
    const mes = wzMes?.value ? capitalize(wzMes.value) : '—';
    const anio = wzAnio?.value || '—';
    const wzProc = $('wzProceso'), wzOper = $('wzOperacion');
    wz.proceso = wzProc?.value?.trim() || '';
    wz.operacion = wzOper?.value?.trim() || '';
    const wzMotEl = $('wzMotivo');
    wz.motivo = wzMotEl?.value?.trim() || '';

    const set = (id, val) => { const el = $(id); if (el) el.textContent = val || '—'; };
    set('wzsOperario', wz.operatorName);
    set('wzsFecha', `${dia} de ${mes} de ${anio}`);
    set('wzsMolde', wz.moldName);
    set('wzsParte', wz.partName);
    set('wzsMaquina', wz.machineName);
    set('wzsProceso', wz.proceso);
    set('wzsOperacion', wz.operacion);
    set('wzsHoras', wz.horas != null ? `${wz.horas}h` : '—');
    set('wzsMotivo', wz.motivo || '(ninguno)');
    set('wzsFinal', wz.isFinal ? '✓ Sí — cierre definitivo' : 'No');

    syncHiddenInputs();
  }

  // ---- Validation ----
  function validateStep(n) {
    if (n === 1) {
      // Accept operator from card selection OR from text fallback input
      const wzOpText = $('wzOperatorText');
      if (wzOpText && wzOpText.value.trim()) {
        wz.operatorName = wzOpText.value.trim();
        // operatorId stays null — saveTiempoMolde will do name-based lookup
      }
      if (!wz.operatorName.trim()) {
        showToast('Selecciona o escribe el nombre del operario', false);
        return false;
      }
      const wzDia = $('wzDia'), wzMes = $('wzMes'), wzAnio = $('wzAnio');
      if (!wzDia?.value || !wzMes?.value || !wzAnio?.value) { showToast('Completa la fecha', false); return false; }
      return true;
    }
    if (n === 2) {
      if (!wz.moldId) { showToast('Selecciona un molde', false); return false; }
      if (!wz.partId) { showToast('Selecciona una parte', false); return false; }
      if (!wz.machineId) { showToast('Selecciona una máquina', false); return false; }
      const wzProc = $('wzProceso'), wzOper = $('wzOperacion');
      if (!wzProc?.value?.trim()) { showToast('Escribe el proceso', false); return false; }
      if (!wzOper?.value?.trim()) { showToast('Escribe la operación', false); return false; }
      return true;
    }
    if (n === 3) {
      const hoursInput = $('wzHoursInput');
      if (hoursInput) {
        const val = parseFloat(hoursInput.value);
        wz.horas = isNaN(val) ? null : val;
      }
      if (wz.horas == null || wz.horas <= 0) { showToast('Ingresa las horas trabajadas', false); return false; }
      return true;
    }
    return true;
  }

  // ---- Wire navigation buttons (only once) ----
  if (!_wzInitialized) {
    _wzInitialized = true;

    const wire = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };

    wire('wzNext1', () => { if (validateStep(1)) { setStep(2); buildMoldGrid(); } });
    wire('wzBack2', () => setStep(1));
    wire('wzNext2', () => { if (validateStep(2)) { setStep(3); initStep3(); } });
    wire('wzBack3', () => setStep(2));
    wire('wzNext3', () => { if (validateStep(3)) { setStep(4); fillSummary(); } });
    wire('wzBack4', () => setStep(3));

    // Guardar: sync then call existing saveTiempoMolde
    const saveBtn = $('tmGuardarBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        fillSummary(); // ensure sync
        const resp = $('tmResponse');
        if (resp) { resp.textContent = ''; resp.className = 'response-box hidden'; }
        await saveTiempoMolde();
        // Reset wizard on success (check if tmResponse shows no error)
        setTimeout(() => {
          const hasError = resp && resp.classList.contains('error');
          if (!hasError) {
            Object.assign(wz, { step: 1, operatorId: null, operatorName: '', moldId: null, moldName: '', partId: null, partName: '', machineId: null, machineName: '', proceso: '', operacion: '', horas: null, motivo: '', isFinal: false });
            const wzFinalToggle = $('wzFinalToggle');
            if (wzFinalToggle) { wzFinalToggle.setAttribute('aria-checked', 'false'); }
            const wzWrapper = $('wzFinalToggleWrapper');
            if (wzWrapper) wzWrapper.classList.remove('wz-final-toggle--active');
            const wzMotEl = $('wzMotivo');
            if (wzMotEl) wzMotEl.value = '';
            const wzHH = document.getElementById('wzHorasHidden');
            if (wzHH) wzHH.value = '';

            setStep(1);
            initStep1();
          }
        }, 600);
      });
    }
  }

  // ---- Init current step ----
  initStep1();
  setStep(wz.step);
}

export async function saveTiempoMolde() {
  const diaSel = document.getElementById('tmDia');
  const mesSel = document.getElementById('tmMes');
  const anioSel = document.getElementById('tmAnio');
  const dia = diaSel ? parseInt(diaSel.value, 10) : NaN;
  const mes = mesSel ? (mesSel.value || '').toLowerCase() : '';
  const anio = anioSel ? parseInt(anioSel.value, 10) : NaN;

  const isOperator = String(state.currentUser?.role || '').toLowerCase() === 'operator';
  const operario = isOperator
    ? String(state.currentUser?.operatorName || '').trim()
    : (document.getElementById('tmOperario') ? document.getElementById('tmOperario').value : '');
  const proceso = document.getElementById('tmProceso') ? document.getElementById('tmProceso').value : '';

  const moldeSel = document.getElementById('tmMoldeSelect');
  const parteSel = document.getElementById('tmParteSelect');
  const maquinaSel = document.getElementById('tmMaquinaSelect');
  const moldId = moldeSel && moldeSel.selectedOptions.length ? parseInt(moldeSel.selectedOptions[0].value, 10) : NaN;
  const partId = parteSel && parteSel.selectedOptions.length ? parseInt(parteSel.selectedOptions[0].value, 10) : NaN;
  const machineId = maquinaSel && maquinaSel.selectedOptions.length ? parseInt(maquinaSel.selectedOptions[0].value, 10) : NaN;
  const operacion = document.getElementById('tmOperacion') ? document.getElementById('tmOperacion').value : '';
  const motivo = document.getElementById('tmMotivo') ? document.getElementById('tmMotivo').value : '';
  const horasEl = document.getElementById('tmHoras');
  // Wizard populates #wzHorasHidden; fall back to select for non-wizard path
  const horasHidden = document.getElementById('wzHorasHidden');
  const horas = horasHidden && horasHidden.value
    ? parseLocaleNumber(horasHidden.value)
    : (horasEl ? parseLocaleNumber(horasEl.value) : NaN);


  if (isNaN(dia) || !mes || isNaN(anio) || !operario || !proceso || isNaN(moldId) || isNaN(partId) || isNaN(machineId) || !operacion || isNaN(horas)) {
    return displayResponse('tmResponse', { error: 'Completa todos los campos' }, false);
  }

  const meta = tiemposMetaCache || {};
  // Prefer wizard's direct operator ID if present
  const wzOpIdEl = document.getElementById('wzOperatorIdHidden');
  const wzOpIdRaw = wzOpIdEl ? Number(wzOpIdEl.value) : NaN;
  const operatorId = Number.isFinite(wzOpIdRaw) && wzOpIdRaw > 0
    ? wzOpIdRaw
    : (isOperator
      ? Number(state.currentUser?.operatorId)
      : Number(findByName(meta.operators, operario)?.id));


  if (!Number.isFinite(operatorId) || operatorId <= 0) {
    return displayResponse('tmResponse', { error: 'Operario inválido' }, false);
  }

  const monthNo = monthNameToNumber(mes);
  if (!monthNo) return displayResponse('tmResponse', { error: 'Mes inválido' }, false);
  const work_date = toISODate(anio, monthNo, dia);

  const resolvePlanningIdForWorkLog = async ({ year, monthNo, day, moldId, partId, machineId }) => {
    if (!Number.isInteger(year) || !Number.isInteger(monthNo) || monthNo < 1 || monthNo > 12) {
      return { planningId: null, error: 'No existe planificación activa para este molde' };
    }

    let eventsByDay = null;
    const monthState = state.calendarMonthState || {};
    if (Number(monthState.year) === Number(year) && Number(monthState.month) === Number(monthNo - 1)) {
      const monthData = monthState.monthData;
      eventsByDay = (monthData && typeof monthData === 'object' && monthData.events && typeof monthData.events === 'object')
        ? monthData.events
        : null;
    }

    if (!eventsByDay) {
      try {
        eventsByDay = await fetchTiemposPlannedMonth(year, monthNo);
      } catch (_) {
        eventsByDay = null;
      }
    }

    if (!eventsByDay || typeof eventsByDay !== 'object') {
      return { planningId: null, error: 'No existe planificación activa para este molde' };
    }

    const dayKey = String(Number(day));
    const dayTasks = Array.isArray(eventsByDay?.[dayKey]?.tasks)
      ? eventsByDay[dayKey].tasks
      : [];

    const planningIdsFromDay = Array.from(new Set(
      dayTasks
        .filter(t => Number(t?.moldId) === Number(moldId)
          && Number(t?.partId) === Number(partId)
          && Number(t?.machineId) === Number(machineId))
        .map(t => Number(t?.planningId))
        .filter(pid => Number.isFinite(pid) && pid > 0)
    ));

    if (planningIdsFromDay.length === 1) {
      return { planningId: planningIdsFromDay[0], error: null };
    }
    if (planningIdsFromDay.length > 1) {
      return { planningId: null, error: 'Inconsistencia detectada: múltiples planning_id para la misma combinación seleccionada en el día' };
    }

    // Fallback: si no hay celda planificada en el día, usar la planificación activa del molde.
    try {
      const asOf = getBogotaTodayISO && getBogotaTodayISO();
      const url = asOf ? `${state.API_URL}/molds/in-progress?asOf=${encodeURIComponent(asOf)}` : `${state.API_URL}/molds/in-progress`;
      const res = await fetch(url, {
        credentials: 'include',
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const molds = Array.isArray(data?.molds) ? data.molds : [];
        const active = molds.find(m => Number(m?.moldId) === Number(moldId));
        const planningId = Number(active?.planning?.planningId || active?.planningId || 0);
        if (Number.isFinite(planningId) && planningId > 0) {
          return { planningId, error: null };
        }
      }
    } catch (_) {
      // Si falla la consulta, devolvemos el error de negocio estándar.
    }

    return { planningId: null, error: 'No existe planificación activa para este molde' };
  };

  const planning = await resolvePlanningIdForWorkLog({ year: anio, monthNo, day: dia, moldId, partId, machineId });
  if (!planning?.planningId) {
    return displayResponse('tmResponse', { error: planning?.error || 'No existe planificación activa para este molde' }, false);
  }

  const payload = {
    moldId,
    partId,
    machineId,
    planning_id: planning.planningId,
    operatorId,
    work_date,
    hours_worked: round2(horas),
    is_final_log: !!(document.getElementById('tmIsFinalLog')?.checked),
    reason: String(motivo || '').trim() || null,
    note: `Proceso: ${proceso} | Operación: ${operacion}`
  };

  try {
    const res = await fetch(`${state.API_URL}/work_logs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
    const data = await res.json();
    displayResponse('tmResponse', data, res.ok);
    if (res.ok) {
      const motivoEl = document.getElementById('tmMotivo');
      if (motivoEl) motivoEl.value = '';
      const finalEl = document.getElementById('tmIsFinalLog');
      if (finalEl) finalEl.checked = false;
      loadTiemposMeta();
    }
  } catch (e) {
    displayResponse('tmResponse', { error: 'Error de conexión' }, false);
  }
}

// ================================
// Registros (historial editable de work_logs)
// ================================

let workLogsHistoryCache = [];
let workLogsFilters = {}; // key -> Set(normalized) | null
let workLogsFilterUiBound = false;
let workLogsActivePopover = null; // { key, anchorEl }

const WORKLOG_FILTERS = [
  { key: 'fecha', label: 'Fecha' },
  { key: 'operario', label: 'Operario' },
  { key: 'proceso', label: 'Proceso' },
  { key: 'molde', label: 'Molde' },
  { key: 'parte', label: 'Parte' },
  { key: 'maquina', label: 'Máquina' },
  { key: 'operacion', label: 'Operación' },
  { key: 'motivo', label: 'Detalle' },
];

export function normalizeFilterValue(v) {
  const s = String(v ?? '').trim();
  return s === '' ? '(vacío)' : s.toLowerCase();
}

export function parseProcesoOperacion(note) {
  const out = { proceso: '', operacion: '' };
  const s = String(note || '');
  const mProc = s.match(/Proceso:\s*([^|]+?)(\s*\||$)/i);
  const mOper = s.match(/Operaci[oó]n:\s*(.+)$/i);
  if (mProc && mProc[1]) out.proceso = String(mProc[1]).trim();
  if (mOper && mOper[1]) out.operacion = String(mOper[1]).trim();
  return out;
}

export function getWorkLogDerivedForFilters(r) {
  const workDateIso = r?.work_date || (r?.recorded_at ? fmtDateOnly(r.recorded_at) : '');
  const po = parseProcesoOperacion(r?.note);
  return {
    fecha: formatDateDisplay(workDateIso),
    operario: String(r?.operator_name || ''),
    proceso: String(po.proceso || ''),
    molde: String(r?.mold_name || ''),
    parte: String(r?.part_name || ''),
    maquina: String(r?.machine_name || ''),
    operacion: String(po.operacion || ''),
    motivo: String(r?.reason || ''),
  };
}

export function getWorkLogRowValueFromDom(tr, key) {
  if (!tr) return '';
  const getVal = (sel) => String(tr.querySelector(sel)?.value ?? '').trim();
  switch (key) {
    case 'fecha': return getVal('input.wl-date');
    case 'operario': return getVal('input.wl-operario');
    case 'proceso': return getVal('input.wl-proceso');
    case 'molde': return getVal('input.wl-molde');
    case 'parte': return getVal('input.wl-parte');
    case 'maquina': return getVal('input.wl-maquina');
    case 'operacion': return getVal('input.wl-operacion');
    case 'motivo': return getVal('input.wl-reason');
    default: return '';
  }
}

export function getDistinctFilterOptionsFromCache(key) {
  const seen = new Map(); // normalized -> display
  for (const r of workLogsHistoryCache) {
    const d = getWorkLogDerivedForFilters(r);
    const display = String(d[key] ?? '').trim();
    const norm = normalizeFilterValue(display);
    if (!seen.has(norm)) seen.set(norm, display === '' ? '(Vacío)' : display);
  }
  // Orden: (Vacío) primero, luego alfabético
  const items = Array.from(seen.entries()).map(([norm, display]) => ({ norm, display }));
  items.sort((a, b) => {
    if (a.norm === '(vacío)' && b.norm !== '(vacío)') return -1;
    if (b.norm === '(vacío)' && a.norm !== '(vacío)') return 1;
    return a.display.localeCompare(b.display, 'es', { sensitivity: 'base' });
  });
  return items;
}

export function updateWorkLogsFilterButtons() {
  const bar = document.getElementById('workLogsFiltersBar');
  if (!bar) return;
  bar.querySelectorAll('button[data-wl-filter-key]').forEach(btn => {
    const key = String(btn.getAttribute('data-wl-filter-key') || '');
    const meta = WORKLOG_FILTERS.find(x => x.key === key);
    if (!meta) return;
    const options = getDistinctFilterOptionsFromCache(key);
    const selected = workLogsFilters[key];
    const isFiltered = selected && selected.size > 0 && selected.size < options.length;
    btn.textContent = isFiltered ? `${meta.label} (${selected.size})` : meta.label;
    btn.classList.toggle('btn-primary', isFiltered);
    btn.classList.toggle('btn-secondary', !isFiltered);
  });
}

export function applyWorkLogsFiltersToDom() {
  const tbody = document.querySelector('#workLogsTable tbody');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr[data-id]'));
  let shown = 0;
  let totalHours = 0;
  for (const tr of rows) {
    let ok = true;
    for (const f of WORKLOG_FILTERS) {
      const selected = workLogsFilters[f.key];
      if (!selected || selected.size === 0) continue;
      const raw = getWorkLogRowValueFromDom(tr, f.key);
      const norm = normalizeFilterValue(raw);
      if (!selected.has(norm)) { ok = false; break; }
    }
    tr.style.display = ok ? '' : 'none';
    const detailTr = tbody.querySelector(`tr[data-detail-for="${safeCssEscape(String(tr.getAttribute('data-id') || ''))}"]`);
    if (detailTr) {
      if (!ok) {
        detailTr.style.display = 'none';
      } else {
        const expanded = tr.getAttribute('data-expanded') === '1';
        detailTr.style.display = expanded ? '' : 'none';
      }
    }
    if (ok) {
      shown += 1;
      const h = parseLocaleNumber(tr.querySelector('input.wl-hours')?.value);
      if (Number.isFinite(h)) totalHours += h;
    }
  }
  updateWorkLogsFilterButtons();
  const totalEl = document.getElementById('workLogsTotalHours');
  if (totalEl) totalEl.textContent = formatNumberCOP(totalHours, 2);
  displayResponse('workLogsResponse', { total: workLogsHistoryCache.length, visibles: shown, horas_reales_visibles: formatNumberCOP(totalHours, 2) }, true);
}

export function ensureWorkLogsTotalsLiveUpdate() {
  const tbody = document.querySelector('#workLogsTable tbody');
  if (!tbody) return;
  if (tbody.dataset.wlTotalsBound === '1') return;
  tbody.dataset.wlTotalsBound = '1';
  tbody.addEventListener('input', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains('wl-hours')) return;
    // Recalcular (solo 200 filas típicamente; suficiente).
    try { applyWorkLogsFiltersToDom(); } catch (_) {}
  });
}

export function hideWorkLogsFilterPopover() {
  const pop = document.getElementById('workLogsFilterPopover');
  if (pop) pop.style.display = 'none';
  pop && (pop.innerHTML = '');
  workLogsActivePopover = null;
}

export function showWorkLogsFilterPopover(key, anchorEl) {
  const pop = document.getElementById('workLogsFilterPopover');
  if (!pop) return;
  const options = getDistinctFilterOptionsFromCache(key);
  const selected = workLogsFilters[key] ? new Set(workLogsFilters[key]) : null;

  const meta = WORKLOG_FILTERS.find(x => x.key === key);
  const title = meta ? meta.label : key;

  // Posicionar relativo al botón (simple): insertamos el popover justo debajo de la barra.
  pop.style.display = '';
  pop.innerHTML = `
    <div style="margin-top:10px; border:1px solid var(--border-color); background: var(--card-bg); border-radius:10px; padding:10px; max-width: 720px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <div style="font-weight:800;">Filtrar: ${escapeHtml(title)}</div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn btn-secondary" id="wlFilterSelectAllBtn">Todos</button>
          <button class="btn btn-secondary" id="wlFilterSelectNoneBtn">Ninguno</button>
          <button class="btn btn-danger" id="wlFilterCloseBtn">Cerrar</button>
        </div>
      </div>
      <div style="margin-top:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <input type="text" id="wlFilterSearch" placeholder="Buscar..." style="min-width:220px;">
        <button class="btn btn-primary" id="wlFilterApplyBtn">Aplicar</button>
        <span class="text-muted" id="wlFilterCount" style="font-size:0.9rem;"></span>
      </div>
      <div id="wlFilterOptions" style="margin-top:10px; display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:6px; max-height: 260px; overflow:auto;"></div>
    </div>
  `;

  const optionsEl = document.getElementById('wlFilterOptions');
  const searchEl = document.getElementById('wlFilterSearch');
  const countEl = document.getElementById('wlFilterCount');

  function isChecked(norm) {
    if (!selected) return true; // sin filtro => todos seleccionados
    return selected.has(norm);
  }

  function renderOptions() {
    const q = String(searchEl?.value || '').toLowerCase().trim();
    const filtered = q
      ? options.filter(o => o.display.toLowerCase().includes(q) || o.norm.includes(q))
      : options;
    if (optionsEl) {
      optionsEl.innerHTML = filtered.map(o => `
        <label style="display:flex; gap:8px; align-items:center; padding:6px 8px; border:1px solid var(--border-color); border-radius:8px;">
          <input type="checkbox" class="wl-filter-opt" value="${escapeHtml(o.norm)}" ${isChecked(o.norm) ? 'checked' : ''}>
          <span title="${escapeHtml(o.display)}" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(o.display)}</span>
        </label>
      `).join('');
    }
    const checkedCount = (() => {
      if (!selected) return options.length;
      return selected.size;
    })();
    if (countEl) countEl.textContent = `${checkedCount} de ${options.length}`;
  }

  function readSelectionFromDom() {
    const boxes = Array.from(pop.querySelectorAll('input.wl-filter-opt'));
    const next = new Set();
    for (const b of boxes) {
      if (b.checked) next.add(String(b.value));
    }
    return next;
  }

  function setAll(checked) {
    pop.querySelectorAll('input.wl-filter-opt').forEach(cb => { cb.checked = checked; });
    const next = readSelectionFromDom();
    if (countEl) countEl.textContent = `${next.size} de ${options.length}`;
  }

  // Bind
  const closeBtn = document.getElementById('wlFilterCloseBtn');
  if (closeBtn) closeBtn.onclick = () => hideWorkLogsFilterPopover();
  const allBtn = document.getElementById('wlFilterSelectAllBtn');
  if (allBtn) allBtn.onclick = () => setAll(true);
  const noneBtn = document.getElementById('wlFilterSelectNoneBtn');
  if (noneBtn) noneBtn.onclick = () => setAll(false);
  const applyBtn = document.getElementById('wlFilterApplyBtn');
  if (applyBtn) applyBtn.onclick = () => {
    const next = readSelectionFromDom();
    // Si están todos seleccionados, se considera sin filtro.
    if (next.size === options.length) {
      workLogsFilters[key] = null;
    } else {
      workLogsFilters[key] = next;
    }
    hideWorkLogsFilterPopover();
    applyWorkLogsFiltersToDom();
  };
  if (searchEl) searchEl.oninput = () => renderOptions();

  renderOptions();
  workLogsActivePopover = { key, anchorEl };
}

export function ensureWorkLogsFiltersUi() {
  if (workLogsFilterUiBound) return;
  const bar = document.getElementById('workLogsFiltersBar');
  const clearBtn = document.getElementById('workLogsClearFiltersBtn');
  const pop = document.getElementById('workLogsFilterPopover');
  if (!bar || !clearBtn || !pop) return;

  bar.innerHTML = WORKLOG_FILTERS.map(f => {
    return `<button class="btn btn-secondary" data-wl-filter-key="${escapeHtml(f.key)}">${escapeHtml(f.label)}</button>`;
  }).join('');

  bar.querySelectorAll('button[data-wl-filter-key]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const key = String(btn.getAttribute('data-wl-filter-key') || '');
      if (!key) return;
      // Toggle mismo filtro
      if (workLogsActivePopover?.key === key) {
        hideWorkLogsFilterPopover();
        return;
      }
      showWorkLogsFilterPopover(key, btn);
    });
  });

  clearBtn.onclick = () => {
    workLogsFilters = {};
    hideWorkLogsFilterPopover();
    applyWorkLogsFiltersToDom();
  };

  // Cerrar popover si se hace click fuera del panel
  document.addEventListener('click', (e) => {
    const target = e.target;
    const popEl = document.getElementById('workLogsFilterPopover');
    const barEl = document.getElementById('workLogsFiltersBar');
    if (!popEl || !barEl) return;
    if (popEl.style.display === 'none') return;
    if (popEl.contains(target) || barEl.contains(target) || target === clearBtn) return;
    hideWorkLogsFilterPopover();
  });

  workLogsFilterUiBound = true;
}

export async function loadWorkLogsHistory(reset = true) {
  const tbody = document.querySelector('#workLogsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="13" class="text-muted">Cargando...</td></tr>';

  try {
    const res = await fetch(`${state.API_URL}/work_logs?limit=200&offset=0`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="13" class="text-muted">Error cargando registros</td></tr>';
      return displayResponse('workLogsResponse', data, false);
    }
    workLogsHistoryCache = Array.isArray(data) ? data : [];
    renderWorkLogsTable(workLogsHistoryCache);
    try { ensureWorkLogsFiltersUi(); } catch (_) {}
    try { ensureWorkLogsTotalsLiveUpdate(); } catch (_) {}
    try { applyWorkLogsFiltersToDom(); } catch (_) {}
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="13" class="text-muted">Error de conexión</td></tr>';
    displayResponse('workLogsResponse', { error: 'Error de conexión', details: String(e) }, false);
  }
}

// Extracted fmtDateTime to ui.js

// Extracted parseISODateOnlyLocal to ui.js

// Extracted fmtDateOnly to ui.js

// Extracted formatDateDisplay to ui.js

// Extracted parseUiDateToISO to ui.js

// Extracted formatTimeHM to ui.js

export function getColombiaTodayISO() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    if (!y || !m || !d) return '';
    return `${y}-${m}-${d}`;
  } catch {
    return '';
  }
}

export function daysDiffFromColombiaToday(dateStr) {
  try {
    const baseStr = String(dateStr || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(baseStr)) return 9999;
    const todayStr = getColombiaTodayISO();
    if (!todayStr) return 9999;

    const [ty, tm, td] = todayStr.split('-').map(Number);
    const [by, bm, bd] = baseStr.split('-').map(Number);
    const todayUtc = Date.UTC(ty, tm - 1, td);
    const baseUtc = Date.UTC(by, bm - 1, bd);
    return Math.floor((todayUtc - baseUtc) / (1000 * 60 * 60 * 24));
  } catch {
    return 9999;
  }
}

export function isWeekendISO(dateISO) {
  try {
    const s = String(dateISO || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    // Mediodía UTC evita corrimientos de día por zona horaria.
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const day = dt.getUTCDay();
    return day === 0 || day === 6;
  } catch {
    return false;
  }
}

export function isWorkingDayISO(dateISO) {
  const s = String(dateISO || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;

  // Overrides explícitos (si existen) tienen prioridad sobre fin de semana/festivo.
  if (Object.prototype.hasOwnProperty.call(state.calendarWorkingOverridesCache || {}, s)) {
    return Boolean(state.calendarWorkingOverridesCache[s]);
  }

  const isHoliday = Object.prototype.hasOwnProperty.call(state.calendarHolidaysCache || {}, s);
  if (isHoliday) return false;
  if (isWeekendISO(s)) return false;
  return true;
}

// Cuenta días hábiles INCLUSIVO desde la fecha del registro hasta hoy (hora Colombia).
// Ej: registro Jue 5 y hoy Lun 9 => hábiles = (5,6,9) => 3.
export function businessDaysElapsedInclusiveFromColombiaToday(dateStr) {
  try {
    const baseStr = String(dateStr || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(baseStr)) return 9999;
    const todayStr = getColombiaTodayISO();
    if (!todayStr) return 9999;

    const [by, bm, bd] = baseStr.split('-').map(Number);
    const [ty, tm, td] = todayStr.split('-').map(Number);
    const start = Date.UTC(by, bm - 1, bd, 12, 0, 0);
    const end = Date.UTC(ty, tm - 1, td, 12, 0, 0);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 9999;
    if (start > end) return 0;

    const DAY_MS = 24 * 60 * 60 * 1000;
    let count = 0;
    for (let t = start; t <= end; t += DAY_MS) {
      const iso = new Date(t).toISOString().slice(0, 10);
      if (isWorkingDayISO(iso)) count += 1;
    }
    return count;
  } catch {
    return 9999;
  }
}

export function setWorkLogRowEditing(row, enabled, role) {
  if (!row) return;
  const isOperator = String(role || '').toLowerCase() === 'operator';
  const detailRow = getWorkLogDetailRow(row);

  row.querySelectorAll('input, select').forEach(el => {
    // Campos siempre no editables
    if (el.classList.contains('wl-operario') && isOperator) {
      el.disabled = true;
      return;
    }
    // Operarios no pueden cambiar el cierre manual (solo admins/jefe)
    if (el.classList.contains('wl-is-final') && isOperator) {
      el.disabled = true;
      return;
    }
    // Evitar tocar inputs fuera de la fila
    el.disabled = !enabled;
  });

  const editBtn = detailRow ? detailRow.querySelector('button.wl-edit') : row.querySelector('button.wl-edit');
  const saveBtn = detailRow ? detailRow.querySelector('button.wl-save') : row.querySelector('button.wl-save');
  if (editBtn) editBtn.style.display = enabled ? 'none' : '';
  if (saveBtn) saveBtn.style.display = enabled ? '' : 'none';

  if (detailRow) {
    row.setAttribute('data-expanded', '1');
    detailRow.style.display = '';
    const moreBtn = row.querySelector('button.more-btn');
    if (moreBtn) moreBtn.setAttribute('aria-expanded', 'true');
  }

  // Al editar, adaptar sugerencias de Molde/Parte/Máquina al día seleccionado.
  if (enabled) {
    try { bindWorkLogPlannedListeners(row); } catch (_) {}
    try { scheduleWorkLogPlannedRefresh(row); } catch (_) {}
  } else {
    // Al salir de edición, volver a catálogos completos.
    try { ensureWorkLogsMeta(); } catch (_) {}
  }
}

export function getWorkLogDetailRow(row) {
  if (!row) return null;
  const tbody = row.closest('tbody');
  if (!tbody) return null;
  const rowId = String(row.getAttribute('data-id') || '').trim();
  if (!rowId) return null;
  return tbody.querySelector(`tr[data-detail-for="${safeCssEscape(rowId)}"]`);
}

export function toggleWorkLogRowDetails(id) {
  const row = findRowByDataId('#workLogsTable tbody', id);
  if (!row) return;
  const detailRow = getWorkLogDetailRow(row);
  if (!detailRow) return;

  const expanded = row.getAttribute('data-expanded') === '1';
  const nextExpanded = !expanded;
  row.setAttribute('data-expanded', nextExpanded ? '1' : '0');
  detailRow.style.display = nextExpanded ? '' : 'none';

  const moreBtn = row.querySelector('button.more-btn');
  if (moreBtn) moreBtn.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
}

export function findRowByDataId(tbodySelector, id) {
  const tbody = document.querySelector(tbodySelector);
  if (!tbody) return null;
  const target = String(id ?? '').trim();
  if (!target) return null;
  const rows = tbody.querySelectorAll('tr[data-id]');
  for (const tr of rows) {
    if (String(tr.getAttribute('data-id')) === target) return tr;
  }
  return null;
}

export function startEditWorkLogRow(id) {
  try {
    const row = findRowByDataId('#workLogsTable tbody', id);
    if (!row) {
      displayResponse('workLogsResponse', { error: 'No se encontró el registro para editar' }, false);
      return;
    }
    const canEdit = row.getAttribute('data-can-edit') === '1' || hasAdminPrivileges(state.currentUser?.role);
    if (!canEdit) {
      displayResponse('workLogsResponse', { error: 'No tienes permiso para editar este registro' }, false);
      return;
    }
    setWorkLogRowEditing(row, true, state.currentUser?.role);
  } catch (e) {
    displayResponse('workLogsResponse', { error: 'No se pudo habilitar edición', details: String(e) }, false);
  }
}

export function renderWorkLogsTable(rows) {
  const tbody = document.querySelector('#workLogsTable tbody');
  if (!tbody) return;

  const role = String(state.currentUser?.role || '').toLowerCase();
  const isAdmin = hasAdminPrivileges(role);
  const isOperator = role === 'operator';
  const canEditAll = isAdmin;
  const canDeleteAll = isAdmin;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="13" class="text-muted">(sin registros)</td></tr>';
    return;
  }

  const parseProcesoOperacion = (note) => {
    const out = { proceso: '', operacion: '' };
    const s = String(note || '');
    // Formato esperado: "Proceso: X | Operación: Y"
    const mProc = s.match(/Proceso:\s*([^|]+?)(\s*\||$)/i);
    const mOper = s.match(/Operaci[oó]n:\s*(.+)$/i);
    if (mProc && mProc[1]) out.proceso = String(mProc[1]).trim();
    if (mOper && mOper[1]) out.operacion = String(mOper[1]).trim();
    return out;
  };

  tbody.innerHTML = rows.map(r => {
    const workDateIso = r.work_date || (r.recorded_at ? fmtDateOnly(r.recorded_at) : '');
    const workDateDisplay = formatDateDisplay(workDateIso);
    const recordedDate = formatDateDisplay(r.recorded_at);
    const recordedTime = formatTimeHM(r.recorded_at);
    const updatedDate = formatDateDisplay(r.updated_at);
    const updatedTime = formatTimeHM(r.updated_at);

    const po = parseProcesoOperacion(r.note);
    const plannedNum = (r.planned_hours == null) ? NaN : Number(r.planned_hours);
    const planned = Number.isFinite(plannedNum) ? formatNumberCOP(plannedNum, 2) : '';
    const diffNum = (r.diff_hours == null) ? NaN : Number(r.diff_hours);
    const deviation = (() => {
      if (!Number.isFinite(plannedNum) || plannedNum <= 0) return '';
      if (!Number.isFinite(diffNum)) return '';
      const pct = (diffNum / plannedNum) * 100;
      const sign = pct > 0.0000001 ? '+' : '';
      return `${sign}${formatNumberCOP(pct, 2)}%`;
    })();
    const isAlert = Number(r.is_alert) === 1 || String(r.is_alert).toLowerCase() === 'true';
    const isFinalLog = r.is_final_log === true || Number(r.is_final_log) === 1 || String(r.is_final_log) === 'true';
    const plannedNum2 = (r.planned_hours == null) ? NaN : Number(r.planned_hours);
    const actualNum = r.hours_worked != null ? Number(r.hours_worked) : NaN;
    const isOverrun = !isFinalLog && Number.isFinite(plannedNum2) && plannedNum2 > 0 && Number.isFinite(actualNum) && actualNum > (plannedNum2 + 0.01);
    const canAdmin = String(state.currentUser?.role || '').toLowerCase() !== 'operator';

    const canEdit = canEditAll;
    const canDelete = canDeleteAll;

    // Campos bloqueados por defecto; se habilitan solo al presionar "Editar".
    const disabled = 'disabled';

    const rowClass = isAlert ? 'class="wl-alert"' : '';
    const rowId = escapeHtml(String(r.id));
    const detailNote = escapeHtml(String(r.note || ''));

    return `
      <tr data-id="${rowId}" data-planning-id="${escapeHtml(String(r.planning_id ?? ''))}" data-expanded="0" data-can-edit="${canEdit ? '1' : '0'}" data-is-final="${isFinalLog ? '1' : '0'}" ${rowClass}>
        <td><input type="text" class="wl-date" value="${escapeHtml(workDateDisplay)}" placeholder="DD/MM/YYYY" ${disabled}></td>
        <td><input type="text" class="wl-operario" list="wlOperarios" value="${escapeHtml(r.operator_name || '')}" ${disabled}></td>
        <td><input type="text" class="wl-proceso" list="wlProcesos" value="${escapeHtml(po.proceso || '')}" ${disabled}></td>
        <td><input type="text" class="wl-molde" list="wlMoldes" value="${escapeHtml(r.mold_name || '')}" ${disabled}></td>
        <td><input type="text" class="wl-parte" list="wlPartes" value="${escapeHtml(r.part_name || '')}" ${disabled}></td>
        <td><input type="text" class="wl-maquina" list="wlMaquinas" value="${escapeHtml(r.machine_name || '')}" ${disabled}></td>
        <td><input type="text" class="wl-operacion" list="wlOperaciones" value="${escapeHtml(po.operacion || '')}" ${disabled}></td>
        <td><input type="number" class="wl-hours" list="hoursOptions" step="0.25" min="0" max="24" value="${r.hours_worked != null ? Number(r.hours_worked).toFixed(2) : ''}" ${disabled}>${isOverrun ? ' <span title="Exceso sobre lo planeado sin cierre manual" style="color:#e67e22;font-weight:700;">&#9888; Exceso</span>' : ''}</td>
        <td style="text-align:center;">${isFinalLog
          ? `<span title="Parte cerrada definitivamente" style="color:#27ae60;font-size:1.1rem;">&#128274;</span>`
          : (canAdmin ? `<input type="checkbox" class="wl-is-final" title="Marcar cierre definitivo" ${disabled}>` : '')
        }</td>
        <td><input type="text" class="wl-reason" value="${escapeHtml(r.reason || '')}" ${disabled}></td>
        <td class="wl-planned">${escapeHtml(planned)}</td>
        <td class="wl-deviation">${escapeHtml(deviation)}</td>
        <td>
          <button class="more-btn" data-action="wl-more" data-id="${rowId}" aria-expanded="false" title="Ver más">&#8942;</button>
        </td>
      </tr>
      <tr class="wl-detail-row" data-detail-for="${rowId}" style="display:none;">
        <td colspan="13">
          <div class="wl-detail-grid">
            <div><strong>Registrado:</strong> ${escapeHtml(recordedDate)} ${escapeHtml(recordedTime)}</div>
            <div><strong>Última actualización:</strong> ${escapeHtml(updatedDate)} ${escapeHtml(updatedTime)}</div>
          </div>
          <div class="wl-detail-note"><strong>Detalle:</strong> ${detailNote || '<span class="text-muted">(sin detalle)</span>'}</div>
          <div class="wl-detail-actions">
            ${canEdit
              ? `<button class="btn btn-primary btn-sm wl-edit" data-action="wl-edit" data-id="${rowId}">Editar</button>
                 <button class="btn btn-primary btn-sm wl-save" style="display:none" data-action="wl-save" data-id="${rowId}">Guardar</button>`
              : ''}
            ${canDelete
              ? `<button class="btn btn-danger btn-sm wl-delete" data-action="wl-delete" data-id="${rowId}">Eliminar</button>`
              : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Asegurar que el campo operario quede bloqueado para rol operario incluso al entrar a editar.
  if (isOperator && state.currentUser?.role) {
    tbody.querySelectorAll('tr[data-can-edit="1"]').forEach(tr => {
      const op = tr.querySelector('input.wl-operario');
      if (op) op.disabled = true;
    });
  }
}

export async function saveWorkLogRow(id) {
  const row = findRowByDataId('#workLogsTable tbody', id);
  if (!row) return;
  // Asegurar meta (catálogos) para resolver IDs por nombre
  if (!tiemposMetaCache) {
    try { await loadTiemposMeta(); } catch (_) {}
  }
  const meta = tiemposMetaCache || {};

  const dateInput = String(row.querySelector('.wl-date')?.value || '').trim();

  const operarioName = String(row.querySelector('.wl-operario')?.value || '').trim();
  const proceso = String(row.querySelector('.wl-proceso')?.value || '').trim();
  const moldeName = String(row.querySelector('.wl-molde')?.value || '').trim();
  const parteName = String(row.querySelector('.wl-parte')?.value || '').trim();
  const maquinaName = String(row.querySelector('.wl-maquina')?.value || '').trim();
  const operacion = String(row.querySelector('.wl-operacion')?.value || '').trim();

  const hours = row.querySelector('.wl-hours')?.value;
  const reason = row.querySelector('.wl-reason')?.value;

  if (!dateInput || !operarioName || !proceso || !moldeName || !parteName || !maquinaName || !operacion) {
    return displayResponse('workLogsResponse', { error: 'Completa todos los campos principales antes de guardar' }, false);
  }

  const work_date = parseUiDateToISO(dateInput);
  if (!work_date) return displayResponse('workLogsResponse', { error: 'Fecha inválida (use DD/MM/YYYY)' }, false);

  const planningIdRaw = String(row.getAttribute('data-planning-id') || '').trim();
  const planningId = Number.parseInt(planningIdRaw, 10);
  if (!Number.isInteger(planningId) || planningId <= 0) {
    return displayResponse('workLogsResponse', { error: 'No se pudo determinar planning_id del registro en edición' }, false);
  }

  const operator = findByName(meta.operators, operarioName);
  const mold = findByName(meta.molds, moldeName);
  const part = findByName(meta.parts, parteName);
  const machine = findByName(meta.machines, maquinaName);

  const operatorId = operator ? Number(operator.id) : NaN;
  const moldId = mold ? Number(mold.id) : NaN;
  const partId = part ? Number(part.id) : NaN;
  const machineId = machine ? Number(machine.id) : NaN;

  if ([operatorId, moldId, partId, machineId].some(n => Number.isNaN(n))) {
    return displayResponse('workLogsResponse', { error: 'Operario/molde/parte/máquina inválidos (usa el listado)' }, false);
  }

  // Operario no debe cambiar a otro operario
  const role = String(state.currentUser?.role || '').toLowerCase();
  if (role === 'operator' && state.currentUser?.operatorId && Number(state.currentUser.operatorId) !== operatorId) {
    return displayResponse('workLogsResponse', { error: 'No puedes cambiar el operario del registro' }, false);
  }

  // Siempre enviar is_final_log: si no hay checkbox visible, usar estado actual de la fila.
  // Esto evita perder el cierre final al editar registros ya cerrados.
  const finalCheckbox = row.querySelector('input.wl-is-final');
  const currentRowIsFinal = String(row.getAttribute('data-is-final') || '0') === '1';
  const finalFlag = finalCheckbox ? !!finalCheckbox.checked : currentRowIsFinal;

  const payload = {
    work_date,
    operatorId,
    moldId,
    planning_id: planningId,
    partId,
    machineId,
    hours_worked: Number(hours),
    reason: String(reason || '').trim() || null,
    note: `Proceso: ${proceso} | Operación: ${operacion}`,
    is_final_log: finalFlag,
  };

  try {
    const res = await fetch(`${state.API_URL}/work_logs/${encodeURIComponent(String(id))}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    displayResponse('workLogsResponse', data, res.ok);
    if (res.ok) {
      try { loadWorkLogsHistory(true); } catch (_) {}
    }
  } catch (e) {
    displayResponse('workLogsResponse', { error: 'Error de conexión', details: String(e) }, false);
  }
}

export async function deleteWorkLogRow(id) {
  const rowId = String(id || '').trim();
  if (!rowId) return;
  const ok = window.confirm('¿Eliminar este registro de trabajo? Esta acción no se puede deshacer.');
  if (!ok) return;

  try {
    const res = await fetch(`${state.API_URL}/work_logs/${encodeURIComponent(rowId)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    displayResponse('workLogsResponse', data, res.ok);
    if (res.ok) {
      try { loadWorkLogsHistory(true); } catch (_) {}
    }
  } catch (e) {
    displayResponse('workLogsResponse', { error: 'Error de conexión', details: String(e) }, false);
  }
}

// ================================
// Sesiones (placeholder - backend se agrega aparte)
// ================================

export async function loadSessionsHistory() {
  const tbody = document.querySelector('#sessionsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="color:#6c757d">Cargando...</td></tr>';

  try {
    const res = await fetch(`${state.API_URL}/auth/sessions`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="7" style="color:#6c757d">Error cargando sesiones</td></tr>';
      return displayResponse('sessionsResponse', data, false);
    }
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="color:#6c757d">(sin sesiones)</td></tr>';
      return displayResponse('sessionsResponse', { total: 0 }, true);
    }
    tbody.innerHTML = rows.map(s => {
      const start = fmtDateTime(s.login_at);
      const end = s.logout_at ? fmtDateTime(s.logout_at) : '';
      const dur = s.duration_minutes != null ? `${Number(s.duration_minutes).toFixed(0)} min` : '';
      return `
        <tr>
          <td>${escapeHtml(s.username || '')}</td>
          <td>${escapeHtml(String(s.role || '').toUpperCase())}</td>
          <td>${escapeHtml(s.operator_name || '')}</td>
          <td>${escapeHtml(start)}</td>
          <td>${escapeHtml(end)}</td>
          <td>${escapeHtml(dur)}</td>
          <td>${escapeHtml(s.ip || '')}</td>
        </tr>
      `;
    }).join('');
    displayResponse('sessionsResponse', { total: rows.length }, true);
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:#6c757d">Error de conexión</td></tr>';
    displayResponse('sessionsResponse', { error: 'Error de conexión', details: String(e) }, false);
  }
}

// loadDatosMeta se mantiene por compatibilidad (muchos call-sites),
// pero ahora recarga desde catálogos reales (tablas dedicadas) y refresca planificador.
export async function loadDatosMeta() {
  try { await loadTiemposMeta(); } catch (_) {}
  try { await preloadMoldsForSearch(); } catch (_) {}
  try { await loadHoursOptions(); } catch (_) {}
}
export function fillDatalist(id, items) {
  const dl = document.getElementById(id);
  if (!dl) return;
  dl.innerHTML = (items || []).map(v => `<option value="${escapeHtml(v)}">`).join('');
}
export function populateSelectWithFilter(selectId, filterInputId, items) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.dataset.allItems = JSON.stringify(items || []);
  sel.innerHTML = (items || []).map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  sel.selectedIndex = -1;
  const filterInput = document.getElementById(filterInputId);
  if (filterInput) filterInput.value = '';
}
export function setupFilterListener(filterInputId, selectId) {
  const input = document.getElementById(filterInputId);
  const sel = document.getElementById(selectId);
  if (!input || !sel) return;
  if (input.dataset.bound === '1') return;
  input.dataset.bound = '1';
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    const all = JSON.parse(sel.dataset.allItems || '[]');
    const filtered = q ? all.filter(v => String(v).toLowerCase().includes(q)) : all;
    sel.innerHTML = filtered.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    sel.selectedIndex = -1;
  });
}

// Datos: historial (SIN filtros)
let datosPagination = { limit: 20, offset: 0, total: 0, items: [] };

export async function loadDatos(reset = true) {
  if (reset) {
    datosPagination.offset = 0;
    datosPagination.items = [];
    datosPagination.total = 0;
  }
  const qs = new URLSearchParams();
  qs.append('limit', String(datosPagination.limit));
  qs.append('offset', String(datosPagination.offset));

  try {
    const res = await fetch(`${state.API_URL}/datos?${qs.toString()}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok || !data || !Array.isArray(data.items)) {
      return displayResponse('datosResponse', { error: 'Error cargando datos', status: res.status, body: data }, false);
    }

    datosPagination.total = data.total || 0;
    datosPagination.offset += data.items.length;
    datosPagination.items = datosPagination.items.concat(data.items);

    renderDatosTable(datosPagination.items);

    const verMasContainer = document.getElementById('datosVerMasContainer');
    if (verMasContainer) {
      const remaining = Math.max(0, datosPagination.total - datosPagination.items.length);
      verMasContainer.innerHTML = remaining > 0
        ? `<button class="btn btn-secondary" id="datosVerMasBtn">Ver más (${remaining} restantes)</button>`
        : `<span style="color:#6c757d">No hay más resultados</span>`;
      const btn = document.getElementById('datosVerMasBtn');
      if (btn) btn.onclick = () => loadDatos(false);
    }

    displayResponse('datosResponse', { total: datosPagination.total, shown: datosPagination.items.length }, true);
  } catch (e) {
    displayResponse('datosResponse', { error: 'Error de conexión', details: String(e) }, false);
  }
}
export function renderDatosTable(items) {
  const tbody = document.querySelector('#datosTable tbody'); if (!tbody) return;
  tbody.innerHTML = items.map(r => {
    const showSave = r.source !== 'import';
    const createdAt = r.created_at ? new Date(r.created_at).toLocaleString() : '';

    const hasValue = (v) => v !== null && v !== undefined && String(v).trim() !== '';
    const fieldEditable = (v) => (showSave && hasValue(v)) ? '' : 'disabled';
    const fieldTitle = (v) => (showSave && !hasValue(v))
      ? 'title="No editable: esta columna estaba vacía en el registro original"'
      : '';

    return `
      <tr data-id="${r.id}" data-source="${r.source || ''}">
        <td><input data-field="dia" type="number" min="1" max="31" value="${r.dia ?? ''}" ${fieldEditable(r.dia)} ${fieldTitle(r.dia)}></td>
        <td><input data-field="mes" type="text" value="${r.mes ? (capitalize(r.mes)) : ''}" ${fieldEditable(r.mes)} ${fieldTitle(r.mes)}></td>
        <td><input data-field="anio" type="number" min="2016" max="2100" value="${r.anio ?? ''}" ${fieldEditable(r.anio)} ${fieldTitle(r.anio)}></td>
        <td><input data-field="nombre_operario" type="text" value="${escapeHtml(r.nombre_operario ?? '')}" ${fieldEditable(r.nombre_operario)} ${fieldTitle(r.nombre_operario)}></td>
        <td><input data-field="tipo_proceso" type="text" value="${escapeHtml(r.tipo_proceso ?? '')}" ${fieldEditable(r.tipo_proceso)} ${fieldTitle(r.tipo_proceso)}></td>
        <td><input data-field="molde" type="text" value="${escapeHtml(r.molde ?? '')}" ${fieldEditable(r.molde)} ${fieldTitle(r.molde)}></td>
        <td><input data-field="parte" type="text" value="${escapeHtml(r.parte ?? '')}" ${fieldEditable(r.parte)} ${fieldTitle(r.parte)}></td>
        <td><input data-field="maquina" type="text" value="${escapeHtml(r.maquina ?? '')}" ${fieldEditable(r.maquina)} ${fieldTitle(r.maquina)}></td>
        <td><input data-field="operacion" type="text" value="${escapeHtml(r.operacion ?? '')}" ${fieldEditable(r.operacion)} ${fieldTitle(r.operacion)}></td>
        <td><input data-field="horas" type="number" step="0.25" min="0" max="12" list="hoursOptions" value="${r.horas != null ? Number(r.horas).toFixed(2) : ''}" ${fieldEditable(r.horas)} ${fieldTitle(r.horas)}></td>
        <td>${r.source === 'import' ? 'Importado' : 'Manual'}</td>
        <td>${createdAt}</td>
        <td>
          ${showSave ? `<button class="btn btn-primary btn-sm" data-action="dato-save" data-id="${escapeHtml(String(r.id))}">Guardar</button>` : ''}
          <button class="btn btn-danger btn-sm" data-action="dato-delete" data-id="${escapeHtml(String(r.id))}">Eliminar</button>
        </td>
      </tr>
    `;
  }).join('');
}
export async function mostrarTodosDatos() {
  try {
    if (datosPagination.items.length >= datosPagination.total) return;
    const batchLimit = 1000;
    while (datosPagination.items.length < datosPagination.total) {
      const qs = new URLSearchParams();
      qs.append('limit', String(batchLimit));
      qs.append('offset', String(datosPagination.items.length));
      const res = await fetch(`${state.API_URL}/datos?${qs.toString()}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok || !data || !Array.isArray(data.items)) {
        displayResponse('datosResponse', { error: 'Error cargando datos (mostrar todos)', status: res.status, body: data }, false);
        break;
      }
      datosPagination.total = data.total || 0;
      datosPagination.items = datosPagination.items.concat(data.items);
      renderDatosTable(datosPagination.items);
      const verMasContainer = document.getElementById('datosVerMasContainer');
      if (verMasContainer) {
        const remaining = Math.max(0, datosPagination.total - datosPagination.items.length);
        verMasContainer.innerHTML = remaining > 0
          ? `<button class="btn btn-secondary" id="datosVerMasBtn">Ver más (${remaining} restantes)</button>`
          : `<span style="color:#6c757d">No hay más resultados</span>`;
        const btn = document.getElementById('datosVerMasBtn');
        if (btn) btn.onclick = () => loadDatos(false);
      }
      if (data.items.length < batchLimit) break;
    }
    displayResponse('datosResponse', { total: datosPagination.total, shown: datosPagination.items.length }, true);
  } catch (e) {
    displayResponse('datosResponse', { error: 'Error de conexión (mostrar todos)', details: String(e) }, false);
  }
}

// Registro manual: sin Operario/Molde/Parte/Máquina
export async function createDatoManual() {
  const payload = {};
  const map = [
    ['datoAnio', 'anio', v => parseInt(v, 10)],
    ['datoProceso', 'tipo_proceso', v => v],
    ['datoOperacion', 'operacion', v => v],
    ['datoHoras', 'horas', v => hoursToPayload(v)]
  ];
  for (const [id, key, fmt] of map) {
    const el = document.getElementById(id);
    if (el && el.value !== '') payload[key] = fmt(el.value);
  }
  if (Object.keys(payload).length === 0) {
    return displayResponse('datoCrearResponse', { error: 'Ingresa al menos un campo antes de guardar.' }, false);
  }
  try {
    const res = await fetch(`${state.API_URL}/datos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    displayResponse('datoCrearResponse', data, res.ok);
    if (res.ok) {
      map.forEach(([id]) => { const el = document.getElementById(id); if (el) el.value = ''; });
      loadDatos(true);
      loadDatosMeta();

      // Refrescar catálogos usados en Tiempos/Registros (Proceso/Operación)
      try { tiemposMetaCache = null; } catch (_) {}
      try { loadTiemposMeta(); } catch (_) {}
    }
  } catch (e) {
    displayResponse('datoCrearResponse', { error: 'Error de conexión', details: String(e) }, false);
  }
}
export async function saveDatoRow(id) {
  const row = document.querySelector(`#datosTable tbody tr[data-id="${id}"]`);
  if (!row) return;
  const payload = {};
  const inputs = Array.from(row.querySelectorAll('input[data-field]')).filter(inp => !inp.disabled);

  for (const input of inputs) {
    const field = input.getAttribute('data-field');
    if (!field) continue;
    const raw = input.value;

    if (field === 'dia' || field === 'anio') {
      payload[field] = raw !== '' ? parseInt(raw, 10) : '';
      continue;
    }
    if (field === 'mes') {
      payload[field] = raw !== '' ? raw.toLowerCase() : '';
      continue;
    }
    if (field === 'horas') {
      payload[field] = hoursToPayload(raw);
      continue;
    }
    payload[field] = raw;
  }

  if (Object.keys(payload).length === 0) {
    return displayResponse('datosResponse', { error: 'No hay campos editables en esta fila.' }, false);
  }

  try {
    const res = await fetch(`${state.API_URL}/datos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    displayResponse('datosResponse', data, res.ok);
    if (res.ok) loadDatosMeta();
  } catch (e) {
    displayResponse('datosResponse', { error: 'Error guardando fila' }, false);
  }
}
export async function deleteDatoRow(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  try {
    const res = await fetch(`${state.API_URL}/datos/${id}`, { method: 'DELETE', credentials: 'include' });
    const data = await res.json();
    displayResponse('datosResponse', data, res.ok);
    if (res.ok) {
      loadDatos(true);
      try { loadDatosMeta(); } catch (_) {}

      // Refrescar catálogos usados en Tiempos/Registros (Proceso/Operación)
      try { tiemposMetaCache = null; } catch (_) {}
      try { loadTiemposMeta(); } catch (_) {}
    }
  } catch (e) {
    displayResponse('datosResponse', { error: 'Error eliminando registro' }, false);
  }
}

// Importar
export function setImportProgressVisible(visible, label) {
  const box = document.getElementById('importProgress');
  if (!box) return;
  box.classList.toggle('hidden', !visible);
  const lbl = document.getElementById('importProgressLabel');
  if (lbl && label != null) lbl.textContent = String(label);
}

export async function importDatosCSV() {
  const fileInput = document.getElementById('importFile'); const file = fileInput?.files?.[0];
  if (!file) return displayResponse('importResponse', { error: 'Selecciona un archivo' }, false);
  const btn = document.getElementById('importBtn'); if (btn) btn.disabled = true;
  setImportProgressVisible(true, 'Importando…');
  const form = new FormData(); form.append('file', file);
  try {
    const res = await fetch(`${state.API_URL}/import/datos`, { method: 'POST', credentials: 'include', body: form });
    const data = await res.json();
    displayResponse('importResponse', data, res.ok);
    if (res.ok) {
      try { loadDatos(true); } catch (_) {}
      try { loadDatosMeta(); } catch (_) {}

      // Refrescar catálogos usados en Tiempos/Registros (Proceso/Operación)
      try { tiemposMetaCache = null; } catch (_) {}
      try { loadTiemposMeta(); } catch (_) {}
    }
  } catch (e) {
    displayResponse('importResponse', { error: 'Error de conexión' }, false);
  } finally {
    setImportProgressVisible(false);
    if (btn) btn.disabled = false;
  }
}
export function renderImportDiagnostics(resp) { }

// Calendario
// Inactividad
// Inactividad (Movido a auth.js para evitar dependencias circulares)

function filterWizardGrid(inputId, gridId) {
  const input = document.getElementById(inputId);
  const grid = document.getElementById(gridId);
  if (!input || !grid) return;

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    const cards = grid.querySelectorAll('.wz-item-card');
    cards.forEach(card => {
      const name = card.querySelector('.wz-item-card__name')?.textContent.toLowerCase() || '';
      const sub = card.querySelector('.wz-item-card__sub')?.textContent.toLowerCase() || '';
      const match = name.includes(q) || sub.includes(q);
      card.style.display = match ? '' : 'none';
    });
  });
}

export function initWorkLogsEvents() {
  const wire = (id, event, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(event, fn); };

  // Wizard y Formulario de Tiempos
  const tmForm = document.getElementById('tiempoMoldeForm');
  if (tmForm) {
    tmForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveTiempoMolde();
    });
  }
  
  // Botones de Refresco y Acción en Tiempos/Sesiones
  wire('tmRefreshBtn', 'click', () => {
    document.querySelectorAll('.wz-search-input').forEach(i => i.value = '');
    loadTiemposMeta();
  });
  wire('wlRefreshBtn', 'click', () => loadWorkLogsHistory());
  wire('datosRefreshBtn', 'click', () => loadDatos(true));
  
  // Wizard Navigation (fallback wiring if not done in initTiemposWizard)
  wire('wzVolver', 'click', () => { /* Logic is usually inside initTiemposWizard but we ensure visibility */ });
  
  // Importación
  wire('importBtn', 'click', importDatosCSV);

  filterWizardGrid('wzOperatorSearch', 'wzOperatorGrid');
  filterWizardGrid('wzMoldSearch', 'wzMoldGrid');
  filterWizardGrid('wzPartSearch', 'wzPartGrid');
  filterWizardGrid('wzMachineSearch', 'wzMachineGrid');

  // Delegación para Tabla de Registros (WorkLogs)
  const wlTable = document.getElementById('workLogsTable');
  if (wlTable) {
    const tbody = wlTable.querySelector('tbody');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        if (action === 'wl-edit') startEditWorkLogRow(id);
        else if (action === 'wl-save') saveWorkLogRow(id);
        else if (action === 'wl-delete') deleteWorkLog(id);
        else if (action === 'wl-more') toggleWorkLogRowDetails(id);
      });
    }
  }

  // Datos (Tab)
  wire('datoCrearBtn', 'click', createDatoManual);
  wire('datosMostrarTodosBtn', 'click', () => loadDatos(true));

  // Delegación para Tabla de Datos (Historial)
  const datosTable = document.getElementById('datosTable');
  if (datosTable) {
    datosTable.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const act = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      if (act === 'dato-save') saveDatoRow(id);
      if (act === 'dato-delete') deleteDatoRow(id);
    });
  }

  // Inicialización de metadatos al cargar
  ensureWorkLogsMeta();
}

export function normalizeHoursOptions(items) {
  if (!items || !items.length) return [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12];
  const nums = items.map(v => parseLocaleNumber(v)).filter(n => !isNaN(n) && n > 0);
  if (!nums.length) return [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12];
  return [...new Set(nums)].sort((a, b) => a - b);
}

export function fillHoursOptionsDatalist(options) {
  const dl = document.getElementById('hoursOptions');
  if (!dl) return;
  dl.innerHTML = options.map(v => `<option value="${v.toFixed(2)}">`).join('');
}

export function fillHoursOptionsSelect(options) {
  const sel = document.getElementById('datoHoras');
  if (!sel) return;
  sel.innerHTML = '<option value="">(selecciona)</option>' +
    options.map(v => `<option value="${v}">${v.toFixed(2)}h</option>`).join('');
}

export async function loadHoursOptions() {
  if (!state.currentUser) return;
  if (state.hoursOptionsCache) return state.hoursOptionsCache;
  try {
    const res = await fetch(`${state.API_URL}/datos/hours-options`, { credentials: 'include' });
    if (!res.ok) throw new Error('Error loading hours');
    const data = await res.json();
    const options = normalizeHoursOptions(data?.hours || []);
    state.hoursOptionsCache = options;
    fillHoursOptionsDatalist(options);
    fillHoursOptionsSelect(options);
    return options;
  } catch (e) {
    const defaults = normalizeHoursOptions([]);
    fillHoursOptionsDatalist(defaults);
    fillHoursOptionsSelect(defaults);
    return defaults;
  }
}

export async function ensureWorkLogsMeta() {
  try { await loadTiemposMeta(); } catch (_) { }
  try { await loadHoursOptions(); } catch (_) { }
}

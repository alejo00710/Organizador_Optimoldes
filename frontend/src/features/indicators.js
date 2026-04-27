import { state } from '../core/state.js';
import * as api from '../core/api.js';
import { showToast, displayResponse, escapeHtml, openTab, formatCurrencyCOP, hideModal } from '../ui/ui.js';

let indicatorsCache = null;
let indicatorsOperatorsCache = null;
let indicatorsAutoLoadTimer = null;

export function loadIndicatorsSelectedOperatorIds(){
  try {
    const raw = localStorage.getItem(state.LS_KEYS.indicatorsSelectedOperators);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map(v => String(v)));
  } catch { return new Set(); }
}

export function saveIndicatorsSelectedOperatorIds(idSet){
  try {
    const arr = Array.from(idSet || []).map(v => String(v));
    localStorage.setItem(state.LS_KEYS.indicatorsSelectedOperators, JSON.stringify(arr));
  } catch {}
}

export function clearIndicatorsTables(){
  ['indMainTable','indHoursTable','indDaysTable'].forEach(id => {
    const table = document.getElementById(id);
    if (!table) return;
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (thead) thead.innerHTML = '';
    if (tbody) tbody.innerHTML = '';
  });
}

export function scheduleIndicatorsAutoLoad(options){
  if (indicatorsAutoLoadTimer) clearTimeout(indicatorsAutoLoadTimer);
  indicatorsAutoLoadTimer = setTimeout(() => {
    indicatorsAutoLoadTimer = null;
    loadIndicators(options);
  }, 250);
}

export function safeDivide(num, den){
  const n = Number(num || 0);
  const d = Number(den || 0);
  if (!d) return 0;
  return n / d;
}

export function sum(arr){
  return (Array.isArray(arr) ? arr : []).reduce((acc, v) => acc + Number(v || 0), 0);
}

export function emptyMonths(){
  return Array.from({ length: 12 }, () => 0);
}

export function avgWhereDays(values, days){
  const v = Array.isArray(values) ? values : [];
  const d = Array.isArray(days) ? days : [];
  let acc = 0;
  let cnt = 0;
  for (let i = 0; i < Math.min(v.length, d.length); i++) {
    const di = Number(d[i] || 0);
    if (di > 0) {
      acc += Number(v[i] || 0);
      cnt++;
    }
  }
  if (!cnt) return 0;
  return acc / cnt;
}

export function getSelectedOperatorIdSet(){
  const container = document.getElementById('indOperatorFilter');
  if (container) {
    const checked = Array.from(container.querySelectorAll('input[type="checkbox"][data-operator-id]:checked'));
    return new Set(checked.map(cb => String(cb.getAttribute('data-operator-id'))));
  }
  // Checklist se movió a Configuración: la fuente es localStorage
  return loadIndicatorsSelectedOperatorIds();
}

export function persistIndicatorsSelectionFromUI(){
  const container = document.getElementById('indOperatorFilter');
  if (!container) return;
  saveIndicatorsSelectedOperatorIds(getSelectedOperatorIdSet());
}

export function populateOperatorFilter(operators){
  const container = document.getElementById('indOperatorFilter');
  if (!container) return;
  const ops = Array.isArray(operators) ? operators : [];

  const uiSelected = getSelectedOperatorIdSet();
  const storedSelected = loadIndicatorsSelectedOperatorIds();
  const selected = uiSelected.size ? uiSelected : storedSelected;

  container.innerHTML = ops.map(o => {
    const id = String(o.id);
    const checked = selected.has(id);
    const name = escapeHtml(o.name || '');
    return `
      <label class="operator-filter-row">
        <input class="operator-filter-checkbox" type="checkbox" data-operator-id="${escapeHtml(id)}" ${checked ? 'checked' : ''}>
        <span class="operator-filter-name">${name}</span>
      </label>
    `;
  }).join('');
}

export function getSelectedOperatorsList(){
  const all = Array.isArray(indicatorsOperatorsCache) ? indicatorsOperatorsCache : [];
  const set = getSelectedOperatorIdSet();
  if (!set.size) return [];
  return all.filter(o => set.has(String(o.id))).sort((a,b) => String(a.name||'').localeCompare(String(b.name||''), 'es'));
}

export function updateWorkingDaysOperatorSelect(){
  const selOp = document.getElementById('indDaysOperator');
  const btnSave = document.getElementById('saveWorkingDaysBtn');
  if (!selOp) return;
  const prev = selOp.value;

  const selectedOps = getSelectedOperatorsList();
  if (!selectedOps.length) {
    selOp.innerHTML = `<option value="">Selecciona operarios arriba</option>`;
    selOp.value = '';
    selOp.disabled = true;
    if (btnSave) btnSave.disabled = true;
    return;
  }

  selOp.disabled = false;
  if (btnSave) btnSave.disabled = false;

  selOp.innerHTML = selectedOps.map(o => `<option value="${o.id}">${escapeHtml(o.name || '')}</option>`).join('');
  if (prev && selectedOps.some(o => String(o.id) === String(prev))) selOp.value = prev;
}

export function filterTablesBySelectedOperators(data){
  const selected = getSelectedOperatorIdSet();
  const tables = data?.tables || {};

  const hoursRowsAll = Array.isArray(tables?.hours?.rows) ? tables.hours.rows : [];
  const daysRowsAll = Array.isArray(tables?.days?.rows) ? tables.days.rows : [];

  const filterBySet = (rows) => {
    if (!selected.size) return [];
    return rows.filter(r => selected.has(String(r.operatorId)));
  };

  const hoursRows = filterBySet(hoursRowsAll);
  const daysRows = filterBySet(daysRowsAll);

  const hoursTotalsMonths = emptyMonths();
  for (let i = 0; i < 12; i++) hoursTotalsMonths[i] = sum(hoursRows.map(r => r.months?.[i]));
  const hoursTotalGeneral = sum(hoursTotalsMonths);

  const daysTotalsMonths = emptyMonths();
  for (let i = 0; i < 12; i++) daysTotalsMonths[i] = sum(daysRows.map(r => r.months?.[i]));
  const daysTotalGeneral = sum(daysTotalsMonths);

  // Indicador: lo recalculamos a partir de horas+días para que sea consistente con
  // el valor de horas que el usuario ve (la tabla de horas muestra 1 decimal).
  const roundToDecimals = (value, decimals = 1) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round((n + Number.EPSILON) * factor) / factor;
  };
  const HOURS_DISPLAY_DECIMALS = 1;

  const buildIndicatorRow = (opId, operatorName, hoursMonths, daysMonths) => {
    const h = Array.isArray(hoursMonths) ? hoursMonths : emptyMonths();
    const d = Array.isArray(daysMonths) ? daysMonths : emptyMonths();
    const months = h.map((hv, idx) => {
      const hvRounded = roundToDecimals(hv, HOURS_DISPLAY_DECIMALS);
      return safeDivide(hvRounded, (Number(d[idx] || 0) * 8));
    });

    // Promedio/Total: porcentaje global del periodo seleccionado (estilo Excel):
    // SUM(horas) / (SUM(días) * 8)
    const totalHoursRounded = sum(h.map(hv => roundToDecimals(hv, HOURS_DISPLAY_DECIMALS)));
    const totalDays = sum(d);
    const average = safeDivide(totalHoursRounded, (totalDays || 0) * 8);

    return {
      operatorId: opId,
      operatorName,
      months,
      average,
    };
  };

  const daysById = new Map(daysRows.map(r => [String(r.operatorId), r]));
  const indicatorRows = hoursRows.map(r => {
    const dRow = daysById.get(String(r.operatorId));
    return buildIndicatorRow(r.operatorId, r.operatorName, r.months, dRow?.months);
  });

  const hoursTotalsMonthsRounded = emptyMonths();
  for (let i = 0; i < 12; i++) {
    hoursTotalsMonthsRounded[i] = sum(hoursRows.map(r => roundToDecimals(r.months?.[i], HOURS_DISPLAY_DECIMALS)));
  }
  const hoursTotalGeneralRounded = sum(hoursTotalsMonthsRounded);

  const indTotalsMonths = emptyMonths();
  for (let i = 0; i < 12; i++) {
    indTotalsMonths[i] = safeDivide(hoursTotalsMonthsRounded[i], (daysTotalsMonths[i] || 0) * 8);
  }
  const indAverageTotal = safeDivide(hoursTotalGeneralRounded, (daysTotalGeneral || 0) * 8);

  return {
    hours: {
      ...tables.hours,
      rows: hoursRows,
      totalsRow: { operatorName: 'Total general', months: hoursTotalsMonths, total: hoursTotalGeneral },
    },
    days: {
      ...tables.days,
      rows: daysRows,
      totalsRow: { operatorName: 'Total general', months: daysTotalsMonths, total: daysTotalGeneral },
    },
    indicator: {
      ...tables.indicator,
      rows: indicatorRows,
      totalsRow: { operatorName: 'Total general', months: indTotalsMonths, average: indAverageTotal },
    },
  };
}

const IND_MONTHS_ES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];

export function formatIndicatorPercentForUI(value, decimals = 1) {
  const n = Number(value || 0);
  const safe = Number.isFinite(n) ? n : 0;

  // Backend calcula indicador como razón: horas / (días * 8).
  // Para mostrar porcentaje, multiplicamos por 100 (sin limitar > 100).
  const pct = safe * 100;

  const sign = pct < 0 ? '-' : '';
  const abs = Math.abs(pct);

  // Redondeo explícito para evitar casos tipo 28.249999999 -> 28.2 por precisión flotante.
  const factor = Math.pow(10, decimals);
  const eps = 1e-12 * Math.max(1, abs);
  const roundedAbs = Math.round((abs + eps) * factor) / factor;
  const fixed = roundedAbs.toFixed(decimals);
  const parts = fixed.split('.');
  const intPart = String(Number(parts[0] || 0)).padStart(3, '0');
  const fracPart = (parts[1] != null) ? parts[1] : '0'.repeat(decimals);

  return `${sign}${intPart}.${fracPart}%`;
}

export function formatIndicatorPercentForExport(value, decimals = 1) {
  const n = Number(value || 0);
  const safe = Number.isFinite(n) ? n : 0;
  let pct = safe * 100;

  // Evitar -0.0
  if (Math.abs(pct) < 1e-12) pct = 0;

  const abs = Math.abs(pct);
  const factor = Math.pow(10, decimals);
  const eps = 1e-12 * Math.max(1, abs);
  const roundedAbs = Math.round((abs + eps) * factor) / factor;
  const sign = pct < 0 ? '-' : '';
  return `${sign}${roundedAbs.toFixed(decimals)}%`;
}

export function defaultYearForIndicators(){
  const y = new Date().getFullYear();
  const el = document.getElementById('indYear');
  if (el && !el.value) el.value = String(y);
}

export function buildIndicatorsHeaderRow(firstLabel, lastLabel){
  return `<tr>${[
    `<th>${escapeHtml(firstLabel)}</th>`,
    ...IND_MONTHS_ES.map(m=>`<th>${escapeHtml(m)}</th>`),
    `<th>${escapeHtml(lastLabel)}</th>`
  ].join('')}</tr>`;
}

export function renderMonthlyTable(tableId, tableDef, options){
  const table = document.getElementById(tableId);
  if (!table) return;
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  if (!thead || !tbody) return;

  const firstLabel = options?.firstLabel || 'OPERARIO';
  const lastLabel = options?.lastLabel || 'Total';
  const isIndicator = Boolean(options?.isIndicator);
  const decimals = Number.isFinite(options?.decimals) ? options.decimals : (isIndicator ? 1 : 2);

  thead.innerHTML = buildIndicatorsHeaderRow(firstLabel, lastLabel);

  const rows = Array.isArray(tableDef?.rows) ? tableDef.rows : [];
  const totalsRow = tableDef?.totalsRow;

  const renderCell = (v) => {
    const n = Number(v || 0);
    if (isIndicator) return formatIndicatorPercentForUI(n, decimals);
    return (Number.isFinite(n) ? n : 0).toFixed(decimals);
  };

  tbody.innerHTML = [
    ...rows.map(r => {
      const months = Array.isArray(r.months) ? r.months : [];
      const endVal = isIndicator ? r.average : r.total;
      return `
        <tr>
          <td>${escapeHtml(r.operatorName || '')}</td>
          ${IND_MONTHS_ES.map((_, idx) => `<td>${renderCell(months[idx])}</td>`).join('')}
          <td>${renderCell(endVal)}</td>
        </tr>
      `;
    }),
    totalsRow ? (() => {
      const months = Array.isArray(totalsRow.months) ? totalsRow.months : [];
      const endVal = isIndicator ? totalsRow.average : totalsRow.total;
      return `
        <tr>
          <td><strong>${escapeHtml(totalsRow.operatorName || 'Total general')}</strong></td>
          ${IND_MONTHS_ES.map((_, idx) => `<td><strong>${renderCell(months[idx])}</strong></td>`).join('')}
          <td><strong>${renderCell(endVal)}</strong></td>
        </tr>
      `;
    })() : ''
  ].join('');
}

export function populateWorkingDaysForm(operators){
  const selOp = document.getElementById('indDaysOperator');
  const selMonth = document.getElementById('indDaysMonth');

  const ops = Array.isArray(operators) ? operators : [];
  if (selOp) {
    const prev = selOp.value;
    selOp.innerHTML = ops.map(o => `<option value="${o.id}">${escapeHtml(o.name || '')}</option>`).join('');
    if (prev && ops.some(o => String(o.id) === String(prev))) selOp.value = prev;
  }
  if (selMonth) {
    const prev = selMonth.value;
    selMonth.innerHTML = IND_MONTHS_ES.map((m, idx) => `<option value="${idx+1}">${escapeHtml(m)}</option>`).join('');
    if (prev && IND_MONTHS_ES[Number(prev) - 1]) selMonth.value = prev;
    else selMonth.value = String(new Date().getMonth() + 1);
  }
}

export async function loadOperatorsForIndicators(){
  try {
    const res = await fetch(`${state.API_URL}/catalogs/meta`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) return;
    const ops = Array.isArray(data?.operators) ? data.operators : [];
    indicatorsOperatorsCache = ops;
    populateWorkingDaysForm(ops);
    populateOperatorFilter(ops);
    updateWorkingDaysOperatorSelect();

    // Si hay selección guardada, cargamos automáticamente las 3 tablas.
    // (Se mantiene la tabla manual igual: solo refresca al guardar días.)
    const selected = loadIndicatorsSelectedOperatorIds();
    if (selected.size) {
      persistIndicatorsSelectionFromUI();
      scheduleIndicatorsAutoLoad({ silent: true });
    } else {
      clearIndicatorsTables();
    }
  } catch (_) {}
}

export async function loadIndicators(options){
  const year = document.getElementById('indYear')?.value;
  const y = Number.parseInt(String(year || ''), 10);
  const silent = Boolean(options?.silent);
  if (!y) {
    if (!silent) displayResponse('indicatorsResponse', { error: 'Selecciona un año válido' }, false);
    return;
  }

  const selected = getSelectedOperatorIdSet();
  if (!selected.size) {
    clearIndicatorsTables();
    if (!silent) displayResponse('indicatorsResponse', { error: 'Selecciona al menos un operario' }, false);
    return;
  }

  try{
    const qs = new URLSearchParams({ year: String(y) });
    const res = await fetch(`${state.API_URL}/indicators/summary?${qs.toString()}`, { credentials: 'include' });
    const data = await res.json();
    indicatorsCache = data;
    if (!res.ok) {
      if (!silent) displayResponse('indicatorsResponse', data, false);
      return;
    }
    renderIndicators(data);
    if (!silent) displayResponse('indicatorsResponse', { ok: true, year: y }, true);
  } catch(e){
    if (!silent) displayResponse('indicatorsResponse', { error:'Error cargando indicadores', details:String(e) }, false);
  }
}

export function renderIndicators(data){
  // Si no hay selección, no renderizamos nada para evitar mostrar totales 0 confusos.
  const selected = getSelectedOperatorIdSet();
  if (!selected.size) {
    clearIndicatorsTables();
    updateWorkingDaysOperatorSelect();
    return;
  }

  const filtered = filterTablesBySelectedOperators(data);
  renderMonthlyTable('indMainTable', filtered.indicator, { firstLabel:'COLABORADOR', lastLabel:'Promedio', isIndicator:true, decimals:1 });
  renderMonthlyTable('indHoursTable', filtered.hours, { firstLabel:'OPERARIO', lastLabel:'Total general', isIndicator:false, decimals:1 });
  renderMonthlyTable('indDaysTable', filtered.days, { firstLabel:'OPERARIO', lastLabel:'Total general', isIndicator:false, decimals:0 });
  // Si aún no cargó catálogo, usamos fallback del resumen y dejamos el filtro funcional.
  if (!indicatorsOperatorsCache && Array.isArray(data?.operators)) {
    indicatorsOperatorsCache = data.operators;
    populateOperatorFilter(data.operators);
  }
  updateWorkingDaysOperatorSelect();
}

export async function saveWorkingDays(){
  const year = Number.parseInt(String(document.getElementById('indYear')?.value || ''), 10);
  const operatorId = Number.parseInt(String(document.getElementById('indDaysOperator')?.value || ''), 10);
  const month = Number.parseInt(String(document.getElementById('indDaysMonth')?.value || ''), 10);
  const workingDays = Number.parseInt(String(document.getElementById('indDaysValue')?.value || ''), 10);

  if (!year || !operatorId || !month || Number.isNaN(workingDays)) {
    return displayResponse('indicatorsResponse', { error:'Completa año, operario, mes y días' }, false);
  }

  try{
    const res = await fetch(`${state.API_URL}/indicators/working-days`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify({ operatorId, year, month, workingDays })
    });
    const data = await res.json();
    if (!res.ok) return displayResponse('indicatorsResponse', data, false);
    await loadIndicators();
    displayResponse('indicatorsResponse', { ok:true, message:'Días actualizados', ...data }, true);
  } catch(e){
    displayResponse('indicatorsResponse', { error:'Error guardando días', details:String(e) }, false);
  }
}
export function exportIndicatorsCSV(){
  if (!indicatorsCache) {
    return displayResponse('indicatorsResponse', { error:'Genera indicadores antes de exportar' }, false);
  }
  const y = indicatorsCache.year || '';
  const filtered = filterTablesBySelectedOperators(indicatorsCache) || {};
  const months = IND_MONTHS_ES;

  const sections = [];

  const pushMonthlySection = (title, tableDef, opts) => {
    const firstLabel = opts?.firstLabel || 'OPERARIO';
    const lastLabel = opts?.lastLabel || 'Total';
    const isIndicator = Boolean(opts?.isIndicator);
    const decimals = Number.isFinite(opts?.decimals) ? opts.decimals : (isIndicator ? 1 : 2);

    sections.push([title]);
    sections.push([firstLabel, ...months, lastLabel]);

    const rows = Array.isArray(tableDef?.rows) ? tableDef.rows : [];
    rows.forEach(r => {
      const m = Array.isArray(r.months) ? r.months : [];
      const endVal = isIndicator ? r.average : r.total;
      const cells = months.map((_, idx) => {
        const v = Number(m[idx] || 0);
        if (isIndicator) return formatIndicatorPercentForExport(v, decimals);
        return (Number.isFinite(v) ? v : 0).toFixed(decimals);
      });
      const endCell = (() => {
        const v = Number(endVal || 0);
        if (isIndicator) return formatIndicatorPercentForExport(v, decimals);
        return (Number.isFinite(v) ? v : 0).toFixed(decimals);
      })();
      sections.push([r.operatorName || '', ...cells, endCell]);
    });

    if (tableDef?.totalsRow) {
      const t = tableDef.totalsRow;
      const m = Array.isArray(t.months) ? t.months : [];
      const endVal = isIndicator ? t.average : t.total;
      const cells = months.map((_, idx) => {
        const v = Number(m[idx] || 0);
        if (isIndicator) return formatIndicatorPercentForExport(v, decimals);
        return (Number.isFinite(v) ? v : 0).toFixed(decimals);
      });
      const endCell = (() => {
        const v = Number(endVal || 0);
        if (isIndicator) return formatIndicatorPercentForExport(v, decimals);
        return (Number.isFinite(v) ? v : 0).toFixed(decimals);
      })();
      sections.push([t.operatorName || 'Total general', ...cells, endCell]);
    }

    sections.push([]); // línea en blanco entre secciones
  };

  pushMonthlySection('Indicador (Principal)', filtered.indicator, { firstLabel:'COLABORADOR', lastLabel:'Promedio', isIndicator:true, decimals:1 });
  pushMonthlySection('Suma de Horas (Tabla 1)', filtered.hours, { firstLabel:'OPERARIO', lastLabel:'Total general', isIndicator:false, decimals:1 });
  pushMonthlySection('Días Hábiles Trabajados (Tabla 2 - Manual)', filtered.days, { firstLabel:'OPERARIO', lastLabel:'Total general', isIndicator:false, decimals:0 });

  const delimiter = ';';
  const quoteCell = (v) => {
    const s = v == null ? '' : String(v);
    // Escapar si contiene comillas, delimitador o saltos de línea.
    return /["\r\n]/.test(s) || s.includes(delimiter)
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const csvBody = sections
    .map(r => (Array.isArray(r) ? r : [r]).map(quoteCell).join(delimiter))
    .join('\r\n');

  // BOM para que Excel respete UTF-8 (tildes/ñ)
  const csv = `\ufeff${csvBody}`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `indicadores_${y}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}


export function initIndicatorsEvents() {
  const wire = (id, event, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(event, fn); };
  
  wire('loadIndicatorsBtn', 'click', () => loadIndicators());
  wire('exportIndicatorsBtn', 'click', () => exportIndicatorsCSV());
  wire('saveWorkingDaysBtn', 'click', (e) => {
    e.preventDefault();
    saveWorkingDays();
  });
  
  const opFilter = document.getElementById('indOperatorFilter');
  if (opFilter) {
    opFilter.addEventListener('change', () => {
      updateWorkingDaysOperatorSelect();
      persistIndicatorsSelectionFromUI();
      if (indicatorsCache) renderIndicators(indicatorsCache);
      scheduleIndicatorsAutoLoad({ silent: true });
    });
  }
}

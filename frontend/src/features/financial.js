import { state } from '../core/state.js';
import * as api from '../core/api.js';
import { showToast, displayResponse, escapeHtml, formatCurrencyCOP } from '../ui/ui.js';

// --- VARIABLES Y ESTADO FINANCIERO ---
let financialMachinesCache = [];
let financialMachinesDraft = new Map(); // id -> { hourly_cost, hourly_price }
let financialCompletedCyclesCache = [];
let financialSettlementData = null;
let financialCompletedCyclesLoaded = false;
let financialBreakdownCache = new Map(); // planning_id -> breakdown data

export function getSavedFinancialCostedMolds() {
  try {
    const raw = localStorage.getItem(state.LS_KEYS.financialCostedMoldsHistory);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && Number(item.planningId) > 0)
      .map((item) => ({
        planningId: Number(item.planningId),
        moldName: String(item.moldName || ''),
        clientName: String(item.clientName || ''),
        startDate: String(item.startDate || ''),
        endDate: String(item.endDate || ''),
        laborCost: round2(Number(item.laborCost || 0)),
        materialsCost: round2(Number(item.materialsCost || 0)),
        externalServicesCost: round2(Number(item.externalServicesCost || 0)),
        totalCost: round2(Number(item.totalCost || 0)),
        breakdown: Array.isArray(item.breakdown) ? item.breakdown : [],
        savedAt: String(item.savedAt || ''),
      }));
  } catch (_) {
    return [];
  }
}

export function setSavedFinancialCostedMolds(rows) {
  try {
    localStorage.setItem(state.LS_KEYS.financialCostedMoldsHistory, JSON.stringify(Array.isArray(rows) ? rows : []));
  } catch (_) {
    // Si falla localStorage (cuota/permisos), no romper flujo de la UI.
  }
}

export function upsertSavedFinancialCostedMold(settlement) {
  const id = Number(settlement?.planningId || 0);
  if (!Number.isFinite(id) || id <= 0) return;

  const rows = getSavedFinancialCostedMolds();
  const payload = {
    planningId: id,
    moldName: String(settlement?.moldName || ''),
    clientName: String(settlement?.clientName || ''),
    startDate: String(settlement?.startDate || ''),
    endDate: String(settlement?.endDate || ''),
    laborCost: round2(Number(settlement?.laborCost || 0)),
    materialsCost: round2(Number(settlement?.materialsCost || 0)),
    externalServicesCost: round2(Number(settlement?.externalServicesCost || 0)),
    totalCost: round2(Number(settlement?.totalCost || 0)),
    breakdown: Array.isArray(settlement?.breakdown) ? settlement.breakdown : [],
    savedAt: new Date().toISOString(),
  };

  const idx = rows.findIndex((row) => Number(row?.planningId) === id);
  if (idx >= 0) {
    rows[idx] = payload;
  } else {
    rows.push(payload);
  }

  setSavedFinancialCostedMolds(rows);
}

export function isManagementRole() {
  return String(state.currentUser?.role || '').toLowerCase() === 'management';
}

export function parseMoneyInputValue(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = parseLocaleNumber(s);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return round2(n);
}

export function normalizeFinancialComparable(m) {
  const cost = (m?.hourly_cost === '' ? null : m?.hourly_cost);
  const price = (m?.hourly_price === '' ? null : m?.hourly_price);
  return {
    hourly_cost: cost == null ? null : Number(cost),
    hourly_price: price == null ? null : Number(price),
  };
}

export function buildFinancialSettlementFromBreakdown(data, opts = {}) {
  const laborCost = round2(Number(data?.labor_cost_total || 0));
  const materialsCost = round2(Number(opts?.materialsCost || 0));
  const externalServicesCost = round2(Number(opts?.externalServicesCost || 0));
  return {
    planningId: Number(data?.planning_id || opts?.planningId || 0),
    moldName: String(opts?.moldName ?? data?.mold_name ?? ''),
    clientName: String(opts?.clientName ?? data?.client_name ?? ''),
    startDate: String(opts?.startDate ?? data?.start_date ?? ''),
    endDate: String(opts?.endDate ?? data?.end_date ?? ''),
    laborCost,
    materialsCost,
    externalServicesCost,
    totalCost: round2(laborCost + materialsCost + externalServicesCost),
    breakdown: Array.isArray(data?.machine_breakdown) ? data.machine_breakdown : [],
  };
}

export async function fetchMoldCostBreakdownData(planningId, opts = {}) {
  const id = Number.parseInt(String(planningId || ''), 10);
  if (!Number.isFinite(id) || id <= 0) throw new Error('planning_id inválido');

  const key = String(id);
  const forceRefresh = !!opts?.forceRefresh;
  if (!forceRefresh && financialBreakdownCache.has(key)) {
    return financialBreakdownCache.get(key);
  }

  const data = await api.fetchMoldCostBreakdownData(key);
  financialBreakdownCache.set(key, data);
  return data;
}

export function downloadFinancialSettlementPdf(settlement, responseBoxId = 'financialLiquidationResponse') {
  const printableRows = settlement.breakdown.length
    ? settlement.breakdown.map((row) => `
      <tr>
        <td>${escapeHtml(String(row?.machine_name || ''))}</td>
        <td style="text-align:right;">${Number(row?.total_hours || 0).toFixed(2)}</td>
        <td style="text-align:right;">${escapeHtml(formatCurrencyCOP(Number(row?.partial_cost || 0)))}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="3" style="color:#666;">Sin datos de mano de obra para este ciclo.</td></tr>';

  const range = [settlement.startDate, settlement.endDate]
    .filter(Boolean)
    .map((d) => formatDateDisplay(d))
    .join(' - ');

  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Liquidacion de Costos - Molde ${escapeHtml(settlement.moldName)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #1a1a1a; }
    h1, h2 { margin: 0 0 8px 0; }
    .muted { color: #555; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #ccc; padding: 8px; font-size: 13px; }
    th { background: #f2f2f2; text-align: left; }
    .totals { margin-top: 16px; }
    .totals div { margin: 4px 0; }
    .strong { font-weight: 700; }
  </style>
</head>
<body>
  <h1>Liquidacion y Cierre de Moldes</h1>
  <div class="muted">
    Molde: <strong>${escapeHtml(settlement.moldName)}</strong><br>
    Cliente: <strong>${escapeHtml(settlement.clientName || '—')}</strong><br>
    Planning ID: <strong>#${escapeHtml(String(settlement.planningId))}</strong>${range ? `<br>Rango: <strong>${escapeHtml(range)}</strong>` : ''}
  </div>

  <h2>Desglose de Maquinas</h2>
  <table>
    <thead>
      <tr>
        <th>Maquina</th>
        <th>Horas reales</th>
        <th>Costo parcial (COP)</th>
      </tr>
    </thead>
    <tbody>
      ${printableRows}
    </tbody>
  </table>

  <div class="totals">
    <div>Costo de Mano de Obra: <span class="strong">${escapeHtml(formatCurrencyCOP(settlement.laborCost))}</span></div>
    <div>Costo de Materiales: <span class="strong">${escapeHtml(formatCurrencyCOP(settlement.materialsCost))}</span></div>
    <div>Costo de Servicios Externos: <span class="strong">${escapeHtml(formatCurrencyCOP(settlement.externalServicesCost))}</span></div>
    <div class="strong">Costo Total: ${escapeHtml(formatCurrencyCOP(settlement.totalCost))}</div>
  </div>
</body>
</html>`;

  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) {
    displayResponse(responseBoxId, { error: 'No se pudo abrir la ventana de impresion (popup bloqueado).' }, false);
    return;
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 150);
}

export function downloadFinancialSettlementCsv(settlement, responseBoxId = 'financialLiquidationResponse') {
  const delimiter = ';';
  const rows = [
    ['Liquidacion y Cierre de Moldes'],
    ['Molde', settlement.moldName],
    ['Cliente', settlement.clientName || ''],
    ['Planning ID', settlement.planningId],
    ['Fecha inicio', settlement.startDate || ''],
    ['Fecha fin', settlement.endDate || ''],
    [],
    ['Desglose de Maquinas'],
    ['Maquina', 'Horas reales', 'Costo parcial (COP)'],
  ];

  if (settlement.breakdown.length) {
    settlement.breakdown.forEach((row) => {
      rows.push([
        row?.machine_name || '',
        Number(row?.total_hours || 0).toFixed(2),
        Number(row?.partial_cost || 0).toFixed(2),
      ]);
    });
  } else {
    rows.push(['Sin datos', '', '']);
  }

  rows.push([]);
  rows.push(['Costo de Mano de Obra', settlement.laborCost.toFixed(2)]);
  rows.push(['Costo de Materiales', settlement.materialsCost.toFixed(2)]);
  rows.push(['Costo de Servicios Externos', settlement.externalServicesCost.toFixed(2)]);
  rows.push(['Costo Total', settlement.totalCost.toFixed(2)]);

  const csvBody = rows
    .map((row) => (Array.isArray(row) ? row : [row]).map((cell) => escapeCsvCell(cell, delimiter)).join(delimiter))
    .join('\r\n');
  const csvWithBom = `\ufeff${csvBody}`;

  const blob = new Blob([csvWithBom], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `liquidacion_molde_${settlement.planningId}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  displayResponse(responseBoxId, { message: 'Archivo CSV generado correctamente.' }, true);
}

export function getFinancialNumericInputValue(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return 0;
  const parsed = parseMoneyInputValue(input.value);
  if (Number.isNaN(parsed)) return NaN;
  return parsed == null ? 0 : Number(parsed);
}

export function resetFinancialSettlementView(message) {
  const summary = document.getElementById('financialCycleSummary');
  if (summary) {
    summary.textContent = message || 'Selecciona un ciclo para ver la liquidacion.';
  }

  const tbody = document.querySelector('#financialBreakdownTable tbody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-muted">Sin datos</td></tr>';
  }

  const labor = document.getElementById('financialLaborCost');
  if (labor) labor.value = formatCurrencyCOP(0);

  const total = document.getElementById('financialTotalCost');
  if (total) total.textContent = formatCurrencyCOP(0);

  financialSettlementData = null;
}

export function recalculateFinancialTotalCost() {
  const totalEl = document.getElementById('financialTotalCost');
  if (!totalEl) return;

  const laborCost = Number(financialSettlementData?.labor_cost_total || 0);
  const materials = getFinancialNumericInputValue('financialMaterialsCost');
  const external = getFinancialNumericInputValue('financialExternalServicesCost');

  if (Number.isNaN(materials) || Number.isNaN(external)) {
    totalEl.textContent = '-';
    displayResponse('financialLiquidationResponse', { error: 'Revisa los costos adicionales: solo se permiten valores numericos no negativos.' }, false);
    return;
  }

  const grandTotal = round2(laborCost + materials + external);
  totalEl.textContent = formatCurrencyCOP(grandTotal);
}

export function renderFinancialSettlement(data) {
  const breakdown = Array.isArray(data?.machine_breakdown) ? data.machine_breakdown : [];

  const summary = document.getElementById('financialCycleSummary');
  if (summary) {
    const clientText = String(data?.client_name || '').trim();
    const range = [data?.start_date, data?.end_date]
      .filter(Boolean)
      .map((d) => formatDateDisplay(d))
      .join(' - ');
    summary.textContent = `Molde: ${String(data?.mold_name || 'N/A')} | Cliente: ${clientText || '—'} | Ciclo: #${String(data?.planning_id || '')}${range ? ` | Fechas: ${range}` : ''}`;
  }

  const tbody = document.querySelector('#financialBreakdownTable tbody');
  if (tbody) {
    if (!breakdown.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-muted">No hay work logs para este ciclo.</td></tr>';
    } else {
      tbody.innerHTML = breakdown.map((row) => {
        const machineName = escapeHtml(String(row?.machine_name || ''));
        const hours = Number(row?.total_hours || 0).toFixed(2);
        const partialCost = formatCurrencyCOP(Number(row?.partial_cost || 0));
        return `
          <tr>
            <td>${machineName}</td>
            <td>${hours}</td>
            <td>${partialCost}</td>
          </tr>
        `;
      }).join('');
    }
  }

  const labor = document.getElementById('financialLaborCost');
  if (labor) labor.value = formatCurrencyCOP(Number(data?.labor_cost_total || 0));

  recalculateFinancialTotalCost();
}

export async function loadMoldCostBreakdown(planningId) {
  const id = Number.parseInt(String(planningId || ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    resetFinancialSettlementView('Selecciona un ciclo para ver la liquidacion.');
    return;
  }

  if (!isManagementRole()) {
    resetFinancialSettlementView('Solo Gerencia puede acceder a liquidacion de moldes.');
    return;
  }

  displayResponse('financialLiquidationResponse', { message: 'Calculando costo real...' }, true);
  try {
    const data = await fetchMoldCostBreakdownData(id, { forceRefresh: true });

    financialSettlementData = data;
    renderFinancialSettlement(data);
    try { await renderCostingHistory(); } catch (_) {}
    displayResponse('financialLiquidationResponse', { message: 'Liquidacion cargada.' }, true);
  } catch (e) {
    resetFinancialSettlementView('No se pudo cargar la liquidacion del ciclo seleccionado.');
    displayResponse('financialLiquidationResponse', { error: 'Error cargando liquidacion', details: String(e) }, false);
  }
}

export async function loadCompletedCycles() {
  const select = document.getElementById('financialCompletedCycleSelect');
  if (!select) return;

  if (!isManagementRole()) {
    select.innerHTML = '<option value="">Acceso solo para Gerencia</option>';
    select.disabled = true;
    financialCompletedCyclesCache = [];
    financialCompletedCyclesLoaded = true;
    resetFinancialSettlementView('Solo Gerencia puede acceder a liquidacion de moldes.');
    await renderCostingHistory();
    return;
  }

  select.disabled = false;
  const previous = String(select.value || '').trim();
  select.innerHTML = '<option value="">Cargando ciclos...</option>';

  try {
    const data = await api.fetchCompletedCycles();

    financialCompletedCyclesCache = Array.isArray(data) ? data : [];
    financialCompletedCyclesLoaded = true;
    if (!financialCompletedCyclesCache.length) {
      select.innerHTML = '<option value="">(sin ciclos terminados)</option>';
      resetFinancialSettlementView('No hay ciclos terminados para liquidar.');
      await renderCostingHistory();
      return;
    }

    select.innerHTML = '<option value="">Selecciona un ciclo...</option>'
      + financialCompletedCyclesCache.map((cycle) => {
        const planningId = String(cycle?.planning_id || '');
        const moldName = escapeHtml(String(cycle?.mold_name || 'Molde sin nombre'));
        const startDate = cycle?.start_date ? formatDateDisplay(cycle.start_date) : 'N/A';
        const endDate = cycle?.end_date ? formatDateDisplay(cycle.end_date) : 'N/A';
        return `<option value="${escapeHtml(planningId)}">#${escapeHtml(planningId)} - ${moldName} (${escapeHtml(startDate)} -> ${escapeHtml(endDate)})</option>`;
      }).join('');

    const hasPrevious = previous && financialCompletedCyclesCache.some((c) => String(c?.planning_id) === previous);
    const targetId = hasPrevious ? previous : String(financialCompletedCyclesCache[0]?.planning_id || '');
    if (targetId) {
      select.value = targetId;
      await loadMoldCostBreakdown(targetId);
    } else {
      resetFinancialSettlementView('Selecciona un ciclo para ver la liquidacion.');
    }

    await renderCostingHistory();
  } catch (e) {
    financialCompletedCyclesLoaded = false;
    select.innerHTML = '<option value="">Error cargando ciclos</option>';
    resetFinancialSettlementView('No se pudieron obtener ciclos terminados.');
    displayResponse('financialLiquidationResponse', { error: 'Error cargando ciclos terminados', details: String(e) }, false);
    await renderCostingHistory();
  }
}

export async function renderCostingHistory() {
  const tbody = document.querySelector('#financialCostingHistoryTable tbody');
  if (!tbody) return;

  if (!isManagementRole()) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Solo Gerencia puede ver este historial.</td></tr>';
    const details = document.getElementById('financialCostingHistoryDetails');
    if (details) details.open = false;
    return;
  }

  try {
    const savedRows = getSavedFinancialCostedMolds()
      .sort((a, b) => String(b?.savedAt || '').localeCompare(String(a?.savedAt || '')));

    if (!savedRows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted">(sin moldes costeados guardados)</td></tr>';
      return;
    }

    tbody.innerHTML = savedRows.map((row) => {
      const planningId = String(row?.planningId || '');
      const moldName = escapeHtml(String(row?.moldName || ''));
      const clientName = escapeHtml(String(row?.clientName || '—'));
      const totalCost = Number(row?.totalCost || 0);
      return `
        <tr>
          <td><span class="text-green-500" title="Liquidación guardada">&#10003;</span> ${moldName}</td>
          <td>${clientName}</td>
          <td>${escapeHtml(formatCurrencyCOP(totalCost))}</td>
          <td style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" style="padding:4px 8px; font-size:0.78rem;" data-history-export="excel" data-planning-id="${escapeHtml(planningId)}" title="Descargar Excel">Excel</button>
            <button class="btn btn-secondary btn-sm" style="padding:4px 8px; font-size:0.78rem;" data-history-export="pdf" data-planning-id="${escapeHtml(planningId)}" title="Descargar PDF">PDF</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Error cargando historial</td></tr>';
    displayResponse('financialHistoryResponse', { error: 'Error cargando historial de moldes costeados', details: String(e) }, false);
  }
}

export async function exportCostingHistoryByPlanning(planningId, format) {
  if (!isManagementRole()) {
    displayResponse('financialHistoryResponse', { error: 'Solo Gerencia puede exportar historial de costos.' }, false);
    return;
  }

  const id = Number.parseInt(String(planningId || ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    displayResponse('financialHistoryResponse', { error: 'planning_id inválido para exportación.' }, false);
    return;
  }

  try {
    const saved = getSavedFinancialCostedMolds().find((row) => Number(row?.planningId) === id);
    let settlement = null;

    if (saved) {
      settlement = {
        planningId: Number(saved.planningId),
        moldName: String(saved.moldName || ''),
        clientName: String(saved.clientName || ''),
        startDate: String(saved.startDate || ''),
        endDate: String(saved.endDate || ''),
        laborCost: round2(Number(saved.laborCost || 0)),
        materialsCost: round2(Number(saved.materialsCost || 0)),
        externalServicesCost: round2(Number(saved.externalServicesCost || 0)),
        totalCost: round2(Number(saved.totalCost || 0)),
        breakdown: Array.isArray(saved.breakdown) ? saved.breakdown : [],
      };
    } else {
      const data = await fetchMoldCostBreakdownData(id);
      const cycle = financialCompletedCyclesCache.find((c) => Number(c?.planning_id) === id) || {};
      settlement = buildFinancialSettlementFromBreakdown(data, {
        planningId: id,
        moldName: cycle?.mold_name,
        clientName: cycle?.client_name || data?.client_name,
        startDate: cycle?.start_date || data?.start_date,
        endDate: cycle?.end_date || data?.end_date,
        materialsCost: 0,
        externalServicesCost: 0,
      });
    }

    if (String(format).toLowerCase() === 'pdf') {
      downloadFinancialSettlementPdf(settlement, 'financialHistoryResponse');
    } else {
      downloadFinancialSettlementCsv(settlement, 'financialHistoryResponse');
    }
  } catch (e) {
    displayResponse('financialHistoryResponse', { error: 'Error exportando liquidacion histórica', details: String(e) }, false);
  }
}

export function getFinancialSettlementSnapshot() {
  if (!financialSettlementData || !Number(financialSettlementData?.planning_id)) {
    displayResponse('financialLiquidationResponse', { error: 'Selecciona un ciclo antes de exportar.' }, false);
    return null;
  }

  const materials = getFinancialNumericInputValue('financialMaterialsCost');
  const external = getFinancialNumericInputValue('financialExternalServicesCost');
  if (Number.isNaN(materials) || Number.isNaN(external)) {
    displayResponse('financialLiquidationResponse', { error: 'Corrige los costos adicionales antes de exportar.' }, false);
    return null;
  }

  return buildFinancialSettlementFromBreakdown(financialSettlementData, {
    planningId: financialSettlementData?.planning_id,
    moldName: financialSettlementData?.mold_name,
    clientName: financialSettlementData?.client_name,
    startDate: financialSettlementData?.start_date,
    endDate: financialSettlementData?.end_date,
    materialsCost: materials,
    externalServicesCost: external,
  });
}

export function saveFinancialSettlement() {
  if (!isManagementRole()) {
    displayResponse('financialLiquidationResponse', { error: 'Solo Gerencia puede guardar liquidaciones.' }, false);
    return;
  }

  const settlement = getFinancialSettlementSnapshot();
  if (!settlement) return;

  upsertSavedFinancialCostedMold(settlement);
  renderCostingHistory().catch(() => {});
  displayResponse('financialLiquidationResponse', { message: 'Liquidación guardada en el historial de moldes costeados.' }, true);
}

export function exportFinancialSettlementPdf() {
  if (!isManagementRole()) {
    displayResponse('financialLiquidationResponse', { error: 'Solo Gerencia puede exportar liquidaciones.' }, false);
    return;
  }

  const settlement = getFinancialSettlementSnapshot();
  if (!settlement) return;
  downloadFinancialSettlementPdf(settlement, 'financialLiquidationResponse');
}

export function escapeCsvCell(value, delimiter) {
  const raw = value == null ? '' : String(value);
  if (!raw) return '';
  const mustQuote = raw.includes('"') || raw.includes('\n') || raw.includes('\r') || raw.includes(delimiter);
  return mustQuote ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function exportFinancialSettlementExcel() {
  if (!isManagementRole()) {
    displayResponse('financialLiquidationResponse', { error: 'Solo Gerencia puede exportar liquidaciones.' }, false);
    return;
  }

  const settlement = getFinancialSettlementSnapshot();
  if (!settlement) return;
  downloadFinancialSettlementCsv(settlement, 'financialLiquidationResponse');
}

export async function loadFinancialMachines() {
  const tbody = document.querySelector('#financialMachinesTable tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Cargando...</td></tr>';

  try {
    const res = await fetch(`${state.API_URL}/config/machines`, { credentials: 'include' });
    if (!res.ok) throw new Error('No se pudo cargar máquinas financieras');
    const all = await res.json();
    financialMachinesCache = (Array.isArray(all) ? all : []).filter(m => !!m?.is_active);
    renderFinancialMachinesTable();
  } catch (e) {
    const body = document.querySelector('#financialMachinesTable tbody');
    if (body) body.innerHTML = '<tr><td colspan="4" class="text-muted">Error cargando máquinas</td></tr>';
    displayResponse('financialResponse', { error: 'Error cargando tarifas financieras', details: String(e) }, false);
  }
}

export function renderFinancialMachinesTable() {
  const tbody = document.querySelector('#financialMachinesTable tbody');
  if (!tbody) return;

  const canEdit = isManagementRole();
  const saveBtn = document.getElementById('financialSaveBtn');
  if (saveBtn) saveBtn.classList.toggle('hidden', !canEdit);

  if (!financialMachinesCache.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted">(sin máquinas activas)</td></tr>';
    return;
  }

  tbody.innerHTML = financialMachinesCache.map(m => {
    const id = String(m.id);
    const draft = financialMachinesDraft.get(id) || {};
    const cost = draft.hourly_cost !== undefined ? draft.hourly_cost : m.hourly_cost;
    const price = draft.hourly_price !== undefined ? draft.hourly_price : m.hourly_price;
    const pending = financialMachinesDraft.has(id);
    return `
      <tr data-id="${escapeHtml(id)}" class="${pending ? 'pending-save' : ''}">
        <td>${escapeHtml(id)}</td>
        <td>${escapeHtml(String(m.name || ''))}</td>
        <td><input type="number" class="fin-cost" step="0.01" min="0" ${canEdit ? '' : 'disabled'} value="${cost != null && cost !== '' ? Number(cost) : ''}" placeholder="Ej: 85000"></td>
        <td><input type="number" class="fin-price" step="0.01" min="0" ${canEdit ? '' : 'disabled'} value="${price != null && price !== '' ? Number(price) : ''}" placeholder="Ej: 120000"></td>
      </tr>
    `;
  }).join('');
}

export function captureFinancialDraftFromRow(row) {
  if (!row) return;
  const id = String(row.getAttribute('data-id') || '').trim();
  if (!id) return;

  const costRaw = row.querySelector('.fin-cost')?.value;
  const priceRaw = row.querySelector('.fin-price')?.value;
  const hourly_cost = parseMoneyInputValue(costRaw);
  const hourly_price = parseMoneyInputValue(priceRaw);

  if (Number.isNaN(hourly_cost) || Number.isNaN(hourly_price)) {
    setPendingSave(row, true);
    return;
  }

  const base = financialMachinesCache.find(m => String(m.id) === id);
  const draft = normalizeFinancialComparable({ hourly_cost, hourly_price });
  const current = base ? normalizeFinancialComparable(base) : null;
  const changed = !current
    || Number(draft.hourly_cost ?? -1) !== Number(current.hourly_cost ?? -1)
    || Number(draft.hourly_price ?? -1) !== Number(current.hourly_price ?? -1);

  if (changed) financialMachinesDraft.set(id, { hourly_cost, hourly_price });
  else financialMachinesDraft.delete(id);

  setPendingSave(row, changed);
}

export async function saveFinancialRates() {
  if (!isManagementRole()) {
    displayResponse('financialResponse', { error: 'Solo Gerencia puede guardar cambios financieros' }, false);
    return;
  }

  if (!financialMachinesDraft.size) {
    displayResponse('financialResponse', { message: 'No hay cambios pendientes.' }, true);
    return;
  }

  const updates = [];
  for (const [id, draftRaw] of financialMachinesDraft.entries()) {
    const base = financialMachinesCache.find(m => String(m.id) === String(id));
    if (!base) continue;

    const draft = normalizeFinancialComparable(draftRaw);
    const current = normalizeFinancialComparable(base);
    const changed = Number(draft.hourly_cost ?? -1) !== Number(current.hourly_cost ?? -1)
      || Number(draft.hourly_price ?? -1) !== Number(current.hourly_price ?? -1);
    if (changed) {
      updates.push({
        id,
        body: {
          hourly_cost: draft.hourly_cost,
          hourly_price: draft.hourly_price,
        }
      });
    }
  }

  if (!updates.length) {
    financialMachinesDraft.clear();
    displayResponse('financialResponse', { message: 'No hay cambios reales para guardar.' }, true);
    return;
  }

  displayResponse('financialResponse', { message: `Guardando ${updates.length} cambio(s)...` }, true);
  const failures = [];
  for (const u of updates) {
    try {
      const res = await fetch(`${state.API_URL}/config/machines/${encodeURIComponent(String(u.id))}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(u.body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) failures.push({ id: u.id, error: data?.error || data?.message || 'Error guardando' });
    } catch (e) {
      failures.push({ id: u.id, error: String(e) });
    }
  }

  if (failures.length) {
    displayResponse('financialResponse', { error: `Algunas filas no se guardaron (${failures.length}).`, details: failures }, false);
  } else {
    displayResponse('financialResponse', { message: 'Tarifas financieras guardadas.' }, true);
  }

  financialBreakdownCache.clear();
  financialMachinesDraft.clear();
  try { await loadFinancialMachines(); } catch (_) {}
  try {
    const selectedPlanningId = String(document.getElementById('financialCompletedCycleSelect')?.value || '').trim();
    if (selectedPlanningId) await loadMoldCostBreakdown(selectedPlanningId);
  } catch (_) {}
  try { await renderCostingHistory(); } catch (_) {}
}



export function initFinancialEvents() {
  const wire = (id, event, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(event, fn); };
  
  wire('financialExportPdfBtn', 'click', exportFinancialSettlementPdf);
  wire('financialExportExcelBtn', 'click', exportFinancialSettlementExcel);
  wire('financialSaveLiquidationBtn', 'click', saveFinancialSettlement);
  wire('financialReloadCyclesBtn', 'click', loadCompletedCycles);
  wire('financialCompletedCycleSelect', 'change', () => {
    const val = document.getElementById('financialCompletedCycleSelect')?.value;
    if (val) loadMoldCostBreakdown(val);
  });
  wire('financialReloadBtn', 'click', loadFinancialMachines);
  wire('financialSaveBtn', 'click', saveFinancialRates);

  const historyTable = document.getElementById('financialCostingHistoryTable');
  if (historyTable) {
    historyTable.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-history-export]');
      if (!btn) return;
      const format = btn.getAttribute('data-history-export');
      const planningId = btn.getAttribute('data-planning-id');
      exportCostingHistoryByPlanning(planningId, format);
    });
  }

  const materialsCost = document.getElementById('financialMaterialsCost');
  const externalCost = document.getElementById('financialExternalServicesCost');
  if (materialsCost) materialsCost.addEventListener('input', recalculateFinancialTotalCost);
  if (externalCost) externalCost.addEventListener('input', recalculateFinancialTotalCost);

  const machinesTable = document.getElementById('financialMachinesTable');
  if (machinesTable) {
    machinesTable.addEventListener('input', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) captureFinancialDraftFromRow(tr);
    });
  }
}

// =================================================================================
// public/app.js - Planificación, persistencia, timeout, Datos (sin filtros), Configuración
// (edición de máquinas), Calendario y NUEVO: Indicadores (KPIs) con exportación CSV.
// =================================================================================

const API_URL = 'http://localhost:3000/api';
const SERVER_URL = API_URL.replace(/\/api\/?$/, '');
let authToken = null;
let currentUser = null;

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
const monthNames = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const DEFAULT_INACTIVITY_MINUTES = 60;
let INACTIVITY_TIMEOUT = (parseInt(localStorage.getItem('inactivityMinutes') || DEFAULT_INACTIVITY_MINUTES, 10) || DEFAULT_INACTIVITY_MINUTES) * 60 * 1000;

let inactivityTimer = null;
const HEALTH_INTERVAL_MS = 30000;
let healthTimer = null;

// Máquinas fijas
const FIXED_MACHINES = [
  { id: 'CNC_VF3_1', name: 'CNC VF3 #1', hoursAvailable: 15 },
  { id: 'CNC_VF3_2', name: 'CNC VF3 #2', hoursAvailable: 15 },
  { id: 'FRESADORA_1', name: 'Fresadora #1', hoursAvailable: 14 },
  { id: 'FRESADORA_2', name: 'Fresadora #2', hoursAvailable: 14 },
  { id: 'TORNO_CNC', name: 'Torno CNC', hoursAvailable: 9.5 },
  { id: 'EROSIONADORA', name: 'Erosionadora', hoursAvailable: 14 },
  { id: 'RECTIFICADORA', name: 'Rectificadora', hoursAvailable: 14 },
  { id: 'TORNO', name: 'Torno', hoursAvailable: 14 },
  { id: 'TALADRO_RADIAL', name: 'Taladro radial', hoursAvailable: 14 },
  { id: 'PULIDA', name: 'Pulida', hoursAvailable: 9.5 }
];

// Partes fijas
const FIXED_PARTS = [
  "Anillo de Expulsion", "Anillo de Registro", "Boquilla Principal", "Botador inclinado", "Buje de Expulsion",
  "Buje Principal", "Bujes de Rama", "Correderas", "Deflector de Refrigeración", "Devolvedores", "Electrodos",
  "Flanche actuador hidraulico", "Guia actuadur hidraulico", "Guia Principal", "Guias de expulsion", "Guias de Rama",
  "Haladores", "Hembra", "Hembra empotrada", "Limitadores de Placa Flotante", "Macho", "Macho Central", "Macho empotrado",
  "Molde completo", "Nylon", "Paralelas Porta Macho", "Pilares Soporte", "Placa anillos expulsores", "Placa de Expulsion",
  "Placa Expulsion de Rama", "Placa Portahembras", "Placa Portamachos", "placa respaldo anillos expulsores",
  "Placa Respaldo de Expulsion", "Placa Respaldo Hembras", "Placa Respaldo Inferior", "Placa Respaldo Machos",
  "Placa respaldo portamachos", "Placa Respaldo Superior", "Placa Tope", "Porta Fondo", "Retenedores de Rama",
  "Soporte correderas", "Soporte nylon", "Tapones de Enfriamiento", "Techos"
];

let cachedMolds = [];

const LS_KEYS = {
  plannerState: 'plannerState',
  inactivityMinutes: 'inactivityMinutes'
};

// Helpers
function displayResponse(id, data, success = true) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `response-box ${success ? 'success' : 'error'}`;
  try { el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2); }
  catch { el.textContent = String(data); }
}
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function capitalize(s) { return s ? (s.charAt(0).toUpperCase() + s.slice(1)) : ''; }
function hoursToPayload(v) { if (v === '') return ''; const n = parseFloat(v); return isNaN(n) ? '' : Math.round(n / 0.25) * 0.25; }
async function isDateLaborable(dateStr) {
  try {
    const res = await fetch(`${API_URL}/working/check?date=${encodeURIComponent(dateStr)}`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.laborable;
  } catch { return false; }
}

// Fecha útil
function populateDayMonthYear(dayId, monthId, yearId, minYear = 2016, maxYear = 2027) {
  const daySel = document.getElementById(dayId);
  const monthSel = document.getElementById(monthId);
  const yearSel = document.getElementById(yearId);
  if (daySel) {
    let html = ''; for (let i = 1; i <= 31; i++) html += `<option value="${i}">${i}</option>`;
    daySel.innerHTML = html; daySel.value = new Date().getDate();
  }
  if (monthSel) {
    monthSel.innerHTML = monthNames.map(m => `<option value="${m}">${capitalize(m)}</option>`).join('');
    monthSel.value = monthNames[new Date().getMonth()];
  }
  if (yearSel) {
    let html = ''; for (let y = minYear; y <= maxYear; y++) html += `<option value="${y}">${y}</option>`;
    yearSel.innerHTML = html; yearSel.value = new Date().getFullYear();
  }
}

// Conexión
function updateConnectionStatus(connected) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = connected ? '● Conectado' : '● Desconectado';
  el.classList.toggle('disconnected', !connected);
}
function startHealthCheck() {
  stopHealthCheck();
  const check = async () => {
    try { const res = await fetch(`${SERVER_URL}/health`, { cache: 'no-store' }); updateConnectionStatus(res.ok); }
    catch { updateConnectionStatus(false); }
  };
  check();
  healthTimer = setInterval(check, HEALTH_INTERVAL_MS);
}
function stopHealthCheck() { if (healthTimer) clearInterval(healthTimer); healthTimer = null; }
function showLoginScreen(message = '') {
  const loginContainer = document.getElementById('loginContainer');
  const mainApp = document.getElementById('mainApp');
  if (loginContainer) loginContainer.classList.remove('hidden');
  if (mainApp) mainApp.classList.add('hidden');
  if (message) console.error(message);
  const loginResp = document.getElementById('loginResponse');
  if (loginResp) loginResp.textContent = '';
  const pwd = document.getElementById('password'); if (pwd) pwd.value = 'admin';
  const opSel = document.getElementById('operatorSelectGroup'); if (opSel) opSel.classList.add('hidden');
  authToken = null; currentUser = null;
  localStorage.removeItem('authToken');
  updateConnectionStatus(false);
  stopHealthCheck();
  resetInactivityTimer();
}
function showMainApp(user) {
  currentUser = user;
  authToken = localStorage.getItem('authToken');

  const usrEl = document.getElementById('displayUsername');
  const roleEl = document.getElementById('displayRole');
  const opEl = document.getElementById('displayOperator');
  if (usrEl) usrEl.textContent = user.username || '';
  if (roleEl) roleEl.textContent = (user.role || '').toUpperCase();
  if (opEl) opEl.textContent = user.operatorName || 'N/A';

  const configBtn = document.querySelector('button[data-tab="config"]');
  const planBtn = document.querySelector('button[data-tab="plan"]');
  const worklogBtn = document.querySelector('button[data-tab="worklog"]');
  if (configBtn) configBtn.classList.toggle('hidden', user.role !== 'admin');
  if (planBtn) planBtn.classList.toggle('hidden', user.role === 'operator');
  if (worklogBtn) worklogBtn.classList.toggle('hidden', user.role !== 'operator');

  const loginContainer = document.getElementById('loginContainer');
  const mainApp = document.getElementById('mainApp');
  if (loginContainer) loginContainer.classList.add('hidden');
  if (mainApp) mainApp.classList.remove('hidden');

  updateConnectionStatus(true);
  startHealthCheck();
  startInactivityTimer();

  preloadMoldsForSearch();

  const defaultTab = 'plan';
  openTab(defaultTab);
  setTimeout(() => {
    try { renderFixedPlanningGrid(); restorePlannerStateFromStorage(); } catch (e) { }
    try { loadCalendar(); } catch (e) { }
  }, 100);
}

// Auth
async function updateOperatorSelection() {
  const username = document.getElementById('username').value;
  const group = document.getElementById('operatorSelectGroup');
  const select = document.getElementById('operatorId');
  if (username === 'operarios') {
    if (group) group.classList.remove('hidden');
    if (select) select.innerHTML = '<option>Cargando...</option>';
    try {
      const res = await fetch(`${API_URL}/auth/operators?username=${username}`);
      const ops = await res.json();
      let html = '<option value="">Selecciona...</option>';
      ops.forEach(o => html += `<option value="${o.id}">${escapeHtml(o.name)}</option>`);
      if (select) select.innerHTML = html;
    } catch (e) { if (select) select.innerHTML = '<option value="">Error</option>'; }
  } else {
    if (group) group.classList.add('hidden');
    if (select) select.value = '';
  }
}
async function login(e) {
  if (e) e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const operatorId = document.getElementById('operatorId') ? document.getElementById('operatorId').value : null;
  const body = { username, password };
  if (username === 'operarios') {
    if (!operatorId) {
      displayResponse('loginResponse', 'Selecciona un operario', false);
      return;
    }
    body.operatorId = operatorId;
  }
  try {
    const res = await fetch(`${API_URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (res.ok) {
      displayResponse('loginResponse', 'Sesión iniciada', true);
      localStorage.setItem('authToken', data.token);
      verifySession(data.token);
    }
    else {
      displayResponse('loginResponse', data.error || 'Error login', false);
      updateConnectionStatus(false);
    }
  } catch (e) {
    displayResponse('loginResponse', 'Error conexión', false);
    updateConnectionStatus(false);
  }
}
async function verifySession(token) {
  try {
    const res = await fetch(`${API_URL}/auth/verify`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
      const data = await res.json();
      authToken = token;
      showMainApp(data.user);
    } else {
      showLoginScreen('Sesión inválida');
    }
  } catch (e) { showLoginScreen('Error conexión'); }
}
function logout() { showLoginScreen('Logout'); }

// Tabs (única definición)
function openTab(tabName) {
  document.querySelectorAll('.tab').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
    content.classList.add('hidden');
  });
  const tabBtn = document.querySelector(`button[data-tab="${tabName}"]`);
  if (tabBtn) tabBtn.classList.add('active');
  const tabContent = document.getElementById(`tab-${tabName}`);
  if (tabContent) {
    tabContent.classList.add('active');
    tabContent.classList.remove('hidden');
  }

  if (tabName === 'calendar') try { loadCalendar(); } catch (e) {}
  if (tabName === 'plan') try { renderFixedPlanningGrid(); restorePlannerStateFromStorage(); } catch (e) {}
  if (tabName === 'tiempos') try { loadTiemposMeta(); } catch (e) {}
  if (tabName === 'datos') try { loadDatos(true); } catch (e) {}
  if (tabName === 'config') try { loadMachinesList(); } catch (e) {}
  if (tabName === 'indicators') {
    try { defaultYearForIndicators(); } catch (e) {}
    try { loadOperatorsForIndicators(); } catch (e) {}
  }
}

// Planificador
async function preloadMoldsForSearch() {
  try {
    const res = await fetch(`${API_URL}/datos/meta`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    if (res.ok) {
      const meta = await res.json();
      const moldes = Array.isArray(meta.moldes) ? meta.moldes : [];
      cachedMolds = Array.from(new Set(moldes.map(m => String(m).trim()))).sort((a, b) => a.localeCompare(b));
      const datalist = document.getElementById('planMoldDatalist');
      if (datalist) datalist.innerHTML = cachedMolds.slice(0, 1000).map(m => `<option value="${escapeHtml(m)}">`).join('');
      return;
    }
  } catch (_) { }
  cachedMolds = [];
}
function handleMoldTypeahead(e) {
  const q = (e.target.value || '').toLowerCase().trim();
  const datalist = document.getElementById('planMoldDatalist');
  if (!datalist) return;
  if (!q) {
    datalist.innerHTML = cachedMolds.slice(0, 1000).map(m => `<option value="${escapeHtml(m)}">`).join('');
    return;
  }
  const filtered = cachedMolds.filter(m => m.toLowerCase().includes(q)).slice(0, 1000);
  datalist.innerHTML = filtered.map(m => `<option value="${escapeHtml(m)}">`).join('');
}
function renderFixedPlanningGrid() {
  const container = document.getElementById('planningGridContainer');
  if (!container) return;
  const machines = FIXED_MACHINES;
  const parts = FIXED_PARTS;

  let html = `
    <table id="planningGridFixed">
      <thead>
        <tr>
          <th>Parte</th>
          <th>Cantidad</th>
          ${machines.map(m => `<th>${escapeHtml(m.name)}<br><small>${m.hoursAvailable}h disp.</small></th>`).join('')}
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
                <input type="number" class="hours-input" data-machine-id="${escapeHtml(m.id)}" min="0" step="0.5" placeholder="0">
              </td>`).join('')}
            <td class="total-hours-cell">0.00</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td><strong>Totales</strong></td>
          <td></td>
          ${machines.map(m => `<td id="total-machine-${escapeHtml(m.id)}">0.00</td>`).join('')}
          <td id="grand-total">0.00</td>
        </tr>
      </tfoot>
    </table>
  `;
  container.innerHTML = html;

  const moldInput = document.getElementById('planMoldInput');
  const startDateEl = document.getElementById('gridStartDate');
  if (moldInput) moldInput.addEventListener('input', persistPlannerStateToStorage);
  if (startDateEl) startDateEl.addEventListener('input', persistPlannerStateToStorage);

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
function updateFixedRowTotal(row) {
  const qtyInput = row.querySelector('.qty-input');
  const qty = qtyInput ? (parseFloat(qtyInput.value) || 0) : 0;
  let sumBase = 0;
  row.querySelectorAll('.hours-input').forEach(inp => {
    const v = parseFloat(inp.value);
    sumBase += isNaN(v) ? 0 : v;
  });
  const total = qty * sumBase;
  const cell = row.querySelector('.total-hours-cell');
  if (cell) cell.textContent = total.toFixed(2);
}
function updateFixedColumnTotals() {
  const grid = document.getElementById('planningGridFixed');
  if (!grid) return;
  FIXED_MACHINES.forEach(m => {
    let colSum = 0;
    grid.querySelectorAll(`tbody .hours-input[data-machine-id="${m.id}"]`).forEach(inp => {
      const v = parseFloat(inp.value);
      const row = inp.closest('tr');
      const qty = parseFloat(row.querySelector('.qty-input').value) || 0;
      colSum += (isNaN(v) ? 0 : v) * qty;
    });
    const cell = document.getElementById(`total-machine-${m.id}`);
    if (cell) cell.textContent = colSum.toFixed(2);
  });
}
function updateFixedGrandTotal() {
  const grid = document.getElementById('planningGridFixed');
  if (!grid) return;
  let grand = 0;
  grid.querySelectorAll('tbody .total-hours-cell').forEach(cell => {
    const v = parseFloat(cell.textContent);
    grand += isNaN(v) ? 0 : v;
  });
  const totalEl = document.getElementById('grand-total');
  if (totalEl) totalEl.textContent = grand.toFixed(2);
}

// Persistencia local
function persistPlannerStateToStorage() {
  const state = {
    moldName: document.getElementById('planMoldInput')?.value || '',
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
  try { localStorage.setItem(LS_KEYS.plannerState, JSON.stringify(state)); } catch { }
}
function restorePlannerStateFromStorage() {
  let raw;
  try { raw = localStorage.getItem(LS_KEYS.plannerState); } catch { }
  if (!raw) return;
  let state;
  try { state = JSON.parse(raw); } catch { return; }
  const moldInput = document.getElementById('planMoldInput');
  const startDateEl = document.getElementById('gridStartDate');
  if (moldInput && typeof state.moldName === 'string') moldInput.value = state.moldName;
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
function getTodayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ================================
// SUBMIT GRID PLAN (DEBUG MODE)
// ================================
async function submitGridPlan(e) {
  if (e) e.preventDefault();

  console.clear();
  console.log('========== SUBMIT GRID PLAN ==========');

  // ---------------------------
  // INPUTS PRINCIPALES
  // ---------------------------
  const moldInput = document.getElementById('planMoldInput');
  const startDateEl = document.getElementById('gridStartDate');
  const priorityEl = document.getElementById('prioritySwitch');

  const moldName = moldInput ? moldInput.value.trim() : '';
  const startDate = startDateEl ? startDateEl.value : '';
  const isPriority = !!priorityEl?.checked;

  console.log('moldName:', moldName);
  console.log('startDate (raw):', startDate);
  console.log('isPriority:', isPriority);

  if (!moldName) {
    displayResponse('gridResponse', 'Ingresa/selecciona un Molde.', false);
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
  const tasks = [];

  grid.querySelectorAll('tbody tr').forEach(row => {
    const partName = row.getAttribute('data-part-name');
    if (!partName) return;

    const qty = parseFloat(row.querySelector('.qty-input')?.value);
    if (isNaN(qty) || qty <= 0) return;

    row.querySelectorAll('.hours-input').forEach(inp => {
      const base = parseFloat(inp.value);
      if (isNaN(base) || base <= 0) return;

      const machineId = inp.getAttribute('data-machine-id');
      const machineName =
        (window.FIXED_MACHINES || []).find(m => String(m.id) === String(machineId))?.name
        || machineId;

      const totalHours = Math.round((base * qty) / 0.25) * 0.25;

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
    startDate: startDate || null,
    tasks
  };

  console.log('PAYLOAD ENVIADO:', payload);

  const endpoint = isPriority
    ? `${API_URL}/tasks/plan/priority`
    : `${API_URL}/tasks/plan/block`;

  console.log('ENDPOINT:', endpoint);

  const responseBox = document.getElementById('gridResponse');
  if (responseBox) {
    responseBox.textContent = isPriority
      ? 'Reprogramando con prioridad...'
      : 'Enviando planificación...';
  }

  // ---------------------------
  // FETCH
  // ---------------------------
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
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
    } else {
      console.warn('✖ ERROR BACKEND');
    }

  } catch (err) {
    console.error('ERROR FETCH:', err);
    displayResponse('gridResponse', { error: 'Error al planificar', details: String(err) }, false);
  }
}

// Tiempos de Moldes (mantiene autocompletar y filtros propios)
let tiemposMetaCache = null;

function monthNameToNumber(mesLower){
  const idx = monthNames.indexOf(String(mesLower || '').toLowerCase().trim());
  return idx >= 0 ? (idx + 1) : 0;
}

function toISODate(y, m, d){
  const yy = String(y).padStart(4, '0');
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function findByName(items, name){
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return (Array.isArray(items) ? items : []).find(x => String(x?.name || '').trim().toLowerCase() === n) || null;
}

function populateSelectWithFilterObjects(selectId, filterInputId, items, labelKey){
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const arr = Array.isArray(items) ? items : [];
  sel.dataset.allItems = JSON.stringify(arr);
  sel.innerHTML = arr.map(it => `<option value="${it.id}">${escapeHtml(it[labelKey] || it.name || '')}</option>`).join('');
  sel.selectedIndex = -1;
  const filterInput = document.getElementById(filterInputId);
  if (filterInput) filterInput.value = '';
}

function setupFilterListenerObjects(filterInputId, selectId, labelKey){
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

async function loadTiemposMeta(){
  try {
    const res = await fetch(`${API_URL}/catalogs/meta`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    if (!res.ok) return;
    const meta = await res.json();
    tiemposMetaCache = meta;

    fillDatalist('tmOperarios', (meta.operators || []).map(o => o.name));
    fillDatalist('tmProcesos', (meta.processes || []).map(p => p.name));
    fillDatalist('tmMaquinas', (meta.machines || []).map(m => m.name));
    fillDatalist('tmOperaciones', (meta.operations || []).map(o => o.name));

    populateSelectWithFilterObjects('tmMoldeSelect', 'tmMoldeFilter', meta.molds || [], 'name');
    populateSelectWithFilterObjects('tmParteSelect', 'tmParteFilter', meta.parts || [], 'name');

    setupFilterListenerObjects('tmMoldeFilter', 'tmMoldeSelect', 'name');
    setupFilterListenerObjects('tmParteFilter', 'tmParteSelect', 'name');
  } catch (_) {}
}

async function saveTiempoMolde() {
  const diaSel = document.getElementById('tmDia');
  const mesSel = document.getElementById('tmMes');
  const anioSel = document.getElementById('tmAnio');
  const dia = diaSel ? parseInt(diaSel.value, 10) : NaN;
  const mes = mesSel ? (mesSel.value || '').toLowerCase() : '';
  const anio = anioSel ? parseInt(anioSel.value, 10) : NaN;

  const operario = document.getElementById('tmOperario') ? document.getElementById('tmOperario').value : '';
  const proceso = document.getElementById('tmProceso') ? document.getElementById('tmProceso').value : '';

  const moldeSel = document.getElementById('tmMoldeSelect');
  const parteSel = document.getElementById('tmParteSelect');
  const moldId = moldeSel && moldeSel.selectedOptions.length ? parseInt(moldeSel.selectedOptions[0].value, 10) : NaN;
  const partId = parteSel && parteSel.selectedOptions.length ? parseInt(parteSel.selectedOptions[0].value, 10) : NaN;

  const maquina = document.getElementById('tmMaquina') ? document.getElementById('tmMaquina').value : '';
  const operacion = document.getElementById('tmOperacion') ? document.getElementById('tmOperacion').value : '';
  const horasEl = document.getElementById('tmHoras');
  const horas = horasEl ? parseFloat(horasEl.value) : NaN;

  if (isNaN(dia) || !mes || isNaN(anio) || !operario || !proceso || isNaN(moldId) || isNaN(partId) || !maquina || !operacion || isNaN(horas)) {
    return displayResponse('tmResponse', { error: 'Completa todos los campos' }, false);
  }

  const meta = tiemposMetaCache || {};
  const operator = findByName(meta.operators, operario);
  const machine = findByName(meta.machines, maquina);
  const operatorId = operator ? Number(operator.id) : NaN;
  const machineId = machine ? Number(machine.id) : NaN;

  if (isNaN(operatorId) || isNaN(machineId)) {
    return displayResponse('tmResponse', { error: 'Operario o máquina no existen en catálogo (usa el listado)' }, false);
  }

  const monthNo = monthNameToNumber(mes);
  if (!monthNo) return displayResponse('tmResponse', { error: 'Mes inválido' }, false);
  const work_date = toISODate(anio, monthNo, dia);

  const payload = {
    moldId,
    partId,
    machineId,
    operatorId,
    work_date,
    hours_worked: Math.round(horas / 0.25) * 0.25,
    note: `Proceso: ${proceso} | Operación: ${operacion}`
  };

  try {
    const res = await fetch(`${API_URL}/work_logs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify(payload) });
    const data = await res.json();
    displayResponse('tmResponse', data, res.ok);
    if (res.ok) loadTiemposMeta();
  } catch (e) {
    displayResponse('tmResponse', { error: 'Error de conexión' }, false);
  }
}

// Datos Meta (para Tiempos)
async function loadDatosMeta() {
  try {
    const res = await fetch(`${API_URL}/datos/meta`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    if (!res.ok) return;
    const meta = await res.json();

    fillDatalist('tmOperarios', meta.operarios);
    fillDatalist('tmProcesos', meta.procesos);
    fillDatalist('tmMaquinas', meta.maquinas);
    fillDatalist('tmOperaciones', meta.operaciones);

    populateSelectWithFilter('tmMoldeSelect', 'tmMoldeFilter', meta.moldes || []);
    populateSelectWithFilter('tmParteSelect', 'tmParteFilter', meta.partes || []);

    const tmAnioSel = document.getElementById('tmAnio');
    if (tmAnioSel) {
      const base = []; for (let y = 2016; y <= 2027; y++) base.push(y);
      const merged = Array.from(new Set([...(meta.years || []), ...base])).sort((a, b) => b - a);
      tmAnioSel.innerHTML = merged.map(y => `<option value="${y}">${y}</option>`).join('');
      const currentY = new Date().getFullYear();
      tmAnioSel.value = merged.includes(currentY) ? currentY : String(merged[0]);
    }

    setupFilterListener('tmMoldeFilter', 'tmMoldeSelect');
    setupFilterListener('tmParteFilter', 'tmParteSelect');

  } catch (e) { /* noop */ }
}
function fillDatalist(id, items) {
  const dl = document.getElementById(id);
  if (!dl) return;
  dl.innerHTML = (items || []).map(v => `<option value="${escapeHtml(v)}">`).join('');
}
function populateSelectWithFilter(selectId, filterInputId, items) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.dataset.allItems = JSON.stringify(items || []);
  sel.innerHTML = (items || []).map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  sel.selectedIndex = -1;
  const filterInput = document.getElementById(filterInputId);
  if (filterInput) filterInput.value = '';
}
function setupFilterListener(filterInputId, selectId) {
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

async function loadDatos(reset = true) {
  if (reset) {
    datosPagination.offset = 0;
    datosPagination.items = [];
    datosPagination.total = 0;
  }
  const qs = new URLSearchParams();
  qs.append('limit', String(datosPagination.limit));
  qs.append('offset', String(datosPagination.offset));

  try {
    const res = await fetch(`${API_URL}/datos?${qs.toString()}`, { headers: { 'Authorization': `Bearer ${authToken}` } });
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
function renderDatosTable(items) {
  const tbody = document.querySelector('#datosTable tbody'); if (!tbody) return;
  tbody.innerHTML = items.map(r => {
    const disabled = r.source === 'import' ? 'disabled' : '';
    const showSave = r.source !== 'import';
    const createdAt = r.created_at ? new Date(r.created_at).toLocaleString() : '';
    return `
      <tr data-id="${r.id}" data-source="${r.source || ''}">
        <td><input type="number" min="1" max="31" value="${r.dia ?? ''}" ${disabled}></td>
        <td><input type="text" value="${r.mes ? (capitalize(r.mes)) : ''}" ${disabled}></td>
        <td><input type="number" min="2016" max="2100" value="${r.anio ?? ''}" ${disabled}></td>
        <td><input type="text" value="${escapeHtml(r.nombre_operario ?? '')}" ${disabled}></td>
        <td><input type="text" value="${escapeHtml(r.tipo_proceso ?? '')}" ${disabled}></td>
        <td><input type="text" value="${escapeHtml(r.molde ?? '')}" ${disabled}></td>
        <td><input type="text" value="${escapeHtml(r.parte ?? '')}" ${disabled}></td>
        <td><input type="text" value="${escapeHtml(r.maquina ?? '')}" ${disabled}></td>
        <td><input type="text" value="${escapeHtml(r.operacion ?? '')}" ${disabled}></td>
        <td><input type="number" step="0.25" min="0" max="12" value="${r.horas != null ? Number(r.horas).toFixed(2) : ''}" ${disabled}></td>
        <td>${r.source === 'import' ? 'Importado' : 'Manual'}</td>
        <td>${createdAt}</td>
        <td>
          ${showSave ? `<button class="btn btn-primary btn-sm" onclick="saveDatoRow(${r.id})">Guardar</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="deleteDatoRow(${r.id})">Eliminar</button>
        </td>
      </tr>
    `;
  }).join('');
}
async function mostrarTodosDatos() {
  try {
    if (datosPagination.items.length >= datosPagination.total) return;
    const batchLimit = 1000;
    while (datosPagination.items.length < datosPagination.total) {
      const qs = new URLSearchParams();
      qs.append('limit', String(batchLimit));
      qs.append('offset', String(datosPagination.items.length));
      const res = await fetch(`${API_URL}/datos?${qs.toString()}`, { headers: { 'Authorization': `Bearer ${authToken}` } });
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
async function createDatoManual() {
  const payload = {};
  const map = [
    ['datoDia', 'dia', v => parseInt(v, 10)],
    ['datoMes', 'mes', v => String(v).toLowerCase()],
    ['datoAnio', 'anio', v => parseInt(v, 10)],
    ['datoProceso', 'tipo_proceso', v => v],
    ['datoOperacion', 'operacion', v => v],
    ['datoHoras', 'horas', v => Math.round(parseFloat(v) / 0.25) * 0.25]
  ];
  for (const [id, key, fmt] of map) {
    const el = document.getElementById(id);
    if (el && el.value !== '') payload[key] = fmt(el.value);
  }
  if (Object.keys(payload).length === 0) {
    return displayResponse('datoCrearResponse', { error: 'Ingresa al menos un campo antes de guardar.' }, false);
  }
  try {
    const res = await fetch(`${API_URL}/datos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    displayResponse('datoCrearResponse', data, res.ok);
    if (res.ok) {
      map.forEach(([id]) => { const el = document.getElementById(id); if (el) el.value = ''; });
      loadDatos(true);
      loadDatosMeta();
    }
  } catch (e) {
    displayResponse('datoCrearResponse', { error: 'Error de conexión' }, false);
  }
}
async function saveDatoRow(id) {
  const row = document.querySelector(`#datosTable tbody tr[data-id="${id}"]`);
  if (!row) return;
  const inputs = row.querySelectorAll('input');
  const [diaEl, mesEl, anioEl, operarioEl, procesoEl, moldeEl, parteEl, maquinaEl, operacionEl, horasEl] = inputs;
  const payload = {
    dia: diaEl.value !== '' ? parseInt(diaEl.value, 10) : '',
    mes: mesEl.value !== '' ? mesEl.value.toLowerCase() : '',
    anio: anioEl.value !== '' ? parseInt(anioEl.value, 10) : '',
    tipo_proceso: procesoEl.value,
    operacion: operacionEl.value,
    horas: hoursToPayload(horasEl.value)
  };
  try {
    const res = await fetch(`${API_URL}/datos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    displayResponse('datosResponse', data, res.ok);
    if (res.ok) loadDatosMeta();
  } catch (e) {
    displayResponse('datosResponse', { error: 'Error guardando fila' }, false);
  }
}
async function deleteDatoRow(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  try {
    const res = await fetch(`${API_URL}/datos/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${authToken}` } });
    const data = await res.json();
    displayResponse('datosResponse', data, res.ok);
    if (res.ok) loadDatos(true);
  } catch (e) {
    displayResponse('datosResponse', { error: 'Error eliminando registro' }, false);
  }
}

// Importar
async function importDatosCSV() {
  const fileInput = document.getElementById('importFile'); const file = fileInput?.files?.[0];
  if (!file) return displayResponse('importResponse', { error: 'Selecciona un archivo' }, false);
  const btn = document.getElementById('importBtn'); if (btn) btn.disabled = true;
  const form = new FormData(); form.append('file', file);
  try {
    const res = await fetch(`${API_URL}/import/datos`, { method: 'POST', headers: { 'Authorization': `Bearer ${authToken}` }, body: form });
    const data = await res.json();
    displayResponse('importResponse', data, res.ok);
  } catch (e) {
    displayResponse('importResponse', { error: 'Error de conexión' }, false);
  } finally {
    if (btn) btn.disabled = false;
  }
}
function renderImportDiagnostics(resp) { }

// Calendario
function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  else if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  loadCalendar();
}

function localISOFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let lastDayDetailsContext = null;

async function loadCalendar() {
  if (!authToken) return;
  const display = document.getElementById('calendar-month-year');
  const grid = document.getElementById('calendar-grid');
  if (display) display.textContent = `${capitalize(monthNames[currentMonth])} ${currentYear}`;
  if (grid) grid.innerHTML = 'Cargando...';
  try {
    const res = await fetch(`${API_URL}/calendar/month-view?year=${currentYear}&month=${currentMonth + 1}`, { headers: { 'Authorization': `Bearer ${authToken}` }, cache: 'no-store' });
    const data = await res.json();
    if (res.ok) renderCalendar(currentYear, currentMonth, data.events || {}, data.holidays || {});
    else if (grid) grid.innerHTML = '<p>Error cargar calendario</p>';
  } catch (e) {
    if (grid) grid.innerHTML = 'Error cargar calendario';
  }
}
function renderCalendar(year, month, events = {}, holidays = {}) {
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const todayStr = localISOFromDate(new Date());
  const firstDay = new Date(year, month, 1);
  const startDayIndex = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < startDayIndex; i++) { const d = document.createElement('div'); d.className = 'calendar-day other-month'; grid.appendChild(d); }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const dateStr = localISOFromDate(date);
    const cell = document.createElement('div'); cell.className = 'calendar-day';
    cell.innerHTML = `<div class="day-number">${d}</div>`;
    if (dateStr === todayStr) cell.classList.add('today');
    if (date.getDay() === 0 || date.getDay() === 6) cell.classList.add('weekend');
    if (holidays[dateStr]) { cell.classList.add('holiday'); cell.innerHTML += `<div class="holiday-name">${escapeHtml(holidays[dateStr])}</div>`; }
    if (events && events[d]) {
      const total = Object.values(events[d].machineUsage || {}).reduce((a, b) => a + (b || 0), 0);
      cell.classList.add('has-events');
      cell.innerHTML += `<div class="events-indicator">${total.toFixed(1)}h</div>`;

      const hasPriority = Array.isArray(events[d].tasks) && events[d].tasks.some(t => t && t.isPriority);
      if (hasPriority) {
        cell.innerHTML += `<div class="priority-indicator" title="Prioridad">★</div>`;
      }
    }
    cell.addEventListener('click', () => showDayDetails(date, events[d], holidays[dateStr]));
    grid.appendChild(cell);
  }
}

function getMachineOptionsHtml(selectedName) {
  const base = (window.FIXED_MACHINES || FIXED_MACHINES || []).map(m => m.name);
  const names = Array.from(new Set([selectedName, ...base].filter(Boolean)));
  return names.map(n => `<option value="${escapeHtml(n)}" ${n === selectedName ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
}

function renderDayDetailsView(date, events, holiday) {
  const body = document.getElementById('modal-body');
  const titleEl = document.getElementById('modal-title');
  const dateStr = localISOFromDate(date);
  if (titleEl) titleEl.textContent = date.toLocaleDateString();

  let html = '';
  if (holiday) html += `<p>🎉 ${escapeHtml(holiday)}</p>`;

  if (events && events.tasks && events.tasks.length) {
    // Agrupar por molde
    const byMold = new Map();
    for (const t of events.tasks) {
      const moldKey = String(t.moldId ?? t.mold ?? '');
      if (!byMold.has(moldKey)) byMold.set(moldKey, { moldId: t.moldId, moldName: t.mold, tasks: [] });
      byMold.get(moldKey).tasks.push(t);
    }

    for (const grp of byMold.values()) {
      html += `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:10px;">
          <h4 style="margin:0;">${escapeHtml(grp.moldName || 'Molde')}</h4>
          ${grp.moldId ? `<button class="btn btn-secondary" data-edit-mold="${grp.moldId}" data-mold-name="${escapeHtml(grp.moldName || '')}">Editar este molde</button>` : ''}
        </div>
        <ul>
          ${grp.tasks.map(t => `<li>${escapeHtml(t.machine)}: (${escapeHtml(t.part)}) - ${t.hours}h</li>`).join('')}
        </ul>
      `;
    }
  } else {
    html += '<p>No hay tareas planificadas para este día.</p>';
  }

  html += `<div style="margin-top:12px;"><button class="btn btn-secondary" id="toggleWorkingBtn">Cargando estado...</button><small style="display:block; margin-top:6px;">Esto crea una excepción para este día.</small></div>`;

  html += `<div class="response-box" id="dayDetailsResponse"></div>`;

  if (body) body.innerHTML = html;

  // Hook: editar molde
  document.querySelectorAll('#modal-body button[data-edit-mold]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const moldId = btn.getAttribute('data-edit-mold');
      const moldName = btn.getAttribute('data-mold-name') || '';
      await openMoldEditorView(moldId, moldName);
    });
  });

  // Working toggle
  (async () => {
    const laborable = await isDateLaborable(dateStr);
    const btn = document.getElementById('toggleWorkingBtn');
    if (!btn) return;
    btn.textContent = laborable ? 'Deshabilitar día' : 'Habilitar día';
    btn.onclick = async () => {
      const desired = !laborable;
      try {
        const res = await fetch(`${API_URL}/working/override`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
          body: JSON.stringify({ date: dateStr, isWorking: desired })
        });
        const out = await res.json().catch(() => ({}));

        if (res.ok) {
          displayResponse('dayDetailsResponse', `Día ${desired ? 'habilitado' : 'deshabilitado'} correctamente.`, true);
          hideModal();
          loadCalendar();
        } else {
          displayResponse('dayDetailsResponse', out?.error || 'No se pudo actualizar el estado del día.', false);
        }
      } catch (e) {
        displayResponse('dayDetailsResponse', 'Error de conexión al actualizar el estado del día.', false);
      }
    };
  })();
}

async function openMoldEditorView(moldId, moldName) {
  const body = document.getElementById('modal-body');
  const titleEl = document.getElementById('modal-title');
  if (titleEl) titleEl.textContent = `Editar molde: ${moldName || moldId}`;
  if (body) body.innerHTML = '<p>Cargando plan del molde...</p>';

  try {
    const res = await fetch(`${API_URL}/tasks/plan/mold/${encodeURIComponent(moldId)}`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
      cache: 'no-store'
    });
    const data = await res.json();
    if (!res.ok) {
      if (body) body.innerHTML = `<p>Error: ${escapeHtml(data?.error || 'No se pudo cargar el molde')}</p>`;
      return;
    }

    const entries = Array.isArray(data.entries) ? data.entries : [];
    const startDate = data.startDate || '';
    const endDate = data.endDate || '';

    let html = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
        <div>
          <div class="text-muted">Rango del molde: ${escapeHtml(startDate)} → ${escapeHtml(endDate)}</div>
        </div>
        <button class="btn btn-secondary" id="moldEditorBackBtn">Volver al día</button>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Máquina</th>
              <th>Parte</th>
              <th>Horas</th>
              <th>Nueva fecha</th>
              <th>Nueva máquina</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map(e => {
              const curDate = String(e.date || '');
              const curMachine = String(e.machine || '');
              return `
                <tr data-entry-id="${e.entryId}">
                  <td>${escapeHtml(curDate)}</td>
                  <td>${escapeHtml(curMachine)}</td>
                  <td>${escapeHtml(String(e.part || ''))}</td>
                  <td>${escapeHtml(String(e.hours || 0))}</td>
                  <td><input type="date" class="pe-new-date" value="${escapeHtml(curDate)}"></td>
                  <td>
                    <select class="pe-new-machine">
                      ${getMachineOptionsHtml(curMachine)}
                    </select>
                  </td>
                  <td style="display:flex; gap:8px; align-items:center;">
                    <button class="btn btn-secondary pe-save-btn">Guardar</button>
                    <button class="btn btn-secondary pe-next-btn" title="Busca el siguiente día laborable con cupo y mueve esta tarea">Siguiente disponible</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="response-box" id="moldEditorResponse"></div>
    `;

    if (body) body.innerHTML = html;

    const backBtn = document.getElementById('moldEditorBackBtn');
    if (backBtn) backBtn.onclick = () => {
      if (lastDayDetailsContext) {
        renderDayDetailsView(lastDayDetailsContext.date, lastDayDetailsContext.events, lastDayDetailsContext.holiday);
      }
    };

    body.querySelectorAll('button.pe-save-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tr = btn.closest('tr');
        const entryId = tr?.getAttribute('data-entry-id');
        const newDate = tr?.querySelector('.pe-new-date')?.value;
        const newMachineName = tr?.querySelector('.pe-new-machine')?.value;
        if (!entryId || !newDate || !newMachineName) return;

        try {
          const resp = await fetch(`${API_URL}/tasks/plan/entry/${encodeURIComponent(entryId)}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
              body: JSON.stringify({ date: newDate, machineName: newMachineName })
            }
          );
          const out = await resp.json();
          displayResponse('moldEditorResponse', out?.message || out?.error || 'Listo', resp.ok);
          if (resp.ok) {
            await loadCalendar();
            // Recargar vista del molde para reflejar cambios
            await openMoldEditorView(moldId, moldName);
          } else {
            // Mensaje ya mostrado en moldEditorResponse
          }
        } catch (e) {
          displayResponse('moldEditorResponse', { error: 'Error de conexión', details: String(e) }, false);
        }
      });
    });

    body.querySelectorAll('button.pe-next-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tr = btn.closest('tr');
        const entryId = tr?.getAttribute('data-entry-id');
        const baseDate = tr?.querySelector('.pe-new-date')?.value;
        const machineName = tr?.querySelector('.pe-new-machine')?.value;
        if (!entryId) return;

        try {
          const resp = await fetch(`${API_URL}/tasks/plan/entry/${encodeURIComponent(entryId)}/next-available`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
              body: JSON.stringify({ baseDate, machineName })
            }
          );
          const out = await resp.json();
          displayResponse('moldEditorResponse', out?.message || out?.error || 'Listo', resp.ok);
          if (resp.ok) {
            await loadCalendar();
            await openMoldEditorView(moldId, moldName);
          } else {
            // Mensaje ya mostrado en moldEditorResponse
          }
        } catch (e) {
          displayResponse('moldEditorResponse', { error: 'Error de conexión', details: String(e) }, false);
        }
      });
    });
  } catch (e) {
    if (body) body.innerHTML = `<p>Error: ${escapeHtml(String(e))}</p>`;
  }
}

function showDayDetails(date, events, holiday) {
  const modal = document.getElementById('day-details-modal');
  lastDayDetailsContext = { date, events, holiday };
  renderDayDetailsView(date, events, holiday);
  if (modal) modal.classList.remove('hidden');
}
function hideModal() { const modal = document.getElementById('day-details-modal'); if (modal) modal.classList.add('hidden'); }

// Inactividad
function resetInactivityTimer() { clearTimeout(inactivityTimer); if (authToken) inactivityTimer = setTimeout(logout, INACTIVITY_TIMEOUT); }
function startInactivityTimer() { window.onclick = resetInactivityTimer; window.onkeypress = resetInactivityTimer; resetInactivityTimer(); }
function setInactivityMinutes(minutes) {
  const m = parseInt(minutes, 10);
  if (!isNaN(m) && m > 0) {
    INACTIVITY_TIMEOUT = m * 60 * 1000;
    localStorage.setItem(LS_KEYS.inactivityMinutes, String(m));
    resetInactivityTimer();
  }
}

// ================================
// Configuración: Máquinas (listar/editar)
// ================================
let machinesCache = [];

async function loadMachinesList() {
  try {
    const res = await fetch(`${API_URL}/config/machines`, { headers:{'Authorization':`Bearer ${authToken}`} });
    if (!res.ok) throw new Error('No se pudo cargar máquinas');
    machinesCache = await res.json(); // [{id,name,daily_capacity,is_active,created_at}]
    renderMachinesTable();
  } catch (e) {
    displayResponse('configResponse', { error: 'Error cargando máquinas', details: String(e) }, false);
  }
}
function renderMachinesTable() {
  const tbody = document.querySelector('#machinesTable tbody'); if (!tbody) return;
  const q = (document.getElementById('machineFilter')?.value || '').toLowerCase().trim();
  const list = q ? machinesCache.filter(m => (m.name || '').toLowerCase().includes(q)) : machinesCache;

  tbody.innerHTML = list.map(m => `
    <tr data-id="${m.id}">
      <td>${m.id}</td>
      <td><input type="text" class="mc-name" value="${escapeHtml(m.name || '')}"></td>
      <td><input type="number" class="mc-cap" step="0.5" min="0" value="${m.daily_capacity != null ? Number(m.daily_capacity) : ''}" placeholder="Ej: 14"></td>
      <td style="text-align:center;"><input type="checkbox" class="mc-active" ${m.is_active ? 'checked' : ''}></td>
      <td><button class="btn btn-secondary btn-sm" onclick="saveMachineRow(${m.id})">Guardar</button></td>
    </tr>
  `).join('');
}
async function saveMachineRow(id) {
  const row = document.querySelector(`#machinesTable tbody tr[data-id="${id}"]`); if (!row) return;
  const name = row.querySelector('.mc-name')?.value.trim();
  const capStr = row.querySelector('.mc-cap')?.value.trim();
  const is_active = row.querySelector('.mc-active')?.checked ? 1 : 0;
  const daily_capacity = capStr === '' ? null : parseFloat(capStr);
  if (!name) return displayResponse('configResponse', { error:'Nombre requerido' }, false);
  try {
    const res = await fetch(`${API_URL}/config/machines/${id}`, {
      method:'PUT',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`},
      body: JSON.stringify({ name, daily_capacity, is_active })
    });
    const data = await res.json();
    displayResponse('configResponse', data, res.ok);
    if (res.ok) loadMachinesList();
  } catch (e) {
    displayResponse('configResponse', { error:'Error guardando máquina', details:String(e) }, false);
  }
}

// Crear máquina
async function createMachine(){
  const name = document.getElementById('newMachineName')?.value.trim();
  const capStr = document.getElementById('newMachineCapacity')?.value.trim();
  const daily_capacity = capStr ? parseFloat(capStr) : null;
  if (!name) return displayResponse('configResponse', { error:'Nombre de máquina requerido' }, false);
  try{
    const res = await fetch(`${API_URL}/config/machines`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`},
      body: JSON.stringify({ name, daily_capacity })
    });
    const data = await res.json();
    displayResponse('configResponse', data, res.ok);
    if (res.ok) {
      document.getElementById('newMachineId').value = data.id;
      document.getElementById('newMachineName').value = '';
      document.getElementById('newMachineCapacity').value = '';
      loadMachinesList();
      loadDatosMeta();
    }
  } catch(e){ displayResponse('configResponse', { error:'Error conexión' }, false); }
}

// Crear molde
async function createMold(){
  const name = document.getElementById('newMoldName')?.value.trim();
  if (!name) return displayResponse('configResponse', { error:'Nombre de molde requerido' }, false);
  try{
    const res = await fetch(`${API_URL}/config/molds`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`},
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    displayResponse('configResponse', data, res.ok);
    if (res.ok) { document.getElementById('newMoldId').value = data.id; document.getElementById('newMoldName').value=''; loadDatosMeta(); }
  } catch(e){ displayResponse('configResponse', { error:'Error conexión' }, false); }
}

// Crear parte
async function createPart(){
  const name = document.getElementById('newPartName')?.value.trim();
  if (!name) return displayResponse('configResponse', { error:'Nombre de parte requerido' }, false);
  try{
    const res = await fetch(`${API_URL}/config/parts`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`},
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    displayResponse('configResponse', data, res.ok);
    if (res.ok) { document.getElementById('newPartId').value = data.id; document.getElementById('newPartName').value=''; loadDatosMeta(); }
  } catch(e){ displayResponse('configResponse', { error:'Error conexión' }, false); }
}

// Crear/Actualizar operario con contraseña
async function createOperator(){
  const name = document.getElementById('newOperatorName')?.value.trim();
  const password = document.getElementById('newOperatorPassword')?.value;
  if (!name || !password) return displayResponse('configResponse', { error:'Nombre y contraseña requeridos' }, false);
  try{
    const res = await fetch(`${API_URL}/config/operators`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`},
      body: JSON.stringify({ name, password })
    });
    const data = await res.json();
    displayResponse('configResponse', data, res.ok);
    if (res.ok) { document.getElementById('newOperatorId').value = data.operatorId; document.getElementById('newOperatorName').value=''; document.getElementById('newOperatorPassword').value=''; loadDatosMeta(); }
  } catch(e){ displayResponse('configResponse', { error:'Error conexión' }, false); }
}

// Festivo
async function createHoliday(){
  const date = document.getElementById('newHolidayDate')?.value;
  const name = document.getElementById('newHolidayName')?.value.trim();
  if (!date || !name) return displayResponse('configResponse', { error:'Fecha y nombre requeridos' }, false);
  try{
    const res = await fetch(`${API_URL}/holidays`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`},
      body: JSON.stringify({ date, name })
    });
    const data = await res.json();
    displayResponse('configResponse', data, res.ok);
    if (res.ok) { loadCalendar(); }
  } catch(e){ displayResponse('configResponse', { error:'Error conexión' }, false); }
}

// ================================
// Indicadores (KPIs) con exportación CSV
// ================================
let indicatorsCache = null;
let indicatorsOperatorsCache = null;

function safeDivide(num, den){
  const n = Number(num || 0);
  const d = Number(den || 0);
  if (!d) return 0;
  return n / d;
}

function sum(arr){
  return (Array.isArray(arr) ? arr : []).reduce((acc, v) => acc + Number(v || 0), 0);
}

function emptyMonths(){
  return Array.from({ length: 12 }, () => 0);
}

function getSelectedOperatorIdSet(){
  const container = document.getElementById('indOperatorFilter');
  if (!container) return new Set();
  const checked = Array.from(container.querySelectorAll('input[type="checkbox"][data-operator-id]:checked'));
  return new Set(checked.map(cb => String(cb.getAttribute('data-operator-id'))));
}

function populateOperatorFilter(operators){
  const container = document.getElementById('indOperatorFilter');
  if (!container) return;
  const ops = Array.isArray(operators) ? operators : [];

  const prevSelected = getSelectedOperatorIdSet();
  const shouldKeepPrevious = prevSelected.size > 0;

  container.innerHTML = ops.map(o => {
    const id = String(o.id);
    const checked = shouldKeepPrevious ? prevSelected.has(id) : false;
    const name = escapeHtml(o.name || '');
    return `
      <label class="operator-filter-row">
        <input class="operator-filter-checkbox" type="checkbox" data-operator-id="${escapeHtml(id)}" ${checked ? 'checked' : ''}>
        <span class="operator-filter-name">${name}</span>
      </label>
    `;
  }).join('');
}

function getSelectedOperatorsList(){
  const all = Array.isArray(indicatorsOperatorsCache) ? indicatorsOperatorsCache : [];
  const set = getSelectedOperatorIdSet();
  if (!set.size) return [];
  return all.filter(o => set.has(String(o.id))).sort((a,b) => String(a.name||'').localeCompare(String(b.name||''), 'es'));
}

function updateWorkingDaysOperatorSelect(){
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

function filterTablesBySelectedOperators(data){
  const selected = getSelectedOperatorIdSet();
  const tables = data?.tables || {};

  const hoursRowsAll = Array.isArray(tables?.hours?.rows) ? tables.hours.rows : [];
  const daysRowsAll = Array.isArray(tables?.days?.rows) ? tables.days.rows : [];
  const indRowsAll = Array.isArray(tables?.indicator?.rows) ? tables.indicator.rows : [];

  const filterBySet = (rows) => {
    if (!selected.size) return [];
    return rows.filter(r => selected.has(String(r.operatorId)));
  };

  const hoursRows = filterBySet(hoursRowsAll);
  const daysRows = filterBySet(daysRowsAll);
  const indRows = filterBySet(indRowsAll);

  const hoursTotalsMonths = emptyMonths();
  for (let i = 0; i < 12; i++) hoursTotalsMonths[i] = sum(hoursRows.map(r => r.months?.[i]));
  const hoursTotalGeneral = sum(hoursTotalsMonths);

  const daysTotalsMonths = emptyMonths();
  for (let i = 0; i < 12; i++) daysTotalsMonths[i] = sum(daysRows.map(r => r.months?.[i]));
  const daysTotalGeneral = sum(daysTotalsMonths);

  const indTotalsMonths = emptyMonths();
  for (let i = 0; i < 12; i++) indTotalsMonths[i] = safeDivide(hoursTotalsMonths[i], (daysTotalsMonths[i] || 0) * 8);
  const indAverageTotal = safeDivide(hoursTotalGeneral, (daysTotalGeneral || 0) * 8);

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
      rows: indRows,
      totalsRow: { operatorName: 'Total general', months: indTotalsMonths, average: indAverageTotal },
    },
  };
}

const IND_MONTHS_ES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];

function defaultYearForIndicators(){
  const y = new Date().getFullYear();
  const el = document.getElementById('indYear');
  if (el && !el.value) el.value = String(y);
}

function buildIndicatorsHeaderRow(firstLabel, lastLabel){
  return `<tr>${[
    `<th>${escapeHtml(firstLabel)}</th>`,
    ...IND_MONTHS_ES.map(m=>`<th>${escapeHtml(m)}</th>`),
    `<th>${escapeHtml(lastLabel)}</th>`
  ].join('')}</tr>`;
}

function renderMonthlyTable(tableId, tableDef, options){
  const table = document.getElementById(tableId);
  if (!table) return;
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  if (!thead || !tbody) return;

  const firstLabel = options?.firstLabel || 'OPERARIO';
  const lastLabel = options?.lastLabel || 'Total';
  const isIndicator = Boolean(options?.isIndicator);
  const decimals = Number.isFinite(options?.decimals) ? options.decimals : (isIndicator ? 3 : 2);

  thead.innerHTML = buildIndicatorsHeaderRow(firstLabel, lastLabel);

  const rows = Array.isArray(tableDef?.rows) ? tableDef.rows : [];
  const totalsRow = tableDef?.totalsRow;

  const renderCell = (v) => {
    const n = Number(v || 0);
    if (isIndicator) return (n || 0).toFixed(decimals);
    return (n || 0).toFixed(decimals);
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

function populateWorkingDaysForm(operators){
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

async function loadOperatorsForIndicators(){
  try {
    const res = await fetch(`${API_URL}/catalogs/meta`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const data = await res.json();
    if (!res.ok) return;
    const ops = Array.isArray(data?.operators) ? data.operators : [];
    indicatorsOperatorsCache = ops;
    populateWorkingDaysForm(ops);
    populateOperatorFilter(ops);
    updateWorkingDaysOperatorSelect();
  } catch (_) {}
}

async function loadIndicators(){
  const year = document.getElementById('indYear')?.value;
  const y = Number.parseInt(String(year || ''), 10);
  if (!y) return displayResponse('indicatorsResponse', { error: 'Selecciona un año válido' }, false);

  try{
    const qs = new URLSearchParams({ year: String(y) });
    const res = await fetch(`${API_URL}/indicators/summary?${qs.toString()}`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const data = await res.json();
    indicatorsCache = data;
    if (!res.ok) return displayResponse('indicatorsResponse', data, false);
    renderIndicators(data);
    displayResponse('indicatorsResponse', { ok: true, year: y }, true);
  } catch(e){
    displayResponse('indicatorsResponse', { error:'Error cargando indicadores', details:String(e) }, false);
  }
}

function renderIndicators(data){
  const filtered = filterTablesBySelectedOperators(data);
  renderMonthlyTable('indMainTable', filtered.indicator, { firstLabel:'COLABORADOR', lastLabel:'Promedio', isIndicator:true, decimals:3 });
  renderMonthlyTable('indHoursTable', filtered.hours, { firstLabel:'OPERARIO', lastLabel:'Total general', isIndicator:false, decimals:2 });
  renderMonthlyTable('indDaysTable', filtered.days, { firstLabel:'OPERARIO', lastLabel:'Total general', isIndicator:false, decimals:0 });
  // Si aún no cargó catálogo, usamos fallback del resumen y dejamos el filtro funcional.
  if (!indicatorsOperatorsCache && Array.isArray(data?.operators)) {
    indicatorsOperatorsCache = data.operators;
    populateOperatorFilter(data.operators);
  }
  updateWorkingDaysOperatorSelect();
}

async function saveWorkingDays(){
  const year = Number.parseInt(String(document.getElementById('indYear')?.value || ''), 10);
  const operatorId = Number.parseInt(String(document.getElementById('indDaysOperator')?.value || ''), 10);
  const month = Number.parseInt(String(document.getElementById('indDaysMonth')?.value || ''), 10);
  const workingDays = Number.parseInt(String(document.getElementById('indDaysValue')?.value || ''), 10);

  if (!year || !operatorId || !month || Number.isNaN(workingDays)) {
    return displayResponse('indicatorsResponse', { error:'Completa año, operario, mes y días' }, false);
  }

  try{
    const res = await fetch(`${API_URL}/indicators/working-days`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`},
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
function exportIndicatorsCSV(){
  if (!indicatorsCache) {
    return displayResponse('indicatorsResponse', { error:'Genera indicadores antes de exportar' }, false);
  }
  const rows = [];
  const y = indicatorsCache.year || '';
  const ind = filterTablesBySelectedOperators(indicatorsCache)?.indicator;
  const months = IND_MONTHS_ES;
  rows.push(['Indicador (Principal)']);
  rows.push(['COLABORADOR', ...months, 'Promedio']);
  (ind?.rows || []).forEach(r => {
    rows.push([
      r.operatorName,
      ...months.map((_, idx) => Number(r.months?.[idx] || 0)),
      Number(r.average || 0)
    ]);
  });
  if (ind?.totalsRow) {
    rows.push([
      ind.totalsRow.operatorName || 'Total general',
      ...months.map((_, idx) => Number(ind.totalsRow.months?.[idx] || 0)),
      Number(ind.totalsRow.average || 0)
    ]);
  }

  const csv = rows.map(r => r.map(v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `indicadores_${y}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Entry
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();

  const dateInput = document.getElementById('gridStartDate');
  if (dateInput) {
    const saved = JSON.parse(localStorage.getItem(LS_KEYS.plannerState) || '{}')?.startDate;
    dateInput.value = saved || new Date().toISOString().split('T')[0];
  }

  populateDayMonthYear('tmDia', 'tmMes', 'tmAnio');

  updateConnectionStatus(false);

  const savedToken = localStorage.getItem('authToken');
  if (savedToken) verifySession(savedToken);
  else showLoginScreen();
});

// Limpiar parrilla
function clearPlannerGrid() {
  const grid = document.getElementById('planningGridFixed');
  if (!grid) return;
  grid.querySelectorAll('.qty-input').forEach(inp => { inp.value = ''; });
  grid.querySelectorAll('.hours-input').forEach(inp => { inp.value = ''; });
  grid.querySelectorAll('tbody tr').forEach(row => updateFixedRowTotal(row));
  updateFixedColumnTotals();
  updateFixedGrandTotal();
  try { localStorage.removeItem(LS_KEYS.plannerState); } catch { }
  displayResponse('gridResponse', { message: 'Parrilla limpiada' }, true);
}

// Listeners
function setupEventListeners() {
  const loginBtn = document.getElementById('loginBtn'); if (loginBtn) loginBtn.addEventListener('click', login);
  const usernameSel = document.getElementById('username'); if (usernameSel) usernameSel.addEventListener('change', updateOperatorSelection);
  const logoutBtn = document.getElementById('logoutBtn'); if (logoutBtn) logoutBtn.addEventListener('click', logout);

  // Configuración
  const btnCreateMachine = document.getElementById('createMachineBtn'); if (btnCreateMachine) btnCreateMachine.addEventListener('click', createMachine);
  const btnReloadMachines = document.getElementById('reloadMachinesBtn'); if (btnReloadMachines) btnReloadMachines.addEventListener('click', loadMachinesList);
  const machineFilter = document.getElementById('machineFilter'); if (machineFilter) machineFilter.addEventListener('input', renderMachinesTable);
  const btnCreateMold = document.getElementById('createMoldBtn'); if (btnCreateMold) btnCreateMold.addEventListener('click', createMold);
  const btnCreatePart = document.getElementById('createPartBtn'); if (btnCreatePart) btnCreatePart.addEventListener('click', createPart);
  const btnCreateOperator = document.getElementById('createOperatorBtn'); if (btnCreateOperator) btnCreateOperator.addEventListener('click', createOperator);
  const btnCreateHoliday = document.getElementById('createHolidayBtn'); if (btnCreateHoliday) btnCreateHoliday.addEventListener('click', createHoliday);

  // Tabs
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', (e) => openTab(e.target.getAttribute('data-tab')));
  });

  // Planificador
  const moldInput = document.getElementById('planMoldInput');
  const moldList = document.getElementById('planMoldDatalist');
  if (moldInput && moldList) moldInput.addEventListener('input', () => { handleMoldTypeahead({ target: moldInput }); persistPlannerStateToStorage(); });
  const submitPlanBtn = document.getElementById('submitGridPlanBtn');
  if (submitPlanBtn) submitPlanBtn.addEventListener('click', (e) => submitGridPlan(e));
  const clearPlannerBtn = document.getElementById('clearPlannerBtn');
  if (clearPlannerBtn) clearPlannerBtn.addEventListener('click', clearPlannerGrid);

  // Calendario
  const prevMonthBtn = document.getElementById('prev-month-btn'); if (prevMonthBtn) prevMonthBtn.addEventListener('click', () => changeMonth(-1));
  const nextMonthBtn = document.getElementById('next-month-btn'); if (nextMonthBtn) nextMonthBtn.addEventListener('click', () => changeMonth(1));
  const modalCloseBtn = document.getElementById('modal-close-btn'); if (modalCloseBtn) modalCloseBtn.addEventListener('click', hideModal);

  // Datos
  const btnMostrarTodos = document.getElementById('datosMostrarTodosBtn');
  if (btnMostrarTodos) btnMostrarTodos.addEventListener('click', mostrarTodosDatos);
  const datoCrearBtn = document.getElementById('datoCrearBtn'); if (datoCrearBtn) datoCrearBtn.addEventListener('click', createDatoManual);

  // Tiempos
  const tmGuardarBtn = document.getElementById('tmGuardarBtn'); if (tmGuardarBtn) tmGuardarBtn.addEventListener('click', (e) => { e.preventDefault(); saveTiempoMolde(); });

  // Importar
  const importBtn = document.getElementById('importBtn'); if (importBtn) importBtn.addEventListener('click', importDatosCSV);

  // Indicadores
  const btnLoadInd = document.getElementById('loadIndicatorsBtn'); if (btnLoadInd) btnLoadInd.addEventListener('click', loadIndicators);
  const btnExportInd = document.getElementById('exportIndicatorsBtn'); if (btnExportInd) btnExportInd.addEventListener('click', exportIndicatorsCSV);
  const btnSaveWD = document.getElementById('saveWorkingDaysBtn'); if (btnSaveWD) btnSaveWD.addEventListener('click', (e) => { e.preventDefault(); saveWorkingDays(); });
  const opFilterContainer = document.getElementById('indOperatorFilter');
  if (opFilterContainer) opFilterContainer.addEventListener('change', () => {
    updateWorkingDaysOperatorSelect();
    if (indicatorsCache) renderIndicators(indicatorsCache);
  });
}
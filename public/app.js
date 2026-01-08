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
let bootstrapStatusTimer = null;

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
let plannerPendingMoldName = null;

const LS_KEYS = {
  plannerState: 'plannerState',
  plannerGridConfig: 'plannerGridConfig',
  configPartsDefaultsApplied: 'configPartsDefaultsApplied',
  inactivityMinutes: 'inactivityMinutes',
  indicatorsSelectedOperators: 'indicatorsSelectedOperators'
};

// Planificador: catálogos y configuración de parrilla
let plannerCatalogMachines = []; // [{id,name,daily_capacity,is_active}]
let plannerCatalogParts = [];    // [{id,name,is_active}]
let plannerMachinesInGrid = [];  // [{id,name,daily_capacity}]
let plannerPartsInGrid = [];     // [{name}]

function readPlannerGridConfig() {
  try {
    const raw = localStorage.getItem(LS_KEYS.plannerGridConfig);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    if (!cfg || typeof cfg !== 'object') return null;
    const machineIds = Array.isArray(cfg.machineIds) ? cfg.machineIds.map(v => String(v)) : [];
    const partNames = Array.isArray(cfg.partNames) ? cfg.partNames.map(v => String(v)) : [];
    return { machineIds, partNames };
  } catch { return null; }
}

function writePlannerGridConfig(cfg) {
  try { localStorage.setItem(LS_KEYS.plannerGridConfig, JSON.stringify(cfg)); } catch { }
}

function getDefaultPlannerGridConfig() {
  const fixedMachineNames = new Set((FIXED_MACHINES || []).map(m => String(m.name || '').trim().toLowerCase()));
  const fixedPartNames = new Set((FIXED_PARTS || []).map(p => String(p || '').trim().toLowerCase()));

  const machines = Array.isArray(plannerCatalogMachines) ? plannerCatalogMachines : [];
  const parts = Array.isArray(plannerCatalogParts) ? plannerCatalogParts : [];

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

function applyPlannerGridConfig(cfg) {
  const machines = Array.isArray(plannerCatalogMachines) ? plannerCatalogMachines : [];
  const parts = Array.isArray(plannerCatalogParts) ? plannerCatalogParts : [];

  const machineIdSet = new Set((cfg?.machineIds || []).map(v => String(v)));
  const partNameSet = new Set((cfg?.partNames || []).map(v => String(v).trim().toLowerCase()));

  plannerMachinesInGrid = machines.filter(m => machineIdSet.has(String(m.id)));
  plannerPartsInGrid = parts
    .filter(p => partNameSet.has(String(p.name || '').trim().toLowerCase()))
    .map(p => ({ name: p.name }));

  // Fallback si aún no hay catálogo cargado
  if (!plannerMachinesInGrid.length) plannerMachinesInGrid = (FIXED_MACHINES || []).map(m => ({ id: m.id, name: m.name, daily_capacity: null, hoursAvailable: m.hoursAvailable }));
  if (!plannerPartsInGrid.length) plannerPartsInGrid = (FIXED_PARTS || []).map(name => ({ name }));
}

function renderPlannerGridConfigUI(cfg) {
  const selectedMachinesEl = document.getElementById('plannerMachinesSelected');
  const availableMachinesEl = document.getElementById('plannerMachinesAvailable');
  const selectedPartsEl = document.getElementById('plannerPartsSelected');
  const availablePartsEl = document.getElementById('plannerPartsAvailable');

  if (!selectedMachinesEl || !availableMachinesEl || !selectedPartsEl || !availablePartsEl) return;

  const machineIdSet = new Set((cfg?.machineIds || []).map(v => String(v)));
  const partNameSet = new Set((cfg?.partNames || []).map(v => String(v).trim().toLowerCase()));

  // Si el catálogo aún no cargó, mostramos al menos los defaults para que el usuario
  // vea "En parrilla" (y no quede todo vacío).
  const machines = (Array.isArray(plannerCatalogMachines) && plannerCatalogMachines.length)
    ? plannerCatalogMachines
    : (FIXED_MACHINES || []).map(m => ({ id: m.id, name: m.name, daily_capacity: null, is_active: true }));
  const parts = (Array.isArray(plannerCatalogParts) && plannerCatalogParts.length)
    ? plannerCatalogParts
    : (FIXED_PARTS || []).map(name => ({ id: name, name, is_active: true }));

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

async function initPlannerGridFromCatalogs() {
  // Cargar catálogos (activos) para máquinas/partes
  try {
    const res = await fetch(`${API_URL}/catalogs/meta`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    if (res.ok) {
      const meta = await res.json();
      plannerCatalogMachines = Array.isArray(meta.machines) ? meta.machines : [];
      plannerCatalogParts = Array.isArray(meta.parts) ? meta.parts : [];
    }
  } catch (_) { }

  let cfg = readPlannerGridConfig();
  if (!cfg) {
    cfg = getDefaultPlannerGridConfig();
    writePlannerGridConfig(cfg);
  } else {
    // Sanitizar selección ante cambios de catálogos
    const mset = new Set((plannerCatalogMachines || []).map(m => String(m.id)));
    const pset = new Set((plannerCatalogParts || []).map(p => String(p.name || '').trim().toLowerCase()));

    const beforeMachines = Array.isArray(cfg.machineIds) ? cfg.machineIds.map(String) : [];
    const beforeParts = Array.isArray(cfg.partNames) ? cfg.partNames.map(String) : [];

    // Importante: si el catálogo no cargó (set vacío), NO borramos selección.
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

  // Si por alguna razón quedó vacío (por ejemplo, se guardó una config sin selección),
  // re-aplicamos defaults para que siempre haya una parrilla "principal" visible.
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

// Helpers
const UI_VERBOSE_RESPONSES = false;
let toastTimer = null;

function getOrCreateToastHost() {
  let host = document.getElementById('toastHost');
  if (host) return host;
  host = document.createElement('div');
  host.id = 'toastHost';
  host.className = 'toast-host';
  document.body.appendChild(host);
  return host;
}

function extractUserMessage(data, success) {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    if (typeof data.error === 'string' && data.error.trim()) return data.error;
    if (typeof data.message === 'string' && data.message.trim()) return data.message;
    if (typeof data.note === 'string' && data.note.trim()) return data.note;
  }
  if (!success) return 'Ocurrió un error';
  return null;
}

function showToast(message, success = true) {
  const msg = String(message ?? '').trim();
  if (!msg) return;
  const host = getOrCreateToastHost();
  host.innerHTML = '';

  const toast = document.createElement('div');
  toast.className = `toast ${success ? 'success' : 'error'}`;
  toast.textContent = msg;
  host.appendChild(toast);

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    host.innerHTML = '';
    toastTimer = null;
  }, 3000);
}

// CSP: en algunos entornos se bloquea onclick="..." (script-src-attr 'none').
// Para botones dinámicos usamos delegación con data-action.
try {
  document.addEventListener('click', (ev) => {
    const btn = ev.target?.closest?.('button[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');

    switch (action) {
      case 'save-machine':
        return saveMachineRow(id);
      case 'save-operator':
        return saveOperatorRow(id);
      case 'wl-edit':
        return startEditWorkLogRow(id);
      case 'wl-save':
        return saveWorkLogRow(id);
      case 'dato-save':
        return saveDatoRow(id);
      case 'dato-delete':
        return deleteDatoRow(id);
      default:
        return;
    }
  });
} catch (_) {}

// Si algo falla en runtime (botones que no hacen nada), mostrar el error al usuario.
try {
  window.addEventListener('error', (ev) => {
    const msg = ev?.message || 'Error inesperado en la aplicación';
    showToast(msg, false);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev?.reason;
    const msg = (reason && reason.message) ? reason.message : (reason ? String(reason) : 'Error inesperado (promesa)');
    showToast(msg, false);
  });
} catch (_) {}

function displayResponse(id, data, success = true) {
  const el = document.getElementById(id);
  const msg = extractUserMessage(data, success);
  if (msg) showToast(msg, success);

  try {
    if (!success) console.error('[UI]', id, data);
    else if (UI_VERBOSE_RESPONSES) console.log('[UI]', id, data);
  } catch (_) {}

  // Evitar que se acumulen mensajes largos al final.
  if (!el) return;
  if (!UI_VERBOSE_RESPONSES) {
    el.textContent = '';
    el.className = 'response-box hidden';
    return;
  }

  el.className = `response-box ${success ? 'success' : 'error'}`;
  try { el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2); }
  catch { el.textContent = String(data); }
}
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function capitalize(s) { return s ? (s.charAt(0).toUpperCase() + s.slice(1)) : ''; }

function parseLocaleNumber(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  let normalized = s;
  if (hasComma && hasDot) {
    // Asumimos formato miles con punto y decimales con coma: 1.234,56
    normalized = s.replace(/\./g, '').replace(/,/g, '.');
  } else if (hasComma) {
    normalized = s.replace(/,/g, '.');
  }
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function hoursToPayload(v) {
  if (v === '') return '';
  const n = parseLocaleNumber(v);
  return Number.isFinite(n) ? Math.round(n / 0.25) * 0.25 : '';
}
async function isDateLaborable(dateStr) {
  try {
    const qs = new URLSearchParams();
    qs.set('date', String(dateStr || ''));
    const res = await fetch(`${API_URL}/working/check?${qs.toString()}`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
      cache: 'no-store'
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.laborable;
  } catch { return false; }
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
  const pwd = document.getElementById('password'); if (pwd) pwd.value = '';
  const opSel = document.getElementById('operatorSelectGroup'); if (opSel) opSel.classList.add('hidden');
  authToken = null; currentUser = null;
  localStorage.removeItem('authToken');
  updateConnectionStatus(false);
  stopHealthCheck();
  resetInactivityTimer();

  // Bootstrap inicial (si aplica)
  try { startBootstrapStatusPoll(); } catch (_) {}
}

function startBootstrapStatusPoll() {
  stopBootstrapStatusPoll();
  refreshBootstrapStatus();
  bootstrapStatusTimer = setInterval(() => {
    refreshBootstrapStatus();
  }, 2000);
}

function stopBootstrapStatusPoll() {
  if (bootstrapStatusTimer) clearInterval(bootstrapStatusTimer);
  bootstrapStatusTimer = null;
}

// ================================
// Bootstrap inicial: crear admin + jefe una sola vez
// ================================
async function refreshBootstrapStatus() {
  const card = document.getElementById('bootstrapCard');
  if (!card) return;

  const adminGroup = document.getElementById('bootstrapAdminGroup');
  const jefeGroup = document.getElementById('bootstrapJefeGroup');
  const btn = document.getElementById('bootstrapBtn');

  try {
    const res = await fetch(`${API_URL}/auth/bootstrap/status`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    const can = !!data?.canBootstrap;
    const adminExists = !!data?.adminExists;
    const jefeExists = !!data?.jefeExists;

    // Mostrar el bloque si falta al menos una cuenta
    card.classList.toggle('hidden', !can);

    // Mostrar solo los inputs que faltan
    if (adminGroup) adminGroup.classList.toggle('hidden', adminExists);
    if (jefeGroup) jefeGroup.classList.toggle('hidden', jefeExists);

    // Habilitar botón solo cuando se puede ejecutar
    if (btn) btn.disabled = !can;
  } catch (_) {
    // Sin conexión / backend caído: mostramos el bloque pero deshabilitado
    // para que quede claro que depende del estado real en BD.
    card.classList.remove('hidden');
    if (btn) btn.disabled = true;
    displayResponse('bootstrapResponse', { error: 'No se pudo consultar el estado del bootstrap (sin conexión)' }, false);
  }
}

async function runBootstrapInit(e) {
  if (e) e.preventDefault();
  const adminPassword = document.getElementById('bootstrapAdminPassword')?.value;
  const jefePassword = document.getElementById('bootstrapJefePassword')?.value;

  const payload = { adminPassword, jefePassword };

  try {
    const res = await fetch(`${API_URL}/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    displayResponse('bootstrapResponse', data?.message || data?.error || data, res.ok);
    if (res.ok) {
      // limpiamos inputs y ocultamos si ya no aplica
      const a = document.getElementById('bootstrapAdminPassword'); if (a) a.value = '';
      const j = document.getElementById('bootstrapJefePassword'); if (j) j.value = '';
      await refreshBootstrapStatus();
    }
  } catch (err) {
    displayResponse('bootstrapResponse', { error: 'Error de conexión', details: String(err) }, false);
  }
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

  // Tabs por rol
  const role = String(user.role || '').toLowerCase();
  const isOperator = role === 'operator';
  const canSeeAll = role === 'admin' || role === 'planner';

  // Por defecto, mostramos todo a admin/planner y limitamos al operario solo a "tiempos"
  document.querySelectorAll('.tabs .tab').forEach(btn => {
    const tab = btn.getAttribute('data-tab');
    if (isOperator) {
      btn.classList.toggle('hidden', !(tab === 'tiempos' || tab === 'registros'));
    } else if (canSeeAll) {
      btn.classList.remove('hidden');
    } else {
      // fallback conservador: si algún rol nuevo aparece, dejamos visibles solo tabs "seguros"
      btn.classList.toggle('hidden', tab === 'config');
    }
  });

  const loginContainer = document.getElementById('loginContainer');
  const mainApp = document.getElementById('mainApp');
  if (loginContainer) loginContainer.classList.add('hidden');
  if (mainApp) mainApp.classList.remove('hidden');

  updateConnectionStatus(true);
  startHealthCheck();
  startInactivityTimer();
  stopBootstrapStatusPoll();

  preloadMoldsForSearch();

  const defaultTab = isOperator ? 'tiempos' : 'plan';
  openTab(defaultTab);
  setTimeout(() => {
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
      if (data.sessionId) localStorage.setItem('sessionId', String(data.sessionId));
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
async function logout() {
  try {
    const token = authToken || localStorage.getItem('authToken');
    const sessionId = localStorage.getItem('sessionId');
    if (token && sessionId) {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ sessionId })
      }).catch(() => null);
    }
  } catch (_) {}

  try { localStorage.removeItem('sessionId'); } catch (_) {}
  showLoginScreen('Logout');
}

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
  if (tabName === 'plan') {
    try { initPlannerTab(); } catch (e) {}
  }
  if (tabName === 'tiempos') try { loadTiemposMeta(); } catch (e) {}
  if (tabName === 'registros') {
    try { ensureWorkLogsMeta(); } catch (e) {}
    try { loadWorkLogsHistory(true); } catch (e) {}
  }
  if (tabName === 'datos') try { loadDatos(true); } catch (e) {}
  if (tabName === 'config') {
    try { loadMachinesList(); } catch (e) {}
    try { loadConfigPartsChecklist(); } catch (e) {}
    try { loadOperatorsList(); } catch (e) {}
  }
  if (tabName === 'indicators') {
    try { defaultYearForIndicators(); } catch (e) {}
    try { loadOperatorsForIndicators(); } catch (e) {}
  }
  if (tabName === 'sesiones') {
    try { loadSessionsHistory(); } catch (e) {}
  }
}

// ================================
// Configuración: Partes (checklist is_active)
// ================================

async function loadConfigPartsChecklist() {
  const container = document.getElementById('configPartsChecklist');
  if (!container) return;

  container.innerHTML = '<div style="color:#6c757d">Cargando...</div>';

  let parts = [];
  try {
    const res = await fetch(`${API_URL}/config/parts`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    if (!res.ok) throw new Error('No se pudo cargar partes');
    parts = await res.json();
  } catch (e) {
    container.innerHTML = '<div style="color:#6c757d">Error cargando partes</div>';
    return;
  }

  // Aplicar predeterminados UNA SOLA VEZ: si todo estaba activo, dejamos activos solo los FIXED_PARTS.
  const alreadyApplied = (() => {
    try { return localStorage.getItem(LS_KEYS.configPartsDefaultsApplied) === '1'; } catch { return false; }
  })();

  if (!alreadyApplied) {
    const anyInactive = (parts || []).some(p => !p?.is_active);
    const fixedSet = new Set((FIXED_PARTS || []).map(n => String(n || '').trim().toLowerCase()));

    // Solo auto-aplicamos si venía "todo activo" (estado típico inicial)
    if (!anyInactive && parts.length) {
      const updates = parts.map(p => {
        const desired = fixedSet.has(String(p.name || '').trim().toLowerCase());
        const current = !!p.is_active;
        if (current === desired) return null;
        return fetch(`${API_URL}/config/parts/${encodeURIComponent(p.id)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ is_active: desired ? 1 : 0 })
          }
        ).catch(() => null);
      }).filter(Boolean);

      if (updates.length) {
        await Promise.all(updates);
        // Recargar lista ya normalizada
        try {
          const res2 = await fetch(`${API_URL}/config/parts`, { headers: { 'Authorization': `Bearer ${authToken}` } });
          if (res2.ok) parts = await res2.json();
        } catch { }
      }
    }

    try { localStorage.setItem(LS_KEYS.configPartsDefaultsApplied, '1'); } catch { }
  }

  container.innerHTML = (parts || []).map(p => {
    const checked = p?.is_active ? 'checked' : '';
    return `<label style="display:flex; gap:8px; align-items:center; margin:4px 0;">
      <input type="checkbox" data-config-part-id="${escapeHtml(String(p.id))}" ${checked}>
      <span>${escapeHtml(String(p.name || ''))}</span>
    </label>`;
  }).join('') || '<div style="color:#6c757d">(sin partes)</div>';
}

async function initPlannerTab() {
  await initPlannerGridFromCatalogs();
  renderFixedPlanningGrid();
  restorePlannerStateFromStorage();
}

// Planificador
function getPlannerSelectedMoldName() {
  const sel = document.getElementById('planMoldSelect');
  if (!sel || !sel.selectedOptions || !sel.selectedOptions.length) return '';
  const opt = sel.selectedOptions[0];
  return String(opt.value || opt.textContent || '').trim();
}

function selectPlannerMoldByName(name) {
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

async function preloadMoldsForSearch() {
  try {
    // Preferir catálogo (tabla molds) para que lo creado en Configuración aparezca aquí
    let res = await fetch(`${API_URL}/catalogs/meta`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    if (!res.ok) {
      // Fallback: valores únicos desde "datos" (útil si aún no sincronizas catálogos)
      res = await fetch(`${API_URL}/datos/meta`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    }

    if (res.ok) {
      const meta = await res.json();
      const moldsRaw = Array.isArray(meta.molds) ? meta.molds : [];
      const fromCatalog = moldsRaw
        .map(m => (m && typeof m === 'object') ? m.name : m)
        .filter(Boolean);
      const fromDatos = Array.isArray(meta.moldes) ? meta.moldes : [];
      const moldes = fromCatalog.length ? fromCatalog : fromDatos;

      cachedMolds = Array.from(new Set(moldes.map(m => String(m).trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b));

      populateSelectWithFilter('planMoldSelect', 'planMoldFilter', cachedMolds);
      setupFilterListener('planMoldFilter', 'planMoldSelect');

      if (plannerPendingMoldName) {
        if (selectPlannerMoldByName(plannerPendingMoldName)) plannerPendingMoldName = null;
      }
      return;
    }
  } catch (_) { }
  cachedMolds = [];
}

function fmtHours(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(2) : '0.00';
}

function buildMoldProgressContent(data, fallbackMoldName) {
  const pct = (data?.totals?.percentComplete == null) ? null : Number(data.totals.percentComplete);
  const plannedTotal = Number(data?.totals?.plannedTotalHours || 0);
  const plannedToDate = Number(data?.totals?.plannedToDateHours || 0);
  const actualToDate = Number(data?.totals?.actualToDateHours || 0);
  const variance = Number(data?.totals?.varianceToDateHours || 0);

  const planStart = data?.planWindow?.startDate ? String(data.planWindow.startDate) : '';
  const planEnd = data?.planWindow?.endDate ? String(data.planWindow.endDate) : '';
  const planRange = (planStart || planEnd) ? `${planStart || '—'} → ${planEnd || '—'}` : '';

  const barPct = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const varianceLabel = variance >= 0 ? `+${fmtHours(variance)}h` : `${fmtHours(variance)}h`;
  const varianceColor = variance > 0.01 ? 'var(--warning)' : (variance < -0.01 ? 'var(--success)' : 'var(--text-secondary)');

  return `
    <div style="display:flex; justify-content:space-between; gap:12px; align-items:baseline; flex-wrap:wrap;">
      <div>
        <div style="font-weight:800;">Avance vs plan</div>
        <div style="color:var(--text-muted); font-size:0.9rem;">Molde: <strong>${escapeHtml(String(data?.moldName || fallbackMoldName || ''))}</strong></div>
        ${planRange ? `<div style="color:var(--text-muted); font-size:0.85rem;">Plan: ${escapeHtml(planRange)}</div>` : ''}
      </div>
      <div style="color:var(--text-muted); font-size:0.9rem;">Hoy: ${escapeHtml(String(data?.today || ''))}</div>
    </div>

    <div class="mold-progress-bar" aria-label="Progreso">
      <div style="width:${barPct}%;"></div>
    </div>

    <div class="mold-progress-grid">
      <div class="mold-progress-kpi">
        <div class="label">% completado (real/plan total)</div>
        <div class="value">${pct == null ? '—' : `${pct.toFixed(2)}%`}</div>
      </div>
      <div class="mold-progress-kpi">
        <div class="label">Plan total</div>
        <div class="value">${fmtHours(plannedTotal)}h</div>
      </div>
      <div class="mold-progress-kpi">
        <div class="label">Plan a hoy</div>
        <div class="value">${fmtHours(plannedToDate)}h</div>
      </div>
      <div class="mold-progress-kpi">
        <div class="label">Real a hoy (vs plan a hoy)</div>
        <div class="value" style="color:${varianceColor}">${fmtHours(actualToDate)}h (${escapeHtml(varianceLabel)})</div>
      </div>
    </div>
  `;
}

async function renderInProgressMoldList() {
  const container = document.getElementById('inProgressMoldList');
  if (!container) return;

  if (!authToken) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '<div style="color:var(--text-muted)">Cargando moldes en curso...</div>';

  try {
    const res = await fetch(`${API_URL}/molds/in-progress`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
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

    container.innerHTML = molds.map(m => `<div class="mold-progress-panel">${buildMoldProgressContent(m, m?.moldName)}</div>`).join('');
  } catch (_) {
    container.innerHTML = '<div style="color:var(--danger)">Error de conexión cargando moldes en curso</div>';
  }
}

function renderFixedPlanningGrid() {
  const container = document.getElementById('planningGridContainer');
  if (!container) return;
  const machines = (plannerMachinesInGrid && plannerMachinesInGrid.length) ? plannerMachinesInGrid : FIXED_MACHINES;
  const parts = (plannerPartsInGrid && plannerPartsInGrid.length) ? plannerPartsInGrid.map(p => p.name) : FIXED_PARTS;

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
                <input type="number" class="hours-input" data-machine-id="${escapeHtml(String(m.id))}" min="0" step="0.01" placeholder="0">
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
      </tfoot>
    </table>
  `;
  container.innerHTML = html;

  const startDateEl = document.getElementById('gridStartDate');
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
  const qty = qtyInput ? (parseLocaleNumber(qtyInput.value) || 0) : 0;
  let sumBase = 0;
  row.querySelectorAll('.hours-input').forEach(inp => {
    const v = parseLocaleNumber(inp.value);
    sumBase += isNaN(v) ? 0 : v;
  });
  const total = qty * sumBase;
  const cell = row.querySelector('.total-hours-cell');
  if (cell) cell.textContent = total.toFixed(2);
}
function updateFixedColumnTotals() {
  const grid = document.getElementById('planningGridFixed');
  if (!grid) return;
  const machines = (plannerMachinesInGrid && plannerMachinesInGrid.length) ? plannerMachinesInGrid : FIXED_MACHINES;
  machines.forEach(m => {
    let colSum = 0;
    grid.querySelectorAll(`tbody .hours-input[data-machine-id="${String(m.id)}"]`).forEach(inp => {
      const v = parseLocaleNumber(inp.value);
      const row = inp.closest('tr');
      const qty = parseLocaleNumber(row.querySelector('.qty-input').value) || 0;
      colSum += (isNaN(v) ? 0 : v) * qty;
    });
    const cell = document.getElementById(`total-machine-${String(m.id)}`);
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
    moldName: getPlannerSelectedMoldName(),
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
  const startDateEl = document.getElementById('gridStartDate');
  if (typeof state.moldName === 'string' && state.moldName) {
    plannerPendingMoldName = state.moldName;
    selectPlannerMoldByName(state.moldName);
  }
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
  const startDateEl = document.getElementById('gridStartDate');
  const priorityEl = document.getElementById('prioritySwitch');

  const moldName = getPlannerSelectedMoldName();
  const startDate = startDateEl ? startDateEl.value : '';
  const isPriority = !!priorityEl?.checked;

  console.log('moldName:', moldName);
  console.log('startDate (raw):', startDate);
  console.log('isPriority:', isPriority);

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
  const tasks = [];

  grid.querySelectorAll('tbody tr').forEach(row => {
    const partName = row.getAttribute('data-part-name');
    if (!partName) return;

    const qty = parseLocaleNumber(row.querySelector('.qty-input')?.value);
    if (isNaN(qty) || qty <= 0) return;

    row.querySelectorAll('.hours-input').forEach(inp => {
      const base = parseLocaleNumber(inp.value);
      if (isNaN(base) || base <= 0) return;

      const machineId = inp.getAttribute('data-machine-id');
      const machinesForPlan = (plannerMachinesInGrid && plannerMachinesInGrid.length)
        ? plannerMachinesInGrid
        : (window.FIXED_MACHINES || FIXED_MACHINES || []);
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

// Cache de planificación para Tiempos (por mes): key = "YYYY-MM"
const tiemposPlanMonthCache = new Map();
let tiemposPlanListenersBound = false;

function getTiemposSelectedYMD() {
  const diaSel = document.getElementById('tmDia');
  const mesSel = document.getElementById('tmMes');
  const anioSel = document.getElementById('tmAnio');
  const day = diaSel ? parseInt(diaSel.value, 10) : NaN;
  const mes = mesSel ? (mesSel.value || '').toLowerCase() : '';
  const year = anioSel ? parseInt(anioSel.value, 10) : NaN;
  const monthNo = monthNameToNumber(mes);
  return { year, monthNo, day };
}

async function fetchTiemposPlannedMonth(year, monthNo) {
  if (!year || !monthNo) return null;
  const key = `${String(year).padStart(4, '0')}-${String(monthNo).padStart(2, '0')}`;
  if (tiemposPlanMonthCache.has(key)) return tiemposPlanMonthCache.get(key);

  const res = await fetch(`${API_URL}/calendar/month-view?year=${encodeURIComponent(year)}&month=${encodeURIComponent(monthNo)}`,
    { headers: { 'Authorization': `Bearer ${authToken}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const events = data?.events || {};
  tiemposPlanMonthCache.set(key, events);
  return events;
}

function uniqueIdName(items) {
  const m = new Map();
  (items || []).forEach(it => {
    const id = it?.id;
    if (id == null) return;
    if (!m.has(String(id))) m.set(String(id), { id: Number(id), name: String(it?.name || '') });
  });
  return Array.from(m.values()).sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
}

function setDatalistValues(dlId, values) {
  const dl = document.getElementById(dlId);
  if (!dl) return;
  dl.innerHTML = (values || []).map(v => `<option value="${escapeHtml(v)}">`).join('');
}

async function refreshTiemposPlannedOptions() {
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

function bindTiemposPlannedListeners() {
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
      // Al cambiar molde, recalcula partes y máquinas.
      if (parteSel) parteSel.value = '';
      if (maquinaSel) maquinaSel.value = '';
      refreshTiemposPlannedOptions();
    });
  }
  if (parteSel) {
    parteSel.addEventListener('change', () => {
      if (maquinaSel) maquinaSel.value = '';
      refreshTiemposPlannedOptions();
    });
  }
}

function populateDayMonthYear(daySelectId, monthSelectId, yearSelectId) {
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
    monthSel.innerHTML = monthNames.map(m => `<option value="${m}">${capitalize(m)}</option>`).join('');
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
  if (monthSel && !monthSel.value) monthSel.value = String(monthNames[currentMonthIdx] || '');
  if (yearSel && !yearSel.value) yearSel.value = String(currentYearLocal);
}

function setTiemposDateToColombiaToday() {
  const iso = typeof getColombiaTodayISO === 'function' ? getColombiaTodayISO() : '';
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
  const [yy, mm, dd] = iso.split('-').map(Number);
  if (!yy || !mm || !dd) return;

  const daySel = document.getElementById('tmDia');
  const monthSel = document.getElementById('tmMes');
  const yearSel = document.getElementById('tmAnio');
  if (daySel) daySel.value = String(dd);
  if (monthSel) monthSel.value = String(monthNames[mm - 1] || '');
  if (yearSel) yearSel.value = String(yy);
}

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

    // Día / Mes / Año: no dependen de BD, pero el año puede enriquecerse con meta.years
    populateDayMonthYear('tmDia', 'tmMes', 'tmAnio');
    const tmAnioSel = document.getElementById('tmAnio');
    if (tmAnioSel) {
      const base = []; for (let y = 2016; y <= (new Date().getFullYear() + 2); y++) base.push(y);
      const merged = Array.from(new Set([...(meta.years || []), ...base])).sort((a, b) => b - a);
      tmAnioSel.innerHTML = merged.map(y => `<option value="${y}">${y}</option>`).join('');
      // Importante: el navegador selecciona el primer option automáticamente.
      // Por eso seteamos explícitamente la fecha a "hoy Colombia".
    }

    // Dejar por defecto hoy (Colombia), pero sigue siendo editable.
    setTiemposDateToColombiaToday();

    fillDatalist('tmOperarios', (meta.operators || []).map(o => o.name));
    fillDatalist('tmProcesos', (meta.processes || []).map(p => p.name));
    fillDatalist('tmOperaciones', (meta.operations || []).map(o => o.name));

    // En Tiempos, Molde/Parte/Máquina dependen de lo planificado en Calendario.
    bindTiemposPlannedListeners();
    await refreshTiemposPlannedOptions();
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
  const maquinaSel = document.getElementById('tmMaquinaSelect');
  const moldId = moldeSel && moldeSel.selectedOptions.length ? parseInt(moldeSel.selectedOptions[0].value, 10) : NaN;
  const partId = parteSel && parteSel.selectedOptions.length ? parseInt(parteSel.selectedOptions[0].value, 10) : NaN;
  const machineId = maquinaSel && maquinaSel.selectedOptions.length ? parseInt(maquinaSel.selectedOptions[0].value, 10) : NaN;
  const operacion = document.getElementById('tmOperacion') ? document.getElementById('tmOperacion').value : '';
  const motivo = document.getElementById('tmMotivo') ? document.getElementById('tmMotivo').value : '';
  const horasEl = document.getElementById('tmHoras');
  const horas = horasEl ? parseLocaleNumber(horasEl.value) : NaN;

  if (isNaN(dia) || !mes || isNaN(anio) || !operario || !proceso || isNaN(moldId) || isNaN(partId) || isNaN(machineId) || !operacion || isNaN(horas)) {
    return displayResponse('tmResponse', { error: 'Completa todos los campos' }, false);
  }

  const meta = tiemposMetaCache || {};
  const operator = findByName(meta.operators, operario);
  const operatorId = operator ? Number(operator.id) : NaN;

  if (isNaN(operatorId)) {
    return displayResponse('tmResponse', { error: 'Operario no existe en catálogo (usa el listado)' }, false);
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
    hours_worked: round2(horas),
    reason: String(motivo || '').trim() || null,
    note: `Proceso: ${proceso} | Operación: ${operacion}`
  };

  try {
    const res = await fetch(`${API_URL}/work_logs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify(payload) });
    const data = await res.json();
    displayResponse('tmResponse', data, res.ok);
    if (res.ok) {
      const motivoEl = document.getElementById('tmMotivo');
      if (motivoEl) motivoEl.value = '';
      loadTiemposMeta();
    }
  } catch (e) {
    displayResponse('tmResponse', { error: 'Error de conexión' }, false);
  }
}

// ================================
// Registros (historial editable de work_logs)
// ================================

async function loadWorkLogsHistory(reset = true) {
  const tbody = document.querySelector('#workLogsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="16" style="color:#6c757d">Cargando...</td></tr>';

  try {
    const res = await fetch(`${API_URL}/work_logs?limit=200&offset=0`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const data = await res.json();
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="16" style="color:#6c757d">Error cargando registros</td></tr>';
      return displayResponse('workLogsResponse', data, false);
    }
    renderWorkLogsTable(Array.isArray(data) ? data : []);
    displayResponse('workLogsResponse', { total: Array.isArray(data) ? data.length : 0 }, true);
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="16" style="color:#6c757d">Error de conexión</td></tr>';
    displayResponse('workLogsResponse', { error: 'Error de conexión', details: String(e) }, false);
  }
}

function fmtDateTime(v) {
  if (!v) return '';
  try { return new Date(v).toLocaleString(); } catch { return String(v); }
}
function fmtDateOnly(v) {
  if (!v) return '';
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toISOString().slice(0, 10);
  } catch { return String(v); }
}

function getColombiaTodayISO() {
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

function daysDiffFromColombiaToday(dateStr) {
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

function setWorkLogRowEditing(row, enabled, role) {
  if (!row) return;
  const isOperator = String(role || '').toLowerCase() === 'operator';

  row.querySelectorAll('input, select').forEach(el => {
    // Campos siempre no editables
    if (el.classList.contains('wl-operario') && isOperator) {
      el.disabled = true;
      return;
    }
    // Evitar tocar inputs fuera de la fila
    el.disabled = !enabled;
  });

  const editBtn = row.querySelector('button.wl-edit');
  const saveBtn = row.querySelector('button.wl-save');
  if (editBtn) editBtn.style.display = enabled ? 'none' : '';
  if (saveBtn) saveBtn.style.display = enabled ? '' : 'none';
}

function findRowByDataId(tbodySelector, id) {
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

function startEditWorkLogRow(id) {
  try {
    const row = findRowByDataId('#workLogsTable tbody', id);
    if (!row) {
      displayResponse('workLogsResponse', { error: 'No se encontró el registro para editar' }, false);
      return;
    }
    const canEdit = row.getAttribute('data-can-edit') === '1';
    if (!canEdit) {
      displayResponse('workLogsResponse', { error: 'No tienes permiso para editar este registro' }, false);
      return;
    }
    setWorkLogRowEditing(row, true, currentUser?.role);
  } catch (e) {
    displayResponse('workLogsResponse', { error: 'No se pudo habilitar edición', details: String(e) }, false);
  }
}

function renderWorkLogsTable(rows) {
  const tbody = document.querySelector('#workLogsTable tbody');
  if (!tbody) return;

  const role = String(currentUser?.role || '').toLowerCase();
  const isOperator = role === 'operator';
  const canEditAll = role === 'admin' || role === 'planner';

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="16" style="color:#6c757d">(sin registros)</td></tr>';
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
    const recordedAt = fmtDateTime(r.recorded_at);
    let day = '', mes = '', anio = '';
    try {
      const d = workDateIso ? new Date(workDateIso) : null;
      if (d && !Number.isNaN(d.getTime())) {
        day = String(d.getDate());
        const mIdx = d.getMonth();
        mes = capitalize(monthNames[mIdx] || '');
        anio = String(d.getFullYear());
      }
    } catch (_) {}

    const po = parseProcesoOperacion(r.note);
    const planned = (r.planned_hours == null) ? '' : Number(r.planned_hours).toFixed(2);
    const deviation = (r.deviation_pct == null) ? '' : `${Number(r.deviation_pct).toFixed(2)}%`;
    const isAlert = Number(r.is_alert) === 1 || String(r.is_alert).toLowerCase() === 'true';

    const baseDateForEdit = r.work_date || (r.recorded_at ? fmtDateOnly(r.recorded_at) : null);
    const diffDays = baseDateForEdit ? daysDiffFromColombiaToday(baseDateForEdit) : 9999;
    const tooOld = diffDays > 2;
    const canEdit = canEditAll || (isOperator && !tooOld);

    // Campos bloqueados por defecto; se habilitan solo al presionar "Editar".
    const disabled = 'disabled';

    const rowClass = isAlert ? 'class="wl-alert"' : '';

    const monthOptions = monthNames.map(m => {
      const label = capitalize(m);
      const sel = label === mes ? 'selected' : '';
      return `<option value="${escapeHtml(label)}" ${sel}>${escapeHtml(label)}</option>`;
    }).join('');

    return `
      <tr data-id="${escapeHtml(String(r.id))}" data-can-edit="${canEdit ? '1' : '0'}" ${rowClass}>
        <td><input type="number" class="wl-dia" min="1" max="31" value="${escapeHtml(day)}" ${disabled}></td>
        <td>
          <select class="wl-mes" ${disabled}>
            ${monthOptions}
          </select>
        </td>
        <td><input type="number" class="wl-anio" min="2016" max="2100" value="${escapeHtml(anio)}" ${disabled}></td>
        <td><input type="text" class="wl-operario" list="wlOperarios" value="${escapeHtml(r.operator_name || '')}" ${disabled}></td>
        <td><input type="text" class="wl-proceso" list="wlProcesos" value="${escapeHtml(po.proceso || '')}" ${disabled}></td>
        <td><input type="text" class="wl-molde" list="wlMoldes" value="${escapeHtml(r.mold_name || '')}" ${disabled}></td>
        <td><input type="text" class="wl-parte" list="wlPartes" value="${escapeHtml(r.part_name || '')}" ${disabled}></td>
        <td><input type="text" class="wl-maquina" list="wlMaquinas" value="${escapeHtml(r.machine_name || '')}" ${disabled}></td>
        <td><input type="text" class="wl-operacion" list="wlOperaciones" value="${escapeHtml(po.operacion || '')}" ${disabled}></td>
        <td><input type="number" class="wl-hours" step="0.25" min="0" max="24" value="${r.hours_worked != null ? Number(r.hours_worked).toFixed(2) : ''}" ${disabled}></td>
        <td><input type="text" class="wl-reason" value="${escapeHtml(r.reason || '')}" ${disabled}></td>
        <td>${escapeHtml(planned)}</td>
        <td class="wl-deviation">${escapeHtml(deviation)}</td>
        <td>${escapeHtml(recordedAt)}</td>
        <td>${escapeHtml(r.note || '')}</td>
        <td>
          ${canEdit ? `
            <button class="btn btn-primary btn-sm wl-edit" data-action="wl-edit" data-id="${escapeHtml(String(r.id))}">Editar</button>
            <button class="btn btn-primary btn-sm wl-save" style="display:none" data-action="wl-save" data-id="${escapeHtml(String(r.id))}">Guardar</button>
          ` : `<span style="color:#6c757d">Bloqueado</span>`}
        </td>
      </tr>
    `;
  }).join('');

  // Asegurar que el campo operario quede bloqueado para rol operario incluso al entrar a editar.
  if (isOperator && currentUser?.role) {
    tbody.querySelectorAll('tr[data-can-edit="1"]').forEach(tr => {
      const op = tr.querySelector('input.wl-operario');
      if (op) op.disabled = true;
    });
  }
}

async function saveWorkLogRow(id) {
  const row = findRowByDataId('#workLogsTable tbody', id);
  if (!row) return;
  // Asegurar meta (catálogos) para resolver IDs por nombre
  if (!tiemposMetaCache) {
    try { await loadTiemposMeta(); } catch (_) {}
  }
  const meta = tiemposMetaCache || {};

  const dia = Number(row.querySelector('.wl-dia')?.value);
  const mesName = String(row.querySelector('.wl-mes')?.value || '').toLowerCase();
  const anio = Number(row.querySelector('.wl-anio')?.value);

  const operarioName = String(row.querySelector('.wl-operario')?.value || '').trim();
  const proceso = String(row.querySelector('.wl-proceso')?.value || '').trim();
  const moldeName = String(row.querySelector('.wl-molde')?.value || '').trim();
  const parteName = String(row.querySelector('.wl-parte')?.value || '').trim();
  const maquinaName = String(row.querySelector('.wl-maquina')?.value || '').trim();
  const operacion = String(row.querySelector('.wl-operacion')?.value || '').trim();

  const hours = row.querySelector('.wl-hours')?.value;
  const reason = row.querySelector('.wl-reason')?.value;

  if (!dia || !mesName || !anio || !operarioName || !proceso || !moldeName || !parteName || !maquinaName || !operacion) {
    return displayResponse('workLogsResponse', { error: 'Completa todos los campos principales antes de guardar' }, false);
  }

  const monthNo = monthNameToNumber(mesName);
  if (!monthNo) return displayResponse('workLogsResponse', { error: 'Mes inválido' }, false);
  const work_date = toISODate(anio, monthNo, dia);

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
  const role = String(currentUser?.role || '').toLowerCase();
  if (role === 'operator' && currentUser?.operatorId && Number(currentUser.operatorId) !== operatorId) {
    return displayResponse('workLogsResponse', { error: 'No puedes cambiar el operario del registro' }, false);
  }

  const payload = {
    work_date,
    operatorId,
    moldId,
    partId,
    machineId,
    hours_worked: Number(hours),
    reason: String(reason || '').trim() || null,
    note: `Proceso: ${proceso} | Operación: ${operacion}`,
  };

  try {
    const res = await fetch(`${API_URL}/work_logs/${encodeURIComponent(String(id))}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
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

// ================================
// Sesiones (placeholder - backend se agrega aparte)
// ================================

async function loadSessionsHistory() {
  const tbody = document.querySelector('#sessionsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="color:#6c757d">Cargando...</td></tr>';

  try {
    const res = await fetch(`${API_URL}/auth/sessions`, { headers: { 'Authorization': `Bearer ${authToken}` } });
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
async function loadDatosMeta() {
  try { await loadTiemposMeta(); } catch (_) {}
  try { await preloadMoldsForSearch(); } catch (_) {}
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
          ${showSave ? `<button class="btn btn-primary btn-sm" data-action="dato-save" data-id="${escapeHtml(String(r.id))}">Guardar</button>` : ''}
          <button class="btn btn-danger btn-sm" data-action="dato-delete" data-id="${escapeHtml(String(r.id))}">Eliminar</button>
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
    if (res.ok) {
      try { loadDatos(true); } catch (_) {}
      try { loadDatosMeta(); } catch (_) {}
    }
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
  const progressList = document.getElementById('inProgressMoldList');
  if (display) display.textContent = `${capitalize(monthNames[currentMonth])} ${currentYear}`;
  if (grid) grid.innerHTML = 'Cargando...';
  if (progressList) progressList.innerHTML = '';
  try {
    const res = await fetch(`${API_URL}/calendar/month-view?year=${currentYear}&month=${currentMonth + 1}`, { headers: { 'Authorization': `Bearer ${authToken}` }, cache: 'no-store' });
    const data = await res.json();
    if (res.ok) {
      const events = data.events || {};
      renderCalendar(currentYear, currentMonth, events, data.holidays || {});
      try { renderInProgressMoldList(); } catch (_) {}
    }
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
                <tr data-entry-id="${e.entryId ?? ''}">
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
        const rawEntryId = tr?.getAttribute('data-entry-id');
        const entryId = Number.parseInt(String(rawEntryId || ''), 10);
        const newDate = tr?.querySelector('.pe-new-date')?.value;
        const newMachineName = tr?.querySelector('.pe-new-machine')?.value;
        if (!Number.isFinite(entryId) || entryId <= 0) {
          displayResponse('moldEditorResponse', { error: 'Entrada inválida (sin id). Recarga el calendario e inténtalo de nuevo.' }, false);
          return;
        }
        if (!newDate || !newMachineName) return;

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
        const rawEntryId = tr?.getAttribute('data-entry-id');
        const entryId = Number.parseInt(String(rawEntryId || ''), 10);
        const baseDate = tr?.querySelector('.pe-new-date')?.value;
        const machineName = tr?.querySelector('.pe-new-machine')?.value;
        if (!Number.isFinite(entryId) || entryId <= 0) {
          displayResponse('moldEditorResponse', { error: 'Entrada inválida (sin id). Recarga el calendario e inténtalo de nuevo.' }, false);
          return;
        }

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
      <td><button class="btn btn-secondary btn-sm" data-action="save-machine" data-id="${escapeHtml(String(m.id))}">Guardar</button></td>
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
    if (res.ok) {
      document.getElementById('newMoldId').value = data.id;
      document.getElementById('newMoldName').value='';
      loadDatosMeta();
      preloadMoldsForSearch();
    }
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
    if (res.ok) {
      document.getElementById('newPartId').value = data.id;
      document.getElementById('newPartName').value='';
      loadDatosMeta();
      loadConfigPartsChecklist();
    }
  } catch(e){ displayResponse('configResponse', { error:'Error conexión' }, false); }
}

// Crear/Actualizar operario con contraseña
async function createOperator(){
  const name = document.getElementById('newOperatorName')?.value.trim();
  if (!name) return displayResponse('configResponse', { error:'Nombre requerido' }, false);

  // Crear operario (sin contraseña aquí). La contraseña se gestiona desde la lista.
  try{
    const res = await fetch(`${API_URL}/config/operators`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`},
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    displayResponse('configResponse', data, res.ok);
    if (res.ok) {
      const idEl = document.getElementById('newOperatorId');
      if (idEl) idEl.value = data.operatorId;
      document.getElementById('newOperatorName').value='';
      try { loadOperatorsList(); } catch (_) {}
      try { loadDatosMeta(); } catch (_) {}
      try { loadOperatorsForIndicators(); } catch (_) {}
    }
  } catch(e){ displayResponse('configResponse', { error:'Error conexión' }, false); }
}

// ================================
// Configuración: Operarios (listar/editar + selección Indicadores)
// ================================
let operatorsCache = [];

function normalizeIndicatorsSelectionAgainstOperators(ops){
  const list = Array.isArray(ops) ? ops : [];
  const activeIds = new Set(list.filter(o => o && o.is_active).map(o => String(o.id)));
  const selected = loadIndicatorsSelectedOperatorIds();
  const next = new Set(Array.from(selected).filter(id => activeIds.has(String(id))));
  const changed = next.size !== selected.size;
  if (changed) saveIndicatorsSelectedOperatorIds(next);
  return next;
}

async function loadOperatorsList(){
  const tbody = document.querySelector('#operatorsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="color:#6c757d">Cargando...</td></tr>';

  try{
    const res = await fetch(`${API_URL}/config/operators`, { headers:{'Authorization':`Bearer ${authToken}`} });
    const data = await res.json();
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:#6c757d">Error cargando operarios</td></tr>';
      return;
    }
    operatorsCache = Array.isArray(data) ? data : [];
    renderOperatorsTable();
  } catch(e){
    tbody.innerHTML = '<tr><td colspan="5" style="color:#6c757d">Error de conexión</td></tr>';
  }
}

function renderOperatorsTable(){
  const tbody = document.querySelector('#operatorsTable tbody');
  if (!tbody) return;
  const selected = normalizeIndicatorsSelectionAgainstOperators(operatorsCache);

  if (!operatorsCache.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:#6c757d">(sin operarios)</td></tr>';
    return;
  }

  tbody.innerHTML = operatorsCache.map(o => {
    const id = String(o.id);
    const isActive = !!o.is_active;
    const isSelected = selected.has(id);
    return `
      <tr data-id="${escapeHtml(id)}">
        <td>${escapeHtml(id)}</td>
        <td><input type="text" class="op-name" value="${escapeHtml(o.name || '')}"></td>
        <td style="text-align:center;"><input type="checkbox" class="op-active" ${isActive ? 'checked' : ''}></td>
        <td style="text-align:center;"><input type="checkbox" class="op-indicators" data-operator-id="${escapeHtml(id)}" ${isSelected ? 'checked' : ''} ${isActive ? '' : 'disabled'}></td>
        <td><input type="password" class="op-password" placeholder="Nueva contraseña"></td>
        <td style="display:flex; gap:8px; align-items:center;">
          <button class="btn btn-secondary btn-sm" data-action="save-operator" data-id="${escapeHtml(id)}">Guardar</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function saveOperatorRow(id){
  const row = findRowByDataId('#operatorsTable tbody', id);
  if (!row) return;
  const name = row.querySelector('.op-name')?.value.trim();
  const is_active = row.querySelector('.op-active')?.checked ? 1 : 0;
  const password = row.querySelector('.op-password')?.value ?? '';
  if (!name) return displayResponse('configResponse', { error:'Nombre requerido' }, false);

  const body = { name, is_active };
  if (String(password).trim() !== '') body.password = String(password);

  try{
    const res = await fetch(`${API_URL}/config/operators/${encodeURIComponent(String(id))}`, {
      method:'PUT',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`},
      body: JSON.stringify(body)
    });
    const data = await res.json();
    displayResponse('configResponse', data, res.ok);
    if (res.ok) {
      const passEl = row.querySelector('.op-password');
      if (passEl) passEl.value = '';
      try { loadOperatorsList(); } catch (_) {}
      try { loadDatosMeta(); } catch (_) {}
      try { loadOperatorsForIndicators(); } catch (_) {}
    }
  } catch(e){
    displayResponse('configResponse', { error:'Error guardando operario', details:String(e) }, false);
  }
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
let indicatorsAutoLoadTimer = null;

function loadIndicatorsSelectedOperatorIds(){
  try {
    const raw = localStorage.getItem(LS_KEYS.indicatorsSelectedOperators);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map(v => String(v)));
  } catch { return new Set(); }
}

function saveIndicatorsSelectedOperatorIds(idSet){
  try {
    const arr = Array.from(idSet || []).map(v => String(v));
    localStorage.setItem(LS_KEYS.indicatorsSelectedOperators, JSON.stringify(arr));
  } catch {}
}

function clearIndicatorsTables(){
  ['indMainTable','indHoursTable','indDaysTable'].forEach(id => {
    const table = document.getElementById(id);
    if (!table) return;
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (thead) thead.innerHTML = '';
    if (tbody) tbody.innerHTML = '';
  });
}

function scheduleIndicatorsAutoLoad(options){
  if (indicatorsAutoLoadTimer) clearTimeout(indicatorsAutoLoadTimer);
  indicatorsAutoLoadTimer = setTimeout(() => {
    indicatorsAutoLoadTimer = null;
    loadIndicators(options);
  }, 250);
}

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
  if (container) {
    const checked = Array.from(container.querySelectorAll('input[type="checkbox"][data-operator-id]:checked'));
    return new Set(checked.map(cb => String(cb.getAttribute('data-operator-id'))));
  }
  // Checklist se movió a Configuración: la fuente es localStorage
  return loadIndicatorsSelectedOperatorIds();
}

function persistIndicatorsSelectionFromUI(){
  const container = document.getElementById('indOperatorFilter');
  if (!container) return;
  saveIndicatorsSelectedOperatorIds(getSelectedOperatorIdSet());
}

function populateOperatorFilter(operators){
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

async function loadIndicators(options){
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
    const res = await fetch(`${API_URL}/indicators/summary?${qs.toString()}`, { headers: { 'Authorization': `Bearer ${authToken}` } });
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

function renderIndicators(data){
  // Si no hay selección, no renderizamos nada para evitar mostrar totales 0 confusos.
  const selected = getSelectedOperatorIdSet();
  if (!selected.size) {
    clearIndicatorsTables();
    updateWorkingDaysOperatorSelect();
    return;
  }

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
  const bootstrapBtn = document.getElementById('bootstrapBtn'); if (bootstrapBtn) bootstrapBtn.addEventListener('click', runBootstrapInit);
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
  const planMoldFilter = document.getElementById('planMoldFilter');
  const planMoldSelect = document.getElementById('planMoldSelect');
  if (planMoldFilter && planMoldSelect) {
    setupFilterListener('planMoldFilter', 'planMoldSelect');
    planMoldFilter.addEventListener('input', persistPlannerStateToStorage);
    planMoldSelect.addEventListener('change', persistPlannerStateToStorage);
  }

  // Configurar parrilla (máquinas/partes) usando is_active (ya filtrado desde /catalogs/meta)
  const machinesSelBox = document.getElementById('plannerMachinesSelected');
  const machinesAvailBox = document.getElementById('plannerMachinesAvailable');
  const partsSelBox = document.getElementById('plannerPartsSelected');
  const partsAvailBox = document.getElementById('plannerPartsAvailable');
  [machinesSelBox, machinesAvailBox, partsSelBox, partsAvailBox].forEach(box => {
    if (!box) return;
    box.addEventListener('change', async (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLInputElement) || t.type !== 'checkbox') return;

      const cfg = readPlannerGridConfig() || getDefaultPlannerGridConfig();

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

      writePlannerGridConfig(cfg);
      applyPlannerGridConfig(cfg);
      renderPlannerGridConfigUI(cfg);

      // Re-render parrilla preservando lo ya ingresado
      persistPlannerStateToStorage();
      renderFixedPlanningGrid();
      restorePlannerStateFromStorage();
    });
  });
  const submitPlanBtn = document.getElementById('submitGridPlanBtn');
  if (submitPlanBtn) submitPlanBtn.addEventListener('click', (e) => submitGridPlan(e));
  const clearPlannerBtn = document.getElementById('clearPlannerBtn');
  if (clearPlannerBtn) clearPlannerBtn.addEventListener('click', clearPlannerGrid);

  // Configuración: checklist de partes
  const partsChecklist = document.getElementById('configPartsChecklist');
  if (partsChecklist) {
    partsChecklist.addEventListener('change', async (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLInputElement) || t.type !== 'checkbox') return;
      const id = t.getAttribute('data-config-part-id');
      if (!id) return;
      try {
        const res = await fetch(`${API_URL}/config/parts/${encodeURIComponent(id)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ is_active: t.checked ? 1 : 0 })
          }
        );
        const out = await res.json();
        displayResponse('configResponse', out?.message || out?.error || 'Listo', res.ok);
        if (res.ok) {
          // refresca metas dependientes (Plan/Tiempos)
          loadDatosMeta();
        }
      } catch (e) {
        displayResponse('configResponse', { error: 'Error guardando parte', details: String(e) }, false);
      }
    });
  }

  // Configuración: selección de operarios para Indicadores
  const operatorsTable = document.getElementById('operatorsTable');
  if (operatorsTable) {
    operatorsTable.addEventListener('change', () => {
      const selected = new Set();
      operatorsTable.querySelectorAll('input.op-indicators[data-operator-id]:checked').forEach(cb => {
        const id = cb.getAttribute('data-operator-id');
        if (id) selected.add(String(id));
      });
      saveIndicatorsSelectedOperatorIds(selected);

      // Refrescar UI dependiente (Indicadores) si está abierta
      try { updateWorkingDaysOperatorSelect(); } catch (_) {}
      if (indicatorsCache) {
        try { renderIndicators(indicatorsCache); } catch (_) {}
      }
      scheduleIndicatorsAutoLoad({ silent: true });
    });
  }

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
    persistIndicatorsSelectionFromUI();
    if (indicatorsCache) renderIndicators(indicatorsCache);
    // Autocarga (debounce) cuando aún no hay datos o cuando se quiere refrescar sin botón.
    scheduleIndicatorsAutoLoad({ silent: true });
  });
}

function ensureWorkLogsMeta() {
  // Usa el mismo meta de Tiempos (catálogos)
  const fill = (dlId, values) => {
    const dl = document.getElementById(dlId);
    if (!dl) return;
    dl.innerHTML = (values || []).map(v => `<option value="${escapeHtml(v)}">`).join('');
  };

  const meta = tiemposMetaCache || {};
  if (!tiemposMetaCache) {
    // disparamos carga async pero no bloqueamos UI
    loadTiemposMeta().then(() => {
      const m = tiemposMetaCache || {};
      fill('wlOperarios', (m.operators || []).map(o => o.name));
      fill('wlProcesos', (m.processes || []).map(p => p.name));
      fill('wlMoldes', (m.molds || []).map(x => x.name));
      fill('wlPartes', (m.parts || []).map(x => x.name));
      fill('wlMaquinas', (m.machines || []).map(x => x.name));
      fill('wlOperaciones', (m.operations || []).map(o => o.name));
    }).catch(() => null);
    return;
  }

  fill('wlOperarios', (meta.operators || []).map(o => o.name));
  fill('wlProcesos', (meta.processes || []).map(p => p.name));
  fill('wlMoldes', (meta.molds || []).map(x => x.name));
  fill('wlPartes', (meta.parts || []).map(x => x.name));
  fill('wlMaquinas', (meta.machines || []).map(x => x.name));
  fill('wlOperaciones', (meta.operations || []).map(o => o.name));
}
import { state } from '../core/state.js';
import * as api from '../core/api.js';
import { showToast, displayResponse, setupStickyTabsOffset, setupFixedTabsBar, openTab } from '../ui/ui.js';
import { resetInactivityTimer, startInactivityTimer } from './worklogs.js';
import { preloadMoldsForSearch } from './planner.js';
import { loadCalendar } from './calendar.js';

export function updateConnectionStatus(connected) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = connected ? '● Conectado' : '● Desconectado';
  el.classList.toggle('disconnected', !connected);
}
export function startHealthCheck() {
  stopHealthCheck();
  const check = async () => {
    try { const res = await fetch(`${state.SERVER_URL}/health`, { cache: 'no-store' }); updateConnectionStatus(res.ok); }
    catch { updateConnectionStatus(false); }
  };
  check();
  state.healthTimer = setInterval(check, state.HEALTH_INTERVAL_MS);
}
export function stopHealthCheck() { if (state.healthTimer) clearInterval(state.healthTimer); state.healthTimer = null; }
export function showLoginScreen(message = '') {
  const loginContainer = document.getElementById('loginContainer');
  const mainApp = document.getElementById('mainApp');
  if (loginContainer) loginContainer.classList.remove('hidden');
  if (mainApp) mainApp.classList.add('hidden');
  if (message) console.error(message);
  const loginResp = document.getElementById('loginResponse');
  if (loginResp) loginResp.textContent = '';
  const pwd = document.getElementById('password'); if (pwd) pwd.value = '';

  // Mantener visible el selector de operario cuando el usuario seleccionado es "operarios"
  // (por ejemplo, después de cerrar sesión desde un operario).
  try { updateOperatorSelection(); } catch (_) {}

  state.currentUser = null;
  updateConnectionStatus(false);
  stopHealthCheck();
  resetInactivityTimer();

  // Bootstrap inicial (si aplica)
  try { startBootstrapStatusPoll(); } catch (_) {}
}

export function startBootstrapStatusPoll() {
  stopBootstrapStatusPoll();
  refreshBootstrapStatus();
  state.bootstrapStatusTimer = setInterval(() => {
    refreshBootstrapStatus();
  }, 2000);
}

export function stopBootstrapStatusPoll() {
  if (state.bootstrapStatusTimer) clearInterval(state.bootstrapStatusTimer);
  state.bootstrapStatusTimer = null;
}

// ================================
// Bootstrap inicial: crear admin + jefe una sola vez
// ================================
export async function refreshBootstrapStatus() {
  const card = document.getElementById('bootstrapCard');
  if (!card) return;

  const adminGroup = document.getElementById('bootstrapAdminGroup');
  const jefeGroup = document.getElementById('bootstrapJefeGroup');
  const gerenciaGroup = document.getElementById('bootstrapGerenciaGroup');
  const btn = document.getElementById('bootstrapBtn');

  try {
    const res = await fetch(`${state.API_URL}/auth/bootstrap/status`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    const can = !!data?.canBootstrap;
    const adminExists = !!data?.adminExists;
    const jefeExists = !!data?.jefeExists;
    const gerenciaExists = !!data?.gerenciaExists;

    // Mostrar el bloque si falta al menos una cuenta
    card.classList.toggle('hidden', !can);

    // Mostrar solo los inputs que faltan
    if (adminGroup) adminGroup.classList.toggle('hidden', adminExists);
    if (jefeGroup) jefeGroup.classList.toggle('hidden', jefeExists);
    if (gerenciaGroup) gerenciaGroup.classList.toggle('hidden', gerenciaExists);

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

export async function runBootstrapInit(e) {
  if (e) e.preventDefault();
  const adminPassword = document.getElementById('bootstrapAdminPassword')?.value;
  const jefePassword = document.getElementById('bootstrapJefePassword')?.value;
  const gerenciaPassword = document.getElementById('bootstrapGerenciaPassword')?.value;

  const payload = { adminPassword, jefePassword, gerenciaPassword };

  try {
    const res = await fetch(`${state.API_URL}/auth/bootstrap`, {
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
      const g = document.getElementById('bootstrapGerenciaPassword'); if (g) g.value = '';
      await refreshBootstrapStatus();
    }
  } catch (err) {
    displayResponse('bootstrapResponse', { error: 'Error de conexión', details: String(err) }, false);
  }
}
export function showMainApp(user) {
  state.currentUser = user;

  const usrEl = document.getElementById('displayUsername');
  const opEl = document.getElementById('displayOperator');
  const opRowEl = document.getElementById('userInfoOperatorRow');

  // Nota: mantenemos los roles internos (admin/planner/operator) para permisos,
  // pero en UI mostramos: admin / jefe / gerencia / operario.
  const role = String(user.role || '').toLowerCase();
  const isOperator = role === 'operator';
  const isManagement = role === 'management';

  const uiUserLabel = role === 'admin'
    ? 'admin'
    : role === 'planner'
      ? 'jefe'
      : role === 'management'
        ? 'gerencia'
      : role === 'operator'
        ? 'operario'
        : (user.username || '');

  if (usrEl) usrEl.textContent = uiUserLabel;
  if (opEl) opEl.textContent = isOperator ? (user.operatorName || 'N/A') : '';
  if (opRowEl) opRowEl.classList.toggle('hidden', !isOperator);

  // Tabs por rol
  const canSeeAll = role === 'admin' || role === 'planner' || role === 'management';

  // Por defecto, mostramos todo a admin/planner y limitamos al operario solo a "tiempos"
  document.querySelectorAll('.tabs .tab').forEach(btn => {
    const tab = btn.getAttribute('data-tab');
    const isManagementTab = tab === 'reports' || tab === 'financial';
    if (isOperator) {
      btn.classList.toggle('hidden', !(tab === 'tiempos' || tab === 'registros'));
    } else if (isManagement) {
      // Gerencia ve todas las pestañas estándar y también las exclusivas.
      btn.classList.remove('hidden');
    } else if (canSeeAll) {
      btn.classList.toggle('hidden', isManagementTab);
    } else {
      // fallback conservador: si algún rol nuevo aparece, dejamos visibles solo tabs "seguros"
      btn.classList.toggle('hidden', tab === 'config');
    }
  });

  const loginContainer = document.getElementById('loginContainer');
  const mainApp = document.getElementById('mainApp');
  if (loginContainer) loginContainer.classList.add('hidden');
  if (mainApp) mainApp.classList.remove('hidden');

  // Ensure tabs bar can measure real sizes now that the app is visible
  try {
    requestAnimationFrame(() => {
      setupStickyTabsOffset();
      setupFixedTabsBar();
    });
  } catch (e) { }

  updateConnectionStatus(true);
  startHealthCheck();
  startInactivityTimer();
  stopBootstrapStatusPoll();

  preloadMoldsForSearch();

  const defaultTab = isOperator ? 'tiempos' : (isManagement ? 'reports' : 'plan');
  openTab(defaultTab);
  setTimeout(() => {
    try { loadCalendar(); } catch (e) { }
  }, 100);
}

// Auth
export async function updateOperatorSelection() {
  const username = document.getElementById('username').value;
  const group = document.getElementById('operatorSelectGroup');
  const select = document.getElementById('operatorId');
  if (username === 'operarios') {
    if (group) group.classList.remove('hidden');
    if (select) select.innerHTML = '<option>Cargando...</option>';
    try {
      const res = await fetch(`${state.API_URL}/auth/operators?username=${username}`);
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
export async function login(e) {
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
    const res = await fetch(`${state.API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include'
    });
    const data = await res.json();
    if (res.ok) {
      displayResponse('loginResponse', 'Sesión iniciada', true);
      if (data.sessionId) localStorage.setItem('sessionId', String(data.sessionId));
      verifySession();
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
export async function verifySession() {
  try {
    const res = await fetch(`${state.API_URL}/auth/verify`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      showMainApp(data.user);
    } else {
      showLoginScreen('Sesión inválida');
    }
  } catch (e) { showLoginScreen('Error conexión'); }
}
export async function logout() {
  try {
    const sessionId = localStorage.getItem('sessionId');
    await fetch(`${state.API_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      credentials: 'include'
    }).catch(() => null);
  } catch (_) {}

  try { localStorage.removeItem('sessionId'); } catch (_) {}
  showLoginScreen('Logout');
}

export function setupAuthListeners() {
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      login();
    });
  }
  const bootstrapBtn = document.getElementById('bootstrapBtn'); if (bootstrapBtn) bootstrapBtn.addEventListener('click', runBootstrapInit);
  const usernameSel = document.getElementById('username'); if (usernameSel) usernameSel.addEventListener('change', updateOperatorSelection);
  const logoutBtn = document.getElementById('logoutBtn'); if (logoutBtn) logoutBtn.addEventListener('click', logout);
}

export function initAuth() {
  updateConnectionStatus(false);
  verifySession();
}


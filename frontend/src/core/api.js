import { state } from './state.js';
import { showToast, displayResponse } from '../ui/ui.js';
import { logout } from '../features/auth.js';
import { io } from 'socket.io-client';

export const socket = io(state.API_URL.replace('/api', ''), {
  withCredentials: true
});

/**
 * Generic fetch wrapper to inject token and handle standard JSON errors.
 */
export async function apiFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${state.API_URL}${endpoint}`;
  
  const headers = new Headers(options.headers || {});
  
  // Set default JSON Content-Type if we are sending data and not FormData
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const fetchOptions = {
    ...options,
    headers,
    credentials: 'include'
  };

  try {
    const response = await fetch(url, fetchOptions);
    
    // Auto-logout on 401
    if (response.status === 401) {
      logout();
      throw new Error('Sesión expirada o no autorizada');
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const errorMsg = (data && (data.error || data.message)) || `Error HTTP ${response.status}`;
      throw new Error(errorMsg);
    }

    return data;
  } catch (error) {
    // Si la opción no suprime el toast, lo mostramos automáticamente
    if (!options.silent) {
      showToast(error.message, false);
    }
    throw error;
  }
}

// ==========================================
// CONFIGURATION: Machines, Parts, Operators
// ==========================================

export async function fetchMachines() {
  return apiFetch('/config/machines');
}

export async function createMachine(payload) {
  return apiFetch('/config/machines', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function updateMachine(id, payload) {
  return apiFetch(`/config/machines/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export async function fetchParts() {
  return apiFetch('/config/parts');
}

export async function createPart(payload) {
  return apiFetch('/config/parts', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function updatePart(id, payload) {
  return apiFetch(`/config/parts/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export async function fetchOperators() {
  return apiFetch('/config/operators');
}

export async function createOperator(payload) {
  return apiFetch('/config/operators', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function updateOperator(id, payload) {
  return apiFetch(`/config/operators/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export async function fetchMolds() {
  return apiFetch('/config/molds');
}

export async function fetchCatalogsMeta() {
  return apiFetch('/catalogs/meta');
}

// ==========================================
// CALENDAR & PLANNING
// ==========================================

export async function fetchCalendarMonthView(year, month) {
  return apiFetch(`/calendar/month-view?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`, { cache: 'no-store' });
}

export async function fetchMoldProgressDetail(moldId, opts = {}) {
  const qs = new URLSearchParams();
  qs.set('includeParts', '1');
  if (opts.asOf) qs.set('asOf', opts.asOf);
  if (opts.day) qs.set('day', opts.day);
  if (opts.planningId) qs.set('planning_id', opts.planningId);
  return apiFetch(`/molds/${encodeURIComponent(String(moldId))}/progress?${qs.toString()}`);
}

// ==========================================
// FINANCIAL & COSTING
// ==========================================

export async function fetchMoldCostBreakdownData(planningId) {
  return apiFetch(`/management/mold-cost-breakdown/${encodeURIComponent(planningId)}`);
}

export async function fetchCompletedCycles() {
  return apiFetch('/management/completed-cycles');
}

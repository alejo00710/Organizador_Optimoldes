import { state } from '../core/state.js';
import * as api from '../core/api.js';
import { showToast, displayResponse, escapeHtml, openTab } from '../ui/ui.js';
import { loadIndicatorsSelectedOperatorIds, saveIndicatorsSelectedOperatorIds } from './indicators.js';

// --- VARIABLES DE CONFIGURACIÓN ---
let machinesCache = [];
let machinesDraft = new Map(); // id -> { name, daily_capacity, is_active }


export async function loadMachinesList() {
  try {
    machinesCache = await api.fetchMachines(); // [{id,name,daily_capacity,is_active,created_at}]
    renderMachinesTable();
  } catch (e) {
    displayResponse('configResponse', { error: 'Error cargando máquinas', details: String(e) }, false);
  }
}
export function renderMachinesTable() {
  const tbody = document.querySelector('#machinesTable tbody'); if (!tbody) return;
  const q = (document.getElementById('machineFilter')?.value || '').toLowerCase().trim();
  const list = q ? machinesCache.filter(m => (m.name || '').toLowerCase().includes(q)) : machinesCache;

  tbody.innerHTML = list.map(m => `
    <tr data-id="${m.id}" class="${machinesDraft.has(String(m.id)) ? 'pending-save' : ''}">
      <td>${m.id}</td>
      <td><input type="text" class="mc-name" value="${escapeHtml((machinesDraft.get(String(m.id))?.name ?? (m.name || '')))}"></td>
      <td><input type="number" class="mc-cap" step="0.5" min="0" list="hoursOptions" value="${(() => {
        const d = machinesDraft.get(String(m.id));
        const v = d ? d.daily_capacity : m.daily_capacity;
        return v != null && v !== '' ? Number(v) : '';
      })()}" placeholder="Ej: 14"></td>
      <td style="text-align:center;"><input type="checkbox" class="mc-active" ${(() => {
        const d = machinesDraft.get(String(m.id));
        const v = d ? d.is_active : m.is_active;
        return v ? 'checked' : '';
      })()}></td>
    </tr>
  `).join('');
}

export function captureMachineDraftFromRow(row) {
  if (!row) return;
  const id = String(row.getAttribute('data-id') ?? '').trim();
  if (!id) return;
  const name = String(row.querySelector('.mc-name')?.value ?? '').trim();
  const capStr = String(row.querySelector('.mc-cap')?.value ?? '').trim();
  const is_active = row.querySelector('.mc-active')?.checked ? 1 : 0;
  const daily_capacity = capStr === '' ? null : parseFloat(capStr);

  const base = machinesCache.find(m => String(m.id) === String(id));
  const draft = normalizeMachineComparable({ name, daily_capacity, is_active });
  const current = base ? normalizeMachineComparable(base) : null;
  const changed = !current
    || (draft.name !== current.name)
    || (Number(draft.daily_capacity ?? -1) !== Number(current.daily_capacity ?? -1))
    || (draft.is_active !== current.is_active);

  if (changed) machinesDraft.set(id, { name, daily_capacity, is_active });
  else machinesDraft.delete(id);

  setPendingSave(row, changed);
}

export function normalizeMachineComparable(m) {
  const name = String(m?.name ?? '').trim();
  const cap = (m?.daily_capacity === '' ? null : m?.daily_capacity);
  const daily_capacity = cap == null ? null : Number(cap);
  const is_active = m?.is_active ? 1 : 0;
  return { name, daily_capacity, is_active };
}

export async function saveMachinesBulk() {
  if (!machinesDraft.size) {
    displayResponse('configResponse', { message: 'No hay cambios pendientes en máquinas.' }, true);
    return;
  }

  const updates = [];
  for (const [id, draftRaw] of machinesDraft.entries()) {
    const base = machinesCache.find(m => String(m.id) === String(id));
    if (!base) continue;

    const draft = normalizeMachineComparable(draftRaw);
    const current = normalizeMachineComparable(base);

    if (!draft.name) {
      displayResponse('configResponse', { error: `Nombre requerido en máquina ${id}` }, false);
      return;
    }

    const changed = (draft.name !== current.name)
      || (Number(draft.daily_capacity ?? -1) !== Number(current.daily_capacity ?? -1))
      || (draft.is_active !== current.is_active);

    if (changed) updates.push({ id, body: { name: draft.name, daily_capacity: draft.daily_capacity, is_active: draft.is_active } });
  }

  if (!updates.length) {
    machinesDraft.clear();
    displayResponse('configResponse', { message: 'No hay cambios reales para guardar en máquinas.' }, true);
    return;
  }

  displayResponse('configResponse', { message: `Guardando ${updates.length} cambio(s) de máquinas...` }, true);
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
    displayResponse('configResponse', { error: `Algunas máquinas no se guardaron (${failures.length}).`, details: failures }, false);
  } else {
    displayResponse('configResponse', { message: 'Máquinas guardadas.' }, true);
  }

  machinesDraft.clear();
  try { await loadMachinesList(); } catch (_) {}
  try { await loadDatosMeta(); } catch (_) {}
}
export async function saveMachineRow(id) {
  const row = document.querySelector(`#machinesTable tbody tr[data-id="${id}"]`); if (!row) return;
  const name = row.querySelector('.mc-name')?.value.trim();
  const capStr = row.querySelector('.mc-cap')?.value.trim();
  const is_active = row.querySelector('.mc-active')?.checked ? 1 : 0;
  const daily_capacity = capStr === '' ? null : parseFloat(capStr);
  if (!name) return displayResponse('configResponse', { error:'Nombre requerido' }, false);
  try {
    const res = await fetch(`${state.API_URL}/config/machines/${id}`, {
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      credentials: 'include',
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
export async function createMachine(){
  const name = document.getElementById('newMachineName')?.value.trim();
  const capStr = document.getElementById('newMachineCapacity')?.value.trim();
  const daily_capacity = capStr ? parseFloat(capStr) : null;
  if (!name) return displayResponse('configResponse', { error:'Nombre de máquina requerido' }, false);
  try{
    const res = await fetch(`${state.API_URL}/config/machines`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials: 'include',
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
export async function createMold(){
  const name = document.getElementById('newMoldName')?.value.trim();
  if (!name) return displayResponse('configResponse', { error:'Nombre de molde requerido' }, false);
  try{
    const res = await fetch(`${state.API_URL}/config/molds`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials: 'include',
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
export async function createPart(){
  const name = document.getElementById('newPartName')?.value.trim();
  if (!name) return displayResponse('configResponse', { error:'Nombre de parte requerido' }, false);
  try{
    const res = await fetch(`${state.API_URL}/config/parts`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials: 'include',
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
export async function createOperator(){
  const name = document.getElementById('newOperatorName')?.value.trim();
  if (!name) return displayResponse('configResponse', { error:'Nombre requerido' }, false);

  // Crear operario (sin contraseña aquí). La contraseña se gestiona desde la lista.
  try{
    const res = await fetch(`${state.API_URL}/config/operators`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials: 'include',
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
let operatorsDraft = new Map(); // id -> { name, is_active, password }

export function normalizeIndicatorsSelectionAgainstOperators(ops){
  const list = Array.isArray(ops) ? ops : [];
  const activeIds = new Set(list.filter(o => o && o.is_active).map(o => String(o.id)));
  const selected = loadIndicatorsSelectedOperatorIds();
  const next = new Set(Array.from(selected).filter(id => activeIds.has(String(id))));
  const changed = next.size !== selected.size;
  if (changed) saveIndicatorsSelectedOperatorIds(next);
  return next;
}

export async function loadOperatorsList(){
  const tbody = document.querySelector('#operatorsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="color:#6c757d">Cargando...</td></tr>';

  try{
    const data = await api.fetchOperators();
    operatorsCache = Array.isArray(data) ? data : [];
    renderOperatorsTable();
  } catch(e){
    tbody.innerHTML = '<tr><td colspan="5" style="color:#6c757d">Error de conexión</td></tr>';
  }
}

export function renderOperatorsTable(){
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
    const draft = operatorsDraft.get(id);
    const name = (draft && typeof draft.name === 'string') ? draft.name : (o.name || '');
    const active = (draft && typeof draft.is_active !== 'undefined') ? !!draft.is_active : isActive;
    const password = (draft && typeof draft.password === 'string') ? draft.password : '';

    return `
      <tr data-id="${escapeHtml(id)}" class="${operatorsDraft.has(id) ? 'pending-save' : ''}">
        <td>${escapeHtml(id)}</td>
        <td><input type="text" class="op-name" value="${escapeHtml(name)}"></td>
        <td style="text-align:center;"><input type="checkbox" class="op-active" ${active ? 'checked' : ''}></td>
        <td style="text-align:center;"><input type="checkbox" class="op-indicators" data-operator-id="${escapeHtml(id)}" ${isSelected ? 'checked' : ''} ${isActive ? '' : 'disabled'}></td>
        <td><input type="password" class="op-password" placeholder="Nueva contraseña" value="${escapeHtml(password)}"></td>
      </tr>
    `;
  }).join('');
}

export function captureOperatorDraftFromRow(row) {
  if (!row) return;
  const id = String(row.getAttribute('data-id') ?? '').trim();
  if (!id) return;
  const name = String(row.querySelector('.op-name')?.value ?? '').trim();
  const is_active = row.querySelector('.op-active')?.checked ? 1 : 0;
  const password = String(row.querySelector('.op-password')?.value ?? '');

  const base = operatorsCache.find(o => String(o.id) === String(id));
  const changed = !base
    || (name !== String(base.name || '').trim())
    || (is_active !== (base.is_active ? 1 : 0))
    || (password.trim() !== '');

  if (changed) operatorsDraft.set(id, { name, is_active, password });
  else operatorsDraft.delete(id);

  setPendingSave(row, changed);
}

export async function saveOperatorsBulk() {
  if (!operatorsDraft.size) {
    displayResponse('configResponse', { message: 'No hay cambios pendientes en operarios.' }, true);
    return;
  }

  const updates = [];
  for (const [id, draft] of operatorsDraft.entries()) {
    const base = operatorsCache.find(o => String(o.id) === String(id));
    if (!base) continue;

    const name = String(draft?.name ?? '').trim();
    const is_active = draft?.is_active ? 1 : 0;
    const password = String(draft?.password ?? '');

    if (!name) {
      displayResponse('configResponse', { error: `Nombre requerido en operario ${id}` }, false);
      return;
    }

    const changed = (name !== String(base.name || '').trim())
      || (is_active !== (base.is_active ? 1 : 0))
      || (password.trim() !== '');
    if (!changed) continue;

    const body = { name, is_active };
    if (password.trim() !== '') body.password = password;
    updates.push({ id, body });
  }

  if (!updates.length) {
    operatorsDraft.clear();
    displayResponse('configResponse', { message: 'No hay cambios reales para guardar en operarios.' }, true);
    return;
  }

  displayResponse('configResponse', { message: `Guardando ${updates.length} cambio(s) de operarios...` }, true);
  const failures = [];
  for (const u of updates) {
    try {
      const res = await fetch(`${state.API_URL}/config/operators/${encodeURIComponent(String(u.id))}`, {
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
    displayResponse('configResponse', { error: `Algunos operarios no se guardaron (${failures.length}).`, details: failures }, false);
  } else {
    displayResponse('configResponse', { message: 'Operarios guardados.' }, true);
  }

  operatorsDraft.clear();
  try { await loadOperatorsList(); } catch (_) {}
  try { await loadDatosMeta(); } catch (_) {}
  try { await loadOperatorsForIndicators(); } catch (_) {}
}

export async function saveOperatorRow(id){
  const row = findRowByDataId('#operatorsTable tbody', id);
  if (!row) return;
  const name = row.querySelector('.op-name')?.value.trim();
  const is_active = row.querySelector('.op-active')?.checked ? 1 : 0;
  const password = row.querySelector('.op-password')?.value ?? '';
  if (!name) return displayResponse('configResponse', { error:'Nombre requerido' }, false);

  const body = { name, is_active };
  if (String(password).trim() !== '') body.password = String(password);

  try{
    const res = await fetch(`${state.API_URL}/config/operators/${encodeURIComponent(String(id))}`, {
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      credentials: 'include',
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
export async function createHoliday(){
  const date = document.getElementById('newHolidayDate')?.value;
  const name = document.getElementById('newHolidayName')?.value.trim();
  if (!date || !name) return displayResponse('configResponse', { error:'Fecha y nombre requeridos' }, false);
  try{
    const res = await fetch(`${state.API_URL}/holidays`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify({ date, name })
    });
    const data = await res.json();
    displayResponse('configResponse', data, res.ok);
    if (res.ok) {
      try { document.getElementById('newHolidayDate').value = ''; } catch (_) {}
      try { document.getElementById('newHolidayName').value = ''; } catch (_) {}
      try { loadHolidaysList(); } catch (_) {}
      try { loadCalendar(); } catch (_) {}
    }
  } catch(e){ displayResponse('configResponse', { error:'Error conexión' }, false); }
}

export function normalizeDateToISO(dateValue) {
  if (!dateValue) return '';
  if (dateValue instanceof Date) return dateValue.toISOString().slice(0, 10);
  const s = String(dateValue);
  // Puede venir como "YYYY-MM-DD" o "YYYY-MM-DDT..."
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

export async function loadHolidaysList() {
  const container = document.getElementById('holidaysListContainer');
  if (!container) return;

  const deleteBtn = document.getElementById('deleteHolidayBtn');

  // Estado base: header + mensaje
  let statusP = container.querySelector('p');
  if (!statusP) {
    statusP = document.createElement('p');
    container.insertBefore(statusP, deleteBtn || null);
  }

  // Remover UI dinámica previa
  container.querySelectorAll('.holidays-dynamic').forEach((el) => el.remove());
  statusP.textContent = 'Cargando lista...';
  if (deleteBtn) deleteBtn.style.display = 'none';

  try {
    if (!state.currentUser) {
      statusP.textContent = 'Inicia sesión para ver la lista.';
      return;
    }

    const res = await fetch(`${state.API_URL}/holidays`, {
      method: 'GET',
      credentials: 'include',
    });
    const data = await res.json().catch(() => ([]));

    if (!res.ok) {
      const msg = data?.error || data?.message || 'No se pudo cargar la lista.';
      statusP.textContent = `Error: ${msg}`;
      return;
    }

    const list = Array.isArray(data) ? data : [];
    if (!list.length) {
      statusP.textContent = 'No hay festivos registrados.';
      return;
    }

    statusP.textContent = `Total: ${list.length}`;

    const select = document.createElement('select');
    select.id = 'holidaysSelect';
    select.className = 'holidays-dynamic';
    select.style.width = '100%';
    select.style.maxWidth = '100%';
    select.style.padding = '8px';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecciona un festivo...';
    select.appendChild(placeholder);

    // Ordenar por fecha asc
    list
      .map((h) => ({ date: normalizeDateToISO(h.date), name: String(h.name || '').trim() }))
      .filter((h) => h.date)
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((h) => {
        const opt = document.createElement('option');
        opt.value = h.date;
        opt.textContent = h.name ? `${h.date} — ${h.name}` : h.date;
        select.appendChild(opt);
      });

    // Insertar select justo antes del botón eliminar
    container.insertBefore(select, deleteBtn || null);

    select.addEventListener('change', () => {
      if (!deleteBtn) return;
      deleteBtn.style.display = select.value ? 'inline-block' : 'none';
    });

  } catch (e) {
    statusP.textContent = `Error cargando lista: ${String(e?.message || e)}`;
  }
}

export async function deleteSelectedHoliday() {
  const select = document.getElementById('holidaysSelect');
  const date = select?.value;
  if (!date) return displayResponse('configResponse', { error: 'Selecciona un festivo para eliminar' }, false);

  const ok = window.confirm(`¿Eliminar el festivo del ${date}?`);
  if (!ok) return;

  try {
    const res = await fetch(`${state.API_URL}/holidays/${encodeURIComponent(date)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    displayResponse('configResponse', data, res.ok);
    if (res.ok) {
      try { loadHolidaysList(); } catch (_) {}
      try { loadCalendar(); } catch (_) {}
    }
  } catch (e) {
    displayResponse('configResponse', { error: 'Error conexión', details: String(e) }, false);
  }
}


let partsDraft = new Map(); // id -> boolean (checked)

export async function loadConfigPartsChecklist() {
  const container = document.getElementById('configPartsChecklist');
  if (!container) return;

  container.innerHTML = '<div style="color:#6c757d">Cargando...</div>';

  let parts = [];
  try {
    const res = await fetch(`${state.API_URL}/config/parts`, { credentials: 'include' });
    if (!res.ok) throw new Error('No se pudo cargar partes');
    parts = await res.json();
  } catch (e) {
    container.innerHTML = '<div style="color:#6c757d">Error cargando partes</div>';
    return;
  }

  // Aplicar predeterminados UNA SOLA VEZ: si todo estaba activo, dejamos activos solo los state.FIXED_PARTS.
  const alreadyApplied = (() => {
    try { return localStorage.getItem(state.LS_KEYS.configPartsDefaultsApplied) === '1'; } catch { return false; }
  })();

  if (!alreadyApplied) {
    const anyInactive = (parts || []).some(p => !p?.is_active);
    const fixedSet = new Set((state.FIXED_PARTS || []).map(n => String(n || '').trim().toLowerCase()));

    // Solo auto-aplicamos si venía "todo activo" (estado típico inicial)
    if (!anyInactive && parts.length) {
      const updates = parts.map(p => {
        const desired = fixedSet.has(String(p.name || '').trim().toLowerCase());
        const current = !!p.is_active;
        if (current === desired) return null;
        return fetch(`${state.API_URL}/config/parts/${encodeURIComponent(p.id)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ is_active: desired ? 1 : 0 })
          }
        ).catch(() => null);
      }).filter(Boolean);

      if (updates.length) {
        await Promise.all(updates);
        // Recargar lista ya normalizada
        try {
          const res2 = await fetch(`${state.API_URL}/config/parts`, { credentials: 'include' });
          if (res2.ok) parts = await res2.json();
        } catch { }
      }
    }

    try { localStorage.setItem(state.LS_KEYS.configPartsDefaultsApplied, '1'); } catch { }
  }

  container.innerHTML = (parts || []).map(p => {
    const id = String(p.id);
    const originalActive = !!p?.is_active;
    const desiredActive = partsDraft.has(id) ? !!partsDraft.get(id) : originalActive;
    const pending = desiredActive !== originalActive;
    return `<label class="${pending ? 'pending-save' : ''}" style="display:flex; gap:8px; align-items:center; margin:4px 0;">
      <input type="checkbox"
        data-config-part-id="${escapeHtml(id)}"
        data-original-active="${originalActive ? '1' : '0'}"
        ${desiredActive ? 'checked' : ''}>
      <span>${escapeHtml(String(p.name || ''))}</span>
    </label>`;
  }).join('') || '<div style="color:#6c757d">(sin partes)</div>';
}

export async function savePartsBulk() {
  const checklist = document.getElementById('configPartsChecklist');
  if (!checklist) return;

  const cbs = Array.from(checklist.querySelectorAll('input[type="checkbox"][data-config-part-id]'));
  if (!cbs.length) {
    displayResponse('configResponse', { message: 'No hay partes para guardar.' }, true);
    return;
  }

  const updates = [];
  for (const cb of cbs) {
    const id = cb.getAttribute('data-config-part-id');
    if (!id) continue;
    const original = cb.getAttribute('data-original-active') === '1';
    const desired = !!cb.checked;
    if (original !== desired) updates.push({ id, desired });
  }

  if (!updates.length) {
    partsDraft.clear();
    displayResponse('configResponse', { message: 'No hay cambios pendientes en partes.' }, true);
    return;
  }

  displayResponse('configResponse', { message: `Guardando ${updates.length} cambio(s) de partes...` }, true);
  const failures = [];
  for (const u of updates) {
    try {
      const res = await fetch(`${state.API_URL}/config/parts/${encodeURIComponent(String(u.id))}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_active: u.desired ? 1 : 0 })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) failures.push({ id: u.id, error: data?.error || data?.message || 'Error guardando' });
    } catch (e) {
      failures.push({ id: u.id, error: String(e) });
    }
  }

  if (failures.length) {
    displayResponse('configResponse', { error: `Algunas partes no se guardaron (${failures.length}).`, details: failures }, false);
  } else {
    displayResponse('configResponse', { message: 'Partes guardadas.' }, true);
  }

  partsDraft.clear();
  try { await loadConfigPartsChecklist(); } catch (_) {}
  try { await loadDatosMeta(); } catch (_) {}
}


// Tiempos de Moldes (mantiene autocompletar y filtros propios)
let tiemposMetaCache = null;

// Cache de planificación para Tiempos (por mes): key = "YYYY-MM"
const tiemposPlanMonthCache = new Map();
let tiemposPlanListenersBound = false;




export function initConfigEvents() {
  const wire = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  
  wire('saveMachinesBtn', saveMachinesBulk);
  wire('createMachineBtn', createMachine);
  wire('createMoldBtn', createMold);
  wire('createPartBtn', createPart);
  wire('savePartsBtn', savePartsBulk);
  wire('reloadPartsBtn', loadConfigPartsChecklist);
  wire('createOperatorBtn', createOperator);
  wire('saveOperatorsBtn', saveOperatorsBulk);
  wire('createHolidayBtn', createHoliday);
  wire('deleteHolidayBtn', deleteSelectedHoliday);

  // Delegation para tablas y checkboxes dentro de config
  const partsChecklist = document.getElementById('configPartsChecklist');
  if (partsChecklist) {
    partsChecklist.addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"][data-config-part-id]');
      if (cb) capturePartDraftFromCheckbox(cb);
    });
  }

  const machinesTable = document.getElementById('machinesTable');
  if (machinesTable) {
    machinesTable.addEventListener('input', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) captureMachineDraftFromRow(tr);
    });
  }

  const operatorsTable = document.getElementById('operatorsTable');
  if (operatorsTable) {
    operatorsTable.addEventListener('input', (e) => {
      if (e.target.classList.contains('op-indicators')) return;
      const tr = e.target.closest('tr[data-id]');
      if (tr) captureOperatorDraftFromRow(tr);
    });
    operatorsTable.addEventListener('change', (e) => {
      if (e.target.classList.contains('op-indicators')) {
        const id = String(e.target.getAttribute('data-operator-id'));
        const isChecked = e.target.checked;
        const selected = loadIndicatorsSelectedOperatorIds();
        if (isChecked) selected.add(id); else selected.delete(id);
        saveIndicatorsSelectedOperatorIds(selected);
      }
    });
  }
}

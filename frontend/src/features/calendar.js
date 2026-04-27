import { state } from '../core/state.js';
import * as api from '../core/api.js';
import { showToast, displayResponse, escapeHtml, openTab, formatCurrencyCOP, hideModal, capitalize } from '../ui/ui.js';
import { renderInProgressMoldList, isDateLaborable } from './planner.js';
import { isWeekendISO } from './worklogs.js';

// --- FUNCIONES EXTRAÍDAS DE APP.JS ---
export function changeMonth(delta) {
  state.currentMonth += delta;
  if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
  else if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
  loadCalendar();
}

export function localISOFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function isoFromYMD(year, monthIndex0, dayOfMonth) {
  return `${year}-${pad2(monthIndex0 + 1)}-${pad2(dayOfMonth)}`;
}

export function getBogotaTodayISO() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    if (!y || !m || !d) return null;
    return `${y}-${m}-${d}`;
  } catch {
    return null;
  }
}

let lastDayDetailsContext = null;

// Cache (mejor esfuerzo) de festivos y overrides de laborabilidad.
// Se llena al cargar el calendario del mes, y se usa para reglas de UI (ej. edición por días hábiles).
// let state.calendarHolidaysCache = {}; // (Moved to state.js) // { 'YYYY-MM-DD': 'Nombre' }
// let state.calendarWorkingOverridesCache = {}; // (Moved to state.js) // { 'YYYY-MM-DD': true|false }
// let state.calendarCompletedMoldIdsCache = new Set(); // (Moved to state.js)
// let state.fullCalendarInstance = null; // (Moved to state.js)
// let state.fullCalendarResourcesCache = []; // (Moved to state.js)
// let state.calendarMonthState = {
//   year: null,
//   month: null,
//   monthData: null,
//   hideCompleted: false,
// }; // (Moved to state.js)
// let state.isCalendarLoading = false; // (Moved to state.js)
// let state.isDeletingMold = false; // (Moved to state.js)
// let state.currentCalendarRequestId = 0; // (Moved to state.js)
// let state.calendarLoadingCount = 0; // (Moved to state.js)
// let state.currentDayDetailsRequestId = 0; // (Moved to state.js)

export function makeMoldCycleKey(moldId, planningId) {
  const mid = Number(moldId);
  const pid = Number(planningId);
  if (!Number.isFinite(mid) || mid <= 0) return '';
  if (Number.isFinite(pid) && pid > 0) return `${mid}:${pid}`;
  return `${mid}:`;
}

export function hasFullCalendarSupport() {
  return !!(window.FullCalendar && document.getElementById('calendar-fullcalendar'));
}

export function getDayFromISO(dateISO) {
  const s = String(dateISO || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const day = Number.parseInt(s.slice(8, 10), 10);
  return Number.isInteger(day) && day > 0 ? day : null;
}

export function normalizeToISODate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return localISOFromDate(v);
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return localISOFromDate(d);
  }
  const s = String(v || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : '';
}

export function setCalendarMonthState(data, { year, month, hideCompleted = false } = {}) {
  state.calendarMonthState = {
    year: Number(year),
    month: Number(month),
    monthData: data || null,
    hideCompleted: !!hideCompleted,
  };
}

export function ensureCalendarLoadingIndicator() {
  const container = document.querySelector('#tab-calendar .calendar-container');
  if (!container) return null;

  let el = document.getElementById('calendar-loading-indicator');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'calendar-loading-indicator';
  el.className = 'calendar-loading-indicator';
  el.textContent = 'Cargando planificación...';
  el.style.display = 'none';
  container.insertBefore(el, container.firstChild);
  return el;
}

export function setCalendarLoadingState(loading) {
  const indicator = ensureCalendarLoadingIndicator();
  if (!indicator) return;
  indicator.style.display = loading ? 'flex' : 'none';
}

export function buildDayEventsFromMonthState(dateISO, { focusMoldId = null, focusPlanningId = null } = {}) {
  const day = getDayFromISO(dateISO);
  const monthData = state.calendarMonthState?.monthData;
  if (!day || !monthData || typeof monthData !== 'object') return null;

  const source = (monthData.events && typeof monthData.events === 'object') ? monthData.events : {};
  const dayData = source[String(day)] || source[day] || null;
  if (!dayData || !Array.isArray(dayData.tasks)) {
    return { tasks: [], machineUsage: {}, machineCapacity: {}, hasOverlap: false };
  }

  const hideCompleted = !!state.calendarMonthState?.hideCompleted;
  const sourceTasks = Array.isArray(dayData.tasks) ? dayData.tasks : [];
  let tasks = sourceTasks.filter(t => {
    if (!t || typeof t !== 'object') return false;
    const planningId = Number(t?.planningId);
    const moldId = Number(t?.moldId);
    const machineId = Number(t?.machineId);
    if (!Number.isFinite(planningId) || planningId <= 0) return false;
    if (!Number.isFinite(moldId) || moldId <= 0) return false;
    if (!Number.isFinite(machineId) || machineId <= 0) return false;
    if (!hideCompleted) return true;
    return String(t?.status || '').toLowerCase() !== 'completed';
  });

  // Evita inconsistencias silenciosas en modal cuando el payload trae repetidos.
  const dedup = new Map();
  for (const t of tasks) {
    const key = [
      String(dateISO || ''),
      String(t?.planningId ?? ''),
      String(t?.moldId ?? ''),
      String(t?.machineId ?? ''),
    ].join('|');
    if (!dedup.has(key)) dedup.set(key, t);
  }
  tasks = Array.from(dedup.values());

  const focusMid = Number(focusMoldId);
  const focusPid = Number(focusPlanningId);
  if (Number.isFinite(focusMid) && focusMid > 0) {
    tasks = tasks.slice().sort((a, b) => {
      const aMid = Number(a?.moldId);
      const bMid = Number(b?.moldId);
      const aPid = Number(a?.planningId);
      const bPid = Number(b?.planningId);
      const aMatch = aMid === focusMid && (!Number.isFinite(focusPid) || focusPid <= 0 || aPid === focusPid);
      const bMatch = bMid === focusMid && (!Number.isFinite(focusPid) || focusPid <= 0 || bPid === focusPid);
      if (aMatch === bMatch) return 0;
      return aMatch ? -1 : 1;
    }).map(t => {
      const tMid = Number(t?.moldId);
      const tPid = Number(t?.planningId);
      const isFocused = tMid === focusMid && (!Number.isFinite(focusPid) || focusPid <= 0 || tPid === focusPid);
      return { ...t, __focusedCycle: isFocused };
    });
  }

  const machineUsage = {};
  const machineCapacity = (dayData.machineCapacity && typeof dayData.machineCapacity === 'object') ? { ...dayData.machineCapacity } : {};
  const byMachineMolds = new Map();

  for (const t of tasks) {
    const machine = String(t?.machine || '');
    const h = Number(t?.hours || 0);
    if (!machineUsage[machine]) machineUsage[machine] = 0;
    machineUsage[machine] += Number.isFinite(h) ? h : 0;

    if (!byMachineMolds.has(machine)) byMachineMolds.set(machine, new Set());
    byMachineMolds.get(machine).add(Number(t?.moldId));
  }

  const hasOverlap = Array.from(byMachineMolds.values()).some(s => s.size > 1);
  return { tasks, machineUsage, machineCapacity, hasOverlap };
}

export function buildDayDetailsFromCalendarState(dateISO, opts = {}) {
  const iso = normalizeToISODate(dateISO);
  if (!iso) return null;

  const dayEvents = buildDayEventsFromMonthState(iso, opts) || { tasks: [], machineUsage: {}, machineCapacity: {}, hasOverlap: false };
  const holiday = state.calendarHolidaysCache?.[iso] || null;
  return { iso, dayEvents, holiday };
}

export function openDayDetailsFromCalendar(dateISO, opts = {}) {
  try {
    if (state.isCalendarLoading || state.isDeletingMold) {
      console.warn('[calendar] openDayDetails bloqueado por operación en curso', { isCalendarLoading: state.isCalendarLoading, isDeletingMold: state.isDeletingMold });
      return;
    }

    const iso = normalizeToISODate(dateISO);
    if (!iso) {
      console.error('[calendar] Fecha inválida en apertura de modal', { dateISO });
      alert('Ocurrió un error, intenta nuevamente');
      return;
    }

    const details = buildDayDetailsFromCalendarState(iso, opts);
    if (!details) {
      console.error('[calendar] No se pudo construir detalle del día desde monthData', { iso });
      alert('Ocurrió un error, intenta nuevamente');
      return;
    }

    showDayDetails(details.iso, details.dayEvents, details.holiday);
  } catch (e) {
    console.error('[calendar] Error abriendo detalle de día', e);
    alert('Ocurrió un error, intenta nuevamente');
  }
}

export function getFullCalendarDayCellClasses(dateISO) {
  const classes = [];
  const iso = normalizeToISODate(dateISO);
  if (!iso) return classes;

  const isWeekend = isWeekendISO(iso);
  const isHoliday = Object.prototype.hasOwnProperty.call(state.calendarHolidaysCache || {}, iso);
  if (isWeekend) classes.push('fc-day-weekend');
  if (isHoliday) classes.push('fc-day-holiday');

  let isWorkingDay = !(isWeekend || isHoliday);

  if (Object.prototype.hasOwnProperty.call(state.calendarWorkingOverridesCache || {}, iso)) {
    const isWorking = !!state.calendarWorkingOverridesCache[iso];
    isWorkingDay = isWorking;
    if (isWorking) classes.push('fc-day-enabled-override');
    else classes.push('fc-day-disabled-override');
  }

  if (!isWorkingDay) classes.push('fc-day-non-working');

  return classes;
}

export function renderFullCalendarEventContent(arg) {
  const ex = arg?.event?.extendedProps || {};
  const mold = String(ex.mold || 'Molde');

  return {
    html: `
      <div class="fc-event-rich">
        <div class="fc-event-rich-title">${escapeHtml(mold)}</div>
      </div>
    `
  };
}

export function transformMonthViewToFullCalendarEvents(data, { hideCompleted = false } = {}) {
  const inputEvents = Array.isArray(data?.fullCalendar?.events) ? data.fullCalendar.events : [];
  const byDay = new Map();

  for (const e of inputEvents) {
    const planningId = Number(e?.extendedProps?.planningId ?? e?.planningId);
    const moldId = Number(e?.extendedProps?.moldId ?? e?.moldId);
    if (!Number.isFinite(planningId) || planningId <= 0) continue;
    if (!Number.isFinite(moldId) || moldId <= 0) continue;

    const status = String(e?.extendedProps?.status || 'pending').toLowerCase() === 'completed' ? 'completed' : 'pending';
    if (hideCompleted && status === 'completed') continue;

    const dayISO = normalizeToISODate(e?.start || e?.date || '');
    if (!dayISO) continue;

    const moldCycleKey = makeMoldCycleKey(moldId, planningId);
    const moldLabel = String(e?.extendedProps?.mold || e?.title || '').trim() || (Number.isFinite(moldId) && moldId > 0 ? `Molde ${moldId}` : 'Molde');

    if (!byDay.has(dayISO)) {
      byDay.set(dayISO, {
        dayISO,
        status,
        planningId,
        moldId,
        moldLabel,
        seenCycles: new Set([moldCycleKey]),
      });
      continue;
    }

    const dayData = byDay.get(dayISO);
    if (!dayData.seenCycles.has(moldCycleKey)) {
      dayData.seenCycles.add(moldCycleKey);
    }
  }

  return Array.from(byDay.values())
    .sort((a, b) => String(a.dayISO).localeCompare(String(b.dayISO)))
    .map((dayData) => {
      const status = dayData.status === 'completed' ? 'completed' : 'pending';
      return {
        id: `fc-day:${dayData.dayISO}`,
        title: dayData.moldLabel,
        start: dayData.dayISO,
        end: null,
        allDay: true,
        classNames: ['fc-mold-event', `status-${status}`],
        color: status === 'completed' ? '#16a34a' : '#f59e0b',
        borderColor: status === 'completed' ? '#16a34a' : '#f59e0b',
        extendedProps: {
          mold: dayData.moldLabel,
          status,
          planningId: dayData.planningId,
          moldId: dayData.moldId,
          machineId: null,
          totalHours: 0,
          partCount: 0,
          isPriority: false,
        },
      };
    });
}

export function extractFullCalendarResources(data) {
  const rows = Array.isArray(data?.fullCalendar?.resources) ? data.fullCalendar.resources : [];
  return rows
    .map(r => ({ id: String(r?.id || ''), title: String(r?.title || '') }))
    .filter(r => r.id && r.title);
}

export function ensureFullCalendarInstance() {
  if (!hasFullCalendarSupport()) return null;
  if (state.fullCalendarInstance) return state.fullCalendarInstance;

  const el = document.getElementById('calendar-fullcalendar');
  if (!el) return null;

  state.fullCalendarInstance = new window.FullCalendar.Calendar(el, {
    initialView: 'dayGridMonth',
    headerToolbar: false,
    locale: 'es',
    firstDay: 1,
    fixedWeekCount: false,
    height: 'auto',
    editable: false,
    eventStartEditable: false,
    eventDurationEditable: false,
    // Base para futuro drag & drop:
    // editable: true,
    // eventDrop: async (info) => { ... }
    // TODO: no activar eventDrop/eventResize todavía.
    // Los eventos actuales son agregados por (mold, planning, machine, day)
    // y no representan un plan_entry único para actualización directa.
    dateClick: (info) => {
      openDayDetailsFromCalendar(info?.dateStr || '');
    },
    eventClick: (info) => {
      const ex = info?.event?.extendedProps || {};
      const planningId = Number(ex.planningId);
      const moldId = Number(ex.moldId);
      const eventDate = info?.event?.startStr || info?.event?.start || '';
      if (!Number.isFinite(planningId) || planningId <= 0 || !Number.isFinite(moldId) || moldId <= 0) {
        openDayDetailsFromCalendar(eventDate);
        return;
      }
      openDayDetailsFromCalendar(eventDate, {
        focusMoldId: moldId,
        focusPlanningId: planningId,
      });
    },
    dayCellClassNames: (arg) => {
      return getFullCalendarDayCellClasses(arg?.date);
    },
    eventContent: renderFullCalendarEventContent,
    eventDidMount: (info) => {
      const ex = info?.event?.extendedProps || {};
      const title = String(ex.mold || '').trim();
      if (title) info.el.setAttribute('title', title);
    },
  });

  state.fullCalendarInstance.render();
  return state.fullCalendarInstance;
}

export function setCalendarRenderMode(useFullCalendar) {
  const fcEl = document.getElementById('calendar-fullcalendar');
  const grid = document.getElementById('calendar-grid');
  const gridHeader = document.querySelector('#tab-calendar .calendar-grid-header');
  if (fcEl) fcEl.style.display = useFullCalendar ? '' : 'none';
  if (grid) grid.style.display = useFullCalendar ? 'none' : '';
  if (gridHeader) gridHeader.style.display = useFullCalendar ? 'none' : '';
}

export function renderFullCalendarMonth(data, { year, month, hideCompleted = false } = {}) {
  const calendar = ensureFullCalendarInstance();
  if (!calendar) return false;

  setCalendarMonthState(data, { year, month, hideCompleted });

  const events = transformMonthViewToFullCalendarEvents(data, { hideCompleted });
  state.fullCalendarResourcesCache = extractFullCalendarResources(data);

  const monthDateISO = `${year}-${String(Number(month) + 1).padStart(2, '0')}-01`;
  calendar.batchRendering(() => {
    calendar.gotoDate(monthDateISO);
    calendar.removeAllEvents();
    calendar.addEventSource(events);
  });

  return true;
}

export async function refreshCompletedMoldIdsCache() {
  const qs = new URLSearchParams();
  qs.set('limit', '500');
  const res = await fetch(`${state.API_URL}/molds/completed?${qs.toString()}`, {
    credentials: 'include',
    cache: 'no-store'
  });
  if (!res.ok) {
    state.calendarCompletedMoldIdsCache = new Set();
    return;
  }
  const data = await res.json().catch(() => ({}));
  const molds = Array.isArray(data?.molds) ? data.molds : [];
  state.calendarCompletedMoldIdsCache = new Set(
    molds
      .map(m => {
        const mid = Number(m?.moldId);
        const pid = Number(m?.planningId);
        if (!Number.isFinite(mid) || mid <= 0) return null;
        if (!Number.isFinite(pid) || pid <= 0) return String(mid);
        return `${mid}:${pid}`;
      })
      .filter(Boolean)
  );
}

export function filterCalendarEventsHideCompleted(events, hideCompleted) {
  if (!hideCompleted) return events || {};
  const out = {};
  const source = (events && typeof events === 'object') ? events : {};

  Object.keys(source).forEach((dayKey) => {
    const day = source[dayKey] || {};
    const tasks = Array.isArray(day.tasks) ? day.tasks : [];
    const visibleTasks = tasks.filter(t => {
      const mid = Number(t?.moldId);
      const pid = Number(t?.planningId);
      if (!Number.isFinite(mid) || mid <= 0) return true;
      if (Number.isFinite(pid) && pid > 0) {
        if (state.calendarCompletedMoldIdsCache.has(`${mid}:${pid}`)) return false;
      }
      if (!Number.isFinite(pid) || pid <= 0) {
        const hasAnyCompletedCycle = Array.from(state.calendarCompletedMoldIdsCache).some(k => k === String(mid) || k.startsWith(`${mid}:`));
        if (hasAnyCompletedCycle) return false;
      }
      if (state.calendarCompletedMoldIdsCache.has(String(mid))) return false;
      return true;
    });
    if (!visibleTasks.length) return;

    const machineUsage = {};
    const machineCapacity = {};
    const machineMolds = new Map();
    for (const t of visibleTasks) {
      const machineName = String(t?.machine || '');
      const h = Number(t?.hours || 0);
      machineUsage[machineName] = Number(machineUsage[machineName] || 0) + (Number.isFinite(h) ? h : 0);
      if (!machineMolds.has(machineName)) machineMolds.set(machineName, new Set());
      machineMolds.get(machineName).add(Number(t?.moldId));
      if (day.machineCapacity && Object.prototype.hasOwnProperty.call(day.machineCapacity, machineName)) {
        machineCapacity[machineName] = day.machineCapacity[machineName];
      }
    }

    const hasOverlap = Array.from(machineMolds.values()).some(set => set.size > 1);
    out[dayKey] = {
      tasks: visibleTasks,
      machineUsage,
      machineCapacity,
      hasOverlap,
    };
  });

  return out;
}

export async function fetchMoldProgressDetail(moldId, opts = {}) {
  try {
    return await api.fetchMoldProgressDetail(moldId, opts);
  } catch (e) {
    return null;
  }
}

export async function loadCalendar() {
  if (!state.currentUser) return;
  const requestId = ++state.currentCalendarRequestId;
  state.calendarLoadingCount += 1;
  state.isCalendarLoading = true;
  setCalendarLoadingState(true);

  const display = document.getElementById('calendar-month-year');
  const grid = document.getElementById('calendar-grid');
  const progressList = document.getElementById('inProgressMoldList');
  const hideCompleted = false;
  const canUseFullCalendar = hasFullCalendarSupport();
  if (display) display.textContent = `${capitalize(state.monthNames[state.currentMonth])} ${state.currentYear}`;
  if (grid && !canUseFullCalendar) grid.innerHTML = 'Cargando...';
  if (progressList) progressList.innerHTML = '';
  try {
    const res = await fetch(`${state.API_URL}/calendar/month-view?year=${state.currentYear}&month=${state.currentMonth + 1}`, { credentials: 'include', cache: 'no-store' });
    const data = await res.json();
    if (requestId !== state.currentCalendarRequestId) {
      console.warn('[calendar] respuesta de month-view descartada por obsoleta', { requestId, currentCalendarRequestId: state.currentCalendarRequestId });
      return;
    }

    if (res.ok) {
      state.calendarHolidaysCache = (data && typeof data.holidays === 'object' && data.holidays) ? data.holidays : {};
      state.calendarWorkingOverridesCache = (data && typeof data.overrides === 'object' && data.overrides) ? data.overrides : {};
      setCalendarMonthState(data, { year: state.currentYear, month: state.currentMonth, hideCompleted });

      const renderedWithFullCalendar = canUseFullCalendar
        ? renderFullCalendarMonth(data, { year: state.currentYear, month: state.currentMonth, hideCompleted })
        : false;

      if (renderedWithFullCalendar) {
        setCalendarRenderMode(true);
      } else {
        setCalendarRenderMode(false);
        const events = data.events || {};
        renderCalendar(state.currentYear, state.currentMonth, events, data.holidays || {}, data.overrides || {});
      }

      try {
        renderInProgressMoldList();
      } catch (_) {}
    }
    else if (grid) {
      console.error('[calendar] error HTTP cargando month-view', data);
      setCalendarRenderMode(false);
      grid.innerHTML = '<p>Error cargar calendario</p>';
      alert('Ocurrió un error, intenta nuevamente');
    }
  } catch (e) {
    console.error('[calendar] error de red cargando month-view', e);
    setCalendarRenderMode(false);
    if (grid) grid.innerHTML = 'Error cargar calendario';
    alert('Ocurrió un error, intenta nuevamente');
  } finally {
    state.calendarLoadingCount = Math.max(0, state.calendarLoadingCount - 1);
    state.isCalendarLoading = state.calendarLoadingCount > 0;
    if (!state.isCalendarLoading) setCalendarLoadingState(false);
  }
}

export async function refreshCalendarData() {
  if (state.isCalendarLoading || state.isDeletingMold) {
    console.warn('[calendar] refreshCalendarData ignorado por operación en curso', { isCalendarLoading: state.isCalendarLoading, isDeletingMold: state.isDeletingMold });
    return false;
  }

  try {
    await loadCalendar();
    return true;
  } catch (e) {
    console.error('[calendar] refreshCalendarData error', e);
    alert('Ocurrió un error, intenta nuevamente');
    return false;
  }
}
export function renderCalendar(year, month, events = {}, holidays = {}, overrides = {}) {
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const todayStr = getBogotaTodayISO() || localISOFromDate(new Date());
  const firstDay = new Date(year, month, 1);
  const startDayIndex = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < startDayIndex; i++) { const d = document.createElement('div'); d.className = 'calendar-day other-month'; grid.appendChild(d); }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateISO = isoFromYMD(year, month, d);
    const classes = ['calendar-day'];

    const isWeekend = isWeekendISO(dateISO);
    const holidayName = holidays[dateISO];
    const isHoliday = Boolean(holidayName);
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, dateISO);
    const isWorkingOverride = hasOverride ? overrides[dateISO] === true : null;
    const isNonWorking = hasOverride ? !isWorkingOverride : (isWeekend || isHoliday);

    if (dateISO === todayStr) classes.push('today');
    if (isWeekend) classes.push('weekend');
    if (isHoliday) classes.push('holiday');
    if (isNonWorking) classes.push('non-working-day');

    const cell = document.createElement('div');
    cell.className = classes.join(' ');
    cell.innerHTML = `<div class="day-number">${d}</div>`;

    if (isHoliday) { cell.innerHTML += `<div class="holiday-name">${escapeHtml(holidayName)}</div>`; }

    // Visual override indicators:
    // - Deshabilitado (override false): X roja
    // - Habilitado (override true) solo si era NO laborable por defecto (festivo/fin de semana): ✓ verde
    if (hasOverride) {
      if (isWorkingOverride === false) {
        cell.innerHTML += `<div class="working-override-icon disabled" title="Día deshabilitado">✖</div>`;
      } else if (isWorkingOverride === true && (isWeekend || isHoliday)) {
        cell.innerHTML += `<div class="working-override-icon enabled" title="Día habilitado">✓</div>`;
      }
    }

    if (events && events[d] && Array.isArray(events[d].tasks) && events[d].tasks.length) {
      const tasks = Array.isArray(events[d].tasks) ? events[d].tasks : [];
      const seenCycles = new Set();
      let representativeMoldName = '';

      for (const t of tasks) {
        const mid = Number(t?.moldId);
        const pid = Number(t?.planningId);
        const cycleKey = makeMoldCycleKey(mid, pid) || String(mid || '');
        if (cycleKey && seenCycles.has(cycleKey)) continue;
        if (cycleKey) seenCycles.add(cycleKey);

        const moldName = String(t?.mold || '').trim();
        representativeMoldName = moldName || (Number.isFinite(mid) && mid > 0 ? `Molde ${mid}` : 'Molde');
        if (representativeMoldName) break;
      }

      cell.classList.add('has-events');
      if (representativeMoldName) {
        cell.innerHTML += `
          <div class="calendar-day-molds">
            <div class="calendar-day-mold">${escapeHtml(representativeMoldName)}</div>
          </div>
        `;
      }
    }
    cell.addEventListener('click', () => showDayDetails(dateISO, events[d], holidays[dateISO]));
    grid.appendChild(cell);
  }
}

export function getMachineOptionsHtml(selectedName) {
  const base = (state.FIXED_MACHINES || []).map(m => m.name);
  const names = Array.from(new Set([selectedName, ...base].filter(Boolean)));
  return names.map(n => `<option value="${escapeHtml(n)}" ${n === selectedName ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
}

export function renderDayDetailsView(dateISO, events, holiday) {
  const body = document.getElementById('modal-body');
  const titleEl = document.getElementById('modal-title');
  const dateStr = String(dateISO || '').trim();
  if (titleEl) titleEl.textContent = dateStr || '';

  const normalizeRole = (v) => String(v || '').trim().toLowerCase();
  const canQuickMove = (() => {
    const role = normalizeRole(state.currentUser?.role);
    return role === 'admin' || role === 'planner';
  })();

  const renderMachineCapacityBadges = (dayEvents) => {
    const usage = (dayEvents && typeof dayEvents.machineUsage === 'object' && dayEvents.machineUsage) ? dayEvents.machineUsage : {};
    const capacity = (dayEvents && typeof dayEvents.machineCapacity === 'object' && dayEvents.machineCapacity) ? dayEvents.machineCapacity : {};
    const machineNames = Array.from(new Set([
      ...Object.keys(usage || {}),
      ...Object.keys(capacity || {})
    ])).sort((a, b) => String(a).localeCompare(String(b), 'es'));

    if (!machineNames.length) return '';

    const chips = machineNames.map((name) => {
      const used = Number(usage?.[name] || 0);
      const capRaw = capacity?.[name];
      const cap = capRaw == null ? null : Number(capRaw);
      const capValid = Number.isFinite(cap) && cap > 0;
      const isFull = capValid && used >= (cap - 1e-9);

      const bg = isFull ? 'rgba(220,53,69,0.12)' : 'rgba(25,135,84,0.10)';
      const border = isFull ? 'rgba(220,53,69,0.45)' : 'rgba(25,135,84,0.35)';
      const text = isFull ? '#842029' : '#0f5132';
      const capLabel = capValid ? Number(cap).toFixed(2).replace(/\.00$/, '') : 'N/D';

      return `
        <span style="display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; border:1px solid ${border}; background:${bg}; color:${text}; font-size:0.85rem; font-weight:700;">
          <span>${escapeHtml(String(name))}</span>
          <span>${Number(used || 0).toFixed(2).replace(/\.00$/, '')}h / ${escapeHtml(capLabel)}h</span>
        </span>
      `;
    }).join('');

    return `
      <div style="margin:8px 0 12px 0;">
        <div style="font-weight:700; margin-bottom:6px;">Capacidad por máquina</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">${chips}</div>
      </div>
    `;
  };

  let html = '';
  if (holiday) html += `<p>${escapeHtml(holiday)}</p>`;

  html += renderMachineCapacityBadges(events);

  if (events && events.tasks && events.tasks.length) {
    // Agrupar por molde
    const byMold = new Map();
    for (const t of events.tasks) {
      const moldKey = `${String(t.moldId ?? t.mold ?? '')}:${String(t.planningId ?? '')}`;
      if (!byMold.has(moldKey)) byMold.set(moldKey, { moldId: t.moldId, planningId: t.planningId != null ? Number(t.planningId) : null, moldName: t.mold, isPriority: false, isFocused: false, tasks: [] });
      if (t && t.isPriority) byMold.get(moldKey).isPriority = true;
      if (t && t.__focusedCycle) byMold.get(moldKey).isFocused = true;
      byMold.get(moldKey).tasks.push(t);
    }

    for (const grp of byMold.values()) {
      const moldStateKey = grp.moldId != null ? `${String(grp.moldId)}:${String(grp.planningId ?? '')}` : '';
      const moldIdAttr = moldStateKey ? ` data-mold-state-for="${escapeHtml(moldStateKey)}"` : '';
      const priorityBadge = grp.isPriority
        ? '<span style="color:#b76e00; font-weight:800;">★ Prioridad</span>'
        : '';
      const focusedStyle = grp.isFocused
        ? 'border:1px solid rgba(37,99,235,0.35); border-radius:10px; padding:8px; background:rgba(37,99,235,0.06);'
        : '';
      html += `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:10px; ${focusedStyle}">
          <h4 style="margin:0; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span>${escapeHtml(grp.moldName || 'Molde')}</span>
            ${priorityBadge}
            ${grp.isFocused ? '<span style="font-size:0.75rem; color:#1d4ed8; font-weight:800;">Enfocado</span>' : ''}
            <span${moldIdAttr} style="font-size:0.85rem; color:var(--text-muted);">(Estado: ...)</span>
          </h4>
          ${grp.moldId ? `<button class="btn btn-secondary" data-edit-mold="${grp.moldId}" data-mold-name="${escapeHtml(grp.moldName || '')}">Editar este molde</button>` : ''}
        </div>
        <ul>
          ${grp.tasks.map(t => {
            const entryId = Number(t?.entryId);
            const canRenderQuick = canQuickMove && Number.isFinite(entryId) && entryId > 0;
            const quickButtons = canRenderQuick
              ? `<span style="display:inline-flex; gap:6px; margin-left:8px;">
                   <button class="btn btn-secondary" style="padding:2px 8px; min-height:auto;" data-quick-move="prev" data-entry-id="${entryId}" data-date="${escapeHtml(dateStr)}" data-machine="${escapeHtml(String(t.machine || ''))}" title="Mover al día laborable anterior">&larr;</button>
                   <button class="btn btn-secondary" style="padding:2px 8px; min-height:auto;" data-quick-move="next" data-entry-id="${entryId}" data-date="${escapeHtml(dateStr)}" data-machine="${escapeHtml(String(t.machine || ''))}" title="Mover al siguiente disponible">&rarr;</button>
                 </span>`
              : '';

            return `<li>
              <span>${escapeHtml(t.machine)}: (${escapeHtml(t.part)}) - ${t.hours}h</span>
              <span style="color:var(--text-muted); font-size:0.8rem; margin-left:6px;">#${Number.isFinite(entryId) ? entryId : '—'}</span>
              ${quickButtons}
            </li>`;
          }).join('')}
        </ul>
        ${grp.moldId ? `<div data-mold-progress-for="${escapeHtml(String(grp.moldId))}" data-mold-planning-for="${escapeHtml(String(grp.planningId ?? ''))}" style="margin-top:10px;">Cargando progreso...</div>` : ''}
      `;
    }
  } else {
    html += '<p>No hay planificación para este día.</p>';
  }

  html += `<div style="margin-top:12px;"><button class="btn btn-secondary" id="toggleWorkingBtn">Cargando estado...</button><small style="display:block; margin-top:6px;">Esto crea una excepción para este día.</small></div>`;

  html += `
    <div style="margin-top:8px;">
      <label style="display:inline-flex; align-items:center; gap:8px; font-size:0.9rem; color:var(--text-muted);">
        <input type="checkbox" id="dayAllowOverlap" ${state.sharedDays[dateISO] ? 'checked' : ''} />
        Permitir compartir día (Ignorar exclusividad, usar solo capacidad)
      </label>
    </div>
  `;

  html += `<div class="response-box" id="dayDetailsResponse"></div>`;

  if (body) body.innerHTML = html;

  // Persistencia de Compartir Día
  const dayAllowOverlapCb = document.getElementById('dayAllowOverlap');
  if (dayAllowOverlapCb) {
    dayAllowOverlapCb.addEventListener('change', () => {
      state.sharedDays[dateISO] = dayAllowOverlapCb.checked;
      localStorage.setItem('sharedDays', JSON.stringify(state.sharedDays));
    });
  }

  const addDaysISO = (iso, delta) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '';
    const [y, m, d] = String(iso).split('-').map(Number);
    const date = new Date(y, (m || 1) - 1, d || 1);
    date.setDate(date.getDate() + Number(delta || 0));
    const yy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };

  const findPreviousWorkingDateISO = async (fromISO, minISO) => {
    let cursor = String(fromISO || '');
    const MAX_SCAN = 370;
    for (let i = 0; i < MAX_SCAN; i++) {
      cursor = addDaysISO(cursor, -1);
      if (!cursor) return null;
      if (minISO && cursor < minISO) return null;
      if (await isDateLaborable(cursor)) return cursor;
    }
    return null;
  };

  const refreshDayModalData = async () => {
    const requestId = ++state.currentDayDetailsRequestId;
    try {
      const refreshed = await refreshCalendarData();
      if (requestId !== state.currentDayDetailsRequestId) {
        console.warn('[calendar] refresh de modal descartado por obsolescencia', { requestId, currentDayDetailsRequestId: state.currentDayDetailsRequestId });
        return;
      }

      if (!refreshed && state.isCalendarLoading) {
        console.warn('[calendar] refresh de modal aplazado por carga en curso');
      }

      const details = buildDayDetailsFromCalendarState(dateStr);
      if (!details) {
        console.error('[calendar] no se pudo construir detalle de modal desde monthData', { dateStr });
        alert('Ocurrió un error, intenta nuevamente');
        return;
      }

      showDayDetails(details.iso, details.dayEvents, details.holiday);
    } catch (e) {
      console.error('[calendar] error refrescando modal con fuente cacheada', e);
      alert('Ocurrió un error, intenta nuevamente');
    }
  };

  // Hook: editar molde
  document.querySelectorAll('#modal-body button[data-edit-mold]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const moldId = btn.getAttribute('data-edit-mold');
      const moldName = btn.getAttribute('data-mold-name') || '';
      await openMoldEditorView(moldId, moldName);
    });
  });

  // Hook: movimiento rápido por entrada (solo roles permitidos)
  document.querySelectorAll('#modal-body button[data-quick-move]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!canQuickMove) return;

      const action = String(btn.getAttribute('data-quick-move') || '').trim();
      const entryId = Number(btn.getAttribute('data-entry-id'));
      if (!Number.isFinite(entryId) || entryId <= 0) return;

      try {
        const allowOverlap = !!document.getElementById('dayAllowOverlap')?.checked;
        let resp;
        if (action === 'next') {
          resp = await fetch(`${state.API_URL}/tasks/plan/entry/${encodeURIComponent(String(entryId))}/next-available`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ baseDate: dateStr, allowOverlap })
          });
        } else {
          const todayISO = getBogotaTodayISO() || localISOFromDate(new Date());
          const prevISO = await findPreviousWorkingDateISO(dateStr, todayISO);
          if (!prevISO) {
            displayResponse('dayDetailsResponse', 'No existe un día laborable anterior permitido para mover esta entrada.', false);
            return;
          }

          const machineName = String(btn.getAttribute('data-machine') || '').trim();
          resp = await fetch(`${state.API_URL}/tasks/plan/entry/${encodeURIComponent(String(entryId))}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ date: prevISO, machineName, allowOverlap })
          });
        }

        const out = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          displayResponse('dayDetailsResponse', out?.error || 'No se pudo mover la entrada.', false);
          return;
        }

        displayResponse('dayDetailsResponse', out?.message || 'Entrada movida correctamente.', true);
        await refreshDayModalData();
      } catch (e) {
        displayResponse('dayDetailsResponse', `Error de conexión: ${String(e?.message || e)}`, false);
      }
    });
  });

  // Progreso por partes (por molde)
  (async () => {
    const nodes = Array.from(document.querySelectorAll('#modal-body [data-mold-progress-for]'));
    if (!nodes.length) return;

    await Promise.allSettled(nodes.map(async (el) => {
      const moldId = el.getAttribute('data-mold-progress-for');
      const planningRaw = el.getAttribute('data-mold-planning-for');
      const planningId = planningRaw ? Number(planningRaw) : null;
      if (!moldId) return;

      try {
        const progress = await fetchMoldProgressDetail(moldId, { asOf: dateStr, day: dateStr, planningId });
        const overallProgress = await fetchMoldProgressDetail(moldId, { asOf: dateStr, planningId });
        if (!progress || !progress.breakdown) {
          el.innerHTML = '<div style="color:var(--text-muted)">(Sin progreso disponible)</div>';
          return;
        }

        // Estado del molde: SIEMPRE global (todas las partes del molde hasta asOf),
        // no solo del día filtrado en el modal.
        const plannedTotal = Number(overallProgress?.totals?.plannedTotalHours ?? 0);
        const actualTotal = Number(overallProgress?.totals?.actualTotalHours ?? 0);
        const isDone = plannedTotal > 0 && actualTotal >= (plannedTotal - 0.01);
        const stateKey = `${String(moldId)}:${String(planningId ?? '')}`;
        const stateNode = document.querySelector(`#modal-body [data-mold-state-for="${String(stateKey)}"]`);
        if (stateNode) {
          stateNode.textContent = isDone ? '(Estado: Terminado)' : '(Estado: Pendiente)';
          stateNode.style.color = isDone ? 'var(--success)' : 'var(--warning)';
          stateNode.style.fontWeight = '700';
        }

        const completedCells = Number(progress?.totals?.completedCells);
        const totalCells = Number(progress?.totals?.totalCellsWithPlan);
        const pctByCells = (Number.isFinite(completedCells) && Number.isFinite(totalCells) && totalCells > 0)
          ? (completedCells / totalCells) * 100
          : null;
        const pct = pctByCells == null ? progress?.totals?.percentComplete : pctByCells;
        const planned = progress?.totals?.plannedTotalHours;
        const actual = progress?.totals?.actualTotalHours;
        el.innerHTML = `
          <div style="margin-bottom:6px; color:var(--text-muted); font-size:0.9rem;">Progreso: <strong>${pct == null ? '—' : Number(pct).toFixed(2) + '%'}</strong> · Real ${escapeHtml(fmtHours(actual))}h / Plan ${escapeHtml(fmtHours(planned))}h</div>
          ${renderMoldPartsProgressList(progress.breakdown)}
        `;
      } catch {
        el.innerHTML = '<div style="color:var(--danger)">Error cargando progreso</div>';
      }
    }));
  })();

  // Working toggle
  (async () => {
    const laborable = await isDateLaborable(dateStr);
    const btn = document.getElementById('toggleWorkingBtn');
    if (!btn) return;
    btn.textContent = laborable ? 'Deshabilitar día' : 'Habilitar día';
    btn.onclick = async () => {
      const desired = !laborable;
      try {
        const res = await fetch(`${state.API_URL}/working/override`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
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

export async function openMoldEditorView(moldId, moldName, opts = {}) {
  const previewMode = !!opts?.previewMode;
  const body = document.getElementById('modal-body');
  const titleEl = document.getElementById('modal-title');
  const modal = document.getElementById('day-details-modal');
  if (modal) modal.classList.remove('hidden');
  if (titleEl) titleEl.textContent = `${previewMode ? 'Vista previa del molde' : 'Editar molde'}: ${moldName || moldId}`;
  if (body) body.innerHTML = '<p>Cargando plan del molde...</p>';

  try {
    const res = await fetch(`${state.API_URL}/tasks/plan/mold/${encodeURIComponent(moldId)}`, {
      credentials: 'include',
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

    // Progreso por partes (para bloquear completados)
    let progress = null;
    const completedCells = new Set(); // partId:machineId
    try {
      progress = await fetchMoldProgressDetail(moldId);
      const parts = Array.isArray(progress?.breakdown?.parts) ? progress.breakdown.parts : [];
      for (const p of parts) {
        const machines = Array.isArray(p?.machines) ? p.machines : [];
        for (const m of machines) {
          if (m?.isComplete) completedCells.add(`${String(p.partId)}:${String(m.machineId)}`);
        }
      }
    } catch (_) {
      progress = null;
    }

    // Fecha sugerida para acciones masivas: el día abierto en el modal (si existe) o el inicio del molde
    const defaultBulkDate = (() => {
      try {
        const iso = String(lastDayDetailsContext?.dateISO || '').trim();
        if (iso) return iso;
      } catch (_) {}
      return startDate || getTodayISO();
    })();

    let html = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
        <div>
          <div class="text-muted">Rango del molde: ${escapeHtml(startDate)} → ${escapeHtml(endDate)}</div>
        </div>
        <button class="btn btn-secondary" id="moldEditorBackBtn">${previewMode ? 'Salir de vista previa' : 'Volver al día'}</button>
      </div>
      ${progress?.breakdown ? `
        <div class="mold-progress-panel" style="margin-bottom:10px;">
          <div style="font-weight:800;">Progreso por partes</div>
          ${renderMoldPartsProgressList(progress.breakdown)}
        </div>
      ` : ''}
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th></th>
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
              const isDone = completedCells.has(`${String(e.partId)}:${String(e.machineId)}`);
              return `
                <tr data-entry-id="${e.entryId ?? ''}">
                  <td style="text-align:center;">
                    <input type="checkbox" class="pe-entry-check" value="${escapeHtml(String(e.entryId ?? ''))}" ${isDone ? 'disabled' : ''}>
                  </td>
                  <td>${escapeHtml(curDate)}</td>
                  <td>${escapeHtml(curMachine)}</td>
                  <td>${escapeHtml(String(e.part || ''))}</td>
                  <td>${escapeHtml(String(e.hours || 0))}</td>
                  <td><input type="date" class="pe-new-date" value="${escapeHtml(curDate)}" ${isDone ? 'disabled' : ''}></td>
                  <td>
                    <select class="pe-new-machine" ${isDone ? 'disabled' : ''}>
                      ${getMachineOptionsHtml(curMachine)}
                    </select>
                  </td>
                  <td style="display:flex; gap:8px; align-items:center;">
                    ${isDone
                      ? '<span style="color:var(--success); font-weight:800;">Terminado</span>'
                      : '<button class="btn btn-secondary pe-save-btn">Guardar</button>\n                    <button class="btn btn-secondary pe-next-btn" title="Busca el siguiente día laborable con cupo y mueve esta tarea">⏭ Saltar al siguiente hueco</button>'}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="mold-progress-panel" style="margin-top:10px; margin-bottom:10px;">
        <div style="font-weight:800; margin-bottom:6px;">Selección múltiple por filas</div>
        <div class="text-muted" style="font-size:0.9rem;">Marca 2+ filas para mostrar acciones masivas (solo pendientes).</div>
        <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <button class="btn btn-secondary" id="peSelectAllRowsBtn">Seleccionar todo</button>
          <button class="btn btn-secondary" id="peClearAllRowsBtn">Limpiar selección</button>
          <button class="btn btn-secondary" id="pePushAllNextBtn" title="Empuja todas las filas pendientes al siguiente hueco">⏩ Empujar todas las partes pendientes al siguiente hueco</button>
          <div class="text-muted">Seleccionadas: <strong id="peBulkSelectedCount">0</strong></div>
        </div>

        <div style="margin-top:8px;">
          <label style="display:inline-flex; align-items:center; gap:8px; font-size:0.9rem; color:var(--text-muted);">
            <input type="checkbox" id="peAllowOverlap" />
            Permitir compartir día (Ignorar exclusividad, usar solo capacidad)
          </label>
        </div>

        <div id="peBulkPanel" style="display:none; margin-top:10px; padding-top:10px; border-top:1px solid var(--border-color);">
          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
            <div style="min-width: 220px;">
              <label style="display:block; font-weight:600;">Fecha base</label>
              <input type="date" id="peBulkMoveDate" value="${escapeHtml(String(defaultBulkDate || ''))}">
              <div class="text-muted" style="font-size:0.85rem; margin-top:4px;">Para “Siguiente disponible”, se busca desde el día siguiente laborable.</div>
            </div>

            <div style="display:flex; gap:8px; align-items:end; flex-wrap:wrap;">
              <button class="btn btn-secondary" id="peBulkMoveToDateBtn" title="Mueve las filas seleccionadas a esta fecha">Mover a fecha</button>
              <button class="btn btn-secondary" id="peBulkMoveNextBtn" title="Busca el siguiente disponible y mueve las filas seleccionadas">Siguiente disponible</button>
            </div>
          </div>
        </div>
      </div>
      <div class="response-box" id="moldEditorResponse"></div>
    `;

    if (body) body.innerHTML = html;

    const backBtn = document.getElementById('moldEditorBackBtn');
    if (backBtn) backBtn.onclick = () => {
      if (previewMode) {
        hideModal();
        return;
      }
      if (lastDayDetailsContext) {
        renderDayDetailsView(lastDayDetailsContext.dateISO, lastDayDetailsContext.events, lastDayDetailsContext.holiday);
      }
    };

    if (previewMode) {
      body.querySelectorAll('input, select, textarea').forEach((el) => {
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
          el.disabled = true;
        }
      });
      body.querySelectorAll('.pe-save-btn, .pe-next-btn').forEach((btn) => {
        if (btn instanceof HTMLElement) btn.classList.add('hidden');
      });
      const bulkPanel = document.getElementById('peBulkPanel');
      if (bulkPanel) bulkPanel.classList.add('hidden');
      const bulkControlIds = ['peSelectAllRowsBtn', 'peClearAllRowsBtn', 'pePushAllNextBtn', 'peBulkMoveToDateBtn', 'peBulkMoveNextBtn'];
      bulkControlIds.forEach((id) => {
        const btn = document.getElementById(id);
        if (btn) btn.classList.add('hidden');
      });
      return;
    }

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

        // Validaciones Estrictas para el Movimiento Manual
        const val = await validateManualMove(newDate, newMachineName, !!document.getElementById('peAllowOverlap')?.checked);
        if (!val.ok) {
          showToast(val.error, 'error');
          displayResponse('moldEditorResponse', { error: val.error }, false);
          return;
        }

        try {
          const allowOverlap = !!document.getElementById('peAllowOverlap')?.checked;
          const resp = await fetch(`${state.API_URL}/tasks/plan/entry/${encodeURIComponent(entryId)}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ date: newDate, machineName: newMachineName, allowOverlap })
            }
          );
          const out = await resp.json();
          displayResponse('moldEditorResponse', out?.message || out?.error || 'Listo', resp.ok);
          if (resp.ok) {
            await refreshCalendarData();
            // Recargar vista del molde para reflejar cambios
            await openMoldEditorView(moldId, moldName, opts);
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
          const allowOverlap = !!document.getElementById('peAllowOverlap')?.checked;
          const resp = await fetch(`${state.API_URL}/tasks/plan/entry/${encodeURIComponent(entryId)}/next-available`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ baseDate, machineName, allowOverlap })
            }
          );
          const out = await resp.json();
          displayResponse('moldEditorResponse', out?.message || out?.error || 'Listo', resp.ok);
          if (resp.ok) {
            await refreshCalendarData();
            await openMoldEditorView(moldId, moldName, opts);
          } else {
            // Mensaje ya mostrado en moldEditorResponse
          }
        } catch (e) {
          displayResponse('moldEditorResponse', { error: 'Error de conexión', details: String(e) }, false);
        }
      });
    });

    // Acciones masivas por filas (entryId)
    const bulkPanelEl = document.getElementById('peBulkPanel');
    const selectedCountEl = document.getElementById('peBulkSelectedCount');
    const selectAllRowsBtn = document.getElementById('peSelectAllRowsBtn');
    const clearAllRowsBtn = document.getElementById('peClearAllRowsBtn');

    function getSelectedEntryIds() {
      return Array.from(body.querySelectorAll('input.pe-entry-check'))
        .filter(cb => cb.checked && !cb.disabled)
        .map(cb => Number.parseInt(String(cb.value || ''), 10))
        .filter(n => Number.isFinite(n) && n > 0);
    }

    function refreshBulkUi() {
      const selected = getSelectedEntryIds();
      if (selectedCountEl) selectedCountEl.textContent = String(selected.length);
      if (bulkPanelEl) bulkPanelEl.style.display = selected.length >= 2 ? '' : 'none';
    }

    if (selectAllRowsBtn) selectAllRowsBtn.onclick = () => {
      body.querySelectorAll('input.pe-entry-check').forEach(cb => { if (!cb.disabled) cb.checked = true; });
      refreshBulkUi();
    };
    if (clearAllRowsBtn) clearAllRowsBtn.onclick = () => {
      body.querySelectorAll('input.pe-entry-check').forEach(cb => { cb.checked = false; });
      refreshBulkUi();
    };
    body.querySelectorAll('input.pe-entry-check').forEach(cb => {
      cb.addEventListener('change', refreshBulkUi);
    });
    refreshBulkUi();

    async function runBulkMove(mode, opts = {}) {
      const entryIds = Array.isArray(opts.entryIds) ? opts.entryIds : getSelectedEntryIds();
      if (entryIds.length < 2 && !opts.allowSingle) {
        displayResponse('moldEditorResponse', { error: 'Selecciona al menos 2 filas para mover en bloque.' }, false);
        return;
      }

      const dateEl = document.getElementById('peBulkMoveDate');
      const date = dateEl ? String(dateEl.value || '').trim() : '';
      if (mode === 'date' && !date) {
        displayResponse('moldEditorResponse', { error: 'Selecciona una fecha.' }, false);
        return;
      }

      if (!opts.skipConfirm) {
        const ok = window.confirm(
          mode === 'date'
            ? `¿Mover ${entryIds.length} fila(s) a la fecha ${date}?\n\nSe omitirán filas terminadas y/o las que no se puedan mover por reglas.`
            : `¿Mover ${entryIds.length} fila(s) al siguiente disponible?\n\nSe omitirán filas terminadas y/o las que no se puedan mover por reglas.`
        );
        if (!ok) return;
      }

      displayResponse('moldEditorResponse', { message: 'Reprogramando filas...' }, true);
      try {
        const allowOverlap = !!document.getElementById('peAllowOverlap')?.checked;
        
        // Validación para la fecha destino en bloque
        if (mode === 'date') {
           const val = await validateManualMove(date, null, allowOverlap, { skipMachineCheck: true });
           if (!val.ok) {
             showToast(val.error, 'error');
             displayResponse('moldEditorResponse', { error: val.error }, false);
             return;
           }
        }

        const resp = await fetch(`${state.API_URL}/tasks/plan/entries/bulk-move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ entryIds, mode, date: date || null, baseDate: date || null, allowOverlap })
        });
        const out = await resp.json().catch(() => ({}));
        displayResponse('moldEditorResponse', out?.message || out?.error || 'Listo', resp.ok);
        if (resp.ok) {
          await refreshCalendarData();
          await openMoldEditorView(moldId, moldName, opts);
        }
      } catch (e) {
        displayResponse('moldEditorResponse', { error: 'Error de conexión', details: String(e) }, false);
      }
    }

    const bulkToDateBtn = document.getElementById('peBulkMoveToDateBtn');
    const bulkNextBtn = document.getElementById('peBulkMoveNextBtn');
    const pushAllNextBtn = document.getElementById('pePushAllNextBtn');
    if (bulkToDateBtn) bulkToDateBtn.onclick = () => runBulkMove('date');
    if (bulkNextBtn) bulkNextBtn.onclick = () => runBulkMove('next');
    if (pushAllNextBtn) {
      pushAllNextBtn.onclick = async () => {
        const pendingIds = Array.from(body.querySelectorAll('input.pe-entry-check'))
          .filter(cb => !cb.disabled)
          .map(cb => Number.parseInt(String(cb.value || ''), 10))
          .filter(n => Number.isFinite(n) && n > 0);

        if (!pendingIds.length) {
          displayResponse('moldEditorResponse', { error: 'No hay filas pendientes para empujar.' }, false);
          return;
        }

        await runBulkMove('next', { entryIds: pendingIds, allowSingle: true, skipConfirm: true });
      };
    }
  } catch (e) {
    if (body) body.innerHTML = `<p>Error: ${escapeHtml(String(e))}</p>`;
  }
}

export function showDayDetails(dateISO, events, holiday) {
  const modal = document.getElementById('day-details-modal');
  lastDayDetailsContext = { dateISO: String(dateISO || '').trim(), events, holiday };
  renderDayDetailsView(dateISO, events, holiday);
  if (modal) modal.classList.remove('hidden');
}

/**
 * Valida reglas de negocio para movimiento manual de planificación.
 */
async function validateManualMove(date, machineName, forceAllowOverlap = false, opts = {}) {
  const iso = normalizeToISODate(date);
  if (!iso) return { ok: false, error: 'Fecha inválida.' };

  // 1. Día Laborable
  const laborable = await isDateLaborable(iso);
  if (!laborable) {
    return { ok: false, error: 'Día no laborable (fin de semana o feriado).' };
  }

  // 2. Capacidad de Máquina (si aplica)
  if (!opts.skipMachineCheck && machineName) {
    const isShared = !!state.sharedDays[iso] || forceAllowOverlap;
    
    // Si no está permitido compartir el día, validamos exclusividad (carga > 0)
    if (!isShared) {
      const day = getDayFromISO(iso);
      if (day) {
        const isoParts = iso.split('-');
        const y = parseInt(isoParts[0], 10);
        const m = parseInt(isoParts[1], 10) - 1;
        
        // Solo podemos validar si el mes coincide con el cargado en el calendario
        if (state.calendarMonthState?.year === y && state.calendarMonthState?.month === m) {
          const dayEvents = buildDayEventsFromMonthState(iso);
          const usage = dayEvents?.machineUsage?.[machineName] || 0;
          if (usage > 1e-6) {
            return { ok: false, error: 'Día sin capacidad. Active "Compartir Día" en la fecha destino o elija otra.' };
          }
        }
      }
    }
  }

  return { ok: true };
}
// Extracted hideModal to ui.js




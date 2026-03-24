const { query } = require('../config/database');
const { getColombiaHolidays } = require('../services/holidaysColombia.service');

/* =========================================
   Utilidades de fecha (LOCAL, no UTC)
   ========================================= */
function localISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDays(date, days) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}
function todayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
function parseLocalISO(iso) {
  // iso: "YYYY-MM-DD"
  const [y, m, d] = (iso || '').split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function isValidISODateString(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseBoolInput(v) {
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

/* =========================================
   Laborabilidad (Lun-Vie, festivos, overrides)
   ========================================= */
async function getWorkingMeta() {
  // Cadenas YYYY-MM-DD desde SQL para evitar TZ
  const holidays = await query("SELECT to_char(date, 'YYYY-MM-DD') AS d FROM holidays");
  const overrides = await query("SELECT to_char(date, 'YYYY-MM-DD') AS d, is_working FROM working_overrides");
  const holidaySet = new Set(holidays.map(h => h.d));

  // Alinear con el calendario: incluir festivos automáticos de Colombia
  // (solo strings YYYY-MM-DD; no dependemos de Date/UTC para comparar)
  const y = todayLocal().getFullYear();
  const years = [y - 1, y, y + 1];
  for (const year of years) {
    const list = getColombiaHolidays(year);
    for (const h of list) holidaySet.add(h.date);
  }

  const overrideMap = new Map(overrides.map(o => [o.d, o.is_working ? 1 : 0]));
  return { holidaySet, overrideMap };
}
function isWorkingDayLocal(d, holidaySet, overrideMap) {
  const iso = localISO(d);
  // Override manda por encima de todo
  if (overrideMap.has(iso)) return overrideMap.get(iso) === 1;

  const dow = d.getDay(); // 0=Dom, 6=Sáb
  if (dow === 0 || dow === 6) return false;
  if (holidaySet.has(iso)) return false;
  return true;
}
function nextWorkingDayLocal(d, holidaySet, overrideMap) {
  let cur = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  do {
    cur = addDays(cur, 1);
  } while (!isWorkingDayLocal(cur, holidaySet, overrideMap));
  return cur;
}
async function firstWorkingOnOrAfter(dateISO, holidaySet, overrideMap) {
  let d = dateISO ? parseLocalISO(dateISO) : todayLocal();
  d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  while (!isWorkingDayLocal(d, holidaySet, overrideMap)) d = addDays(d, 1);
  return d;
}

/* =========================================
   Helpers de dominio y usuario
   ========================================= */
function toStr(v) { return v == null ? null : String(v).trim(); }
function round025(n) { return Math.round(n / 0.25) * 0.25; }
function getRequestUserId(req) { return req.user?.id ?? req.user?.userId ?? req.user?.uid ?? null; }

async function upsertPlannerGridSnapshot({ mold_id, startDateISO, snapshot, userId }) {
  if (!mold_id || !startDateISO || !snapshot) return;
  if (!isValidISODateString(startDateISO)) return;

  const payload = (typeof snapshot === 'string') ? snapshot : JSON.stringify(snapshot);

  await query(
    `INSERT INTO planner_grid_snapshots (mold_id, start_date, snapshot_json, created_by, updated_by)
     VALUES (?,?,?::jsonb,?,?)
     ON CONFLICT (mold_id, start_date)
     DO UPDATE SET snapshot_json = EXCLUDED.snapshot_json, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [mold_id, startDateISO, payload, userId, userId]
  );
}

async function getPlannerGridSnapshot({ mold_id, startDateISO }) {
  if (!mold_id) return null;
  if (startDateISO && !isValidISODateString(startDateISO)) return null;

  const rows = await query(
    `SELECT to_char(start_date,'YYYY-MM-DD') AS start_date, snapshot_json
     FROM planner_grid_snapshots
     WHERE mold_id = ?
     ${startDateISO ? 'AND start_date = ?' : ''}
     ORDER BY updated_at DESC
     LIMIT 1`,
    startDateISO ? [mold_id, startDateISO] : [mold_id]
  );
  if (!rows.length) return null;

  return { startDate: rows[0].start_date, snapshot: rows[0].snapshot_json };
}

// Mapeo de alias del frontend -> nombres canónicos en BD
function mapMachineAlias(name) {
  const ALIAS_TO_NAME = {
    'CNC_VF3_1': 'CNC VF3 #1',
    'CNC_VF3_2': 'CNC VF3 #2',
    'FRESADORA_1': 'Fresadora #1',
    'FRESADORA_2': 'Fresadora #2',
    'TORNO_CNC': 'Torno CNC',
    'EROSIONADORA': 'Erosionadora',
    'RECTIFICADORA': 'Rectificadora',
    'TORNO': 'Torno',
    'TALADRO_RADIAL': 'Taladro radial',
    'PULIDA': 'Pulida'
  };
  const k = (name || '').trim();
  return ALIAS_TO_NAME[k] || k;
}

async function getOrCreateMoldId(name) {
  const n = toStr(name); if (!n) throw new Error('Nombre de molde requerido');
  const ex = await query('SELECT id FROM molds WHERE LOWER(name)=LOWER(?) LIMIT 1', [n]);
  if (ex.length) return ex[0].id;
  const r = await query('INSERT INTO molds (name, is_active) VALUES (?, TRUE)', [n]);
  return r.insertId;
}

async function getMoldIdByName(name) {
  const n = toStr(name);
  if (!n) return null;
  const ex = await query('SELECT id FROM molds WHERE LOWER(name)=LOWER(?) LIMIT 1', [n]);
  return ex.length ? Number(ex[0].id) : null;
}

async function moldHasAnyPlan(mold_id) {
  const rows = await query('SELECT 1 FROM plan_entries WHERE mold_id = ? LIMIT 1', [mold_id]);
  return rows.length > 0;
}

async function moldHasActivePlan(mold_id) {
  const hasPlan = await moldHasAnyPlan(mold_id);
  if (!hasPlan) return false;
  const completed = await isMoldCompletedByCurrentPlan(mold_id);
  return !completed;
}
async function getOrCreatePartId(name) {
  const n = toStr(name); if (!n) throw new Error('Nombre de parte requerido');
  const ex = await query('SELECT id FROM mold_parts WHERE LOWER(name)=LOWER(?) LIMIT 1', [n]);
  if (ex.length) return ex[0].id;
  const r = await query('INSERT INTO mold_parts (name, is_active) VALUES (?, TRUE)', [n]);
  return r.insertId;
}
async function getOrCreateMachineByName(name) {
  const canonical = mapMachineAlias(name);
  const n = toStr(canonical); if (!n) throw new Error('Nombre de máquina requerido');
  const ex = await query('SELECT id, daily_capacity FROM machines WHERE LOWER(name)=LOWER(?) LIMIT 1', [n]);
  if (ex.length) return { id: ex[0].id, daily_capacity: ex[0].daily_capacity };
  const r = await query('INSERT INTO machines (name, is_active) VALUES (?, TRUE)', [n]);
  return { id: r.insertId, daily_capacity: null };
}

async function getMoldNameById(mold_id) {
  const rows = await query('SELECT name FROM molds WHERE id = ? LIMIT 1', [mold_id]);
  return rows.length ? rows[0].name : null;
}

async function getMoldPlanRange(mold_id) {
  const rows = await query(
    `SELECT
       to_char(MIN(date), 'YYYY-MM-DD') AS start_date,
       to_char(MAX(date), 'YYYY-MM-DD') AS end_date
     FROM plan_entries
     WHERE mold_id = ?`,
    [mold_id]
  );
  return {
    startDate: rows?.[0]?.start_date || null,
    endDate: rows?.[0]?.end_date || null,
  };
}

async function getActivePlanningMetaForMold(mold_id, asOfISO = null) {
  const refDate = (asOfISO && /^\d{4}-\d{2}-\d{2}$/.test(String(asOfISO))) ? String(asOfISO) : null;
  const rows = await query(
    `SELECT
       id,
       to_char(to_start_date, 'YYYY-MM-DD') AS start_date
     FROM planning_history
     WHERE mold_id = ?
       AND event_type = 'PLANNED'
       ${refDate ? 'AND (to_start_date IS NULL OR to_start_date <= ?)' : ''}
     ORDER BY to_start_date DESC NULLS LAST, created_at DESC, id DESC
     LIMIT 1`,
    refDate ? [mold_id, refDate] : [mold_id]
  );
  if (!rows.length) return { planningId: null, startDate: null };
  return {
    planningId: Number(rows[0].id || 0) || null,
    startDate: rows[0].start_date || null,
  };
}

function buildWorkLogScopeSql({ alias, mold_id, planningId, startDate }) {
  if (planningId) {
    return {
      clause: `
       AND (
         ${alias}.planning_id = ?
         OR (${alias}.planning_id IS NULL AND COALESCE(${alias}.work_date, ${alias}.recorded_at::date) >= ?)
       )`,
      params: [planningId, startDate || '1900-01-01'],
    };
  }

  return {
    clause: `
       AND COALESCE(${alias}.work_date, ${alias}.recorded_at::date) >= COALESCE(
         (SELECT ph.to_start_date
          FROM planning_history ph
          WHERE ph.mold_id = ? AND ph.event_type = 'PLANNED'
          ORDER BY ph.created_at DESC, ph.id DESC
          LIMIT 1),
         (SELECT MIN(date) FROM plan_entries WHERE mold_id = ?)
       )`,
    params: [mold_id, mold_id],
  };
}

function buildPlanEntriesCycleScopeSql({ alias, mold_id, planningId, startDate }) {
  if (planningId) {
    return {
      clause: `
       AND (
         ${alias}.planning_id = ?
         OR (${alias}.planning_id IS NULL AND ${alias}.date >= ?)
       )`,
      params: [planningId, startDate || '1900-01-01'],
    };
  }

  return {
    clause: `
       AND ${alias}.date >= COALESCE(
         (SELECT ph.to_start_date
          FROM planning_history ph
          WHERE ph.mold_id = ? AND ph.event_type = 'PLANNED'
          ORDER BY ph.created_at DESC, ph.id DESC
          LIMIT 1),
         (SELECT MIN(date) FROM plan_entries WHERE mold_id = ?)
       )`,
    params: [mold_id, mold_id],
  };
}

async function getPlannedPairsForCurrentCycle({ mold_id, planningMeta }) {
  const planScope = buildPlanEntriesCycleScopeSql({
    alias: 'p',
    mold_id,
    planningId: planningMeta?.planningId || null,
    startDate: planningMeta?.startDate || null,
  });

  return query(
    `SELECT p.part_id, p.machine_id, SUM(p.hours_planned) AS planned_hours
     FROM plan_entries p
     WHERE p.mold_id = ?
       ${planScope.clause}
     GROUP BY p.part_id, p.machine_id
     HAVING SUM(p.hours_planned) > 0`,
    [mold_id, ...planScope.params]
  );
}

function planRangesEqual(a, b) {
  const left = a || {};
  const right = b || {};
  return (left.startDate || null) === (right.startDate || null)
    && (left.endDate || null) === (right.endDate || null);
}

async function insertPlanningHistoryEvent({
  mold_id,
  eventType,
  fromRange,
  toRange,
  note = null,
  createdBy = null,
}) {
  if (!mold_id || !eventType) return;
  const rows = await query(
    `INSERT INTO planning_history (
       mold_id,
       event_type,
       from_start_date,
       from_end_date,
       to_start_date,
       to_end_date,
       note,
       created_by
     ) VALUES (?,?,?,?,?,?,?,?)
     RETURNING id`,
    [
      mold_id,
      String(eventType).trim().toUpperCase(),
      fromRange?.startDate || null,
      fromRange?.endDate || null,
      toRange?.startDate || null,
      toRange?.endDate || null,
      note,
      createdBy || null,
    ]
  );
  const insertedId = Number(rows?.[0]?.id || 0);
  return Number.isFinite(insertedId) && insertedId > 0 ? insertedId : null;
}

async function logMoldRangeChange({ mold_id, eventType, createdBy = null, note = null, beforeRange = null, afterRange = null }) {
  const before = beforeRange || await getMoldPlanRange(mold_id);
  const after = afterRange || await getMoldPlanRange(mold_id);
  if (planRangesEqual(before, after)) return;
  await insertPlanningHistoryEvent({
    mold_id,
    eventType,
    fromRange: before,
    toRange: after,
    note,
    createdBy,
  });
}

/* =========================================
   Primitivas de Scheduling
   ========================================= */
async function insertEntry({ mold_id, planning_id = null, part_id, machine_id, dateISO, hours, createdBy, isPriority = false }) {
  const hrs = round025(hours);
  if (createdBy == null) throw new Error('created_by requerido (usuario no normalizado)');
  await query(
    `INSERT INTO plan_entries (mold_id, planning_id, part_id, machine_id, date, hours_planned, is_priority, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [mold_id, planning_id, part_id, machine_id, dateISO, hrs, isPriority ? 1 : 0, createdBy]
  );
}

async function getDayUsage(machine_id, dateISO) {
  const rows = await query(
    `SELECT mold_id, SUM(hours_planned) AS used, BOOL_OR(is_priority) AS has_priority
     FROM plan_entries
     WHERE machine_id = ? AND date = ?
     GROUP BY mold_id`,
    [machine_id, dateISO]
  );
  const used = rows.reduce((a, r) => a + Number(r.used || 0), 0);
  const moldIds = rows.map(r => r.mold_id);
  const moldInfoById = new Map();
  for (const r of rows || []) {
    moldInfoById.set(Number(r.mold_id), { hasPriority: Boolean(r.has_priority) });
  }
  return { used: round025(used), moldIds, moldInfoById };
}

async function getDayUsageExcludingEntry(machine_id, dateISO, excludeEntryId) {
  const rows = await query(
    `SELECT mold_id, SUM(hours_planned) AS used, BOOL_OR(is_priority) AS has_priority
     FROM plan_entries
     WHERE machine_id = ? AND date = ? AND id <> ?
     GROUP BY mold_id`,
    [machine_id, dateISO, excludeEntryId]
  );
  const used = rows.reduce((a, r) => a + Number(r.used || 0), 0);
  const moldIds = rows.map(r => r.mold_id);
  const moldInfoById = new Map();
  for (const r of rows || []) {
    moldInfoById.set(Number(r.mold_id), { hasPriority: Boolean(r.has_priority) });
  }
  return { used: round025(used), moldIds, moldInfoById };
}

async function isMoldCompletedByCurrentPlan(mold_id) {
  const planningMeta = await getActivePlanningMetaForMold(mold_id);
  const wlScope = buildWorkLogScopeSql({
    alias: 'wl',
    mold_id,
    planningId: planningMeta.planningId,
    startDate: planningMeta.startDate,
  });

  const plannedPairs = await getPlannedPairsForCurrentCycle({ mold_id, planningMeta });

  if (!plannedPairs.length) return false;

  // Una parte se considera COMPLETADA solo si tiene al menos un registro con is_final_log = true
  const finalLogPairs = await query(
    `SELECT DISTINCT part_id, machine_id
     FROM work_logs wl
     WHERE wl.mold_id = ? AND wl.is_final_log = TRUE
       ${wlScope.clause}`,
    [mold_id, ...wlScope.params]
  );

  const finalSet = new Set(finalLogPairs.map(r => `${String(r.part_id)}:${String(r.machine_id)}`));

  for (const p of plannedPairs || []) {
    if (!(Number(p.planned_hours || 0) > 0)) continue;
    const key = `${String(p.part_id)}:${String(p.machine_id)}`;
    if (!finalSet.has(key)) return false;
  }

  return true;
}

async function isMoldCompletedCached(mold_id, completionCache) {
  if (!completionCache) return isMoldCompletedByCurrentPlan(mold_id);
  const key = Number(mold_id);
  if (completionCache.has(key)) return completionCache.get(key);
  const done = await isMoldCompletedByCurrentPlan(mold_id);
  completionCache.set(key, done);
  return done;
}

async function canShareWithExistingMold({ currentIsPriority, existingMoldId, machine_id, dateISO, holidaySet, overrideMap, completionCache }) {
  const lastDay = await isLastDayOfBlock(machine_id, existingMoldId, dateISO, holidaySet, overrideMap);
  if (!lastDay) return false;

  if (!currentIsPriority) {
    const completed = await isMoldCompletedCached(existingMoldId, completionCache);
    return completed;
  }

  return true;
}

async function findFirstBlockedWorkingDayBetween({
  fromDateISO,
  toDateISO,
  machine_id,
  currentMoldId,
  currentIsPriority,
  holidaySet,
  overrideMap,
  excludeEntryId = null,
  noShareWithOtherMolds = false,
}) {
  if (!fromDateISO || !toDateISO) return null;
  if (toDateISO <= fromDateISO) return null;

  let cursor = nextWorkingDayLocal(parseLocalISO(fromDateISO), holidaySet, overrideMap);
  const completionCache = new Map();
  const MAX_DAYS_SCAN = 370;

  for (let i = 0; i < MAX_DAYS_SCAN; i++) {
    const dateISO = localISO(cursor);
    if (dateISO > toDateISO) break;

    const { moldIds } = await getDayUsageExcludingEntry(machine_id, dateISO, excludeEntryId);
    const otherMolds = moldIds.filter(mid => mid !== currentMoldId);

    if (otherMolds.length > 0) {
      if (noShareWithOtherMolds) return dateISO;
      const uniq = Array.from(new Set(otherMolds));
      if (uniq.length > 1) return dateISO;

      const ok = await canShareWithExistingMold({
        currentIsPriority: Boolean(currentIsPriority),
        existingMoldId: uniq[0],
        machine_id,
        dateISO,
        holidaySet,
        overrideMap,
        completionCache,
      });
      if (!ok) return dateISO;
    }

    if (dateISO === toDateISO) break;
    cursor = nextWorkingDayLocal(cursor, holidaySet, overrideMap);
  }

  return null;
}

async function hasOtherMoldPlannedOnDate({ dateISO, currentMoldId, excludeEntryId = null }) {
  if (!dateISO) return false;
  const rows = await query(
    `SELECT 1
     FROM plan_entries
     WHERE date = ?
       AND mold_id <> ?
       AND (?::int IS NULL OR id <> ?)
     LIMIT 1`,
    [dateISO, currentMoldId, excludeEntryId, excludeEntryId]
  );
  return rows.length > 0;
}

async function findFirstBlockedWorkingDayBetweenGlobal({
  fromDateISO,
  toDateISO,
  currentMoldId,
  holidaySet,
  overrideMap,
  excludeEntryId = null,
}) {
  if (!fromDateISO || !toDateISO) return null;
  if (toDateISO <= fromDateISO) return null;

  let cursor = nextWorkingDayLocal(parseLocalISO(fromDateISO), holidaySet, overrideMap);
  const MAX_DAYS_SCAN = 370;

  for (let i = 0; i < MAX_DAYS_SCAN; i++) {
    const dateISO = localISO(cursor);
    if (dateISO > toDateISO) break;

    const blocked = await hasOtherMoldPlannedOnDate({
      dateISO,
      currentMoldId,
      excludeEntryId,
    });
    if (blocked) return dateISO;

    if (dateISO === toDateISO) break;
    cursor = nextWorkingDayLocal(cursor, holidaySet, overrideMap);
  }

  return null;
}

async function isLastDayOfBlock(machine_id, mold_id, dateISO, holidaySet, overrideMap) {
  const cur = parseLocalISO(dateISO);
  const next = nextWorkingDayLocal(cur, holidaySet, overrideMap);
  const rows = await query(
    `SELECT 1 FROM plan_entries WHERE machine_id = ? AND date = ? AND mold_id = ? LIMIT 1`,
    [machine_id, localISO(next), mold_id]
  );
  return rows.length === 0;
}

function normalizeTasksQueueByPart(tasksQueue) {
  const normalized = [];
  const indexByPart = new Map();

  for (const raw of (tasksQueue || [])) {
    const part_id = Number(raw?.part_id);
    const hours = round025(Number(raw?.hours || 0));
    if (!Number.isFinite(part_id) || part_id <= 0) continue;
    if (!(hours > 0)) continue;

    const existingIndex = indexByPart.get(part_id);
    if (existingIndex == null) {
      indexByPart.set(part_id, normalized.length);
      normalized.push({ part_id, hours });
    } else {
      normalized[existingIndex].hours = round025(normalized[existingIndex].hours + hours);
    }
  }

  return normalized.filter(t => t.hours > 0);
}

// Coloca un bloque sin mezclar; puede compartir SOLO el último día de un bloque anterior si hay capacidad
async function placeBlockNoPreempt({ mold_id, planning_id = null, machine_id, capPerDay, baseDateISO, tasksQueue, createdBy, holidaySet, overrideMap, allowShareLastDay = true, isPriority = false, completionCache = null, strictNoSkip = false, strictGlobalUniqueDay = false, allowOverlap = false }) {
  let cursor = parseLocalISO(baseDateISO);
  while (!isWorkingDayLocal(cursor, holidaySet, overrideMap)) cursor = addDays(cursor, 1);

  const queue = normalizeTasksQueueByPart(tasksQueue);

  let lastPlannedDate = null;

  while (queue.length > 0) {
    while (!isWorkingDayLocal(cursor, holidaySet, overrideMap)) cursor = addDays(cursor, 1);
    const dateISO = localISO(cursor);

    if (strictGlobalUniqueDay) {
      const dayMolds = await query('SELECT DISTINCT mold_id FROM plan_entries WHERE date = ?', [dateISO]);
      const otherMolds = (dayMolds || []).map(r => Number(r.mold_id)).filter(mid => mid !== Number(mold_id));
      if (otherMolds.length > 0) {
        if (strictNoSkip) {
          const err = new Error(`No se puede programar en ${dateISO}: ya existe otro molde planificado ese día.`);
          err.code = 'STRICT_BLOCKED_DAY';
          err.blockedDate = dateISO;
          throw err;
        }
        cursor = addDays(cursor, 1);
        continue;
      }
    }

    const { used, moldIds } = await getDayUsage(machine_id, dateISO);
    let capLeft = round025((capPerDay != null ? Number(capPerDay) : 8) - used);
    if (capLeft < 0) capLeft = 0;

    let canUseToday = false;
    if (allowOverlap) {
      canUseToday = capLeft > 0;
    } else if (used === 0 && capLeft > 0) {
      canUseToday = true;
    } else if (moldIds.length === 1 && capLeft > 0) {
      // Continuación del MISMO molde (si ya existe en ese día)
      const existingMoldId = moldIds[0];
      if (existingMoldId === mold_id) {
        canUseToday = true;
      } else if (allowShareLastDay) {
        const canShare = await canShareWithExistingMold({
          currentIsPriority: Boolean(isPriority),
          existingMoldId,
          machine_id,
          dateISO,
          holidaySet,
          overrideMap,
          completionCache,
        });
        if (canShare) canUseToday = true;
      }
    }

    if (!canUseToday) {
      if (strictNoSkip) {
        const err = new Error(`No se puede programar en ${dateISO}: la máquina tiene un molde activo en ese tramo.`);
        err.code = 'STRICT_BLOCKED_DAY';
        err.blockedDate = dateISO;
        throw err;
      }
      cursor = addDays(cursor, 1);
      continue;
    }

    let plannedToday = false;

    while (capLeft > 0 && queue.length > 0) {
      const item = queue[0];
      const alloc = round025(Math.min(capLeft, item.hours));
      if (alloc > 0) {
        await insertEntry({ mold_id, planning_id, part_id: item.part_id, machine_id, dateISO, hours: alloc, createdBy, isPriority });
        item.hours = round025(item.hours - alloc);
        capLeft = round025(capLeft - alloc);
        plannedToday = true;
      }
      if (item.hours <= 0.000001) queue.shift();
    }

    if (plannedToday) lastPlannedDate = dateISO;
    cursor = addDays(cursor, 1);
  }

  return lastPlannedDate ?? baseDateISO;
}

// Validación en seco para plan normal estricto: si se bloquea un día del tramo, no se permite "saltar".
async function findStrictBlockedDayForQueue({ mold_id, machine_id, capPerDay, baseDateISO, tasksQueue, holidaySet, overrideMap, allowShareLastDay = true, isPriority = false, completionCache = null, allowOverlap = false }) {
  let cursor = parseLocalISO(baseDateISO);
  while (!isWorkingDayLocal(cursor, holidaySet, overrideMap)) cursor = addDays(cursor, 1);

  const queue = normalizeTasksQueueByPart(tasksQueue);

  while (queue.length > 0) {
    while (!isWorkingDayLocal(cursor, holidaySet, overrideMap)) cursor = addDays(cursor, 1);
    const dateISO = localISO(cursor);

    const { used, moldIds } = await getDayUsage(machine_id, dateISO);
    let capLeft = round025((capPerDay != null ? Number(capPerDay) : 8) - used);
    if (capLeft < 0) capLeft = 0;

    let canUseToday = false;
    if (allowOverlap) {
      canUseToday = capLeft > 0;
    } else if (used === 0 && capLeft > 0) {
      canUseToday = true;
    } else if (moldIds.length === 1 && capLeft > 0) {
      const existingMoldId = moldIds[0];
      if (existingMoldId === mold_id) {
        canUseToday = true;
      } else if (allowShareLastDay) {
        const canShare = await canShareWithExistingMold({
          currentIsPriority: Boolean(isPriority),
          existingMoldId,
          machine_id,
          dateISO,
          holidaySet,
          overrideMap,
          completionCache,
        });
        if (canShare) canUseToday = true;
      }
    }

    if (!canUseToday) return dateISO;

    while (capLeft > 0 && queue.length > 0) {
      const item = queue[0];
      const alloc = round025(Math.min(capLeft, item.hours));
      if (alloc > 0) {
        item.hours = round025(item.hours - alloc);
        capLeft = round025(capLeft - alloc);
      }
      if (item.hours <= 0.000001) queue.shift();
    }

    cursor = addDays(cursor, 1);
  }

  return null;
}

// Bloques existentes desde baseDate, preservando orden original
async function getExistingBlocksFrom(machine_id, baseDateISO, holidaySet, overrideMap) {
  const rows = await query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date_str, mold_id, part_id, hours_planned, is_priority
     FROM plan_entries
     WHERE machine_id = ? AND date >= ?
     ORDER BY date ASC, id ASC`,
    [machine_id, baseDateISO]
  );

  const blocks = [];
  let current = null;
  let lastDate = null;

  for (const r of rows) {
    const d = parseLocalISO(r.date_str);
    if (!current) {
      current = {
        mold_id: r.mold_id,
        isPriority: Boolean(r.is_priority),
        startDateISO: String(r.date_str || ''),
        items: [{ part_id: r.part_id, hours: Number(r.hours_planned || 0) }]
      };
      lastDate = d;
      continue;
    }
    const nextExpected = nextWorkingDayLocal(lastDate, holidaySet, overrideMap);
    const sameMold = current.mold_id === r.mold_id;
    const contiguous = localISO(d) === localISO(nextExpected) || localISO(d) === localISO(lastDate);
    if (sameMold && contiguous) {
      current.isPriority = current.isPriority || Boolean(r.is_priority);
      current.items.push({ part_id: r.part_id, hours: Number(r.hours_planned || 0) });
      lastDate = d;
    } else {
      blocks.push(current);
      current = {
        mold_id: r.mold_id,
        isPriority: Boolean(r.is_priority),
        startDateISO: String(r.date_str || ''),
        items: [{ part_id: r.part_id, hours: Number(r.hours_planned || 0) }]
      };
      lastDate = d;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

/* =========================================
   Endpoints
   ========================================= */

// Planificación NORMAL en bloque (no mezcla)
exports.planBlock = async (req, res, next) => {
  try {
    const createdBy = getRequestUserId(req);
    if (!createdBy) return res.status(403).json({ error: 'Usuario no válido para crear planificación' });

    const allowOverlap = parseBoolInput(req.body?.allowOverlap);

    const { moldName, startDate, tasks, gridSnapshot } = req.body;
    if (!moldName || !startDate) return res.status(400).json({ error: 'moldName y startDate son requeridos' });
    if (!Array.isArray(tasks) || tasks.length === 0) return res.status(400).json({ error: 'Debe enviar tasks' });

    const rawStart = (startDate || '').trim();
    const startLocal = parseLocalISO(rawStart);
    if (!rawStart || isNaN(startLocal.getTime())) return res.status(400).json({ error: 'startDate inválida (YYYY-MM-DD)' });

    const { holidaySet, overrideMap } = await getWorkingMeta();
    const today = todayLocal();

    if (localISO(startLocal) < localISO(today)) return res.status(400).json({ error: 'No se puede planificar en fechas pasadas' });
    if (!isWorkingDayLocal(startLocal, holidaySet, overrideMap)) return res.status(400).json({ error: 'La fecha seleccionada no es laborable' });

    const normalizedMoldName = toStr(moldName);
    const existingMoldId = await getMoldIdByName(normalizedMoldName);
    console.info('[planBlock] endpoint=/api/tasks/plan/block mold=', normalizedMoldName, 'existingMoldId=', existingMoldId || null);
    if (existingMoldId && await moldHasActivePlan(existingMoldId)) {
      const planningMeta = await getActivePlanningMetaForMold(existingMoldId);
      const wlScope = buildWorkLogScopeSql({
        alias: 'wl',
        mold_id: existingMoldId,
        planningId: planningMeta.planningId,
        startDate: planningMeta.startDate,
      });

      const plannedPairs = await getPlannedPairsForCurrentCycle({
        mold_id: existingMoldId,
        planningMeta,
      });

      const finalLogPairs = await query(
        `SELECT DISTINCT wl.part_id, wl.machine_id
         FROM work_logs wl
         WHERE wl.mold_id = ?
           AND wl.is_final_log = TRUE
           ${wlScope.clause}`,
        [existingMoldId, ...wlScope.params]
      );

      const finalSet = new Set(finalLogPairs.map(r => `${String(r.part_id)}:${String(r.machine_id)}`));
      const cycleIsComplete = plannedPairs.length > 0 && plannedPairs.every(p => finalSet.has(`${String(p.part_id)}:${String(p.machine_id)}`));
      console.info('[planBlock] active-plan-check moldId=', existingMoldId, 'planningId=', planningMeta.planningId || null, 'plannedPairs=', plannedPairs.length, 'finalPairs=', finalLogPairs.length, 'cycleIsComplete=', cycleIsComplete);

      if (!cycleIsComplete) {
        console.warn('[planBlock] blocked-409 moldId=', existingMoldId, 'reason=active-cycle-incomplete');
        return res.status(409).json({
          error: `El molde "${normalizedMoldName}" ya tiene planificación pendiente/activa. Para cambiarla use Editar/Reprogramar, no crear una nueva.`
        });
      }
    }

    const mold_id = existingMoldId || await getOrCreateMoldId(normalizedMoldName);
    const beforeRange = await getMoldPlanRange(mold_id);
    const planning_id = await insertPlanningHistoryEvent({
      mold_id,
      eventType: 'PLANNED',
      fromRange: beforeRange,
      toRange: {
        startDate: localISO(startLocal),
        endDate: null,
      },
      note: `Planificación normal desde ${localISO(startLocal)}`,
      createdBy,
    });

    // Validación estricta del payload (no ignorar filas inválidas)
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const partName = toStr(t?.partName);
      const machineName = mapMachineAlias(toStr(t?.machineName));
      const rawHours = parseFloat(t?.totalHours);
      const hours = round025(rawHours);

      if (!partName) return res.status(400).json({ error: `Tarea inválida en index ${i}: partName requerido` });
      if (!machineName) return res.status(400).json({ error: `Tarea inválida en index ${i}: machineName requerido` });
      if (!Number.isFinite(rawHours)) return res.status(400).json({ error: `Tarea inválida en index ${i}: totalHours inválido` });
      if (hours <= 0) return res.status(400).json({ error: `Tarea inválida en index ${i}: totalHours debe ser > 0` });
    }

    const byMachine = new Map();
    for (const t of tasks) {
      const partName = toStr(t?.partName);
      const machineName = mapMachineAlias(toStr(t?.machineName));
      const hours = round025(parseFloat(t?.totalHours));
      const part_id = await getOrCreatePartId(partName);
      const arr = byMachine.get(machineName) || [];
      arr.push({ part_id, hours });
      byMachine.set(machineName, arr);
    }

    // Regla de planificación normal estricta:
    // si un día del tramo está ocupado por otro molde activo, no se permite "saltar".
    // Para correr lo existente, debe usarse PRIORIDAD.
    for (const [machineName, items] of byMachine.entries()) {
      const { id: machine_id, daily_capacity } = await getOrCreateMachineByName(machineName);
      const cap = daily_capacity != null ? Number(daily_capacity) : 8;
      const blockedDate = await findStrictBlockedDayForQueue({
        mold_id,
        machine_id,
        capPerDay: cap,
        baseDateISO: localISO(startLocal),
        tasksQueue: items,
        holidaySet,
        overrideMap,
        allowShareLastDay: true,
        isPriority: false,
        completionCache: new Map(),
        allowOverlap,
      });

      if (blockedDate) {
        const occupied = await query(
          `SELECT mold_id FROM plan_entries WHERE machine_id = ? AND date = ? ORDER BY id ASC LIMIT 1`,
          [machine_id, blockedDate]
        );
        const existingMoldId = occupied?.[0]?.mold_id || null;
        const existingMoldName = existingMoldId ? await getMoldNameById(existingMoldId) : null;
        return res.status(400).json({
          error: `No se puede planificar en ${blockedDate}: la máquina "${machineName}" ya tiene un molde planificado${existingMoldName ? ` ("${existingMoldName}")` : ''}. Use PRIORIDAD si desea correr la planificación existente.`
        });
      }
    }

    // Restricción: en planificación normal, el startDate debe estar libre por máquina.
    // Excepción: se permite compartir SOLO si ese día es el ÚLTIMO del bloque existente
    // y queda capacidad (la misma regla del planificador).
    const completionCache = new Map();
    for (const [machineName] of byMachine.entries()) {
      const { id: machine_id, daily_capacity } = await getOrCreateMachineByName(machineName);
      const cap = daily_capacity != null ? Number(daily_capacity) : 8;

      const dateISO = localISO(startLocal);
      const { used, moldIds } = await getDayUsage(machine_id, dateISO);
      const capLeft = round025(cap - used);

      if (used === 0) continue;
      if (allowOverlap) continue;

      let allowed = false;
      if (moldIds.length === 1 && capLeft > 0) {
        allowed = await canShareWithExistingMold({
          currentIsPriority: false,
          existingMoldId: moldIds[0],
          machine_id,
          dateISO,
          holidaySet,
          overrideMap,
          completionCache,
        });
      }

      if (!allowed) {
        const existingMoldId = moldIds.length ? moldIds[0] : null;
        const existingMoldName = existingMoldId ? await getMoldNameById(existingMoldId) : null;
        return res.status(400).json({
          error: `No se puede planificar en ${dateISO}: la máquina "${machineName}" ya tiene un molde planificado${existingMoldName ? ` ("${existingMoldName}")` : ''}. Use PRIORIDAD si desea correr la planificación existente.`
        });
      }
    }

    const results = [];
    for (const [machineName, items] of byMachine.entries()) {
      const { id: machine_id, daily_capacity } = await getOrCreateMachineByName(machineName);
      const cap = daily_capacity != null ? Number(daily_capacity) : 8;

      const lastDay = await placeBlockNoPreempt({
        mold_id,
        planning_id,
        machine_id,
        capPerDay: cap,
        baseDateISO: localISO(startLocal),
        tasksQueue: items,
        createdBy,
        holidaySet,
        overrideMap,
        allowShareLastDay: true,
        isPriority: false,
        completionCache,
        allowOverlap
      });

      results.push({ machineName, machine_id, startDate: localISO(startLocal), endDate: lastDay, capacityPerDay: cap });
    }

    // Snapshot opcional (rehidratar parrilla exactamente como se digitó)
    try {
      if (gridSnapshot) {
        await upsertPlannerGridSnapshot({ mold_id, startDateISO: localISO(startLocal), snapshot: gridSnapshot, userId: createdBy });
      }
    } catch (e) {
      console.warn('[planner snapshot] no se pudo guardar (planBlock):', e?.message || e);
    }

    const cycleStartDate = results.length
      ? results.map(r => String(r.startDate || '')).filter(Boolean).sort((a, b) => a.localeCompare(b))[0]
      : localISO(startLocal);
    const cycleEndDate = results.length
      ? results.map(r => String(r.endDate || '')).filter(Boolean).sort((a, b) => a.localeCompare(b)).slice(-1)[0]
      : localISO(startLocal);

    if (planning_id) {
      await query(
        `UPDATE planning_history
         SET to_start_date = COALESCE(to_start_date, ?),
             to_end_date = ?
         WHERE id = ?`,
        [cycleStartDate || null, cycleEndDate || null, planning_id]
      );
    }

    res.status(201).json({ message: 'Plan en bloque creado (no mezcla)', results });
  } catch (e) { next(e); }
};

// Listado de moldes con planificación activa/incompleta
exports.listPlannedMolds = async (req, res, next) => {
  try {
    const from = (req.query?.from ? String(req.query.from) : '').trim();
    const to = (req.query?.to ? String(req.query.to) : '').trim();

    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    const fromISO = from && isoRe.test(from) ? from : null;
    const toISO = to && isoRe.test(to) ? to : null;

    const sql = `
      WITH active_planning AS (
        SELECT DISTINCT ON (ph.mold_id)
          ph.mold_id,
          ph.id AS planning_id,
          ph.to_start_date AS start_date
        FROM planning_history ph
        WHERE ph.event_type = 'PLANNED'
        ORDER BY ph.mold_id, ph.to_start_date DESC NULLS LAST, ph.created_at DESC, ph.id DESC
      ),
      plan_all AS (
        SELECT
          pe.mold_id,
          to_char(MIN(pe.date), 'YYYY-MM-DD') AS "startDate",
          to_char(MAX(pe.date), 'YYYY-MM-DD') AS "endDate",
          SUM(pe.hours_planned) AS "plannedTotal"
        FROM plan_entries pe
        JOIN active_planning ap ON ap.mold_id = pe.mold_id
        WHERE (
          pe.planning_id = ap.planning_id
          OR (ap.start_date IS NOT NULL AND pe.date >= ap.start_date)
          OR (ap.start_date IS NULL AND pe.planning_id IS NULL)
        )
        GROUP BY pe.mold_id
      ),
      plan_pairs AS (
        SELECT
          pe.mold_id,
          pe.part_id,
          pe.machine_id,
          SUM(pe.hours_planned) AS planned_hours
        FROM plan_entries pe
        JOIN active_planning ap ON ap.mold_id = pe.mold_id
        WHERE (
          pe.planning_id = ap.planning_id
          OR (ap.start_date IS NOT NULL AND pe.date >= ap.start_date)
          OR (ap.start_date IS NULL AND pe.planning_id IS NULL)
        )
        GROUP BY pe.mold_id, pe.part_id, pe.machine_id
      ),
      final_pairs AS (
        SELECT
          pp.mold_id,
          pp.part_id,
          pp.machine_id
        FROM plan_pairs pp
        JOIN active_planning ap ON ap.mold_id = pp.mold_id
        JOIN work_logs wl
          ON wl.mold_id = pp.mold_id
         AND wl.part_id = pp.part_id
         AND wl.machine_id = pp.machine_id
         AND wl.is_final_log = TRUE
         AND (
           wl.planning_id = ap.planning_id
           OR (
             wl.planning_id IS NULL
             AND (
               ap.planning_id IS NULL
               OR (
                 ap.start_date IS NOT NULL
                 AND COALESCE(wl.work_date, wl.recorded_at::date) >= ap.start_date
               )
             )
           )
         )
        GROUP BY pp.mold_id, pp.part_id, pp.machine_id
      ),
      completion AS (
        SELECT
          pp.mold_id,
          SUM(CASE WHEN pp.planned_hours > 0 THEN 1 ELSE 0 END) AS planned_pairs,
          SUM(CASE WHEN pp.planned_hours > 0 AND fp.part_id IS NOT NULL THEN 1 ELSE 0 END) AS closed_pairs
        FROM plan_pairs pp
        LEFT JOIN final_pairs fp
          ON fp.mold_id = pp.mold_id
         AND fp.part_id = pp.part_id
         AND fp.machine_id = pp.machine_id
        GROUP BY pp.mold_id
      ),
      visible AS (
        SELECT DISTINCT pe.mold_id
        FROM plan_entries pe
        JOIN active_planning ap ON ap.mold_id = pe.mold_id
        WHERE (
          pe.planning_id = ap.planning_id
          OR (ap.start_date IS NOT NULL AND pe.date >= ap.start_date)
          OR (ap.start_date IS NULL AND pe.planning_id IS NULL)
        )
        ${fromISO ? 'AND pe.date >= ?' : ''}
        ${toISO ? 'AND pe.date <= ?' : ''}
        UNION
        SELECT DISTINCT ap.mold_id
        FROM active_planning ap
        JOIN plan_entries pe ON pe.mold_id = ap.mold_id
        WHERE (
          pe.planning_id = ap.planning_id
          OR (ap.start_date IS NOT NULL AND pe.date >= ap.start_date)
          OR (ap.start_date IS NULL AND pe.planning_id IS NULL)
        )
        AND EXISTS (
          SELECT 1 FROM work_logs wl
          WHERE wl.mold_id = ap.mold_id
            AND (
              wl.planning_id = ap.planning_id
              OR (
                wl.planning_id IS NULL
                AND (
                  ap.planning_id IS NULL
                  OR (
                    ap.start_date IS NOT NULL
                    AND COALESCE(wl.work_date, wl.recorded_at::date) >= ap.start_date
                  )
                )
              )
            )
        )
      )
      SELECT
        mo.id AS "moldId",
        mo.name AS "moldName",
        p."startDate" AS "startDate",
        p."endDate" AS "endDate",
        p."plannedTotal" AS "totalHours"
      FROM visible v
      JOIN plan_all p ON p.mold_id = v.mold_id
      JOIN molds mo ON mo.id = v.mold_id
      LEFT JOIN completion c ON c.mold_id = v.mold_id
      WHERE p."plannedTotal" > 0
        AND COALESCE(c.closed_pairs, 0) < COALESCE(c.planned_pairs, 0)
      ORDER BY p."startDate" ASC, mo.name ASC
    `;

    const params = [];
    if (fromISO) params.push(fromISO);
    if (toISO) params.push(toISO);
    const rows = await query(sql, params);
    res.json({ from: fromISO, to: toISO, molds: (rows || []).map(r => ({
      moldId: Number(r.moldId),
      moldName: r.moldName,
      startDate: r.startDate,
      endDate: r.endDate,
      totalHours: Number(r.totalHours || 0)
    })) });
  } catch (e) {
    next(e);
  }
};

// Obtener snapshot de parrilla (por molde y opcionalmente startDate)
exports.getPlannerSnapshot = async (req, res, next) => {
  try {
    const moldId = Number.parseInt(String(req.query?.moldId || ''), 10);
    const startDate = (req.query?.startDate ? String(req.query.startDate) : '').trim();

    if (!Number.isFinite(moldId) || moldId <= 0) return res.status(400).json({ error: 'moldId inválido' });
    if (startDate && !isValidISODateString(startDate)) return res.status(400).json({ error: 'startDate inválida (YYYY-MM-DD)' });

    const snap = await getPlannerGridSnapshot({ mold_id: moldId, startDateISO: startDate || null });
    if (!snap) return res.status(404).json({ error: 'Snapshot no encontrado' });
    res.json({ moldId, startDate: snap.startDate, snapshot: snap.snapshot });
  } catch (e) {
    next(e);
  }
};

// Reemplaza la planificación FUTURA de un molde desde startDate
exports.replaceMoldPlan = async (req, res, next) => {
  try {
    const createdBy = getRequestUserId(req);
    if (!createdBy) return res.status(403).json({ error: 'Usuario no válido para crear planificación' });

    const { moldId, moldName, startDate, tasks, gridSnapshot, replaceScope } = req.body;
    const allowBusyStart = req.body?.allowBusyStart === true;
    const allowOverlap = parseBoolInput(req.body?.allowOverlap);
    if ((!moldId && !moldName) || !startDate) return res.status(400).json({ error: 'moldId o moldName y startDate son requeridos' });
    if (!Array.isArray(tasks) || tasks.length === 0) return res.status(400).json({ error: 'Debe enviar tasks' });

    const rawStart = (startDate || '').trim();
    const startLocal = parseLocalISO(rawStart);
    if (!rawStart || isNaN(startLocal.getTime())) return res.status(400).json({ error: 'startDate inválida (YYYY-MM-DD)' });

    const { holidaySet, overrideMap } = await getWorkingMeta();
    const today = todayLocal();

    if (localISO(startLocal) < localISO(today)) return res.status(400).json({ error: 'No se puede planificar en fechas pasadas' });
    if (!isWorkingDayLocal(startLocal, holidaySet, overrideMap)) return res.status(400).json({ error: 'La fecha seleccionada no es laborable' });

    const hasMoldId = moldId != null && String(moldId).trim() !== '';
    let mold_id;
    if (hasMoldId) {
      const parsed = Number.parseInt(String(moldId), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return res.status(400).json({ error: 'moldId inválido' });
      const rows = await query('SELECT id FROM molds WHERE id = ? LIMIT 1', [parsed]);
      if (!rows.length) return res.status(404).json({ error: 'Molde no encontrado (moldId)' });
      mold_id = parsed;
    } else {
      const normalizedName = String(moldName || '').trim();
      if (!normalizedName) return res.status(400).json({ error: 'moldName requerido' });
      mold_id = await getOrCreateMoldId(normalizedName);
    }
    const beforeRange = await getMoldPlanRange(mold_id);
    const activePlanningMetaForReplace = await getActivePlanningMetaForMold(mold_id, localISO(startLocal));
    let activePlanningIdForReplace = activePlanningMetaForReplace.planningId || null;

    // En edición por ID, preservamos tareas ya completadas (por parte+máquina)
    // para no perder datos ni permitir reprogramar trabajo ya registrado.
    let completedPartMachineKeys = null; // Set('partId:machineId')
    let plannedPairsForMold = null; // [{part_id, machine_id, planned_hours}]
    if (hasMoldId) {
      const planningMeta = await getActivePlanningMetaForMold(mold_id);
      activePlanningIdForReplace = planningMeta.planningId || activePlanningIdForReplace;
      const wlScope = buildWorkLogScopeSql({
        alias: 'work_logs',
        mold_id,
        planningId: planningMeta.planningId,
        startDate: planningMeta.startDate,
      });
      const planScope = buildPlanEntriesCycleScopeSql({
        alias: 'p',
        mold_id,
        planningId: activePlanningIdForReplace,
        startDate: planningMeta.startDate,
      });

      plannedPairsForMold = await query(
        `SELECT p.part_id, p.machine_id, SUM(p.hours_planned) AS planned_hours
         FROM plan_entries p
         WHERE p.mold_id = ?
           ${planScope.clause}
         GROUP BY p.part_id, p.machine_id
         HAVING SUM(p.hours_planned) > 0`,
        [mold_id, ...planScope.params]
      );

      // Parte COMPLETADA = tiene al menos un registro con is_final_log = true
      const finalLogRows = await query(
        `SELECT DISTINCT part_id, machine_id
         FROM work_logs
         WHERE mold_id = ? AND is_final_log = TRUE
           ${wlScope.clause}`,
        [mold_id, ...wlScope.params]
      );
      completedPartMachineKeys = new Set(
        (finalLogRows || []).map(r => `${String(r.part_id)}:${String(r.machine_id)}`)
      );
    }

    // Validación estricta del payload
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const partName = toStr(t?.partName);
      const machineName = mapMachineAlias(toStr(t?.machineName));
      const rawHours = parseFloat(t?.totalHours);
      const hours = round025(rawHours);

      if (!partName) return res.status(400).json({ error: `Tarea inválida en index ${i}: partName requerido` });
      if (!machineName) return res.status(400).json({ error: `Tarea inválida en index ${i}: machineName requerido` });
      if (!Number.isFinite(rawHours)) return res.status(400).json({ error: `Tarea inválida en index ${i}: totalHours inválido` });
      if (hours <= 0) return res.status(400).json({ error: `Tarea inválida en index ${i}: totalHours debe ser > 0` });
    }

    // Borrar SOLO lo NO completado cuando editamos por ID.
    // Nota: si no es edición por ID, conservamos el comportamiento anterior.
    const baseISO = localISO(startLocal);
    const scope = String(replaceScope || '').trim().toLowerCase();

    if (hasMoldId && completedPartMachineKeys) {
      const deletable = (plannedPairsForMold || []).filter(r => {
        const key = `${String(r.part_id)}:${String(r.machine_id)}`;
        return !completedPartMachineKeys.has(key);
      });

      for (const r of deletable) {
        await query(
          `DELETE FROM plan_entries
           WHERE mold_id = ?
             AND part_id = ?
             AND machine_id = ?
             AND (?::bigint IS NULL OR planning_id = ?::bigint)`,
          [mold_id, r.part_id, r.machine_id, activePlanningIdForReplace, activePlanningIdForReplace]
        );
      }
    } else {
      // Regla industrial anterior (por compatibilidad)
      const explicitFutureOnly = scope === 'future' || scope === 'fromstartdate' || scope === 'from_start_date' || scope === 'from';
      const deleteAll = (scope === 'all') || (!explicitFutureOnly);

      if (deleteAll) {
        if (activePlanningIdForReplace) {
          await query('DELETE FROM plan_entries WHERE mold_id = ? AND planning_id = ?', [mold_id, activePlanningIdForReplace]);
        } else {
          await query('DELETE FROM plan_entries WHERE mold_id = ?', [mold_id]);
        }
      } else {
        if (activePlanningIdForReplace) {
          await query('DELETE FROM plan_entries WHERE mold_id = ? AND planning_id = ? AND date >= ?', [mold_id, activePlanningIdForReplace, baseISO]);
        } else {
          await query('DELETE FROM plan_entries WHERE mold_id = ? AND date >= ?', [mold_id, baseISO]);
        }
      }
    }

    // Re-armar tareas por máquina (ignorando tareas ya completadas)
    const byMachine = new Map();
    let skippedCompleted = 0;
    for (const t of tasks) {
      const partName = toStr(t?.partName);
      const machineName = mapMachineAlias(toStr(t?.machineName));
      const hours = round025(parseFloat(t?.totalHours));
      const part_id = await getOrCreatePartId(partName);

      if (completedPartMachineKeys) {
        const { id: mid } = await getOrCreateMachineByName(machineName);
        const key = `${String(part_id)}:${String(mid)}`;
        if (completedPartMachineKeys.has(key)) {
          skippedCompleted++;
          continue;
        }
      }

      const arr = byMachine.get(machineName) || [];
      arr.push({ part_id, hours });
      byMachine.set(machineName, arr);
    }

    // Misma restricción del plan normal: startDate debe estar libre por máquina (con excepción último día)
    // Para "consecutivo" permitimos un startDate ocupado: el algoritmo buscará el primer día con cupo.
    if (!allowBusyStart && !allowOverlap) {
      const completionCache = new Map();
      for (const [machineName] of byMachine.entries()) {
        const { id: machine_id, daily_capacity } = await getOrCreateMachineByName(machineName);
        const cap = daily_capacity != null ? Number(daily_capacity) : 8;

        const { used, moldIds } = await getDayUsage(machine_id, baseISO);
        const capLeft = round025(cap - used);

        if (used === 0) continue;

        let allowed = false;
        if (moldIds.length === 1 && capLeft > 0) {
          allowed = await canShareWithExistingMold({
            currentIsPriority: false,
            existingMoldId: moldIds[0],
            machine_id,
            dateISO: baseISO,
            holidaySet,
            overrideMap,
            completionCache,
          });
        }

        if (!allowed) {
          const existingMoldId = moldIds.length ? moldIds[0] : null;
          const existingMoldName = existingMoldId ? await getMoldNameById(existingMoldId) : null;
          return res.status(400).json({
            error: `No se puede planificar en ${baseISO}: la máquina "${machineName}" ya tiene un molde planificado${existingMoldName ? ` ("${existingMoldName}")` : ''}. Use PRIORIDAD si desea correr la planificación existente.`
          });
        }
      }
    }

    const results = [];
    const completionCache = new Map();
    const activePlanningMeta = await getActivePlanningMetaForMold(mold_id, baseISO);
    let activePlanningId = activePlanningMeta.planningId || activePlanningIdForReplace || null;
    if (!activePlanningId) {
      activePlanningId = await insertPlanningHistoryEvent({
        mold_id,
        eventType: 'PLANNED',
        fromRange: beforeRange,
        toRange: { startDate: baseISO, endDate: null },
        note: `Planificación normal desde ${baseISO}`,
        createdBy,
      });
    }
    for (const [machineName, items] of byMachine.entries()) {
      const { id: machine_id, daily_capacity } = await getOrCreateMachineByName(machineName);
      const cap = daily_capacity != null ? Number(daily_capacity) : 8;

      const lastDay = await placeBlockNoPreempt({
        mold_id,
        planning_id: activePlanningId,
        machine_id,
        capPerDay: cap,
        baseDateISO: baseISO,
        tasksQueue: items,
        createdBy,
        holidaySet,
        overrideMap,
        allowShareLastDay: true,
        isPriority: false,
        completionCache,
        allowOverlap
      });

      results.push({ machineName, machine_id, startDate: baseISO, endDate: lastDay, capacityPerDay: cap });
    }

    // Snapshot actualizado (si viene)
    try {
      if (gridSnapshot) {
        await upsertPlannerGridSnapshot({ mold_id, startDateISO: baseISO, snapshot: gridSnapshot, userId: createdBy });
      }
    } catch (e) {
      console.warn('[planner snapshot] no se pudo guardar (replaceMoldPlan):', e?.message || e);
    }

    let responseStartISO = baseISO;
    if (allowBusyStart) {
      const range = await query(
        `SELECT to_char(MIN(date), 'YYYY-MM-DD') AS start_date FROM plan_entries WHERE mold_id = ?`,
        [mold_id]
      );
      responseStartISO = range?.[0]?.start_date || baseISO;
    }

    await logMoldRangeChange({
      mold_id,
      eventType: 'REPROGRAMMED',
      createdBy,
      note: allowBusyStart
        ? `Reprogramación consecutiva desde ${responseStartISO}`
        : `Reprogramación de plan desde ${baseISO}`,
      beforeRange,
    });

    res.status(200).json({
      message: 'Plan del molde actualizado (preservando tareas completadas)',
      startDate: responseStartISO,
      skippedCompletedTasks: skippedCompleted,
      results
    });
  } catch (e) {
    if (e?.code === 'STRICT_BLOCKED_DAY') {
      return res.status(400).json({
        error: `No se puede mover en fecha fija: existe planificación activa en ${e?.blockedDate || 'la fecha solicitada'} para la máquina. Solo se permite atravesar moldes ya terminados.`
      });
    }
    next(e);
  }
};

// Reprograma un molde para que quede "pegado" detrás del molde anterior
// (anterior según orden de creación de la planificación: MIN(plan_entries.created_at) por molde).
// Reglas:
// - Solo aplica en moldId existente.
// - Solo permite si el molde anterior está COMPLETO (según work_logs vs plan_entries).
// - Si el molde anterior está completo, elimina su planificación futura (date > fecha_fin_real)
//   y calcula startDate = max(fecha_fin_real, hoy) ajustado a día laborable.
// - Luego reutiliza replaceMoldPlan para replanificar el molde actual.
exports.planConsecutive = async (req, res, next) => {
  try {
    const createdBy = getRequestUserId(req);
    if (!createdBy) return res.status(403).json({ error: 'Usuario no válido para crear planificación' });

    const moldId = Number.parseInt(String(req.body?.moldId || ''), 10);
    if (!Number.isFinite(moldId) || moldId <= 0) return res.status(400).json({ error: 'moldId inválido' });

    const tasks = req.body?.tasks;
    if (!Array.isArray(tasks) || tasks.length === 0) return res.status(400).json({ error: 'Debe enviar tasks' });

    // Confirmar molde existe
    const curMold = await query('SELECT id, name FROM molds WHERE id = ? LIMIT 1', [moldId]);
    if (!curMold.length) return res.status(404).json({ error: 'Molde no encontrado (moldId)' });

    // Orden de creación de plan (por molde): MIN(created_at) en plan_entries
    const orderRows = await query(
      `SELECT mold_id, MIN(created_at) AS created_at
       FROM plan_entries
       GROUP BY mold_id
       ORDER BY MIN(created_at) ASC, mold_id ASC`
    );
    const idx = (orderRows || []).findIndex(r => Number(r.mold_id) === moldId);
    if (idx < 0) return res.status(404).json({ error: 'Este molde no tiene planificación registrada' });
    if (idx === 0) return res.status(409).json({ error: 'No hay molde anterior para seguir consecutivamente' });

    const prevMoldId = Number(orderRows[idx - 1].mold_id);
    const prevMold = await query('SELECT id, name FROM molds WHERE id = ? LIMIT 1', [prevMoldId]);
    const prevMoldName = prevMold.length ? prevMold[0].name : null;

    // Validar completitud del molde anterior (por parte+máquina)
    const plannedPairs = await query(
      `SELECT part_id, machine_id, SUM(hours_planned) AS planned_hours
       FROM plan_entries
       WHERE mold_id = ?
       GROUP BY part_id, machine_id`,
      [prevMoldId]
    );

    if (!plannedPairs.length) {
      return res.status(409).json({ error: 'El molde anterior no tiene horas planificadas' });
    }

    const planningMetaPrev = await getActivePlanningMetaForMold(prevMoldId);
    const wlScopePrev = buildWorkLogScopeSql({
      alias: 'wl',
      mold_id: prevMoldId,
      planningId: planningMetaPrev.planningId,
      startDate: planningMetaPrev.startDate,
    });

    const actualPairs = await query(
      `SELECT wl.part_id, wl.machine_id, SUM(wl.hours_worked) AS actual_hours
       FROM work_logs wl
       JOIN (
         SELECT DISTINCT part_id, machine_id
         FROM plan_entries
         WHERE mold_id = ?
       ) pp ON pp.part_id = wl.part_id AND pp.machine_id = wl.machine_id
       WHERE wl.mold_id = ?
         ${wlScopePrev.clause}
       GROUP BY wl.part_id, wl.machine_id`,
      [prevMoldId, prevMoldId, ...wlScopePrev.params]
    );

    const actualMap = new Map();
    for (const r of actualPairs || []) {
      actualMap.set(`${String(r.part_id)}:${String(r.machine_id)}`, Number(r.actual_hours || 0));
    }

    // El molde anterior se considera completo si TODAS sus partes tienen is_final_log = true
    const finalLogPrevPairs = await query(
      `SELECT DISTINCT part_id, machine_id
       FROM work_logs wl
       WHERE wl.mold_id = ? AND wl.is_final_log = TRUE
         ${wlScopePrev.clause}`,
      [prevMoldId, ...wlScopePrev.params]
    );
    const finalPrevSet = new Set(finalLogPrevPairs.map(r => `${String(r.part_id)}:${String(r.machine_id)}`));

    for (const r of plannedPairs || []) {
      const plannedHours = Number(r.planned_hours || 0);
      if (!(plannedHours > 0)) continue;
      const key = `${String(r.part_id)}:${String(r.machine_id)}`;
      if (!finalPrevSet.has(key)) {
        return res.status(409).json({
          error: `El molde anterior${prevMoldName ? ` ("${prevMoldName}")` : ''} aún no está completo (sin cierre manual); no se puede seguir consecutivamente.`
        });
      }
    }

    // Fecha real de finalización: último work_date/recorded_at sobre pares del plan vigente
    const finishRow = await query(
      `SELECT to_char(MAX(COALESCE(work_date, recorded_at::date)), 'YYYY-MM-DD') AS finish_date
       FROM work_logs wl
       JOIN (
         SELECT DISTINCT part_id, machine_id
         FROM plan_entries
         WHERE mold_id = ?
       ) pp ON pp.part_id = wl.part_id AND pp.machine_id = wl.machine_id
       WHERE wl.mold_id = ?
         ${wlScopePrev.clause}`,
      [prevMoldId, prevMoldId, ...wlScopePrev.params]
    );
    const finishDateISO = finishRow?.[0]?.finish_date || null;
    if (!finishDateISO) {
      return res.status(409).json({
        error: 'No hay registros de trabajo del molde anterior para determinar fecha de finalización.'
      });
    }

    // IMPORTANTE: NO borramos plan_entries del molde anterior.
    // Aunque el molde esté completo antes de lo planeado, el calendario (y el historial del plan)
    // no debe perderse al hacer "consecutivo".

    // Fin planificado del molde anterior (último día en plan_entries)
    const prevPlanEndRow = await query(
      `SELECT to_char(MAX(date), 'YYYY-MM-DD') AS plan_end
       FROM plan_entries
       WHERE mold_id = ?`,
      [prevMoldId]
    );
    const prevPlanEndISO = prevPlanEndRow?.[0]?.plan_end || null;
    if (!prevPlanEndISO) {
      return res.status(409).json({ error: 'El molde anterior no tiene fechas planificadas para determinar el fin del plan.' });
    }

    // Base para el consecutivo: el mayor entre fin planificado y fin real.
    // (Nunca arrancar antes de lo que el calendario ya tenía reservado.)
    let anchorISO = prevPlanEndISO;
    if (finishDateISO && finishDateISO > anchorISO) anchorISO = finishDateISO;

    // Calcular startDate candidato: el MISMO día anchor si es laborable (y nunca en el pasado).
    // La disponibilidad real por máquina/día la resuelve placeBlockNoPreempt: si no hay cupo,
    // automáticamente avanzará al siguiente día laborable.
    const { holidaySet, overrideMap } = await getWorkingMeta();
    const todayISO = localISO(todayLocal());
    if (anchorISO < todayISO) anchorISO = todayISO;
    const startLocal = await firstWorkingOnOrAfter(anchorISO, holidaySet, overrideMap);
    const startDateISO = localISO(startLocal);

    // Reutilizar replaceMoldPlan (misma validación y preservación de tareas completadas)
    req.body = {
      ...req.body,
      moldId,
      startDate: startDateISO,
      allowBusyStart: true
    };

    return exports.replaceMoldPlan(req, res, next);
  } catch (e) {
    next(e);
  }
};

// Planificación con PRIORIDAD (GLOBAL, bloques sin mezcla)
// Mueve TODO lo que había desde baseDate en TODAS las máquinas, coloca primero el bloque prioritario
exports.planPriority = async (req, res, next) => {
  try {
    const createdBy = getRequestUserId(req);
    if (!createdBy) return res.status(403).json({ error: 'Usuario no válido para crear planificación' });

    const { moldId, moldName, startDate, tasks, gridSnapshot, replaceScope } = req.body;
    if (!moldId && !moldName) return res.status(400).json({ error: 'moldId o moldName es requerido' });
    if (!Array.isArray(tasks) || tasks.length === 0) return res.status(400).json({ error: 'Debe enviar tasks' });

    const { holidaySet, overrideMap } = await getWorkingMeta();

    // Base date (no pasada y laborable)
    let base;
    if (startDate) {
      const rawStart = (startDate || '').trim();
      const dLocal = parseLocalISO(rawStart);
      if (!rawStart || isNaN(dLocal.getTime())) return res.status(400).json({ error: 'startDate inválida (YYYY-MM-DD)' });
      const today = todayLocal();
      if (localISO(dLocal) < localISO(today)) return res.status(400).json({ error: 'No se puede planificar en fechas pasadas' });
      if (!isWorkingDayLocal(dLocal, holidaySet, overrideMap)) return res.status(400).json({ error: 'La fecha seleccionada no es laborable' });
      base = dLocal;
    } else {
      base = await firstWorkingOnOrAfter(localISO(todayLocal()), holidaySet, overrideMap);
    }
    const baseISO = localISO(base);

    const hasMoldId = moldId != null && String(moldId).trim() !== '';
    console.info('[planPriority] endpoint=/api/tasks/plan/priority hasMoldId=', hasMoldId, 'moldId=', hasMoldId ? String(moldId) : null, 'moldName=', moldName || null);
    let mold_id;
    let targetPlanningId = null;
    if (hasMoldId) {
      const parsed = Number.parseInt(String(moldId), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return res.status(400).json({ error: 'moldId inválido' });
      const rows = await query('SELECT id FROM molds WHERE id = ? LIMIT 1', [parsed]);
      if (!rows.length) return res.status(404).json({ error: 'Molde no encontrado (moldId)' });
      mold_id = parsed;
      const planningMeta = await getActivePlanningMetaForMold(mold_id, baseISO);
      targetPlanningId = planningMeta.planningId || null;
      if (!targetPlanningId) {
        const beforeRangeForPlanned = await getMoldPlanRange(mold_id);
        targetPlanningId = await insertPlanningHistoryEvent({
          mold_id,
          eventType: 'PLANNED',
          fromRange: beforeRangeForPlanned,
          toRange: {
            startDate: baseISO,
            endDate: null,
          },
          note: `Planificación prioridad desde ${baseISO}`,
          createdBy,
        });
      }
    } else {
      const normalizedName = String(moldName || '').trim();
      if (!normalizedName) return res.status(400).json({ error: 'moldName es requerido' });
      const existingMoldId = await getMoldIdByName(normalizedName);
      if (existingMoldId && await moldHasActivePlan(existingMoldId)) {
        const planningMeta = await getActivePlanningMetaForMold(existingMoldId);
        const wlScope = buildWorkLogScopeSql({
          alias: 'wl',
          mold_id: existingMoldId,
          planningId: planningMeta.planningId,
          startDate: planningMeta.startDate,
        });

        const plannedPairs = await getPlannedPairsForCurrentCycle({
          mold_id: existingMoldId,
          planningMeta,
        });

        const finalLogPairs = await query(
          `SELECT DISTINCT wl.part_id, wl.machine_id
           FROM work_logs wl
           WHERE wl.mold_id = ?
             AND wl.is_final_log = TRUE
             ${wlScope.clause}`,
          [existingMoldId, ...wlScope.params]
        );

        const finalSet = new Set(finalLogPairs.map(r => `${String(r.part_id)}:${String(r.machine_id)}`));
        const cycleIsComplete = plannedPairs.length > 0 && plannedPairs.every(p => finalSet.has(`${String(p.part_id)}:${String(p.machine_id)}`));
        console.info('[planPriority] active-plan-check moldId=', existingMoldId, 'planningId=', planningMeta.planningId || null, 'plannedPairs=', plannedPairs.length, 'finalPairs=', finalLogPairs.length, 'cycleIsComplete=', cycleIsComplete);

        if (!cycleIsComplete) {
          console.warn('[planPriority] blocked-409 moldId=', existingMoldId, 'reason=active-cycle-incomplete');
          return res.status(409).json({
            error: `El molde "${normalizedName}" ya tiene planificación pendiente/activa. Para cambiarla use Editar/Reprogramar, no crear una nueva.`
          });
        }
      }
      mold_id = existingMoldId || await getOrCreateMoldId(normalizedName);
      const beforeRangeForPlanned = await getMoldPlanRange(mold_id);
      targetPlanningId = await insertPlanningHistoryEvent({
        mold_id,
        eventType: 'PLANNED',
        fromRange: beforeRangeForPlanned,
        toRange: {
          startDate: baseISO,
          endDate: null,
        },
        note: `Planificación prioridad desde ${baseISO}`,
        createdBy,
      });
    }

    const affectedMoldsBefore = new Map();
    const rememberBeforeRange = async (id) => {
      const key = Number(id);
      if (!Number.isFinite(key) || key <= 0) return;
      if (affectedMoldsBefore.has(key)) return;
      affectedMoldsBefore.set(key, await getMoldPlanRange(key));
    };

    await rememberBeforeRange(mold_id);

    // Si venimos de edición y queremos reemplazo total, borrar TODO lo del molde antes de reprogramar.
    // Esto evita que queden entradas "viejas" si el usuario mueve la fecha de inicio hacia adelante.
    const scope = String(replaceScope || '').trim().toLowerCase();
    if (scope === 'all' || hasMoldId) {
      if (targetPlanningId) {
        await query('DELETE FROM plan_entries WHERE mold_id = ? AND planning_id = ?', [mold_id, targetPlanningId]);
      } else {
        await query('DELETE FROM plan_entries WHERE mold_id = ?', [mold_id]);
      }
    }

    // Snapshot opcional (en prioridad, el startDate efectivo es baseISO)
    try {
      if (gridSnapshot) {
        await upsertPlannerGridSnapshot({ mold_id, startDateISO: baseISO, snapshot: gridSnapshot, userId: createdBy });
      }
    } catch (e) {
      console.warn('[planner snapshot] no se pudo guardar (planPriority):', e?.message || e);
    }

    // Validación estricta del payload (no ignorar filas inválidas)
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const partName = toStr(t?.partName);
      const machineName = mapMachineAlias(toStr(t?.machineName));
      const rawHours = parseFloat(t?.totalHours);
      const hours = round025(rawHours);

      if (!partName) return res.status(400).json({ error: `Tarea inválida en index ${i}: partName requerido` });
      if (!machineName) return res.status(400).json({ error: `Tarea inválida en index ${i}: machineName requerido` });
      if (!Number.isFinite(rawHours)) return res.status(400).json({ error: `Tarea inválida en index ${i}: totalHours inválido` });
      if (hours <= 0) return res.status(400).json({ error: `Tarea inválida en index ${i}: totalHours debe ser > 0` });
    }

    // Agrupar tareas prioritarias por máquina con nombre canónico
    const priorityByMachineName = new Map();
    for (const t of tasks) {
      const partName = toStr(t?.partName);
      const machineName = mapMachineAlias(toStr(t?.machineName));
      const hours = round025(parseFloat(t?.totalHours));
      const part_id = await getOrCreatePartId(partName);
      const arr = priorityByMachineName.get(machineName) || [];
      arr.push({ part_id, hours });
      priorityByMachineName.set(machineName, arr);
    }
    if (priorityByMachineName.size === 0) return res.status(400).json({ error: 'No hay tareas válidas' });

    console.log('[planPriority] baseDate=', baseISO);

    // Mapea nombres canónicos a { id, cap }
    const machineMap = new Map();
    for (const [machineName] of priorityByMachineName.entries()) {
      const { id, daily_capacity } = await getOrCreateMachineByName(machineName);
      machineMap.set(machineName, { id, cap: daily_capacity != null ? Number(daily_capacity) : 8 });
    }

    // Captura planificación existente desde baseISO por MOLDE completo (preserva distribución original por día)
    const existingRows = await query(
      `SELECT
          mold_id,
          planning_id,
          part_id,
          machine_id,
          hours_planned,
          is_priority,
          to_char(date, 'YYYY-MM-DD') AS date_str
       FROM plan_entries
       WHERE date >= ?
       ORDER BY date ASC, id ASC`,
      [baseISO]
    );

    const snapshotByMold = new Map();
    for (const row of existingRows || []) {
      const moldKey = Number(row.mold_id);
      if (!snapshotByMold.has(moldKey)) {
        snapshotByMold.set(moldKey, {
          mold_id: moldKey,
          startDateISO: String(row.date_str || ''),
          entries: [],
        });
      }
      const snap = snapshotByMold.get(moldKey);
      snap.entries.push({
        planning_id: row.planning_id != null ? Number(row.planning_id) : null,
        part_id: Number(row.part_id),
        machine_id: Number(row.machine_id),
        hours: Number(row.hours_planned || 0),
        isPriority: Boolean(row.is_priority),
        dateISO: String(row.date_str || ''),
      });
      await rememberBeforeRange(moldKey);
    }

    const existingMoldSnapshots = Array.from(snapshotByMold.values())
      .sort((a, b) => (a.startDateISO || '').localeCompare(b.startDateISO || '') || a.mold_id - b.mold_id);

    // Borrar TODO lo existente desde baseISO (se reinsertará corrido como bloques completos)
    await query('DELETE FROM plan_entries WHERE date >= ?', [baseISO]);

    // Coloca primero los BLOQUES PRIORITARIOS
    let globalPriorityEnd = null; // Date local (max end across machines)
    for (const [machineName, items] of priorityByMachineName.entries()) {
      const { id: machine_id, cap } = machineMap.get(machineName);
      const endPriority = await placeBlockNoPreempt({
        mold_id,
        planning_id: targetPlanningId,
        machine_id,
        capPerDay: cap,
        baseDateISO: baseISO,
        tasksQueue: items,
        createdBy,
        holidaySet,
        overrideMap,
        // En prioridad: no compartir día con otros moldes (evita "mezcla")
        allowShareLastDay: false,
        isPriority: true,
        strictGlobalUniqueDay: true
      });
      console.log('[planPriority] priorityEnd', { machineName, machine_id, endDate: endPriority });

      const endDateLocal = parseLocalISO(endPriority);
      if (!globalPriorityEnd || endDateLocal.getTime() > globalPriorityEnd.getTime()) {
        globalPriorityEnd = endDateLocal;
      }

    }

    // Prioridad GLOBAL: todo lo existente arranca después del fin global de prioridad
    if (!globalPriorityEnd) globalPriorityEnd = parseLocalISO(baseISO);
    const globalStartForExisting = nextWorkingDayLocal(globalPriorityEnd, holidaySet, overrideMap);
    console.log('[planPriority] globalPriorityEnd=', localISO(globalPriorityEnd), 'globalStartExisting=', localISO(globalStartForExisting));

    // Recoloca existentes por MOLDE completo, preservando offsets por día para evitar partir el molde.
    const dayOffsetFromStart = (startISO, targetISO) => {
      if (!startISO || !targetISO || targetISO <= startISO) return 0;
      let count = 0;
      let cur = parseLocalISO(startISO);
      while (localISO(cur) < targetISO) {
        cur = nextWorkingDayLocal(cur, holidaySet, overrideMap);
        count += 1;
      }
      return count;
    };

    const addWorkingDaysFrom = (startISO, offset) => {
      let cur = parseLocalISO(startISO);
      while (!isWorkingDayLocal(cur, holidaySet, overrideMap)) cur = addDays(cur, 1);
      for (let i = 0; i < offset; i++) cur = nextWorkingDayLocal(cur, holidaySet, overrideMap);
      return localISO(cur);
    };

    const hasConflictForDates = async (moldId, dates) => {
      for (const d of dates) {
        const rows = await query('SELECT 1 FROM plan_entries WHERE date = ? AND mold_id <> ? LIMIT 1', [d, moldId]);
        if (rows.length) return true;
      }
      return false;
    };

    let globalCursorISO = localISO(globalStartForExisting);
    for (const snap of existingMoldSnapshots) {
      const moldStartISO = snap.startDateISO;
      let candidateStartISO = globalCursorISO;
      if (moldStartISO && moldStartISO > candidateStartISO) candidateStartISO = moldStartISO;
      candidateStartISO = localISO(await firstWorkingOnOrAfter(candidateStartISO, holidaySet, overrideMap));

      const originalDates = Array.from(new Set((snap.entries || []).map(e => e.dateISO))).sort((a, b) => a.localeCompare(b));
      const offsets = new Map();
      for (const d of originalDates) offsets.set(d, dayOffsetFromStart(moldStartISO, d));

      let shiftedDateSet = [];
      const MAX_SCAN = 370;
      for (let i = 0; i < MAX_SCAN; i++) {
        shiftedDateSet = originalDates.map(d => addWorkingDaysFrom(candidateStartISO, offsets.get(d) || 0));
        const conflict = await hasConflictForDates(snap.mold_id, shiftedDateSet);
        if (!conflict) break;

        const next = nextWorkingDayLocal(parseLocalISO(candidateStartISO), holidaySet, overrideMap);
        candidateStartISO = localISO(next);
      }

      const shiftedByOriginalDate = new Map();
      for (const d of originalDates) shiftedByOriginalDate.set(d, addWorkingDaysFrom(candidateStartISO, offsets.get(d) || 0));

      for (const e of (snap.entries || [])) {
        const newDateISO = shiftedByOriginalDate.get(e.dateISO);
        await insertEntry({
          mold_id: snap.mold_id,
          planning_id: e.planning_id || null,
          part_id: e.part_id,
          machine_id: e.machine_id,
          dateISO: newDateISO,
          hours: e.hours,
          createdBy,
          isPriority: Boolean(e.isPriority),
        });
      }

      const maxShiftedDate = shiftedDateSet.slice().sort((a, b) => a.localeCompare(b)).pop() || candidateStartISO;
      globalCursorISO = localISO(nextWorkingDayLocal(parseLocalISO(maxShiftedDate), holidaySet, overrideMap));
    }

    const allMachineIds = new Set();
    for (const { id } of machineMap.values()) allMachineIds.add(id);
    for (const snap of existingMoldSnapshots) {
      for (const e of (snap.entries || [])) allMachineIds.add(Number(e.machine_id));
    }

    if (targetPlanningId) {
      const cycleRange = await query(
        `SELECT
            to_char(MIN(date), 'YYYY-MM-DD') AS start_date,
            to_char(MAX(date), 'YYYY-MM-DD') AS end_date
         FROM plan_entries
         WHERE mold_id = ? AND planning_id = ?`,
        [mold_id, targetPlanningId]
      );
      const cycleStart = cycleRange?.[0]?.start_date || null;
      const cycleEnd = cycleRange?.[0]?.end_date || null;
      await query(
        `UPDATE planning_history
         SET to_start_date = COALESCE(to_start_date, ?),
             to_end_date = ?
         WHERE id = ?`,
        [cycleStart, cycleEnd, targetPlanningId]
      );
    }

    for (const moldKey of affectedMoldsBefore.keys()) {
      await logMoldRangeChange({
        mold_id: moldKey,
        eventType: 'REPROGRAMMED',
        createdBy,
        note: `Ajuste por prioridad aplicado desde ${baseISO}`,
        beforeRange: affectedMoldsBefore.get(moldKey),
      });
    }

    res.json({
      message: 'Planificación prioritaria aplicada (global, bloques sin mezcla)',
      baseDate: baseISO,
      machinesAffected: [...allMachineIds]
    });
  } catch (e) {
    next(e);
  }
};

// ================================
// Editor de calendario: ver y mover entradas
// ================================

exports.getMoldPlan = async (req, res, next) => {
  try {
    const moldId = Number.parseInt(String(req.params.moldId), 10);
    if (!Number.isFinite(moldId) || moldId <= 0) return res.status(400).json({ error: 'moldId inválido' });

    const moldRows = await query('SELECT id, name FROM molds WHERE id = ? LIMIT 1', [moldId]);
    if (!moldRows.length) return res.status(404).json({ error: 'Molde no encontrado' });

    const planningMeta = await getActivePlanningMetaForMold(moldId);
    const activePlanningId = planningMeta?.planningId != null
      ? Number(planningMeta.planningId)
      : null;
    let planningIdToUse = Number.isFinite(activePlanningId) ? activePlanningId : null;

    if (planningIdToUse) {
      const hasRows = await query(
        `SELECT 1
         FROM plan_entries
         WHERE mold_id = ? AND planning_id = ?
         LIMIT 1`,
        [moldId, planningIdToUse]
      );

      if (!hasRows.length) {
        const fallbackRows = await query(
          `SELECT id
           FROM planning_history
           WHERE mold_id = ?
             AND event_type = 'PLANNED'
             AND EXISTS (
               SELECT 1
               FROM plan_entries pe
               WHERE pe.mold_id = ?
                 AND pe.planning_id = planning_history.id
             )
           ORDER BY to_start_date DESC NULLS LAST, created_at DESC, id DESC
           LIMIT 1`,
          [moldId, moldId]
        );
        const fallbackId = fallbackRows.length ? Number(fallbackRows[0].id) : null;
        planningIdToUse = Number.isFinite(fallbackId) ? fallbackId : planningIdToUse;
      }
    }

    const rangeWhere = planningIdToUse != null
      ? 'WHERE mold_id = ? AND (?::int IS NULL OR planning_id = ?::int)'
      : 'WHERE mold_id = ?';
    const rangeParams = planningIdToUse != null ? [moldId, planningIdToUse, planningIdToUse] : [moldId];

    const rangeRows = await query(
      `SELECT
          to_char(MIN(date), 'YYYY-MM-DD') AS "startDate",
          to_char(MAX(date), 'YYYY-MM-DD') AS "endDate"
       FROM plan_entries
       ${rangeWhere}`,
      rangeParams
    );
    const startDate = rangeRows[0]?.startDate || null;
    const endDate = rangeRows[0]?.endDate || null;

    const entriesWhere = planningIdToUse != null
      ? 'WHERE p.mold_id = ? AND (?::int IS NULL OR p.planning_id = ?::int)'
      : 'WHERE p.mold_id = ?';
    const entriesParams = planningIdToUse != null ? [moldId, planningIdToUse, planningIdToUse] : [moldId];

    const entries = await query(
      `SELECT
          p.id AS "entryId",
          to_char(p.date, 'YYYY-MM-DD') AS date,
          p.hours_planned AS hours,
          ma.id AS "machineId",
          ma.name AS machine,
          mp.id AS "partId",
          mp.name AS part
       FROM plan_entries p
       JOIN machines ma ON p.machine_id = ma.id
       JOIN mold_parts mp ON p.part_id = mp.id
       ${entriesWhere}
       ORDER BY p.date ASC, ma.name ASC, p.id ASC`,
      entriesParams
    );

    res.json({
      moldId,
      moldName: moldRows[0].name,
      planningId: planningIdToUse,
      startDate,
      endDate,
      entries: entries.map(e => ({
        entryId: e.entryId,
        date: e.date,
        hours: Number(e.hours || 0),
        machineId: e.machineId,
        machine: e.machine,
        partId: e.partId,
        part: e.part
      }))
    });
  } catch (e) {
    next(e);
  }
};

// Elimina la planificación completa de un molde (plan_entries + snapshots de parrilla)
exports.deleteMoldPlan = async (req, res, next) => {
  try {
    const createdBy = getRequestUserId(req);
    const moldId = Number.parseInt(String(req.params.moldId), 10);
    if (!Number.isFinite(moldId) || moldId <= 0) return res.status(400).json({ error: 'moldId inválido' });

    const moldRows = await query('SELECT id, name FROM molds WHERE id = ? LIMIT 1', [moldId]);
    if (!moldRows.length) return res.status(404).json({ error: 'Molde no encontrado' });

    const beforeRange = await getMoldPlanRange(moldId);

    const deletedPlan = await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldId]);
    const deletedSnaps = await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldId]);

    await logMoldRangeChange({
      mold_id: moldId,
      eventType: 'DELETED',
      createdBy,
      note: 'Planificación eliminada',
      beforeRange,
      afterRange: { startDate: null, endDate: null },
    });

    res.json({
      message: 'Planificación eliminada',
      moldId,
      moldName: moldRows[0].name,
      deletedEntries: Number(deletedPlan?.affectedRows || 0),
      deletedSnapshots: Number(deletedSnaps?.affectedRows || 0)
    });
  } catch (e) {
    next(e);
  }
};

exports.updatePlanEntry = async (req, res, next) => {
  try {
    const entryId = Number.parseInt(String(req.params.entryId), 10);
    if (!Number.isFinite(entryId) || entryId <= 0) return res.status(400).json({ error: 'entryId inválido' });

    const allowOverlap = parseBoolInput(req.body?.allowOverlap);

    const newDateISO = toStr(req.body?.date);
    const newMachineName = toStr(req.body?.machineName);

    if (!isValidISODateString(newDateISO)) return res.status(400).json({ error: 'date inválida (YYYY-MM-DD)' });
    if (!newMachineName) return res.status(400).json({ error: 'machineName requerido' });

    const entryRows = await query(
      `SELECT id, mold_id, planning_id, part_id, machine_id, is_priority, to_char(date,'YYYY-MM-DD') AS date_str, hours_planned
       FROM plan_entries WHERE id = ? LIMIT 1`,
      [entryId]
    );
    if (!entryRows.length) return res.status(404).json({ error: 'Entrada no encontrada' });
    const entry = entryRows[0];
    const beforeRange = await getMoldPlanRange(entry.mold_id);

    // Si ya está cerrada manualmente (is_final_log), no se permite mover.
    try {
      const entryPlanningId = entry.planning_id != null ? Number(entry.planning_id) : null;

      const finalLogRows = await query(
        `SELECT 1 FROM work_logs
         WHERE mold_id = ?
           AND part_id = ?
           AND machine_id = ?
           AND is_final_log = TRUE
           AND (
             (?::bigint IS NULL AND planning_id IS NULL)
             OR planning_id = ?::bigint
           )
         LIMIT 1`,
        [entry.mold_id, entry.part_id, entry.machine_id, entryPlanningId, entryPlanningId]
      );
      if (finalLogRows.length > 0) {
        return res.status(409).json({ error: 'Esta tarea fue cerrada manualmente (cierre final); no se puede mover. Solo el administrador puede reabrirla.' });
      }
    } catch (_) {
      // Si falla el cálculo, seguimos con la validación normal.
    }

    const { holidaySet, overrideMap } = await getWorkingMeta();

    const today = todayLocal();
    const newLocal = parseLocalISO(newDateISO);
    if (localISO(newLocal) < localISO(today)) return res.status(400).json({ error: 'No se puede mover a fechas pasadas' });
    if (!isWorkingDayLocal(newLocal, holidaySet, overrideMap)) return res.status(400).json({ error: 'La fecha seleccionada no es laborable' });

    const { id: targetMachineId, daily_capacity } = await getOrCreateMachineByName(newMachineName);
    const cap = daily_capacity != null ? Number(daily_capacity) : 8;

    const hours = round025(Number(entry.hours_planned || 0));
    if (hours <= 0) return res.status(400).json({ error: 'Horas inválidas para esta entrada' });

    if (!allowOverlap && newDateISO > entry.date_str) {
      const blockedDate = await findFirstBlockedWorkingDayBetweenGlobal({
        fromDateISO: entry.date_str,
        toDateISO: newDateISO,
        currentMoldId: Number(entry.mold_id),
        holidaySet,
        overrideMap,
        excludeEntryId: entryId,
      });

      if (blockedDate) {
        return res.status(400).json({
          error: `No se puede mover en fecha fija: existe planificación activa en ${blockedDate}. No se permite mover hacia días con planificación existente.`
        });
      }
    }

    if (!allowOverlap) {
      const dayBlocked = await hasOtherMoldPlannedOnDate({
        dateISO: newDateISO,
        currentMoldId: Number(entry.mold_id),
        excludeEntryId: entryId,
      });
      if (dayBlocked) {
        return res.status(400).json({
          error: `No se puede mover: ${newDateISO} ya tiene otra planificación activa.`
        });
      }
    }

    // Capacidad y no-mezcla en el destino
    const { used, moldIds } = await getDayUsageExcludingEntry(targetMachineId, newDateISO, entryId);
    const capLeft = round025(cap - used);
    if (capLeft + 1e-9 < hours) {
      return res.status(400).json({ error: `No hay capacidad en ${newDateISO} para "${newMachineName}" (capacidad disponible: ${capLeft}h)` });
    }

    // En edición: no se permite mezclar con otro molde planificado en el día destino.
    if (!allowOverlap) {
      const otherMolds = moldIds.filter(mid => mid !== entry.mold_id);
      if (otherMolds.length > 0) {
        return res.status(400).json({ error: `No se puede mover: ${newDateISO} ya está ocupado por otro molde en "${newMachineName}"` });
      }
    }

    await query('UPDATE plan_entries SET date = ?, machine_id = ? WHERE id = ?', [newDateISO, targetMachineId, entryId]);

    await logMoldRangeChange({
      mold_id: Number(entry.mold_id),
      eventType: 'MOVED',
      createdBy: getRequestUserId(req),
      note: `Entrada ${entryId}: ${entry.date_str} -> ${newDateISO}`,
      beforeRange,
    });

    res.json({ message: 'Entrada actualizada', entryId, date: newDateISO, machineName: mapMachineAlias(newMachineName) });
  } catch (e) {
    next(e);
  }
};

exports.movePlanEntryToNextAvailable = async (req, res, next) => {
  try {
    const entryId = Number.parseInt(String(req.params.entryId), 10);
    if (!Number.isFinite(entryId) || entryId <= 0) return res.status(400).json({ error: 'entryId inválido' });

    const allowOverlap = parseBoolInput(req.body?.allowOverlap);

    const requestedBaseDateISO = toStr(req.body?.baseDate);
    const requestedMachineName = toStr(req.body?.machineName);

    if (requestedBaseDateISO && !isValidISODateString(requestedBaseDateISO)) {
      return res.status(400).json({ error: 'baseDate inválida (YYYY-MM-DD)' });
    }

    const entryRows = await query(
      `SELECT id, mold_id, machine_id, is_priority, to_char(date,'YYYY-MM-DD') AS date_str, hours_planned
       FROM plan_entries WHERE id = ? LIMIT 1`,
      [entryId]
    );
    if (!entryRows.length) return res.status(404).json({ error: 'Entrada no encontrada' });
    const entry = entryRows[0];
    const beforeRange = await getMoldPlanRange(entry.mold_id);

    const { holidaySet, overrideMap } = await getWorkingMeta();
    const today = todayLocal();
    const todayISO = localISO(today);

    // Máquina destino
    let targetMachineId = entry.machine_id;
    let targetMachineName = null;
    let cap = 8;

    if (requestedMachineName) {
      const m = await getOrCreateMachineByName(requestedMachineName);
      targetMachineId = m.id;
      cap = m.daily_capacity != null ? Number(m.daily_capacity) : 8;
      targetMachineName = mapMachineAlias(requestedMachineName);
    } else {
      const mrows = await query('SELECT name, daily_capacity FROM machines WHERE id = ? LIMIT 1', [entry.machine_id]);
      targetMachineName = mrows.length ? mrows[0].name : 'Máquina';
      cap = mrows.length && mrows[0].daily_capacity != null ? Number(mrows[0].daily_capacity) : 8;
    }

    const hours = round025(Number(entry.hours_planned || 0));
    if (hours <= 0) return res.status(400).json({ error: 'Horas inválidas para esta entrada' });

    // Fecha base (desde la que buscamos). Default: la fecha actual de la entrada.
    // IMPORTANTE: este endpoint busca el *siguiente* disponible (estrictamente después),
    // para evitar que "se quede en el mismo día".
    let baseISO = requestedBaseDateISO || entry.date_str;
    const wasClampedToToday = baseISO < todayISO;
    if (wasClampedToToday) baseISO = todayISO;

    let baseLocal = await firstWorkingOnOrAfter(baseISO, holidaySet, overrideMap);
    let cursor = wasClampedToToday
      ? baseLocal
      : nextWorkingDayLocal(baseLocal, holidaySet, overrideMap);

    const MAX_DAYS_SCAN = 370;
    let foundISO = null;

    for (let i = 0; i < MAX_DAYS_SCAN; i++) {
      const dateISO = localISO(cursor);

      if (!allowOverlap) {
        const dayBlocked = await hasOtherMoldPlannedOnDate({
          dateISO,
          currentMoldId: Number(entry.mold_id),
          excludeEntryId: entryId,
        });
        if (dayBlocked) {
          cursor = nextWorkingDayLocal(cursor, holidaySet, overrideMap);
          continue;
        }
      }

      // Capacidad y no-mezcla en el destino
      const { used, moldIds } = await getDayUsageExcludingEntry(targetMachineId, dateISO, entryId);
      const capLeft = round025(cap - used);
      if (capLeft + 1e-9 >= hours) {
        // Salto inteligente: por defecto permite continuidad del mismo molde por capacidad.
        const otherMolds = moldIds.filter(mid => mid !== entry.mold_id);
        const mixingOk = allowOverlap ? true : (otherMolds.length === 0);
        if (mixingOk) {
          // Nunca devolver la misma asignación (misma fecha + misma máquina)
          if (!(dateISO === entry.date_str && targetMachineId === entry.machine_id)) {
            foundISO = dateISO;
            break;
          }
        }
      }

      cursor = nextWorkingDayLocal(cursor, holidaySet, overrideMap);
    }

    if (!foundISO) {
      return res.status(400).json({ error: 'No se encontró un día disponible cercano (capacidad/mezcla)' });
    }

    await query('UPDATE plan_entries SET date = ?, machine_id = ? WHERE id = ?', [foundISO, targetMachineId, entryId]);

    await logMoldRangeChange({
      mold_id: Number(entry.mold_id),
      eventType: 'MOVED',
      createdBy: getRequestUserId(req),
      note: `Entrada ${entryId}: ${entry.date_str} -> ${foundISO} (siguiente disponible)`,
      beforeRange,
    });

    res.json({ message: 'Movido al siguiente disponible', entryId, date: foundISO, machineName: targetMachineName });
  } catch (e) {
    next(e);
  }
};

// Mover múltiples PARTES (solo pendientes) de un molde.
// - Se recalcula pendiente por (parte+máquina): pending = planned - actual.
// - Se elimina la planificación existente de esas parejas y se replanifica solo el pendiente.
// - mode:
//    - 'date': usa date como startDate (laborable, no pasado)
//    - 'next': busca desde el siguiente laborable a partir de baseDate (o hoy) (no se queda en el mismo día)
exports.moveMoldParts = async (req, res, next) => {
  let recoveryPairs = [];
  let deletedEntriesBackup = [];
  let moldIdForRecovery = null;
  let createdByForRecovery = null;
  try {
    const createdBy = getRequestUserId(req);
    createdByForRecovery = createdBy;
    if (!createdBy) return res.status(403).json({ error: 'Usuario no válido para crear planificación' });

    const moldId = Number.parseInt(String(req.params.moldId || ''), 10);
    moldIdForRecovery = moldId;
    if (!Number.isFinite(moldId) || moldId <= 0) return res.status(400).json({ error: 'moldId inválido' });

    const moldRows = await query('SELECT id, name FROM molds WHERE id = ? LIMIT 1', [moldId]);
    if (!moldRows.length) return res.status(404).json({ error: 'Molde no encontrado' });
    const beforeRange = await getMoldPlanRange(moldId);

    const mode = String(req.body?.mode || '').trim().toLowerCase();
    const rawDate = toStr(req.body?.date); // YYYY-MM-DD
    const rawBaseDate = toStr(req.body?.baseDate); // YYYY-MM-DD

    const partIdsRaw = Array.isArray(req.body?.partIds) ? req.body.partIds : [];
    const partIds = partIdsRaw
      .map(v => Number.parseInt(String(v), 10))
      .filter(n => Number.isFinite(n) && n > 0);

    const uniquePartIds = Array.from(new Set(partIds));
    if (!uniquePartIds.length) return res.status(400).json({ error: 'Debe seleccionar al menos una parte' });

    if (mode !== 'date' && mode !== 'next') return res.status(400).json({ error: 'mode inválido (use "date" o "next")' });
    if (mode === 'date' && !isValidISODateString(rawDate)) return res.status(400).json({ error: 'date inválida (YYYY-MM-DD)' });
    if (rawBaseDate && !isValidISODateString(rawBaseDate)) return res.status(400).json({ error: 'baseDate inválida (YYYY-MM-DD)' });

    const { holidaySet, overrideMap } = await getWorkingMeta();
    const todayISO = localISO(todayLocal());

    // Determinar fecha de arranque
    let baseISO = todayISO;
    if (mode === 'date') {
      baseISO = rawDate;
    } else {
      baseISO = rawBaseDate || todayISO;
      if (baseISO < todayISO) baseISO = todayISO;
      // Forzar "siguiente disponible" (estrictamente después del base)
      const baseLocal = await firstWorkingOnOrAfter(baseISO, holidaySet, overrideMap);
      baseISO = localISO(nextWorkingDayLocal(baseLocal, holidaySet, overrideMap));
    }

    if (baseISO < todayISO) return res.status(400).json({ error: 'No se puede mover a fechas pasadas' });
    const baseLocal = parseLocalISO(baseISO);
    if (!isWorkingDayLocal(baseLocal, holidaySet, overrideMap)) {
      return res.status(400).json({ error: 'La fecha seleccionada no es laborable' });
    }

    // Construir IN (?, ?, ...)
    const inPlaceholders = uniquePartIds.map(() => '?').join(',');

    const plannedPairs = await query(
      `SELECT part_id, machine_id, SUM(hours_planned) AS planned_hours
       FROM plan_entries
       WHERE mold_id = ? AND part_id IN (${inPlaceholders})
       GROUP BY part_id, machine_id`,
      [moldId, ...uniquePartIds]
    );

    if (!plannedPairs.length) {
      return res.status(409).json({ error: 'No hay planificación para las partes seleccionadas' });
    }

    const planningMeta = await getActivePlanningMetaForMold(moldId);
    const wlScope = buildWorkLogScopeSql({
      alias: 'work_logs',
      mold_id: moldId,
      planningId: planningMeta.planningId,
      startDate: planningMeta.startDate,
    });

    const actualPairs = await query(
      `SELECT part_id, machine_id, SUM(hours_worked) AS actual_hours
       FROM work_logs
       WHERE mold_id = ? AND part_id IN (${inPlaceholders})
         ${wlScope.clause}
       GROUP BY part_id, machine_id`,
      [moldId, ...uniquePartIds, ...wlScope.params]
    );

    const actualMap = new Map();
    for (const r of actualPairs || []) {
      actualMap.set(`${String(r.part_id)}:${String(r.machine_id)}`, Number(r.actual_hours || 0));
    }

    // Pendiente por pareja (parte+máquina)
    const pendingPairs = [];
    let skippedCompletedPairs = 0;
    for (const r of plannedPairs || []) {
      const plannedHours = round025(Number(r.planned_hours || 0));
      const key = `${String(r.part_id)}:${String(r.machine_id)}`;
      const actualHours = round025(Number(actualMap.get(key) || 0));
      const pending = round025(plannedHours - actualHours);

      if (!(pending > 0.000001)) {
        skippedCompletedPairs++;
        continue;
      }
      pendingPairs.push({ part_id: Number(r.part_id), machine_id: Number(r.machine_id), pendingHours: pending });
    }

    if (!pendingPairs.length) {
      return res.status(409).json({ error: 'Las partes seleccionadas no tienen trabajo pendiente para mover.' });
    }

    recoveryPairs = pendingPairs.map(p => ({ part_id: Number(p.part_id), machine_id: Number(p.machine_id) }));
    deletedEntriesBackup = [];
    const activePlanningMeta = await getActivePlanningMetaForMold(moldId);
    const activePlanningId = activePlanningMeta.planningId || null;

    // Borrar planificación existente de esas parejas (igual que replace: no mantenemos historial de plan)
    for (const p of pendingPairs) {
      const existingRows = await query(
        `SELECT
            part_id,
            machine_id,
            planning_id,
            to_char(date, 'YYYY-MM-DD') AS date_str,
            hours_planned,
            is_priority,
            created_by
         FROM plan_entries
         WHERE mold_id = ? AND part_id = ? AND machine_id = ?
         ORDER BY date ASC, id ASC`,
        [moldId, p.part_id, p.machine_id]
      );
      for (const row of existingRows || []) {
        deletedEntriesBackup.push({
          part_id: Number(row.part_id),
          machine_id: Number(row.machine_id),
          planningId: row.planning_id != null ? Number(row.planning_id) : null,
          dateISO: String(row.date_str || ''),
          hours: Number(row.hours_planned || 0),
          isPriority: Boolean(row.is_priority),
          createdBy: Number(row.created_by || createdBy),
        });
      }
      await query('DELETE FROM plan_entries WHERE mold_id = ? AND part_id = ? AND machine_id = ?', [moldId, p.part_id, p.machine_id]);
    }

    // Reagrupar por máquina respetando el orden de selección de partIds
    const orderIndex = new Map(uniquePartIds.map((id, i) => [String(id), i]));
    pendingPairs.sort((a, b) => {
      const ia = orderIndex.get(String(a.part_id)) ?? 999999;
      const ib = orderIndex.get(String(b.part_id)) ?? 999999;
      if (ia !== ib) return ia - ib;
      return String(a.part_id).localeCompare(String(b.part_id));
    });

    const byMachineId = new Map();
    for (const p of pendingPairs) {
      const arr = byMachineId.get(p.machine_id) || [];
      arr.push({ part_id: p.part_id, hours: p.pendingHours });
      byMachineId.set(p.machine_id, arr);
    }

    const results = [];
    for (const [machine_id, items] of byMachineId.entries()) {
      const mrows = await query('SELECT name, daily_capacity FROM machines WHERE id = ? LIMIT 1', [machine_id]);
      const machineName = mrows.length ? mrows[0].name : String(machine_id);
      const cap = mrows.length && mrows[0].daily_capacity != null ? Number(mrows[0].daily_capacity) : 8;

      const lastDay = await placeBlockNoPreempt({
        mold_id: moldId,
        planning_id: activePlanningId,
        machine_id: Number(machine_id),
        capPerDay: cap,
        baseDateISO: baseISO,
        tasksQueue: items,
        createdBy,
        holidaySet,
        overrideMap,
        allowShareLastDay: false,
        isPriority: false,
        completionCache: new Map(),
        strictNoSkip: mode === 'date'
      });

      results.push({ machineId: Number(machine_id), machineName, startDate: baseISO, endDate: lastDay, capacityPerDay: cap });
    }

    await logMoldRangeChange({
      mold_id: moldId,
      eventType: 'REPROGRAMMED',
      createdBy,
      note: mode === 'date'
        ? `Reprogramación de partes desde ${baseISO}`
        : `Reprogramación de partes (siguiente disponible) desde ${baseISO}`,
      beforeRange,
    });

    res.json({
      message: mode === 'date' ? 'Partes movidas a la fecha seleccionada (solo pendientes)' : 'Partes movidas al siguiente disponible (solo pendientes)',
      moldId,
      moldName: moldRows[0].name,
      startDate: baseISO,
      movedPairs: pendingPairs.length,
      skippedCompletedPairs,
      results
    });
  } catch (e) {
    if (e?.code === 'STRICT_BLOCKED_DAY') {
      try {
        if (Number.isFinite(moldIdForRecovery) && Array.isArray(recoveryPairs)) {
          for (const pair of recoveryPairs) {
            await query('DELETE FROM plan_entries WHERE mold_id = ? AND part_id = ? AND machine_id = ?', [moldIdForRecovery, pair.part_id, pair.machine_id]);
          }
        }

        if (Array.isArray(deletedEntriesBackup) && deletedEntriesBackup.length) {
          for (const row of deletedEntriesBackup) {
            await query(
              `INSERT INTO plan_entries (mold_id, planning_id, part_id, machine_id, date, hours_planned, is_priority, created_by)
               VALUES (?,?,?,?,?,?,?,?)`,
              [moldIdForRecovery, row.planningId || null, row.part_id, row.machine_id, row.dateISO, row.hours, row.isPriority ? 1 : 0, row.createdBy || createdByForRecovery]
            );
          }
        }
      } catch (restoreErr) {
        console.error('[moveMoldParts] error restaurando plan tras bloqueo estricto:', restoreErr?.message || restoreErr);
      }

      return res.status(400).json({
        error: `No se puede mover: existe planificación activa en ${e?.blockedDate || 'la fecha solicitada'}. No se permite mover hacia días con planificación existente.`
      });
    }
    next(e);
  }
};

// Mover múltiples entradas (por entryId) en bloque.
// Esto sigue la misma lógica que el editor individual:
// - Una entrada no se mueve si su pareja (molde+parte+máquina) ya está completa.
// - Se validan días laborables, capacidad y regla de no-mezcla.
// Payload:
// { entryIds: number[], mode: 'date'|'next', date?: 'YYYY-MM-DD', baseDate?: 'YYYY-MM-DD' }
exports.bulkMovePlanEntries = async (req, res, next) => {
  try {
    const createdBy = getRequestUserId(req);
    if (!createdBy) return res.status(403).json({ error: 'Usuario no válido para operar' });

    const mode = String(req.body?.mode || '').trim().toLowerCase();
    const dateISO = toStr(req.body?.date);
    const baseDateISO = toStr(req.body?.baseDate);
    const allowOverlap = parseBoolInput(req.body?.allowOverlap);

    const entryIdsRaw = Array.isArray(req.body?.entryIds) ? req.body.entryIds : [];
    const entryIds = Array.from(new Set(
      entryIdsRaw
        .map(v => Number.parseInt(String(v), 10))
        .filter(n => Number.isFinite(n) && n > 0)
    ));
    if (!entryIds.length) return res.status(400).json({ error: 'Debe enviar entryIds' });

    if (mode !== 'date' && mode !== 'next') return res.status(400).json({ error: 'mode inválido (use "date" o "next")' });
    if (mode === 'date' && !isValidISODateString(dateISO)) return res.status(400).json({ error: 'date inválida (YYYY-MM-DD)' });
    if (baseDateISO && !isValidISODateString(baseDateISO)) return res.status(400).json({ error: 'baseDate inválida (YYYY-MM-DD)' });

    const { holidaySet, overrideMap } = await getWorkingMeta();
    const todayISO = localISO(todayLocal());

    // Pre-validar fecha objetivo para modo 'date'
    if (mode === 'date') {
      if (dateISO < todayISO) return res.status(400).json({ error: 'No se puede mover a fechas pasadas' });
      const dLocal = parseLocalISO(dateISO);
      if (!isWorkingDayLocal(dLocal, holidaySet, overrideMap)) return res.status(400).json({ error: 'La fecha seleccionada no es laborable' });
    }

    const results = [];
    let moved = 0;
    let skippedCompleted = 0;
    let failed = 0;
    const beforeRangeByMold = new Map();

    for (const entryId of entryIds) {
      try {
        const entryRows = await query(
          `SELECT id, mold_id, part_id, machine_id, is_priority, to_char(date,'YYYY-MM-DD') AS date_str, hours_planned
           FROM plan_entries WHERE id = ? LIMIT 1`,
          [entryId]
        );
        if (!entryRows.length) {
          failed++;
          results.push({ entryId, ok: false, error: 'Entrada no encontrada' });
          continue;
        }
        const entry = entryRows[0];
        const moldKey = Number(entry.mold_id);
        if (!beforeRangeByMold.has(moldKey)) {
          beforeRangeByMold.set(moldKey, await getMoldPlanRange(moldKey));
        }

        // Bloqueo SOLO si fue cerrada manualmente (is_final_log = true)
        try {
          const planningMeta = await getActivePlanningMetaForMold(entry.mold_id);
          const wlScope = buildWorkLogScopeSql({
            alias: 'work_logs',
            mold_id: entry.mold_id,
            planningId: planningMeta.planningId,
            startDate: planningMeta.startDate,
          });

          const finalLogRows = await query(
            `SELECT 1 FROM work_logs
             WHERE mold_id = ? AND part_id = ? AND machine_id = ? AND is_final_log = TRUE
               ${wlScope.clause}
             LIMIT 1`,
            [entry.mold_id, entry.part_id, entry.machine_id, ...wlScope.params]
          );
          if (finalLogRows.length > 0) {
            skippedCompleted++;
            results.push({ entryId, ok: false, error: 'Cerrada manualmente (cierre final); no se puede mover' });
            continue;
          }
        } catch (_) {
          // Si falla el cálculo, seguimos con validación normal.
        }

        const hours = round025(Number(entry.hours_planned || 0));
        if (hours <= 0) {
          failed++;
          results.push({ entryId, ok: false, error: 'Horas inválidas para esta entrada' });
          continue;
        }

        // Máquina destino: la misma de la entrada
        const mrows = await query('SELECT name, daily_capacity FROM machines WHERE id = ? LIMIT 1', [entry.machine_id]);
        const machineName = mrows.length ? mrows[0].name : String(entry.machine_id);
        const cap = mrows.length && mrows[0].daily_capacity != null ? Number(mrows[0].daily_capacity) : 8;

        let targetISO = null;
        if (mode === 'date') {
          targetISO = dateISO;
        } else {
          // Siguiente disponible: desde el siguiente laborable a partir de baseDate (o fecha actual de la entrada)
          let baseISO = baseDateISO || entry.date_str;
          const wasClampedToToday = baseISO < todayISO;
          if (wasClampedToToday) baseISO = todayISO;
          const baseLocal = await firstWorkingOnOrAfter(baseISO, holidaySet, overrideMap);
          let cursor = wasClampedToToday
            ? baseLocal
            : nextWorkingDayLocal(baseLocal, holidaySet, overrideMap);

          const MAX_DAYS_SCAN = 370;
          for (let i = 0; i < MAX_DAYS_SCAN; i++) {
            const dISO = localISO(cursor);

            if (!allowOverlap) {
              const dayBlocked = await hasOtherMoldPlannedOnDate({
                dateISO: dISO,
                currentMoldId: Number(entry.mold_id),
                excludeEntryId: entryId,
              });
              if (dayBlocked) {
                cursor = nextWorkingDayLocal(cursor, holidaySet, overrideMap);
                continue;
              }
            }

            const { used, moldIds } = await getDayUsageExcludingEntry(entry.machine_id, dISO, entryId);
            const capLeft = round025(cap - used);
            if (capLeft + 1e-9 >= hours) {
              const otherMolds = moldIds.filter(mid => mid !== entry.mold_id);
              const mixingOk = allowOverlap ? true : (otherMolds.length === 0);
              if (mixingOk) {
                targetISO = dISO;
                break;
              }
            }

            cursor = nextWorkingDayLocal(cursor, holidaySet, overrideMap);
          }

          if (!targetISO) {
            failed++;
            results.push({ entryId, ok: false, error: 'No se encontró siguiente disponible (capacidad/mezcla)' });
            continue;
          }
        }

        // Validaciones destino (capacidad/no-mezcla) para modo date
        if (mode === 'date') {
          if (!allowOverlap && targetISO > entry.date_str) {
            const blockedDate = await findFirstBlockedWorkingDayBetweenGlobal({
              fromDateISO: entry.date_str,
              toDateISO: targetISO,
              currentMoldId: Number(entry.mold_id),
              holidaySet,
              overrideMap,
              excludeEntryId: entryId,
            });
            if (blockedDate) {
              failed++;
              results.push({
                entryId,
                ok: false,
                error: `No se puede mover en fecha fija: existe planificación activa en ${blockedDate}. No se permite mover hacia días con planificación existente.`
              });
              continue;
            }
          }

          if (!allowOverlap) {
            const dayBlocked = await hasOtherMoldPlannedOnDate({
              dateISO: targetISO,
              currentMoldId: Number(entry.mold_id),
              excludeEntryId: entryId,
            });
            if (dayBlocked) {
              failed++;
              results.push({ entryId, ok: false, error: `No se puede mover: ${targetISO} ya tiene otra planificación activa.` });
              continue;
            }
          }

          const { used, moldIds } = await getDayUsageExcludingEntry(entry.machine_id, targetISO, entryId);
          const capLeft = round025(cap - used);
          if (capLeft + 1e-9 < hours) {
            failed++;
            results.push({ entryId, ok: false, error: `No hay capacidad en ${targetISO} para "${machineName}" (disp: ${capLeft}h)` });
            continue;
          }

          if (!allowOverlap) {
            const otherMolds = moldIds.filter(mid => mid !== entry.mold_id);
            if (otherMolds.length > 0) {
              failed++;
              results.push({ entryId, ok: false, error: `No se puede mover: ${targetISO} ya está ocupado por otro molde en "${machineName}"` });
              continue;
            }
          }
        }

        await query('UPDATE plan_entries SET date = ? WHERE id = ?', [targetISO, entryId]);
        moved++;
        results.push({ entryId, ok: true, date: targetISO, machineName });
      } catch (e) {
        failed++;
        results.push({ entryId, ok: false, error: String(e?.message || e) });
      }
    }

    if (moved > 0) {
      for (const [moldKey, beforeRange] of beforeRangeByMold.entries()) {
        await logMoldRangeChange({
          mold_id: moldKey,
          eventType: 'MOVED_BULK',
          createdBy,
          note: mode === 'date'
            ? `Movimiento masivo de entradas a ${dateISO}`
            : `Movimiento masivo al siguiente disponible (base ${baseDateISO || 'auto'})`,
          beforeRange,
        });
      }
    }

    const defaultSuccessMessage = mode === 'date'
      ? 'Entradas movidas a la fecha seleccionada'
      : 'Entradas movidas al siguiente disponible';

    if (moved === 0 && failed > 0) {
      const firstError = String(results.find(r => r && r.ok === false && r.error)?.error || '').trim();
      return res.status(400).json({
        error: firstError || 'No se pudo mover ninguna fila seleccionada.',
        moved,
        skippedCompleted,
        failed,
        results
      });
    }

    const message = (moved > 0 && failed > 0)
      ? `Movimiento parcial: ${moved} fila(s) movida(s), ${failed} con error.`
      : defaultSuccessMessage;

    res.json({
      message,
      moved,
      skippedCompleted,
      failed,
      results
    });
  } catch (e) {
    next(e);
  }
};
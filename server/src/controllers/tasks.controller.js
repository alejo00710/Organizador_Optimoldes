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

/* =========================================
   Primitivas de Scheduling
   ========================================= */
async function insertEntry({ mold_id, part_id, machine_id, dateISO, hours, createdBy, isPriority = false }) {
  const hrs = round025(hours);
  if (createdBy == null) throw new Error('created_by requerido (usuario no normalizado)');
  await query(
    `INSERT INTO plan_entries (mold_id, part_id, machine_id, date, hours_planned, is_priority, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [mold_id, part_id, machine_id, dateISO, hrs, isPriority ? 1 : 0, createdBy]
  );
}

async function getDayUsage(machine_id, dateISO) {
  const rows = await query(
    `SELECT mold_id, SUM(hours_planned) AS used
     FROM plan_entries
     WHERE machine_id = ? AND date = ?
     GROUP BY mold_id`,
    [machine_id, dateISO]
  );
  const used = rows.reduce((a, r) => a + Number(r.used || 0), 0);
  const moldIds = rows.map(r => r.mold_id);
  return { used: round025(used), moldIds };
}

async function getDayUsageExcludingEntry(machine_id, dateISO, excludeEntryId) {
  const rows = await query(
    `SELECT mold_id, SUM(hours_planned) AS used
     FROM plan_entries
     WHERE machine_id = ? AND date = ? AND id <> ?
     GROUP BY mold_id`,
    [machine_id, dateISO, excludeEntryId]
  );
  const used = rows.reduce((a, r) => a + Number(r.used || 0), 0);
  const moldIds = rows.map(r => r.mold_id);
  return { used: round025(used), moldIds };
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

// Coloca un bloque sin mezclar; puede compartir SOLO el último día de un bloque anterior si hay capacidad
async function placeBlockNoPreempt({ mold_id, machine_id, capPerDay, baseDateISO, tasksQueue, createdBy, holidaySet, overrideMap, allowShareLastDay = true, isPriority = false }) {
  let cursor = parseLocalISO(baseDateISO);
  while (!isWorkingDayLocal(cursor, holidaySet, overrideMap)) cursor = addDays(cursor, 1);

  const queue = tasksQueue
    .map(t => ({ part_id: t.part_id, hours: round025(t.hours) }))
    .filter(t => t.hours > 0);

  let lastPlannedDate = null;

  while (queue.length > 0) {
    while (!isWorkingDayLocal(cursor, holidaySet, overrideMap)) cursor = addDays(cursor, 1);
    const dateISO = localISO(cursor);

    const { used, moldIds } = await getDayUsage(machine_id, dateISO);
    let capLeft = round025((capPerDay != null ? Number(capPerDay) : 8) - used);
    if (capLeft < 0) capLeft = 0;

    let canUseToday = false;
    if (used === 0 && capLeft > 0) {
      canUseToday = true;
    } else if (moldIds.length === 1 && capLeft > 0) {
      // Continuación del MISMO molde (si ya existe en ese día)
      if (moldIds[0] === mold_id) {
        canUseToday = true;
      } else if (allowShareLastDay) {
        // Excepción: compartir solo si es el último día del bloque anterior
        const lastDay = await isLastDayOfBlock(machine_id, moldIds[0], dateISO, holidaySet, overrideMap);
        if (lastDay) canUseToday = true;
      }
    }

    if (!canUseToday) {
      cursor = addDays(cursor, 1);
      continue;
    }

    let plannedToday = false;

    while (capLeft > 0 && queue.length > 0) {
      const item = queue[0];
      const alloc = round025(Math.min(capLeft, item.hours));
      if (alloc > 0) {
        await insertEntry({ mold_id, part_id: item.part_id, machine_id, dateISO, hours: alloc, createdBy, isPriority });
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
      current = { mold_id: r.mold_id, isPriority: Boolean(r.is_priority), items: [{ part_id: r.part_id, hours: Number(r.hours_planned || 0) }] };
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
      current = { mold_id: r.mold_id, isPriority: Boolean(r.is_priority), items: [{ part_id: r.part_id, hours: Number(r.hours_planned || 0) }] };
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

    const { moldName, startDate, tasks } = req.body;
    if (!moldName || !startDate) return res.status(400).json({ error: 'moldName y startDate son requeridos' });
    if (!Array.isArray(tasks) || tasks.length === 0) return res.status(400).json({ error: 'Debe enviar tasks' });

    const rawStart = (startDate || '').trim();
    const startLocal = parseLocalISO(rawStart);
    if (!rawStart || isNaN(startLocal.getTime())) return res.status(400).json({ error: 'startDate inválida (YYYY-MM-DD)' });

    const { holidaySet, overrideMap } = await getWorkingMeta();
    const today = todayLocal();

    if (localISO(startLocal) < localISO(today)) return res.status(400).json({ error: 'No se puede planificar en fechas pasadas' });
    if (!isWorkingDayLocal(startLocal, holidaySet, overrideMap)) return res.status(400).json({ error: 'La fecha seleccionada no es laborable' });

    const mold_id = await getOrCreateMoldId(moldName);

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

    // Restricción: en planificación normal, el startDate debe estar libre por máquina.
    // Excepción: se permite compartir SOLO si ese día es el ÚLTIMO del bloque existente
    // y queda capacidad (la misma regla del planificador).
    for (const [machineName] of byMachine.entries()) {
      const { id: machine_id, daily_capacity } = await getOrCreateMachineByName(machineName);
      const cap = daily_capacity != null ? Number(daily_capacity) : 8;

      const dateISO = localISO(startLocal);
      const { used, moldIds } = await getDayUsage(machine_id, dateISO);
      const capLeft = round025(cap - used);

      if (used === 0) continue;

      let allowed = false;
      if (moldIds.length === 1 && capLeft > 0) {
        const lastDay = await isLastDayOfBlock(machine_id, moldIds[0], dateISO, holidaySet, overrideMap);
        if (lastDay) allowed = true;
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
        machine_id,
        capPerDay: cap,
        baseDateISO: localISO(startLocal),
        tasksQueue: items,
        createdBy,
        holidaySet,
        overrideMap,
        allowShareLastDay: true,
        isPriority: false
      });

      results.push({ machineName, machine_id, startDate: localISO(startLocal), endDate: lastDay, capacityPerDay: cap });
    }

    res.status(201).json({ message: 'Plan en bloque creado (no mezcla)', results });
  } catch (e) { next(e); }
};

// Planificación con PRIORIDAD (GLOBAL, bloques sin mezcla)
// Mueve TODO lo que había desde baseDate en TODAS las máquinas, coloca primero el bloque prioritario
exports.planPriority = async (req, res, next) => {
  try {
    const createdBy = getRequestUserId(req);
    if (!createdBy) return res.status(403).json({ error: 'Usuario no válido para crear planificación' });

    const { moldName, startDate, tasks } = req.body;
    if (!moldName) return res.status(400).json({ error: 'moldName es requerido' });
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

    const mold_id = await getOrCreateMoldId(moldName);

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

    // Descubre TODAS las máquinas con plan desde baseISO
    const existingMachineRows = await query(`SELECT DISTINCT machine_id FROM plan_entries WHERE date >= ?`, [baseISO]);
    const allMachineIds = new Set(existingMachineRows.map(r => r.machine_id));
    // Asegurar incluir las máquinas del payload aunque no tuvieran planes
    for (const { id } of machineMap.values()) allMachineIds.add(id);
    console.log('[planPriority] machinesAffected=', [...allMachineIds]);

    // Captura bloques existentes por máquina y borra TODO desde baseISO
    const existingBlocksByMachine = new Map();
    for (const machine_id of allMachineIds) {
      const blocks = await getExistingBlocksFrom(machine_id, baseISO, holidaySet, overrideMap);
      existingBlocksByMachine.set(machine_id, blocks);
      await query(`DELETE FROM plan_entries WHERE machine_id = ? AND date >= ?`, [machine_id, baseISO]);
    }

    // Coloca primero los BLOQUES PRIORITARIOS
    const cursorByMachine = new Map(); // machine_id -> Date local
    let globalPriorityEnd = null; // Date local (max end across machines)
    for (const [machineName, items] of priorityByMachineName.entries()) {
      const { id: machine_id, cap } = machineMap.get(machineName);
      const endPriority = await placeBlockNoPreempt({
        mold_id,
        machine_id,
        capPerDay: cap,
        baseDateISO: baseISO,
        tasksQueue: items,
        createdBy,
        holidaySet,
        overrideMap,
        // En prioridad: no compartir día con otros moldes (evita "mezcla")
        allowShareLastDay: false,
        isPriority: true
      });
      console.log('[planPriority] priorityEnd', { machineName, machine_id, endDate: endPriority });

      const endDateLocal = parseLocalISO(endPriority);
      if (!globalPriorityEnd || endDateLocal.getTime() > globalPriorityEnd.getTime()) {
        globalPriorityEnd = endDateLocal;
      }

      // Cursor provisional (se sobrescribe luego por fin global)
      cursorByMachine.set(machine_id, endDateLocal);
    }

    // Prioridad GLOBAL: todo lo existente arranca después del fin global de prioridad
    if (!globalPriorityEnd) globalPriorityEnd = parseLocalISO(baseISO);
    const globalStartForExisting = nextWorkingDayLocal(globalPriorityEnd, holidaySet, overrideMap);
    console.log('[planPriority] globalPriorityEnd=', localISO(globalPriorityEnd), 'globalStartExisting=', localISO(globalStartForExisting));

    // Para máquinas sin prioridad, cursor = baseISO
    for (const machine_id of allMachineIds) {
      // Todas las máquinas (con o sin prioridad) reubican lo existente desde el fin global
      cursorByMachine.set(machine_id, new Date(globalStartForExisting.getFullYear(), globalStartForExisting.getMonth(), globalStartForExisting.getDate()));
    }

    // Recoloca BLOQUES EXISTENTES, encadenados
    for (const machine_id of allMachineIds) {
      let cap = 8;
      const fromMap = [...machineMap.values()].find(m => m.id === machine_id);
      if (fromMap) {
        cap = fromMap.cap;
      } else {
        const capRow = await query(`SELECT daily_capacity FROM machines WHERE id = ?`, [machine_id]);
        cap = capRow.length && capRow[0].daily_capacity != null ? Number(capRow[0].daily_capacity) : 8;
      }

      const blocks = existingBlocksByMachine.get(machine_id) || [];
      let cursor = cursorByMachine.get(machine_id);

      for (const blk of blocks) {
        const lastDay = await placeBlockNoPreempt({
          mold_id: blk.mold_id,
          machine_id,
          capPerDay: cap,
          baseDateISO: localISO(cursor),
          tasksQueue: blk.items,
          createdBy,
          holidaySet,
          overrideMap,
          // En prioridad: recolocación estricta sin compartir días
          allowShareLastDay: false,
          isPriority: Boolean(blk.isPriority)
        });
        cursor = nextWorkingDayLocal(parseLocalISO(lastDay), holidaySet, overrideMap);
      }
      cursorByMachine.set(machine_id, cursor);
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

    const rangeRows = await query(
      `SELECT to_char(MIN(date), 'YYYY-MM-DD') AS startDate,
              to_char(MAX(date), 'YYYY-MM-DD') AS endDate
       FROM plan_entries
       WHERE mold_id = ?`,
      [moldId]
    );
    const startDate = rangeRows[0]?.startDate || null;
    const endDate = rangeRows[0]?.endDate || null;

    const entries = await query(
      `SELECT
          p.id AS entryId,
          to_char(p.date, 'YYYY-MM-DD') AS date,
          p.hours_planned AS hours,
          ma.id AS machineId,
          ma.name AS machine,
          mp.id AS partId,
          mp.name AS part
       FROM plan_entries p
       JOIN machines ma ON p.machine_id = ma.id
       JOIN mold_parts mp ON p.part_id = mp.id
       WHERE p.mold_id = ?
       ORDER BY p.date ASC, ma.name ASC, p.id ASC`,
      [moldId]
    );

    res.json({
      moldId,
      moldName: moldRows[0].name,
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

exports.updatePlanEntry = async (req, res, next) => {
  try {
    const entryId = Number.parseInt(String(req.params.entryId), 10);
    if (!Number.isFinite(entryId) || entryId <= 0) return res.status(400).json({ error: 'entryId inválido' });

    const newDateISO = toStr(req.body?.date);
    const newMachineName = toStr(req.body?.machineName);

    if (!isValidISODateString(newDateISO)) return res.status(400).json({ error: 'date inválida (YYYY-MM-DD)' });
    if (!newMachineName) return res.status(400).json({ error: 'machineName requerido' });

    const entryRows = await query(
      `SELECT id, mold_id, machine_id, to_char(date,'YYYY-MM-DD') AS date_str, hours_planned
       FROM plan_entries WHERE id = ? LIMIT 1`,
      [entryId]
    );
    if (!entryRows.length) return res.status(404).json({ error: 'Entrada no encontrada' });
    const entry = entryRows[0];

    const { holidaySet, overrideMap } = await getWorkingMeta();

    const today = todayLocal();
    const newLocal = parseLocalISO(newDateISO);
    if (localISO(newLocal) < localISO(today)) return res.status(400).json({ error: 'No se puede mover a fechas pasadas' });
    if (!isWorkingDayLocal(newLocal, holidaySet, overrideMap)) return res.status(400).json({ error: 'La fecha seleccionada no es laborable' });

    const { id: targetMachineId, daily_capacity } = await getOrCreateMachineByName(newMachineName);
    const cap = daily_capacity != null ? Number(daily_capacity) : 8;

    const hours = round025(Number(entry.hours_planned || 0));
    if (hours <= 0) return res.status(400).json({ error: 'Horas inválidas para esta entrada' });

    // Capacidad y no-mezcla en el destino
    const { used, moldIds } = await getDayUsageExcludingEntry(targetMachineId, newDateISO, entryId);
    const capLeft = round025(cap - used);
    if (capLeft + 1e-9 < hours) {
      return res.status(400).json({ error: `No hay capacidad en ${newDateISO} para "${newMachineName}" (capacidad disponible: ${capLeft}h)` });
    }

    // Reglas de mezcla: permitir solo si día vacío, mismo molde, o (única excepción) último día del bloque anterior
    const otherMolds = moldIds.filter(mid => mid !== entry.mold_id);
    if (otherMolds.length > 0) {
      // Si hay más de un molde diferente presente, no permitir
      const uniq = Array.from(new Set(otherMolds));
      if (uniq.length > 1) {
        return res.status(400).json({ error: `No se puede mover: ${newDateISO} ya tiene múltiples moldes en "${newMachineName}"` });
      }
      // Si hay un solo molde diferente, permitir solo si es último día de ese bloque
      const ok = await isLastDayOfBlock(targetMachineId, uniq[0], newDateISO, holidaySet, overrideMap);
      if (!ok) {
        return res.status(400).json({ error: `No se puede mover: ${newDateISO} ya está ocupado por otro molde en "${newMachineName}"` });
      }
    }

    await query('UPDATE plan_entries SET date = ?, machine_id = ? WHERE id = ?', [newDateISO, targetMachineId, entryId]);
    res.json({ message: 'Entrada actualizada', entryId, date: newDateISO, machineName: mapMachineAlias(newMachineName) });
  } catch (e) {
    next(e);
  }
};

exports.movePlanEntryToNextAvailable = async (req, res, next) => {
  try {
    const entryId = Number.parseInt(String(req.params.entryId), 10);
    if (!Number.isFinite(entryId) || entryId <= 0) return res.status(400).json({ error: 'entryId inválido' });

    const requestedBaseDateISO = toStr(req.body?.baseDate);
    const requestedMachineName = toStr(req.body?.machineName);

    if (requestedBaseDateISO && !isValidISODateString(requestedBaseDateISO)) {
      return res.status(400).json({ error: 'baseDate inválida (YYYY-MM-DD)' });
    }

    const entryRows = await query(
      `SELECT id, mold_id, machine_id, to_char(date,'YYYY-MM-DD') AS date_str, hours_planned
       FROM plan_entries WHERE id = ? LIMIT 1`,
      [entryId]
    );
    if (!entryRows.length) return res.status(404).json({ error: 'Entrada no encontrada' });
    const entry = entryRows[0];

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
    if (baseISO < todayISO) baseISO = todayISO;

    let baseLocal = await firstWorkingOnOrAfter(baseISO, holidaySet, overrideMap);
    let cursor = nextWorkingDayLocal(baseLocal, holidaySet, overrideMap);

    const MAX_DAYS_SCAN = 370;
    let foundISO = null;

    for (let i = 0; i < MAX_DAYS_SCAN; i++) {
      const dateISO = localISO(cursor);

      // Capacidad y no-mezcla en el destino
      const { used, moldIds } = await getDayUsageExcludingEntry(targetMachineId, dateISO, entryId);
      const capLeft = round025(cap - used);
      if (capLeft + 1e-9 >= hours) {
        // Reglas de mezcla: permitir solo si día vacío, mismo molde, o (excepción) último día del bloque anterior
        const otherMolds = moldIds.filter(mid => mid !== entry.mold_id);
        let mixingOk = true;
        if (otherMolds.length > 0) {
          const uniq = Array.from(new Set(otherMolds));
          if (uniq.length > 1) {
            mixingOk = false;
          } else {
            const ok = await isLastDayOfBlock(targetMachineId, uniq[0], dateISO, holidaySet, overrideMap);
            mixingOk = !!ok;
          }
        }
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
    res.json({ message: 'Movido al siguiente disponible', entryId, date: foundISO, machineName: targetMachineName });
  } catch (e) {
    next(e);
  }
};
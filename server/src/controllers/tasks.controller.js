const { query } = require('../config/database');

/* =========================================
   Utilidades de fecha (LOCAL, no UTC)
   ========================================= */
function localISO(d) {
  // Devuelve YYYY-MM-DD en zona horaria local
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

/* =========================================
   Laborabilidad (Lun-Vie, excluye festivos,
   respeta overrides)
   ========================================= */
async function getWorkingMeta() {
  const holidays = await query('SELECT date FROM holidays'); // DATE
  const overrides = await query('SELECT date, is_working FROM working_overrides'); // DATE, tinyint
  const holidaySet = new Set(holidays.map(h => localISO(new Date(h.date))));
  const overrideMap = new Map(overrides.map(o => [localISO(new Date(o.date)), o.is_working ? 1 : 0]));
  return { holidaySet, overrideMap };
}
function isWorkingDayLocal(d, holidaySet, overrideMap) {
  const iso = localISO(d);
  const dow = d.getDay(); // 0=Dom, 6=Sáb
  let working = !(dow === 0 || dow === 6);
  if (holidaySet.has(iso)) working = false;
  if (overrideMap.has(iso)) working = overrideMap.get(iso) === 1;
  return working;
}
function nextWorkingDayLocal(d, holidaySet, overrideMap) {
  let cur = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  do {
    cur = addDays(cur, 1);
  } while (!isWorkingDayLocal(cur, holidaySet, overrideMap));
  return cur;
}
async function firstWorkingOnOrAfter(dateISO, holidaySet, overrideMap) {
  let d = dateISO ? new Date(dateISO) : todayLocal();
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
  const n = toStr(name); if (!n) throw new Error('Nombre de máquina requerido');
  const ex = await query('SELECT id, daily_capacity FROM machines WHERE LOWER(name)=LOWER(?) LIMIT 1', [n]);
  if (ex.length) return { id: ex[0].id, daily_capacity: ex[0].daily_capacity };
  const r = await query('INSERT INTO machines (name, is_active) VALUES (?, TRUE)', [n]);
  return { id: r.insertId, daily_capacity: null };
}

/* =========================================
   Primitivas de Scheduling
   ========================================= */
// Inserta "alloc" horas ese día (redondeado a 0.25)
async function insertEntry({ mold_id, part_id, machine_id, dateISO, hours, createdBy }) {
  if (createdBy != null) {
    await query(
      `INSERT INTO plan_entries (mold_id, part_id, machine_id, date, hours_planned, created_by)
       VALUES (?,?,?,?,?,?)`,
      [mold_id, part_id, machine_id, dateISO, round025(hours), createdBy]
    );
  } else {
    await query(
      `INSERT INTO plan_entries (mold_id, part_id, machine_id, date, hours_planned)
       VALUES (?,?,?,?,?)`,
      [mold_id, part_id, machine_id, dateISO, round025(hours)]
    );
  }
}

// Uso del día para una máquina y moldes que ocupan ese día
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

// ¿Es el último día del bloque de ese molde?
async function isLastDayOfBlock(machine_id, mold_id, dateISO, holidaySet, overrideMap) {
  const cur = new Date(dateISO);
  const next = nextWorkingDayLocal(cur, holidaySet, overrideMap);
  const rows = await query(
    `SELECT 1 FROM plan_entries WHERE machine_id = ? AND date = ? AND mold_id = ? LIMIT 1`,
    [machine_id, localISO(next), mold_id]
  );
  return rows.length === 0;
}

// Coloca un bloque "tasksQueue" (partes y horas) sin mezclar con otros moldes.
// Permite compartir solo el ÚLTIMO día de un bloque anterior si hay capacidad sobrante.
async function placeBlockNoPreempt({
  mold_id,
  machine_id,
  capPerDay,
  baseDateISO,
  tasksQueue,
  createdBy,
  holidaySet,
  overrideMap
}) {
  let cursor = new Date(baseDateISO);
  let lastPlannedDate = null; // 🔥 CLAVE

  while (!isWorkingDayLocal(cursor, holidaySet, overrideMap)) {
    cursor = addDays(cursor, 1);
  }

  const queue = tasksQueue
    .map(t => ({ part_id: t.part_id, hours: round025(t.hours) }))
    .filter(t => t.hours > 0);

  while (queue.length > 0) {
    while (!isWorkingDayLocal(cursor, holidaySet, overrideMap)) {
      cursor = addDays(cursor, 1);
    }

    const dateISO = localISO(cursor);
    const { used, moldIds } = await getDayUsage(machine_id, dateISO);

    let capLeft = round025((capPerDay ?? 8) - used);
    if (capLeft < 0) capLeft = 0;

    let canUseToday = false;

    if (used === 0 && capLeft > 0) {
      canUseToday = true;
    } else if (moldIds.length === 1 && capLeft > 0) {
      const existingMoldId = moldIds[0];
      const lastDay = await isLastDayOfBlock(
        machine_id,
        existingMoldId,
        dateISO,
        holidaySet,
        overrideMap
      );
      if (lastDay) canUseToday = true;
    }

    if (!canUseToday) {
      cursor = addDays(cursor, 1);
      continue;
    }

    let plannedSomethingToday = false;

    while (capLeft > 0 && queue.length > 0) {
      const item = queue[0];
      const alloc = round025(Math.min(capLeft, item.hours));

      if (alloc > 0) {
        await insertEntry({
          mold_id,
          part_id: item.part_id,
          machine_id,
          dateISO,
          hours: alloc,
          createdBy
        });

        item.hours = round025(item.hours - alloc);
        capLeft = round025(capLeft - alloc);
        plannedSomethingToday = true;
      }

      if (item.hours <= 0.000001) {
        queue.shift();
      }
    }

    if (plannedSomethingToday) {
      lastPlannedDate = dateISO; // ✅ SOLO cuando hubo planificación real
    }

    cursor = addDays(cursor, 1);
  }

  // 🔥 GARANTÍA ABSOLUTA
  return lastPlannedDate ?? baseDateISO;
}


// Bloques existentes desde baseDate, preservando orden original (por molde)
async function getExistingBlocksFrom(machine_id, baseDateISO, holidaySet, overrideMap) {
  const rows = await query(
    `SELECT date, mold_id, part_id, hours_planned
     FROM plan_entries
     WHERE machine_id = ? AND date >= ?
     ORDER BY date ASC, id ASC`,
    [machine_id, baseDateISO]
  );

  const blocks = [];
  let current = null;
  let lastDate = null;

  for (const r of rows) {
    const d = new Date(r.date);
    if (!current) {
      current = { mold_id: r.mold_id, items: [{ part_id: r.part_id, hours: Number(r.hours_planned || 0) }] };
      lastDate = d;
      continue;
    }
    const nextExpected = nextWorkingDayLocal(lastDate, holidaySet, overrideMap);
    const sameMold = current.mold_id === r.mold_id;
    const contiguous = localISO(d) === localISO(nextExpected) || localISO(d) === localISO(lastDate);
    if (sameMold && contiguous) {
      current.items.push({ part_id: r.part_id, hours: Number(r.hours_planned || 0) });
      lastDate = d;
    } else {
      blocks.push(current);
      current = { mold_id: r.mold_id, items: [{ part_id: r.part_id, hours: Number(r.hours_planned || 0) }] };
      lastDate = d;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

/* =========================================
   Endpoints
   ========================================= */

exports.planBlock = async (req, res, next) => {
  try {
    console.log('===== PLAN BLOCK =====');

    const createdBy = getRequestUserId(req);
    if (!createdBy) {
      console.log('❌ Usuario inválido');
      return res.status(403).json({ error: 'Usuario no válido para crear planificación' });
    }

    const { moldName, startDate, tasks } = req.body;

    console.log('moldName:', moldName);
    console.log('startDate RAW:', startDate);
    console.log('tasks length:', tasks?.length);

    if (!moldName || !startDate) {
      return res.status(400).json({ error: 'moldName y startDate son requeridos' });
    }

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: 'Debe enviar tasks' });
    }

    // ===============================
    // PARSEO CORRECTO DE FECHA LOCAL
    // ===============================
    const rawStart = (startDate || '').trim();
    if (!rawStart) {
      return res.status(400).json({ error: 'startDate inválida (YYYY-MM-DD)' });
    }

    const [y, m, d] = rawStart.split('-').map(Number);
    const startLocal = new Date(y, m - 1, d);

    if (isNaN(startLocal.getTime())) {
      return res.status(400).json({ error: 'startDate inválida (YYYY-MM-DD)' });
    }

    const today = todayLocal();

    if (localISO(startLocal) < localISO(today)) {
      return res.status(400).json({ error: 'No se puede planificar en fechas pasadas' });
    }

    const { holidaySet, overrideMap } = await getWorkingMeta();

    if (!isWorkingDayLocal(startLocal, holidaySet, overrideMap)) {
      console.log('❌ NO LABORABLE');
      return res.status(400).json({ error: 'La fecha seleccionada no es laborable' });
    }

    console.log('✔ Fecha válida');

    const mold_id = await getOrCreateMoldId(moldName);

    // ===============================
    // AGRUPAR TASKS POR MÁQUINA
    // ===============================
    const byMachine = new Map();

    for (const t of tasks) {
      const partName = toStr(t?.partName);
      const machineName = toStr(t?.machineName);
      const hours = round025(parseFloat(t?.totalHours));

      if (!partName || !machineName || isNaN(hours) || hours <= 0) continue;

      const part_id = await getOrCreatePartId(partName);
      const arr = byMachine.get(machineName) || [];
      arr.push({ part_id, hours });
      byMachine.set(machineName, arr);
    }

    if (byMachine.size === 0) {
      return res.status(400).json({ error: 'No hay tareas válidas' });
    }

    // ===============================
    // PLANIFICACIÓN
    // ===============================
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
        overrideMap
      });

      results.push({
        machineName,
        machine_id,
        startDate: localISO(startLocal),
        endDate: lastDay,
        capacityPerDay: cap
      });
    }

    console.log('✔ PLANIFICACIÓN OK');

    res.status(201).json({
      message: 'Plan en bloque creado (no mezcla)',
      results
    });

  } catch (e) {
    console.error('❌ ERROR PLAN BLOCK', e);
    next(e);
  }
};


// 2) Planificación con PRIORIDAD en bloque (preempt)
// Body: { moldName, startDate (opcional), tasks: [{ partName, machineName, totalHours }, ...] }
exports.planPriority = async (req, res, next) => {
  try {
    const createdBy = getRequestUserId(req);
    if (!createdBy) return res.status(403).json({ error: 'Usuario no válido para crear planificación' });

    const { moldName, startDate, tasks } = req.body;
    if (!moldName) return res.status(400).json({ error: 'moldName es requerido' });
    if (!Array.isArray(tasks) || tasks.length === 0) return res.status(400).json({ error: 'Debe enviar tasks' });

    const { holidaySet, overrideMap } = await getWorkingMeta();

    // Base date (normaliza local y valida)
    let base;
    if (startDate) {
      const rawStart = (startDate || '').trim();
      const [y, m, d] = rawStart.split('-').map(Number);
      const dLocal = new Date(y, m - 1, d);

      if (isNaN(dLocal.getTime())) {
        return res.status(400).json({ error: 'startDate inválida (YYYY-MM-DD)' });
      }

      const today = todayLocal();

      if (localISO(dLocal) < localISO(today)) {
        return res.status(400).json({ error: 'No se puede planificar en fechas pasadas' });
      }
      base = dLocal;
    } else {
      base = await firstWorkingOnOrAfter(localISO(todayLocal()), holidaySet, overrideMap);
    }

    const mold_id = await getOrCreateMoldId(moldName);

    // Agrupa tareas por máquina y resuelve parts
    const byMachine = new Map();
    for (const t of tasks) {
      const partName = toStr(t?.partName);
      const machineName = toStr(t?.machineName);
      const hours = round025(parseFloat(t?.totalHours));
      if (!partName || !machineName || isNaN(hours) || hours <= 0) continue;
      const part_id = await getOrCreatePartId(partName);
      const arr = byMachine.get(machineName) || [];
      arr.push({ part_id, hours });
      byMachine.set(machineName, arr);
    }
    if (byMachine.size === 0) return res.status(400).json({ error: 'No hay tareas válidas' });

    const summary = [];

    // Por máquina: borrar desde baseDate, colocar bloque prioritario, luego recolocar bloques existentes completos
    for (const [machineName, items] of byMachine.entries()) {
      const { id: machine_id, daily_capacity } = await getOrCreateMachineByName(machineName);
      const cap = daily_capacity != null ? Number(daily_capacity) : 8;
      const baseISO = localISO(base);

      // Capturar bloques existentes desde baseISO
      const existingBlocks = await getExistingBlocksFrom(machine_id, baseISO, holidaySet, overrideMap);

      // Limpiar desde baseISO
      await query(`DELETE FROM plan_entries WHERE machine_id = ? AND date >= ?`, [machine_id, baseISO]);

      // 1) Colocar BLOQUE PRIORITARIO primero
      const endPriority = await placeBlockNoPreempt({
        mold_id,
        machine_id,
        capPerDay: cap,
        baseDateISO: baseISO,
        tasksQueue: items,
        createdBy,
        holidaySet,
        overrideMap
      });

      // 2) Recolocar BLOQUES EXISTENTES, encadenándolos (permitiendo iniciar el mismo día si hay capacidad)
      let cursor = new Date(endPriority);
      for (const blk of existingBlocks) {
        const lastDay = await placeBlockNoPreempt({
          mold_id: blk.mold_id,
          machine_id,
          capPerDay: cap,
          baseDateISO: localISO(cursor),
          tasksQueue: blk.items,
          createdBy,
          holidaySet,
          overrideMap
        });
        cursor = new Date(lastDay);
      }

      summary.push({
        machineName,
        machine_id,
        baseDate: baseISO,
        endPriority,
        movedBlocks: existingBlocks.length,
        capacityPerDay: cap
      });
    }

    res.json({ message: 'Planificación prioritaria aplicada (bloques, sin mezcla)', baseDate: localISO(base), summary });
  } catch (e) { next(e); }
};
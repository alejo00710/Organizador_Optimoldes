const { query } = require('../config/database');

function round2(n) {
    const x = Number(n || 0);
    return Math.round(x * 100) / 100;
}

function getColombiaTodayISO() {
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

function isFiniteNumber(n) {
    return typeof n === 'number' && Number.isFinite(n);
}

function isValidISODateString(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function parseYMQuery(req) {
    const y = req.query?.year != null ? Number.parseInt(String(req.query.year), 10) : null;
    const m = req.query?.month != null ? Number.parseInt(String(req.query.month), 10) : null;
    if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
    if (!Number.isInteger(m) || m < 1 || m > 12) return null;
    return { year: y, month: m, ymPrefix: `${y}-${pad2(m)}` };
}

function parseBoolQuery(v) {
    if (v == null) return false;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

function parsePlanningIdQuery(req) {
    const raw = req?.query?.planning_id;
    if (raw == null || String(raw).trim() === '') return null;
    const id = Number.parseInt(String(raw), 10);
    return Number.isFinite(id) && id > 0 ? id : NaN;
}

async function getActivePlanningMetaForMold(moldId, asOfISO = null) {
    const refDate = (asOfISO && /^\d{4}-\d{2}-\d{2}$/.test(String(asOfISO))) ? String(asOfISO) : null;
    const rows = await query(
        `SELECT
             id,
             to_char(to_start_date, 'YYYY-MM-DD') AS "startDate"
         FROM planning_history
         WHERE mold_id = ?
           AND event_type = 'PLANNED'
           ${refDate ? 'AND (to_start_date IS NULL OR to_start_date <= ?)' : ''}
         ORDER BY to_start_date DESC NULLS LAST, created_at DESC, id DESC
         LIMIT 1`,
        refDate ? [moldId, refDate] : [moldId]
    );

    if (!rows?.length) return { planningId: null, startDate: null };
    const id = Number(rows[0].id);
    return {
        planningId: Number.isFinite(id) ? id : null,
        startDate: rows[0].startDate || null,
    };
}

function buildWorkLogScopeSql({ alias, moldId, planningId, startDate }) {
    if (planningId) {
        return {
            clause: ` AND ${alias}.planning_id = ?`,
            params: [planningId],
        };
    }

    // Sin planning_id activo/resuelto: no mezclar registros de otros ciclos.
    return {
        clause: ' AND 1=0 ',
        params: [],
    };
}

function buildPlanEntriesScopeSql({ alias, startDate, nextStartDate, planningCreatedAt, nextPlanningCreatedAt }) {
    const a = alias || 'p';
    if (planningCreatedAt) {
        // Los plan_entries suelen insertarse segundos antes de registrar planning_history.
        // Toleramos una ventana corta hacia atrás para no perder el primer bloque del ciclo.
        if (nextPlanningCreatedAt) {
            return {
                clause: ` AND ${a}.created_at >= (?::timestamptz - interval '30 minutes') AND ${a}.created_at < ?::timestamptz `,
                params: [planningCreatedAt, nextPlanningCreatedAt],
            };
        }
        return {
            clause: ` AND ${a}.created_at >= (?::timestamptz - interval '30 minutes') `,
            params: [planningCreatedAt],
        };
    }

    if (!startDate) return { clause: '', params: [] };
    if (nextStartDate) {
        return {
            clause: ` AND ${a}.date >= ? AND ${a}.date < ? `,
            params: [startDate, nextStartDate],
        };
    }
    return {
        clause: ` AND ${a}.date >= ? `,
        params: [startDate],
    };
}

async function getProgressPlanningMetaForMold(moldId, { requestedPlanningId = null, asOfISO = null } = {}) {
    const refDate = (asOfISO && /^\d{4}-\d{2}-\d{2}$/.test(String(asOfISO))) ? String(asOfISO) : null;

    let rows;
    if (requestedPlanningId) {
        rows = await query(
            `SELECT
                 id,
                 to_char(to_start_date, 'YYYY-MM-DD') AS "startDate",
                 created_at AS "createdAt"
             FROM planning_history
             WHERE mold_id = ?
               AND id = ?
               AND event_type = 'PLANNED'
             LIMIT 1`,
            [moldId, requestedPlanningId]
        );
    } else {
        rows = await query(
            `SELECT
                 id,
                 to_char(to_start_date, 'YYYY-MM-DD') AS "startDate",
                 created_at AS "createdAt"
             FROM planning_history
             WHERE mold_id = ?
               AND event_type = 'PLANNED'
               ${refDate ? "AND (to_start_date IS NULL OR to_start_date <= ?) AND (created_at AT TIME ZONE 'America/Bogota')::date <= ?" : ''}
             ORDER BY to_start_date DESC NULLS LAST, created_at DESC, id DESC
             LIMIT 1`,
            refDate ? [moldId, refDate, refDate] : [moldId]
        );
    }

    if (!rows?.length) {
        return {
            planningId: null,
            startDate: null,
            nextStartDate: null,
            planningCreatedAt: null,
            nextPlanningCreatedAt: null,
        };
    }

    const planningId = Number(rows[0].id);
    const startDate = rows[0].startDate || null;
    const planningCreatedAt = rows[0].createdAt || null;

    let nextStartDate = null;
    let nextPlanningCreatedAt = null;
    if (planningCreatedAt) {
        const nextRows = await query(
            `SELECT
                 to_char(to_start_date, 'YYYY-MM-DD') AS "nextStartDate",
                 created_at AS "nextCreatedAt"
             FROM planning_history
             WHERE mold_id = ?
               AND event_type = 'PLANNED'
               AND created_at > ?
             ORDER BY created_at ASC, id ASC
             LIMIT 1`,
            [moldId, planningCreatedAt]
        );
        nextStartDate = nextRows?.[0]?.nextStartDate || null;
        nextPlanningCreatedAt = nextRows?.[0]?.nextCreatedAt || null;
    }

    return {
        planningId: Number.isFinite(planningId) ? planningId : null,
        startDate,
        nextStartDate,
        planningCreatedAt,
        nextPlanningCreatedAt,
    };
}

function normalizeRange(startDate, endDate) {
    return {
        startDate: startDate || null,
        endDate: endDate || null,
    };
}

function mapHistoryEventLabel(eventType) {
    const code = String(eventType || '').trim().toUpperCase();
    if (code === 'PLANNED') return 'Plan inicial';
    if (code === 'REPROGRAMMED') return 'Reprogramación';
    if (code === 'MOVED') return 'Movimiento';
    if (code === 'MOVED_BULK') return 'Movimiento masivo';
    if (code === 'DELETED') return 'Plan eliminado';
    if (code === 'COMPLETED') return 'Molde terminado';
    return code || 'Evento';
}

async function getPlanningHistory(moldId, { currentRange = null, completionDate = null, includeCompletion = false } = {}) {
    const rows = await query(
        `SELECT
             id,
             event_type AS "eventType",
             to_char(from_start_date, 'YYYY-MM-DD') AS "fromStartDate",
             to_char(from_end_date, 'YYYY-MM-DD') AS "fromEndDate",
             to_char(to_start_date, 'YYYY-MM-DD') AS "toStartDate",
             to_char(to_end_date, 'YYYY-MM-DD') AS "toEndDate",
             note,
             to_char(created_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS "eventDate",
             to_char(created_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI:SS') AS "eventAt"
         FROM planning_history
         WHERE mold_id = ?
         ORDER BY created_at ASC, id ASC`,
        [moldId]
    );

    const timeline = (rows || []).map(r => ({
        id: Number(r.id),
        eventType: String(r.eventType || '').toUpperCase(),
        label: mapHistoryEventLabel(r.eventType),
        eventDate: r.eventDate || null,
        eventAt: r.eventAt || null,
        from: normalizeRange(r.fromStartDate, r.fromEndDate),
        to: normalizeRange(r.toStartDate, r.toEndDate),
        note: r.note || null,
    }));

    if (!timeline.length && currentRange && (currentRange.startDate || currentRange.endDate)) {
        timeline.push({
            id: null,
            eventType: 'PLANNED',
            label: mapHistoryEventLabel('PLANNED'),
            eventDate: currentRange.startDate || currentRange.endDate || null,
            eventAt: null,
            from: normalizeRange(null, null),
            to: normalizeRange(currentRange.startDate, currentRange.endDate),
            note: 'Plan registrado (sin historial detallado previo).',
        });
    }

    if (includeCompletion && completionDate) {
        const hasCompletion = timeline.some(e => e.eventType === 'COMPLETED');
        if (!hasCompletion) {
            timeline.push({
                id: null,
                eventType: 'COMPLETED',
                label: mapHistoryEventLabel('COMPLETED'),
                eventDate: completionDate,
                eventAt: null,
                from: normalizeRange(null, null),
                to: normalizeRange(null, null),
                note: 'Molde finalizado según último registro de trabajo.',
            });
        }
    }

    return timeline;
}

async function getMoldProgressBreakdown(moldId, { asOfISO = null, dayISO = null, planningId = null } = {}) {
    const useDayFilter = !!dayISO;
    const planningMeta = await getProgressPlanningMetaForMold(moldId, {
        requestedPlanningId: planningId,
        asOfISO: asOfISO || dayISO || getColombiaTodayISO(),
    });
    const wlScope = buildWorkLogScopeSql({
        alias: 'wl',
        moldId,
        planningId: planningMeta.planningId,
        startDate: planningMeta.startDate,
    });
    const planScope = buildPlanEntriesScopeSql({
        alias: 'p',
        startDate: planningMeta.startDate,
        nextStartDate: planningMeta.nextStartDate,
        planningCreatedAt: planningMeta.planningCreatedAt,
        nextPlanningCreatedAt: planningMeta.nextPlanningCreatedAt,
    });

    // Planned hours per part+machine
    const plannedRows = await query(
        `SELECT
           p.part_id AS "partId",
           mp.name AS "partName",
           p.machine_id AS "machineId",
           ma.name AS "machineName",
           SUM(p.hours_planned) AS "plannedHours"
         FROM plan_entries p
         JOIN mold_parts mp ON p.part_id = mp.id
         JOIN machines ma ON p.machine_id = ma.id
         WHERE p.mold_id = ?
                     ${planScope.clause}
           ${useDayFilter ? 'AND p.date = ?' : ''}
         GROUP BY p.part_id, mp.name, p.machine_id, ma.name
         ORDER BY mp.name ASC, ma.name ASC`,
                useDayFilter ? [moldId, ...planScope.params, dayISO] : [moldId, ...planScope.params]
    );

    // Actual hours per part+machine: sin cortar por created_at del plan.
    // Se cuenta sobre combinaciones parte+máquina del plan vigente para no perder progreso al reprogramar.
    const actualRows = await query(
        `SELECT
             wl.part_id AS "partId",
             wl.machine_id AS "machineId",
             SUM(wl.hours_worked) AS "actualHours"
         FROM work_logs wl
         JOIN (
             SELECT DISTINCT part_id, machine_id
             FROM plan_entries p
             WHERE p.mold_id = ?
                             ${planScope.clause}
         ) pp ON pp.part_id = wl.part_id AND pp.machine_id = wl.machine_id
         WHERE wl.mold_id = ?
                     ${wlScope.clause}
           AND (?::date IS NULL OR COALESCE(wl.work_date, wl.recorded_at::date) <= ?::date)
         GROUP BY wl.part_id, wl.machine_id`,
                                [moldId, ...planScope.params, moldId, ...wlScope.params, asOfISO, asOfISO]
    );

    const actualMap = new Map();
    for (const r of actualRows || []) {
        const key = `${String(r.partId)}:${String(r.machineId)}`;
        actualMap.set(key, Number(r.actualHours || 0));
    }

    // Final logs per part+machine: cierre manual (is_final_log = true) en el ciclo activo
    const finalLogRows = await query(
        `SELECT DISTINCT wl.part_id AS "partId", wl.machine_id AS "machineId"
         FROM work_logs wl
         WHERE wl.mold_id = ? AND wl.is_final_log = TRUE
           ${wlScope.clause}`,
        [moldId, ...wlScope.params]
    );
    const finalLogSet = new Set(finalLogRows.map(r => `${String(r.partId)}:${String(r.machineId)}`));

    const partsMap = new Map();
    let plannedTotalHours = 0;
    let actualTotalHours = 0;

    for (const r of plannedRows || []) {
        const partId = Number(r.partId);
        const machineId = Number(r.machineId);
        const plannedHours = Number(r.plannedHours || 0);
        const actualHours = Number(actualMap.get(`${String(partId)}:${String(machineId)}`) || 0);

        plannedTotalHours += plannedHours;
        actualTotalHours += actualHours;

        const partKey = String(partId);
        if (!partsMap.has(partKey)) {
            partsMap.set(partKey, {
                partId,
                partName: String(r.partName || ''),
                plannedHoursTotal: 0,
                actualHoursTotal: 0,
                percentComplete: null,
                isComplete: false,
                machines: []
            });
        }

        const machineIsComplete = finalLogSet.has(`${String(partId)}:${String(machineId)}`);
        const isOverrun = !machineIsComplete && plannedHours > 0 && actualHours > (plannedHours + 0.01);
        const machinePct = plannedHours > 0 ? (actualHours / plannedHours) * 100 : null;

        const part = partsMap.get(partKey);
        part.plannedHoursTotal += plannedHours;
        part.actualHoursTotal += actualHours;
        part.machines.push({
            machineId,
            machineName: String(r.machineName || ''),
            plannedHours: round2(plannedHours),
            actualHours: round2(actualHours),
            percentComplete: machinePct == null ? null : round2(machinePct),
            isComplete: !!machineIsComplete,
            isOverrun: !!isOverrun,
        });
    }

    const parts = Array.from(partsMap.values()).map(p => {
        const pct = p.plannedHoursTotal > 0 ? (p.actualHoursTotal / p.plannedHoursTotal) * 100 : null;
        return {
            partId: p.partId,
            partName: p.partName,
            plannedHoursTotal: round2(p.plannedHoursTotal),
            actualHoursTotal: round2(p.actualHoursTotal),
            percentComplete: pct == null ? null : round2(pct),
            machines: p.machines,
        };
    });

    const totalPartsWithPlan = parts.length;
    const totalCellsWithPlan = parts.reduce((acc, p) => acc + (Array.isArray(p.machines) ? p.machines.length : 0), 0);
    const completedCells = parts.reduce((acc, p) => acc + (Array.isArray(p.machines) ? p.machines.filter(m => m && m.isComplete).length : 0), 0);

    return {
        totals: {
            plannedTotalHours: round2(plannedTotalHours),
            actualTotalHours: round2(actualTotalHours),
            percentComplete: plannedTotalHours > 0 ? round2((actualTotalHours / plannedTotalHours) * 100) : null,
            totalPartsWithPlan,
            totalCellsWithPlan,
            completedCells,
            percentCellsComplete: totalCellsWithPlan > 0 ? round2((completedCells / totalCellsWithPlan) * 100) : null,
        },
        parts,
    };
}

function getAsOfISO(req) {
    const asOfRaw = req?.query?.asOf;
    if (asOfRaw == null) return null;
    const asOf = String(asOfRaw).trim();
    return isValidISODateString(asOf) ? asOf : null;
}

// --- Controladores para MOLDES ---
const createMold = async (req, res, next) => {
    try {
        const { name } = req.body; // Recibe 'name'
        if (!name) return res.status(400).json({ error: 'El campo "name" es requerido.' });
        
        const sql = 'INSERT INTO molds (name) VALUES (?)'; // Inserta 'name'
        const result = await query(sql, [name]);
        res.status(201).json({ id: result.insertId, name });
    } catch (error) {
        next(error);
    }
};

const getMolds = async (req, res, next) => {
    try {
        const molds = await query('SELECT * FROM molds WHERE is_active = TRUE ORDER BY name');
        res.json(molds);
    } catch (error) {
        next(error);
    }
};

// --- Controladores para PARTES ---
const createPart = async (req, res, next) => {
    try {
        const { name } = req.body; // Recibe 'name'
        if (!name) return res.status(400).json({ error: 'El campo "name" es requerido.' });
        
        const sql = 'INSERT INTO mold_parts (name) VALUES (?)'; // Inserta 'name'
        const result = await query(sql, [name]);
        res.status(201).json({ id: result.insertId, name });
    } catch (error) {
        next(error);
    }
};

const getParts = async (req, res, next) => {
    try {
        const parts = await query('SELECT * FROM mold_parts WHERE is_active = TRUE ORDER BY name');
        res.json(parts);
    } catch (error) {
        next(error);
    }
};

// --- Avance Plan vs Real por Molde ---
// GET /api/molds/:moldId/progress
const getMoldProgress = async (req, res, next) => {
    try {
        const moldId = Number(req.params.moldId);
        if (!Number.isInteger(moldId) || moldId <= 0) {
            return res.status(400).json({ error: 'moldId inválido' });
        }

        const includeParts = parseBoolQuery(req.query.includeParts);

        const asOfISO = getAsOfISO(req);
        if (req.query.asOf != null && !asOfISO) {
            return res.status(400).json({ error: 'asOf inválido (use YYYY-MM-DD)' });
        }

        const dayISO = req.query?.day != null ? String(req.query.day).trim() : null;
        if (dayISO && !isValidISODateString(dayISO)) {
            return res.status(400).json({ error: 'day inválido (use YYYY-MM-DD)' });
        }

        const requestedPlanningId = parsePlanningIdQuery(req);
        if (Number.isNaN(requestedPlanningId)) {
            return res.status(400).json({ error: 'planning_id inválido (entero positivo)' });
        }

        const todayISO = asOfISO || getColombiaTodayISO();
        if (!todayISO) {
            return res.status(500).json({ error: 'No se pudo determinar la fecha de hoy (America/Bogota)' });
        }

        const moldRows = await query('SELECT id, name FROM molds WHERE id = ? AND is_active = TRUE LIMIT 1', [moldId]);
        if (!moldRows.length) {
            return res.status(404).json({ error: 'Molde no encontrado' });
        }
        const moldName = moldRows[0].name;

        const planningMeta = await getProgressPlanningMetaForMold(moldId, {
            requestedPlanningId,
            asOfISO: todayISO,
        });

        if (requestedPlanningId && !planningMeta.planningId) {
            return res.status(404).json({ error: 'planning_id no encontrado para este molde' });
        }

        const planScope = buildPlanEntriesScopeSql({
            alias: 'p',
            startDate: planningMeta.startDate,
            nextStartDate: planningMeta.nextStartDate,
            planningCreatedAt: planningMeta.planningCreatedAt,
            nextPlanningCreatedAt: planningMeta.nextPlanningCreatedAt,
        });

        const plannedRows = await query(
            `SELECT
                 to_char(MIN(date), 'YYYY-MM-DD') AS "startDate",
                 to_char(MAX(date), 'YYYY-MM-DD') AS "endDate",
                 SUM(hours_planned) AS "plannedTotal",
                 SUM(CASE WHEN date <= ? THEN hours_planned ELSE 0 END) AS "plannedToDate"
             FROM plan_entries p
             WHERE p.mold_id = ?
               ${planScope.clause}`,
            [todayISO, moldId, ...planScope.params]
        );
        const planned = plannedRows[0] || {};
        const wlScope = buildWorkLogScopeSql({
            alias: 'wl',
            moldId,
            planningId: planningMeta.planningId,
            startDate: planningMeta.startDate,
        });

        const actualRows = await query(
            `WITH plan_pairs AS (
                 SELECT DISTINCT part_id, machine_id
                                 FROM plan_entries p
                                 WHERE p.mold_id = ?
                                     ${planScope.clause}
             )
             SELECT
                 SUM(wl.hours_worked) AS "actualTotal",
                 SUM(CASE WHEN COALESCE(wl.work_date, wl.recorded_at::date) <= ? THEN wl.hours_worked ELSE 0 END) AS "actualToDate",
                 to_char(MAX(COALESCE(wl.work_date, wl.recorded_at::date)), 'YYYY-MM-DD') AS "lastWorkDate"
             FROM work_logs wl
             JOIN plan_pairs pp ON pp.part_id = wl.part_id AND pp.machine_id = wl.machine_id
             WHERE wl.mold_id = ?
               ${wlScope.clause}`,
                        [moldId, ...planScope.params, todayISO, moldId, ...wlScope.params]
        );
        const actual = actualRows[0] || {};

        const plannedTotal = Number(planned.plannedTotal || 0);
        const plannedToDate = Number(planned.plannedToDate || 0);
        const actualTotal = Number(actual.actualTotal || 0);
        const actualToDate = Number(actual.actualToDate || 0);
        const lastWorkDate = actual.lastWorkDate || null;
        const varianceToDate = actualToDate - plannedToDate;
        const currentRange = {
            startDate: planned.startDate || null,
            endDate: planned.endDate || null,
        };

        const completionRows = await query(
            `WITH plan_pairs AS (
                 SELECT part_id, machine_id, SUM(hours_planned) AS planned_hours
                                 FROM plan_entries p
                                 WHERE p.mold_id = ?
                                     ${planScope.clause}
                 GROUP BY part_id, machine_id
             ),
             final_pairs AS (
                 SELECT DISTINCT wl.part_id, wl.machine_id
                 FROM work_logs wl
                 WHERE wl.mold_id = ?
                   AND wl.is_final_log = TRUE
                   ${wlScope.clause}
             )
             SELECT
                 SUM(CASE WHEN pp.planned_hours > 0 THEN 1 ELSE 0 END) AS planned_pairs,
                 SUM(CASE WHEN pp.planned_hours > 0 AND fp.part_id IS NOT NULL THEN 1 ELSE 0 END) AS closed_pairs
             FROM plan_pairs pp
             LEFT JOIN final_pairs fp ON fp.part_id = pp.part_id AND fp.machine_id = pp.machine_id`,
            [moldId, ...planScope.params, moldId, ...wlScope.params]
        );
        const plannedPairs = Number(completionRows?.[0]?.planned_pairs || 0);
        const closedPairs = Number(completionRows?.[0]?.closed_pairs || 0);
        const isCompleted = plannedPairs > 0 && closedPairs >= plannedPairs;

        // Series diaria (para poder graficar si se desea)
        const plannedDaily = await query(
            `SELECT to_char(date, 'YYYY-MM-DD') AS d, SUM(hours_planned) AS planned
                         FROM plan_entries p
                         WHERE p.mold_id = ?
                             ${planScope.clause}
             GROUP BY date
             ORDER BY date ASC`,
                        [moldId, ...planScope.params]
        );
                const actualDaily = await query(
                    `WITH plan_pairs AS (
                         SELECT DISTINCT part_id, machine_id
                                                 FROM plan_entries p
                                                 WHERE p.mold_id = ?
                                                     ${planScope.clause}
                     )
                     SELECT to_char(COALESCE(wl.work_date, wl.recorded_at::date), 'YYYY-MM-DD') AS d, SUM(wl.hours_worked) AS actual
                     FROM work_logs wl
                     JOIN plan_pairs pp ON pp.part_id = wl.part_id AND pp.machine_id = wl.machine_id
                     WHERE wl.mold_id = ?
                                     ${wlScope.clause}
                     GROUP BY COALESCE(wl.work_date, wl.recorded_at::date)
                     ORDER BY COALESCE(wl.work_date, wl.recorded_at::date) ASC`,
                                                                [moldId, ...planScope.params, moldId, ...wlScope.params]
                );

        const byDate = new Map();
        for (const r of plannedDaily) {
            const d = String(r.d);
            if (!byDate.has(d)) byDate.set(d, { date: d, plannedHours: 0, actualHours: 0 });
            byDate.get(d).plannedHours = round2(Number(r.planned || 0));
        }
        for (const r of actualDaily) {
            const d = String(r.d);
            if (!byDate.has(d)) byDate.set(d, { date: d, plannedHours: 0, actualHours: 0 });
            byDate.get(d).actualHours = round2(Number(r.actual || 0));
        }
        const daily = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

        const basePayload = {
            moldId,
            moldName,
            today: todayISO,
            planning: {
                planningId: planningMeta.planningId,
                startDate: currentRange.startDate || planningMeta.startDate,
                nextStartDate: planningMeta.nextStartDate,
            },
            planWindow: currentRange,
            lastWorkDate,
            totals: {
                plannedTotalHours: round2(plannedTotal),
                plannedToDateHours: round2(plannedToDate),
                actualTotalHours: round2(actualTotal),
                actualToDateHours: round2(actualToDate),
                varianceToDateHours: round2(varianceToDate),
                percentComplete: plannedTotal > 0 ? round2((actualTotal / plannedTotal) * 100) : null,
            },
            daily,
            planningHistory: await getPlanningHistory(moldId, {
                currentRange,
                completionDate: lastWorkDate,
                includeCompletion: isCompleted,
            }),
        };

        if (!includeParts) {
            res.json(basePayload);
            return;
        }

        const breakdown = await getMoldProgressBreakdown(moldId, {
            asOfISO: todayISO,
            dayISO,
            planningId: planningMeta.planningId,
        });
        res.json({
            ...basePayload,
            // Vista detallada (calendario/planificador): progreso por parte/máquina.
            breakdown,
        });
    } catch (error) {
        next(error);
    }
};

// GET /api/molds/in-progress
// Devuelve moldes con plan (>0) que aún no han completado sus horas planificadas
const getMoldsInProgress = async (req, res, next) => {
    try {
        const asOfISO = getAsOfISO(req);
        if (req.query.asOf != null && !asOfISO) {
            return res.status(400).json({ error: 'asOf inválido (use YYYY-MM-DD)' });
        }

        const todayISO = asOfISO || getColombiaTodayISO();
        if (!todayISO) {
            return res.status(500).json({ error: 'No se pudo determinar la fecha de hoy (America/Bogota)' });
        }

        // Limit opcional
        let limit = parseInt(req.query.limit ?? '50', 10);
        if (!Number.isInteger(limit) || limit <= 0) limit = 50;
        if (limit > 200) limit = 200;

                                const rows = await query(
                                                `WITH
                                                     plan_meta AS (
                                                         SELECT
                                                             mold_id,
                                                             (SELECT ph.id
                                                              FROM planning_history ph
                                                              WHERE ph.mold_id = plan_entries.mold_id AND ph.event_type = 'PLANNED'
                                                              ORDER BY ph.to_start_date DESC NULLS LAST, ph.created_at DESC, ph.id DESC
                                                              LIMIT 1) AS planning_id,
                                                             COALESCE(
                                                                 (SELECT ph.to_start_date
                                                                  FROM planning_history ph
                                                                  WHERE ph.mold_id = plan_entries.mold_id AND ph.event_type = 'PLANNED'
                                                                  ORDER BY ph.created_at DESC, ph.id DESC
                                                                  LIMIT 1),
                                                                 MIN(date)
                                                             ) AS start_date_db,
                                                             to_char(MIN(date), 'YYYY-MM-DD') AS "startDate",
                                                             to_char(MAX(date), 'YYYY-MM-DD') AS "endDate",
                                                             SUM(hours_planned) AS "plannedTotal",
                                                             SUM(CASE WHEN date <= ? THEN hours_planned ELSE 0 END) AS "plannedToDate"
                                                         FROM plan_entries
                                                         GROUP BY mold_id
                                                     ),
                                                     plan_pm AS (
                                                         SELECT mold_id, part_id, machine_id, SUM(hours_planned) AS planned
                                                         FROM plan_entries
                                                         GROUP BY mold_id, part_id, machine_id
                                                     ),
                                                     wl_totals AS (
                                                         SELECT
                                                             wl.mold_id,
                                                             SUM(wl.hours_worked) AS "actualTotal",
                                                             SUM(CASE WHEN COALESCE(wl.work_date, wl.recorded_at::date) <= ? THEN wl.hours_worked ELSE 0 END) AS "actualToDate"
                                                         FROM work_logs wl
                                                         JOIN plan_pm pp ON pp.mold_id = wl.mold_id AND pp.part_id = wl.part_id AND pp.machine_id = wl.machine_id
                                                         JOIN plan_meta pm ON pm.mold_id = wl.mold_id
                                                         WHERE (
                                                             (pm.planning_id IS NOT NULL AND wl.planning_id = pm.planning_id)
                                                             OR (pm.planning_id IS NOT NULL AND wl.planning_id IS NULL AND COALESCE(wl.work_date, wl.recorded_at::date) >= pm.start_date_db)
                                                             OR (pm.planning_id IS NULL AND COALESCE(wl.work_date, wl.recorded_at::date) >= pm.start_date_db)
                                                         )
                                                         GROUP BY wl.mold_id
                                                     ),
                                                     final_pm AS (
                                                         SELECT DISTINCT wl.mold_id, wl.part_id, wl.machine_id
                                                         FROM work_logs wl
                                                         JOIN plan_pm pp ON pp.mold_id = wl.mold_id AND pp.part_id = wl.part_id AND pp.machine_id = wl.machine_id
                                                         JOIN plan_meta pm ON pm.mold_id = wl.mold_id
                                                         WHERE wl.is_final_log = TRUE
                                                           AND (
                                                             (pm.planning_id IS NOT NULL AND wl.planning_id = pm.planning_id)
                                                             OR (pm.planning_id IS NOT NULL AND wl.planning_id IS NULL AND COALESCE(wl.work_date, wl.recorded_at::date) >= pm.start_date_db)
                                                             OR (pm.planning_id IS NULL AND COALESCE(wl.work_date, wl.recorded_at::date) >= pm.start_date_db)
                                                           )
                                                     ),
                                                     pm_pairs AS (
                                                         SELECT
                                                             p.mold_id,
                                                             p.part_id,
                                                             p.machine_id,
                                                             p.planned,
                                                             (fp.part_id IS NOT NULL) AS machine_complete
                                                         FROM plan_pm p
                                                         LEFT JOIN final_pm fp
                                                             ON fp.mold_id = p.mold_id AND fp.part_id = p.part_id AND fp.machine_id = p.machine_id
                                                         WHERE p.planned > 0
                                                     ),
                                                     part AS (
                                                         SELECT mold_id, part_id, BOOL_AND(machine_complete) AS part_complete
                                                         FROM pm_pairs
                                                         GROUP BY mold_id, part_id
                                                     ),
                                                     pc AS (
                                                         SELECT
                                                             mold_id,
                                                             COUNT(*)::int AS "totalPartsWithPlan",
                                                             SUM(CASE WHEN part_complete THEN 1 ELSE 0 END)::int AS "completedParts"
                                                         FROM part
                                                         GROUP BY mold_id
                                                     )
                                                 SELECT
                                                     mo.id AS "moldId",
                                                     mo.name AS "moldName",
                                                     pm."startDate" AS "startDate",
                                                     pm."endDate" AS "endDate",
                                                     pm."plannedTotal" AS "plannedTotal",
                                                     pm."plannedToDate" AS "plannedToDate",
                                                     wl."actualTotal" AS "actualTotal",
                                                     wl."actualToDate" AS "actualToDate",
                                                     pc."totalPartsWithPlan" AS "totalPartsWithPlan",
                                                     pc."completedParts" AS "completedParts"
                                                 FROM molds mo
                                                 JOIN plan_meta pm ON pm.mold_id = mo.id
                                                 LEFT JOIN wl_totals wl ON wl.mold_id = mo.id
                                                 LEFT JOIN pc ON pc.mold_id = mo.id
                                                 WHERE mo.is_active = TRUE
                                                 ORDER BY (pm."endDate" IS NULL) ASC, pm."endDate" ASC, mo.name ASC`,
                                                [todayISO, todayISO]
                                );

        const molds = (rows || [])
            .map(r => {
                const plannedTotal = Number(r.plannedTotal || 0);
                const plannedToDate = Number(r.plannedToDate || 0);
                const actualTotal = Number(r.actualTotal || 0);
                const actualToDate = Number(r.actualToDate || 0);
                const varianceToDate = actualToDate - plannedToDate;

                const percentComplete = plannedTotal > 0 ? (actualTotal / plannedTotal) * 100 : null;

                return {
                    moldId: r.moldId,
                    moldName: r.moldName,
                    today: todayISO,
                    planWindow: { startDate: r.startDate || null, endDate: r.endDate || null },
                    totals: {
                        plannedTotalHours: round2(plannedTotal),
                        plannedToDateHours: round2(plannedToDate),
                        actualTotalHours: round2(actualTotal),
                        actualToDateHours: round2(actualToDate),
                        varianceToDateHours: round2(varianceToDate),
                        percentComplete: percentComplete == null ? null : round2(percentComplete),
                        totalPartsWithPlan: Number(r.totalPartsWithPlan || 0),
                        completedParts: Number(r.completedParts || 0),
                    },
                };
            })
            // "En curso": tiene pares planificados y al menos uno sigue sin cierre manual (is_final_log)
            .filter(m => {
                const totalParts = Number(m?.totals?.totalPartsWithPlan || 0);
                const completedParts = Number(m?.totals?.completedParts || 0);
                if (!isFiniteNumber(totalParts) || totalParts <= 0) return false;
                return !isFiniteNumber(completedParts) || completedParts < totalParts;
            })
            .slice(0, limit);

        res.json({ today: todayISO, count: molds.length, molds });
    } catch (error) {
        next(error);
    }
};

// GET /api/molds/completed
// Devuelve moldes con plan (>0) que ya completaron sus horas planificadas
const getMoldsCompleted = async (req, res, next) => {
    try {
        const asOfISO = getAsOfISO(req);
        if (req.query.asOf != null && !asOfISO) {
            return res.status(400).json({ error: 'asOf inválido (use YYYY-MM-DD)' });
        }

        const todayISO = asOfISO || getColombiaTodayISO();
        if (!todayISO) {
            return res.status(500).json({ error: 'No se pudo determinar la fecha de hoy (America/Bogota)' });
        }

        // Limit opcional
        let limit = parseInt(req.query.limit ?? '50', 10);
        if (!Number.isInteger(limit) || limit <= 0) limit = 50;
        if (limit > 500) limit = 500;

                                const rows = await query(
                                                `WITH
                                                     plan_meta AS (
                                                         SELECT
                                                             mold_id,
                                                             (SELECT ph.id
                                                              FROM planning_history ph
                                                              WHERE ph.mold_id = plan_entries.mold_id AND ph.event_type = 'PLANNED'
                                                              ORDER BY ph.to_start_date DESC NULLS LAST, ph.created_at DESC, ph.id DESC
                                                              LIMIT 1) AS planning_id,
                                                             COALESCE(
                                                                 (SELECT ph.to_start_date
                                                                  FROM planning_history ph
                                                                  WHERE ph.mold_id = plan_entries.mold_id AND ph.event_type = 'PLANNED'
                                                                  ORDER BY ph.created_at DESC, ph.id DESC
                                                                  LIMIT 1),
                                                                 MIN(date)
                                                             ) AS start_date_db,
                                                             to_char(MIN(date), 'YYYY-MM-DD') AS "startDate",
                                                             to_char(MAX(date), 'YYYY-MM-DD') AS "endDate",
                                                             SUM(hours_planned) AS "plannedTotal",
                                                             SUM(CASE WHEN date <= ? THEN hours_planned ELSE 0 END) AS "plannedToDate"
                                                         FROM plan_entries
                                                         GROUP BY mold_id
                                                     ),
                                                     plan_pm AS (
                                                         SELECT mold_id, part_id, machine_id, SUM(hours_planned) AS planned
                                                         FROM plan_entries
                                                         GROUP BY mold_id, part_id, machine_id
                                                     ),
                                                     wl_totals AS (
                                                         SELECT
                                                             wl.mold_id,
                                                             SUM(wl.hours_worked) AS "actualTotal",
                                                             SUM(CASE WHEN COALESCE(wl.work_date, wl.recorded_at::date) <= ? THEN wl.hours_worked ELSE 0 END) AS "actualToDate",
                                                             to_char(MAX(COALESCE(wl.work_date, wl.recorded_at::date)), 'YYYY-MM-DD') AS "lastWorkDate"
                                                         FROM work_logs wl
                                                         JOIN plan_pm pp ON pp.mold_id = wl.mold_id AND pp.part_id = wl.part_id AND pp.machine_id = wl.machine_id
                                                         JOIN plan_meta pm ON pm.mold_id = wl.mold_id
                                                         WHERE (
                                                             (pm.planning_id IS NOT NULL AND wl.planning_id = pm.planning_id)
                                                             OR (pm.planning_id IS NOT NULL AND wl.planning_id IS NULL AND COALESCE(wl.work_date, wl.recorded_at::date) >= pm.start_date_db)
                                                             OR (pm.planning_id IS NULL AND COALESCE(wl.work_date, wl.recorded_at::date) >= pm.start_date_db)
                                                         )
                                                         GROUP BY wl.mold_id
                                                     ),
                                                     final_pm AS (
                                                         SELECT DISTINCT wl.mold_id, wl.part_id, wl.machine_id
                                                         FROM work_logs wl
                                                         JOIN plan_pm pp ON pp.mold_id = wl.mold_id AND pp.part_id = wl.part_id AND pp.machine_id = wl.machine_id
                                                         JOIN plan_meta pm ON pm.mold_id = wl.mold_id
                                                         WHERE wl.is_final_log = TRUE
                                                           AND (
                                                             (pm.planning_id IS NOT NULL AND wl.planning_id = pm.planning_id)
                                                             OR (pm.planning_id IS NOT NULL AND wl.planning_id IS NULL AND COALESCE(wl.work_date, wl.recorded_at::date) >= pm.start_date_db)
                                                             OR (pm.planning_id IS NULL AND COALESCE(wl.work_date, wl.recorded_at::date) >= pm.start_date_db)
                                                           )
                                                     ),
                                                     pm_pairs AS (
                                                         SELECT
                                                             p.mold_id,
                                                             p.part_id,
                                                             p.machine_id,
                                                             p.planned,
                                                             (fp.part_id IS NOT NULL) AS machine_complete
                                                         FROM plan_pm p
                                                         LEFT JOIN final_pm fp
                                                             ON fp.mold_id = p.mold_id AND fp.part_id = p.part_id AND fp.machine_id = p.machine_id
                                                         WHERE p.planned > 0
                                                     ),
                                                     part AS (
                                                         SELECT mold_id, part_id, BOOL_AND(machine_complete) AS part_complete
                                                         FROM pm_pairs
                                                         GROUP BY mold_id, part_id
                                                     ),
                                                     pc AS (
                                                         SELECT
                                                             mold_id,
                                                             COUNT(*)::int AS "totalPartsWithPlan",
                                                             SUM(CASE WHEN part_complete THEN 1 ELSE 0 END)::int AS "completedParts"
                                                         FROM part
                                                         GROUP BY mold_id
                                                     )
                                                 SELECT
                                                     mo.id AS "moldId",
                                                     mo.name AS "moldName",
                                                     pm."startDate" AS "startDate",
                                                     pm."endDate" AS "endDate",
                                                     pm."plannedTotal" AS "plannedTotal",
                                                     pm."plannedToDate" AS "plannedToDate",
                                                     wl."actualTotal" AS "actualTotal",
                                                     wl."actualToDate" AS "actualToDate",
                                                     wl."lastWorkDate" AS "lastWorkDate",
                                                     pc."totalPartsWithPlan" AS "totalPartsWithPlan",
                                                     pc."completedParts" AS "completedParts"
                                                 FROM molds mo
                                                 JOIN plan_meta pm ON pm.mold_id = mo.id
                                                 LEFT JOIN wl_totals wl ON wl.mold_id = mo.id
                                                 LEFT JOIN pc ON pc.mold_id = mo.id
                                                 WHERE mo.is_active = TRUE
                                                 ORDER BY (wl."lastWorkDate" IS NULL) ASC, wl."lastWorkDate" DESC, mo.name ASC`,
                                                [todayISO, todayISO]
                                );

        let molds = (rows || [])
            .map(r => {
                const plannedTotal = Number(r.plannedTotal || 0);
                const plannedToDate = Number(r.plannedToDate || 0);
                const actualTotal = Number(r.actualTotal || 0);
                const actualToDate = Number(r.actualToDate || 0);
                const varianceToDate = actualToDate - plannedToDate;

                const percentComplete = plannedTotal > 0 ? (actualTotal / plannedTotal) * 100 : null;

                return {
                    moldId: r.moldId,
                    moldName: r.moldName,
                    today: todayISO,
                    planWindow: { startDate: r.startDate || null, endDate: r.endDate || null },
                    lastWorkDate: r.lastWorkDate || null,
                    totals: {
                        plannedTotalHours: round2(plannedTotal),
                        plannedToDateHours: round2(plannedToDate),
                        actualTotalHours: round2(actualTotal),
                        actualToDateHours: round2(actualToDate),
                        varianceToDateHours: round2(varianceToDate),
                        percentComplete: percentComplete == null ? null : round2(percentComplete),
                        totalPartsWithPlan: Number(r.totalPartsWithPlan || 0),
                        completedParts: Number(r.completedParts || 0),
                    },
                };
            })
            // "Terminados": todos los pares del plan tienen cierre manual (is_final_log)
            .filter(m => {
                const totalParts = Number(m?.totals?.totalPartsWithPlan || 0);
                const completedParts = Number(m?.totals?.completedParts || 0);
                if (!isFiniteNumber(totalParts) || totalParts <= 0) return false;
                return isFiniteNumber(completedParts) && completedParts >= totalParts;
            })
            .slice(0, limit);

        // Filtro opcional por mes/año (historial por mes)
        const ym = parseYMQuery(req);
        if (ym) {
            molds = molds.filter(m => {
                const d = String(m?.lastWorkDate || '');
                return d.startsWith(ym.ymPrefix);
            });
        }

        res.json({ today: todayISO, count: molds.length, molds });
    } catch (error) {
        next(error);
    }
};

module.exports = { createMold, getMolds, createPart, getParts, getMoldProgress, getMoldsInProgress, getMoldsCompleted };
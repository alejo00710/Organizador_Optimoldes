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

async function getMoldProgressBreakdown(moldId) {
    // Corte para evitar mezclar históricos: solo contar work_logs desde que se creó el plan actual.
    const planMeta = await query(
        'SELECT MIN(created_at) AS plan_created_at FROM plan_entries WHERE mold_id = ?',
        [moldId]
    );
    const planCreatedAt = planMeta?.[0]?.plan_created_at || null;

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
         GROUP BY p.part_id, mp.name, p.machine_id, ma.name
         ORDER BY mp.name ASC, ma.name ASC`,
        [moldId]
    );

        // Actual hours per part+machine (solo del plan actual)
        const actualRows = await query(
                `SELECT
                     wl.part_id AS "partId",
                     wl.machine_id AS "machineId",
                     SUM(wl.hours_worked) AS "actualHours"
                 FROM work_logs wl
                 WHERE wl.mold_id = ?
                     AND (?::timestamptz IS NULL OR wl.recorded_at >= ?::timestamptz)
                 GROUP BY wl.part_id, wl.machine_id`,
                [moldId, planCreatedAt, planCreatedAt]
        );

    const actualMap = new Map();
    for (const r of actualRows || []) {
        const key = `${String(r.partId)}:${String(r.machineId)}`;
        actualMap.set(key, Number(r.actualHours || 0));
    }

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

        const machineIsComplete = plannedHours > 0 ? (actualHours >= (plannedHours - 0.01)) : false;
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

        const todayISO = asOfISO || getColombiaTodayISO();
        if (!todayISO) {
            return res.status(500).json({ error: 'No se pudo determinar la fecha de hoy (America/Bogota)' });
        }

        const moldRows = await query('SELECT id, name FROM molds WHERE id = ? AND is_active = TRUE LIMIT 1', [moldId]);
        if (!moldRows.length) {
            return res.status(404).json({ error: 'Molde no encontrado' });
        }
        const moldName = moldRows[0].name;

        const plannedRows = await query(
            `SELECT
                 to_char(MIN(date), 'YYYY-MM-DD') AS "startDate",
                 to_char(MAX(date), 'YYYY-MM-DD') AS "endDate",
                 SUM(hours_planned) AS "plannedTotal",
                 SUM(CASE WHEN date <= ? THEN hours_planned ELSE 0 END) AS "plannedToDate",
                 MIN(created_at) AS "planCreatedAt"
             FROM plan_entries
             WHERE mold_id = ?`,
            [todayISO, moldId]
        );
        const planned = plannedRows[0] || {};
        const planCreatedAt = planned.planCreatedAt || null;

                const actualRows = await query(
                        `SELECT
                             SUM(hours_worked) AS "actualTotal",
                             SUM(CASE WHEN COALESCE(work_date, recorded_at::date) <= ? THEN hours_worked ELSE 0 END) AS "actualToDate"
                         FROM work_logs
                         WHERE mold_id = ?
                             AND (?::timestamptz IS NULL OR recorded_at >= ?::timestamptz)`,
                        [todayISO, moldId, planCreatedAt, planCreatedAt]
                );
        const actual = actualRows[0] || {};

        const plannedTotal = Number(planned.plannedTotal || 0);
        const plannedToDate = Number(planned.plannedToDate || 0);
        const actualTotal = Number(actual.actualTotal || 0);
        const actualToDate = Number(actual.actualToDate || 0);
        const varianceToDate = actualToDate - plannedToDate;

        // Series diaria (para poder graficar si se desea)
        const plannedDaily = await query(
            `SELECT to_char(date, 'YYYY-MM-DD') AS d, SUM(hours_planned) AS planned
             FROM plan_entries
             WHERE mold_id = ?
             GROUP BY date
             ORDER BY date ASC`,
            [moldId]
        );
                const actualDaily = await query(
                        `SELECT to_char(COALESCE(work_date, recorded_at::date), 'YYYY-MM-DD') AS d, SUM(hours_worked) AS actual
                         FROM work_logs
                         WHERE mold_id = ?
                             AND (?::timestamptz IS NULL OR recorded_at >= ?::timestamptz)
                         GROUP BY COALESCE(work_date, recorded_at::date)
                         ORDER BY COALESCE(work_date, recorded_at::date) ASC`,
                        [moldId, planCreatedAt, planCreatedAt]
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
            planWindow: {
                startDate: planned.startDate || null,
                endDate: planned.endDate || null,
            },
            totals: {
                plannedTotalHours: round2(plannedTotal),
                plannedToDateHours: round2(plannedToDate),
                actualTotalHours: round2(actualTotal),
                actualToDateHours: round2(actualToDate),
                varianceToDateHours: round2(varianceToDate),
                percentComplete: plannedTotal > 0 ? round2((actualTotal / plannedTotal) * 100) : null,
            },
            daily,
        };

        if (!includeParts) {
            res.json(basePayload);
            return;
        }

        const breakdown = await getMoldProgressBreakdown(moldId);
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
                                                             MIN(created_at) AS plan_created_at,
                                                             to_char(MIN(date), 'YYYY-MM-DD') AS "startDate",
                                                             to_char(MAX(date), 'YYYY-MM-DD') AS "endDate",
                                                             SUM(hours_planned) AS "plannedTotal",
                                                             SUM(CASE WHEN date <= ? THEN hours_planned ELSE 0 END) AS "plannedToDate"
                                                         FROM plan_entries
                                                         GROUP BY mold_id
                                                     ),
                                                     wl_totals AS (
                                                         SELECT
                                                             wl.mold_id,
                                                             SUM(wl.hours_worked) AS "actualTotal",
                                                             SUM(CASE WHEN COALESCE(wl.work_date, wl.recorded_at::date) <= ? THEN wl.hours_worked ELSE 0 END) AS "actualToDate"
                                                         FROM work_logs wl
                                                         JOIN plan_meta pm ON pm.mold_id = wl.mold_id
                                                         WHERE wl.recorded_at >= pm.plan_created_at
                                                         GROUP BY wl.mold_id
                                                     ),
                                                     plan_pm AS (
                                                         SELECT mold_id, part_id, machine_id, SUM(hours_planned) AS planned
                                                         FROM plan_entries
                                                         GROUP BY mold_id, part_id, machine_id
                                                     ),
                                                     actual_pm AS (
                                                         SELECT wl.mold_id, wl.part_id, wl.machine_id, SUM(wl.hours_worked) AS actual
                                                         FROM work_logs wl
                                                         JOIN plan_meta pm ON pm.mold_id = wl.mold_id
                                                         WHERE wl.recorded_at >= pm.plan_created_at
                                                         GROUP BY wl.mold_id, wl.part_id, wl.machine_id
                                                     ),
                                                     pm_pairs AS (
                                                         SELECT
                                                             p.mold_id,
                                                             p.part_id,
                                                             p.machine_id,
                                                             p.planned,
                                                             COALESCE(a.actual, 0) AS actual,
                                                             (COALESCE(a.actual, 0) >= (p.planned - 0.01)) AS machine_complete
                                                         FROM plan_pm p
                                                         LEFT JOIN actual_pm a
                                                             ON a.mold_id = p.mold_id AND a.part_id = p.part_id AND a.machine_id = p.machine_id
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
            // "En curso": planTotal>0 y realTotal < planTotal (tolerancia)
            .filter(m => {
                const planned = Number(m?.totals?.plannedTotalHours || 0);
                const actual = Number(m?.totals?.actualTotalHours || 0);
                if (!isFiniteNumber(planned) || planned <= 0) return false;
                if (!isFiniteNumber(actual)) return true;
                return actual < (planned - 0.01);
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
                                                             MIN(created_at) AS plan_created_at,
                                                             to_char(MIN(date), 'YYYY-MM-DD') AS "startDate",
                                                             to_char(MAX(date), 'YYYY-MM-DD') AS "endDate",
                                                             SUM(hours_planned) AS "plannedTotal",
                                                             SUM(CASE WHEN date <= ? THEN hours_planned ELSE 0 END) AS "plannedToDate"
                                                         FROM plan_entries
                                                         GROUP BY mold_id
                                                     ),
                                                     wl_totals AS (
                                                         SELECT
                                                             wl.mold_id,
                                                             SUM(wl.hours_worked) AS "actualTotal",
                                                             SUM(CASE WHEN COALESCE(wl.work_date, wl.recorded_at::date) <= ? THEN wl.hours_worked ELSE 0 END) AS "actualToDate",
                                                             to_char(MAX(COALESCE(wl.work_date, wl.recorded_at::date)), 'YYYY-MM-DD') AS "lastWorkDate"
                                                         FROM work_logs wl
                                                         JOIN plan_meta pm ON pm.mold_id = wl.mold_id
                                                         WHERE wl.recorded_at >= pm.plan_created_at
                                                         GROUP BY wl.mold_id
                                                     ),
                                                     plan_pm AS (
                                                         SELECT mold_id, part_id, machine_id, SUM(hours_planned) AS planned
                                                         FROM plan_entries
                                                         GROUP BY mold_id, part_id, machine_id
                                                     ),
                                                     actual_pm AS (
                                                         SELECT wl.mold_id, wl.part_id, wl.machine_id, SUM(wl.hours_worked) AS actual
                                                         FROM work_logs wl
                                                         JOIN plan_meta pm ON pm.mold_id = wl.mold_id
                                                         WHERE wl.recorded_at >= pm.plan_created_at
                                                         GROUP BY wl.mold_id, wl.part_id, wl.machine_id
                                                     ),
                                                     pm_pairs AS (
                                                         SELECT
                                                             p.mold_id,
                                                             p.part_id,
                                                             p.machine_id,
                                                             p.planned,
                                                             COALESCE(a.actual, 0) AS actual,
                                                             (COALESCE(a.actual, 0) >= (p.planned - 0.01)) AS machine_complete
                                                         FROM plan_pm p
                                                         LEFT JOIN actual_pm a
                                                             ON a.mold_id = p.mold_id AND a.part_id = p.part_id AND a.machine_id = p.machine_id
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
            // "Terminados": planTotal>0 y realTotal >= planTotal (tolerancia)
            .filter(m => {
                const planned = Number(m?.totals?.plannedTotalHours || 0);
                const actual = Number(m?.totals?.actualTotalHours || 0);
                if (!isFiniteNumber(planned) || planned <= 0) return false;
                if (!isFiniteNumber(actual)) return false;
                return actual >= (planned - 0.01);
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
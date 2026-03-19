const { query } = require('../config/database');
const { getHolidaysForMonth } = require('../services/businessDays.service');

function parseBoolQuery(v) {
    if (v == null) return false;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

const getMonthView = async (req, res, next) => {
    try {
        let { year, month } = req.query;

        // Validaciones básicas
        year = parseInt(year, 10);
        month = parseInt(month, 10);
        if (!year || !month || month < 1 || month > 12) {
            return res.status(400).json({ error: 'Parámetros inválidos. year=YYYY, month=1..12' });
        }

        const startDate = `${year}-${pad2(month)}-01`;
        const lastDay = new Date(year, month, 0).getDate(); // month es 1..12 aquí
        const endDate = `${year}-${pad2(month)}-${pad2(lastDay)}`;

        // Overrides (habilitar/deshabilitar día) para el mes
        const overrideSql = `
            SELECT to_char(date, 'YYYY-MM-DD') AS date_str, is_working
            FROM working_overrides
            WHERE date BETWEEN ? AND ?
        `;
        const overrideRows = await query(overrideSql, [startDate, endDate]).catch(() => []);
        const overrides = {};
        for (const r of overrideRows || []) {
            overrides[r.date_str] = !!r.is_working;
        }

        // 1) Plan: fechas como strings YYYY-MM-DD para evitar TZ
        const planSql = `
            SELECT 
                to_char(p.date, 'YYYY-MM-DD') AS date_str,
                p.id AS entry_id,
                p.hours_planned,
                p.is_priority,
                m.id AS machine_id,
                m.name AS machine_name,
                m.daily_capacity AS machine_capacity,
                mo.id AS mold_id,
                mo.name AS mold_name,
                mp.id AS part_id,
                mp.name AS part_name
            FROM plan_entries p
            JOIN machines m ON p.machine_id = m.id
            JOIN molds mo ON p.mold_id = mo.id
            JOIN mold_parts mp ON p.part_id = mp.id
            WHERE p.date BETWEEN ? AND ?
            ORDER BY p.date, m.name
        `;
        const planRows = await query(planSql, [startDate, endDate]);

        // Por defecto, el calendario debe mostrar todo lo planificado (incluyendo días movidos/ajustados),
        // aunque el molde se marque como completo. Esto preserva el historial de planificación por día.
        //
        // Si se desea el comportamiento anterior (recortar días FUTUROS de moldes completos), usar:
        //   GET /api/calendar/month-view?...&trimCompletedFuture=1
        const trimCompletedFuture = parseBoolQuery(req.query?.trimCompletedFuture);
        const moldIds = Array.from(new Set((planRows || []).map(r => Number(r.mold_id)).filter(n => Number.isFinite(n))));
        let filteredPlanRows = planRows;
        if (trimCompletedFuture && moldIds.length) {
            // plan_total + plan_created_at por molde
            const placeholders = moldIds.map(() => '?').join(',');
            const planMeta = await query(
                `SELECT mold_id, SUM(hours_planned) AS planned_total, MIN(created_at) AS plan_created_at
                 FROM plan_entries
                 WHERE mold_id IN (${placeholders})
                 GROUP BY mold_id`,
                moldIds,
            );

            const metaByMold = new Map();
            for (const r of planMeta || []) {
                metaByMold.set(Number(r.mold_id), {
                    plannedTotal: Number(r.planned_total || 0),
                    planCreatedAt: r.plan_created_at || null,
                });
            }

            const completedIds = new Set();
            // Para evitar N queries, agregamos actual + última fecha trabajada por molde con join a meta
            const actualRows = await query(
                `SELECT 
                    wl.mold_id,
                    SUM(wl.hours_worked) AS actual_total,
                    to_char(MAX(wl.recorded_at), 'YYYY-MM-DD') AS last_work_date
                 FROM work_logs wl
                 JOIN (
                    SELECT mold_id, MIN(created_at) AS plan_created_at
                    FROM plan_entries
                    WHERE mold_id IN (${placeholders})
                    GROUP BY mold_id
                 ) pm ON pm.mold_id = wl.mold_id
                 WHERE wl.recorded_at >= pm.plan_created_at
                 GROUP BY wl.mold_id`,
                moldIds,
            );

            const actualByMold = new Map();
            const lastWorkDateByMold = new Map();
            for (const r of actualRows || []) {
                const mid = Number(r.mold_id);
                actualByMold.set(mid, Number(r.actual_total || 0));
                if (r.last_work_date) lastWorkDateByMold.set(mid, String(r.last_work_date));
            }

            for (const mid of moldIds) {
                const meta = metaByMold.get(mid);
                if (!meta || !(meta.plannedTotal > 0)) continue;
                const actual = Number(actualByMold.get(mid) || 0);
                if (Number.isFinite(actual) && actual >= (meta.plannedTotal - 0.01)) completedIds.add(mid);
            }

            if (completedIds.size) {
                // Para moldes completados: dejar solo las filas planificadas hasta la última fecha real trabajada
                filteredPlanRows = (planRows || []).filter(r => {
                    const mid = Number(r.mold_id);
                    if (!completedIds.has(mid)) return true;
                    const lastWorkDate = lastWorkDateByMold.get(mid);
                    if (!lastWorkDate) return false;
                    return String(r.date_str) <= lastWorkDate;
                });
            }
        }

        // 2) Festivos automáticos + DB combinados desde el servicio en memoria
        const holidays = getHolidaysForMonth(year, month);

        // 3) Agrupar tareas por día
        const eventsByDay = {};
        for (const row of filteredPlanRows) {
            const day = parseInt(row.date_str.slice(8, 10), 10);

            if (!eventsByDay[day]) {
                eventsByDay[day] = {
                    tasks: [],
                    machineUsage: {},
                    machineCapacity: {},
                    hasOverlap: false,
                };
            }

            const hours = parseFloat(row.hours_planned);
            eventsByDay[day].tasks.push({
                entryId: row.entry_id,
                moldId: row.mold_id,
                machineId: row.machine_id,
                partId: row.part_id,
                machine: row.machine_name,
                mold: row.mold_name,
                part: row.part_name,
                hours,
                isPriority: Boolean(row.is_priority),
            });

            if (!eventsByDay[day].machineUsage[row.machine_name]) {
                eventsByDay[day].machineUsage[row.machine_name] = 0;
            }
            eventsByDay[day].machineUsage[row.machine_name] += hours;

            const overlapKey = `__molds_${String(row.machine_name)}`;
            if (!eventsByDay[day][overlapKey]) {
                eventsByDay[day][overlapKey] = new Set();
            }
            eventsByDay[day][overlapKey].add(Number(row.mold_id));
            if (eventsByDay[day][overlapKey].size > 1) {
                eventsByDay[day].hasOverlap = true;
            }

            if (!Object.prototype.hasOwnProperty.call(eventsByDay[day].machineCapacity, row.machine_name)) {
                const cap = row.machine_capacity == null ? null : Number(row.machine_capacity);
                eventsByDay[day].machineCapacity[row.machine_name] = Number.isFinite(cap) ? cap : null;
            }
        }

        for (const key of Object.keys(eventsByDay)) {
            const dayObj = eventsByDay[key];
            for (const innerKey of Object.keys(dayObj || {})) {
                if (innerKey.startsWith('__molds_')) delete dayObj[innerKey];
            }
        }

        res.json({
            events: eventsByDay,
            holidays,
            overrides,
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { getMonthView };
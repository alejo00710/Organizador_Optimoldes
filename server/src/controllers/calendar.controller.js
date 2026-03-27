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

function addOneDayISO(isoDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return null;
    const [y, m, d] = String(isoDate).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + 1);
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function buildFullCalendarEventTitle(row) {
    const mold = String(row?.mold_name || 'Molde');
    const machine = String(row?.machine_name || 'Máquina');
    const hours = Number(row?.total_hours || 0);
    return `${mold} · ${machine} (${hours.toFixed(2)}h)`;
}

function parseYearMonth(req) {
    let { year, month } = req.query;
    year = parseInt(year, 10);
    month = parseInt(month, 10);
    if (!year || !month || month < 1 || month > 12) return null;
    const startDate = `${year}-${pad2(month)}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${pad2(month)}-${pad2(lastDay)}`;
    return { year, month, startDate, endDate };
}

async function getMonthOverrides(startDate, endDate) {
    const rows = await query(
        `SELECT to_char(date, 'YYYY-MM-DD') AS date_str, is_working
         FROM working_overrides
         WHERE date BETWEEN ? AND ?`,
        [startDate, endDate]
    ).catch(() => []);

    const overrides = {};
    for (const r of rows || []) {
        overrides[r.date_str] = !!r.is_working;
    }
    return overrides;
}

async function getCycleStatusByPlanningIds(planningIds) {
    const statusByPlanningId = new Map();
    if (!planningIds.length) return statusByPlanningId;

    const placeholders = planningIds.map(() => '?').join(',');
    const rows = await query(
        `WITH plan_pairs AS (
             SELECT
                 pe.planning_id,
                 pe.part_id,
                 pe.machine_id,
                 SUM(pe.hours_planned) AS planned_hours
             FROM plan_entries pe
             WHERE pe.planning_id IN (${placeholders})
             GROUP BY pe.planning_id, pe.part_id, pe.machine_id
         ),
         final_pairs AS (
             SELECT DISTINCT
                 wl.planning_id,
                 wl.part_id,
                 wl.machine_id
             FROM work_logs wl
             WHERE wl.planning_id IN (${placeholders})
               AND wl.is_final_log = TRUE
         )
         SELECT
             pp.planning_id,
             SUM(CASE WHEN pp.planned_hours > 0 THEN 1 ELSE 0 END) AS planned_pairs,
             SUM(CASE WHEN pp.planned_hours > 0 AND fp.part_id IS NOT NULL THEN 1 ELSE 0 END) AS closed_pairs
         FROM plan_pairs pp
         LEFT JOIN final_pairs fp
           ON fp.planning_id = pp.planning_id
          AND fp.part_id = pp.part_id
          AND fp.machine_id = pp.machine_id
         GROUP BY pp.planning_id`,
        [...planningIds, ...planningIds]
    );

    for (const r of rows || []) {
        const planningId = Number(r.planning_id);
        if (!Number.isFinite(planningId) || planningId <= 0) continue;
        const plannedPairs = Number(r.planned_pairs || 0);
        const closedPairs = Number(r.closed_pairs || 0);
        const status = plannedPairs > 0 && closedPairs >= plannedPairs ? 'completed' : 'pending';
        statusByPlanningId.set(planningId, status);
    }

    return statusByPlanningId;
}

function buildStrictEventsByDay(strictRows, statusByPlanningId) {
    const eventsByDay = {};

    for (const row of strictRows || []) {
        const day = parseInt(String(row.date_str || '').slice(8, 10), 10);
        if (!Number.isInteger(day) || day <= 0) continue;

        if (!eventsByDay[day]) {
            eventsByDay[day] = {
                tasks: [],
                machineUsage: {},
                machineCapacity: {},
                hasOverlap: false,
            };
        }

        const planningId = Number(row.planning_id);
        const moldId = Number(row.mold_id);
        const machineId = Number(row.machine_id);
        const status = statusByPlanningId.get(planningId) || 'pending';
        const hours = Number(row.total_hours || 0);

        eventsByDay[day].tasks.push({
            entryId: `pe:${moldId}:${planningId}:${machineId}:${row.date_str}`,
            moldId,
            planningId,
            machineId,
            machine: String(row.machine_name || ''),
            mold: String(row.mold_name || ''),
            part: row.part_name_sample ? String(row.part_name_sample) : null,
            partCount: Number(row.part_count || 0),
            hours,
            isPriority: Boolean(row.is_priority),
            status,
        });

        if (!eventsByDay[day].machineUsage[row.machine_name]) {
            eventsByDay[day].machineUsage[row.machine_name] = 0;
        }
        eventsByDay[day].machineUsage[row.machine_name] += hours;

        if (!Object.prototype.hasOwnProperty.call(eventsByDay[day].machineCapacity, row.machine_name)) {
            const cap = row.machine_capacity == null ? null : Number(row.machine_capacity);
            eventsByDay[day].machineCapacity[row.machine_name] = Number.isFinite(cap) ? cap : null;
        }

        const overlapKey = `__molds_${String(row.machine_name)}`;
        if (!eventsByDay[day][overlapKey]) {
            eventsByDay[day][overlapKey] = new Set();
        }
        eventsByDay[day][overlapKey].add(moldId);
        if (eventsByDay[day][overlapKey].size > 1) {
            eventsByDay[day].hasOverlap = true;
        }
    }

    for (const key of Object.keys(eventsByDay)) {
        for (const innerKey of Object.keys(eventsByDay[key] || {})) {
            if (innerKey.startsWith('__molds_')) delete eventsByDay[key][innerKey];
        }
    }

    return eventsByDay;
}

function buildStrictFullCalendarPayload(strictRows, statusByPlanningId) {
    const dedup = new Map();

    for (const r of strictRows || []) {
        const planningId = Number(r.planning_id);
        const moldId = Number(r.mold_id);
        const machineId = Number(r.machine_id);
        const dateISO = String(r.date_str || '');
        if (!Number.isFinite(planningId) || planningId <= 0) continue;
        if (!Number.isFinite(moldId) || moldId <= 0) continue;
        if (!Number.isFinite(machineId) || machineId <= 0) continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) continue;

        const status = statusByPlanningId.get(planningId) || 'pending';
        const color = status === 'completed' ? '#16a34a' : '#f59e0b';
        const id = `pe:${moldId}:${planningId}:${machineId}:${dateISO}`;
        if (dedup.has(id)) continue;

        dedup.set(id, {
            id,
            title: buildFullCalendarEventTitle(r),
            start: dateISO,
            end: addOneDayISO(dateISO),
            allDay: true,
            color,
            borderColor: color,
            classNames: ['fc-mold-event', `status-${status}`],
            extendedProps: {
                planningId,
                moldId,
                machineId,
                status,
                mold: String(r.mold_name || ''),
                machine: String(r.machine_name || ''),
                totalHours: Number(r.total_hours || 0),
                partCount: Number(r.part_count || 0),
                isPriority: Boolean(r.is_priority),
            },
        });
    }

    const resources = Array.from(new Map(
        (strictRows || []).map(r => {
            const id = Number(r.machine_id);
            const title = String(r.machine_name || '');
            return [id, { id: String(id), title }];
        })
    ).values()).filter(r => r.id && r.title);

    return {
        source: 'planning_id_strict',
        events: Array.from(dedup.values()),
        resources,
    };
}

const getMonthView = async (req, res, next) => {
    try {
        const parsed = parseYearMonth(req);
        if (!parsed) {
            return res.status(400).json({ error: 'Parámetros inválidos. year=YYYY, month=1..12' });
        }
        const { year, month, startDate, endDate } = parsed;

        const overrides = await getMonthOverrides(startDate, endDate);
        const holidays = getHolidaysForMonth(year, month);

        const strictRows = await query(
            `SELECT
                to_char(p.date, 'YYYY-MM-DD') AS date_str,
                p.planning_id,
                p.mold_id,
                mo.name AS mold_name,
                p.machine_id,
                m.name AS machine_name,
                m.daily_capacity AS machine_capacity,
                SUM(p.hours_planned) AS total_hours,
                COUNT(DISTINCT p.part_id) AS part_count,
                MIN(mp.name) AS part_name_sample,
                BOOL_OR(p.is_priority) AS is_priority
             FROM plan_entries p
             JOIN machines m ON p.machine_id = m.id
             JOIN molds mo ON p.mold_id = mo.id
             JOIN mold_parts mp ON p.part_id = mp.id
             WHERE p.date BETWEEN ? AND ?
               AND p.planning_id IS NOT NULL
             GROUP BY p.date, p.planning_id, p.mold_id, mo.name, p.machine_id, m.name, m.daily_capacity
             ORDER BY p.date ASC, mo.name ASC, m.name ASC`,
            [startDate, endDate]
        );

        const planningIds = Array.from(new Set(
            (strictRows || [])
                .map(r => Number(r.planning_id))
                .filter(n => Number.isFinite(n) && n > 0)
        ));
        const statusByPlanningId = await getCycleStatusByPlanningIds(planningIds);

        const activeRows = (strictRows || []).filter(r => {
            const pid = Number(r?.planning_id);
            if (!Number.isFinite(pid) || pid <= 0) return false;
            const status = statusByPlanningId.get(pid) || 'pending';
            return status !== 'completed';
        });

        const eventsByDay = buildStrictEventsByDay(activeRows, statusByPlanningId);
        const fullCalendar = buildStrictFullCalendarPayload(activeRows, statusByPlanningId);

        res.json({
            events: eventsByDay,
            holidays,
            overrides,
            fullCalendar,
        });
    } catch (error) {
        next(error);
    }
};

// Endpoint aislado para comportamiento legacy híbrido.
const getMonthViewLegacy = async (req, res, next) => {
    try {
        const parsed = parseYearMonth(req);
        if (!parsed) {
            return res.status(400).json({ error: 'Parámetros inválidos. year=YYYY, month=1..12' });
        }
        const { year, month, startDate, endDate } = parsed;

        const overrides = await getMonthOverrides(startDate, endDate);
        const holidays = getHolidaysForMonth(year, month);

        const planRows = await query(
            `SELECT
                to_char(p.date, 'YYYY-MM-DD') AS date_str,
                p.id AS entry_id,
                COALESCE(
                    p.planning_id,
                    (
                        SELECT ph.id
                        FROM planning_history ph
                        WHERE ph.mold_id = p.mold_id
                          AND ph.event_type = 'PLANNED'
                          AND COALESCE(substring(ph.note FROM '(\\d{4}-\\d{2}-\\d{2})')::date, ph.to_start_date) <= p.date
                        ORDER BY COALESCE(substring(ph.note FROM '(\\d{4}-\\d{2}-\\d{2})')::date, ph.to_start_date) DESC NULLS LAST,
                                 ph.created_at DESC,
                                 ph.id DESC
                        LIMIT 1
                    )
                ) AS planning_id,
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
             ORDER BY p.date, m.name`,
            [startDate, endDate]
        );

        const eventsByDay = {};
        for (const row of planRows || []) {
            const day = parseInt(String(row.date_str || '').slice(8, 10), 10);
            if (!Number.isInteger(day) || day <= 0) continue;

            if (!eventsByDay[day]) {
                eventsByDay[day] = {
                    tasks: [],
                    machineUsage: {},
                    machineCapacity: {},
                    hasOverlap: false,
                };
            }

            const hours = Number(row.hours_planned || 0);
            eventsByDay[day].tasks.push({
                entryId: row.entry_id,
                moldId: Number(row.mold_id),
                planningId: row.planning_id != null ? Number(row.planning_id) : null,
                machineId: Number(row.machine_id),
                partId: Number(row.part_id),
                machine: String(row.machine_name || ''),
                mold: String(row.mold_name || ''),
                part: String(row.part_name || ''),
                hours,
                isPriority: Boolean(row.is_priority),
            });

            if (!eventsByDay[day].machineUsage[row.machine_name]) {
                eventsByDay[day].machineUsage[row.machine_name] = 0;
            }
            eventsByDay[day].machineUsage[row.machine_name] += hours;

            if (!Object.prototype.hasOwnProperty.call(eventsByDay[day].machineCapacity, row.machine_name)) {
                const cap = row.machine_capacity == null ? null : Number(row.machine_capacity);
                eventsByDay[day].machineCapacity[row.machine_name] = Number.isFinite(cap) ? cap : null;
            }

            const overlapKey = `__molds_${String(row.machine_name)}`;
            if (!eventsByDay[day][overlapKey]) eventsByDay[day][overlapKey] = new Set();
            eventsByDay[day][overlapKey].add(Number(row.mold_id));
            if (eventsByDay[day][overlapKey].size > 1) eventsByDay[day].hasOverlap = true;
        }

        for (const key of Object.keys(eventsByDay)) {
            for (const innerKey of Object.keys(eventsByDay[key] || {})) {
                if (innerKey.startsWith('__molds_')) delete eventsByDay[key][innerKey];
            }
        }

        res.json({
            events: eventsByDay,
            holidays,
            overrides,
            fullCalendar: {
                source: 'legacy_mixed',
                events: [],
                resources: [],
            },
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { getMonthView, getMonthViewLegacy };
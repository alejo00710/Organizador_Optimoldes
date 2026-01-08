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

        const todayISO = getColombiaTodayISO();
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
                             SUM(CASE WHEN date <= ? THEN hours_planned ELSE 0 END) AS "plannedToDate"
             FROM plan_entries
             WHERE mold_id = ?`,
            [todayISO, moldId]
        );
        const planned = plannedRows[0] || {};

        const actualRows = await query(
            `SELECT
               SUM(hours_worked) AS "actualTotal",
               SUM(CASE WHEN COALESCE(work_date, recorded_at::date) <= ? THEN hours_worked ELSE 0 END) AS "actualToDate"
             FROM work_logs
             WHERE mold_id = ?`,
            [todayISO, moldId]
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
             GROUP BY COALESCE(work_date, recorded_at::date)
             ORDER BY COALESCE(work_date, recorded_at::date) ASC`,
            [moldId]
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

        res.json({
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
        });
    } catch (error) {
        next(error);
    }
};

// GET /api/molds/in-progress
// Devuelve moldes con plan (>0) que aún no han completado sus horas planificadas
const getMoldsInProgress = async (req, res, next) => {
    try {
        const todayISO = getColombiaTodayISO();
        if (!todayISO) {
            return res.status(500).json({ error: 'No se pudo determinar la fecha de hoy (America/Bogota)' });
        }

        // Limit opcional
        let limit = parseInt(req.query.limit ?? '50', 10);
        if (!Number.isInteger(limit) || limit <= 0) limit = 50;
        if (limit > 200) limit = 200;

        const rows = await query(
            `SELECT
                             mo.id AS "moldId",
                             mo.name AS "moldName",
                             pe."startDate" AS "startDate",
                             pe."endDate" AS "endDate",
                             pe."plannedTotal" AS "plannedTotal",
                             pe."plannedToDate" AS "plannedToDate",
                             wl."actualTotal" AS "actualTotal",
                             wl."actualToDate" AS "actualToDate"
             FROM molds mo
             JOIN (
               SELECT
                 mold_id,
                                 to_char(MIN(date), 'YYYY-MM-DD') AS "startDate",
                                 to_char(MAX(date), 'YYYY-MM-DD') AS "endDate",
                                 SUM(hours_planned) AS "plannedTotal",
                                 SUM(CASE WHEN date <= ? THEN hours_planned ELSE 0 END) AS "plannedToDate"
               FROM plan_entries
               GROUP BY mold_id
             ) pe ON pe.mold_id = mo.id
             LEFT JOIN (
               SELECT
                 mold_id,
                                 SUM(hours_worked) AS "actualTotal",
                                 SUM(CASE WHEN COALESCE(work_date, recorded_at::date) <= ? THEN hours_worked ELSE 0 END) AS "actualToDate"
               FROM work_logs
               GROUP BY mold_id
             ) wl ON wl.mold_id = mo.id
             WHERE mo.is_active = TRUE
             ORDER BY (pe."endDate" IS NULL) ASC, pe."endDate" ASC, mo.name ASC`,
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

module.exports = { createMold, getMolds, createPart, getParts, getMoldProgress, getMoldsInProgress };
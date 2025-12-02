const { query } = require('../config/database');
const { getHolidaysForMonth } = require('../services/businessDays.service');

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

        // 1) Plan: fechas como strings YYYY-MM-DD para evitar TZ
        const planSql = `
            SELECT 
                DATE_FORMAT(p.date, '%Y-%m-%d') AS date_str,
                p.hours_planned,
                m.name AS machine_name,
                mo.name AS mold_name,
                mp.name AS part_name
            FROM plan_entries p
            JOIN machines m ON p.machine_id = m.id
            JOIN molds mo ON p.mold_id = mo.id
            JOIN mold_parts mp ON p.part_id = mp.id
            WHERE p.date BETWEEN ? AND ?
            ORDER BY p.date, m.name
        `;
        const planRows = await query(planSql, [startDate, endDate]);

        // 2) Festivos automáticos + DB combinados desde el servicio en memoria
        const holidays = getHolidaysForMonth(year, month);

        // 3) Agrupar tareas por día
        const eventsByDay = {};
        for (const row of planRows) {
            const day = parseInt(row.date_str.slice(8, 10), 10);

            if (!eventsByDay[day]) {
                eventsByDay[day] = {
                    tasks: [],
                    machineUsage: {},
                };
            }

            const hours = parseFloat(row.hours_planned);
            eventsByDay[day].tasks.push({
                machine: row.machine_name,
                mold: row.mold_name,
                part: row.part_name,
                hours,
            });

            if (!eventsByDay[day].machineUsage[row.machine_name]) {
                eventsByDay[day].machineUsage[row.machine_name] = 0;
            }
            eventsByDay[day].machineUsage[row.machine_name] += hours;
        }

        res.json({
            events: eventsByDay,
            holidays,
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { getMonthView };
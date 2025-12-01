const { query } = require('../config/database');
const { getMachineCapacity } = require('../services/scheduler.service');

const getMonthView = async (req, res, next) => {
    try {
        const { year, month } = req.query;
        if (!year || !month) {
            return res.status(400).json({ error: 'Se requieren el año y el mes.' });
        }

        // El mes en JS es 0-11, pero en SQL es 1-12. Asumimos que la entrada es 1-12.
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = new Date(year, month, 0).toISOString().split('T')[0]; // Último día del mes

        const sql = `
            SELECT 
                p.date,
                p.hours_planned,
                m.name AS machine_name,
                mo.name AS mold_name,
                mp.name AS part_name
            FROM plan_entries p
            JOIN machines m ON p.machine_id = m.id
            JOIN molds mo ON p.mold_id = mo.id
            JOIN mold_parts mp ON p.part_id = mp.id
            WHERE p.date BETWEEN ? AND ?
            ORDER BY p.date, m.name;
        `;

        const entries = await query(sql, [startDate, endDate]);

        // Agrupar resultados por día
        const eventsByDay = {};
        for (const entry of entries) {
            const day = new Date(entry.date).getDate() + 1; // Ajuste de zona horaria simple
            if (!eventsByDay[day]) {
                eventsByDay[day] = {
                    tasks: [],
                    machineUsage: {}
                };
            }
            eventsByDay[day].tasks.push({
                machine: entry.machine_name,
                mold: entry.mold_name,
                part: entry.part_name,
                hours: parseFloat(entry.hours_planned)
            });

            // Calcular uso de la máquina
            if (!eventsByDay[day].machineUsage[entry.machine_name]) {
                eventsByDay[day].machineUsage[entry.machine_name] = 0;
            }
            eventsByDay[day].machineUsage[entry.machine_name] += parseFloat(entry.hours_planned);
        }

        res.json(eventsByDay);

    } catch (error) {
        next(error);
    }
};

module.exports = { getMonthView };
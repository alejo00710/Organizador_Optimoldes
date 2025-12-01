const { query } = require('../config/database');

const getMonthView = async (req, res, next) => {
    try {
        const { year, month } = req.query;
        if (!year || !month) {
            return res.status(400).json({ error: 'Se requieren el año y el mes.' });
        }

        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = new Date(year, month, 0).toISOString().split('T')[0];

        // 1. Obtener las entradas de planificación (sin cambios)
        const planSql = `
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
        const entries = await query(planSql, [startDate, endDate]);

        // 2. Obtener los festivos del mes desde la tabla 'holidays'
        const holidaysSql = 'SELECT date, name FROM holidays WHERE date BETWEEN ? AND ?';
        const holidayEntries = await query(holidaysSql, [startDate, endDate]);

        // Formatear festivos en un objeto para fácil acceso: {'YYYY-MM-DD': 'Nombre Festivo'}
        const holidays = holidayEntries.reduce((acc, holiday) => {
            const dateKey = new Date(holiday.date).toISOString().split('T')[0];
            acc[dateKey] = holiday.name;
            return acc;
        }, {});

        // 3. Agrupar las tareas por día (sin cambios)
        const eventsByDay = {};
        for (const entry of entries) {
            // new Date() puede tener problemas de timezone. Usar el string directo es más seguro.
            const dateStr = new Date(entry.date).toISOString().split('T')[0];
            const day = parseInt(dateStr.split('-')[2], 10);
            
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

            if (!eventsByDay[day].machineUsage[entry.machine_name]) {
                eventsByDay[day].machineUsage[entry.machine_name] = 0;
            }
            eventsByDay[day].machineUsage[entry.machine_name] += parseFloat(entry.hours_planned);
        }

        // 4. Enviar la respuesta combinada
        res.json({
            events: eventsByDay,
            holidays: holidays
        });

    } catch (error) {
        next(error);
    }
};

module.exports = { getMonthView };
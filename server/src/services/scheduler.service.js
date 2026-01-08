const { query, getConnection } = require('../config/database');
const businessDaysService = require('./businessDays.service');

// Capacidad diaria estricta: debe existir y ser > 0
const getMachineCapacityFromRow = (machineRow) => {
    const c = machineRow.daily_capacity !== null && machineRow.daily_capacity !== undefined
        ? parseFloat(machineRow.daily_capacity)
        : NaN;
    if (!isNaN(c) && c > 0) return c;
    throw new Error(`La máquina "${machineRow.name}" no tiene capacidad diaria configurada (daily_capacity).`);
};

const getUsedCapacity = async (machineId, dateStr) => {
    const sql = `SELECT COALESCE(SUM(hours_planned), 0) as used FROM plan_entries WHERE machine_id = ? AND date = ?`;
    const result = await query(sql, [machineId, dateStr]);
    return parseFloat(result[0].used);
};

const getMachine = async (machineId) => {
    const sql = 'SELECT * FROM machines WHERE id = ? AND is_active = TRUE';
    const result = await query(sql, [machineId]);
    if (result.length === 0) throw new Error(`Máquina con ID ${machineId} no encontrada o inactiva`);
    return result[0];
};

const scheduleTasks = async (moldId, partId, machineId, startDate, totalHours, createdBy) => {
    const machine = await getMachine(machineId);
    if (totalHours <= 0) throw new Error('totalHours debe ser mayor que 0');

    const machineCapacity = getMachineCapacityFromRow(machine);
    let remainingHours = totalHours;
    const planEntries = [];

    // Fecha de inicio en UTC y avanzar al siguiente día hábil si aplica
    let currentDate = new Date(startDate + 'T00:00:00Z');
    while (!businessDaysService.isBusinessDay(currentDate)) {
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    while (remainingHours > 0) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const usedCapacity = await getUsedCapacity(machineId, dateStr);
        const availableCapacity = Math.max(0, machineCapacity - usedCapacity);

        if (availableCapacity > 0) {
            const hoursToSchedule = Math.min(remainingHours, availableCapacity);
            planEntries.push({
                moldId,
                partId,
                machineId,
                date: new Date(currentDate),
                hoursPlanned: parseFloat(hoursToSchedule.toFixed(2)),
                createdBy
            });
            remainingHours -= hoursToSchedule;
        }

        currentDate = businessDaysService.getNextBusinessDay(currentDate);
    }

    return planEntries;
};

const insertPlanEntries = async (planEntries) => {
    if (planEntries.length === 0) return [];

    const connection = await getConnection();
    try {
        await connection.query('BEGIN');
        const sql = `
            INSERT INTO plan_entries (mold_id, part_id, machine_id, date, hours_planned, created_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
        `;
        const insertedIds = [];
        for (const entry of planEntries) {
            const dateStr = entry.date.toISOString().split('T')[0];
            const res = await connection.query(sql, [
                entry.moldId,
                entry.partId,
                entry.machineId,
                dateStr,
                entry.hoursPlanned,
                entry.createdBy,
            ]);
            insertedIds.push(res.rows?.[0]?.id);
        }
        await connection.query('COMMIT');
        return insertedIds;
    } catch (error) {
        try { await connection.query('ROLLBACK'); } catch (_) {}
        throw error;
    } finally {
        connection.release();
    }
};

const createSchedule = async (moldId, partId, machineId, startDate, totalHours, createdBy) => {
    const planEntries = await scheduleTasks(moldId, partId, machineId, startDate, totalHours, createdBy);
    const insertedIds = await insertPlanEntries(planEntries);

    return {
        totalEntries: planEntries.length,
        totalHoursScheduled: planEntries.reduce((sum, e) => sum + e.hoursPlanned, 0),
        startDate: planEntries[0]?.date.toISOString().split('T')[0],
        endDate: planEntries[planEntries.length - 1]?.date.toISOString().split('T')[0],
        entries: planEntries.map((entry, index) => ({
            id: insertedIds[index],
            date: entry.date.toISOString().split('T')[0],
            hoursPlanned: entry.hoursPlanned
        })),
    };
};

module.exports = {
    getMachineCapacityFromRow,
    getUsedCapacity,
    getMachine,
    scheduleTasks,
    createSchedule
};
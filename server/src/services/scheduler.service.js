const { query, getConnection } = require('../config/database');
const businessDaysService = require('./businessDays.service');
const { SINGLE_OPERATOR_HOURS, MULTI_OPERATOR_HOURS_PER_PERSON } = require('../utils/constants');

const getMachineCapacity = (operariosCount) => {
    return operariosCount === 1 ? SINGLE_OPERATOR_HOURS : operariosCount * MULTI_OPERATOR_HOURS_PER_PERSON;
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

    const machineCapacity = getMachineCapacity(machine.operarios_count);
    let remainingHours = totalHours;
    const planEntries = [];

    // Fecha de inicio en UTC para evitar desplazamientos por TZ
    let currentDate = new Date(startDate + 'T00:00:00Z');

    // Asegurar que la fecha de inicio sea hábil; si no, avanzar
    while (!businessDaysService.isBusinessDay(currentDate)) {
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    while (remainingHours > 0) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const usedCapacity = await getUsedCapacity(machineId, dateStr);
        const availableCapacity = machineCapacity - usedCapacity;

        if (availableCapacity > 0) {
            const hoursToSchedule = Math.min(remainingHours, availableCapacity);
            planEntries.push({
                moldId,
                partId,
                machineId,
                date: new Date(currentDate), // UTC date
                hoursPlanned: parseFloat(hoursToSchedule.toFixed(2)),
                createdBy
            });
            remainingHours -= hoursToSchedule;
        }

        // Avanzar al siguiente día hábil (UTC)
        currentDate = businessDaysService.getNextBusinessDay(currentDate);
    }

    return planEntries;
};

const insertPlanEntries = async (planEntries) => {
    if (planEntries.length === 0) return [];

    const connection = await getConnection();
    try {
        await connection.beginTransaction();
        const sql = `INSERT INTO plan_entries (mold_id, part_id, machine_id, date, hours_planned, created_by) VALUES (?, ?, ?, ?, ?, ?)`;
        const insertedIds = [];
        for (const entry of planEntries) {
            const dateStr = entry.date.toISOString().split('T')[0];
            const [result] = await connection.execute(sql, [entry.moldId, entry.partId, entry.machineId, dateStr, entry.hoursPlanned, entry.createdBy]);
            insertedIds.push(result.insertId);
        }
        await connection.commit();
        return insertedIds;
    } catch (error) {
        await connection.rollback();
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
    getMachineCapacity,
    getUsedCapacity,
    getMachine,
    scheduleTasks,
    createSchedule
};
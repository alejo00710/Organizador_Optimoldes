const { query, getConnection } = require('../config/database');
const businessDaysService = require('./businessDays.service'); // Importamos el servicio optimizado
const { SINGLE_OPERATOR_HOURS, MULTI_OPERATOR_HOURS_PER_PERSON } = require('../utils/constants');

/**
 * Calcula la capacidad diaria total de una máquina basada en su número de operarios.
 * @param {number} operariosCount - Número de operarios asignados a la máquina.
 * @returns {number} - Capacidad de la máquina en horas por día.
 */
const getMachineCapacity = (operariosCount) => {
    return operariosCount === 1 ? SINGLE_OPERATOR_HOURS : operariosCount * MULTI_OPERATOR_HOURS_PER_PERSON;
};

/**
 * Obtiene las horas planificadas ya utilizadas para una máquina en una fecha específica.
 * @param {number} machineId - ID de la máquina.
 * @param {string} dateStr - Fecha en formato 'YYYY-MM-DD'.
 * @returns {Promise<number>} - Horas usadas.
 */
const getUsedCapacity = async (machineId, dateStr) => {
    // Nota: El controller ya valida que startDate viene en formato YYYY-MM-DD
    const sql = `SELECT COALESCE(SUM(hours_planned), 0) as used FROM plan_entries WHERE machine_id = ? AND date = ?`;
    const result = await query(sql, [machineId, dateStr]);
    return parseFloat(result[0].used);
};

/**
 * Obtiene los detalles de una máquina.
 * @param {number} machineId - ID de la máquina.
 * @returns {Promise<object>} - Objeto con los detalles de la máquina.
 */
const getMachine = async (machineId) => {
    const sql = 'SELECT * FROM machines WHERE id = ? AND is_active = TRUE';
    const result = await query(sql, [machineId]);
    if (result.length === 0) throw new Error(`Máquina con ID ${machineId} no encontrada o inactiva`);
    return result[0];
};

/**
 * Lógica central para distribuir las horas a lo largo de los días hábiles.
 * @param {number} moldId - ID del molde.
 * @param {number} partId - ID de la parte.
 * @param {number} machineId - ID de la máquina.
 * @param {string} startDate - Fecha de inicio en formato YYYY-MM-DD.
 * @param {number} totalHours - Total de horas a planificar.
 * @param {number} createdBy - ID del usuario que crea la planificación.
 * @returns {Promise<Array<object>>} - Lista de entradas de planificación.
 */
const scheduleTasks = async (moldId, partId, machineId, startDate, totalHours, createdBy) => {
    const machine = await getMachine(machineId);
    if (totalHours <= 0) throw new Error('totalHours debe ser mayor que 0');

    const machineCapacity = getMachineCapacity(machine.operarios_count);
    let remainingHours = totalHours;
    const planEntries = [];

    // --- LÓGICA DE INICIALIZACIÓN DE FECHA CORREGIDA ---
    // 1. Convertir la fecha de inicio a objeto Date.
    let currentDate = new Date(startDate);
    
    // 2. Asegurar que la fecha de inicio sea un día hábil. Si no lo es, avanza.
    // **CORRECCIÓN CLAVE:** Antes saltaba el día de inicio. Ahora verifica el día y si no es hábil, avanza.
    while (!businessDaysService.isBusinessDay(currentDate)) {
        currentDate.setDate(currentDate.getDate() + 1);
    }
    // --- FIN DE LÓGICA CORREGIDA ---

    while (remainingHours > 0) {
        // Convertir la fecha actual a string para la consulta de capacidad (formato YYYY-MM-DD)
        const dateStr = currentDate.toISOString().split('T')[0];
        
        // Obtener capacidad usada en ese día
        const usedCapacity = await getUsedCapacity(machineId, dateStr);
        
        // Calcular capacidad disponible (usa la capacidad real de la máquina, no un valor fijo)
        const availableCapacity = machineCapacity - usedCapacity;
        
        if (availableCapacity > 0) {
            // Horas a planificar en este día: el mínimo entre lo que queda y lo disponible.
            const hoursToSchedule = Math.min(remainingHours, availableCapacity);
            
            planEntries.push({
                moldId,
                partId,
                machineId,
                date: new Date(currentDate), // Guardar una copia de la fecha
                hoursPlanned: parseFloat(hoursToSchedule.toFixed(2)), // Redondear para evitar errores de coma flotante
                createdBy
            });

            remainingHours -= hoursToSchedule;
        }

        // Avanzar al siguiente día hábil.
        // **CORRECCIÓN CLAVE:** Usamos getNextBusinessDay para saltar fines de semana y festivos.
        currentDate = businessDaysService.getNextBusinessDay(currentDate);
    }
    
    return planEntries;
};

/**
 * Inserta las entradas de planificación en la base de datos usando una transacción.
 * @param {Array<object>} planEntries - Entradas generadas por scheduleTasks.
 * @returns {Promise<Array<number>>} - IDs de las entradas insertadas.
 */
const insertPlanEntries = async (planEntries) => {
    if (planEntries.length === 0) return [];

    const connection = await getConnection();
    try {
        await connection.beginTransaction();
        const sql = `INSERT INTO plan_entries (mold_id, part_id, machine_id, date, hours_planned, created_by) VALUES (?, ?, ?, ?, ?, ?)`;
        const insertedIds = [];
        for (const entry of planEntries) {
            // Aseguramos que la fecha se guarde como YYYY-MM-DD en la DB
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

/**
 * Función principal llamada por el controlador para crear una planificación.
 */
const createSchedule = async (moldId, partId, machineId, startDate, totalHours, createdBy) => {
    const planEntries = await scheduleTasks(moldId, partId, machineId, startDate, totalHours, createdBy);
    const insertedIds = await insertPlanEntries(planEntries);
    
    // Formateo de la respuesta
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
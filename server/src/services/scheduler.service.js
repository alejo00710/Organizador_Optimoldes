const { query, getConnection } = require('../config/database');
const businessDaysService = require('./businessDays.service');
const { 
  SINGLE_OPERATOR_HOURS, 
  MULTI_OPERATOR_HOURS_PER_PERSON 
} = require('../utils/constants');

/**
 * Calcula la capacidad diaria de una máquina
 */
const getMachineCapacity = (operariosCount) => {
  return operariosCount === 1 
    ? SINGLE_OPERATOR_HOURS 
    : operariosCount * MULTI_OPERATOR_HOURS_PER_PERSON;
};

/**
 * Obtiene las horas ya planificadas para una máquina en una fecha específica
 */
const getUsedCapacity = async (machineId, date) => {
  const sql = `
    SELECT COALESCE(SUM(hours_planned), 0) as used
    FROM plan_entries
    WHERE machine_id = ? AND date = ?
  `;
  const dateStr = date.toISOString().split('T')[0];
  const result = await query(sql, [machineId, dateStr]);
  return parseFloat(result[0].used);
};

/**
 * Obtiene información de una máquina
 */
const getMachine = async (machineId) => {
  const sql = 'SELECT * FROM machines WHERE id = ?  AND is_active = TRUE';
  const result = await query(sql, [machineId]);
  if (result.length === 0) {
    throw new Error(`Máquina con ID ${machineId} no encontrada o inactiva`);
  }
  return result[0];
};

/**
 * Valida que molde y parte existan y estén relacionados
 */
const validateMoldAndPart = async (moldId, partId) => {
  const sql = `
    SELECT mp.* FROM mold_parts mp
    JOIN molds m ON mp.mold_id = m.id
    WHERE mp.id = ? AND mp.mold_id = ?  
    AND mp.is_active = TRUE AND m.is_active = TRUE
  `;
  const result = await query(sql, [partId, moldId]);
  if (result.length === 0) {
    throw new Error(`Parte ${partId} no pertenece al molde ${moldId} o está inactiva`);
  }
  return result[0];
};

/**
 * Algoritmo principal de planificación
 * Distribuye totalHours a lo largo de días hábiles respetando capacidad de máquina
 */
const scheduleTasks = async (moldId, partId, machineId, startDate, totalHours, createdBy) => {
  // Validaciones
  await validateMoldAndPart(moldId, partId);
  const machine = await getMachine(machineId);
  
  if (totalHours <= 0) {
    throw new Error('totalHours debe ser mayor que 0');
  }
  
  const machineCapacity = getMachineCapacity(machine.operarios_count);
  let remainingHours = totalHours;
  let currentDate = new Date(startDate);
  
  // Asegurar que empezamos en un día hábil
  if (!(await businessDaysService.isBusinessDay(currentDate))) {
    currentDate = await businessDaysService.getNextBusinessDay(currentDate);
  }
  
  const planEntries = [];
  const maxIterations = 365; // Protección contra bucles infinitos
  let iterations = 0;
  
  while (remainingHours > 0 && iterations < maxIterations) {
    iterations++;
    
    // Obtener capacidad disponible para este día
    const usedCapacity = await getUsedCapacity(machineId, currentDate);
    const availableCapacity = machineCapacity - usedCapacity;
    
    if (availableCapacity > 0) {
      // Asignar lo que se pueda en este día
      const hoursToAssign = Math.min(availableCapacity, remainingHours);
      
      planEntries.push({
        moldId,
        partId,
        machineId,
        date: new Date(currentDate),
        hoursPlanned: hoursToAssign,
        createdBy
      });
      
      remainingHours -= hoursToAssign;
    }
    
    // Avanzar al siguiente día hábil
    if (remainingHours > 0) {
      currentDate = await businessDaysService.getNextBusinessDay(currentDate);
    }
  }
  
  if (remainingHours > 0) {
    throw new Error('No se pudo completar la planificación en un año.  Revise la capacidad de la máquina.');
  }
  
  return planEntries;
};

/**
 * Inserta las entradas de planificación en la base de datos
 */
const insertPlanEntries = async (planEntries) => {
  const connection = await getConnection();
  
  try {
    await connection. beginTransaction();
    
    const sql = `
      INSERT INTO plan_entries 
      (mold_id, part_id, machine_id, date, hours_planned, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    const insertedIds = [];
    
    for (const entry of planEntries) {
      const dateStr = entry.date.toISOString().split('T')[0];
      const [result] = await connection.execute(sql, [
        entry.moldId,
        entry.partId,
        entry.machineId,
        dateStr,
        entry.hoursPlanned,
        entry.createdBy
      ]);
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
 * Función principal que ejecuta la planificación completa
 */
const createSchedule = async (moldId, partId, machineId, startDate, totalHours, createdBy) => {
  // Generar el plan
  const planEntries = await scheduleTasks(
    moldId, 
    partId, 
    machineId, 
    startDate, 
    totalHours, 
    createdBy
  );
  
  // Insertar en la base de datos
  const insertedIds = await insertPlanEntries(planEntries);
  
  // Devolver resumen
  return {
    totalEntries: planEntries.length,
    totalHoursScheduled: planEntries.reduce((sum, e) => sum + e.hoursPlanned, 0),
    startDate: planEntries[0].date,
    endDate: planEntries[planEntries.length - 1].date,
    entries: planEntries. map((entry, index) => ({
      id: insertedIds[index],
      date: entry.date. toISOString().split('T')[0],
      hoursPlanned: entry.hoursPlanned
    }))
  };
};

module.exports = {
  getMachineCapacity,
  getUsedCapacity,
  scheduleTasks,
  insertPlanEntries,
  createSchedule
};
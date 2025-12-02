const { query } = require('../config/database');
const { DEVIATION_THRESHOLD } = require('../utils/constants');

/**
 * Calcula horas planificadas y reales para un molde/parte/máquina en un rango
 */
const getPlannedVsActual = async (filters) => {
    const { moldId, partId, machineId, startDate, endDate } = filters;

    // Construcción robusta de condiciones
    const plannedConds = [];
    const plannedParams = [];
    const actualConds = [];
    const actualParams = [];

    if (moldId) { plannedConds.push('mold_id = ?'); plannedParams.push(moldId); }
    if (partId) { plannedConds.push('part_id = ?'); plannedParams.push(partId); }
    if (machineId) { plannedConds.push('machine_id = ?'); plannedParams.push(machineId); }

    actualConds.push(...plannedConds);
    actualParams.push(...plannedParams);

    if (startDate) { plannedConds.push('date >= ?'); plannedParams.push(startDate); }
    if (endDate) { plannedConds.push('date <= ?'); plannedParams.push(endDate); }

    if (startDate) { actualConds.push('DATE(recorded_at) >= ?'); actualParams.push(startDate); }
    if (endDate) { actualConds.push('DATE(recorded_at) <= ?'); actualParams.push(endDate); }

    const plannedWhere = plannedConds.length ? `WHERE ${plannedConds.join(' AND ')}` : '';
    const actualWhere = actualConds.length ? `WHERE ${actualConds.join(' AND ')}` : '';

    // Horas planificadas
    const plannedSql = `
      SELECT COALESCE(SUM(hours_planned), 0) as total_planned
      FROM plan_entries
      ${plannedWhere}
    `;
    const plannedResult = await query(plannedSql, plannedParams);

    // Horas reales
    const actualSql = `
      SELECT COALESCE(SUM(hours_worked), 0) as total_actual
      FROM work_logs
      ${actualWhere}
    `;
    const actualResult = await query(actualSql, actualParams);

    const planned = parseFloat(plannedResult[0].total_planned);
    const actual = parseFloat(actualResult[0].total_actual);

    return { planned, actual };
};

/**
 * Calcula el porcentaje de desviación y determina si excede el umbral
 */
const calculateDeviation = (planned, actual) => {
    if (planned === 0) {
        return {
            planned,
            actual,
            deviation: actual,
            deviationPercent: actual > 0 ? 100 : 0,
            hasAlert: actual > 0,
        };
    }

    const deviation = actual - planned;
    const deviationPercent = Math.abs(deviation / planned) * 100;
    const hasAlert = Math.abs(deviation / planned) > DEVIATION_THRESHOLD;

    return {
        planned,
        actual,
        deviation,
        deviationPercent: parseFloat(deviationPercent.toFixed(2)),
        hasAlert,
    };
};

/**
 * Obtiene desviaciones por molde/parte/máquina
 */
const getDeviationReport = async (filters) => {
    const { planned, actual } = await getPlannedVsActual(filters);
    return calculateDeviation(planned, actual);
};

/**
 * Obtiene reporte detallado con desviaciones por cada combinación
 */
const getDetailedDeviationReport = async (startDate, endDate) => {
    const sql = `
    SELECT 
      m.id as mold_id,
      m.code as mold_code,
      mp.id as part_id,
      mp.part_number,
      ma.id as machine_id,
      ma.name as machine_name,
      COALESCE(SUM(pe.hours_planned), 0) as total_planned,
      COALESCE(SUM(wl.hours_worked), 0) as total_actual
    FROM molds m
    JOIN mold_parts mp ON mp.mold_id = m.id
    JOIN machines ma ON ma.is_active = TRUE
    LEFT JOIN plan_entries pe 
      ON pe.mold_id = m.id 
      AND pe.part_id = mp.id 
      AND pe.machine_id = ma.id
      ${startDate ? 'AND pe.date >= ?' : ''}
      ${endDate ? 'AND pe.date <= ?' : ''}
    LEFT JOIN work_logs wl 
      ON wl.mold_id = m.id 
      AND wl.part_id = mp.id 
      AND wl.machine_id = ma.id
      ${startDate ? 'AND DATE(wl.recorded_at) >= ?' : ''}
      ${endDate ? 'AND DATE(wl.recorded_at) <= ?' : ''}
    WHERE m.is_active = TRUE 
      AND mp.is_active = TRUE 
      AND ma.is_active = TRUE
    GROUP BY m.id, mp.id, ma.id
    HAVING total_planned > 0 OR total_actual > 0
  `;

    const params = [];
    if (startDate) params.push(startDate);
    if (endDate) params.push(endDate);
    if (startDate) params.push(startDate);
    if (endDate) params.push(endDate);

    const results = await query(sql, params);

    return results.map((row) => {
        const planned = parseFloat(row.total_planned);
        const actual = parseFloat(row.total_actual);
        const deviation = calculateDeviation(planned, actual);

        return {
            mold: {
                id: row.mold_id,
                code: row.mold_code,
            },
            part: {
                id: row.part_id,
                partNumber: row.part_number,
            },
            machine: {
                id: row.machine_id,
                name: row.machine_name,
            },
            ...deviation,
        };
    });
};

module.exports = {
    getPlannedVsActual,
    calculateDeviation,
    getDeviationReport,
    getDetailedDeviationReport,
};
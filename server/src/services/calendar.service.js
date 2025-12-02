const { query } = require('../config/database');

/**
 * Obtiene datos del calendario (plan + real) para un rango de fechas
 */
const getCalendarData = async (startDate, endDate) => {
    // Obtener plan
    const planSql = `
    SELECT 
      pe.id,
      pe.date,
      pe.hours_planned,
      m.id as mold_id,
      m.code as mold_code,
      mp.id as part_id,
      mp.part_number,
      ma.id as machine_id,
      ma.name as machine_name,
      'plan' as type
    FROM plan_entries pe
    JOIN molds m ON pe.mold_id = m.id
    JOIN mold_parts mp ON pe.part_id = mp.id
    JOIN machines ma ON pe.machine_id = ma.id
    WHERE pe.date >= ? AND pe.date <= ?
    ORDER BY pe.date, ma.name
  `;

    const planData = await query(planSql, [startDate, endDate]);

    // Obtener datos reales
    const actualSql = `
    SELECT 
      wl.id,
      DATE(wl.recorded_at) as date,
      wl.hours_worked,
      wl.note,
      m.id as mold_id,
      m.code as mold_code,
      mp.id as part_id,
      mp.part_number,
      ma.id as machine_id,
      ma.name as machine_name,
      o.id as operator_id,
      o.name as operator_name,
      'actual' as type
    FROM work_logs wl
    JOIN molds m ON wl.mold_id = m.id
    JOIN mold_parts mp ON wl.part_id = mp.id
    JOIN machines ma ON wl.machine_id = ma.id
    JOIN operators o ON wl.operator_id = o.id
    WHERE DATE(wl.recorded_at) >= ? AND DATE(wl.recorded_at) <= ?
    ORDER BY wl.recorded_at, ma.name
  `;

    const actualData = await query(actualSql, [startDate, endDate]);

    // Formatear para calendario (compatible con FullCalendar)
    const events = [];

    // Eventos de planificación
    planData.forEach((row) => {
        events.push({
            id: `plan-${row.id}`,
            title: `${row.mold_code} - ${row.part_number} (Plan: ${row.hours_planned}h)`,
            start: row.date,
            allDay: true,
            backgroundColor: '#3788d8',
            extendedProps: {
                type: 'plan',
                moldId: row.mold_id,
                moldCode: row.mold_code,
                partId: row.part_id,
                partNumber: row.part_number,
                machineId: row.machine_id,
                machineName: row.machine_name,
                hours: row.hours_planned,
            },
        });
    });

    // Eventos reales
    actualData.forEach((row) => {
        events.push({
            id: `actual-${row.id}`,
            title: `${row.mold_code} - ${row.part_number} (Real: ${row.hours_worked}h)`,
            start: row.date,
            allDay: true,
            backgroundColor: '#28a745',
            extendedProps: {
                type: 'actual',
                moldId: row.mold_id,
                moldCode: row.mold_code,
                partId: row.part_id,
                partNumber: row.part_number,
                machineId: row.machine_id,
                machineName: row.machine_name,
                operatorId: row.operator_id,
                operatorName: row.operator_name,
                hours: row.hours_worked,
                note: row.note,
            },
        });
    });

    return events;
};

/**
 * Obtiene resumen agregado por día
 */
const getDailySummary = async (startDate, endDate) => {
    const sql = `
    SELECT 
      date,
      machine_id,
      machine_name,
      SUM(planned) as total_planned,
      SUM(actual) as total_actual
    FROM (
      SELECT 
        pe.date,
        pe.machine_id,
        ma.name as machine_name,
        SUM(pe.hours_planned) as planned,
        0 as actual
      FROM plan_entries pe
      JOIN machines ma ON pe.machine_id = ma.id
      WHERE pe.date >= ? AND pe.date <= ?
      GROUP BY pe.date, pe.machine_id
      
      UNION ALL
      
      SELECT 
        DATE(wl.recorded_at) as date,
        wl.machine_id,
        ma.name as machine_name,
        0 as planned,
        SUM(wl.hours_worked) as actual
      FROM work_logs wl
      JOIN machines ma ON wl.machine_id = ma.id
      WHERE DATE(wl.recorded_at) >= ? AND DATE(wl.recorded_at) <= ?
      GROUP BY DATE(wl.recorded_at), wl.machine_id
    ) combined
    GROUP BY date, machine_id
    ORDER BY date, machine_name
  `;

    return await query(sql, [startDate, endDate, startDate, endDate]);
};

module.exports = {
    getCalendarData,
    getDailySummary,
};
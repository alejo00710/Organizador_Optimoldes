const { query } = require('../config/database');

// Utilidad: contar días laborables entre from..to (usa holidays y overrides)
async function countWorkingDays(from, to) {
  const start = new Date(from);
  const end = new Date(to);
  if (isNaN(start) || isNaN(end) || start > end) return 0;

  // Cargar festivos y overrides
  const holidays = await query('SELECT date, name FROM holidays');
  const overrides = await query('SELECT date, is_working FROM working_overrides');

  const holidaySet = new Set(holidays.map(h => h.date.toISOString().split('T')[0]));
  const overrideMap = new Map(overrides.map(o => [o.date.toISOString().split('T')[0], o.is_working ? 1 : 0]));

  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
    const iso = d.toISOString().split('T')[0];
    const dow = d.getDay(); // 0 dom - 6 sab
    let isWorking = !(dow === 0 || dow === 6); // laboral por defecto (lun-vie)
    if (holidaySet.has(iso)) isWorking = false;
    if (overrideMap.has(iso)) isWorking = overrideMap.get(iso) === 1;
    if (isWorking) count++;
  }
  return count;
}

// Expresión SQL para construir la fecha desde datos(dia,mes,anio)
const recordDateExpr = `
  STR_TO_DATE(
    CONCAT(
      anio, '-',
      LPAD(
        CASE LOWER(mes)
          WHEN 'enero' THEN 1 WHEN 'febrero' THEN 2 WHEN 'marzo' THEN 3 WHEN 'abril' THEN 4
          WHEN 'mayo' THEN 5 WHEN 'junio' THEN 6 WHEN 'julio' THEN 7 WHEN 'agosto' THEN 8
          WHEN 'septiembre' THEN 9 WHEN 'setiembre' THEN 9 WHEN 'octubre' THEN 10
          WHEN 'noviembre' THEN 11 WHEN 'diciembre' THEN 12
          ELSE 0 END
      ,2,'0'), '-',
      LPAD(IFNULL(dia,0),2,'0')
    ),
    '%Y-%m-%d'
  )
`;

exports.summary = async (req, res, next) => {
  try {
    const from = req.query.from;
    const to   = req.query.to;
    if (!from || !to) return res.status(400).json({ error:'Parámetros from y to requeridos (YYYY-MM-DD)' });

    // Total horas reales (datos) en rango de fecha (construida)
    const [{ totalActualHours = 0 } = {}] = await query(
      `SELECT SUM(horas) AS totalActualHours
       FROM datos
       WHERE horas IS NOT NULL
         AND ${recordDateExpr} IS NOT NULL
         AND ${recordDateExpr} BETWEEN ? AND ?`,
      [from, to]
    );

    // Total horas planificadas (plan_entries.date)
    const [{ totalPlannedHours = 0 } = {}] = await query(
      `SELECT SUM(hours_planned) AS totalPlannedHours
       FROM plan_entries
       WHERE date BETWEEN ? AND ?`,
      [from, to]
    );

    // Horas reales por máquina
    const hoursByMachine = await query(
      `SELECT d.machine_id,
              COALESCE(m.name, d.maquina) AS machine_name,
              SUM(d.horas) AS actualHours
       FROM datos d
       LEFT JOIN machines m ON d.machine_id = m.id
       WHERE d.horas IS NOT NULL
         AND ${recordDateExpr} IS NOT NULL
         AND ${recordDateExpr} BETWEEN ? AND ?
       GROUP BY d.machine_id, machine_name
       ORDER BY machine_name ASC`,
      [from, to]
    );

    // Cargar máquinas con su capacidad diaria
    const machines = await query(`SELECT id, name, daily_capacity, is_active FROM machines WHERE is_active = TRUE`);

    // Días laborables en rango
    const workingDays = await countWorkingDays(from, to);
    const machineUtilization = hoursByMachine.map(row => {
      const m = machines.find(mm => mm.id === row.machine_id);
      const cap = m && m.daily_capacity != null ? Number(m.daily_capacity) * workingDays : 0;
      const util = cap > 0 ? (Number(row.actualHours) / cap) * 100 : 0;
      return {
        machine_id: row.machine_id || null,
        machine_name: row.machine_name || '',
        actualHours: Number(row.actualHours || 0),
        capacityHours: Number(cap || 0),
        utilizationPct: Number(util || 0)
      };
    });

    // Top moldes por horas reales
    const topMolds = await query(
      `SELECT d.mold_id,
              COALESCE(md.name, d.molde) AS mold_name,
              SUM(d.horas) AS actualHours
       FROM datos d
       LEFT JOIN molds md ON d.mold_id = md.id
       WHERE d.horas IS NOT NULL
         AND ${recordDateExpr} IS NOT NULL
         AND ${recordDateExpr} BETWEEN ? AND ?
       GROUP BY d.mold_id, mold_name
       ORDER BY actualHours DESC
       LIMIT 20`,
      [from, to]
    );

    res.json({
      from, to,
      totalActualHours: Number(totalActualHours || 0),
      totalPlannedHours: Number(totalPlannedHours || 0),
      workingDays,
      machineUtilization,
      topMolds
    });
  } catch (e) { next(e); }
};
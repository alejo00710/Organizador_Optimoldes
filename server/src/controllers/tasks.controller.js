const schedulerService = require('../services/scheduler.service');
const { query } = require('../config/database');

// Mapa de capacidades diarias por nombre de máquina
function mapDailyCapacityByName(name) {
  const n = String(name || '').trim().toLowerCase();
  const capacities = {
    'cnc vf3 #1': 15,
    'cnc vf3 #2': 15,
    'fresadora #1': 14,
    'fresadora #2': 14,
    'torno cnc': 9.5,
    'erosionadora': 14,
    'rectificadora': 14,
    'torno': 14,
    'taladro radial': 14,
    'pulida': 9.5,
  };
  return capacities[n] ?? null;
}

async function ensureMoldIdByName(name) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Nombre de molde vacío');
  const rows = await query('SELECT id FROM molds WHERE LOWER(name)=LOWER(?) LIMIT 1', [n]);
  if (rows.length) return rows[0].id;
  const res = await query('INSERT INTO molds (name) VALUES (?)', [n]);
  return res.insertId;
}
async function ensurePartIdByName(name) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Nombre de parte vacío');
  const rows = await query('SELECT id FROM mold_parts WHERE LOWER(name)=LOWER(?) LIMIT 1', [n]);
  if (rows.length) return rows[0].id;
  const res = await query('INSERT INTO mold_parts (name) VALUES (?)', [n]);
  return res.insertId;
}
async function ensureMachineIdByName(name) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Nombre de máquina vacío');
  const rows = await query('SELECT id FROM machines WHERE LOWER(name)=LOWER(?) AND is_active=TRUE LIMIT 1', [n]);
  if (rows.length) return rows[0].id;
  const cap = mapDailyCapacityByName(n);
  if (cap === null) {
    throw new Error(`Capacidad diaria no definida para la máquina "${name}". Configúrala antes de planificar.`);
  }
  const res = await query('INSERT INTO machines (name, operarios_count, daily_capacity, is_active) VALUES (?, ?, ?, TRUE)', [n, 1, cap]);
  return res.insertId;
}

/**
 * POST /tasks/plan
 * Planifica por parte + máquina, troceando por disponibilidad diaria (daily_capacity).
 */
const createPlan = async (req, res, next) => {
  try {
    let { moldId, partId, machineId, startDate, totalHours, moldName, partName, machineName } = req.body;

    // Resolver por nombres si no se dieron IDs
    if ((!moldId || !partId || !machineId) && (moldName || partName || machineName)) {
      if (!moldName || !partName || !machineName) {
        return res.status(400).json({ error: 'Para planificación por nombres, suministra moldName, partName y machineName' });
      }
      moldId = await ensureMoldIdByName(moldName);
      partId = await ensurePartIdByName(partName);
      machineId = await ensureMachineIdByName(machineName);
    }

    if (!moldId || !partId || !machineId || !startDate || totalHours === undefined || totalHours === null) {
      return res.status(400).json({ error: 'Campos requeridos: moldId, partId, machineId, startDate, totalHours (o sus equivalentes por nombre)' });
    }
    totalHours = parseFloat(totalHours);
    if (isNaN(totalHours) || totalHours <= 0) {
      return res.status(400).json({ error: 'totalHours debe ser un número mayor que 0' });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate)) {
      return res.status(400).json({ error: 'startDate debe estar en formato YYYY-MM-DD' });
    }

    const result = await schedulerService.createSchedule(
      moldId, partId, machineId, startDate, totalHours, req.user.userId
    );

    res.status(201).json({ message: 'Planificación creada exitosamente', data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = { createPlan };
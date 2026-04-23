const { query } = require('../config/database');

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round(toNumber(n, 0) * 100) / 100;
}

exports.getCompletedCycles = async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT
         ph.id AS planning_id,
         m.name AS mold_name,
         to_char(ph.to_start_date, 'YYYY-MM-DD') AS start_date,
         to_char(ph.to_end_date, 'YYYY-MM-DD') AS end_date
       FROM planning_history ph
       JOIN molds m ON m.id = ph.mold_id
       WHERE ph.status = 'COMPLETED'
       ORDER BY COALESCE(ph.to_end_date, ph.to_start_date, ph.created_at::date) DESC,
                ph.id DESC`
    );

    res.json(Array.isArray(rows) ? rows : []);
  } catch (error) {
    next(error);
  }
};

exports.getMoldCostBreakdown = async (req, res, next) => {
  try {
    const planningId = Number.parseInt(String(req.params.planning_id || ''), 10);
    if (!Number.isFinite(planningId) || planningId <= 0) {
      return res.status(400).json({ error: 'planning_id inválido' });
    }

    const planningRows = await query(
      `SELECT
         ph.id AS planning_id,
         m.name AS mold_name,
         to_char(ph.to_start_date, 'YYYY-MM-DD') AS start_date,
         to_char(ph.to_end_date, 'YYYY-MM-DD') AS end_date,
         ph.status AS status
       FROM planning_history ph
       JOIN molds m ON m.id = ph.mold_id
       WHERE ph.id = ?
       LIMIT 1`,
      [planningId]
    );

    if (!planningRows.length) {
      return res.status(404).json({ error: 'Ciclo no encontrado' });
    }

    const planning = planningRows[0];

    const rows = await query(
      `SELECT
         wl.machine_id,
         mc.name AS machine_name,
         COALESCE(SUM(wl.hours_worked), 0) AS total_hours,
         COALESCE(SUM(wl.hours_worked * COALESCE(mc.hourly_cost, 0)), 0) AS partial_cost
       FROM work_logs wl
       JOIN machines mc ON mc.id = wl.machine_id
       WHERE wl.planning_id = ?
       GROUP BY wl.machine_id, mc.name
       ORDER BY mc.name ASC`,
      [planningId]
    );

    const breakdown = (Array.isArray(rows) ? rows : []).map((r) => ({
      machine_id: Number(r.machine_id),
      machine_name: r.machine_name,
      total_hours: round2(r.total_hours),
      partial_cost: round2(r.partial_cost),
    }));

    const laborCostTotal = round2(
      breakdown.reduce((acc, item) => acc + toNumber(item.partial_cost, 0), 0)
    );

    res.json({
      planning_id: Number(planning.planning_id),
      mold_name: planning.mold_name,
      start_date: planning.start_date,
      end_date: planning.end_date,
      status: planning.status,
      labor_cost_total: laborCostTotal,
      machine_breakdown: breakdown,
    });
  } catch (error) {
    next(error);
  }
};

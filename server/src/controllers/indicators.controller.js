const { query } = require('../config/database');

const MONTHS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function clampInt(v, min, max) {
  const n = Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) return null;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function emptyMonthArray() {
  return Array.from({ length: 12 }, () => 0);
}

function sum(arr) {
  return (arr || []).reduce((acc, n) => acc + Number(n || 0), 0);
}

function safeDivide(num, den) {
  const n = Number(num || 0);
  const d = Number(den || 0);
  if (!d) return 0;
  return n / d;
}

function avgWhereDays(values, days) {
  const v = Array.isArray(values) ? values : [];
  const d = Array.isArray(days) ? days : [];
  let acc = 0;
  let cnt = 0;
  for (let i = 0; i < Math.min(v.length, d.length); i++) {
    const di = Number(d[i] || 0);
    if (di > 0) {
      acc += Number(v[i] || 0);
      cnt++;
    }
  }
  if (!cnt) return 0;
  return acc / cnt;
}

exports.summary = async (req, res, next) => {
  try {
    // Nuevo resumen: por AÑO (enero..diciembre)
    const now = new Date();
    const year = clampInt(req.query.year ?? now.getFullYear(), 2000, 2100);
    if (!year) return res.status(400).json({ error: 'Parámetro year inválido' });

    const operators = await query(
      `SELECT id, name
       FROM operators
       WHERE is_active = TRUE
       ORDER BY name ASC`
    );

    // Tabla 1: suma de horas por operario/mes (fuente: work_logs)
    const hoursRows = await query(
      `SELECT operator_id,
              MONTH(COALESCE(work_date, DATE(recorded_at))) AS month,
              SUM(hours_worked) AS hours
       FROM work_logs
       WHERE YEAR(COALESCE(work_date, DATE(recorded_at))) = ?
       GROUP BY operator_id, MONTH(COALESCE(work_date, DATE(recorded_at)))`,
      [year]
    );

    // Tabla 2: días hábiles por operario/mes (manual)
    const daysRows = await query(
      `SELECT operator_id, month, working_days
       FROM operator_working_days_monthly
       WHERE year = ?`,
      [year]
    );

    const hoursByOp = new Map();
    for (const op of operators) hoursByOp.set(op.id, emptyMonthArray());
    for (const r of hoursRows) {
      const arr = hoursByOp.get(r.operator_id);
      const m = Number(r.month || 0);
      if (!arr || m < 1 || m > 12) continue;
      arr[m - 1] = Number(r.hours || 0);
    }

    const daysByOp = new Map();
    for (const op of operators) daysByOp.set(op.id, emptyMonthArray());
    for (const r of daysRows) {
      const arr = daysByOp.get(r.operator_id);
      const m = Number(r.month || 0);
      if (!arr || m < 1 || m > 12) continue;
      arr[m - 1] = Number(r.working_days || 0);
    }

    // Construcción tabla 1 (horas)
    const hoursTableRows = operators.map((op) => {
      const values = hoursByOp.get(op.id) || emptyMonthArray();
      return {
        operatorId: op.id,
        operatorName: op.name,
        months: values,
        total: sum(values),
      };
    });
    const hoursTotalsMonths = emptyMonthArray();
    for (let i = 0; i < 12; i++) {
      hoursTotalsMonths[i] = sum(hoursTableRows.map((r) => r.months[i] || 0));
    }
    const hoursTotalGeneral = sum(hoursTotalsMonths);

    // Construcción tabla 2 (días)
    const daysTableRows = operators.map((op) => {
      const values = daysByOp.get(op.id) || emptyMonthArray();
      return {
        operatorId: op.id,
        operatorName: op.name,
        months: values,
        total: sum(values),
      };
    });
    const daysTotalsMonths = emptyMonthArray();
    for (let i = 0; i < 12; i++) {
      daysTotalsMonths[i] = sum(daysTableRows.map((r) => r.months[i] || 0));
    }
    const daysTotalGeneral = sum(daysTotalsMonths);

    // Tabla 3: indicador = horas / (días * 8)
    const indicatorRows = operators.map((op) => {
      const h = hoursByOp.get(op.id) || emptyMonthArray();
      const d = daysByOp.get(op.id) || emptyMonthArray();
      const months = h.map((hv, idx) => safeDivide(hv, (d[idx] || 0) * 8));
      return {
        operatorId: op.id,
        operatorName: op.name,
        months,
        average: avgWhereDays(months, d),
      };
    });
    const indicatorTotalsMonths = emptyMonthArray();
    for (let i = 0; i < 12; i++) {
      indicatorTotalsMonths[i] = safeDivide(hoursTotalsMonths[i], (daysTotalsMonths[i] || 0) * 8);
    }
    const indicatorAverageTotal = safeDivide(hoursTotalGeneral, (daysTotalGeneral || 0) * 8);

    res.json({
      year,
      months: MONTHS_ES.map((name, idx) => ({ month: idx + 1, name })),
      tables: {
        hours: {
          columns: ['OPERARIO', ...MONTHS_ES, 'Total general'],
          rows: hoursTableRows,
          totalsRow: {
            operatorName: 'Total general',
            months: hoursTotalsMonths,
            total: hoursTotalGeneral,
          },
        },
        days: {
          columns: ['OPERARIO', ...MONTHS_ES, 'Total general'],
          rows: daysTableRows,
          totalsRow: {
            operatorName: 'Total general',
            months: daysTotalsMonths,
            total: daysTotalGeneral,
          },
        },
        indicator: {
          columns: ['COLABORADOR', ...MONTHS_ES, 'Promedio'],
          rows: indicatorRows,
          totalsRow: {
            operatorName: 'Total general',
            months: indicatorTotalsMonths,
            average: indicatorAverageTotal,
          },
        },
      },
      operators,
    });
  } catch (e) {
    next(e);
  }
};

exports.upsertWorkingDays = async (req, res, next) => {
  try {
    const operatorId = clampInt(req.body.operatorId ?? req.body.operator_id, 1, 1_000_000_000);
    const year = clampInt(req.body.year, 2000, 2100);
    const month = clampInt(req.body.month, 1, 12);
    const workingDays = clampInt(req.body.workingDays ?? req.body.working_days, 0, 31);

    if (!operatorId || !year || !month || workingDays == null) {
      return res.status(400).json({ error: 'operatorId, year, month y workingDays son requeridos' });
    }

    // Verificar operario activo
    const ops = await query(`SELECT id, is_active FROM operators WHERE id = ?`, [operatorId]);
    if (!ops.length) return res.status(404).json({ error: 'Operario no encontrado' });

    await query(
      `INSERT INTO operator_working_days_monthly (operator_id, year, month, working_days, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         working_days = VALUES(working_days),
         updated_by = VALUES(updated_by),
         updated_at = CURRENT_TIMESTAMP`,
      [operatorId, year, month, workingDays, req.user?.id || null]
    );

    res.json({ ok: true, operatorId, year, month, workingDays });
  } catch (e) {
    next(e);
  }
};
const { query } = require('../src/config/database');

async function main() {
  const years = [2026, 2025, 2024];
  const month = 2;

  const ops = await query(
    `SELECT id, name
     FROM operators
     WHERE is_active = TRUE
     ORDER BY name ASC
     LIMIT 10`
  );

  if (!ops.length) {
    console.log('No active operators');
    return;
  }

  const op = ops[0];
  console.log('First active operator (alphabetical):', op);

  for (const year of years) {
    const hoursRows = await query(
      `SELECT SUM(hours_worked) AS hours
       FROM work_logs
       WHERE operator_id = ?
         AND EXTRACT(YEAR FROM COALESCE(work_date, recorded_at::date))::int = ?
         AND EXTRACT(MONTH FROM COALESCE(work_date, recorded_at::date))::int = ?`,
      [op.id, year, month]
    );

    const daysRows = await query(
      `SELECT working_days
       FROM operator_working_days_monthly
       WHERE operator_id = ? AND year = ? AND month = ?`,
      [op.id, year, month]
    );

    const hours = Number(hoursRows?.[0]?.hours || 0);
    const days = daysRows.length ? Number(daysRows[0].working_days || 0) : 0;
    const ratio = days ? (hours / (days * 8)) : 0;

    console.log(`Year ${year} Feb -> hours=${hours} days=${days} ratio=${ratio} pct=${ratio * 100}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});

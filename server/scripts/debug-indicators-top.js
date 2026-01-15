const { query } = require('../src/config/database');

async function main() {
  const year = Number(process.argv[2] || 2026);
  const month = Number(process.argv[3] || 2);

  const rows = await query(
    `SELECT o.id, o.name, SUM(w.hours_worked) AS hours
     FROM work_logs w
     JOIN operators o ON o.id = w.operator_id
     WHERE EXTRACT(YEAR FROM COALESCE(w.work_date, w.recorded_at::date))::int = ?
       AND EXTRACT(MONTH FROM COALESCE(w.work_date, w.recorded_at::date))::int = ?
     GROUP BY o.id, o.name
     ORDER BY hours DESC
     LIMIT 20`,
    [year, month]
  );

  console.log(`Top operators by hours for ${year} month ${month}:`);
  console.table(rows);

  for (const r of rows) {
    const dys = await query(
      `SELECT working_days
       FROM operator_working_days_monthly
       WHERE operator_id = ? AND year = ? AND month = ?`,
      [r.id, year, month]
    );

    const hours = Number(r.hours || 0);
    const days = dys.length ? Number(dys[0].working_days || 0) : 0;
    const pct = days ? (hours / (days * 8)) * 100 : 0;

    console.log(`${r.name}: hours=${hours} days=${days} pct=${pct}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});

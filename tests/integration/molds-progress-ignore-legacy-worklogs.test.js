const request = require('supertest');
const crypto = require('crypto');

const app = require('../../server/src/app');
const { createUserAndToken } = require('../helpers/auth');
const { query } = require('../../server/src/config/database');
const { ROLES } = require('../../server/src/utils/constants');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toISODate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function pickFarFutureBaseDateISO(seed) {
  const base = new Date(2099, 0, 1);
  const offset = Number.parseInt(String(seed).slice(0, 6), 16) % 300;
  base.setDate(base.getDate() + offset);
  base.setHours(0, 0, 0, 0);
  while (base.getDay() === 0 || base.getDay() === 6) base.setDate(base.getDate() + 1);
  return toISODate(base);
}

function addBusinessDaysISO(isoDate, days) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  let remaining = Number(days || 0);
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) remaining -= 1;
  }
  return toISODate(date);
}

describe('Molds progress ignora work_logs históricos de ciclos previos', () => {
  let ctx;

  const suffix = crypto.randomUUID().slice(0, 8);
  const moldName = `jest_mold_legacy_${suffix}`;
  const partName = `jest_part_legacy_${suffix}`;
  const machineName = `jest_machine_legacy_${suffix}`;
  const operatorName = `jest_operator_legacy_${suffix}`;

  let moldId;
  let partId;
  let machineId;
  let operatorId;

  beforeAll(async () => {
    ctx = await createUserAndToken({ role: ROLES.PLANNER });
  });

  afterAll(async () => {
    try {
      if (!moldId) moldId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldName]))?.[0]?.id;
      if (!partId) partId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partName]))?.[0]?.id;
      if (!machineId) machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
      if (!operatorId) operatorId = (await query('SELECT id FROM operators WHERE name = ? LIMIT 1', [operatorName]))?.[0]?.id;

      if (moldId) {
        await query('DELETE FROM planning_history WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM work_logs WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM molds WHERE id = ?', [moldId]);
      }

      if (partId) await query('DELETE FROM mold_parts WHERE id = ?', [partId]);
      if (machineId) await query('DELETE FROM machines WHERE id = ?', [machineId]);
      if (operatorId) await query('DELETE FROM operators WHERE id = ?', [operatorId]);
    } finally {
      if (ctx?.cleanup) await ctx.cleanup();
    }
  });

  it('no marca avance/completado en plan nuevo usando logs de un plan anterior borrado', async () => {
    const oldDate = pickFarFutureBaseDateISO(suffix);
    const newDate = addBusinessDaysISO(oldDate, 4);

    const opRes = await query('INSERT INTO operators (name, user_id, is_active) VALUES (?, NULL, TRUE)', [operatorName]);
    operatorId = opRes.insertId;

    await request(app)
      .post('/api/tasks/plan/block')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        moldName,
        startDate: oldDate,
        tasks: [{ partName, machineName, totalHours: 2 }],
      })
      .expect(201);

    moldId = Number((await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldName]))?.[0]?.id);
    partId = Number((await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partName]))?.[0]?.id);
    machineId = Number((await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id);

    await query(
      `INSERT INTO work_logs (mold_id, part_id, machine_id, operator_id, work_date, hours_worked, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [moldId, partId, machineId, operatorId, oldDate, 2, 'ciclo anterior']
    );

    await request(app)
      .delete(`/api/tasks/plan/mold/${moldId}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .expect(200);

    await request(app)
      .post('/api/tasks/plan/block')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        moldName,
        startDate: newDate,
        tasks: [{ partName, machineName, totalHours: 6 }],
      })
      .expect(201);

    const progress = await request(app)
      .get(`/api/molds/${moldId}/progress?includeParts=1&asOf=${encodeURIComponent(newDate)}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .expect(200);

    expect(Number(progress.body?.totals?.plannedTotalHours || 0)).toBeCloseTo(6, 2);
    expect(Number(progress.body?.totals?.actualTotalHours || 0)).toBeCloseTo(0, 2);
    expect(Number(progress.body?.totals?.percentComplete || 0)).toBeCloseTo(0, 2);

    const hasCompletedEvent = Array.isArray(progress.body?.planningHistory)
      ? progress.body.planningHistory.some(e => String(e?.eventType || '').toUpperCase() === 'COMPLETED')
      : false;
    expect(hasCompletedEvent).toBe(false);
  });
});

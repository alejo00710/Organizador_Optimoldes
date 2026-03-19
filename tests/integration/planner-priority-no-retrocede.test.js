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

describe('Plan priority no retrocede bloques existentes', () => {
  let ctx;

  const suffix = crypto.randomUUID().slice(0, 8);
  const machineName = `jest_machine_pr_nr_${suffix}`;
  const moldA = `jest_mold_A_pr_nr_${suffix}`;
  const moldB = `jest_mold_B_pr_nr_${suffix}`;
  const moldC = `jest_mold_C_pr_nr_${suffix}`;
  const moldP = `jest_mold_P_pr_nr_${suffix}`;
  const partA = `jest_part_A_pr_nr_${suffix}`;
  const partB = `jest_part_B_pr_nr_${suffix}`;
  const partC = `jest_part_C_pr_nr_${suffix}`;
  const partP = `jest_part_P_pr_nr_${suffix}`;

  beforeAll(async () => {
    ctx = await createUserAndToken({ role: ROLES.PLANNER });
  });

  afterAll(async () => {
    try {
      for (const name of [moldA, moldB, moldC, moldP]) {
        const moldId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [name]))?.[0]?.id;
        if (!moldId) continue;
        await query('DELETE FROM planning_history WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM molds WHERE id = ?', [moldId]);
      }

      const machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
      if (machineId) await query('DELETE FROM machines WHERE id = ?', [machineId]);

      for (const p of [partA, partB, partC, partP]) {
        const partId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [p]))?.[0]?.id;
        if (partId) await query('DELETE FROM mold_parts WHERE id = ?', [partId]);
      }
    } finally {
      if (ctx?.cleanup) await ctx.cleanup();
    }
  });

  it('al priorizar, no mueve moldes existentes a fechas anteriores a sus fechas originales', async () => {
    const day1 = pickFarFutureBaseDateISO(suffix);
    const day2 = addBusinessDaysISO(day1, 1);
    const day4 = addBusinessDaysISO(day1, 3);

    await request(app)
      .post('/api/tasks/plan/block')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ moldName: moldA, startDate: day1, tasks: [{ partName: partA, machineName, totalHours: 8 }] })
      .expect(201);

    await request(app)
      .post('/api/tasks/plan/block')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ moldName: moldB, startDate: day2, tasks: [{ partName: partB, machineName, totalHours: 8 }] })
      .expect(201);

    await request(app)
      .post('/api/tasks/plan/block')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ moldName: moldC, startDate: day4, tasks: [{ partName: partC, machineName, totalHours: 8 }] })
      .expect(201);

    await request(app)
      .post('/api/tasks/plan/priority')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ moldName: moldP, startDate: day1, tasks: [{ partName: partP, machineName, totalHours: 8 }] })
      .expect(200);

    const moldBId = Number((await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldB]))?.[0]?.id);
    const moldCId = Number((await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldC]))?.[0]?.id);

    const bStart = String((await query(`SELECT to_char(MIN(date), 'YYYY-MM-DD') AS d FROM plan_entries WHERE mold_id = ?`, [moldBId]))?.[0]?.d || '');
    const cStart = String((await query(`SELECT to_char(MIN(date), 'YYYY-MM-DD') AS d FROM plan_entries WHERE mold_id = ?`, [moldCId]))?.[0]?.d || '');

    expect(bStart >= day2).toBe(true);
    expect(cStart >= day4).toBe(true);
  });
});

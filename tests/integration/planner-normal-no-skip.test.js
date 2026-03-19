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

function nextBusinessDayISO(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  date.setDate(date.getDate() + 1);
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
  return toISODate(date);
}

describe('Plan normal no salta días ocupados', () => {
  let ctx;

  const suffix = crypto.randomUUID().slice(0, 8);
  const machineName = `jest_machine_noskip_${suffix}`;
  const moldBlockName = `jest_mold_block_noskip_${suffix}`;
  const moldNewName = `jest_mold_new_noskip_${suffix}`;
  const partBlockName = `jest_part_block_noskip_${suffix}`;
  const partNewName = `jest_part_new_noskip_${suffix}`;

  beforeAll(async () => {
    ctx = await createUserAndToken({ role: ROLES.PLANNER });
  });

  afterAll(async () => {
    try {
      const moldBlockId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldBlockName]))?.[0]?.id;
      const moldNewId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldNewName]))?.[0]?.id;

      for (const moldId of [moldBlockId, moldNewId]) {
        if (!moldId) continue;
        await query('DELETE FROM planning_history WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM molds WHERE id = ?', [moldId]);
      }

      const machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
      if (machineId) await query('DELETE FROM machines WHERE id = ?', [machineId]);

      for (const partName of [partBlockName, partNewName]) {
        const partId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partName]))?.[0]?.id;
        if (partId) await query('DELETE FROM mold_parts WHERE id = ?', [partId]);
      }
    } finally {
      if (ctx?.cleanup) await ctx.cleanup();
    }
  });

  it('rechaza plan normal cuando tendría que saltar un día intermedio ocupado por otro molde', async () => {
    const day1 = pickFarFutureBaseDateISO(suffix);
    const day2 = nextBusinessDayISO(day1);

    await request(app)
      .post('/api/tasks/plan/block')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        moldName: moldBlockName,
        startDate: day2,
        tasks: [{ partName: partBlockName, machineName, totalHours: 8 }],
      })
      .expect(201);

    const res = await request(app)
      .post('/api/tasks/plan/block')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        moldName: moldNewName,
        startDate: day1,
        tasks: [{ partName: partNewName, machineName, totalHours: 16 }],
      })
      .expect(400);

    expect(String(res.body?.error || '')).toMatch(/Use PRIORIDAD/i);

    const moldNewId = Number((await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldNewName]))?.[0]?.id);
    if (Number.isFinite(moldNewId) && moldNewId > 0) {
      const rows = await query('SELECT 1 FROM plan_entries WHERE mold_id = ? LIMIT 1', [moldNewId]);
      expect(rows.length).toBe(0);
    }
  });
});

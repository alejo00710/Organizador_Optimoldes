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

describe('Planner creation blocks duplicate mold', () => {
  let ctx;

  const suffix = crypto.randomUUID().slice(0, 8);
  const moldName = `jest_mold_no_dup_${suffix}`;
  const machineName = `jest_machine_no_dup_${suffix}`;
  const partName = `jest_part_no_dup_${suffix}`;
  const partPriority = `jest_part_no_dup_priority_${suffix}`;

  beforeAll(async () => {
    ctx = await createUserAndToken({ role: ROLES.PLANNER });
  });

  afterAll(async () => {
    try {
      const moldId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldName]))?.[0]?.id;
      if (moldId) {
        await query('DELETE FROM planning_history WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM molds WHERE id = ?', [moldId]);
      }

      const machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
      if (machineId) await query('DELETE FROM machines WHERE id = ?', [machineId]);

      for (const p of [partName, partPriority]) {
        const partId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [p]))?.[0]?.id;
        if (partId) await query('DELETE FROM mold_parts WHERE id = ?', [partId]);
      }
    } finally {
      if (ctx?.cleanup) await ctx.cleanup();
    }
  });

  it('rejects creating another normal/priority plan for same mold name when active plan exists', async () => {
    const startDate = pickFarFutureBaseDateISO(suffix);

    await request(app)
      .post('/api/tasks/plan/block')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        moldName,
        startDate,
        tasks: [{ partName, machineName, totalHours: 4 }],
      })
      .expect(201);

    const duplicateNormal = await request(app)
      .post('/api/tasks/plan/block')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        moldName,
        startDate,
        tasks: [{ partName, machineName, totalHours: 2 }],
      })
      .expect(409);

    expect(String(duplicateNormal.body?.error || '')).toMatch(/ya tiene planificación activa/i);

    const duplicatePriority = await request(app)
      .post('/api/tasks/plan/priority')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        moldName,
        startDate,
        tasks: [{ partName: partPriority, machineName, totalHours: 3 }],
      })
      .expect(409);

    expect(String(duplicatePriority.body?.error || '')).toMatch(/ya tiene planificación activa/i);
  });
});

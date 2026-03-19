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

describe('Bulk move (fecha fija) no atraviesa moldes activos', () => {
  let ctx;

  const suffix = crypto.randomUUID().slice(0, 8);
  const machineName = `jest_machine_bmsd_${suffix}`;
  const machineOtherName = `jest_machine_bmsd_other_${suffix}`;
  const machineThirdName = `jest_machine_bmsd_third_${suffix}`;
  const moldMoveName = `jest_mold_move_bmsd_${suffix}`;
  const moldMove2Name = `jest_mold_move2_bmsd_${suffix}`;
  const moldBlockName = `jest_mold_block_bmsd_${suffix}`;
  const moldOtherName = `jest_mold_other_bmsd_${suffix}`;
  const partMoveName = `jest_part_move_bmsd_${suffix}`;
  const partMove2Name = `jest_part_move2_bmsd_${suffix}`;
  const partBlockName = `jest_part_block_bmsd_${suffix}`;
  const partOtherName = `jest_part_other_bmsd_${suffix}`;

  beforeAll(async () => {
    ctx = await createUserAndToken({ role: ROLES.PLANNER });
  });

  afterAll(async () => {
    try {
      const moldMoveId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldMoveName]))?.[0]?.id;
      const moldMove2Id = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldMove2Name]))?.[0]?.id;
      const moldBlockId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldBlockName]))?.[0]?.id;
      const moldOtherId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldOtherName]))?.[0]?.id;

      for (const moldId of [moldMoveId, moldMove2Id, moldBlockId, moldOtherId]) {
        if (!moldId) continue;
        await query('DELETE FROM planning_history WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM molds WHERE id = ?', [moldId]);
      }

      const machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
      if (machineId) await query('DELETE FROM machines WHERE id = ?', [machineId]);
      const machineOtherId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineOtherName]))?.[0]?.id;
      if (machineOtherId) await query('DELETE FROM machines WHERE id = ?', [machineOtherId]);
      const machineThirdId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineThirdName]))?.[0]?.id;
      if (machineThirdId) await query('DELETE FROM machines WHERE id = ?', [machineThirdId]);

      for (const partName of [partMoveName, partMove2Name, partBlockName, partOtherName]) {
        const partId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partName]))?.[0]?.id;
        if (partId) await query('DELETE FROM mold_parts WHERE id = ?', [partId]);
      }
    } finally {
      if (ctx?.cleanup) await ctx.cleanup();
    }
  });

  it('rechaza mover a una fecha posterior libre si hay un bloque activo en medio', async () => {
    const day1 = pickFarFutureBaseDateISO(suffix);
    const day2 = addBusinessDaysISO(day1, 1);
    const day4 = addBusinessDaysISO(day1, 3);

    await request(app)
      .post('/api/tasks/plan/block')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        moldName: moldMoveName,
        startDate: day1,
        tasks: [{ partName: partMoveName, machineName, totalHours: 8 }],
      })
      .expect(201);

    await request(app)
      .post('/api/tasks/plan/block')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        moldName: moldBlockName,
        startDate: day2,
        tasks: [{ partName: partBlockName, machineName, totalHours: 16 }],
      })
      .expect(201);

    const moldMoveId = Number((await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldMoveName]))?.[0]?.id);
    const entryId = Number((await query('SELECT id FROM plan_entries WHERE mold_id = ? ORDER BY id ASC LIMIT 1', [moldMoveId]))?.[0]?.id);

    const moveRes = await request(app)
      .post('/api/tasks/plan/entries/bulk-move')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        mode: 'date',
        date: day4,
        entryIds: [entryId],
      })
      .expect(400);

    expect(Number(moveRes.body?.moved || 0)).toBe(0);
    expect(Number(moveRes.body?.failed || 0)).toBe(1);
    expect(String(moveRes.body?.results?.[0]?.error || '')).toMatch(/No se puede mover en fecha fija/i);

    const stillOnOriginal = await query(
      `SELECT 1 FROM plan_entries WHERE id = ? AND date = ? LIMIT 1`,
      [entryId, day1]
    );
    expect(stillOnOriginal.length).toBe(1);
  });

  it('rechaza mover a un día que ya tiene otro molde planificado aunque sea en otra máquina', async () => {
    const day1 = addBusinessDaysISO(pickFarFutureBaseDateISO(`${suffix}g`), 10);
    const day2 = addBusinessDaysISO(day1, 1);

    await request(app)
      .post('/api/tasks/plan/block')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        moldName: moldMove2Name,
        startDate: day1,
        tasks: [{ partName: partMove2Name, machineName: machineOtherName, totalHours: 4 }],
      })
      .expect(201);

    await request(app)
      .post('/api/tasks/plan/block')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        moldName: moldOtherName,
        startDate: day2,
        tasks: [{ partName: partOtherName, machineName: machineThirdName, totalHours: 4 }],
      })
      .expect(201);

    const moldMoveId = Number((await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldMove2Name]))?.[0]?.id);
    const entryId = Number((await query('SELECT id FROM plan_entries WHERE mold_id = ? ORDER BY id ASC LIMIT 1', [moldMoveId]))?.[0]?.id);

    const moveRes = await request(app)
      .post('/api/tasks/plan/entries/bulk-move')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        mode: 'date',
        date: day2,
        entryIds: [entryId],
      })
      .expect(400);

    expect(Number(moveRes.body?.moved || 0)).toBe(0);
    expect(String(moveRes.body?.error || '')).toMatch(/ya tiene otra planificación activa|No se puede mover en fecha fija/i);
  });
});

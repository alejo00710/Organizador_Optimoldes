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

describe('Planner allows recreate after completed legacy cycle', () => {
  let ctx;

  const suffix = crypto.randomUUID().slice(0, 8);
  const moldName = `jest_mold_legacy_cycle_${suffix}`;
  const machineName = `jest_machine_legacy_cycle_${suffix}`;
  const partName = `jest_part_legacy_cycle_${suffix}`;
  const operatorName = `jest_operator_legacy_cycle_${suffix}`;

  let moldId;
  let machineId;
  let partId;
  let operatorId;

  beforeAll(async () => {
    ctx = await createUserAndToken({ role: ROLES.PLANNER });
  });

  afterAll(async () => {
    try {
      if (!moldId) moldId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldName]))?.[0]?.id;
      if (!machineId) machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
      if (!partId) partId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partName]))?.[0]?.id;
      if (!operatorId) operatorId = (await query('SELECT id FROM operators WHERE name = ? LIMIT 1', [operatorName]))?.[0]?.id;

      if (moldId) {
        await query('DELETE FROM planning_history WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM work_logs WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldId]);
        await query('DELETE FROM molds WHERE id = ?', [moldId]);
      }
      if (machineId) await query('DELETE FROM machines WHERE id = ?', [machineId]);
      if (partId) await query('DELETE FROM mold_parts WHERE id = ?', [partId]);
      if (operatorId) await query('DELETE FROM operators WHERE id = ?', [operatorId]);
    } finally {
      if (ctx?.cleanup) await ctx.cleanup();
    }
  });

  it('allows a new block plan when prior cycle is completed with legacy null planning_id rows', async () => {
    const startDate = pickFarFutureBaseDateISO(suffix);
    const nextStartDate = addBusinessDaysISO(startDate, 2);

    const opRes = await query('INSERT INTO operators (name, user_id, is_active) VALUES (?, NULL, TRUE)', [operatorName]);
    operatorId = opRes.insertId;

    await request(app)
      .post('/api/tasks/plan/block')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        moldName,
        startDate,
        tasks: [{ partName, machineName, totalHours: 2 }],
      })
      .expect(201);

    const moldRow = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldName]))?.[0] || {};
    moldId = Number(moldRow.id || 0);
    expect(moldId).toBeGreaterThan(0);

    const partRow = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partName]))?.[0] || {};
    partId = Number(partRow.id || 0);
    expect(partId).toBeGreaterThan(0);

    const machineRow = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0] || {};
    machineId = Number(machineRow.id || 0);
    expect(machineId).toBeGreaterThan(0);

    const planningRow = (await query(
      `SELECT id
       FROM planning_history
       WHERE mold_id = ? AND event_type = 'PLANNED'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [moldId]
    ))?.[0] || {};
    const planningId = Number(planningRow.id || 0);
    expect(planningId).toBeGreaterThan(0);

    // Simula datos heredados: entries del ciclo sin planning_id.
    await query('UPDATE plan_entries SET planning_id = NULL WHERE mold_id = ? AND planning_id = ?', [moldId, planningId]);

    // Cierra la parte/máquina del ciclo con final log sin planning_id.
    await query(
      `INSERT INTO work_logs (mold_id, planning_id, part_id, machine_id, operator_id, work_date, hours_worked, note, is_final_log)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, TRUE)`,
      [moldId, partId, machineId, operatorId, startDate, 2, 'cierre legado']
    );

    await request(app)
      .post('/api/tasks/plan/block')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        moldName,
        startDate: nextStartDate,
        tasks: [{ partName, machineName, totalHours: 3 }],
      })
      .expect(201);
  });
});

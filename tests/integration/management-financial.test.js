const request = require('supertest');
const crypto = require('crypto');

const app = require('../../server/src/app');
const { query } = require('../../server/src/config/database');
const { createUserAndToken } = require('../helpers/auth');
const { ROLES } = require('../../server/src/utils/constants');

describe('Management financial liquidation endpoints', () => {
  let managementCtx;
  let plannerCtx;

  let moldId;
  let partId;
  let operatorId;
  let machineAId;
  let machineBId;
  let planningId;

  const suffix = crypto.randomUUID().slice(0, 8);
  const moldName = `jest_mold_fin_${suffix}`;
  const partName = `jest_part_fin_${suffix}`;
  const operatorName = `jest_operator_fin_${suffix}`;
  const machineAName = `jest_machine_fin_a_${suffix}`;
  const machineBName = `jest_machine_fin_b_${suffix}`;

  beforeAll(async () => {
    managementCtx = await createUserAndToken({ role: ROLES.MANAGEMENT });
    plannerCtx = await createUserAndToken({ role: ROLES.PLANNER });

    const moldIns = await query('INSERT INTO molds (name, is_active) VALUES (?, TRUE)', [moldName]);
    moldId = moldIns.insertId;

    const partIns = await query('INSERT INTO mold_parts (name, is_active) VALUES (?, TRUE)', [partName]);
    partId = partIns.insertId;

    const opIns = await query('INSERT INTO operators (name, is_active) VALUES (?, TRUE)', [operatorName]);
    operatorId = opIns.insertId;

    const machineAIns = await query(
      'INSERT INTO machines (name, daily_capacity, hourly_cost, hourly_price, is_active) VALUES (?, ?, ?, ?, TRUE)',
      [machineAName, 10, 100, 140]
    );
    machineAId = machineAIns.insertId;

    const machineBIns = await query(
      'INSERT INTO machines (name, daily_capacity, hourly_cost, hourly_price, is_active) VALUES (?, ?, ?, ?, TRUE)',
      [machineBName, 10, 80, 120]
    );
    machineBId = machineBIns.insertId;

    const planningIns = await query(
      `INSERT INTO planning_history (
         mold_id,
         event_type,
         status,
         to_start_date,
         to_end_date,
         created_by
       ) VALUES (?, ?, 'COMPLETED', ?, ?, ?) RETURNING id`,
      [moldId, 'BLOCK_PLAN', '2026-03-01', '2026-03-10', managementCtx.userId]
    );
    planningId = planningIns.insertId;
    if (!planningId) {
      const planningRows = await query(
        'SELECT id FROM planning_history WHERE mold_id = ? ORDER BY id DESC LIMIT 1',
        [moldId]
      );
      planningId = planningRows?.[0]?.id || null;
    }

    await query(
      `INSERT INTO work_logs (
         mold_id,
         planning_id,
         part_id,
         machine_id,
         operator_id,
         work_date,
         hours_worked,
         note,
         is_final_log
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
      [moldId, planningId, partId, machineAId, operatorId, '2026-03-03', 2.5, 'test-a-1']
    );

    await query(
      `INSERT INTO work_logs (
         mold_id,
         planning_id,
         part_id,
         machine_id,
         operator_id,
         work_date,
         hours_worked,
         note,
         is_final_log
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
      [moldId, planningId, partId, machineAId, operatorId, '2026-03-04', 1.0, 'test-a-2']
    );

    await query(
      `INSERT INTO work_logs (
         mold_id,
         planning_id,
         part_id,
         machine_id,
         operator_id,
         work_date,
         hours_worked,
         note,
         is_final_log
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [moldId, planningId, partId, machineBId, operatorId, '2026-03-05', 1.25, 'test-b-1']
    );
  });

  afterAll(async () => {
    try {
      if (planningId) {
        await query('DELETE FROM work_logs WHERE planning_id = ?', [planningId]);
        await query('DELETE FROM planning_history WHERE id = ?', [planningId]);
      }

      if (partId) await query('DELETE FROM mold_parts WHERE id = ?', [partId]);
      if (machineAId) await query('DELETE FROM machines WHERE id = ?', [machineAId]);
      if (machineBId) await query('DELETE FROM machines WHERE id = ?', [machineBId]);
      if (operatorId) await query('DELETE FROM operators WHERE id = ?', [operatorId]);
      if (moldId) await query('DELETE FROM molds WHERE id = ?', [moldId]);
    } finally {
      if (managementCtx?.cleanup) await managementCtx.cleanup();
      if (plannerCtx?.cleanup) await plannerCtx.cleanup();
    }
  });

  it('GET /api/management/completed-cycles returns completed planning cycles', async () => {
    const res = await request(app)
      .get('/api/management/completed-cycles')
      .set('Authorization', `Bearer ${managementCtx.token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const hit = res.body.find((r) => Number(r?.planning_id) === Number(planningId));
    expect(hit).toBeTruthy();
    expect(hit.mold_name).toBe(moldName);
    expect(hit.start_date).toBe('2026-03-01');
    expect(hit.end_date).toBe('2026-03-10');
  });

  it('GET /api/management/mold-cost-breakdown/:planning_id computes labor total and machine breakdown', async () => {
    const res = await request(app)
      .get(`/api/management/mold-cost-breakdown/${planningId}`)
      .set('Authorization', `Bearer ${managementCtx.token}`)
      .expect(200);

    expect(Number(res.body?.planning_id)).toBe(Number(planningId));
    expect(res.body?.mold_name).toBe(moldName);
    expect(res.body?.start_date).toBe('2026-03-01');
    expect(res.body?.end_date).toBe('2026-03-10');

    expect(Array.isArray(res.body?.machine_breakdown)).toBe(true);
    expect(res.body.machine_breakdown.length).toBe(2);

    const machineA = res.body.machine_breakdown.find((r) => r.machine_name === machineAName);
    const machineB = res.body.machine_breakdown.find((r) => r.machine_name === machineBName);

    expect(machineA).toBeTruthy();
    expect(Number(machineA.total_hours)).toBeCloseTo(3.5, 5);
    expect(Number(machineA.partial_cost)).toBeCloseTo(350, 5);

    expect(machineB).toBeTruthy();
    expect(Number(machineB.total_hours)).toBeCloseTo(1.25, 5);
    expect(Number(machineB.partial_cost)).toBeCloseTo(100, 5);

    expect(Number(res.body?.labor_cost_total)).toBeCloseTo(450, 5);
  });

  it('non-management users cannot access management liquidation endpoints', async () => {
    await request(app)
      .get('/api/management/completed-cycles')
      .set('Authorization', `Bearer ${plannerCtx.token}`)
      .expect(403);

    await request(app)
      .get(`/api/management/mold-cost-breakdown/${planningId}`)
      .set('Authorization', `Bearer ${plannerCtx.token}`)
      .expect(403);
  });
});

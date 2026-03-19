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

function nextWeekdayISO(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    const cur = new Date(y, (m || 1) - 1, d || 1);
    cur.setHours(0, 0, 0, 0);
    do {
        cur.setDate(cur.getDate() + 1);
    } while (cur.getDay() === 0 || cur.getDay() === 6);
    return toISODate(cur);
}

function pickFarFutureBaseDateISO(seed) {
    const base = new Date(2099, 0, 1);
    const offset = Number.parseInt(String(seed).slice(0, 6), 16) % 300;
    base.setDate(base.getDate() + offset);
    base.setHours(0, 0, 0, 0);
    while (base.getDay() === 0 || base.getDay() === 6) base.setDate(base.getDate() + 1);
    return toISODate(base);
}

describe('Molds progress: preserva avance tras prioridad y soporta desglose por día', () => {
    let ctx;

    const suffix = crypto.randomUUID().slice(0, 8);

    const machineName = `jest_machine_molds_progress_${suffix}`;
    const moldA = `jest_mold_A_progress_${suffix}`;
    const moldB = `jest_mold_B_priority_${suffix}`;
    const partA = `jest_part_A_progress_${suffix}`;
    const partB = `jest_part_B_priority_${suffix}`;

    const machineNameDay = `jest_machine_molds_day_${suffix}`;
    const moldDay = `jest_mold_day_${suffix}`;
    const partDay1 = `jest_part_day_1_${suffix}`;
    const partDay2 = `jest_part_day_2_${suffix}`;

    const operatorName = `jest_operator_progress_${suffix}`;

    let machineId;
    let moldAId;
    let moldBId;
    let partAId;
    let partBId;

    let machineDayId;
    let moldDayId;
    let partDay1Id;
    let partDay2Id;

    let operatorId;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.PLANNER });
    });

    afterAll(async () => {
        try {
            if (!machineId) machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
            if (!moldAId) moldAId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldA]))?.[0]?.id;
            if (!moldBId) moldBId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldB]))?.[0]?.id;
            if (!partAId) partAId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partA]))?.[0]?.id;
            if (!partBId) partBId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partB]))?.[0]?.id;

            if (!machineDayId) machineDayId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineNameDay]))?.[0]?.id;
            if (!moldDayId) moldDayId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldDay]))?.[0]?.id;
            if (!partDay1Id) partDay1Id = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partDay1]))?.[0]?.id;
            if (!partDay2Id) partDay2Id = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partDay2]))?.[0]?.id;

            if (!operatorId) operatorId = (await query('SELECT id FROM operators WHERE name = ? LIMIT 1', [operatorName]))?.[0]?.id;

            const moldIds = [moldAId, moldBId, moldDayId].filter(Boolean);
            for (const id of moldIds) {
                await query('DELETE FROM work_logs WHERE mold_id = ?', [id]);
                await query('DELETE FROM plan_entries WHERE mold_id = ?', [id]);
                await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [id]);
                await query('DELETE FROM molds WHERE id = ?', [id]);
            }

            const machineIds = [machineId, machineDayId].filter(Boolean);
            for (const id of machineIds) await query('DELETE FROM machines WHERE id = ?', [id]);

            const partIds = [partAId, partBId, partDay1Id, partDay2Id].filter(Boolean);
            for (const id of partIds) await query('DELETE FROM mold_parts WHERE id = ?', [id]);

            if (operatorId) await query('DELETE FROM operators WHERE id = ?', [operatorId]);
        } finally {
            if (ctx?.cleanup) await ctx.cleanup();
        }
    });

    it('preserva horas reales tras reprogramación por prioridad', async () => {
        const baseDate = pickFarFutureBaseDateISO(`${suffix}a1`);

        await query('INSERT INTO machines (name, daily_capacity, is_active) VALUES (?, ?, TRUE)', [machineName, 8]);
        const opRes = await query('INSERT INTO operators (name, user_id, is_active) VALUES (?, NULL, TRUE)', [operatorName]);
        operatorId = opRes.insertId;

        await request(app)
            .post('/api/tasks/plan/block')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName: moldA,
                startDate: baseDate,
                tasks: [{ partName: partA, machineName, totalHours: 6 }],
            })
            .expect(201);

        moldAId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldA]))?.[0]?.id;
        machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
        partAId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partA]))?.[0]?.id;

        await query(
            `INSERT INTO work_logs (mold_id, part_id, machine_id, operator_id, work_date, hours_worked, note)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [moldAId, partAId, machineId, operatorId, baseDate, 3, 'avance parcial']
        );

        const before = await request(app)
            .get(`/api/molds/${moldAId}/progress?includeParts=1&asOf=${encodeURIComponent(baseDate)}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        expect(Number(before.body?.totals?.actualTotalHours || 0)).toBeCloseTo(3, 2);

        await request(app)
            .post('/api/tasks/plan/priority')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName: moldB,
                startDate: baseDate,
                tasks: [{ partName: partB, machineName, totalHours: 4 }],
            })
            .expect(200);

        moldBId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldB]))?.[0]?.id;
        partBId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partB]))?.[0]?.id;

        const after = await request(app)
            .get(`/api/molds/${moldAId}/progress?includeParts=1&asOf=${encodeURIComponent(baseDate)}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        expect(Number(after.body?.totals?.actualTotalHours || 0)).toBeCloseTo(3, 2);
        const firstPart = Array.isArray(after.body?.breakdown?.parts) ? after.body.breakdown.parts[0] : null;
        const firstMachine = firstPart && Array.isArray(firstPart.machines) ? firstPart.machines[0] : null;
        expect(Number(firstMachine?.actualHours || 0)).toBeCloseTo(3, 2);
    });

    it('cuando se pide day, breakdown solo incluye partes planificadas ese día', async () => {
        const baseDate = pickFarFutureBaseDateISO(`${suffix}b2`);
        const nextDate = nextWeekdayISO(baseDate);

        await query('INSERT INTO machines (name, daily_capacity, is_active) VALUES (?, ?, TRUE)', [machineNameDay, 8]);

        await request(app)
            .post('/api/tasks/plan/block')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName: moldDay,
                startDate: baseDate,
                tasks: [
                    { partName: partDay1, machineName: machineNameDay, totalHours: 8 },
                    { partName: partDay2, machineName: machineNameDay, totalHours: 8 },
                ],
            })
            .expect(201);

        moldDayId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldDay]))?.[0]?.id;
        machineDayId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineNameDay]))?.[0]?.id;
        partDay1Id = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partDay1]))?.[0]?.id;
        partDay2Id = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partDay2]))?.[0]?.id;

        const day1 = await request(app)
            .get(`/api/molds/${moldDayId}/progress?includeParts=1&day=${encodeURIComponent(baseDate)}&asOf=${encodeURIComponent(nextDate)}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        const partsDay1 = Array.isArray(day1.body?.breakdown?.parts) ? day1.body.breakdown.parts : [];
        expect(partsDay1.length).toBe(1);
        expect(partsDay1[0]?.partName).toBe(partDay1);

        const day2 = await request(app)
            .get(`/api/molds/${moldDayId}/progress?includeParts=1&day=${encodeURIComponent(nextDate)}&asOf=${encodeURIComponent(nextDate)}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        const partsDay2 = Array.isArray(day2.body?.breakdown?.parts) ? day2.body.breakdown.parts : [];
        expect(partsDay2.length).toBe(1);
        expect(partsDay2[0]?.partName).toBe(partDay2);
    });
});

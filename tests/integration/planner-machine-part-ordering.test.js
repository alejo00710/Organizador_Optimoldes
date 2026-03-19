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

async function findNextWorkingDateISO(token, maxDays = 45) {
    let d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1);

    for (let i = 0; i < maxDays; i++) {
        const iso = toISODate(d);
        const res = await request(app)
            .get(`/api/working/check?date=${encodeURIComponent(iso)}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        if (res.body && res.body.laborable === true) return iso;
        d.setDate(d.getDate() + 1);
    }

    throw new Error('No se encontró una fecha laborable para planificar');
}

describe('Planificador por máquina: termina parte actual antes de la siguiente', () => {
    let ctx;

    const suffix = crypto.randomUUID().slice(0, 8);
    const moldName = `jest_mold_order_${suffix}`;
    const machineName = `jest_machine_order_${suffix}`;
    const partAName = `jest_part_order_A_${suffix}`;
    const partBName = `jest_part_order_B_${suffix}`;

    let moldId;
    let machineId;
    let partAId;
    let partBId;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.PLANNER });
    });

    afterAll(async () => {
        try {
            if (!moldId) moldId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldName]))?.[0]?.id;
            if (!machineId) machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
            if (!partAId) partAId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partAName]))?.[0]?.id;
            if (!partBId) partBId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partBName]))?.[0]?.id;

            if (moldId) {
                await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldId]);
                await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldId]);
                await query('DELETE FROM molds WHERE id = ?', [moldId]);
            }
            if (machineId) await query('DELETE FROM machines WHERE id = ?', [machineId]);
            if (partAId) await query('DELETE FROM mold_parts WHERE id = ?', [partAId]);
            if (partBId) await query('DELETE FROM mold_parts WHERE id = ?', [partBId]);
        } finally {
            if (ctx?.cleanup) await ctx.cleanup();
        }
    });

    it('consolida horas de la misma parte y la completa antes de avanzar', async () => {
        const startDate = await findNextWorkingDateISO(ctx.token);

        await query('INSERT INTO machines (name, daily_capacity, is_active) VALUES (?, ?, TRUE)', [machineName, 15]);

        await request(app)
            .post('/api/tasks/plan/block')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName,
                startDate,
                tasks: [
                    { partName: partAName, machineName, totalHours: 8 },
                    { partName: partBName, machineName, totalHours: 10 },
                    { partName: partAName, machineName, totalHours: 4 },
                ],
            })
            .expect(201);

        moldId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldName]))?.[0]?.id;
        machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
        partAId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partAName]))?.[0]?.id;
        partBId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partBName]))?.[0]?.id;

        expect(moldId).toBeTruthy();
        expect(machineId).toBeTruthy();
        expect(partAId).toBeTruthy();
        expect(partBId).toBeTruthy();

        const day1 = await query(
            `SELECT part_id, hours_planned
             FROM plan_entries
             WHERE mold_id = ? AND machine_id = ? AND date = ?
             ORDER BY id ASC`,
            [moldId, machineId, startDate]
        );

        expect(day1.length).toBe(2);
        expect(Number(day1[0].part_id)).toBe(Number(partAId));
        expect(Number(day1[0].hours_planned)).toBeCloseTo(12, 2);
        expect(Number(day1[1].part_id)).toBe(Number(partBId));
        expect(Number(day1[1].hours_planned)).toBeCloseTo(3, 2);

        const nextDay = nextWeekdayISO(startDate);
        const day2 = await query(
            `SELECT part_id, hours_planned
             FROM plan_entries
             WHERE mold_id = ? AND machine_id = ? AND date = ?
             ORDER BY id ASC`,
            [moldId, machineId, nextDay]
        );

        expect(day2.length).toBe(1);
        expect(Number(day2[0].part_id)).toBe(Number(partBId));
        expect(Number(day2[0].hours_planned)).toBeCloseTo(7, 2);
    });
});

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

function parseISOToLocalDate(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

function pickFarFutureBaseDateISO(seed) {
    const base = new Date(2099, 0, 1);
    const offset = Number.parseInt(String(seed).slice(0, 6), 16) % 300;
    base.setDate(base.getDate() + offset);
    base.setHours(0, 0, 0, 0);
    while (base.getDay() === 0 || base.getDay() === 6) base.setDate(base.getDate() + 1);
    return toISODate(base);
}

function nextLocalWorkingISO(startISO) {
    const d = parseISOToLocalDate(startISO);
    d.setHours(0, 0, 0, 0);
    do {
        d.setDate(d.getDate() + 1);
    } while (d.getDay() === 0 || d.getDay() === 6);
    return toISODate(d);
}

function workingDayDistance(startISO, endISO) {
    if (endISO <= startISO) return 0;
    let count = 0;
    let cursor = parseISOToLocalDate(startISO);
    while (toISODate(cursor) < endISO) {
        cursor = parseISOToLocalDate(nextLocalWorkingISO(toISODate(cursor)));
        count += 1;
    }
    return count;
}

describe('Planificador PRIORIDAD preserva forma del molde existente', () => {
    let ctx;

    const suffix = crypto.randomUUID().slice(0, 8);

    const machine1 = `jest_machine_pr_shape_1_${suffix}`;
    const machine2 = `jest_machine_pr_shape_2_${suffix}`;

    const moldExisting = `jest_mold_existing_shape_${suffix}`;
    const partExisting1 = `jest_part_existing_shape_1_${suffix}`;
    const partExisting2 = `jest_part_existing_shape_2_${suffix}`;

    const moldPriority = `jest_mold_priority_shape_${suffix}`;
    const partPriority = `jest_part_priority_shape_${suffix}`;

    let moldExistingId;
    let moldPriorityId;
    let machine1Id;
    let machine2Id;
    let partIds = [];

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.PLANNER });
    });

    afterAll(async () => {
        try {
            if (!moldExistingId)
                moldExistingId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldExisting]))?.[0]?.id;
            if (!moldPriorityId)
                moldPriorityId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldPriority]))?.[0]?.id;
            if (!machine1Id) machine1Id = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machine1]))?.[0]?.id;
            if (!machine2Id) machine2Id = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machine2]))?.[0]?.id;

            const allPartNames = [partExisting1, partExisting2, partPriority];
            for (const name of allPartNames) {
                const id = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [name]))?.[0]?.id;
                if (id) partIds.push(id);
            }

            if (moldExistingId) {
                await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldExistingId]);
                await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldExistingId]);
                await query('DELETE FROM molds WHERE id = ?', [moldExistingId]);
            }
            if (moldPriorityId) {
                await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldPriorityId]);
                await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldPriorityId]);
                await query('DELETE FROM molds WHERE id = ?', [moldPriorityId]);
            }

            if (machine1Id) await query('DELETE FROM machines WHERE id = ?', [machine1Id]);
            if (machine2Id) await query('DELETE FROM machines WHERE id = ?', [machine2Id]);

            for (const id of new Set(partIds)) {
                await query('DELETE FROM mold_parts WHERE id = ?', [id]);
            }
        } finally {
            if (ctx?.cleanup) await ctx.cleanup();
        }
    });

    it('cuando hay prioridad, mueve todo el molde existente con el mismo corrimiento por días laborables', async () => {
        const baseDate = pickFarFutureBaseDateISO(suffix);

        // Molde existente: dos partes en dos maquinas, ambas multidia para validar que no se parta.
        await request(app)
            .post('/api/tasks/plan/block')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName: moldExisting,
                startDate: baseDate,
                tasks: [
                    { partName: partExisting1, machineName: machine1, totalHours: 16 },
                    { partName: partExisting2, machineName: machine2, totalHours: 16 },
                ],
            })
            .expect(201);

        moldExistingId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldExisting]))?.[0]?.id;
        expect(moldExistingId).toBeTruthy();

        const before = await query(
            "SELECT part_id, to_char(date, 'YYYY-MM-DD') AS date_str FROM plan_entries WHERE mold_id = ? ORDER BY date ASC, id ASC",
            [moldExistingId],
        );

        const beforeStart = before?.[0]?.date_str;
        expect(beforeStart).toBeTruthy();

        await request(app)
            .post('/api/tasks/plan/priority')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName: moldPriority,
                startDate: baseDate,
                tasks: [{ partName: partPriority, machineName: machine1, totalHours: 8 }],
            })
            .expect(200);

        moldPriorityId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldPriority]))?.[0]?.id;
        machine1Id = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machine1]))?.[0]?.id;
        machine2Id = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machine2]))?.[0]?.id;
        expect(moldPriorityId).toBeTruthy();
        expect(machine1Id).toBeTruthy();
        expect(machine2Id).toBeTruthy();

        const after = await query(
            "SELECT part_id, to_char(date, 'YYYY-MM-DD') AS date_str FROM plan_entries WHERE mold_id = ? ORDER BY date ASC, id ASC",
            [moldExistingId],
        );

        const afterStart = after?.[0]?.date_str;
        expect(afterStart).toBeTruthy();

        const globalShift = workingDayDistance(beforeStart, afterStart);
        expect(globalShift).toBeGreaterThan(0);

        // Todas las entradas deben mantener el mismo offset relativo al inicio del molde.
        const beforeOffsets = before.map((r) => workingDayDistance(beforeStart, r.date_str));
        const afterOffsets = after.map((r) => workingDayDistance(afterStart, r.date_str));
        expect(afterOffsets).toEqual(beforeOffsets);

        // Y cada entrada debe haberse corrido exactamente el mismo delta global.
        for (let i = 0; i < before.length; i++) {
            const shifted = workingDayDistance(before[i].date_str, after[i].date_str);
            expect(shifted).toBe(globalShift);
        }
    });
});

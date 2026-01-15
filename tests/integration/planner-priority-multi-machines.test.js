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

function nextLocalWorkingISO(startISO) {
    const d = parseISOToLocalDate(startISO);
    d.setHours(0, 0, 0, 0);
    do {
        d.setDate(d.getDate() + 1);
    } while (d.getDay() === 0 || d.getDay() === 6);
    return toISODate(d);
}

function pickFarFutureBaseDateISO(seed) {
    const base = new Date(2099, 0, 1);
    const offset = Number.parseInt(String(seed).slice(0, 6), 16) % 300;
    base.setDate(base.getDate() + offset);
    base.setHours(0, 0, 0, 0);
    while (base.getDay() === 0 || base.getDay() === 6) base.setDate(base.getDate() + 1);
    return toISODate(base);
}

function getDayTasks(calendarBody, dayNumber) {
    const events = calendarBody?.events || {};
    return events[String(dayNumber)]?.tasks || events[dayNumber]?.tasks || [];
}

describe('Planificador PRIORIDAD afecta múltiples máquinas', () => {
    let ctx;

    const suffix = crypto.randomUUID().slice(0, 8);

    const machine1 = `jest_machine_prio_m1_${suffix}`;
    const machine2 = `jest_machine_prio_m2_${suffix}`;

    const moldExisting = `jest_mold_existing_multiM_${suffix}`;
    const partExisting1 = `jest_part_existing_1_${suffix}`;
    const partExisting2 = `jest_part_existing_2_${suffix}`;

    const moldPriority = `jest_mold_priority_multiM_${suffix}`;
    const partPriority1 = `jest_part_priority_1_${suffix}`;
    const partPriority2 = `jest_part_priority_2_${suffix}`;

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

            const allPartNames = [partExisting1, partExisting2, partPriority1, partPriority2];
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

    it('reprograma ambos planes existentes y reporta machinesAffected', async () => {
        const baseDate = pickFarFutureBaseDateISO(suffix);

        // 1) Crear plan normal en 2 máquinas (Molde existente)
        await request(app)
            .post('/api/tasks/plan/block')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName: moldExisting,
                startDate: baseDate,
                tasks: [
                    { partName: partExisting1, machineName: machine1, totalHours: 4 },
                    { partName: partExisting2, machineName: machine2, totalHours: 4 },
                ],
            })
            .expect(201);

        // 2) Aplicar PRIORIDAD en ambas máquinas
        const prioRes = await request(app)
            .post('/api/tasks/plan/priority')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName: moldPriority,
                startDate: baseDate,
                tasks: [
                    { partName: partPriority1, machineName: machine1, totalHours: 4 },
                    { partName: partPriority2, machineName: machine2, totalHours: 4 },
                ],
            })
            .expect(200);

        // IDs
        moldExistingId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldExisting]))?.[0]?.id;
        moldPriorityId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldPriority]))?.[0]?.id;
        machine1Id = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machine1]))?.[0]?.id;
        machine2Id = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machine2]))?.[0]?.id;

        expect(moldExistingId).toBeTruthy();
        expect(moldPriorityId).toBeTruthy();
        expect(machine1Id).toBeTruthy();
        expect(machine2Id).toBeTruthy();

        // 3) machinesAffected debe incluir ambas máquinas
        const machinesAffected = prioRes.body?.machinesAffected || [];
        expect(Array.isArray(machinesAffected)).toBe(true);
        const set = new Set(machinesAffected.map(Number));
        expect(set.has(Number(machine1Id))).toBe(true);
        expect(set.has(Number(machine2Id))).toBe(true);
        expect(set.size).toBe(2);

        // 4) Calendario: en baseDate están los 2 de prioridad, y NO están los existentes
        const [y1, m1, d1] = baseDate.split('-').map(Number);
        const calBase = await request(app)
            .get(`/api/calendar/month-view?year=${y1}&month=${m1}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        const baseTasks = getDayTasks(calBase.body, d1);
        expect(baseTasks.some((t) => t?.mold === moldPriority && t?.machine === machine1 && t?.part === partPriority1)).toBe(true);
        expect(baseTasks.some((t) => t?.mold === moldPriority && t?.machine === machine2 && t?.part === partPriority2)).toBe(true);

        expect(baseTasks.some((t) => t?.mold === moldExisting && t?.machine === machine1)).toBe(false);
        expect(baseTasks.some((t) => t?.mold === moldExisting && t?.machine === machine2)).toBe(false);

        // 5) Ambos existentes deben aparecer el siguiente día laborable
        const nextWorking = nextLocalWorkingISO(baseDate);

        const [y2, m2, d2] = nextWorking.split('-').map(Number);
        const calNext = await request(app)
            .get(`/api/calendar/month-view?year=${y2}&month=${m2}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        const nextTasks = getDayTasks(calNext.body, d2);
        expect(nextTasks.some((t) => t?.mold === moldExisting && t?.machine === machine1 && t?.part === partExisting1)).toBe(true);
        expect(nextTasks.some((t) => t?.mold === moldExisting && t?.machine === machine2 && t?.part === partExisting2)).toBe(true);
    });
});

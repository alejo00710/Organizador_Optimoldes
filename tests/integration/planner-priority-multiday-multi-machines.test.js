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

describe('Planificador PRIORIDAD multi-día + multi-máquina (fin global)', () => {
    let ctx;

    const suffix = crypto.randomUUID().slice(0, 8);

    const machine1 = `jest_machine_prio_mm1_${suffix}`;
    const machine2 = `jest_machine_prio_mm2_${suffix}`;

    const moldExisting = `jest_mold_existing_mm_${suffix}`;
    const partExisting1 = `jest_part_existing_mm1_${suffix}`;
    const partExisting2 = `jest_part_existing_mm2_${suffix}`;

    const moldPriority = `jest_mold_priority_mm_${suffix}`;
    const partPriority1 = `jest_part_priority_mm1_${suffix}`;
    const partPriority2 = `jest_part_priority_mm2_${suffix}`;

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

    it('reprograma planes existentes al primer día laborable tras el MAX(date) prioritario entre máquinas', async () => {
        const baseDate = pickFarFutureBaseDateISO(suffix);

        // Plan normal (Molde existente) en 2 máquinas
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

        // PRIORIDAD multi-día: damos horas altas (distintas) para que haya fin global no trivial
        await request(app)
            .post('/api/tasks/plan/priority')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName: moldPriority,
                startDate: baseDate,
                tasks: [
                    { partName: partPriority1, machineName: machine1, totalHours: 80 },
                    { partName: partPriority2, machineName: machine2, totalHours: 120 },
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

        // MAX(date) prioritario global entre máquinas
        const prioGlobal = await query(
            "SELECT to_char(MIN(date), 'YYYY-MM-DD') AS min_date, to_char(MAX(date), 'YYYY-MM-DD') AS max_date, COUNT(DISTINCT date) AS days\n" +
                'FROM plan_entries WHERE mold_id = ? AND is_priority = TRUE',
            [moldPriorityId],
        );

        const prioMin = prioGlobal?.[0]?.min_date;
        const prioMax = prioGlobal?.[0]?.max_date;
        const prioDays = Number(prioGlobal?.[0]?.days || 0);

        expect(prioMin).toBe(baseDate);
        expect(prioMax).toBeTruthy();
        expect(prioDays).toBeGreaterThanOrEqual(2);

        const expectedStartExisting = nextLocalWorkingISO(prioMax);

        // Cada máquina existente debe empezar exactamente en expectedStartExisting (porque son 4h)
        const existingM1 = await query(
            "SELECT to_char(MIN(date), 'YYYY-MM-DD') AS min_date FROM plan_entries WHERE mold_id = ? AND machine_id = ?",
            [moldExistingId, machine1Id],
        );
        const existingM2 = await query(
            "SELECT to_char(MIN(date), 'YYYY-MM-DD') AS min_date FROM plan_entries WHERE mold_id = ? AND machine_id = ?",
            [moldExistingId, machine2Id],
        );

        expect(existingM1?.[0]?.min_date).toBe(expectedStartExisting);
        expect(existingM2?.[0]?.min_date).toBe(expectedStartExisting);

        // Chequeo en calendario
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

        const [y2, m2, d2] = expectedStartExisting.split('-').map(Number);
        const calExpected = await request(app)
            .get(`/api/calendar/month-view?year=${y2}&month=${m2}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        const expectedTasks = getDayTasks(calExpected.body, d2);
        expect(expectedTasks.some((t) => t?.mold === moldExisting && t?.machine === machine1 && t?.part === partExisting1)).toBe(true);
        expect(expectedTasks.some((t) => t?.mold === moldExisting && t?.machine === machine2 && t?.part === partExisting2)).toBe(true);
    });
});

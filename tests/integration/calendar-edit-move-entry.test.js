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

function pickFarFutureWeekdayISO(seed) {
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

describe('Calendario: mover una entrada (PATCH /tasks/plan/entry/:id)', () => {
    let ctx;

    const suffix = crypto.randomUUID().slice(0, 8);
    const moldName = `jest_mold_move_${suffix}`;
    const partName = `jest_part_move_${suffix}`;
    const machineA = `jest_machine_moveA_${suffix}`;
    const machineB = `jest_machine_moveB_${suffix}`;

    let moldId;
    let machineAId;
    let machineBId;
    let partId;
    let entryId;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.PLANNER });
    });

    afterAll(async () => {
        try {
            if (!moldId) moldId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldName]))?.[0]?.id;
            if (!machineAId)
                machineAId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineA]))?.[0]?.id;
            if (!machineBId)
                machineBId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineB]))?.[0]?.id;
            if (!partId) partId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partName]))?.[0]?.id;

            if (moldId) {
                await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldId]);
                await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldId]);
                await query('DELETE FROM molds WHERE id = ?', [moldId]);
            }
            if (machineAId) await query('DELETE FROM machines WHERE id = ?', [machineAId]);
            if (machineBId) await query('DELETE FROM machines WHERE id = ?', [machineBId]);
            if (partId) await query('DELETE FROM mold_parts WHERE id = ?', [partId]);
        } finally {
            if (ctx?.cleanup) await ctx.cleanup();
        }
    });

    it('crea un bloque y lo mueve de fecha y máquina', async () => {
        const startDate = pickFarFutureWeekdayISO(suffix);
        const targetDate = nextLocalWorkingISO(startDate);

        await request(app)
            .post('/api/tasks/plan/block')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName,
                startDate,
                tasks: [
                    {
                        partName,
                        machineName: machineA,
                        totalHours: 2,
                    },
                ],
            })
            .expect(201);

        moldId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldName]))?.[0]?.id;
        machineAId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineA]))?.[0]?.id;
        partId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partName]))?.[0]?.id;

        const [y1, m1, d1] = startDate.split('-').map(Number);
        const cal1 = await request(app)
            .get(`/api/calendar/month-view?year=${y1}&month=${m1}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        const tasksBaseDay = getDayTasks(cal1.body, d1);
        const hit = tasksBaseDay.find((t) => t && t.mold === moldName && t.machine === machineA && t.part === partName);
        expect(hit).toBeTruthy();
        expect(hit).toHaveProperty('entryId');
        entryId = hit.entryId;

        await request(app)
            .patch(`/api/tasks/plan/entry/${entryId}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ date: targetDate, machineName: machineB })
            .expect(200);

        const [y2, m2, d2] = targetDate.split('-').map(Number);
        const cal2 = await request(app)
            .get(`/api/calendar/month-view?year=${y2}&month=${m2}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        const tasksTargetDay = getDayTasks(cal2.body, d2);
        const moved = tasksTargetDay.find((t) => t && t.mold === moldName && t.machine === machineB && t.part === partName);
        expect(moved).toBeTruthy();

        // Resolver machineBId para cleanup
        machineBId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineB]))?.[0]?.id;
    });
});

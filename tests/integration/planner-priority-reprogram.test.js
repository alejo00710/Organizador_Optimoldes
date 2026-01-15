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

describe('Planificador PRIORIDAD reprograma y se refleja en Calendario', () => {
    let ctx;

    const suffix = crypto.randomUUID().slice(0, 8);
    const machineName = `jest_machine_prio_${suffix}`;

    const moldA = `jest_mold_A_${suffix}`;
    const partA = `jest_part_A_${suffix}`;

    const moldB = `jest_mold_B_${suffix}`;
    const partB = `jest_part_B_${suffix}`;

    let moldAId;
    let moldBId;
    let machineId;
    let partAId;
    let partBId;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.PLANNER });
    });

    afterAll(async () => {
        try {
            // Resolver IDs si faltan
            if (!moldAId) moldAId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldA]))?.[0]?.id;
            if (!moldBId) moldBId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldB]))?.[0]?.id;
            if (!machineId) machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
            if (!partAId) partAId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partA]))?.[0]?.id;
            if (!partBId) partBId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partB]))?.[0]?.id;

            // Limpiar plan_entries y snapshots por molde
            if (moldAId) {
                await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldAId]);
                await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldAId]);
                await query('DELETE FROM molds WHERE id = ?', [moldAId]);
            }
            if (moldBId) {
                await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldBId]);
                await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldBId]);
                await query('DELETE FROM molds WHERE id = ?', [moldBId]);
            }

            if (machineId) await query('DELETE FROM machines WHERE id = ?', [machineId]);
            if (partAId) await query('DELETE FROM mold_parts WHERE id = ?', [partAId]);
            if (partBId) await query('DELETE FROM mold_parts WHERE id = ?', [partBId]);
        } finally {
            if (ctx?.cleanup) await ctx.cleanup();
        }
    });

    it('mueve el plan existente después del bloque prioritario global', async () => {
        const baseDate = pickFarFutureBaseDateISO(suffix);

        // 1) Crear planificación normal (Molde A) en baseDate
        await request(app)
            .post('/api/tasks/plan/block')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName: moldA,
                startDate: baseDate,
                tasks: [
                    {
                        partName: partA,
                        machineName,
                        totalHours: 4,
                    },
                ],
            })
            .expect(201);

        // 2) Crear planificación PRIORITARIA (Molde B) misma máquina y misma fecha
        await request(app)
            .post('/api/tasks/plan/priority')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName: moldB,
                startDate: baseDate,
                tasks: [
                    {
                        partName: partB,
                        machineName,
                        totalHours: 4,
                    },
                ],
            })
            .expect(200);

        // Capturar IDs para cleanup
        moldAId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldA]))?.[0]?.id;
        moldBId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldB]))?.[0]?.id;
        machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
        partAId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partA]))?.[0]?.id;
        partBId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partB]))?.[0]?.id;

        expect(moldAId).toBeTruthy();
        expect(moldBId).toBeTruthy();
        expect(machineId).toBeTruthy();

        // 3) Verificar en calendario
        const [y1, m1, d1] = baseDate.split('-').map(Number);
        const cal1 = await request(app)
            .get(`/api/calendar/month-view?year=${y1}&month=${m1}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        const tasksBaseDay = getDayTasks(cal1.body, d1);

        // En baseDate debe existir Molde B (prioridad)
        expect(tasksBaseDay.some((t) => t?.mold === moldB && t?.machine === machineName && t?.part === partB)).toBe(true);
        // Y Molde A NO debe seguir ese día (se reprograma)
        expect(tasksBaseDay.some((t) => t?.mold === moldA && t?.machine === machineName)).toBe(false);

        // 4) El Molde A debe aparecer en el siguiente día laborable
        const nextWorking = nextLocalWorkingISO(baseDate);

        const [y2, m2, d2] = nextWorking.split('-').map(Number);
        const cal2 = await request(app)
            .get(`/api/calendar/month-view?year=${y2}&month=${m2}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        const tasksNextDay = getDayTasks(cal2.body, d2);
        expect(tasksNextDay.some((t) => t?.mold === moldA && t?.machine === machineName && t?.part === partA)).toBe(true);
    });
});

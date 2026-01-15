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

describe('Planificador -> Calendario (flujo real)', () => {
    let ctx;

    const suffix = crypto.randomUUID().slice(0, 8);
    const moldName = `jest_mold_plan_${suffix}`;
    const machineName = `jest_machine_plan_${suffix}`;
    const partName = `jest_part_plan_${suffix}`;

    let moldId;
    let machineId;
    let partId;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.PLANNER });
    });

    afterAll(async () => {
        try {
            if (!moldId) {
                const molds = await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldName]);
                moldId = molds[0]?.id;
            }
            if (!machineId) {
                const machines = await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]);
                machineId = machines[0]?.id;
            }
            if (!partId) {
                const parts = await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partName]);
                partId = parts[0]?.id;
            }

            if (moldId) {
                await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldId]);
                await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldId]);
                await query('DELETE FROM molds WHERE id = ?', [moldId]);
            }
            if (machineId) await query('DELETE FROM machines WHERE id = ?', [machineId]);
            if (partId) await query('DELETE FROM mold_parts WHERE id = ?', [partId]);
        } finally {
            if (ctx?.cleanup) await ctx.cleanup();
        }
    });

    it('crea plan con /tasks/plan/block y aparece en /calendar/month-view', async () => {
        const startDate = await findNextWorkingDateISO(ctx.token);

        // Crear plan en bloque (una tarea simple)
        await request(app)
            .post('/api/tasks/plan/block')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName,
                startDate,
                tasks: [
                    {
                        partName,
                        machineName,
                        totalHours: 4,
                    },
                ],
            })
            .expect(201);

        // Capturar ids creados para cleanup
        const molds = await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldName]);
        moldId = molds[0]?.id;
        const machines = await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]);
        machineId = machines[0]?.id;
        const parts = await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partName]);
        partId = parts[0]?.id;

        expect(moldId).toBeTruthy();
        expect(machineId).toBeTruthy();
        expect(partId).toBeTruthy();

        const [y, m, d] = startDate.split('-').map(Number);

        const calRes = await request(app)
            .get(`/api/calendar/month-view?year=${y}&month=${m}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        const dayEntry = calRes.body?.events?.[String(d)] || calRes.body?.events?.[d];
        expect(dayEntry).toBeTruthy();
        expect(Array.isArray(dayEntry.tasks)).toBe(true);

        const hit = (dayEntry.tasks || []).find(
            (t) => t && t.mold === moldName && t.machine === machineName && t.part === partName
        );

        expect(hit).toBeTruthy();
        expect(Number(hit.hours)).toBe(4);
        expect(hit).toHaveProperty('entryId');
    });
});

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

describe('Planificador normal vs prioridad', () => {
    let ctx;

    const suffix = crypto.randomUUID().slice(0, 8);
    const machineName = `jest_machine_nvp_${suffix}`;

    const priorityMold = `jest_mold_priority_nvp_${suffix}`;
    const priorityPart = `jest_part_priority_nvp_${suffix}`;

    const normalMold = `jest_mold_normal_nvp_${suffix}`;
    const normalPart = `jest_part_normal_nvp_${suffix}`;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.PLANNER });
    });

    afterAll(async () => {
        try {
            const molds = [priorityMold, normalMold];
            for (const m of molds) {
                const id = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [m]))?.[0]?.id;
                if (id) {
                    await query('DELETE FROM plan_entries WHERE mold_id = ?', [id]);
                    await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [id]);
                    await query('DELETE FROM molds WHERE id = ?', [id]);
                }
            }

            const machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
            if (machineId) await query('DELETE FROM machines WHERE id = ?', [machineId]);

            const parts = [priorityPart, normalPart];
            for (const p of parts) {
                const id = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [p]))?.[0]?.id;
                if (id) await query('DELETE FROM mold_parts WHERE id = ?', [id]);
            }
        } finally {
            if (ctx?.cleanup) await ctx.cleanup();
        }
    });

    it('bloquea planificación normal sobre un molde prioritario no terminado en el mismo día/máquina', async () => {
        const startDate = pickFarFutureBaseDateISO(suffix);

        await request(app)
            .post('/api/tasks/plan/priority')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName: priorityMold,
                startDate,
                tasks: [{ partName: priorityPart, machineName, totalHours: 4 }],
            })
            .expect(200);

        const res = await request(app)
            .post('/api/tasks/plan/block')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName: normalMold,
                startDate,
                tasks: [{ partName: normalPart, machineName, totalHours: 2 }],
            })
            .expect(400);

        expect(String(res.body?.error || '')).toMatch(/No se puede planificar en/i);
    });
});

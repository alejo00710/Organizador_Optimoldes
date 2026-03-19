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

function nextBusinessDayISO(isoDate) {
    const [y, m, d] = String(isoDate).split('-').map(Number);
    const date = new Date(y, (m || 1) - 1, d || 1);
    date.setDate(date.getDate() + 1);
    while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
    return toISODate(date);
}

describe('Historial de planificación', () => {
    let ctx;

    const suffix = crypto.randomUUID().slice(0, 8);
    const machineName = `jest_machine_hist_${suffix}`;
    const moldName = `jest_mold_hist_${suffix}`;
    const partName = `jest_part_hist_${suffix}`;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.PLANNER });
    });

    afterAll(async () => {
        try {
            const moldId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldName]))?.[0]?.id;
            if (moldId) {
                await query('DELETE FROM planning_history WHERE mold_id = ?', [moldId]);
                await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldId]);
                await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldId]);
                await query('DELETE FROM molds WHERE id = ?', [moldId]);
            }

            const machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
            if (machineId) await query('DELETE FROM machines WHERE id = ?', [machineId]);

            const partId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partName]))?.[0]?.id;
            if (partId) await query('DELETE FROM mold_parts WHERE id = ?', [partId]);
        } finally {
            if (ctx?.cleanup) await ctx.cleanup();
        }
    });

    it('incluye eventos de plan y movimiento en /molds/:id/progress', async () => {
        const startDate = pickFarFutureBaseDateISO(suffix);

        await request(app)
            .post('/api/tasks/plan/block')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName,
                startDate,
                tasks: [{ partName, machineName, totalHours: 4 }],
            })
            .expect(201);

        const moldId = Number((await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldName]))?.[0]?.id);
        expect(moldId).toBeGreaterThan(0);

        const entryId = Number((await query(
            `SELECT id FROM plan_entries WHERE mold_id = ? ORDER BY id ASC LIMIT 1`,
            [moldId]
        ))?.[0]?.id);
        expect(entryId).toBeGreaterThan(0);

        const targetDate = nextBusinessDayISO(startDate);

        await request(app)
            .patch(`/api/tasks/plan/entry/${entryId}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ date: targetDate, machineName })
            .expect(200);

        const progressRes = await request(app)
            .get(`/api/molds/${moldId}/progress?includeParts=1`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        const history = Array.isArray(progressRes.body?.planningHistory) ? progressRes.body.planningHistory : [];
        const eventTypes = history.map(h => String(h?.eventType || '').toUpperCase());

        expect(history.length).toBeGreaterThanOrEqual(2);
        expect(eventTypes).toContain('PLANNED');
        expect(eventTypes).toContain('MOVED');
    });
});

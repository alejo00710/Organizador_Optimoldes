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

describe('Move parts (fecha fija) respeta bloqueos por moldes activos', () => {
    let ctx;

    const suffix = crypto.randomUUID().slice(0, 8);
    const machineName = `jest_machine_mpsd_${suffix}`;
    const moldAName = `jest_moldA_mpsd_${suffix}`;
    const moldBName = `jest_moldB_mpsd_${suffix}`;
    const partAName = `jest_partA_mpsd_${suffix}`;
    const partBName = `jest_partB_mpsd_${suffix}`;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.PLANNER });
    });

    afterAll(async () => {
        try {
            const moldAId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldAName]))?.[0]?.id;
            const moldBId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldBName]))?.[0]?.id;

            for (const moldId of [moldAId, moldBId]) {
                if (!moldId) continue;
                await query('DELETE FROM planning_history WHERE mold_id = ?', [moldId]);
                await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldId]);
                await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldId]);
                await query('DELETE FROM molds WHERE id = ?', [moldId]);
            }

            const machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
            if (machineId) await query('DELETE FROM machines WHERE id = ?', [machineId]);

            for (const partName of [partAName, partBName]) {
                const partId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partName]))?.[0]?.id;
                if (partId) await query('DELETE FROM mold_parts WHERE id = ?', [partId]);
            }
        } finally {
            if (ctx?.cleanup) await ctx.cleanup();
        }
    });

    it('rechaza mover partes a un día ocupado por otro molde no terminado', async () => {
        const startDate = pickFarFutureBaseDateISO(suffix);
        const day2 = nextBusinessDayISO(startDate);

        await request(app)
            .post('/api/tasks/plan/block')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName: moldAName,
                startDate,
                tasks: [{ partName: partAName, machineName, totalHours: 8 }],
            })
            .expect(201);

        await request(app)
            .post('/api/tasks/plan/block')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName: moldBName,
                startDate: day2,
                tasks: [{ partName: partBName, machineName, totalHours: 8 }],
            })
            .expect(201);

        const moldBId = Number((await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldBName]))?.[0]?.id);
        const partBId = Number((await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partBName]))?.[0]?.id);

        const moveRes = await request(app)
            .post(`/api/tasks/plan/mold/${moldBId}/move-parts`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                mode: 'date',
                date: startDate,
                partIds: [partBId],
            })
            .expect(400);

        expect(String(moveRes.body?.error || '')).toMatch(/No se puede mover en fecha fija|No se puede mover:/i);

        const bDates = await query(
            `SELECT DISTINCT to_char(date,'YYYY-MM-DD') AS d
             FROM plan_entries
             WHERE mold_id = ?
             ORDER BY d ASC`,
            [moldBId]
        );
        const dates = (bDates || []).map(r => String(r.d));
        expect(dates).toContain(day2);
        expect(dates).not.toContain(startDate);
    });
});

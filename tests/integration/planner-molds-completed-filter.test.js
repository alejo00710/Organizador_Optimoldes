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

describe('Planificador /plan/molds excluye moldes completos', () => {
    let ctx;
    let ids = {};

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.PLANNER });

        const suffix = crypto.randomUUID().slice(0, 8);
        const moldName = `jest_mold_done_${suffix}`;
        const partName = `jest_part_done_${suffix}`;
        const machineName = `jest_machine_done_${suffix}`;
        const operatorName = `jest_op_done_${suffix}`;

        const moldRes = await query('INSERT INTO molds (name, is_active) VALUES (?, TRUE)', [moldName]);
        const partRes = await query('INSERT INTO mold_parts (name, is_active) VALUES (?, TRUE)', [partName]);
        const machineRes = await query('INSERT INTO machines (name, is_active) VALUES (?, TRUE)', [machineName]);
        const opRes = await query('INSERT INTO operators (name, user_id, is_active) VALUES (?, NULL, TRUE)', [operatorName]);

        ids = {
            moldId: moldRes.insertId,
            partId: partRes.insertId,
            machineId: machineRes.insertId,
            operatorId: opRes.insertId,
        };

        const tomorrow = new Date();
        tomorrow.setHours(0, 0, 0, 0);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const planDateISO = toISODate(tomorrow);

        await query(
            `INSERT INTO plan_entries (mold_id, part_id, machine_id, date, hours_planned, created_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [ids.moldId, ids.partId, ids.machineId, planDateISO, 3, ctx.userId]
        );

        await query(
            `INSERT INTO work_logs (mold_id, part_id, machine_id, operator_id, work_date, hours_worked, note)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [ids.moldId, ids.partId, ids.machineId, ids.operatorId, planDateISO, 3, 'jest complete']
        );
    });

    afterAll(async () => {
        try {
            if (ids?.moldId) await query('DELETE FROM molds WHERE id = ?', [ids.moldId]);
            if (ids?.partId) await query('DELETE FROM mold_parts WHERE id = ?', [ids.partId]);
            if (ids?.machineId) await query('DELETE FROM machines WHERE id = ?', [ids.machineId]);
            if (ids?.operatorId) await query('DELETE FROM operators WHERE id = ?', [ids.operatorId]);
        } finally {
            if (ctx?.cleanup) await ctx.cleanup();
        }
    });

    it('no lista en planificación un molde ya completado', async () => {
        const res = await request(app)
            .get('/api/tasks/plan/molds')
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        expect(res.body).toHaveProperty('molds');
        expect(Array.isArray(res.body.molds)).toBe(true);

        const exists = (res.body.molds || []).some((m) => Number(m.moldId) === Number(ids.moldId));
        expect(exists).toBe(false);
    });
});

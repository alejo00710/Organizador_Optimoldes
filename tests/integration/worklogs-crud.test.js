const request = require('supertest');
const crypto = require('crypto');

const app = require('../../server/src/app');
const { createUserAndToken } = require('../helpers/auth');
const { query } = require('../../server/src/config/database');
const { ROLES } = require('../../server/src/utils/constants');

describe('Tiempos de Moldes / work_logs (CRUD básico)', () => {
    let ctx;
    let ids;
    let workLogId;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.ADMIN });

        const suffix = crypto.randomUUID().slice(0, 8);
        const operatorName = `jest_op_${suffix}`;
        const machineName = `jest_machine_${suffix}`;
        const moldName = `jest_mold_${suffix}`;
        const partName = `jest_part_${suffix}`;

        const opRes = await query('INSERT INTO operators (name, user_id, is_active) VALUES (?, NULL, TRUE)', [
            operatorName,
        ]);
        const machineRes = await query('INSERT INTO machines (name, is_active) VALUES (?, TRUE)', [machineName]);
        const moldRes = await query('INSERT INTO molds (name, is_active) VALUES (?, TRUE)', [moldName]);
        const partRes = await query('INSERT INTO mold_parts (name, is_active) VALUES (?, TRUE)', [partName]);

        ids = {
            operatorId: opRes.insertId,
            machineId: machineRes.insertId,
            moldId: moldRes.insertId,
            partId: partRes.insertId,
        };

        await query(
            `INSERT INTO plan_entries (mold_id, part_id, machine_id, date, hours_planned, created_by)
             VALUES (?, ?, ?, ?, ?, ?),
                    (?, ?, ?, ?, ?, ?)`,
            [
                ids.moldId,
                ids.partId,
                ids.machineId,
                '2026-01-14',
                3,
                ctx.userId,
                ids.moldId,
                ids.partId,
                ids.machineId,
                '2026-01-20',
                5,
                ctx.userId,
            ]
        );
    });

    afterAll(async () => {
        // Cleanup en orden: work_logs -> catálogos -> user
        if (workLogId) {
            await request(app)
                .delete(`/api/work_logs/${workLogId}`)
                .set('Authorization', `Bearer ${ctx.token}`);
        }
        if (ids?.moldId && ids?.partId && ids?.machineId) {
            await query(
                'DELETE FROM plan_entries WHERE mold_id = ? AND part_id = ? AND machine_id = ?',
                [ids.moldId, ids.partId, ids.machineId]
            );
        }
        if (ids?.operatorId) await query('DELETE FROM operators WHERE id = ?', [ids.operatorId]);
        if (ids?.machineId) await query('DELETE FROM machines WHERE id = ?', [ids.machineId]);
        if (ids?.moldId) await query('DELETE FROM molds WHERE id = ?', [ids.moldId]);
        if (ids?.partId) await query('DELETE FROM mold_parts WHERE id = ?', [ids.partId]);

        if (ctx?.cleanup) await ctx.cleanup();
    });

    it('POST /api/work_logs crea un registro', async () => {
        const res = await request(app)
            .post('/api/work_logs')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldId: ids.moldId,
                partId: ids.partId,
                machineId: ids.machineId,
                operatorId: ids.operatorId,
                hours_worked: 2.5,
                note: 'jest',
                work_date: '2026-01-13',
            })
            .expect(201);

        expect(res.body).toHaveProperty('data');
        expect(res.body.data).toHaveProperty('id');
        workLogId = res.body.data.id;
    });

    it('GET /api/work_logs lista registros (200)', async () => {
        const res = await request(app)
            .get('/api/work_logs?limit=20&offset=0')
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        expect(Array.isArray(res.body)).toBe(true);

        const created = res.body.find((row) => Number(row.id) === Number(workLogId));
        expect(created).toBeTruthy();
        expect(Number(created.planned_hours)).toBeCloseTo(8, 2);
        expect(Number(created.diff_hours)).toBeCloseTo(-5.5, 2);
    });

    it('PUT /api/work_logs/:id actualiza horas', async () => {
        const res = await request(app)
            .put(`/api/work_logs/${workLogId}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ hours_worked: 3 })
            .expect(200);

        expect(res.body).toHaveProperty('message');
    });

    it('DELETE /api/work_logs/:id elimina (admin/planner)', async () => {
        const res = await request(app)
            .delete(`/api/work_logs/${workLogId}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        expect(res.body).toHaveProperty('message');
        workLogId = null;
    });

    it('bloquea DELETE sin rol (403)', async () => {
        const opCtx = await createUserAndToken({ role: ROLES.OPERATOR });
        const createRes = await request(app)
            .post('/api/work_logs')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldId: ids.moldId,
                partId: ids.partId,
                machineId: ids.machineId,
                operatorId: ids.operatorId,
                hours_worked: 1,
                work_date: '2026-01-13',
            })
            .expect(201);

        const id = createRes.body.data.id;

        await request(app)
            .delete(`/api/work_logs/${id}`)
            .set('Authorization', `Bearer ${opCtx.token}`)
            .expect(403);

        // Cleanup real
        await request(app)
            .delete(`/api/work_logs/${id}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        await opCtx.cleanup();
    });
});

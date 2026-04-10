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

        const partOtherRes = await query('INSERT INTO mold_parts (name, is_active) VALUES (?, TRUE)', [
            `${partName}_other`,
        ]);
        ids.partIdOther = partOtherRes.insertId;

        await query(
            `INSERT INTO planning_history (mold_id, event_type, to_start_date, created_by)
             VALUES (?, 'PLANNED', ?, ?)`,
            [ids.moldId, '2026-01-14', ctx.userId]
        );
        const planningRows = await query(
            `SELECT id
             FROM planning_history
             WHERE mold_id = ? AND event_type = 'PLANNED'
             ORDER BY id DESC
             LIMIT 1`,
            [ids.moldId]
        );
        ids.planningId = Number(planningRows?.[0]?.id || 0);

        await query(
            `INSERT INTO planning_history (mold_id, event_type, to_start_date, created_by)
             VALUES (?, 'PLANNED', ?, ?)`,
            [ids.moldId, '2026-02-01', ctx.userId]
        );
        const planningNoCellRows = await query(
            `SELECT id
             FROM planning_history
             WHERE mold_id = ? AND event_type = 'PLANNED'
             ORDER BY id DESC
             LIMIT 1`,
            [ids.moldId]
        );
        ids.invalidPlanningId = Number(planningNoCellRows?.[0]?.id || 0);

        await query(
            `INSERT INTO plan_entries (mold_id, planning_id, part_id, machine_id, date, hours_planned, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?),
                    (?, ?, ?, ?, ?, ?, ?)`,
            [
                ids.moldId,
                ids.planningId,
                ids.partId,
                ids.machineId,
                '2026-01-14',
                3,
                ctx.userId,
                ids.moldId,
                ids.planningId,
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

        if (ids?.moldId) {
            await query('DELETE FROM work_logs WHERE mold_id = ?', [ids.moldId]);
        }

        if (ids?.moldId && ids?.partId && ids?.machineId) {
            await query(
                'DELETE FROM plan_entries WHERE mold_id = ? AND part_id = ? AND machine_id = ?',
                [ids.moldId, ids.partId, ids.machineId]
            );
        }
        if (ids?.planningId) await query('DELETE FROM planning_history WHERE id = ?', [ids.planningId]);
        if (ids?.invalidPlanningId) await query('DELETE FROM planning_history WHERE id = ?', [ids.invalidPlanningId]);
        if (ids?.operatorId) await query('DELETE FROM operators WHERE id = ?', [ids.operatorId]);
        if (ids?.machineId) await query('DELETE FROM machines WHERE id = ?', [ids.machineId]);
        if (ids?.moldId) await query('DELETE FROM molds WHERE id = ?', [ids.moldId]);
        if (ids?.partId) await query('DELETE FROM mold_parts WHERE id = ?', [ids.partId]);
        if (ids?.partIdOther) await query('DELETE FROM mold_parts WHERE id = ?', [ids.partIdOther]);

        if (ctx?.cleanup) await ctx.cleanup();
    });

    it('POST /api/work_logs crea un registro con planning_id válido', async () => {
        const res = await request(app)
            .post('/api/work_logs')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldId: ids.moldId,
                planning_id: ids.planningId,
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

    it('GET /api/work_logs calcula desviación acumulada cuando una tarea se divide en varios días', async () => {
        const tempPartName = `jest_part_split_${crypto.randomUUID().slice(0, 8)}`;
        const tempPartRes = await query('INSERT INTO mold_parts (name, is_active) VALUES (?, TRUE)', [tempPartName]);
        const tempPartId = Number(tempPartRes?.insertId || 0);
        expect(tempPartId).toBeGreaterThan(0);

        let mondayId = 0;
        let tuesdayId = 0;

        try {
            await query(
                `INSERT INTO plan_entries (mold_id, planning_id, part_id, machine_id, date, hours_planned, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?),
                        (?, ?, ?, ?, ?, ?, ?)` ,
                [
                    ids.moldId,
                    ids.planningId,
                    tempPartId,
                    ids.machineId,
                    '2026-01-19',
                    4,
                    ctx.userId,
                    ids.moldId,
                    ids.planningId,
                    tempPartId,
                    ids.machineId,
                    '2026-01-20',
                    6,
                    ctx.userId,
                ]
            );

            const mondayRes = await request(app)
                .post('/api/work_logs')
                .set('Authorization', `Bearer ${ctx.token}`)
                .send({
                    moldId: ids.moldId,
                    planning_id: ids.planningId,
                    partId: tempPartId,
                    machineId: ids.machineId,
                    operatorId: ids.operatorId,
                    hours_worked: 9.5,
                    note: 'split-monday',
                    work_date: '2026-01-19',
                })
                .expect(201);

            const tuesdayRes = await request(app)
                .post('/api/work_logs')
                .set('Authorization', `Bearer ${ctx.token}`)
                .send({
                    moldId: ids.moldId,
                    planning_id: ids.planningId,
                    partId: tempPartId,
                    machineId: ids.machineId,
                    operatorId: ids.operatorId,
                    hours_worked: 0.5,
                    note: 'split-tuesday',
                    work_date: '2026-01-20',
                })
                .expect(201);

            mondayId = Number(mondayRes?.body?.data?.id || 0);
            tuesdayId = Number(tuesdayRes?.body?.data?.id || 0);
            expect(mondayId).toBeGreaterThan(0);
            expect(tuesdayId).toBeGreaterThan(0);

            const listRes = await request(app)
                .get('/api/work_logs?limit=200&offset=0')
                .set('Authorization', `Bearer ${ctx.token}`)
                .expect(200);

            const mondayRow = listRes.body.find((row) => Number(row.id) === mondayId);
            const tuesdayRow = listRes.body.find((row) => Number(row.id) === tuesdayId);

            expect(mondayRow).toBeTruthy();
            expect(tuesdayRow).toBeTruthy();

            // El histórico conserva horas individuales por registro.
            expect(Number(mondayRow.hours_worked)).toBeCloseTo(9.5, 2);
            expect(Number(tuesdayRow.hours_worked)).toBeCloseTo(0.5, 2);

            // La desviación/alerta debe calcularse sobre el acumulado de la tarea (9.5 + 0.5 = 10).
            expect(Number(mondayRow.total_task_hours)).toBeCloseTo(10, 2);
            expect(Number(tuesdayRow.total_task_hours)).toBeCloseTo(10, 2);
            expect(Number(mondayRow.planned_hours)).toBeCloseTo(10, 2);
            expect(Number(tuesdayRow.planned_hours)).toBeCloseTo(10, 2);
            expect(Number(mondayRow.diff_hours)).toBeCloseTo(0, 2);
            expect(Number(tuesdayRow.diff_hours)).toBeCloseTo(0, 2);
            expect(Number(mondayRow.deviation_pct)).toBeCloseTo(0, 2);
            expect(Number(tuesdayRow.deviation_pct)).toBeCloseTo(0, 2);
            expect(Number(mondayRow.is_alert)).toBe(0);
            expect(Number(tuesdayRow.is_alert)).toBe(0);
        } finally {
            await query('DELETE FROM work_logs WHERE id IN (?, ?)', [mondayId || -1, tuesdayId || -1]);
            await query('DELETE FROM plan_entries WHERE planning_id = ? AND part_id = ? AND machine_id = ?', [
                ids.planningId,
                tempPartId,
                ids.machineId,
            ]);
            await query('DELETE FROM mold_parts WHERE id = ?', [tempPartId]);
        }
    });

    it('POST /api/work_logs retorna 422 si falta planning_id', async () => {
        await request(app)
            .post('/api/work_logs')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldId: ids.moldId,
                partId: ids.partId,
                machineId: ids.machineId,
                operatorId: ids.operatorId,
                hours_worked: 1,
                work_date: '2026-01-14',
            })
            .expect(422);
    });

    it('POST /api/work_logs retorna 409 si la celda no pertenece al ciclo', async () => {
        await request(app)
            .post('/api/work_logs')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldId: ids.moldId,
                planning_id: ids.planningId,
                partId: ids.partIdOther,
                machineId: ids.machineId,
                operatorId: ids.operatorId,
                hours_worked: 1.5,
                work_date: '2026-01-14',
            })
            .expect(409);
    });

    it('PUT /api/work_logs/:id actualiza sin enviar planning_id', async () => {
        const res = await request(app)
            .put(`/api/work_logs/${workLogId}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                hours_worked: 3,
            })
            .expect(200);

        expect(res.body).toHaveProperty('message');
        expect(Number(res.body?.data?.planning_id || 0)).toBe(ids.planningId);
    });

    it('PUT /api/work_logs/:id ignora planning_id enviado y conserva el original', async () => {
        const res = await request(app)
            .put(`/api/work_logs/${workLogId}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                planning_id: ids.invalidPlanningId,
                hours_worked: 2,
            })
            .expect(200);

        expect(Number(res.body?.data?.planning_id || 0)).toBe(ids.planningId);

        const rows = await query('SELECT planning_id FROM work_logs WHERE id = ? LIMIT 1', [workLogId]);
        expect(Number(rows?.[0]?.planning_id || 0)).toBe(ids.planningId);
    });

    it('PUT /api/work_logs/:id no permite desmarcar un registro final', async () => {
        await request(app)
            .put(`/api/work_logs/${workLogId}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                hours_worked: 2.5,
                is_final_log: true,
            })
            .expect(200);

        const res = await request(app)
            .put(`/api/work_logs/${workLogId}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                hours_worked: 2,
                is_final_log: false,
            })
            .expect(400);

        expect(String(res.body?.error || '')).toContain('No se puede desmarcar un registro final');

        const rows = await query('SELECT is_final_log FROM work_logs WHERE id = ? LIMIT 1', [workLogId]);
        expect(rows?.[0]?.is_final_log).toBe(true);
    });

    it('DELETE /api/work_logs/:id reabre ciclo si se elimina el último final_log', async () => {
        const finalLogId = Number(workLogId || 0);
        expect(finalLogId).toBeGreaterThan(0);

        const statusBeforeRows = await query(
            `SELECT status
             FROM planning_history
             WHERE id = ?
             LIMIT 1`,
            [ids.planningId]
        );
        expect(String(statusBeforeRows?.[0]?.status || '').toUpperCase()).toBe('COMPLETED');

        await request(app)
            .delete(`/api/work_logs/${finalLogId}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        const statusAfterRows = await query(
            `SELECT status
             FROM planning_history
             WHERE id = ?
             LIMIT 1`,
            [ids.planningId]
        );
        expect(String(statusAfterRows?.[0]?.status || '').toUpperCase()).toBe('IN_PROGRESS');

        // Reponer un registro no final para las pruebas siguientes de DELETE.
        const replacementRes = await request(app)
            .post('/api/work_logs')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldId: ids.moldId,
                planning_id: ids.planningId,
                partId: ids.partId,
                machineId: ids.machineId,
                operatorId: ids.operatorId,
                hours_worked: 1,
                work_date: '2026-01-15',
            })
            .expect(201);

        workLogId = Number(replacementRes?.body?.data?.id || 0);
        expect(workLogId).toBeGreaterThan(0);
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
                planning_id: ids.planningId,
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

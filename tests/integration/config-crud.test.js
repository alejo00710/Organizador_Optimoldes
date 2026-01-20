const request = require('supertest');
const crypto = require('crypto');

const app = require('../../server/src/app');
const { createUserAndToken } = require('../helpers/auth');
const { query } = require('../../server/src/config/database');
const { ROLES } = require('../../server/src/utils/constants');

describe('Configuración (CRUD básico)', () => {
    let ctx;

    const suffix = crypto.randomUUID().slice(0, 8);
    const machineName1 = `jest_machine_cfg_${suffix}`;
    const machineName2 = `jest_machine_cfg2_${suffix}`;
    const moldName = `jest_mold_cfg_${suffix}`;
    const partName = `jest_part_cfg_${suffix}`;
    const operatorName = `jest_operator_cfg_${suffix}`;
    const operatorPassword = `Pass_${suffix}_123!`;

    let machineId;
    let moldId;
    let partId;
    let operatorId;
    let operatorUserId;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.ADMIN });
    });

    afterAll(async () => {
        try {
            if (operatorId) await query('DELETE FROM operators WHERE id = ?', [operatorId]);
            if (operatorUserId) await query('DELETE FROM users WHERE id = ?', [operatorUserId]);
            if (moldId) await query('DELETE FROM molds WHERE id = ?', [moldId]);
            if (partId) await query('DELETE FROM mold_parts WHERE id = ?', [partId]);
            if (machineId) await query('DELETE FROM machines WHERE id = ?', [machineId]);
        } finally {
            if (ctx?.cleanup) await ctx.cleanup();
        }
    });

    it('máquinas: crear + actualizar (nombre/capacidad/activo)', async () => {
        const createRes = await request(app)
            .post('/api/config/machines')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ name: machineName1, daily_capacity: 8 })
            .expect(201);

        expect(createRes.body).toHaveProperty('id');
        machineId = createRes.body.id;

        await request(app)
            .put(`/api/config/machines/${machineId}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ name: machineName2, daily_capacity: 7.5, is_active: false })
            .expect(200);

        const rows = await query('SELECT name, daily_capacity, is_active FROM machines WHERE id = ? LIMIT 1', [
            machineId,
        ]);
        expect(rows.length).toBe(1);
        expect(rows[0].name).toBe(machineName2);
        expect(Number(rows[0].daily_capacity)).toBe(7.5);
        expect(Boolean(rows[0].is_active)).toBe(false);
    });

    it('moldes: crear (201)', async () => {
        const res = await request(app)
            .post('/api/config/molds')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ name: moldName })
            .expect(201);

        expect(res.body).toHaveProperty('id');
        moldId = res.body.id;
    });

    it('partes: crear inactiva + activar y aparece en listado', async () => {
        const res = await request(app)
            .post('/api/config/parts')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ name: partName })
            .expect(201);

        expect(res.body).toHaveProperty('id');
        partId = res.body.id;

        await request(app)
            .put(`/api/config/parts/${partId}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ is_active: true })
            .expect(200);

        const listRes = await request(app)
            .get('/api/config/parts')
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        const hit = (listRes.body || []).find((p) => p && p.id === partId);
        expect(hit).toBeTruthy();
        expect(Boolean(hit.is_active)).toBe(true);
    });

    it('operarios: crear sin contraseña, luego asignar contraseña y permitir login por "operarios"', async () => {
        const createRes = await request(app)
            .post('/api/config/operators')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ name: operatorName })
            .expect(201);

        expect(createRes.body).toHaveProperty('operatorId');
        operatorId = createRes.body.operatorId;

        await request(app)
            .put(`/api/config/operators/${operatorId}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ password: operatorPassword })
            .expect(200);

        const opRows = await query('SELECT user_id FROM operators WHERE id = ? LIMIT 1', [operatorId]);
        operatorUserId = opRows?.[0]?.user_id || null;
        expect(operatorUserId).toBeTruthy();

        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ username: 'operarios', password: operatorPassword, operatorId })
            .expect(200);

        expect(loginRes.body).toHaveProperty('token');
        expect(loginRes.body).toHaveProperty('user');
        expect(loginRes.body.user).toHaveProperty('role', ROLES.OPERATOR);
        expect(loginRes.body.user).toHaveProperty('operatorId', operatorId);
    });
});

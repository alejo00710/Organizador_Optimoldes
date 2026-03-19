const request = require('supertest');

const app = require('../../server/src/app');
const { createUserAndToken } = require('../helpers/auth');
const { ROLES } = require('../../server/src/utils/constants');
const { query } = require('../../server/src/config/database');

describe('Datos (CRUD básico)', () => {
    let ctx;
    const cleanupIds = new Set();

    const rememberCreatedIds = (body) => {
        if (!body || typeof body !== 'object') return;
        if (body.id) cleanupIds.add(Number(body.id));
        if (Array.isArray(body.created_ids)) {
            for (const id of body.created_ids) cleanupIds.add(Number(id));
        }
    };

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.ADMIN });
    });

    afterAll(async () => {
        for (const id of cleanupIds) {
            await request(app)
                .delete(`/api/datos/${id}`)
                .set('Authorization', `Bearer ${ctx.token}`);
        }
        if (ctx?.cleanup) await ctx.cleanup();
    });

    it('POST /api/datos crea filas independientes por cada campo enviado', async () => {
        const unique = Date.now();
        const uniqueYear = 2500 + (unique % 300);
        const res = await request(app)
            .post('/api/datos')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                anio: uniqueYear,
                tipo_proceso: `ESTRIPAR QA SPLIT ${unique}`,
                operacion: `OPER QA SPLIT ${unique}`,
                horas: 77.77,
            })
            .expect(201);

        expect(res.body).toHaveProperty('created_count', 4);
        expect(Array.isArray(res.body.created_ids)).toBe(true);
        expect(res.body.created_ids).toHaveLength(4);
        rememberCreatedIds(res.body);

        const rows = await query(
            `SELECT id, dia, mes, anio, nombre_operario, tipo_proceso, molde, parte, maquina, operacion, horas
             FROM datos
             WHERE id = ANY(?::int[])
             ORDER BY id ASC`,
            [res.body.created_ids]
        );

        expect(rows).toHaveLength(4);
        const withAnio = rows.filter(r => r.anio !== null);
        const withProceso = rows.filter(r => r.tipo_proceso !== null);
        const withOperacion = rows.filter(r => r.operacion !== null);
        const withHoras = rows.filter(r => r.horas !== null);
        expect(withAnio).toHaveLength(1);
        expect(withProceso).toHaveLength(1);
        expect(withOperacion).toHaveLength(1);
        expect(withHoras).toHaveLength(1);
    });

    it('GET /api/datos devuelve paginación', async () => {
        const res = await request(app)
            .get('/api/datos?limit=5&offset=0')
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        expect(res.body).toHaveProperty('total');
        expect(res.body).toHaveProperty('items');
        expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('DELETE /api/datos/:id elimina el registro', async () => {
        const create = await request(app)
            .post('/api/datos')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ anio: 2041 })
            .expect(201);

        const id = create.body.id;

        const res = await request(app)
            .delete(`/api/datos/${id}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        expect(res.body).toHaveProperty('message');
    });

    it('POST /api/datos no permite crear un duplicado (insensible a mayúsculas)', async () => {
        const payload = {
            tipo_proceso: 'ESTRIPAR DUP QA',
        };

        const first = await request(app)
            .post('/api/datos')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send(payload)
            .expect(201);
        rememberCreatedIds(first.body);

        const duplicatePayloadCaseVariant = {
            ...payload,
            tipo_proceso: 'estripar dup qa',
        };

        const second = await request(app)
            .post('/api/datos')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send(duplicatePayloadCaseVariant)
            .expect(409);

        expect(second.body).toHaveProperty('error');
        expect(second.body).toHaveProperty('existing_id', first.body.id);
    });

    it('POST /api/datos crea los nuevos y omite los ya existentes en envío mixto', async () => {
        const first = await request(app)
            .post('/api/datos')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ anio: 2042 })
            .expect(201);
        rememberCreatedIds(first.body);

        const mixed = await request(app)
            .post('/api/datos')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ anio: 2042, tipo_proceso: 'PROCESO NUEVO MIXTO QA' })
            .expect(201);

        expect(mixed.body).toHaveProperty('created_count', 1);
        expect(mixed.body).toHaveProperty('skipped_count', 1);
        rememberCreatedIds(mixed.body);
    });

    it('PUT /api/datos/:id no permite actualizar a un duplicado', async () => {
        const base = await request(app)
            .post('/api/datos')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ tipo_proceso: 'PULIDO UPDATE QA' })
            .expect(201);
        rememberCreatedIds(base.body);

        const target = await request(app)
            .post('/api/datos')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ tipo_proceso: 'CORTE UPDATE QA' })
            .expect(201);
        rememberCreatedIds(target.body);

        const updateRes = await request(app)
            .put(`/api/datos/${target.body.id}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ tipo_proceso: 'pulido update qa' })
            .expect(409);

        expect(updateRes.body).toHaveProperty('error');
        expect(updateRes.body).toHaveProperty('existing_id', base.body.id);
    });

    it('PUT /api/datos/:id no permite escribir en columnas vacías', async () => {
        const created = await request(app)
            .post('/api/datos')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ anio: 2050 })
            .expect(201);
        rememberCreatedIds(created.body);

        const res = await request(app)
            .put(`/api/datos/${created.body.id}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ tipo_proceso: 'NO DEBE GUARDAR DESDE EDICION' })
            .expect(400);

        expect(res.body).toHaveProperty('error');
        expect(Array.isArray(res.body.blocked_fields)).toBe(true);
        expect(res.body.blocked_fields).toContain('tipo_proceso');
    });
});

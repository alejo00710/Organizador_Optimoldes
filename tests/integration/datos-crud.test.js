const request = require('supertest');

const app = require('../../server/src/app');
const { createUserAndToken } = require('../helpers/auth');
const { ROLES } = require('../../server/src/utils/constants');

describe('Datos (CRUD básico)', () => {
    let ctx;
    let createdId;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.ADMIN });
    });

    afterAll(async () => {
        if (createdId) {
            // Mejor esfuerzo de cleanup
            await request(app)
                .delete(`/api/datos/${createdId}`)
                .set('Authorization', `Bearer ${ctx.token}`);
        }
        if (ctx?.cleanup) await ctx.cleanup();
    });

    it('POST /api/datos crea un registro (mínimo)', async () => {
        const res = await request(app)
            .post('/api/datos')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ anio: 2026, mes: 'enero', horas: 1.25 })
            .expect(201);

        expect(res.body).toHaveProperty('id');
        createdId = res.body.id;
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
        const res = await request(app)
            .delete(`/api/datos/${createdId}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        expect(res.body).toHaveProperty('message');
        createdId = null;
    });
});

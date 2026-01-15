const request = require('supertest');

const app = require('../../server/src/app');
const { createUserAndToken } = require('../helpers/auth');
const { ROLES } = require('../../server/src/utils/constants');

describe('Planificador (smoke)', () => {
    let ctx;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.PLANNER });
    });

    afterAll(async () => {
        if (ctx?.cleanup) await ctx.cleanup();
    });

    it('GET /api/tasks/plan/molds responde 200 (puede ser vacío)', async () => {
        const res = await request(app)
            .get('/api/tasks/plan/molds')
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        expect(res.body).toHaveProperty('molds');
        expect(Array.isArray(res.body.molds)).toBe(true);
    });

    it('GET /api/tasks/plan/snapshot sin parámetros devuelve 400/200 pero no 500', async () => {
        const res = await request(app)
            .get('/api/tasks/plan/snapshot')
            .set('Authorization', `Bearer ${ctx.token}`);

        expect([200, 400]).toContain(res.statusCode);
    });
});

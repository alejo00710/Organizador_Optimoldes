const request = require('supertest');

const app = require('../../server/src/app');
const { createUserAndToken } = require('../helpers/auth');
const { ROLES } = require('../../server/src/utils/constants');

describe('Indicadores (smoke)', () => {
    let ctx;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.PLANNER });
    });

    afterAll(async () => {
        if (ctx?.cleanup) await ctx.cleanup();
    });

    it('GET /api/indicators/summary?year=2026', async () => {
        const res = await request(app)
            .get('/api/indicators/summary?year=2026')
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        expect(res.body).toHaveProperty('year', 2026);
        expect(res.body).toHaveProperty('tables');
        expect(res.body.tables).toHaveProperty('hours');
        expect(res.body.tables).toHaveProperty('days');
        expect(res.body.tables).toHaveProperty('indicator');
    });

    it('bloquea sin token (401)', async () => {
        await request(app).get('/api/indicators/summary?year=2026').expect(401);
    });
});

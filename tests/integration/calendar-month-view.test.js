const request = require('supertest');

const app = require('../../server/src/app');
const { createUserAndToken } = require('../helpers/auth');
const { ROLES } = require('../../server/src/utils/constants');

describe('Calendar (month-view)', () => {
    let ctx;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.PLANNER });
    });

    afterAll(async () => {
        if (ctx?.cleanup) await ctx.cleanup();
    });

    it('GET /api/calendar/month-view devuelve events/holidays/overrides', async () => {
        const res = await request(app)
            .get('/api/calendar/month-view?year=2026&month=1')
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        expect(res.body).toHaveProperty('events');
        expect(res.body).toHaveProperty('holidays');
        expect(res.body).toHaveProperty('overrides');
    });

    it('valida parámetros (400 si month inválido)', async () => {
        await request(app)
            .get('/api/calendar/month-view?year=2026&month=13')
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(400);
    });
});

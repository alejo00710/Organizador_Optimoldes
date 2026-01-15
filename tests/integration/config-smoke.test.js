const request = require('supertest');

const app = require('../../server/src/app');
const { createUserAndToken } = require('../helpers/auth');
const { ROLES } = require('../../server/src/utils/constants');

describe('Configuración (smoke)', () => {
    let ctx;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.ADMIN });
    });

    afterAll(async () => {
        if (ctx?.cleanup) await ctx.cleanup();
    });

    it('GET /api/config/machines', async () => {
        const res = await request(app)
            .get('/api/config/machines')
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/config/molds', async () => {
        const res = await request(app)
            .get('/api/molds')
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/config/parts', async () => {
        const res = await request(app)
            .get('/api/config/parts')
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/config/operators', async () => {
        const res = await request(app)
            .get('/api/config/operators')
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

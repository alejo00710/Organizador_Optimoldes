const request = require('supertest');

const app = require('../../server/src/app');
const { createUserAndToken } = require('../helpers/auth');
const { ROLES } = require('../../server/src/utils/constants');

describe('Sesiones (smoke)', () => {
    let ctx;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.ADMIN });
    });

    afterAll(async () => {
        if (ctx?.cleanup) await ctx.cleanup();
    });

    it('GET /api/auth/sessions responde array (admin)', async () => {
        const res = await request(app)
            .get('/api/auth/sessions')
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        expect(Array.isArray(res.body)).toBe(true);
    });
});

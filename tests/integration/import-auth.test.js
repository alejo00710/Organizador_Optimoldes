const request = require('supertest');

const app = require('../../server/src/app');
const { createUserAndToken } = require('../helpers/auth');
const { ROLES } = require('../../server/src/utils/constants');

describe('Importar datos (smoke)', () => {
    let ctx;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.ADMIN });
    });

    afterAll(async () => {
        if (ctx?.cleanup) await ctx.cleanup();
    });

    it('requiere token (401)', async () => {
        await request(app).post('/api/import/datos').expect(401);
    });

    it('con token pero sin archivo devuelve 400', async () => {
        await request(app)
            .post('/api/import/datos')
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(400);
    });
});

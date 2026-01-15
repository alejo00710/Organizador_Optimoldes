const request = require('supertest');

const app = require('../../server/src/app');

describe('Auth bootstrap', () => {
    it('GET /api/auth/bootstrap/status responde flags', async () => {
        const res = await request(app).get('/api/auth/bootstrap/status').expect(200);

        expect(res.body).toHaveProperty('adminExists');
        expect(res.body).toHaveProperty('jefeExists');
        expect(res.body).toHaveProperty('canBootstrap');

        expect(typeof res.body.adminExists).toBe('boolean');
        expect(typeof res.body.jefeExists).toBe('boolean');
        expect(typeof res.body.canBootstrap).toBe('boolean');
    });
});

const request = require('supertest');

const app = require('../../server/src/app');

describe('GET /health', () => {
    it('responde ok y metadata básica', async () => {
        const res = await request(app).get('/health').expect(200);

        expect(res.body).toHaveProperty('status', 'ok');
        expect(res.body).toHaveProperty('timestamp');
        expect(res.body).toHaveProperty('uptime');
    });
});

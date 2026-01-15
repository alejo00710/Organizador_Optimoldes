const request = require('supertest');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const app = require('../../server/src/app');
const { query } = require('../../server/src/config/database');
const { ROLES } = require('../../server/src/utils/constants');

describe('Auth login + verify (E2E)', () => {
    let userId;
    let username;
    const password = 'TestPassword123!';

    beforeAll(async () => {
        username = `jest_${crypto.randomUUID().slice(0, 8)}`;
        const hash = await bcrypt.hash(password, 10);

        const res = await query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [
            username,
            hash,
            ROLES.ADMIN,
        ]);
        userId = res.insertId;

        if (!userId) {
            throw new Error('No se pudo crear usuario de test (insertId vacío)');
        }
    });

    afterAll(async () => {
        if (userId) {
            // Borra también user_sessions por FK ON DELETE CASCADE
            await query('DELETE FROM users WHERE id = ?', [userId]);
        }
    });

    it('permite login y luego verify con JWT', async () => {
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ username, password })
            .expect(200);

        expect(loginRes.body).toHaveProperty('token');
        expect(loginRes.body).toHaveProperty('user');
        expect(loginRes.body.user).toHaveProperty('id', userId);
        expect(loginRes.body.user).toHaveProperty('username', username);
        expect(loginRes.body.user).toHaveProperty('role', ROLES.ADMIN);

        const token = loginRes.body.token;

        const verifyRes = await request(app)
            .get('/api/auth/verify')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        expect(verifyRes.body).toHaveProperty('message', 'Token válido');
        expect(verifyRes.body).toHaveProperty('user');
        expect(verifyRes.body.user).toHaveProperty('id', userId);
        expect(verifyRes.body.user).toHaveProperty('username', username);
        expect(verifyRes.body.user).toHaveProperty('role', ROLES.ADMIN);
    });
});

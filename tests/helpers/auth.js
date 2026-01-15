const bcrypt = require('bcrypt');
const crypto = require('crypto');
const request = require('supertest');

const app = require('../../server/src/app');
const { query } = require('../../server/src/config/database');

async function createTempUser({ role, password }) {
    const username = `jest_${String(role || 'user')}_${crypto.randomUUID().slice(0, 8)}`;
    const pwd = password || 'TestPassword123!';
    const hash = await bcrypt.hash(pwd, 10);

    const res = await query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [
        username,
        hash,
        role,
    ]);

    const userId = res.insertId;
    let operatorId = null;

    // Si es un usuario operario, debe existir un operador asociado para poder hacer login
    if (String(role) === 'operator' && userId) {
        const operatorName = `jest_operator_${crypto.randomUUID().slice(0, 8)}`;
        const opRes = await query(
            'INSERT INTO operators (name, user_id, is_active) VALUES (?, ?, TRUE)',
            [operatorName, userId]
        );
        operatorId = opRes.insertId;
    }

    return { userId, username, password: pwd, operatorId };
}

async function login({ username, password, operatorId }) {
    const res = await request(app)
        .post('/api/auth/login')
        .send(operatorId ? { username, password, operatorId } : { username, password })
        .expect(200);

    return { token: res.body.token, sessionId: res.body.sessionId, user: res.body.user };
}

async function createUserAndToken({ role }) {
    const u = await createTempUser({ role });
    const l = await login({ username: u.username, password: u.password, operatorId: u.operatorId });

    return {
        ...u,
        token: l.token,
        sessionId: l.sessionId,
        cleanup: async () => {
            if (u.userId) await query('DELETE FROM users WHERE id = ?', [u.userId]);
        },
    };
}

module.exports = {
    createTempUser,
    login,
    createUserAndToken,
};

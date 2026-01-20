const bcrypt = require('bcrypt');

const { query } = require('../../src/config/database');
const { ROLES } = require('../../src/utils/constants');

async function upsertMold({ name }) {
  const n = String(name || '').trim();
  if (!n) throw new Error('mold name required');

  const rows = await query('SELECT id FROM molds WHERE LOWER(name)=LOWER(?) LIMIT 1', [n]);
  if (rows.length) {
    const id = Number(rows[0].id);
    await query('UPDATE molds SET is_active = TRUE WHERE id = ?', [id]);
    return id;
  }

  const res = await query('INSERT INTO molds (name, is_active) VALUES (?, TRUE)', [n]);
  return Number(res.insertId);
}

async function upsertUser({ username, role, passwordHash }) {
  const rows = await query('SELECT id FROM users WHERE username = ?', [username]);
  if (rows.length) {
    const id = Number(rows[0].id);
    await query('UPDATE users SET password_hash = ?, role = ? WHERE id = ?', [passwordHash, role, id]);
    return id;
  }

  const res = await query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [
    username,
    passwordHash,
    role,
  ]);
  return Number(res.insertId);
}

async function upsertOperator({ name, userId, passwordHash }) {
  const rows = await query('SELECT id FROM operators WHERE name = ?', [name]);
  if (rows.length) {
    const id = Number(rows[0].id);
    await query(
      'UPDATE operators SET user_id = ?, password_hash = ?, is_active = TRUE WHERE id = ?',
      [userId, passwordHash, id]
    );
    return id;
  }

  const res = await query(
    'INSERT INTO operators (name, user_id, password_hash, is_active) VALUES (?, ?, ?, TRUE)',
    [name, userId, passwordHash]
  );
  return Number(res.insertId);
}

async function ensureE2EUsers() {
  const adminPassword = process.env.E2E_ADMIN_PASSWORD || 'E2E_Admin123!';
  const plannerPassword = process.env.E2E_PLANNER_PASSWORD || 'E2E_Planner123!';
  const operatorPassword = process.env.E2E_OPERATOR_PASSWORD || 'E2E_Operario123!';

  const operatorName = process.env.E2E_OPERATOR_NAME || 'E2E Operario';
  const operatorUsername = process.env.E2E_OPERATOR_USERNAME || 'e2e_operator_user';

  const adminHash = await bcrypt.hash(adminPassword, 10);
  const plannerHash = await bcrypt.hash(plannerPassword, 10);
  const operatorHash = await bcrypt.hash(operatorPassword, 10);

  const adminUserId = await upsertUser({ username: 'admin', role: ROLES.ADMIN, passwordHash: adminHash });
  const plannerUserId = await upsertUser({ username: 'jefe', role: ROLES.PLANNER, passwordHash: plannerHash });

  const operatorUserId = await upsertUser({
    username: operatorUsername,
    role: ROLES.OPERATOR,
    passwordHash: operatorHash,
  });

  const operatorId = await upsertOperator({ name: operatorName, userId: operatorUserId, passwordHash: operatorHash });

  return {
    admin: { username: 'admin', password: adminPassword, userId: adminUserId },
    planner: { username: 'jefe', password: plannerPassword, userId: plannerUserId },
    operator: { name: operatorName, password: operatorPassword, userId: operatorUserId, operatorId },
  };
}

async function ensureE2ECatalog({ moldName } = {}) {
  const name = moldName || process.env.E2E_MOLD_NAME || `E2E Mold ${Date.now()}`;
  const moldId = await upsertMold({ name });
  return { moldId, moldName: name };
}

module.exports = {
  ensureE2EUsers,
  ensureE2ECatalog,
};

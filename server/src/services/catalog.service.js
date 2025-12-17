const { query } = require('../config/database');

async function ensureByName(table, name) {
  const n = String(name || '').trim();
  if (!n) return null;
  const rows = await query(`SELECT id FROM ${table} WHERE LOWER(name)=LOWER(?) LIMIT 1`, [n]);
  if (rows.length) return rows[0].id;
  const res = await query(`INSERT INTO ${table} (name, is_active) VALUES (?, TRUE)`, [n]);
  return res.insertId;
}

module.exports = {
  ensureOperatorIdByName: (name) => ensureByName('operators', name),
  ensureProcessIdByName: (name) => ensureByName('processes', name),
  ensureMachineIdByName: (name) => ensureByName('machines', name),
  ensureMoldIdByName: (name) => ensureByName('molds', name),
  ensurePartIdByName: (name) => ensureByName('mold_parts', name),
  ensureOperationIdByName: (name) => ensureByName('operations', name),
};
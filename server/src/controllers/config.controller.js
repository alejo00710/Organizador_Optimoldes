const { query } = require('../config/database');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../utils/constants');

// LISTAR máquinas (para edición)
exports.listMachines = async (req, res, next) => {
  try {
    const rows = await query('SELECT id, name, daily_capacity, is_active, created_at FROM machines ORDER BY name ASC');
    res.json(rows);
  } catch (e) { next(e); }
};

// CREAR máquina: name + daily_capacity
exports.createMachine = async (req, res, next) => {
  try {
    const { name, daily_capacity } = req.body;
    if (!name || String(name).trim() === '') return res.status(400).json({ error:'Nombre requerido' });
    const cap = daily_capacity !== undefined && daily_capacity !== null && daily_capacity !== '' ? parseFloat(daily_capacity) : null;
    const result = await query('INSERT INTO machines (name, daily_capacity, is_active) VALUES (?, ?, TRUE)', [name.trim(), cap]);
    res.status(201).json({ id: result.insertId, name: name.trim(), daily_capacity: cap, is_active: 1 });
  } catch (e) { next(e); }
};

// ACTUALIZAR máquina: name, daily_capacity, is_active
exports.updateMachine = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, daily_capacity, is_active } = req.body;

    const current = await query('SELECT id FROM machines WHERE id = ?', [id]);
    if (!current.length) return res.status(404).json({ error:'Máquina no encontrada' });

    const fields = [];
    const vals = [];

    if (name !== undefined) { fields.push('name = ?'); vals.push(String(name).trim()); }
    if (daily_capacity !== undefined) {
      const cap = (daily_capacity === '' || daily_capacity === null) ? null : parseFloat(daily_capacity);
      fields.push('daily_capacity = ?'); vals.push(cap);
    }
    if (is_active !== undefined) { fields.push('is_active = ?'); vals.push(is_active ? 1 : 0); }

    if (!fields.length) return res.status(400).json({ error:'Nada para actualizar' });
    vals.push(id);

    await query(`UPDATE machines SET ${fields.join(', ')} WHERE id = ?`, vals);
    res.json({ message:'Máquina actualizada', id });
  } catch (e) { next(e); }
};

// CREAR molde
exports.createMold = async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || String(name).trim() === '') return res.status(400).json({ error:'Nombre requerido' });
    const result = await query('INSERT INTO molds (name, is_active) VALUES (?, TRUE)', [name.trim()]);
    res.status(201).json({ id: result.insertId, name: name.trim() });
  } catch (e) { next(e); }
};

// CREAR parte
exports.createPart = async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || String(name).trim() === '') return res.status(400).json({ error:'Nombre requerido' });
    // Por defecto se crea INACTIVA para que el checklist decida qué se muestra.
    const result = await query('INSERT INTO mold_parts (name, is_active) VALUES (?, FALSE)', [name.trim()]);
    res.status(201).json({ id: result.insertId, name: name.trim(), is_active: 0 });
  } catch (e) { next(e); }
};

// LISTAR partes (incluye activas/inactivas) para checklist
exports.listParts = async (req, res, next) => {
  try {
    const rows = await query('SELECT id, name, is_active, created_at FROM mold_parts ORDER BY name ASC');
    res.json(rows);
  } catch (e) { next(e); }
};

// ACTUALIZAR parte (solo is_active)
exports.updatePart = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    const current = await query('SELECT id FROM mold_parts WHERE id = ?', [id]);
    if (!current.length) return res.status(404).json({ error:'Parte no encontrada' });

    if (is_active === undefined) return res.status(400).json({ error:'Nada para actualizar' });
    await query('UPDATE mold_parts SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, id]);
    res.json({ message:'Parte actualizada', id });
  } catch (e) { next(e); }
};

// CREAR operario con usuario+password (solo admin/jefe)
exports.createOperator = async (req, res, next) => {
  try {
    const { name, password } = req.body;
    if (!name || String(name).trim() === '') return res.status(400).json({ error:'Nombre requerido' });

    const trimmedName = String(name).trim();

    // Si no hay contraseña, creamos solo el operario (sin user todavía).
    // La contraseña se puede definir luego en la lista (PUT /config/operators/:id).
    if (!password) {
      const opRes = await query(
        'INSERT INTO operators (name, user_id, password_hash, is_active) VALUES (?, NULL, NULL, TRUE)',
        [trimmedName]
      );
      return res.status(201).json({ operatorId: opRes.insertId, userId: null, username: null, note: 'Operario creado sin contraseña' });
    }

    const username = `operario_${Date.now()}`;
    const password_hash = await bcrypt.hash(String(password), 10);

    const userRes = await query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, password_hash, 'operator']);
    const user_id = userRes.insertId;

    const opRes = await query(
      'INSERT INTO operators (name, user_id, password_hash, is_active) VALUES (?, ?, ?, TRUE)',
      [trimmedName, user_id, password_hash]
    );
    res.status(201).json({ operatorId: opRes.insertId, userId: user_id, username });
  } catch (e) { next(e); }
};

// LISTAR operarios (para edición)
exports.listOperators = async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT o.id, o.name, o.is_active, o.created_at, o.user_id, u.username,
             CASE
               WHEN COALESCE(o.password_hash, u.password_hash) IS NULL OR COALESCE(o.password_hash, u.password_hash) = '' THEN 0
               ELSE 1
             END AS has_password
      FROM operators o
      LEFT JOIN users u ON u.id = o.user_id
      ORDER BY o.name ASC
    `);
    res.json(rows);
  } catch (e) { next(e); }
};

// ACTUALIZAR operario: name, is_active, password (password solo admin/jefe)
exports.updateOperator = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, is_active, password } = req.body || {};

    const currentRows = await query('SELECT id, user_id FROM operators WHERE id = ?', [id]);
    if (!currentRows.length) return res.status(404).json({ error: 'Operario no encontrado' });
    const current = currentRows[0];

    const updates = [];
    const vals = [];

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) return res.status(400).json({ error: 'Nombre requerido' });
      updates.push('name = ?');
      vals.push(trimmed);
    }

    if (is_active !== undefined) {
      updates.push('is_active = ?');
      vals.push(is_active ? 1 : 0);
    }

    // Password reset/update (admin/planner)
    let createdUsername = null;
    if (password !== undefined) {
      if (!req.user || ![ROLES.ADMIN, ROLES.PLANNER].includes(req.user.role)) {
        return res.status(403).json({ error: 'Solo admin/jefe puede establecer/restablecer contraseña' });
      }
      if (!password) return res.status(400).json({ error: 'Contraseña requerida' });

      const password_hash = await bcrypt.hash(String(password), 10);

      if (current.user_id) {
        await query('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, current.user_id]);
        await query('UPDATE operators SET password_hash = ? WHERE id = ?', [password_hash, id]);
      } else {
        const username = `operario_${id}_${Date.now()}`;
        const userRes = await query(
          'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
          [username, password_hash, ROLES.OPERATOR]
        );
        const user_id = userRes.insertId;
        await query('UPDATE operators SET user_id = ?, password_hash = ? WHERE id = ?', [user_id, password_hash, id]);
        createdUsername = username;
      }
    }

    if (updates.length) {
      vals.push(id);
      await query(`UPDATE operators SET ${updates.join(', ')} WHERE id = ?`, vals);
    }

    if (!updates.length && password === undefined) {
      return res.status(400).json({ error: 'Nada para actualizar' });
    }

    res.json({
      message: 'Operario actualizado',
      id: Number(id),
      ...(createdUsername ? { username: createdUsername, note: 'Se creó usuario para este operario' } : {})
    });
  } catch (e) { next(e); }
};
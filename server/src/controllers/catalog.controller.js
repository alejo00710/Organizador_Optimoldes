const { query } = require('../config/database');

// GET /api/catalogs/meta  -> devuelve maestros y counts opcionales
exports.getMeta = async (req, res, next) => {
  try {
    // maestros desde tablas (molds, mold_parts, machines, operators) y years desde datos
    const molds = await query('SELECT id, name FROM molds ORDER BY name ASC');
    const parts = await query('SELECT id, name FROM mold_parts ORDER BY name ASC');
    const machines = await query('SELECT id, name FROM machines ORDER BY name ASC');
    const operators = await query('SELECT id, name FROM operators ORDER BY name ASC');
    const yearsRows = await query(`SELECT DISTINCT anio AS v FROM datos WHERE anio IS NOT NULL ORDER BY anio DESC`);
    res.json({
      molds, parts, machines, operators, years: yearsRows.map(r=>r.v)
    });
  } catch (e) { next(e); }
};

// POST /api/catalogs/sync  -> sincroniza masters desde datos (crea missing molds/parts/machines/operators)
// body optional: { createMissing: true } (por compatibilidad)
exports.syncFromDatos = async (req, res, next) => {
  try {
    // Traer valores únicos desde datos
    const rows = await query(`SELECT DISTINCT molde AS molde, parte AS parte, maquina AS maquina, nombre_operario AS operario FROM datos WHERE (molde IS NOT NULL AND molde <> '') OR (parte IS NOT NULL AND parte <> '') OR (maquina IS NOT NULL AND maquina <> '') OR (nombre_operario IS NOT NULL AND nombre_operario <> '')`);
    let created = { molds:0, parts:0, machines:0, operators:0 }, found = { molds:0, parts:0, machines:0, operators:0 };

    for (const r of rows) {
      const molde = r.molde ? String(r.molde).trim() : null;
      const parte = r.parte ? String(r.parte).trim() : null;
      const maquina = r.maquina ? String(r.maquina).trim() : null;
      const operario = r.operario ? String(r.operario).trim() : null;

      if (molde) {
        const existing = await query('SELECT id FROM molds WHERE LOWER(name)=LOWER(?) LIMIT 1', [molde]);
        if (existing.length) found.molds++; else { await query('INSERT INTO molds (name) VALUES (?)', [molde]); created.molds++; }
      }
      if (parte) {
        const existing = await query('SELECT id FROM mold_parts WHERE LOWER(name)=LOWER(?) LIMIT 1', [parte]);
        if (existing.length) found.parts++; else { await query('INSERT INTO mold_parts (name) VALUES (?)', [parte]); created.parts++; }
      }
      if (maquina) {
        const existing = await query('SELECT id FROM machines WHERE LOWER(name)=LOWER(?) LIMIT 1', [maquina]);
        if (existing.length) found.machines++; else { await query('INSERT INTO machines (name) VALUES (?)', [maquina]); created.machines++; }
      }
      if (operario) {
        const existing = await query('SELECT id FROM operators WHERE LOWER(name)=LOWER(?) LIMIT 1', [operario]);
        if (existing.length) found.operators++; else { await query('INSERT INTO operators (name, user_id) VALUES (?, NULL)', [operario]); created.operators++; }
      }
    }

    res.json({ message: 'Sincronización completada', created, found });
  } catch (e) { next(e); }
};
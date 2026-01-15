const { query } = require('../config/database');

// GET /api/catalogs/meta -> devuelve maestros (molds, parts, machines, operators, processes, operations) y years desde datos
exports.getMeta = async (req, res, next) => {
  try {
    const molds = await query('SELECT id, name, is_active FROM molds WHERE is_active = TRUE ORDER BY name ASC');
    const parts = await query('SELECT id, name, is_active FROM mold_parts WHERE is_active = TRUE ORDER BY name ASC');
    const machines = await query('SELECT id, name, daily_capacity, is_active FROM machines WHERE is_active = TRUE ORDER BY name ASC');
    const operators = await query('SELECT id, name, is_active FROM operators WHERE is_active = TRUE ORDER BY name ASC');
    // Importante: procesos/operaciones se crean automáticamente al crear/importar datos.
    // Para evitar que queden "fantasmas" en UI cuando se borran los últimos datos,
    // devolvemos SOLO los que están en uso por al menos un registro en datos.
    const processes = await query(`
      SELECT p.id, p.name, p.is_active
      FROM processes p
      WHERE p.is_active = TRUE
        AND EXISTS (
          SELECT 1 FROM datos d
          WHERE (d.process_id = p.id)
             OR (d.tipo_proceso IS NOT NULL AND d.tipo_proceso <> '' AND LOWER(d.tipo_proceso) = LOWER(p.name))
        )
      ORDER BY p.name ASC
    `);
    const operations = await query(`
      SELECT o.id, o.name, o.is_active
      FROM operations o
      WHERE o.is_active = TRUE
        AND EXISTS (
          SELECT 1 FROM datos d
          WHERE (d.operation_id = o.id)
             OR (d.operacion IS NOT NULL AND d.operacion <> '' AND LOWER(d.operacion) = LOWER(o.name))
        )
      ORDER BY o.name ASC
    `);
    const yearsRows = await query(`SELECT DISTINCT anio AS v FROM datos WHERE anio IS NOT NULL ORDER BY anio DESC`);
    res.json({
      molds, parts, machines, operators, processes, operations, years: yearsRows.map(r=>r.v)
    });
  } catch (e) { next(e); }
};

// POST /api/catalogs/sync -> sincroniza masters desde datos (crea faltantes por nombre)
exports.syncFromDatos = async (req, res, next) => {
  try {
    // Traer valores únicos desde datos (todas las columnas relevantes)
    const rows = await query(`
      SELECT DISTINCT
        nombre_operario AS operario,
        tipo_proceso    AS proceso,
        molde           AS molde,
        parte           AS parte,
        maquina         AS maquina,
        operacion       AS operacion
      FROM datos
      WHERE
        (nombre_operario IS NOT NULL AND nombre_operario <> '') OR
        (tipo_proceso    IS NOT NULL AND tipo_proceso    <> '') OR
        (molde           IS NOT NULL AND molde           <> '') OR
        (parte           IS NOT NULL AND parte           <> '') OR
        (maquina         IS NOT NULL AND maquina         <> '') OR
        (operacion       IS NOT NULL AND operacion       <> '')
    `);

    let created = { molds:0, parts:0, machines:0, operators:0, processes:0, operations:0 };
    let found   = { molds:0, parts:0, machines:0, operators:0, processes:0, operations:0 };

    for (const r of rows) {
      const molde    = r.molde    ? String(r.molde).trim()    : null;
      const parte    = r.parte    ? String(r.parte).trim()    : null;
      const maquina  = r.maquina  ? String(r.maquina).trim()  : null;
      const operario = r.operario ? String(r.operario).trim() : null;
      const proceso  = r.proceso  ? String(r.proceso).trim()  : null;
      const operac   = r.operacion? String(r.operacion).trim(): null;

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
        if (existing.length) found.machines++; else { await query('INSERT INTO machines (name, operarios_count, is_active) VALUES (?, 1, TRUE)', [maquina]); created.machines++; }
      }
      if (operario) {
        const existing = await query('SELECT id FROM operators WHERE LOWER(name)=LOWER(?) LIMIT 1', [operario]);
        if (existing.length) found.operators++; else { await query('INSERT INTO operators (name, user_id, is_active) VALUES (?, NULL, TRUE)', [operario]); created.operators++; }
      }
      if (proceso) {
        const existing = await query('SELECT id FROM processes WHERE LOWER(name)=LOWER(?) LIMIT 1', [proceso]);
        if (existing.length) found.processes++; else { await query('INSERT INTO processes (name, is_active) VALUES (?, TRUE)', [proceso]); created.processes++; }
      }
      if (operac) {
        const existing = await query('SELECT id FROM operations WHERE LOWER(name)=LOWER(?) LIMIT 1', [operac]);
        if (existing.length) found.operations++; else { await query('INSERT INTO operations (name, is_active) VALUES (?, TRUE)', [operac]); created.operations++; }
      }
    }

    res.json({ message: 'Sincronización completada', created, found });
  } catch (e) { next(e); }
};
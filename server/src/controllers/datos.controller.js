const { query } = require('../config/database');

const normalizeMes = (mes) => {
  if (!mes) return mes;
  const map = {
    enero: 'enero', febrero: 'febrero', marzo: 'marzo', abril: 'abril', mayo: 'mayo', junio: 'junio',
    julio: 'julio', agosto: 'agosto', septiembre: 'septiembre', setiembre: 'septiembre', octubre: 'octubre',
    noviembre: 'noviembre', diciembre: 'diciembre'
  };
  const k = String(mes || '').toLowerCase().trim();
  return map[k] || k;
};

const toInt = (v) => (v === undefined || v === null || v === '' ? null : parseInt(v, 10));
const toFloat = (v) => (v === undefined || v === null || v === '' ? null : parseFloat(v));
const toStr = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// GET /datos (historial) con paginación segura (interpolando limit y offset)
const listDatos = async (req, res, next) => {
  try {
    const { operario, molde, parte, maquina, proceso } = req.query;

    // Paginación: validar e interpolar como enteros
    let limit = parseInt(req.query.limit ?? '20', 10);
    let offset = parseInt(req.query.offset ?? '0', 10);
    if (!Number.isInteger(limit) || limit <= 0) limit = 20;
    if (limit > 1000) limit = 1000;
    if (!Number.isInteger(offset) || offset < 0) offset = 0;

    const where = [];
    const params = [];
    if (operario) { where.push('nombre_operario = ?'); params.push(operario); }
    if (molde) { where.push('molde = ?'); params.push(molde); }
    if (parte) { where.push('parte = ?'); params.push(parte); }
    if (maquina) { where.push('maquina = ?'); params.push(maquina); }
    if (proceso) { where.push('tipo_proceso = ?'); params.push(proceso); }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // Total
    const countSql = `SELECT COUNT(*) AS total FROM datos ${whereSql}`;
    const [{ total }] = await query(countSql, params);

    // Interpolar limit/offset (ya validados) directamente en el SQL
    const sql = `
      SELECT id, dia, mes, anio, nombre_operario, tipo_proceso, molde, parte, maquina, operacion, horas,
             source, created_at
      FROM datos
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const rows = await query(sql, params);

    res.json({ total, limit, offset, items: rows });
  } catch (e) { next(e); }
};

// POST /datos (creación manual - texto libre compatible)
const createDato = async (req, res, next) => {
  try {
    const userId = req.user?.id || null;

    let {
      dia, mes, anio,
      nombre_operario, tipo_proceso, molde, parte, maquina, operacion,
      horas
    } = req.body;

    dia = toInt(dia);
    anio = toInt(anio);
    horas = toFloat(horas);

    mes = toStr(mes);
    mes = mes ? normalizeMes(mes) : null;

    nombre_operario = toStr(nombre_operario);
    tipo_proceso = toStr(tipo_proceso);
    molde = toStr(molde);
    parte = toStr(parte);
    maquina = toStr(maquina);
    operacion = toStr(operacion);

    const provided = [dia, mes, anio, nombre_operario, tipo_proceso, molde, parte, maquina, operacion, horas]
      .filter(v => v !== null);
    if (provided.length === 0) {
      return res.status(400).json({ error: 'Debe suministrar al menos un campo para crear un registro.' });
    }

    const sql = `
      INSERT INTO datos (dia, mes, anio, nombre_operario, tipo_proceso, molde, parte, maquina, operacion, horas, source, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'manual', ?)
    `;
    const params = [dia, mes, anio, nombre_operario, tipo_proceso, molde, parte, maquina, operacion, horas, userId];
    const result = await query(sql, params);
    res.status(201).json({ message: 'Dato creado', id: result.insertId });
  } catch (e) { next(e); }
};

// PUT /datos/:id
const updateDato = async (req, res, next) => {
  try {
    const { id } = req.params;
    const current = await query('SELECT * FROM datos WHERE id = ?', [id]);
    if (!current.length) return res.status(404).json({ error: 'Registro no encontrado' });
    const row = current[0];

    const has = (key) => Object.prototype.hasOwnProperty.call(req.body, key);

    const dia = has('dia') ? toInt(req.body.dia) : row.dia;
    const rawMes = has('mes') ? toStr(req.body.mes) : row.mes;
    const mes = has('mes') ? (rawMes ? normalizeMes(rawMes) : null) : row.mes;
    const anio = has('anio') ? toInt(req.body.anio) : row.anio;

    const nombre_operario = has('nombre_operario') ? toStr(req.body.nombre_operario) : row.nombre_operario;
    const tipo_proceso = has('tipo_proceso') ? toStr(req.body.tipo_proceso) : row.tipo_proceso;
    const molde = has('molde') ? toStr(req.body.molde) : row.molde;
    const parte = has('parte') ? toStr(req.body.parte) : row.parte;
    const maquina = has('maquina') ? toStr(req.body.maquina) : row.maquina;
    const operacion = has('operacion') ? toStr(req.body.operacion) : row.operacion;

    const horas = has('horas') ? toFloat(req.body.horas) : row.horas;

    const sql = `
      UPDATE datos
      SET dia = ?, mes = ?, anio = ?, nombre_operario = ?, tipo_proceso = ?, molde = ?, parte = ?, maquina = ?, operacion = ?, horas = ?
      WHERE id = ?
    `;
    const params = [dia, mes, anio, nombre_operario, tipo_proceso, molde, parte, maquina, operacion, horas, id];
    await query(sql, params);
    res.json({ message: 'Dato actualizado', id });
  } catch (e) { next(e); }
};

// DELETE /datos/:id
const deleteDato = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM datos WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json({ message: 'Dato eliminado', id });
  } catch (e) { next(e); }
};

// GET /datos/meta
const getMeta = async (req, res, next) => {
  try {
    const uniques = async (col) =>
      await query(`SELECT DISTINCT ${col} AS v FROM datos WHERE ${col} IS NOT NULL AND ${col} <> '' ORDER BY ${col} ASC`);

    const operarios = await uniques('nombre_operario');
    const procesos = await uniques('tipo_proceso');
    const moldes = await uniques('molde');
    const partes = await uniques('parte');
    const maquinas = await uniques('maquina');
    const operaciones = await uniques('operacion');
    const yearsRows = await query(`SELECT DISTINCT anio AS v FROM datos WHERE anio IS NOT NULL ORDER BY anio DESC`);

    res.json({
      operarios: operarios.map(r=>r.v),
      procesos: procesos.map(r=>r.v),
      moldes: moldes.map(r=>r.v),
      partes: partes.map(r=>r.v),
      maquinas: maquinas.map(r=>r.v),
      operaciones: operaciones.map(r=>r.v),
      years: yearsRows.map(r=>r.v)
    });
  } catch (e) { next(e); }
};

module.exports = { listDatos, createDato, updateDato, deleteDato, getMeta };
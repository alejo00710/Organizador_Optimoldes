const { query } = require('../config/database');
const {
  ensureOperatorIdByName,
  ensureProcessIdByName,
  ensureMachineIdByName,
  ensureMoldIdByName,
  ensurePartIdByName,
  ensureOperationIdByName,
} = require('../services/catalog.service');

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

const findExistingDatoId = async ({
  dia,
  mes,
  anio,
  nombre_operario,
  tipo_proceso,
  molde,
  parte,
  maquina,
  operacion,
  horas,
  excludeId = null,
}) => {
  const rows = await query(
    `SELECT id
     FROM datos
     WHERE dia IS NOT DISTINCT FROM ?
       AND LOWER(BTRIM(mes)) IS NOT DISTINCT FROM LOWER(BTRIM(?))
       AND anio IS NOT DISTINCT FROM ?
       AND LOWER(BTRIM(nombre_operario)) IS NOT DISTINCT FROM LOWER(BTRIM(?))
       AND LOWER(BTRIM(tipo_proceso)) IS NOT DISTINCT FROM LOWER(BTRIM(?))
       AND LOWER(BTRIM(molde)) IS NOT DISTINCT FROM LOWER(BTRIM(?))
       AND LOWER(BTRIM(parte)) IS NOT DISTINCT FROM LOWER(BTRIM(?))
       AND LOWER(BTRIM(maquina)) IS NOT DISTINCT FROM LOWER(BTRIM(?))
       AND LOWER(BTRIM(operacion)) IS NOT DISTINCT FROM LOWER(BTRIM(?))
       AND horas IS NOT DISTINCT FROM ?
       AND (?::INTEGER IS NULL OR id <> ?::INTEGER)
     ORDER BY id ASC
     LIMIT 1`,
    [
      dia,
      mes,
      anio,
      nombre_operario,
      tipo_proceso,
      molde,
      parte,
      maquina,
      operacion,
      horas,
      excludeId,
      excludeId,
    ]
  );
  return rows.length ? rows[0].id : null;
};

const isDatosDuplicateViolation = (error) => {
  if (!error) return false;
  if (error.code !== '23505') return false;
  const details = `${error.constraint || ''} ${error.message || ''}`.toLowerCase();
  return details.includes('uq_datos_business_dedup');
};

const emptyDatoRow = () => ({
  dia: null,
  mes: null,
  anio: null,
  nombre_operario: null,
  tipo_proceso: null,
  molde: null,
  parte: null,
  maquina: null,
  operacion: null,
  operator_id: null,
  process_id: null,
  mold_id: null,
  part_id: null,
  machine_id: null,
  operation_id: null,
  horas: null,
});

const buildIndependentRowsFromPayload = ({
  dia,
  mes,
  anio,
  nombre_operario,
  tipo_proceso,
  molde,
  parte,
  maquina,
  operacion,
  horas,
  operator_id,
  process_id,
  mold_id,
  part_id,
  machine_id,
  operation_id,
}) => {
  const rows = [];

  if (dia !== null) { const row = emptyDatoRow(); row.dia = dia; rows.push(row); }
  if (mes !== null) { const row = emptyDatoRow(); row.mes = mes; rows.push(row); }
  if (anio !== null) { const row = emptyDatoRow(); row.anio = anio; rows.push(row); }
  if (nombre_operario !== null) { const row = emptyDatoRow(); row.nombre_operario = nombre_operario; row.operator_id = operator_id; rows.push(row); }
  if (tipo_proceso !== null) { const row = emptyDatoRow(); row.tipo_proceso = tipo_proceso; row.process_id = process_id; rows.push(row); }
  if (molde !== null) { const row = emptyDatoRow(); row.molde = molde; row.mold_id = mold_id; rows.push(row); }
  if (parte !== null) { const row = emptyDatoRow(); row.parte = parte; row.part_id = part_id; rows.push(row); }
  if (maquina !== null) { const row = emptyDatoRow(); row.maquina = maquina; row.machine_id = machine_id; rows.push(row); }
  if (operacion !== null) { const row = emptyDatoRow(); row.operacion = operacion; row.operation_id = operation_id; rows.push(row); }
  if (horas !== null) { const row = emptyDatoRow(); row.horas = horas; rows.push(row); }

  return rows;
};

// GET /datos (historial) con paginación segura (interpolando limit y offset)
const listDatos = async (req, res, next) => {
  try {
    const { operario, molde, parte, maquina, proceso } = req.query;

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

    const countSql = `SELECT COUNT(*) AS total FROM datos ${whereSql}`;
    const [{ total }] = await query(countSql, params);

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

// POST /datos (creación manual - ahora crea una fila independiente por cada campo enviado)
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

    const operator_id = nombre_operario ? await ensureOperatorIdByName(nombre_operario) : null;
    const process_id = tipo_proceso ? await ensureProcessIdByName(tipo_proceso) : null;
    const mold_id = molde ? await ensureMoldIdByName(molde) : null;
    const part_id = parte ? await ensurePartIdByName(parte) : null;
    const machine_id = maquina ? await ensureMachineIdByName(maquina) : null;
    const operation_id = operacion ? await ensureOperationIdByName(operacion) : null;

    const provided = [dia, mes, anio, nombre_operario, tipo_proceso, molde, parte, maquina, operacion, horas]
      .filter(v => v !== null);
    if (provided.length === 0) {
      return res.status(400).json({ error: 'Debe suministrar al menos un campo para crear un registro.' });
    }

    const rowsToCreate = buildIndependentRowsFromPayload({
      dia,
      mes,
      anio,
      nombre_operario,
      tipo_proceso,
      molde,
      parte,
      maquina,
      operacion,
      horas,
      operator_id,
      process_id,
      mold_id,
      part_id,
      machine_id,
      operation_id,
    });

    const sql = `
      INSERT INTO datos (
        dia, mes, anio,
        nombre_operario, tipo_proceso, molde, parte, maquina, operacion,
        operator_id, process_id, mold_id, part_id, machine_id, operation_id,
        horas, source, created_by
      )
      VALUES (?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?, ?, 'manual', ?)
    `;

    const createdIds = [];
    const skippedExistingIds = [];

    for (const rowToCreate of rowsToCreate) {
      const existingId = await findExistingDatoId({
        dia: rowToCreate.dia,
        mes: rowToCreate.mes,
        anio: rowToCreate.anio,
        nombre_operario: rowToCreate.nombre_operario,
        tipo_proceso: rowToCreate.tipo_proceso,
        molde: rowToCreate.molde,
        parte: rowToCreate.parte,
        maquina: rowToCreate.maquina,
        operacion: rowToCreate.operacion,
        horas: rowToCreate.horas,
      });

      if (existingId) {
        skippedExistingIds.push(existingId);
        continue;
      }

      const params = [
        rowToCreate.dia, rowToCreate.mes, rowToCreate.anio,
        rowToCreate.nombre_operario, rowToCreate.tipo_proceso, rowToCreate.molde, rowToCreate.parte, rowToCreate.maquina, rowToCreate.operacion,
        rowToCreate.operator_id, rowToCreate.process_id, rowToCreate.mold_id, rowToCreate.part_id, rowToCreate.machine_id, rowToCreate.operation_id,
        rowToCreate.horas, userId
      ];

      try {
        const result = await query(sql, params);
        createdIds.push(result.insertId);
      } catch (insertError) {
        if (isDatosDuplicateViolation(insertError)) {
          continue;
        }
        throw insertError;
      }
    }

    if (createdIds.length === 0) {
      if (rowsToCreate.length === 1 && skippedExistingIds.length) {
        return res.status(409).json({
          error: 'El dato ya existe. No se permiten registros duplicados.',
          existing_id: skippedExistingIds[0],
          skipped_existing_ids: skippedExistingIds,
        });
      }

      return res.status(409).json({
        error: 'Todos los datos enviados ya existen. No se crearon registros.',
        skipped_existing_ids: skippedExistingIds,
      });
    }

    if (createdIds.length === 1 && rowsToCreate.length === 1) {
      return res.status(201).json({ message: 'Dato creado', id: createdIds[0] });
    }

    return res.status(201).json({
      message: 'Datos creados de forma independiente',
      created_count: createdIds.length,
      skipped_count: rowsToCreate.length - createdIds.length,
      created_ids: createdIds,
      skipped_existing_ids: skippedExistingIds,
    });
  } catch (e) {
    if (isDatosDuplicateViolation(e)) {
      return res.status(409).json({ error: 'El dato ya existe. No se permiten registros duplicados.' });
    }
    next(e);
  }
};

// PUT /datos/:id
const updateDato = async (req, res, next) => {
  try {
    const { id } = req.params;
    const current = await query('SELECT * FROM datos WHERE id = ?', [id]);
    if (!current.length) return res.status(404).json({ error: 'Registro no encontrado' });
    const row = current[0];

    const has = (key) => Object.prototype.hasOwnProperty.call(req.body, key);

    const originalByField = {
      dia: row.dia,
      mes: row.mes,
      anio: row.anio,
      nombre_operario: row.nombre_operario,
      tipo_proceso: row.tipo_proceso,
      molde: row.molde,
      parte: row.parte,
      maquina: row.maquina,
      operacion: row.operacion,
      horas: row.horas,
    };

    const attemptedNewFields = [];
    const checkNewValueOnEmptyField = (fieldName, normalizedValue) => {
      const currentValue = originalByField[fieldName];
      const wasEmpty = currentValue === null || currentValue === undefined || String(currentValue).trim?.() === '';
      const wantsValue = normalizedValue !== null;
      if (wasEmpty && wantsValue) {
        attemptedNewFields.push(fieldName);
      }
    };

    if (has('dia')) checkNewValueOnEmptyField('dia', toInt(req.body.dia));
    if (has('mes')) {
      const m = toStr(req.body.mes);
      checkNewValueOnEmptyField('mes', m ? normalizeMes(m) : null);
    }
    if (has('anio')) checkNewValueOnEmptyField('anio', toInt(req.body.anio));
    if (has('nombre_operario')) checkNewValueOnEmptyField('nombre_operario', toStr(req.body.nombre_operario));
    if (has('tipo_proceso')) checkNewValueOnEmptyField('tipo_proceso', toStr(req.body.tipo_proceso));
    if (has('molde')) checkNewValueOnEmptyField('molde', toStr(req.body.molde));
    if (has('parte')) checkNewValueOnEmptyField('parte', toStr(req.body.parte));
    if (has('maquina')) checkNewValueOnEmptyField('maquina', toStr(req.body.maquina));
    if (has('operacion')) checkNewValueOnEmptyField('operacion', toStr(req.body.operacion));
    if (has('horas')) checkNewValueOnEmptyField('horas', toFloat(req.body.horas));

    if (attemptedNewFields.length > 0) {
      return res.status(400).json({
        error: 'No se puede escribir en columnas vacías desde edición. Solo se permite editar el campo originalmente creado en la fila.',
        blocked_fields: attemptedNewFields,
      });
    }

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

    const operator_id = has('nombre_operario')
      ? (nombre_operario ? await ensureOperatorIdByName(nombre_operario) : null)
      : row.operator_id;
    const process_id = has('tipo_proceso')
      ? (tipo_proceso ? await ensureProcessIdByName(tipo_proceso) : null)
      : row.process_id;
    const mold_id = has('molde')
      ? (molde ? await ensureMoldIdByName(molde) : null)
      : row.mold_id;
    const part_id = has('parte')
      ? (parte ? await ensurePartIdByName(parte) : null)
      : row.part_id;
    const machine_id = has('maquina')
      ? (maquina ? await ensureMachineIdByName(maquina) : null)
      : row.machine_id;
    const operation_id = has('operacion')
      ? (operacion ? await ensureOperationIdByName(operacion) : null)
      : row.operation_id;

    const horas = has('horas') ? toFloat(req.body.horas) : row.horas;

    const provided = [dia, mes, anio, nombre_operario, tipo_proceso, molde, parte, maquina, operacion, horas]
      .filter(v => v !== null);
    if (provided.length === 0) {
      return res.status(400).json({ error: 'La fila no puede quedar totalmente vacía.' });
    }

    const existingId = await findExistingDatoId({
      dia,
      mes,
      anio,
      nombre_operario,
      tipo_proceso,
      molde,
      parte,
      maquina,
      operacion,
      horas,
      excludeId: Number(id),
    });
    if (existingId) {
      return res.status(409).json({
        error: 'La actualización genera un duplicado. No se permiten registros duplicados.',
        existing_id: existingId,
      });
    }

    const sql = `
      UPDATE datos
      SET dia = ?, mes = ?, anio = ?,
          nombre_operario = ?, tipo_proceso = ?, molde = ?, parte = ?, maquina = ?, operacion = ?,
          operator_id = ?, process_id = ?, mold_id = ?, part_id = ?, machine_id = ?, operation_id = ?,
          horas = ?
      WHERE id = ?
    `;
    const params = [
      dia, mes, anio,
      nombre_operario, tipo_proceso, molde, parte, maquina, operacion,
      operator_id, process_id, mold_id, part_id, machine_id, operation_id,
      horas, id
    ];
    await query(sql, params);
    res.json({ message: 'Dato actualizado', id });
  } catch (e) {
    if (isDatosDuplicateViolation(e)) {
      return res.status(409).json({ error: 'La actualización genera un duplicado. No se permiten registros duplicados.' });
    }
    next(e);
  }
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
      operarios: operarios.map(r => r.v),
      procesos: procesos.map(r => r.v),
      moldes: moldes.map(r => r.v),
      partes: partes.map(r => r.v),
      maquinas: maquinas.map(r => r.v),
      operaciones: operaciones.map(r => r.v),
      years: yearsRows.map(r => r.v)
    });
  } catch (e) { next(e); }
};

// GET /datos/hours-options
const getHoursOptions = async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT DISTINCT horas AS v
       FROM datos
       WHERE horas IS NOT NULL
       ORDER BY horas ASC
       LIMIT 500`
    );
    const hours = rows
      .map(r => (r && r.v != null ? Number(r.v) : null))
      .filter(v => Number.isFinite(v));
    res.json({ hours });
  } catch (e) { next(e); }
};

module.exports = { listDatos, createDato, updateDato, deleteDato, getMeta, getHoursOptions };

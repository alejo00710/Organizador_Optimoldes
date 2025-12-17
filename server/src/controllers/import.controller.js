const XLSX = require('xlsx');
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

function toStrGeneral(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function toHours(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  let s = String(v).trim();
  s = s.replace(',', '.');
  s = s.replace(/[^0-9.\-]/g, '');
  const num = parseFloat(s);
  return isNaN(num) ? null : num;
}

/**
 * Asegura (busca o crea) un registro por nombre en la tabla dada y retorna su id.
 * - operators: INSERT (name, user_id NULL, is_active TRUE)
 * - machines:  INSERT (name, is_active TRUE)  [daily_capacity quedará NULL para editar luego en Config]
 * - otras:     INSERT (name, is_active TRUE)
 */
async function ensureIdByName(table, name) {
  const n = toStrGeneral(name);
  if (!n) return null;
  const rows = await query(`SELECT id FROM ${table} WHERE LOWER(name)=LOWER(?) LIMIT 1`, [n]);
  if (rows.length) return rows[0].id;

  if (table === 'operators') {
    const res = await query(`INSERT INTO operators (name, user_id, is_active) VALUES (?, NULL, TRUE)`, [n]);
    return res.insertId;
  }
  if (table === 'machines') {
    const res = await query(`INSERT INTO machines (name, is_active) VALUES (?, TRUE)`, [n]);
    return res.insertId;
  }
  const res = await query(`INSERT INTO ${table} (name, is_active) VALUES (?, TRUE)`, [n]);
  return res.insertId;
}

/**
 * Inserta una fila en "datos", resolviendo y creando catálogos por nombre cuando falten.
 * Guarda tanto texto libre como referencias por ID.
 */
async function insertDatoRow(row, batchId, userId) {
  const {
    dia, mes, anio,
    nombre_operario, tipo_proceso, molde, parte, maquina, operacion,
    horas
  } = row;

  const normDia = dia !== undefined && dia !== null && String(dia).trim() !== '' ? parseInt(dia, 10) : null;
  const normAnio = anio !== undefined && anio !== null && String(anio).trim() !== '' ? parseInt(anio, 10) : null;
  const normMesRaw = toStrGeneral(mes);
  const normMes = normMesRaw ? normalizeMes(normMesRaw) : null;

  const normOperario = toStrGeneral(nombre_operario);
  const normProceso = toStrGeneral(tipo_proceso);
  const normMolde = toStrGeneral(molde);
  const normParte = toStrGeneral(parte);
  const normMaquina = toStrGeneral(maquina);
  const normOperacion = toStrGeneral(operacion);
  const normHoras = toHours(horas);

  // Resolver/crear catálogos y obtener IDs
  let operator_id = null, process_id = null, mold_id = null, part_id = null, machine_id = null, operation_id = null;
  try {
    operator_id  = await ensureIdByName('operators',  normOperario);
    process_id   = await ensureIdByName('processes',  normProceso);
    mold_id      = await ensureIdByName('molds',      normMolde);
    part_id      = await ensureIdByName('mold_parts', normParte);
    machine_id   = await ensureIdByName('machines',   normMaquina);
    operation_id = await ensureIdByName('operations', normOperacion);
  } catch (err) {
    return { inserted: false, reason: `Error resolviendo catálogos: ${err.message || err}` };
  }

  // Validar que haya al menos algún dato útil para insertar
  const provided = [normDia, normMes, normAnio, normOperario, normProceso, normMolde, normParte, normMaquina, normOperacion, normHoras,
                    operator_id, process_id, mold_id, part_id, machine_id, operation_id]
    .filter(v => v !== null && v !== undefined);
  if (provided.length === 0) {
    return { inserted: false, reason: 'Fila vacía (sin datos útiles)' };
  }

  try {
    await query(`
      INSERT INTO datos (
        dia, mes, anio,
        nombre_operario, tipo_proceso, molde, parte, maquina, operacion,
        operator_id, process_id, mold_id, part_id, machine_id, operation_id,
        horas, source, import_batch_id, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?)
    `, [
      normDia, normMes, normAnio,
      normOperario, normProceso, normMolde, normParte, normMaquina, normOperacion,
      operator_id, process_id, mold_id, part_id, machine_id, operation_id,
      normHoras, batchId, userId
    ]);
    return { inserted: true };
  } catch (e) {
    return { inserted: false, reason: e.message || 'Error SQL' };
  }
}

exports.importDatos = async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Archivo no recibido. Adjunta un Excel/CSV.' });
    }

    const fileName = req.file.originalname || 'archivo';
    const userId = req.user?.id || null;

    const batchRes = await query(
      `INSERT INTO import_batches (file_name, total_rows, success_count, fail_count, created_by)
       VALUES (?, 0, 0, 0, ?)`,
      [fileName, userId]
    );
    const batchId = batchRes.insertId;

    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false, cellNF: false, cellText: false });
    const sheetName = wb.Sheets['DATOS'] ? 'DATOS' : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    if (!ws) return res.status(400).json({ error: `No se encontró la hoja DATOS ni la primera hoja.` });

    const range = XLSX.utils.decode_range(ws['!ref']);
    const headerRows = [0, 1];
    const dataStartRow = 2; // fila 3 (0-based)
    const startCol = 3; // columna D

    const expectedCols = [
      { key: 'nombre_operario', label: 'NOMBRE DE OPERARIO' },
      { key: 'tipo_proceso', label: 'TIPO PROCESO' },
      { key: 'molde', label: 'MOLDE' },
      { key: 'parte', label: 'PARTE' },
      { key: 'maquina', label: 'MÁQUINA' },
      { key: 'operacion', label: 'OPERACIÓN' },
      { key: 'horas', label: 'HORAS' }
    ];

    function readHeaderText(col) {
      let parts = [];
      for (const hr of headerRows) {
        const addr = XLSX.utils.encode_cell({ r: hr, c: col });
        const cell = ws[addr];
        if (cell && cell.v !== undefined && cell.v !== null) parts.push(String(cell.v).trim());
      }
      return parts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    const colMap = {};
    for (let i = 0; i < expectedCols.length; i++) {
      const colIndex = startCol + i;
      const headerText = readHeaderText(colIndex);
      const normalizedHeader = headerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const expLabel = expectedCols[i].label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      // Acepta header aproximado; si no coincide, igual mapear para no romper
      if (normalizedHeader.includes(expLabel.split(' ')[0])) {
        colMap[colIndex] = expectedCols[i].key;
      } else {
        colMap[colIndex] = expectedCols[i].key;
      }
    }

    let total = 0, ok = 0, fail = 0;
    const failSamples = [];
    const MAX_SAMPLES = 25;

    for (let r = dataStartRow; r <= range.e.r; r++) {
      total++;
      const rowObj = {};
      for (let i = 0; i < expectedCols.length; i++) {
        const c = startCol + i;
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        const key = colMap[c];
        rowObj[key] = cell ? cell.v : null;
      }

      const result = await insertDatoRow({
        dia: null, mes: null, anio: null,
        nombre_operario: rowObj.nombre_operario,
        tipo_proceso: rowObj.tipo_proceso,
        molde: rowObj.molde,
        parte: rowObj.parte,
        maquina: rowObj.maquina,
        operacion: rowObj.operacion,
        horas: rowObj.horas
      }, batchId, userId);

      if (result.inserted) {
        ok++;
      } else {
        fail++;
        // guardar en tabla import_errors
        await query(`
          INSERT INTO import_errors (batch_id, row_no, nombre_operario, tipo_proceso, molde, parte, maquina, operacion, horas_original, reason)
          VALUES (?,?,?,?,?,?,?,?,?,?)
        `, [
          batchId, (r + 1), // fila 1-based
          toStrGeneral(rowObj.nombre_operario),
          toStrGeneral(rowObj.tipo_proceso),
          toStrGeneral(rowObj.molde),
          toStrGeneral(rowObj.parte),
          toStrGeneral(rowObj.maquina),
          toStrGeneral(rowObj.operacion),
          rowObj.horas !== null && rowObj.horas !== undefined ? String(rowObj.horas) : null,
          result.reason || 'Descartada'
        ]);
        if (failSamples.length < MAX_SAMPLES) {
          failSamples.push({
            row: r + 1,
            nombre_operario: toStrGeneral(rowObj.nombre_operario),
            tipo_proceso: toStrGeneral(rowObj.tipo_proceso),
            molde: toStrGeneral(rowObj.molde),
            parte: toStrGeneral(rowObj.parte),
            maquina: toStrGeneral(rowObj.maquina),
            operacion: toStrGeneral(rowObj.operacion),
            horas: rowObj.horas,
            reason: result.reason
          });
        }
      }
    }

    await query(`UPDATE import_batches SET total_rows = ?, success_count = ?, fail_count = ? WHERE id = ?`,
      [total, ok, fail, batchId]);

    res.json({
      message: 'Importación completada',
      sheet: sheetName,
      batchId,
      total,
      ok,
      fail,
      fail_samples: failSamples
    });
  } catch (e) {
    next(e);
  }
};

// Endpoint opcional para descargar diagnóstico completo en JSON
exports.getImportErrors = async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const rows = await query(`SELECT * FROM import_errors WHERE batch_id = ? ORDER BY row_no ASC`, [batchId]);
    res.json(rows);
  } catch (e) { next(e); }
};
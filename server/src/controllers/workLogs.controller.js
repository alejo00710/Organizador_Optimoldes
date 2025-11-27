const { query, getConnection } = require('../config/database');
const { ROLES, OPERATOR_EDIT_DAYS_LIMIT } = require('../utils/constants');

/**
 * POST /work_logs
 * Crea un registro de trabajo real
 */
const createWorkLog = async (req, res, next) => {
  try {
    const { moldId, partId, machineId, operatorId, hours_worked, note } = req.body;
    
    // Validaciones
    if (!moldId || !partId || !machineId || !operatorId || !hours_worked) {
      return res.status(400).json({
        error: 'Campos requeridos: moldId, partId, machineId, operatorId, hours_worked'
      });
    }
    
    if (hours_worked <= 0) {
      return res.status(400).json({ error: 'hours_worked debe ser mayor que 0' });
    }
    
    // Verificar que el operario pertenezca al usuario (si es operario)
    if (req.user.role === ROLES.OPERATOR && operatorId !== req.user.operatorId) {
      return res.status(403).json({ 
        error: 'No puedes crear registros para otros operarios' 
      });
    }
    
    // Insertar
    const sql = `
      INSERT INTO work_logs 
      (mold_id, part_id, machine_id, operator_id, hours_worked, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    const result = await query(sql, [
      moldId, partId, machineId, operatorId, hours_worked, note || null
    ]);
    
    res.status(201).json({
      message: 'Registro de trabajo creado exitosamente',
      data: {
        id: result.insertId,
        moldId,
        partId,
        machineId,
        operatorId,
        hours_worked,
        note
      }
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * GET /work_logs
 * Obtiene registros de trabajo (filtrado por operario si es operario)
 */
const getWorkLogs = async (req, res, next) => {
  try {
    const { startDate, endDate, operatorId, machineId, moldId } = req.query;
    
    let whereClauses = [];
    let params = [];
    
    // Filtrar por operario si es rol operario
    if (req. user.role === ROLES. OPERATOR) {
      whereClauses. push('wl.operator_id = ?');
      params.push(req. user.operatorId);
    } else if (operatorId) {
      whereClauses.push('wl. operator_id = ?');
      params.push(operatorId);
    }
    
    if (machineId) {
      whereClauses.push('wl. machine_id = ?');
      params.push(machineId);
    }
    
    if (moldId) {
      whereClauses.push('wl.mold_id = ?');
      params.push(moldId);
    }
    
    if (startDate) {
      whereClauses. push('DATE(wl.recorded_at) >= ?');
      params.push(startDate);
    }
    
    if (endDate) {
      whereClauses. push('DATE(wl.recorded_at) <= ?');
      params.push(endDate);
    }
    
    const whereClause = whereClauses. length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    
    const sql = `
      SELECT 
        wl.*,
        m.code as mold_code,
        mp.part_number,
        ma.name as machine_name,
        o.name as operator_name
      FROM work_logs wl
      JOIN molds m ON wl.mold_id = m.id
      JOIN mold_parts mp ON wl.part_id = mp.id
      JOIN machines ma ON wl.machine_id = ma.id
      JOIN operators o ON wl.operator_id = o.id
      ${whereClause}
      ORDER BY wl.recorded_at DESC
    `;
    
    const logs = await query(sql, params);
    res.json(logs);
    
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /work_logs/:id
 * Actualiza un registro de trabajo (con restricciones por rol)
 */
const updateWorkLog = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { hours_worked, note } = req. body;
    
    // Obtener el registro actual
    const getSql = 'SELECT * FROM work_logs WHERE id = ?';
    const logs = await query(getSql, [id]);
    
    if (logs.length === 0) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }
    
    const log = logs[0];
    
    // Verificar permisos
    if (req. user.role === ROLES. OPERATOR) {
      // El operario solo puede editar sus propios registros
      if (log.operator_id !== req. user.operatorId) {
        return res.status(403). json({ 
          error: 'No puedes editar registros de otros operarios' 
        });
      }
      
      // El operario solo puede editar hasta 2 días atrás
      const recordedDate = new Date(log.recorded_at);
      const now = new Date();
      const daysDiff = Math.floor((now - recordedDate) / (1000 * 60 * 60 * 24));
      
      if (daysDiff > OPERATOR_EDIT_DAYS_LIMIT) {
        return res.status(403).json({
          error: `Solo puedes editar registros de hasta ${OPERATOR_EDIT_DAYS_LIMIT} días atrás`
        });
      }
    }
    
    // Actualizar
    const updateSql = `
      UPDATE work_logs 
      SET hours_worked = ?, note = ? 
      WHERE id = ?
    `;
    
    await query(updateSql, [
      hours_worked || log.hours_worked,
      note !== undefined ? note : log.note,
      id
    ]);
    
    res.json({
      message: 'Registro actualizado exitosamente',
      data: { id, hours_worked, note }
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /work_logs/:id
 * Elimina un registro de trabajo (solo admin/planner)
 */
const deleteWorkLog = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const sql = 'DELETE FROM work_logs WHERE id = ?';
    const result = await query(sql, [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }
    
    res.json({ message: 'Registro eliminado exitosamente' });
    
  } catch (error) {
    next(error);
  }
};

module. exports = {
  createWorkLog,
  getWorkLogs,
  updateWorkLog,
  deleteWorkLog
};
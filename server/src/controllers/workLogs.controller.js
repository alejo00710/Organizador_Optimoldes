const { query } = require('../config/database');
const { ROLES, OPERATOR_EDIT_DAYS_LIMIT } = require('../utils/constants');

function parsePositiveInt(value) {
    const n = Number.parseInt(String(value), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function isTruthyFlag(v) {
    if (v === true) return true;
    if (v === false || v == null) return false;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

async function findExistingFinalLog({ moldId, planningId, partId, machineId, excludeId = null }) {
    const rows = await query(
        `SELECT id
         FROM work_logs
                 WHERE mold_id = ?
                     AND planning_id = ?
           AND part_id = ?
           AND machine_id = ?
           AND is_final_log = TRUE
           ${excludeId ? 'AND id <> ?' : ''}
         ORDER BY id DESC
         LIMIT 1`,
                excludeId
                        ? [moldId, planningId, partId, machineId, excludeId]
                        : [moldId, planningId, partId, machineId]
    );
    const id = Number(rows?.[0]?.id || 0);
    return Number.isFinite(id) && id > 0 ? id : null;
}

async function reconcilePlanningStatus(planningId) {
    const pid = parsePositiveInt(planningId);
    if (!pid) return null;

    const rows = await query(
        `WITH plan_pairs AS (
             SELECT pe.part_id, pe.machine_id, SUM(pe.hours_planned) AS planned_hours
             FROM plan_entries pe
             WHERE pe.planning_id = ?
             GROUP BY pe.part_id, pe.machine_id
         ),
         final_pairs AS (
             SELECT DISTINCT wl.part_id, wl.machine_id
             FROM work_logs wl
             WHERE wl.planning_id = ?
               AND wl.is_final_log = TRUE
         )
         SELECT
             SUM(CASE WHEN pp.planned_hours > 0 THEN 1 ELSE 0 END) AS planned_pairs,
             SUM(CASE WHEN pp.planned_hours > 0 AND fp.part_id IS NOT NULL THEN 1 ELSE 0 END) AS closed_pairs
         FROM plan_pairs pp
         LEFT JOIN final_pairs fp
           ON fp.part_id = pp.part_id
          AND fp.machine_id = pp.machine_id`,
        [pid, pid]
    );

    const plannedPairs = Number(rows?.[0]?.planned_pairs || 0);
    const closedPairs = Number(rows?.[0]?.closed_pairs || 0);
    const nextStatus = plannedPairs > 0 && closedPairs >= plannedPairs ? 'COMPLETED' : 'IN_PROGRESS';

    // Mantener compatibilidad si la columna aún no existe en una BD antigua.
    try {
        await query(
            `UPDATE planning_history
             SET status = ?
             WHERE id = ?
               AND event_type = 'PLANNED'`,
            [nextStatus, pid]
        );
    } catch (_) {}

    return nextStatus;
}

async function getPlannedHoursSnapshot({ moldId, partId, machineId, planningId }) {
    try {
        if (!moldId || !partId || !machineId || !planningId) return null;
        const rows = await query(
            `SELECT SUM(pe2.hours_planned) AS planned_hours
             FROM plan_entries pe2
             WHERE pe2.mold_id = ?
               AND pe2.part_id = ?
               AND pe2.machine_id = ?
               AND pe2.planning_id = ?`,
            [moldId, partId, machineId, planningId]
        );
        const v = rows?.[0]?.planned_hours;
        if (v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    } catch {
        return null;
    }
}

async function validatePlanningCell({ planningId, moldId, partId, machineId }) {
    const planningRows = await query(
        `SELECT id
         FROM planning_history
         WHERE id = ?
           AND mold_id = ?
           AND event_type = 'PLANNED'
         LIMIT 1`,
        [planningId, moldId]
    );
    if (!planningRows.length) {
        return { ok: false, reason: 'planning_mismatch' };
    }

    // Nueva regla de negocio: Se permite el registro "fuera de plan".
    // La validación estricta de cell_not_planned se ha desactivado para dar flexibilidad al taller.
    const plannedHours = await getPlannedHoursSnapshot({
        moldId,
        partId,
        machineId,
        planningId,
    });

    return { ok: true, plannedHours: Number(plannedHours) || 0 };
}

function toISODateOnly(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        const s = value.slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    }
    try {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString().slice(0, 10);
    } catch {
        return null;
    }
}

function getColombiaTodayISO() {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Bogota',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(new Date());
        const y = parts.find(p => p.type === 'year')?.value;
        const m = parts.find(p => p.type === 'month')?.value;
        const d = parts.find(p => p.type === 'day')?.value;
        if (!y || !m || !d) return null;
        return `${y}-${m}-${d}`;
    } catch {
        return null;
    }
}

function diffDaysISO(aISO, bISO) {
    // aISO - bISO (ambas YYYY-MM-DD) en días
    if (!aISO || !bISO) return 9999;
    const [ay, am, ad] = aISO.split('-').map(Number);
    const [by, bm, bd] = bISO.split('-').map(Number);
    const a = Date.UTC(ay, am - 1, ad);
    const b = Date.UTC(by, bm - 1, bd);
    return Math.floor((a - b) / (1000 * 60 * 60 * 24));
}

/**
 * POST /work_logs
 * Crea un registro de trabajo real
 */
const createWorkLog = async (req, res, next) => {
    try {
        const { moldId, planning_id, partId, machineId, operatorId, hours_worked, note, reason, work_date, is_final_log } = req.body;

        // Validaciones
        if (planning_id == null || String(planning_id).trim() === '') {
            return res.status(422).json({ error: 'planning_id es requerido' });
        }

        if (!moldId || !partId || !machineId || !operatorId || !hours_worked) {
            return res.status(400).json({
                error: 'Campos requeridos: moldId, partId, machineId, operatorId, hours_worked',
            });
        }

        if (hours_worked <= 0) {
            return res.status(400).json({ error: 'hours_worked debe ser mayor que 0' });
        }

        // Verificar que el operario pertenezca al usuario (si es operario)
        if (req.user.role === ROLES.OPERATOR && operatorId !== req.user.operatorId) {
            return res.status(403).json({
                error: 'No puedes crear registros para otros operarios',
            });
        }

        const planningIdNum = parsePositiveInt(planning_id);
        if (!planningIdNum) {
            return res.status(400).json({ error: 'planning_id inválido (entero positivo)' });
        }

        // Validar work_date si viene
        const dateStr = work_date ? String(work_date) : null;
        if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return res.status(400).json({ error: 'work_date debe ser YYYY-MM-DD' });
        }

        const cellValidation = await validatePlanningCell({
            planningId: planningIdNum,
            moldId,
            partId,
            machineId,
        });
        if (!cellValidation.ok) {
            return res.status(409).json({
                error: 'La combinación planning_id + moldId + partId + machineId no corresponde a una celda planificada válida',
                reason: cellValidation.reason,
            });
        }

        const planned_hours_snapshot = cellValidation.plannedHours;

        const wantsFinalLog = isTruthyFlag(is_final_log);
        if (wantsFinalLog) {
            const duplicatedFinalId = await findExistingFinalLog({
                moldId,
                planningId: planningIdNum,
                partId,
                machineId,
            });
            if (duplicatedFinalId) {
                return res.status(409).json({
                    error: 'Ya existe un registro final para esta parte en este ciclo de planificación',
                });
            }
        }

        // Insertar
        const sql = `
            INSERT INTO work_logs 
                (mold_id, planning_id, part_id, machine_id, operator_id, work_date, hours_worked, reason, note, planned_hours_snapshot, is_final_log)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const result = await query(sql, [
            moldId,
            planningIdNum,
            partId,
            machineId,
            operatorId,
            dateStr,
            hours_worked,
            reason || null,
            note || null,
            planned_hours_snapshot,
            wantsFinalLog,
        ]);

        await reconcilePlanningStatus(planningIdNum);

        req.app.get('io').emit('workLog_updated');

        res.status(201).json({
            message: 'Registro de trabajo creado exitosamente',
            data: {
                id: result.insertId,
                moldId,
                partId,
                machineId,
                operatorId,
                planning_id: planningIdNum,
                work_date: dateStr,
                hours_worked,
                reason,
                note,
            },
        });
    } catch (error) {
        if (error?.code === '23505') {
            return res.status(409).json({
                error: 'Ya existe un registro final para esta parte en este ciclo de planificación',
            });
        }
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

        // Paginación segura
        let limit = parseInt(req.query.limit ?? '200', 10);
        let offset = parseInt(req.query.offset ?? '0', 10);
        if (!Number.isInteger(limit) || limit <= 0) limit = 200;
        if (limit > 1000) limit = 1000;
        if (!Number.isInteger(offset) || offset < 0) offset = 0;

        const whereClauses = [];
        const params = [];

        // Filtrar por operario si es rol operario
        if (req.user.role === ROLES.OPERATOR) {
            whereClauses.push('wl.operator_id = ?');
            params.push(req.user.operatorId);
        } else if (operatorId) {
            whereClauses.push('wl.operator_id = ?');
            params.push(operatorId);
        }

        if (machineId) {
            whereClauses.push('wl.machine_id = ?');
            params.push(machineId);
        }

        if (moldId) {
            whereClauses.push('wl.mold_id = ?');
            params.push(moldId);
        }

        if (startDate) {
            whereClauses.push('DATE(wl.recorded_at) >= ?');
            params.push(startDate);
        }

        if (endDate) {
            whereClauses.push('DATE(wl.recorded_at) <= ?');
            params.push(endDate);
        }

        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const sql = `
            WITH task_totals AS (
                SELECT
                    wlt.id,
                    SUM(wlt.hours_worked) OVER (
                        PARTITION BY wlt.planning_id, wlt.part_id, wlt.machine_id
                    ) AS total_task_hours
                FROM work_logs wlt
            ),
            base_logs AS (
                SELECT
                    wl.*,
                    to_char(wl.work_date, 'YYYY-MM-DD') AS work_date,
                    m.name as mold_name,
                    mp.name as part_name,
                    ma.name as machine_name,
                    o.name as operator_name,
                    COALESCE(wl.planned_hours_snapshot, pe.planned_hours) AS planned_hours,
                    COALESCE(tt.total_task_hours, 0) AS total_task_hours
                FROM work_logs wl
                JOIN molds m ON wl.mold_id = m.id
                JOIN mold_parts mp ON wl.part_id = mp.id
                JOIN machines ma ON wl.machine_id = ma.id
                JOIN operators o ON wl.operator_id = o.id
                LEFT JOIN task_totals tt ON tt.id = wl.id
                LEFT JOIN LATERAL (
                    SELECT SUM(pe2.hours_planned) AS planned_hours
                    FROM plan_entries pe2
                    WHERE pe2.mold_id = wl.mold_id
                      AND pe2.part_id = wl.part_id
                      AND pe2.machine_id = wl.machine_id
                      AND pe2.planning_id = wl.planning_id
                ) pe ON TRUE
            )
            SELECT
                wl.*,
                (wl.total_task_hours - wl.planned_hours) AS diff_hours,
                CASE
                    WHEN wl.planned_hours IS NULL OR wl.planned_hours <= 0 THEN NULL
                    ELSE ROUND(((wl.total_task_hours - wl.planned_hours) / wl.planned_hours) * 100, 2)
                END AS deviation_pct,
                CASE
                    WHEN wl.planned_hours IS NULL OR wl.planned_hours <= 0 THEN 0
                    WHEN ABS((wl.total_task_hours - wl.planned_hours) / wl.planned_hours) > 0.05 THEN 1
                    ELSE 0
                END AS is_alert
            FROM base_logs wl
            ${whereClause}
            ORDER BY wl.recorded_at DESC
            LIMIT ${limit} OFFSET ${offset}
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
        const {
            work_date,
            operatorId,
            hours_worked,
            reason,
            note,
            is_final_log,
        } = req.body || {};

        // Obtener el registro actual
        const getSql = 'SELECT * FROM work_logs WHERE id = ?';
        const logs = await query(getSql, [id]);

        if (logs.length === 0) {
            return res.status(404).json({ error: 'work_log no encontrado' });
        }

        const log = logs[0];

        // Verificar permisos
        if (req.user.role === ROLES.OPERATOR) {
            // El operario solo puede editar sus propios registros
            if (log.operator_id !== req.user.operatorId) {
                return res.status(403).json({
                    error: 'No puedes editar registros de otros operarios',
                });
            }

            // El operario solo puede editar hasta N días atrás usando estrictamente work_date.
            const baseISO = toISODateOnly(log.work_date);
            if (!baseISO) {
                return res.status(403).json({
                    error: 'No puedes editar este registro porque no tiene work_date válido',
                });
            }
            const todayISO = getColombiaTodayISO();
            const daysDiff = diffDaysISO(todayISO, baseISO);

            if (daysDiff > OPERATOR_EDIT_DAYS_LIMIT) {
                return res.status(403).json({
                    error: `Solo puedes editar registros de hasta ${OPERATOR_EDIT_DAYS_LIMIT} días atrás`,
                });
            }
        }

        // Validaciones básicas
        const dateStr = work_date !== undefined ? (work_date ? String(work_date) : null) : undefined;
        if (dateStr !== undefined && dateStr !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return res.status(400).json({ error: 'work_date debe ser YYYY-MM-DD' });
        }

        if (hours_worked !== undefined) {
            const hw = Number(hours_worked);
            if (!Number.isFinite(hw) || hw <= 0) return res.status(400).json({ error: 'hours_worked debe ser mayor que 0' });
        }

        // Fuente de verdad: el ciclo ya persistido en el work_log.
        // Se ignora cualquier planning_id recibido en body.
        const planningIdNum = parsePositiveInt(log.planning_id);
        if (!planningIdNum) {
            return res.status(409).json({ error: 'El work_log no tiene planning_id válido' });
        }

        const nextOperatorId = operatorId !== undefined ? Number(operatorId) : undefined;

        // Operario NO puede cambiar operator_id
        if (req.user.role === ROLES.OPERATOR && nextOperatorId !== undefined && nextOperatorId !== req.user.operatorId) {
            return res.status(403).json({ error: 'No puedes cambiar el operario del registro' });
        }

        // Si admin/jefe cambian operatorId, verificar que exista y esté activo
        if (req.user.role !== ROLES.OPERATOR && nextOperatorId !== undefined) {
            if (!Number.isFinite(nextOperatorId) || nextOperatorId <= 0) return res.status(400).json({ error: 'operatorId inválido' });
            const ops = await query('SELECT id FROM operators WHERE id = ? AND is_active = TRUE', [nextOperatorId]);
            if (!ops.length) return res.status(400).json({ error: 'Operario inválido o inactivo' });
        }

        // Actualizar (si no viene un campo, se conserva)
        const finalWorkDateISO = dateStr !== undefined ? dateStr : log.work_date;
        const finalMoldId = Number(log.mold_id);
        const finalPartId = Number(log.part_id);
        const finalMachineId = Number(log.machine_id);

        const cellValidation = await validatePlanningCell({
            planningId: planningIdNum,
            moldId: finalMoldId,
            partId: finalPartId,
            machineId: finalMachineId,
        });
        if (!cellValidation.ok) {
            return res.status(409).json({
                error: 'La combinación planning_id + moldId + partId + machineId no corresponde a una celda planificada válida',
                reason: cellValidation.reason,
            });
        }

        const planned_hours_snapshot = cellValidation.plannedHours;

        const updateSql = `
            UPDATE work_logs
            SET
              mold_id = ?,
              planning_id = ?,
              part_id = ?,
              machine_id = ?,
              operator_id = ?,
              work_date = ?,
              hours_worked = ?,
              reason = ?,
              note = ?
              ,planned_hours_snapshot = ?
              ,is_final_log = ?
            WHERE id = ?`;

        const finalOperatorId = req.user.role === ROLES.OPERATOR
            ? log.operator_id
            : (nextOperatorId !== undefined ? nextOperatorId : log.operator_id);

        const hasIncomingFinalFlag = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_final_log');
        const existingIsFinalLog = isTruthyFlag(log.is_final_log);
        const requestedIsFinalLog = hasIncomingFinalFlag ? isTruthyFlag(is_final_log) : undefined;

        if (existingIsFinalLog && requestedIsFinalLog === false) {
            return res.status(400).json({ error: 'No se puede desmarcar un registro final' });
        }

        // Valor seguro: conservar existente cuando el campo no viene.
        let finalIsFinalLog = existingIsFinalLog;
        if (requestedIsFinalLog !== undefined) {
            if (req.user.role === ROLES.OPERATOR) {
                // Operario solo puede cerrar (true), no reabrir.
                if (requestedIsFinalLog) finalIsFinalLog = true;
            } else {
                finalIsFinalLog = requestedIsFinalLog;
            }
        }

        if (finalIsFinalLog) {
            const duplicatedFinalId = await findExistingFinalLog({
                moldId: finalMoldId,
                planningId: planningIdNum,
                partId: finalPartId,
                machineId: finalMachineId,
                excludeId: Number(id),
            });
            if (duplicatedFinalId) {
                return res.status(409).json({
                    error: 'Ya existe un registro final para esta parte en este ciclo de planificación',
                });
            }
        }

        await query(updateSql, [
            finalMoldId,
            planningIdNum,
            finalPartId,
            finalMachineId,
            finalOperatorId,
            finalWorkDateISO,
            hours_worked !== undefined ? Number(hours_worked) : log.hours_worked,
            reason !== undefined ? reason : log.reason,
            note !== undefined ? note : log.note,
            planned_hours_snapshot,
            finalIsFinalLog,
            id,
        ]);

        await reconcilePlanningStatus(planningIdNum);

        req.app.get('io').emit('workLog_updated');

        res.json({
            message: 'Registro actualizado exitosamente',
            data: {
                id,
                moldId: finalMoldId,
                partId: finalPartId,
                machineId: finalMachineId,
                operatorId: finalOperatorId,
                planning_id: planningIdNum,
                work_date: finalWorkDateISO,
                hours_worked: hours_worked !== undefined ? Number(hours_worked) : log.hours_worked,
                reason: reason !== undefined ? reason : log.reason,
                note: note !== undefined ? note : log.note,
            },
        });
    } catch (error) {
        if (error?.code === '23505') {
            return res.status(409).json({
                error: 'Ya existe un registro final para esta parte en este ciclo de planificación',
            });
        }
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

        const role = String(req?.user?.role || '').toLowerCase();
        const canDelete = [ROLES.ADMIN, ROLES.PLANNER, ROLES.MANAGEMENT].includes(role);
        if (!canDelete) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        const existing = await query('SELECT * FROM work_logs WHERE id = ? LIMIT 1', [id]);
        if (!existing.length) {
            return res.status(404).json({ error: 'Registro no encontrado' });
        }
        const row = existing[0] || {};
        const planningIdNum = Number(row?.planning_id || 0);
        const moldIdNum = Number(row?.mold_id || 0);
        const wasFinalLog = isTruthyFlag(row?.is_final_log);

        const sql = 'DELETE FROM work_logs WHERE id = ?';
        const result = await query(sql, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Registro no encontrado' });
        }

        if (Number.isFinite(planningIdNum) && planningIdNum > 0) {
            if (wasFinalLog && Number.isFinite(moldIdNum) && moldIdNum > 0) {
                const finalRows = await query(
                    `SELECT COUNT(1) AS cnt
                     FROM work_logs
                     WHERE mold_id = ?
                       AND planning_id = ?
                       AND is_final_log = TRUE`,
                    [moldIdNum, planningIdNum]
                );
                const remainingFinals = Number(finalRows?.[0]?.cnt || 0);
                if (remainingFinals <= 0) {
                    await query(
                        `UPDATE planning_history
                         SET status = 'IN_PROGRESS'
                         WHERE id = ?
                           AND event_type = 'PLANNED'`,
                        [planningIdNum]
                    ).catch(() => {});
                }
            }
            await reconcilePlanningStatus(planningIdNum);
        }

        req.app.get('io').emit('workLog_updated');

        res.json({ message: 'Registro eliminado exitosamente' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createWorkLog,
    getWorkLogs,
    updateWorkLog,
    deleteWorkLog,
};
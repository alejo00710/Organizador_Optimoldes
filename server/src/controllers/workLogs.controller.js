const { query } = require('../config/database');
const { ROLES, OPERATOR_EDIT_DAYS_LIMIT } = require('../utils/constants');

async function getPlannedHoursSnapshot({ moldId, partId, machineId }) {
    try {
                if (!moldId || !partId || !machineId) return null;
        const rows = await query(
                        `SELECT SUM(pe2.hours_planned) AS planned_hours
                         FROM plan_entries pe2
                         WHERE pe2.mold_id = ?
                             AND pe2.part_id = ?
                             AND pe2.machine_id = ?`,
                        [moldId, partId, machineId]
        );
        const v = rows?.[0]?.planned_hours;
        if (v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    } catch {
        return null;
    }
}

async function resolvePlanningIdForWorkLog({ moldId, workDateISO }) {
    try {
        if (!moldId) return null;
        const refDate = workDateISO && /^\d{4}-\d{2}-\d{2}$/.test(String(workDateISO))
            ? String(workDateISO)
            : null;

        const rows = await query(
            `SELECT id
             FROM planning_history
             WHERE mold_id = ?
               AND event_type = 'PLANNED'
               ${refDate ? 'AND (to_start_date IS NULL OR to_start_date <= ?)' : ''}
             ORDER BY to_start_date DESC NULLS LAST, created_at DESC, id DESC
             LIMIT 1`,
            refDate ? [moldId, refDate] : [moldId]
        );
        if (rows?.length) {
            const id = Number(rows[0].id);
            return Number.isFinite(id) ? id : null;
        }

        // Fallback: si no hay plan con fecha <= work_date (ej. registro anticipado),
        // asociar al último ciclo PLANNED del molde para no perder trazabilidad.
        const latestRows = await query(
            `SELECT id
             FROM planning_history
             WHERE mold_id = ?
               AND event_type = 'PLANNED'
             ORDER BY to_start_date DESC NULLS LAST, created_at DESC, id DESC
             LIMIT 1`,
            [moldId]
        );
        if (!latestRows?.length) return null;
        const latestId = Number(latestRows[0].id);
        return Number.isFinite(latestId) ? latestId : null;
    } catch {
        return null;
    }
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
        const { moldId, partId, machineId, operatorId, hours_worked, note, reason, work_date, is_final_log } = req.body;

        // Validaciones
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

                // Validar work_date si viene
                const dateStr = work_date ? String(work_date) : null;
                if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                        return res.status(400).json({ error: 'work_date debe ser YYYY-MM-DD' });
                }

                const planned_hours_snapshot = await getPlannedHoursSnapshot({
                    moldId,
                    partId,
                    machineId,
                });

                const planning_id = await resolvePlanningIdForWorkLog({
                    moldId,
                    workDateISO: dateStr,
                });

                // Insertar
                const sql = `
                    INSERT INTO work_logs 
                        (mold_id, planning_id, part_id, machine_id, operator_id, work_date, hours_worked, reason, note, planned_hours_snapshot, is_final_log)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

        const result = await query(sql, [
            moldId,
            planning_id,
            partId,
            machineId,
            operatorId,
            dateStr,
            hours_worked,
            reason || null,
            note || null,
            planned_hours_snapshot,
            is_final_log ? true : false,
        ]);

        res.status(201).json({
            message: 'Registro de trabajo creado exitosamente',
            data: {
                id: result.insertId,
                moldId,
                partId,
                machineId,
                operatorId,
                planning_id,
                work_date: dateStr,
                hours_worked,
                reason,
                note,
            },
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
            SELECT 
                wl.*, 
                m.name as mold_name,
                mp.name as part_name,
                ma.name as machine_name,
                o.name as operator_name,
                COALESCE(pe.planned_hours, wl.planned_hours_snapshot) AS planned_hours,
                (wl.hours_worked - COALESCE(pe.planned_hours, wl.planned_hours_snapshot)) AS diff_hours,
                CASE
                    WHEN COALESCE(pe.planned_hours, wl.planned_hours_snapshot) IS NULL OR COALESCE(pe.planned_hours, wl.planned_hours_snapshot) <= 0 THEN NULL
                    ELSE ROUND(ABS(wl.hours_worked - COALESCE(pe.planned_hours, wl.planned_hours_snapshot)) / COALESCE(pe.planned_hours, wl.planned_hours_snapshot) * 100, 2)
                END AS deviation_pct,
                CASE
                    WHEN COALESCE(pe.planned_hours, wl.planned_hours_snapshot) IS NULL OR COALESCE(pe.planned_hours, wl.planned_hours_snapshot) <= 0 THEN 0
                    WHEN (ABS(wl.hours_worked - COALESCE(pe.planned_hours, wl.planned_hours_snapshot)) / COALESCE(pe.planned_hours, wl.planned_hours_snapshot)) > 0.05 THEN 1
                    ELSE 0
                END AS is_alert
            FROM work_logs wl
            JOIN molds m ON wl.mold_id = m.id
            JOIN mold_parts mp ON wl.part_id = mp.id
            JOIN machines ma ON wl.machine_id = ma.id
            JOIN operators o ON wl.operator_id = o.id
            LEFT JOIN LATERAL (
                                SELECT SUM(pe2.hours_planned) AS planned_hours
                FROM plan_entries pe2
                WHERE pe2.mold_id = wl.mold_id
                  AND pe2.part_id = wl.part_id
                  AND pe2.machine_id = wl.machine_id
            ) pe ON TRUE
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
            moldId,
            partId,
            machineId,
            hours_worked,
            reason,
            note,
            is_final_log,
        } = req.body || {};

        // Obtener el registro actual
        const getSql = 'SELECT * FROM work_logs WHERE id = ?';
        const logs = await query(getSql, [id]);

        if (logs.length === 0) {
            return res.status(404).json({ error: 'Registro no encontrado' });
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

            // El operario solo puede editar hasta N días atrás (preferimos work_date si existe)
            const baseISO = toISODateOnly(log.work_date) || toISODateOnly(log.recorded_at);
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

        const nextOperatorId = operatorId !== undefined ? Number(operatorId) : undefined;
        const nextMoldId = moldId !== undefined ? Number(moldId) : undefined;
        const nextPartId = partId !== undefined ? Number(partId) : undefined;
        const nextMachineId = machineId !== undefined ? Number(machineId) : undefined;

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

        // Validar IDs referenciales si vienen
        if (nextMoldId !== undefined) {
            if (!Number.isFinite(nextMoldId) || nextMoldId <= 0) return res.status(400).json({ error: 'moldId inválido' });
            const rows = await query('SELECT id FROM molds WHERE id = ?', [nextMoldId]);
            if (!rows.length) return res.status(400).json({ error: 'Molde inválido' });
        }
        if (nextPartId !== undefined) {
            if (!Number.isFinite(nextPartId) || nextPartId <= 0) return res.status(400).json({ error: 'partId inválido' });
            const rows = await query('SELECT id FROM mold_parts WHERE id = ?', [nextPartId]);
            if (!rows.length) return res.status(400).json({ error: 'Parte inválida' });
        }
        if (nextMachineId !== undefined) {
            if (!Number.isFinite(nextMachineId) || nextMachineId <= 0) return res.status(400).json({ error: 'machineId inválido' });
            const rows = await query('SELECT id FROM machines WHERE id = ?', [nextMachineId]);
            if (!rows.length) return res.status(400).json({ error: 'Máquina inválida' });
        }

        // Actualizar (si no viene un campo, se conserva)
                const finalWorkDateISO = dateStr !== undefined ? dateStr : log.work_date;
                const finalMoldId = nextMoldId !== undefined ? nextMoldId : log.mold_id;
                const finalPartId = nextPartId !== undefined ? nextPartId : log.part_id;
                const finalMachineId = nextMachineId !== undefined ? nextMachineId : log.machine_id;

                const planned_hours_snapshot = await getPlannedHoursSnapshot({
                    moldId: finalMoldId,
                    partId: finalPartId,
                    machineId: finalMachineId,
                });

                                const nextPlanningId = await resolvePlanningIdForWorkLog({
                                        moldId: finalMoldId,
                                        workDateISO: finalWorkDateISO,
                                });

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

        // is_final_log: operadores solo pueden poner true (no desactivar); admins pueden cambiar
        let finalIsFinalLog = log.is_final_log;
        if (is_final_log !== undefined) {
            const newVal = !!is_final_log;
            if (req.user.role === ROLES.OPERATOR) {
                // Operario solo puede cerrar (true), no reabrir
                if (newVal) finalIsFinalLog = true;
            } else {
                finalIsFinalLog = newVal;
            }
        }

        await query(updateSql, [
            finalMoldId,
            nextPlanningId,
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

        res.json({
            message: 'Registro actualizado exitosamente',
            data: {
                id,
                moldId: nextMoldId,
                partId: nextPartId,
                machineId: nextMachineId,
                operatorId: finalOperatorId,
                planning_id: nextPlanningId,
                work_date: dateStr,
                hours_worked,
                reason,
                note,
            },
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

module.exports = {
    createWorkLog,
    getWorkLogs,
    updateWorkLog,
    deleteWorkLog,
};
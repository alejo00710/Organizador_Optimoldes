const { query } = require('../config/database');

/**
 * GET /machines
 * Obtiene todas las máquinas
 */
const getMachines = async (req, res, next) => {
    try {
        const sql = `
      SELECT * FROM machines 
      WHERE is_active = TRUE 
      ORDER BY name
    `;
        const machines = await query(sql);
        res.json(machines);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /machines/:id
 * Obtiene una máquina por ID
 */
const getMachineById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const sql = 'SELECT * FROM machines WHERE id = ?  AND is_active = TRUE';
        const machines = await query(sql, [id]);

        if (machines.length === 0) {
            return res.status(404).json({ error: 'Máquina no encontrada' });
        }

        res.json(machines[0]);
    } catch (error) {
        next(error);
    }
};

/**
 * POST /machines
 * Crea una nueva máquina
 */
const createMachine = async (req, res, next) => {
    try {
        const { name, operarios_count, notes } = req.body;
        if (!name || !operarios_count) {
            return res.status(400).json({ error: 'name y operarios_count son requeridos' });
        }
        const sql = 'INSERT INTO machines (name, operarios_count, notes) VALUES (?, ?, ?)';
        const result = await query(sql, [name, operarios_count, notes || null]);
        res.status(201).json({ id: result.insertId, name, operarios_count });
    } catch (error) {
        next(error);
    }
};

/**
 * PUT /machines/:id
 * Actualiza una máquina
 */
const updateMachine = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, operarios_count, notes } = req.body;

        const sql = `
      UPDATE machines 
      SET name = COALESCE(?, name),
          operarios_count = COALESCE(?, operarios_count),
          notes = COALESCE(?, notes)
      WHERE id = ? AND is_active = TRUE
    `;

        const result = await query(sql, [name, operarios_count, notes, id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Máquina no encontrada' });
        }

        res.json({ message: 'Máquina actualizada exitosamente' });
    } catch (error) {
        next(error);
    }
};

/**
 * DELETE /machines/:id
 * Desactiva una máquina (soft delete)
 */
const deleteMachine = async (req, res, next) => {
    try {
        const { id } = req.params;

        const sql = 'UPDATE machines SET is_active = FALSE WHERE id = ?';
        const result = await query(sql, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Máquina no encontrada' });
        }

        res.json({ message: 'Máquina desactivada exitosamente' });
    } catch (error) {
        next(error);
    }
};



module.exports = {
    getMachines,
    getMachineById,
    createMachine,
    updateMachine,
    deleteMachine,
};

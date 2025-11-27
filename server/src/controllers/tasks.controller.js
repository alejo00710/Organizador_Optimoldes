const schedulerService = require('../services/scheduler.service');

/**
 * POST /tasks/plan
 * Crea una planificación automática
 */
const createPlan = async (req, res, next) => {
    try {
        const { moldId, partId, machineId, startDate, totalHours } = req.body;

        // Validaciones
        if (!moldId || !partId || !machineId || !startDate || !totalHours) {
            return res.status(400).json({
                error: 'Todos los campos son requeridos: moldId, partId, machineId, startDate, totalHours',
            });
        }

        if (totalHours <= 0) {
            return res.status(400).json({ error: 'totalHours debe ser mayor que 0' });
        }

        // Validar formato de fecha
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(startDate)) {
            return res.status(400).json({ error: 'startDate debe estar en formato YYYY-MM-DD' });
        }

        // Crear planificación
        const result = await schedulerService.createSchedule(
            moldId,
            partId,
            machineId,
            startDate,
            totalHours,
            req.user.userId
        );

        res.status(201).json({
            message: 'Planificación creada exitosamente',
            data: result,
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createPlan,
};

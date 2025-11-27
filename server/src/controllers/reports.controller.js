const deviationService = require('../services/deviation.service');

/**
 * GET /reports/planned-vs-actual
 * Reporte de planificado vs real con desviaciones
 */
const getPlannedVsActual = async (req, res, next) => {
    try {
        const { from, to, moldId, partId, machineId } = req.query;

        // Validar fechas si están presentes
        if (from || to) {
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if ((from && !dateRegex.test(from)) || (to && !dateRegex.test(to))) {
                return res.status(400).json({
                    error: 'Las fechas deben estar en formato YYYY-MM-DD',
                });
            }
        }

        const filters = {
            startDate: from,
            endDate: to,
            moldId: moldId ? parseInt(moldId) : null,
            partId: partId ? parseInt(partId) : null,
            machineId: machineId ? parseInt(machineId) : null,
        };

        const deviation = await deviationService.getDeviationReport(filters);

        res.json({
            filters,
            result: deviation,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /reports/detailed-deviations
 * Reporte detallado con todas las combinaciones
 */
const getDetailedDeviations = async (req, res, next) => {
    try {
        const { from, to } = req.query;

        const report = await deviationService.getDetailedDeviationReport(from, to);

        // Filtrar solo los que tienen alerta
        const alerts = report.filter((r) => r.hasAlert);

        res.json({
            total: report.length,
            alerts: alerts.length,
            data: report,
            alertsOnly: alerts,
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getPlannedVsActual,
    getDetailedDeviations,
};

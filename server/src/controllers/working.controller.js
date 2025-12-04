const { setWorkingOverride, isBusinessDay } = require('../services/businessDays.service');

/**
 * POST /working/override
 * body: { date: 'YYYY-MM-DD', isWorking: true|false }
 */
const setOverride = async (req, res, next) => {
    try {
        const { date, isWorking } = req.body;
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!date || !dateRegex.test(date) || typeof isWorking !== 'boolean') {
            return res.status(400).json({ error: 'date (YYYY-MM-DD) e isWorking (boolean) son requeridos' });
        }
        await setWorkingOverride(date, isWorking);
        res.json({ message: 'Override actualizado', date, isWorking });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /working/check?date=YYYY-MM-DD
 * Devuelve si la fecha es laborable (considerando overrides, fines de semana y festivos)
 */
const checkDate = async (req, res, next) => {
    try {
        const { date } = req.query;
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!date || !dateRegex.test(date)) {
            return res.status(400).json({ laborable: false, error: 'Fecha inválida' });
        }
        const d = new Date(date + 'T00:00:00Z'); // evitar TZ local
        return res.json({ laborable: isBusinessDay(d) });
    } catch (e) {
        next(e);
    }
};

module.exports = { setOverride, checkDate };
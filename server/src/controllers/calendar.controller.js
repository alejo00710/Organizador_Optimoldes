const calendarService = require('../services/calendar.service');

/**
 * GET /calendar
 * Obtiene datos del calendario (plan + real)
 */
const getCalendar = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    
    if (!from || !to) {
      return res.status(400). json({
        error: 'Parámetros requeridos: from y to (formato YYYY-MM-DD)'
      });
    }
    
    // Validar formato de fechas
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(from) || ! dateRegex.test(to)) {
      return res.status(400).json({
        error: 'Las fechas deben estar en formato YYYY-MM-DD'
      });
    }
    
    const events = await calendarService.getCalendarData(from, to);
    const summary = await calendarService.getDailySummary(from, to);
    
    res.json({
      events,
      summary
    });
    
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCalendar
};
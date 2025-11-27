const { query } = require('../config/database');

/**
 * GET /holidays
 * Obtiene todos los festivos
 */
const getHolidays = async (req, res, next) => {
  try {
    const { year } = req.query;
    
    let sql = 'SELECT * FROM holidays';
    let params = [];
    
    if (year) {
      sql += ' WHERE YEAR(date) = ?';
      params.push(year);
    }
    
    sql += ' ORDER BY date';
    
    const holidays = await query(sql, params);
    res. json(holidays);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /holidays
 * Crea un nuevo festivo
 */
const createHoliday = async (req, res, next) => {
  try {
    const { date, name } = req.body;
    
    if (!date || !name) {
      return res.status(400).json({ 
        error: 'date y name son requeridos' 
      });
    }
    
    // Validar formato de fecha
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (! dateRegex.test(date)) {
      return res.status(400).json({ 
        error: 'date debe estar en formato YYYY-MM-DD' 
      });
    }
    
    const sql = 'INSERT INTO holidays (date, name) VALUES (?, ?)';
    await query(sql, [date, name]);
    
    res.status(201).json({
      message: 'Festivo creado exitosamente',
      data: { date, name }
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ 
        error: 'Ya existe un festivo para esta fecha' 
      });
    }
    next(error);
  }
};

/**
 * DELETE /holidays/:date
 * Elimina un festivo
 */
const deleteHoliday = async (req, res, next) => {
  try {
    const { date } = req.params;
    
    const sql = 'DELETE FROM holidays WHERE date = ?';
    const result = await query(sql, [date]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Festivo no encontrado' });
    }
    
    res.json({ message: 'Festivo eliminado exitosamente' });
  } catch (error) {
    next(error);
  }
};

module. exports = {
  getHolidays,
  createHoliday,
  deleteHoliday
};
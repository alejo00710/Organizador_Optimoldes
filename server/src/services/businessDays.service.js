const { query } = require('../config/database');
const { WORKING_DAYS } = require('../utils/constants');

/**
 * Verifica si una fecha es festivo
 */
const isHoliday = async (date) => {
    const sql = 'SELECT COUNT(*) as count FROM holidays WHERE date = ?';
    const result = await query(sql, [date]);
    return result[0].count > 0;
};

/**
 * Verifica si una fecha es día hábil (Lun-Vie y no festivo)
 */
const isBusinessDay = async (date) => {
    const dayOfWeek = date.getDay();

    // Verificar si es fin de semana
    if (!WORKING_DAYS.includes(dayOfWeek)) {
        return false;
    }

    // Verificar si es festivo
    const dateStr = date.toISOString().split('T')[0];
    return !(await isHoliday(dateStr));
};

/**
 * Obtiene el siguiente día hábil desde una fecha dada
 */
const getNextBusinessDay = async (date) => {
    const current = new Date(date);
    current.setDate(current.getDate() + 1);

    while (!(await isBusinessDay(current))) {
        current.setDate(current.getDate() + 1);
    }

    return current;
};

/**
 * Obtiene todos los días hábiles en un rango
 */
const getBusinessDaysInRange = async (startDate, endDate) => {
    const businessDays = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
        if (await isBusinessDay(current)) {
            businessDays.push(new Date(current));
        }
        current.setDate(current.getDate() + 1);
    }

    return businessDays;
};

/**
 * Carga todos los festivos en memoria para optimización
 */
const loadHolidays = async () => {
    const sql = 'SELECT date FROM holidays';
    const holidays = await query(sql);
    return new Set(holidays.map((h) => h.date.toISOString().split('T')[0]));
};

module.exports = {
    isHoliday,
    isBusinessDay,
    getNextBusinessDay,
    getBusinessDaysInRange,
    loadHolidays,
};

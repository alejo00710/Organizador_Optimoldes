const { query } = require('../config/database');
const { WORKING_DAYS } = require('../utils/constants');

// Usamos una variable en memoria para almacenar los festivos y evitar consultas repetidas.
let holidaysSet = new Set();

/**
 * Carga todos los festivos de la base de datos en el Set en memoria.
 * Esta función se debe llamar UNA SOLA VEZ al iniciar el servidor.
 */
const loadHolidays = async () => {
    try {
        const holidaysData = await query('SELECT date FROM holidays');
        // Aseguramos que la fecha se guarde en formato 'YYYY-MM-DD'
        const holidayDates = holidaysData.map(h => new Date(h.date).toISOString().split('T')[0]);
        holidaysSet = new Set(holidayDates);
        console.log(`✅ ${holidaysSet.size} festivos cargados y cacheados en memoria.`);
    } catch (error) {
        console.error('❌ Error fatal al cargar los festivos en memoria. La planificación puede ser incorrecta.', error);
        // En un entorno de producción real, podría ser necesario detener el servidor si los festivos son críticos.
    }
};

/**
 * Verifica si una fecha es día hábil de forma síncrona, usando los datos en memoria.
 * @param {Date} date - El objeto Date a verificar.
 * @returns {boolean} - True si es un día laborable.
 */
const isBusinessDay = (date) => {
    const dayOfWeek = date.getDay(); // 0 (Dom) - 6 (Sáb)

    // 1. Verificar si es fin de semana (usando el estándar de JS, no el array de constantes)
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return false;
    }

    // 2. Verificar si es festivo usando el Set en memoria (búsqueda O(1), muy rápido)
    const dateStr = date.toISOString().split('T')[0];
    if (holidaysSet.has(dateStr)) {
        return false;
    }

    return true;
};

/**
 * Obtiene el siguiente día hábil de forma síncrona.
 * @param {Date} date - La fecha desde la cual empezar a buscar.
 * @returns {Date} - El siguiente día que es laborable.
 */
const getNextBusinessDay = (date) => {
    const nextDay = new Date(date);
    // Empezamos a verificar desde el día SIGUIENTE a la fecha dada.
    nextDay.setDate(nextDay.getDate() + 1);

    while (!isBusinessDay(nextDay)) {
        nextDay.setDate(nextDay.getDate() + 1);
    }
    return nextDay;
};

/**
 * Obtiene el Set de festivos cacheados. Útil para el controlador del calendario.
 * @returns {Set<string>} - Un Set con todas las fechas de festivos.
 */
const getCachedHolidays = () => {
    return holidaysSet;
};

module.exports = {
    loadHolidays,
    isBusinessDay,
    getNextBusinessDay,
    getCachedHolidays
};
const { query } = require('../config/database');
const { getColombiaHolidays } = require('./holidaysColombia.service');

// Cache en memoria
let holidaysSet = new Set();         // Para membership O(1)
let holidaysNameMap = new Map();     // date => name (incluye DB + automáticos)

/**
 * Carga festivos a memoria combinando:
 * - Festivos registrados en DB (empresa)
 * - Festivos automáticos de Colombia (año actual +/- 1 año)
 */
const loadHolidays = async () => {
    const now = new Date();
    const years = [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1];

    const newSet = new Set();
    const newMap = new Map();

    // 1) Festivos de DB
    try {
        const rows = await query('SELECT DATE_FORMAT(date, "%Y-%m-%d") AS date_str, name FROM holidays');
        for (const r of rows) {
            newSet.add(r.date_str);
            newMap.set(r.date_str, r.name);
        }
    } catch (e) {
        console.warn('Advertencia: No se pudieron cargar festivos desde DB:', e.message);
    }

    // 2) Festivos automáticos de Colombia (por cada año)
    for (const y of years) {
        const list = getColombiaHolidays(y);
        for (const h of list) {
            if (!newSet.has(h.date)) {
                newSet.add(h.date);
                newMap.set(h.date, h.name);
            }
        }
    }

    holidaysSet = newSet;
    holidaysNameMap = newMap;
    console.log(`✅ Festivos en memoria: ${holidaysSet.size} (DB + automáticos)`);
};

/**
 * Devuelve true si la fecha es día hábil (no sábado/domingo ni festivo)
 */
const isBusinessDay = (date) => {
    const dow = date.getDay(); // 0=Domingo, 6=Sábado
    if (dow === 0 || dow === 6) return false;
    const dateStr = date.toISOString().split('T')[0];
    return !holidaysSet.has(dateStr);
};

/**
 * Próximo día hábil (desde el día siguiente a 'date')
 */
const getNextBusinessDay = (date) => {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    while (!isBusinessDay(d)) {
        d.setDate(d.getDate() + 1);
    }
    return d;
};

/**
 * Devuelve un objeto { 'YYYY-MM-DD': 'Nombre' } con los festivos del mes
 */
const getHolidaysForMonth = (year, month) => {
    const result = {};
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    let cursor = new Date(start);
    while (cursor <= end) {
        const key = cursor.toISOString().split('T')[0];
        if (holidaysSet.has(key)) {
            result[key] = holidaysNameMap.get(key) || 'Festivo';
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return result;
};

const getCachedHolidays = () => holidaysSet;

module.exports = {
    loadHolidays,
    isBusinessDay,
    getNextBusinessDay,
    getHolidaysForMonth,
    getCachedHolidays,
};
const { query } = require('../config/database');
const { getColombiaHolidays } = require('./holidaysColombia.service');

// Cache en memoria
let holidaysSet = new Set();         // Fechas festivas 'YYYY-MM-DD'
let holidaysNameMap = new Map();     // 'YYYY-MM-DD' => nombre
let workingOverrides = new Map();    // 'YYYY-MM-DD' => true (laborable) | false (no laborable)

const loadHolidays = async () => {
    const now = new Date();
    const years = [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1];

    const newSet = new Set();
    const newMap = new Map();

    // Festivos de DB
    try {
        const rows = await query("SELECT to_char(date, 'YYYY-MM-DD') AS date_str, name FROM holidays");
        for (const r of rows) {
            newSet.add(r.date_str);
            newMap.set(r.date_str, r.name);
        }
    } catch (e) {
        console.warn('Festivos desde DB no disponibles:', e.message);
    }

    // Festivos automáticos por año
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

    // Overrides desde DB (si existe)
    try {
        const orows = await query("SELECT to_char(date, 'YYYY-MM-DD') AS date_str, is_working FROM working_overrides");
        workingOverrides = new Map(orows.map(r => [r.date_str, !!r.is_working]));
    } catch (e) {
        workingOverrides = new Map();
    }

    console.log(`✅ Cache: festivos=${holidaysSet.size}, overrides=${workingOverrides.size}`);
};

const setWorkingOverride = async (dateStr, isWorking) => {
    try {
        await query(
            `
            INSERT INTO working_overrides (date, is_working)
            VALUES (?, ?)
            ON CONFLICT (date) DO UPDATE SET is_working = EXCLUDED.is_working
        `,
            [dateStr, !!isWorking]
        );
        workingOverrides.set(dateStr, !!isWorking);
    } catch (e) {
        console.error('Error guardando override:', e.message);
        throw e;
    }
};

/**
 * Devuelve true si la fecha es día hábil (UTC): no sábado/domingo, no festivo, considerando overrides.
 */
const isBusinessDay = (date) => {
    const dow = date.getUTCDay(); // 0=Domingo, 6=Sábado (UTC)
    const dateStr = date.toISOString().split('T')[0];

    // Override manda
    if (workingOverrides.has(dateStr)) {
        return workingOverrides.get(dateStr);
    }

    // Fin de semana
    if (dow === 0 || dow === 6) return false;

    // Festivo
    if (holidaysSet.has(dateStr)) return false;

    return true;
};

/**
 * Avanza al siguiente día hábil usando UTC
 */
const getNextBusinessDay = (date) => {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + 1);
    while (!isBusinessDay(d)) {
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return d;
};

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

module.exports = {
    loadHolidays,
    isBusinessDay,
    getNextBusinessDay,
    getHolidaysForMonth,
    setWorkingOverride,
};
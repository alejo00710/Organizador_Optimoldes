module.exports = async () => {
    // Importante: setear antes de usar setupDatabase
    process.env.NODE_ENV = 'test';

    // Si ya tienes DB lista, esto solo verifica/asegura tablas y migraciones idempotentes.
    // En test NO intenta crear la base de datos (ver setupDatabase.js).
    const { initializeDatabase } = require('../server/src/config/setupDatabase');
    await initializeDatabase();

    // El endpoint de calendario depende de cache en memoria; la app normal lo carga al arrancar.
    const { loadHolidays } = require('../server/src/services/businessDays.service');
    await loadHolidays();
};

module.exports = async () => {
    try {
        const { createPool } = require('../server/src/config/database');
        const pool = createPool();
        await pool.end();
    } catch (e) {
        // Si no se creó pool o falló conexión, no bloqueamos el teardown
    }
};

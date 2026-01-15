afterAll(async () => {
    // Importante: cerrar pool que se crea en el WORKER cuando un test hace queries
    try {
        const { createPool } = require('../server/src/config/database');
        await createPool().end();
    } catch (_) {
        // no-op
    }
});

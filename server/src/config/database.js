const mysql = require('mysql2/promise');
const { db } = require('./env');

let pool;

/**
 * Crea o devuelve el pool de conexiones principal a la base de datos de la aplicación.
 * Esta función asume que la base de datos ya existe.
 */
const createPool = () => {
    if (pool) {
        return pool;
    }
    pool = mysql.createPool({
        host: db.host,
        port: db.port,
        user: db.user,
        password: db.password,
        database: db.name, // Se conecta a la BD específica
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        multipleStatements: true, // Habilitar para ejecutar el script de schema
    });
    return pool;
};

/**
 * Obtiene una conexión del pool principal.
 */
const getConnection = async () => {
    return await createPool().getConnection();
};

/**
 * Ejecuta una consulta en el pool principal.
 */
const query = async (sql, params) => {
    const [rows] = await createPool().execute(sql, params);
    return rows;
};

/**
 * Crea una conexión temporal al servidor MySQL SIN especificar una base de datos.
 * Útil para tareas administrativas como crear la propia base de datos.
 */
const createRootConnection = async () => {
    return await mysql.createConnection({
        host: db.host,
        port: db.port,
        user: db.user,
        password: db.password,
    });
};

module.exports = {
    createPool,
    getConnection,
    query,
    createRootConnection, // <-- Nueva función exportada
};
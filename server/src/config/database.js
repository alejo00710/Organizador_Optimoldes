const { Pool, Client } = require('pg');
const { db } = require('./env');

let pool;

function quoteIdentifierStrict(name) {
    // CREATE DATABASE no admite parámetros; evitamos inyección validando.
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_]+$/.test(name)) {
        throw new Error(`Nombre de BD inválido (use solo letras/números/_): ${name}`);
    }
    return `"${name}"`;
}

function convertQuestionMarksToPgParams(sql) {
    // Convierte placeholders estilo '?' a PostgreSQL ($1, $2, ...)
    // ignorando strings y quoted identifiers.
    if (typeof sql !== 'string' || sql.indexOf('?') === -1) return sql;

    let out = '';
    let i = 0;
    let paramIndex = 0;

    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;

    while (i < sql.length) {
        const ch = sql[i];

        // Manejo de escapes dentro de strings
        if (inSingle) {
            out += ch;
            if (ch === "'" && sql[i + 1] === "'") {
                // escape SQL standard ''
                out += sql[i + 1];
                i += 2;
                continue;
            }
            if (ch === "'" && sql[i - 1] !== '\\') inSingle = false;
            i += 1;
            continue;
        }
        if (inDouble) {
            out += ch;
            if (ch === '"' && sql[i - 1] !== '\\') inDouble = false;
            i += 1;
            continue;
        }
        if (inBacktick) {
            out += ch;
            if (ch === '`') inBacktick = false;
            i += 1;
            continue;
        }

        if (ch === "'") {
            inSingle = true;
            out += ch;
            i += 1;
            continue;
        }
        if (ch === '"') {
            inDouble = true;
            out += ch;
            i += 1;
            continue;
        }
        if (ch === '`') {
            inBacktick = true;
            out += ch;
            i += 1;
            continue;
        }

        if (ch === '?') {
            paramIndex += 1;
            out += `$${paramIndex}`;
            i += 1;
            continue;
        }

        out += ch;
        i += 1;
    }
    return out;
}

function looksLikeInsertNeedingId(sql) {
    const raw = String(sql || '');
    const s = raw.trim().toUpperCase();
    if (!s.startsWith('INSERT')) return false;
    if (/\bRETURNING\b/i.test(raw)) return false;

    // Intentar inferir tabla destino y solo agregar RETURNING si tiene columna id.
    const m = /^\s*INSERT\s+INTO\s+([a-zA-Z0-9_\."`]+)/i.exec(raw);
    if (!m) return false;
    let table = m[1];
    table = table.replace(/[`\"]/g, '');
    if (table.includes('.')) table = table.split('.').pop();
    table = table.toLowerCase();

    const tablesWithId = new Set([
        'users',
        'operators',
        'processes',
        'machines',
        'molds',
        'mold_parts',
        'operations',
        'plan_entries',
        'work_logs',
        'user_sessions',
        'import_batches',
        'import_errors',
        'datos',
        'mold_recipes',
        'mold_recipe_lines',
    ]);

    return tablesWithId.has(table);
}

function normalizeResultForMysqlCompatibility(res, originalSql) {
    const command = String(res?.command || '').toUpperCase();
    if (command === 'SELECT' || command === 'SHOW') {
        return res.rows;
    }
    if (command === 'INSERT') {
        const insertId = res.rows && res.rows[0] && (res.rows[0].id ?? res.rows[0].ID);
        return {
            insertId: insertId != null ? Number(insertId) : undefined,
            affectedRows: res.rowCount ?? 0,
        };
    }
    if (command === 'UPDATE' || command === 'DELETE') {
        return {
            affectedRows: res.rowCount ?? 0,
        };
    }
    // CREATE / ALTER / etc
    return {
        affectedRows: res.rowCount ?? 0,
    };
}

/**
 * Crea o devuelve el pool de conexiones principal a la base de datos de la aplicación.
 * Esta función asume que la base de datos ya existe.
 */
const createPool = () => {
    if (pool) {
        return pool;
    }
    pool = new Pool({
        host: db.host,
        port: db.port,
        user: db.user,
        password: db.password,
        database: db.name, // Se conecta a la BD específica
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
    });
    return pool;
};

/**
 * Obtiene una conexión del pool principal.
 */
const getConnection = async () => {
    return await createPool().connect();
};

/**
 * Ejecuta una consulta en el pool principal.
 */
const query = async (sql, params) => {
    const originalSql = String(sql);
    let finalSql = convertQuestionMarksToPgParams(originalSql);

    // Para mantener compatibilidad con el shape previo (insertId), agregamos RETURNING id si aplica.
    if (looksLikeInsertNeedingId(finalSql)) {
        finalSql = `${finalSql.trim().replace(/;\s*$/, '')} RETURNING id`;
    }

    const res = await createPool().query(finalSql, params);
    return normalizeResultForMysqlCompatibility(res, originalSql);
};

/**
 * Crea una conexión temporal al servidor PostgreSQL SIN conectarse a la BD de la app.
 * Útil para tareas administrativas como crear la propia base de datos.
 */
const createRootConnection = async () => {
    const client = new Client({
        host: db.host,
        port: db.port,
        user: db.user,
        password: db.password,
        database: 'postgres',
    });
    await client.connect();

    // Adjuntamos un helper usado por setupDatabase
    client.__quoteDbName = () => quoteIdentifierStrict(db.name);
    return client;
};

module.exports = {
    createPool,
    getConnection,
    query,
    createRootConnection, // <-- Nueva función exportada
};
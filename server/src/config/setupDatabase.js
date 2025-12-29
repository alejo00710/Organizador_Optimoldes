const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { db } = require('./env');
const { createRootConnection, query } = require('./database');

async function initializeDatabase() {
    if (process.env.NODE_ENV !== 'development') {
        return;
    }

    console.log('Entorno de desarrollo. Iniciando configuración de la base de datos...');

    // 1. Crear la base de datos si no existe
    let rootConnection;
    try {
        rootConnection = await createRootConnection();
        await rootConnection.query(`CREATE DATABASE IF NOT EXISTS \`${db.name}\`;`);
        console.log(`✅ Base de datos "${db.name}" asegurada.`);
    } catch (error) {
        console.error(`❌ Error fatal al crear la base de datos:`, error.message);
        process.exit(1);
    } finally {
        if (rootConnection) await rootConnection.end();
    }

    // 2. Crear las tablas (el script SQL ahora maneja "IF NOT EXISTS")
    try {
        const schemaPath = path.join(__dirname, '../../schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        const pool = require('./database').createPool();
        await pool.query(schemaSql);
        console.log('✅ Tablas verificadas y aseguradas.');

        // Migraciones pequeñas e idempotentes (solo desarrollo)
        try {
            const col = await query(
                `SELECT COUNT(1) AS cnt
                 FROM information_schema.columns
                 WHERE table_schema = DATABASE()
                   AND table_name = 'plan_entries'
                   AND column_name = 'is_priority'`
            );
            const hasCol = Number(col?.[0]?.cnt || 0) > 0;
            if (!hasCol) {
                await query(`ALTER TABLE plan_entries ADD COLUMN is_priority TINYINT(1) NOT NULL DEFAULT 0`);
                console.log('✅ Migración aplicada: plan_entries.is_priority');
            }
        } catch (e) {
            console.warn('⚠️ No se pudo aplicar migración plan_entries.is_priority:', e.message);
        }
    } catch (error) {
        console.error(`❌ Error al ejecutar el script del schema:`, error.message);
        process.exit(1);
    }

    // 3. Crear el usuario administrador si no existe
    try {
        const users = await query('SELECT * FROM users WHERE username = "admin"');
        if (users.length === 0) {
            console.log('Usuario "admin" no encontrado. Creándolo...');
            const password = 'admin';
            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(password, salt);
            await query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', ['admin', password_hash, 'admin']);
            console.log('✅ Usuario "admin" creado con contraseña "admin".');
        } else {
            console.log('✅ Usuario "admin" ya existe.');
        }
    } catch (error) {
        console.error(`❌ Error al verificar/crear el usuario admin:`, error.message);
        process.exit(1);
    }
}

module.exports = { initializeDatabase };
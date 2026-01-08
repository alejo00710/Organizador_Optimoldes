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
        const exists = await rootConnection.query('SELECT 1 FROM pg_database WHERE datname = $1', [db.name]);
        if (!exists.rows.length) {
            const qName = rootConnection.__quoteDbName ? rootConnection.__quoteDbName() : `"${db.name}"`;
            await rootConnection.query(`CREATE DATABASE ${qName};`);
            console.log(`✅ Base de datos "${db.name}" creada.`);
        } else {
            console.log(`✅ Base de datos "${db.name}" ya existe.`);
        }
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
        // pg permite múltiples sentencias en query simple (sin parámetros)
        await pool.query(schemaSql);
        console.log('✅ Tablas verificadas y aseguradas.');

        // Migraciones pequeñas e idempotentes (solo desarrollo)
        try {
            const col = await query(
                `SELECT COUNT(1) AS cnt
                 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'plan_entries'
                   AND column_name = 'is_priority'`
            );
            const hasCol = Number(col?.[0]?.cnt || 0) > 0;
            if (!hasCol) {
                await query(`ALTER TABLE plan_entries ADD COLUMN is_priority BOOLEAN NOT NULL DEFAULT FALSE`);
                console.log('✅ Migración aplicada: plan_entries.is_priority');
            }
        } catch (e) {
            console.warn('⚠️ No se pudo aplicar migración plan_entries.is_priority:', e.message);
        }

        // work_logs.work_date (para registrar fecha real trabajada desde Tiempos de Moldes)
        try {
            const col = await query(
                `SELECT COUNT(1) AS cnt
                 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'work_logs'
                   AND column_name = 'work_date'`
            );
            const hasCol = Number(col?.[0]?.cnt || 0) > 0;
            if (!hasCol) {
                await query(`ALTER TABLE work_logs ADD COLUMN work_date DATE NULL`);
                await query(`UPDATE work_logs SET work_date = recorded_at::date WHERE work_date IS NULL`);
                try {
                    await query(`CREATE INDEX idx_work_logs_work_date ON work_logs (work_date)`);
                } catch (_) {}
                try {
                    await query(`CREATE INDEX idx_work_logs_operator_date ON work_logs (operator_id, work_date)`);
                } catch (_) {}
                console.log('✅ Migración aplicada: work_logs.work_date');
            }
        } catch (e) {
            console.warn('⚠️ No se pudo aplicar migración work_logs.work_date:', e.message);
        }

        // work_logs.reason (motivo de desviación)
        try {
            const col = await query(
                `SELECT COUNT(1) AS cnt
                 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'work_logs'
                   AND column_name = 'reason'`
            );
            const hasCol = Number(col?.[0]?.cnt || 0) > 0;
            if (!hasCol) {
                await query(`ALTER TABLE work_logs ADD COLUMN reason TEXT NULL`);
                console.log('✅ Migración aplicada: work_logs.reason');
            }
        } catch (e) {
            console.warn('⚠️ No se pudo aplicar migración work_logs.reason:', e.message);
        }

        // operators.password_hash (para login por operario con contraseña propia)
        try {
            const col = await query(
                `SELECT COUNT(1) AS cnt
                 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'operators'
                   AND column_name = 'password_hash'`
            );
            const hasCol = Number(col?.[0]?.cnt || 0) > 0;
            if (!hasCol) {
                await query(`ALTER TABLE operators ADD COLUMN password_hash VARCHAR(255) NULL`);
                console.log('✅ Migración aplicada: operators.password_hash');
            }
        } catch (e) {
            console.warn('⚠️ No se pudo aplicar migración operators.password_hash:', e.message);
        }

        // user_sessions (auditoría de entradas/salidas)
        try {
            await query(
                `CREATE TABLE IF NOT EXISTS user_sessions (
                  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  operator_id INTEGER NULL REFERENCES operators(id) ON DELETE SET NULL,
                  role TEXT NOT NULL CHECK (role IN ('admin','planner','operator')),
                  ip VARCHAR(64) NULL,
                  user_agent VARCHAR(255) NULL,
                  login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  logout_at TIMESTAMPTZ NULL
                );`
            );
            try { await query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id)`); } catch (_) {}
            try { await query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_login ON user_sessions (login_at)`); } catch (_) {}
        } catch (e) {
            console.warn('⚠️ No se pudo asegurar tabla user_sessions:', e.message);
        }
    } catch (error) {
        console.error(`❌ Error al ejecutar el script del schema:`, error.message);
        process.exit(1);
    }

    // Nota: Ya no se crea automáticamente el usuario "admin".
    // El alta inicial de "admin" y "jefe" se hace vía Bootstrap en el login.
}

module.exports = { initializeDatabase };
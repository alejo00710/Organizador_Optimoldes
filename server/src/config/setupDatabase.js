const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { db } = require('./env');
const { createRootConnection, query } = require('./database');

async function initializeDatabase() {
    if (!['development', 'test'].includes(process.env.NODE_ENV)) {
        return;
    }

    console.log(
        process.env.NODE_ENV === 'test'
            ? 'Entorno de test. Verificando esquema/migraciones (sin crear base de datos)...'
            : 'Entorno de desarrollo. Iniciando configuración de la base de datos...'
    );

    // 1. Crear la base de datos si no existe (solo development)
    if (process.env.NODE_ENV === 'development') {
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
        // planning_history.status (estado del ciclo)
        try {
            await query(
                `DO $$
                 BEGIN
                   IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'planning_status') THEN
                     CREATE TYPE planning_status AS ENUM ('IN_PROGRESS', 'COMPLETED');
                   END IF;
                 END$$;`
            );

            const col = await query(
                `SELECT COUNT(1) AS cnt
                 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'planning_history'
                   AND column_name = 'status'`
            );
            const hasCol = Number(col?.[0]?.cnt || 0) > 0;
            if (!hasCol) {
                await query(`ALTER TABLE planning_history ADD COLUMN status planning_status NOT NULL DEFAULT 'IN_PROGRESS'`);
                console.log('✅ Migración aplicada: planning_history.status');
            }

            await query(
                `UPDATE planning_history ph
                 SET status = CASE
                     WHEN x.planned_pairs > 0 AND x.closed_pairs >= x.planned_pairs THEN 'COMPLETED'::planning_status
                     ELSE 'IN_PROGRESS'::planning_status
                 END
                 FROM (
                     WITH plan_pairs AS (
                         SELECT pe.planning_id, pe.part_id, pe.machine_id, SUM(pe.hours_planned) AS planned_hours
                         FROM plan_entries pe
                         WHERE pe.planning_id IS NOT NULL
                         GROUP BY pe.planning_id, pe.part_id, pe.machine_id
                     ),
                     final_pairs AS (
                         SELECT DISTINCT wl.planning_id, wl.part_id, wl.machine_id
                         FROM work_logs wl
                         WHERE wl.planning_id IS NOT NULL
                           AND wl.is_final_log = TRUE
                     )
                     SELECT
                         pp.planning_id,
                         SUM(CASE WHEN pp.planned_hours > 0 THEN 1 ELSE 0 END) AS planned_pairs,
                         SUM(CASE WHEN pp.planned_hours > 0 AND fp.part_id IS NOT NULL THEN 1 ELSE 0 END) AS closed_pairs
                     FROM plan_pairs pp
                     LEFT JOIN final_pairs fp
                       ON fp.planning_id = pp.planning_id
                      AND fp.part_id = pp.part_id
                      AND fp.machine_id = pp.machine_id
                     GROUP BY pp.planning_id
                 ) x
                 WHERE ph.id = x.planning_id
                   AND ph.event_type = 'PLANNED'`
            );
        } catch (e) {
            console.warn('⚠️ No se pudo aplicar migración planning_history.status:', e.message);
        }

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

        // work_logs.planned_hours_snapshot (para mantener Horas plan aunque el calendario se re-programe)
        try {
            const col = await query(
                `SELECT COUNT(1) AS cnt
                 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'work_logs'
                   AND column_name = 'planned_hours_snapshot'`
            );
            const hasCol = Number(col?.[0]?.cnt || 0) > 0;
            if (!hasCol) {
                await query(`ALTER TABLE work_logs ADD COLUMN planned_hours_snapshot NUMERIC(5,2) NULL`);
                console.log('✅ Migración aplicada: work_logs.planned_hours_snapshot');
            }
        } catch (e) {
            console.warn('⚠️ No se pudo aplicar migración work_logs.planned_hours_snapshot:', e.message);
        }

        // work_logs.planning_id (vínculo de registro al ciclo de planificación activo)
        try {
            const col = await query(
                `SELECT COUNT(1) AS cnt
                 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'work_logs'
                   AND column_name = 'planning_id'`
            );
            const hasCol = Number(col?.[0]?.cnt || 0) > 0;
            if (!hasCol) {
                await query(`ALTER TABLE work_logs ADD COLUMN planning_id BIGINT NULL`);
                await query(`ALTER TABLE work_logs ADD CONSTRAINT fk_work_logs_planning_id FOREIGN KEY (planning_id) REFERENCES planning_history(id) ON DELETE SET NULL`);
                try {
                    await query(`CREATE INDEX idx_work_logs_planning_id ON work_logs (planning_id)`);
                } catch (_) {}
                console.log('✅ Migración aplicada: work_logs.planning_id');
            }

            // Backfill seguro para históricos:
            // 1) intenta plan vigente por fecha
            // 2) si no existe, usa el último ciclo PLANNED del molde
            await query(
                `UPDATE work_logs wl
                 SET planning_id = COALESCE(
                     (
                         SELECT p.id
                         FROM planning_history p
                         WHERE p.mold_id = wl.mold_id
                           AND p.event_type = 'PLANNED'
                           AND (p.to_start_date IS NULL OR p.to_start_date <= COALESCE(wl.work_date, wl.recorded_at::date))
                         ORDER BY p.to_start_date DESC NULLS LAST, p.created_at DESC, p.id DESC
                         LIMIT 1
                     ),
                     (
                         SELECT p2.id
                         FROM planning_history p2
                         WHERE p2.mold_id = wl.mold_id
                           AND p2.event_type = 'PLANNED'
                         ORDER BY p2.to_start_date DESC NULLS LAST, p2.created_at DESC, p2.id DESC
                         LIMIT 1
                     )
                 )
                 WHERE wl.planning_id IS NULL`
            );
        } catch (e) {
            console.warn('⚠️ No se pudo aplicar migración work_logs.planning_id:', e.message);
        }

        // Índice único parcial para evitar duplicación de cierres finales por celda del ciclo
        try {
            await query(
                `CREATE UNIQUE INDEX IF NOT EXISTS idx_work_logs_final_unique_cell
                 ON work_logs (planning_id, part_id, machine_id)
                 WHERE is_final_log = TRUE`
            );
        } catch (e) {
            console.warn('⚠️ No se pudo aplicar índice único parcial de work_logs finales:', e.message);
        }

        // plan_entries.planning_id (vínculo del plan diario al ciclo de planificación)
        try {
            const col = await query(
                `SELECT COUNT(1) AS cnt
                 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'plan_entries'
                   AND column_name = 'planning_id'`
            );
            const hasCol = Number(col?.[0]?.cnt || 0) > 0;
            if (!hasCol) {
                await query(`ALTER TABLE plan_entries ADD COLUMN planning_id BIGINT NULL`);
                await query(`ALTER TABLE plan_entries ADD CONSTRAINT fk_plan_entries_planning_id FOREIGN KEY (planning_id) REFERENCES planning_history(id) ON DELETE SET NULL`);
                try {
                    await query(`CREATE INDEX idx_plan_entries_planning_id ON plan_entries (planning_id)`);
                } catch (_) {}
                console.log('✅ Migración aplicada: plan_entries.planning_id');
            }

            await query(
                `UPDATE plan_entries pe
                 SET planning_id = COALESCE(
                     (
                         SELECT ph.id
                         FROM planning_history ph
                         WHERE ph.mold_id = pe.mold_id
                           AND ph.event_type = 'PLANNED'
                           AND ph.created_at <= pe.created_at
                         ORDER BY ph.created_at DESC, ph.id DESC
                         LIMIT 1
                     ),
                     (
                         SELECT ph2.id
                         FROM planning_history ph2
                         WHERE ph2.mold_id = pe.mold_id
                           AND ph2.event_type = 'PLANNED'
                         ORDER BY ph2.created_at ASC, ph2.id ASC
                         LIMIT 1
                     )
                 )
                 WHERE pe.planning_id IS NULL`
            );
        } catch (e) {
            console.warn('⚠️ No se pudo aplicar migración plan_entries.planning_id:', e.message);
        }

        // work_logs.is_final_log (cierre manual de parte)
        try {
            const colFinal = await query(
                `SELECT COUNT(1) AS cnt
                 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'work_logs'
                   AND column_name = 'is_final_log'`
            );
            const hasFinalCol = Number(colFinal?.[0]?.cnt || 0) > 0;
            if (!hasFinalCol) {
                await query(`ALTER TABLE work_logs ADD COLUMN is_final_log BOOLEAN NOT NULL DEFAULT false`);
                console.log('✅ Migración aplicada: work_logs.is_final_log');
            }
        } catch (e) {
            console.warn('⚠️ No se pudo aplicar migración work_logs.is_final_log:', e.message);
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

        // planner_grid_snapshots (snapshots de parrilla del Planificador)
        try {
            await query(
                `CREATE TABLE IF NOT EXISTS planner_grid_snapshots (
                  mold_id INTEGER NOT NULL REFERENCES molds(id) ON DELETE CASCADE,
                  start_date DATE NOT NULL,
                  snapshot_json JSONB NOT NULL,
                  created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                  updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  PRIMARY KEY (mold_id, start_date)
                );`
            );
            try { await query(`CREATE INDEX IF NOT EXISTS idx_planner_grid_snapshots_updated_at ON planner_grid_snapshots (updated_at)`); } catch (_) {}
        } catch (e) {
            console.warn('⚠️ No se pudo asegurar tabla planner_grid_snapshots:', e.message);
        }

            // Nota: no ejecutar deduplicación masiva de datos en cada arranque.
            // Esa operación puede generar conflictos de concurrencia cuando hay
            // múltiples procesos iniciando en paralelo.
    } catch (error) {
        console.error(`❌ Error al ejecutar el script del schema:`, error.message);
        process.exit(1);
    }

    // Nota: Ya no se crea automáticamente el usuario "admin".
    // El alta inicial de "admin" y "jefe" se hace vía Bootstrap en el login.
}

module.exports = { initializeDatabase };
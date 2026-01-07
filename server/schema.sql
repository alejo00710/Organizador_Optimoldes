-- ============================================
-- SCHEMA completo para Sistema de Producción de Moldes
-- Incluye: usuarios, catálogos (operarios, procesos, máquinas, moldes, partes, operaciones),
-- planificaciones, tiempos trabajados, festivos, importación y datos (texto + referencias por ID).
-- ============================================

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================
-- Usuarios y Operarios
-- ============================================

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'planner', 'operator') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS operators (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  user_id INT NULL,
  password_hash VARCHAR(255) NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Evitar error por índice duplicado si se ejecuta varias veces
SET @idx := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'operators'
    AND index_name = 'uniq_operator_name'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE operators ADD UNIQUE INDEX `uniq_operator_name` (`name`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================
-- Catálogos principales
-- ============================================

CREATE TABLE IF NOT EXISTS processes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- NOTA: se elimina operarios_count (ajustado a tu esquema actual)
CREATE TABLE IF NOT EXISTS machines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  daily_capacity DECIMAL(5,2) NULL,   -- Capacidad diaria específica (horas/día)
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS molds (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mold_parts (
  reason TEXT,
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS operations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Planificador y calendario
-- ============================================

CREATE TABLE IF NOT EXISTS plan_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mold_id INT NOT NULL,
  part_id INT NOT NULL,
  machine_id INT NOT NULL,
  date DATE NOT NULL,
  hours_planned DECIMAL(5,2) NOT NULL,
  is_priority TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (mold_id) REFERENCES molds(id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES mold_parts(id) ON DELETE CASCADE,
  FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_plan_entries_date_machine (date, machine_id),
  INDEX idx_plan_entries_mold_part_machine (mold_id, part_id, machine_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS holidays (
  date DATE PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS working_overrides (
  date DATE PRIMARY KEY,
  is_working TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Tiempos trabajados (Work logs)
-- ============================================

CREATE TABLE IF NOT EXISTS work_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mold_id INT NOT NULL,
  part_id INT NOT NULL,
  machine_id INT NOT NULL,
  operator_id INT NOT NULL,
  work_date DATE NULL,
  hours_worked DECIMAL(5,2) NOT NULL,
  note TEXT,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (mold_id) REFERENCES molds(id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES mold_parts(id) ON DELETE CASCADE,
  FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE,
  FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE RESTRICT,
  INDEX idx_work_logs_recorded_at (recorded_at),
  INDEX idx_work_logs_work_date (work_date),
  INDEX idx_work_logs_operator_date (operator_id, work_date),
  INDEX idx_work_logs_machine_date (machine_id, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Auditoría de sesiones (login/logout)
-- ============================================

CREATE TABLE IF NOT EXISTS user_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  operator_id INT NULL,
  role ENUM('admin', 'planner', 'operator') NOT NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  logout_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE SET NULL,
  INDEX idx_user_sessions_user (user_id),
  INDEX idx_user_sessions_login (login_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Indicadores (mensual): horas por operario (vista) + días hábiles manuales
-- ============================================

CREATE TABLE IF NOT EXISTS operator_working_days_monthly (
  operator_id INT NOT NULL,
  year SMALLINT NOT NULL,
  month TINYINT NOT NULL,
  working_days INT NOT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (operator_id, year, month),
  FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_op_days_year_month (year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nota: No creamos vista aquí porque en instalaciones existentes la tabla work_logs
-- puede no tener aún la columna work_date cuando se ejecuta este schema.
-- La migración en server/src/config/setupDatabase.js agrega work_date de forma idempotente.

-- ============================================
-- Importación
-- ============================================

CREATE TABLE IF NOT EXISTS import_batches (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  total_rows INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  fail_count INT NOT NULL DEFAULT 0,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_import_batches_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS import_errors (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id BIGINT NOT NULL,
  row_no INT NOT NULL,
  nombre_operario VARCHAR(255) NULL,
  tipo_proceso VARCHAR(255) NULL,
  molde VARCHAR(255) NULL,
  parte VARCHAR(255) NULL,
  maquina VARCHAR(255) NULL,
  operacion VARCHAR(255) NULL,
  horas_original VARCHAR(255) NULL,
  reason VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
  INDEX idx_import_errors_batch_row (batch_id, row_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Datos (histórico): texto + (opcional) referencias por ID
-- ============================================

CREATE TABLE IF NOT EXISTS datos (
  id INT AUTO_INCREMENT PRIMARY KEY,

  -- Fecha (texto)
  dia TINYINT NULL,
  mes VARCHAR(20) NULL,
  anio SMALLINT NULL,

  -- Texto libre (compatibilidad con importaciones existentes)
  nombre_operario VARCHAR(100) NULL,
  tipo_proceso VARCHAR(100) NULL,
  molde VARCHAR(150) NULL,
  parte VARCHAR(150) NULL,
  maquina VARCHAR(100) NULL,
  operacion VARCHAR(150) NULL,

  -- Referencias por ID (para catálogos; opcionalmente rellenables)
  operator_id INT NULL,
  process_id INT NULL,
  mold_id INT NULL,
  part_id INT NULL,
  machine_id INT NULL,
  operation_id INT NULL,

  -- Horas y metadatos
  horas DECIMAL(6,2) NULL,
  source ENUM('manual','import') NOT NULL DEFAULT 'manual',
  import_batch_id BIGINT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL,

  FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE SET NULL,
  FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE SET NULL,
  FOREIGN KEY (mold_id) REFERENCES molds(id) ON DELETE SET NULL,
  FOREIGN KEY (part_id) REFERENCES mold_parts(id) ON DELETE SET NULL,
  FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE SET NULL,
  FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE SET NULL,

  -- Índices
  KEY idx_datos_dia_mes_anio (anio, mes, dia),
  KEY idx_datos_operario (nombre_operario),
  KEY idx_datos_molde_parte (molde, parte),
  KEY idx_datos_maquina (maquina),
  KEY idx_datos_source (source),
  KEY idx_datos_created_at (created_at),

  KEY idx_datos_operator_id (operator_id),
  KEY idx_datos_process_id (process_id),
  KEY idx_datos_mold_part_id (mold_id, part_id),
  KEY idx_datos_machine_id (machine_id),
  KEY idx_datos_operation_id (operation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Recetas por molde
-- ============================================

CREATE TABLE IF NOT EXISTS mold_recipes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mold_id INT NOT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (mold_id) REFERENCES molds(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_mold_recipes_mold (mold_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mold_recipe_lines (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  recipe_id BIGINT NOT NULL,
  part_id INT NULL,
  part_name VARCHAR(255) NULL,
  machine_id INT NULL,
  machine_name VARCHAR(255) NULL,
  base_hours DECIMAL(6,2) NULL,
  sequence INT DEFAULT 0,
  FOREIGN KEY (recipe_id) REFERENCES mold_recipes(id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES mold_parts(id) ON DELETE SET NULL,
  FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE SET NULL,
  INDEX idx_recipe_seq (recipe_id, sequence)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Semillas: máquinas predeterminadas (sin operarios_count)
-- ============================================

INSERT INTO machines (name, daily_capacity, is_active)
VALUES
  ('CNC VF3 #1', 15.00, TRUE),
  ('CNC VF3 #2', 15.00, TRUE),
  ('Fresadora #1', 14.00, TRUE),
  ('Fresadora #2', 14.00, TRUE),
  ('Torno CNC', 9.50, TRUE),
  ('Erosionadora', 14.00, TRUE),
  ('Rectificadora', 14.00, TRUE),
  ('Torno', 14.00, TRUE),
  ('Taladro radial', 14.00, TRUE),
  ('Pulida', 9.50, TRUE)
ON DUPLICATE KEY UPDATE
  daily_capacity = VALUES(daily_capacity),
  is_active = VALUES(is_active);

-- ============================================
-- Semillas: partes predeterminadas
-- ============================================

INSERT INTO mold_parts (name, is_active)
VALUES
  ('Anillo de Expulsion', TRUE),
  ('Anillo de Registro', TRUE),
  ('Boquilla Principal', TRUE),
  ('Botador inclinado', TRUE),
  ('Buje de Expulsion', TRUE),
  ('Buje Principal', TRUE),
  ('Bujes de Rama', TRUE),
  ('Correderas', TRUE),
  ('Deflector de Refrigeración', TRUE),
  ('Devolvedores', TRUE),
  ('Electrodos', TRUE),
  ('Flanche actuador hidraulico', TRUE),
  ('Guia actuadur hidraulico', TRUE),
  ('Guia Principal', TRUE),
  ('Guias de expulsion', TRUE),
  ('Guias de Rama', TRUE),
  ('Haladores', TRUE),
  ('Hembra', TRUE),
  ('Hembra empotrada', TRUE),
  ('Limitadores de Placa Flotante', TRUE),
  ('Macho', TRUE),
  ('Macho Central', TRUE),
  ('Macho empotrado', TRUE),
  ('Molde completo', TRUE),
  ('Nylon', TRUE),
  ('Paralelas Porta Macho', TRUE),
  ('Pilares Soporte', TRUE),
  ('Placa anillos expulsores', TRUE),
  ('Placa de Expulsion', TRUE),
  ('Placa Expulsion de Rama', TRUE),
  ('Placa Portahembras', TRUE),
  ('Placa Portamachos', TRUE),
  ('placa respaldo anillos expulsores', TRUE),
  ('Placa Respaldo de Expulsion', TRUE),
  ('Placa Respaldo Hembras', TRUE),
  ('Placa Respaldo Inferior', TRUE),
  ('Placa Respaldo Machos', TRUE),
  ('Placa respaldo portamachos', TRUE),
  ('Placa Respaldo Superior', TRUE),
  ('Placa Tope', TRUE),
  ('Porta Fondo', TRUE),
  ('Retenedores de Rama', TRUE),
  ('Soporte correderas', TRUE),
  ('Soporte nylon', TRUE),
  ('Tapones de Enfriamiento', TRUE),
  ('Techos', TRUE)
ON DUPLICATE KEY UPDATE
  is_active = VALUES(is_active);
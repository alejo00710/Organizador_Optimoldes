-- ============================================
-- SCHEMA para Sistema de Producción de Moldes
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
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Máquinas con capacidad diaria por máquina (daily_capacity)
CREATE TABLE IF NOT EXISTS machines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  operarios_count INT NOT NULL DEFAULT 1,
  daily_capacity DECIMAL(5,2) NULL,           -- Capacidad diaria específica por máquina (horas/día). Si NULL, el scheduler no limita.
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
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plan_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mold_id INT NOT NULL,
  part_id INT NOT NULL,
  machine_id INT NOT NULL,
  date DATE NOT NULL,
  hours_planned DECIMAL(5,2) NOT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (mold_id) REFERENCES molds(id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES mold_parts(id) ON DELETE CASCADE,
  FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_plan_entries_date_machine (date, machine_id),
  INDEX idx_plan_entries_mold_part_machine (mold_id, part_id, machine_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mold_id INT NOT NULL,
  part_id INT NOT NULL,
  machine_id INT NOT NULL,
  operator_id INT NOT NULL,
  hours_worked DECIMAL(5,2) NOT NULL,
  note TEXT,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (mold_id) REFERENCES molds(id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES mold_parts(id) ON DELETE CASCADE,
  FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE,
  FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE RESTRICT,
  INDEX idx_work_logs_recorded_at (recorded_at),
  INDEX idx_work_logs_machine_date (machine_id, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS holidays (
  date DATE PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lotes de importación
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

-- Errores de importación (diagnóstico)
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

-- DATOS (registro libre/importado)
CREATE TABLE IF NOT EXISTS datos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dia TINYINT NULL,
  mes VARCHAR(20) NULL,
  anio SMALLINT NULL,
  nombre_operario VARCHAR(100) NULL,
  tipo_proceso VARCHAR(100) NULL,
  molde VARCHAR(150) NULL,
  parte VARCHAR(150) NULL,
  maquina VARCHAR(100) NULL,
  operacion VARCHAR(150) NULL,
  horas DECIMAL(4,2) NULL,
  source ENUM('manual','import') NULL DEFAULT 'manual',
  import_batch_id BIGINT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL,

  KEY idx_datos_dia_mes_anio (anio, mes, dia),
  KEY idx_datos_operario (nombre_operario),
  KEY idx_datos_molde_parte (molde, parte),
  KEY idx_datos_maquina (maquina),
  KEY idx_datos_source (source),
  KEY idx_datos_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS working_overrides (
  date DATE PRIMARY KEY,
  is_working TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Recetas por molde
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

-- Líneas de receta (una por parte/máquina)
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
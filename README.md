# 🏭 Organizador de Taller Industrial

Sistema integral para planificar, ejecutar y auditar la produccion de moldes en un entorno industrial.

Combina planificacion operativa por ciclos, registro de trabajo real en planta y control financiero por molde para transformar la gestion del taller en un flujo trazable de punta a punta.

## 🎯 Descripcion Ejecutiva

El sistema resuelve tres necesidades de negocio en una sola plataforma:

- Planificar capacidad de maquinas y partes por molde con reglas de dias habiles.
- Registrar horas reales de ejecucion con control por rol y validaciones de consistencia.
- Liquidar costos finales para gerencia, separando claramente estimacion comercial vs costo real de produccion.

La interfaz es una SPA por pestanas orientada a operacion diaria (planificador, calendario, tiempos, registros, indicadores, financiero, importacion y configuracion).

## 🧱 Stack Tecnologico

### Frontend

- JavaScript Puro (Vanilla JS)
- HTML5
- CSS3
- Arquitectura SPA basada en pestanas (sin framework front principal)

### Backend

- Node.js
- Express
- Middleware de seguridad y API: helmet, cors, jsonwebtoken, express-validator

### Base de datos

- PostgreSQL (modelo relacional)
- Esquema principal en `server/schema.sql`
- Soporte de snapshots para preservar estado de planificacion (`planner_grid_snapshots`)

## 🧠 Arquitectura y Logica de Negocio

### 1) Ciclos independientes (`planning_id`)

Concepto clave del dominio:

- Cada planificacion genera o reutiliza un ciclo identificado por `planning_id` (tabla `planning_history`).
- Cada ciclo funciona como un snapshot historico independiente; no se mezcla con otros ciclos del mismo molde.
- El detalle operativo de ese ciclo vive en `plan_entries` (horas planificadas por fecha, parte y maquina).
- El trabajo ejecutado en planta vive en `work_logs`, tambien vinculado al `planning_id`.

Beneficios:

- Trazabilidad completa por ciclo (inicio, fin, cliente, estado).
- Reprogramaciones controladas sin perder contexto historico.
- Cierre tecnico del ciclo por reglas de negocio (`IN_PROGRESS` -> `COMPLETED`) segun cierres finales y pares planificados.

Persistencia de snapshot de UI:

- `planner_grid_snapshots` almacena exactamente lo digitado en la parrilla para poder reabrirlo sin distorsion.
- Esto permite auditoria funcional y continuidad al editar/revisar moldes planificados.

### 2) Precio Estimado vs Costo Real

El sistema separa explicitamente dos dimensiones economicas:

- Precio Estimado (cotizacion): usa `machines.hourly_price` sobre horas planificadas en el Planificador.
- Costo Real (liquidacion): usa `machines.hourly_cost` sobre horas reales (`work_logs.hours_worked`) en modulo financiero.

Regla de negocio:

- Nunca se debe usar `hourly_price` para liquidacion real.
- Nunca se debe usar `hourly_cost` como base de presupuesto comercial.

### 3) Automatizaciones (n8n + Google Cloud)

Estado actual del repositorio:

- No existe, en este codigo, una integracion activa directa con n8n o Google Cloud.

Punto de integracion recomendado (si aplica en su despliegue):

- n8n como orquestador para disparos por eventos (cierres de ciclo, alertas de desvio, reportes periodicos).
- Google Cloud para hosting de workflows, almacenamiento de reportes y/o integracion con servicios corporativos.

## 🧩 Funcionalidades por Modulo

### 📋 Planificador

- Planificacion por molde, parte y maquina con fecha de inicio.
- Modos operativos: bloque normal, prioridad global, reemplazo de plan y consecutivo.
- Visualizacion de moldes ya planificados.
- Vista previa en modo solo lectura para moldes cargados desde historial de planificacion.
- Reglas de no mezcla, capacidad por maquina y dias habiles.
- Calculo de Precio Estimado total en la parrilla usando `hourly_price`.

### ⏱️ Registro de Tiempos

- Registro de horas reales por operario, parte y maquina.
- Validacion estricta de celda planificada por combinacion:
  `planning_id + moldId + partId + machineId`.
- Requiere `planning_id` valido para garantizar integridad del ciclo.
- Soporta cierre manual por tarea (`is_final_log`) con control de unicidad.
- Permite logica de adelanto de trabajo dentro del ciclo activo (sin romper consistencia del ciclo), siempre que la celda pertenezca al plan del `planning_id`.
- Recalculo de estado del ciclo tras crear/editar/eliminar registros reales.

Restriccion operario:

- El rol Operario solo puede editar registros propios y hasta 2 dias hacia atras (`OPERATOR_EDIT_DAYS_LIMIT = 2`).

### 💼 Gerencia / Financiero

- Consulta de ciclos completados (`COMPLETED`) para liquidacion.
- Desglose de costo real por maquina (`hours_worked * hourly_cost`).
- Consolidado de mano de obra + adicionales (materiales y servicios).
- Historial de moldes costeados desde la UI.
- Gestion de tarifas de maquina (`hourly_cost` y `hourly_price`) con control por rol.

## 🔐 Sistema de Roles y Permisos

Roles del sistema:

- `management` (Gerencia)
- `planner` (Jefe)
- `operator` (Operario)
- `admin` (Administracion tecnica)

### Politica funcional de negocio

- Gerencia (Management): auditor total, acceso a financiero e informes, y perfil rector para decisiones de cierre economico/historico.
- Jefe (Planner): gestion de la parrilla de produccion y carga/reprogramacion de moldes.
- Operario (Operator): registro de trabajo diario con restriccion de edicion de 2 dias.

### Implementacion tecnica actual (abril 2026)

- Gerencia tiene acceso exclusivo al modulo `management` y puede actualizar tarifas financieras de maquinas (`hourly_cost/hourly_price`).
- Planner/Admin operan endpoints de planificacion y mantenimiento operativo.
- Operario queda restringido a sus propios registros y ventana temporal de edicion.

## ⚙️ Instalacion y Configuracion

### Requisitos

- Node.js 18+
- PostgreSQL 14+

### 1) Instalar dependencias

```bash
cd server
npm install
```

### 2) Configurar variables de entorno

Crear `server/.env` (puede partir de `server/.env.example`):

```env
PORT=3000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=tu_password
DB_NAME=organizador_taller

JWT_SECRET=define_un_secreto_largo_y_seguro
JWT_EXPIRES_IN=8h
```

Nota:

- El proyecto usa PostgreSQL. Si ve `3306` en algun ejemplo historico, ajustelo a `5432` para Postgres local.

### 3) Ejecutar en desarrollo

```bash
cd server
npm run dev
```

Aplicacion:

- UI + API: `http://localhost:3000`
- Health check: `http://localhost:3000/health`

### 4) Bootstrap inicial de usuarios (Admin, Jefe, Gerencia)

El sistema incluye bootstrap de seguridad para inicializar credenciales una sola vez.

Flujo:

1. Consultar estado:

```bash
curl -X GET http://localhost:3000/api/auth/bootstrap/status
```

2. Crear cuentas faltantes:

```bash
curl -X POST http://localhost:3000/api/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{
    "adminPassword": "Admin#2026",
    "jefePassword": "Jefe#2026",
    "gerenciaPassword": "Gerencia#2026"
  }'
```

Resultado esperado:

- Se crean usuarios base (`admin`, `jefe`, `gerente`) segun lo faltante.
- Cuando ya existen los tres perfiles, `canBootstrap` pasa a `false` y el bootstrap se bloquea.

## 🐳 Ejecucion con Docker (Opcional)

```bash
docker compose up --build
```

Servicios por defecto:

- Backend: `http://localhost:3000`
- PostgreSQL host: `localhost:5433` (mapeado al `5432` del contenedor)

## 🗂️ Estructura del Proyecto

```text
Organizador_Taller/
├─ public/
│  ├─ index.html
│  ├─ app.js
│  ├─ styles.css
│  └─ assets/
├─ server/
│  ├─ src/
│  │  ├─ app.js
│  │  ├─ config/
│  │  ├─ controllers/
│  │  ├─ middleware/
│  │  ├─ models/
│  │  ├─ routes/
│  │  ├─ services/
│  │  └─ utils/
│  ├─ schema.sql
│  ├─ package.json
│  ├─ e2e/
│  └─ tests/
├─ tests/
│  ├─ integration/
│  ├─ unit/
│  └─ helpers/
├─ Dockerfile
├─ docker-compose.yml
└─ README.md
```

## 🧪 Pruebas y Calidad

Desde `server/`:

```bash
npm test
```

E2E:

```bash
npm run test:e2e
```

Formato:

```bash
npm run format
npm run check-format
```

## 📡 Endpoints Clave

- Auth: `/api/auth/*`
- Planificacion: `/api/tasks/plan/*`
- Registro de tiempos: `/api/work_logs/*`
- Calendario: `/api/calendar/*`
- Configuracion: `/api/config/*`
- Financiero gerencial: `/api/management/*`

## 📌 Notas de Operacion

- La separacion `planning_id` + snapshots evita mezclar ciclos y preserva trazabilidad historica.
- La distincion `hourly_price` vs `hourly_cost` es central para evitar errores financieros.
- La UI persiste ciertos estados de trabajo en navegador (por ejemplo historial de moldes costeados), mientras el nucleo operativo vive en PostgreSQL.

## 👤 Autor

- Alejandro (@alejo00710)
- GitHub: https://github.com/alejo00710

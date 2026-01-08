# Sistema de Planificación y Registro de Producción de Moldes

Aplicación web (frontend estático + API) para planificar horas de fabricación por máquina/parte, registrar tiempos reales por operario y ver calendario/reportes/indicadores.

## Arquitectura

- Frontend: HTML/CSS/JS (Vanilla) en `public/`.
- Backend: Node.js + Express en `server/`.
- Base de datos: PostgreSQL (schema en `server/schema.sql`).

El backend sirve el frontend como estáticos y expone la API bajo `/api`.

## Requisitos

- Node.js 18+
- PostgreSQL 14+

## Estructura del repo

```
public/         Frontend (index.html, app.js, styles.css)
server/         Backend (Express + PostgreSQL)
  src/
  schema.sql
  package.json
tests/
README.md
```

## Configuración (server/.env)

El backend lee variables con `dotenv` (ver `server/src/config/env.js`). Ejemplo recomendado:

```env
PORT=3000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=tu_password
DB_NAME=production_scheduler

JWT_SECRET=cambia_este_secreto
JWT_EXPIRES_IN=8h
```

Notas:

- Si no defines variables, hay defaults (por ejemplo `DB_NAME=production_scheduler`).
- En `NODE_ENV=development` el servidor intenta:
  - Crear la base de datos si no existe.
  - Ejecutar `server/schema.sql` (tablas `IF NOT EXISTS`) y algunas migraciones pequeñas.

## Instalación y arranque

Desde la carpeta del backend:

```bash
cd server
npm install
npm run dev
```

Abrir la app:

- UI: `http://localhost:3000`
- Healthcheck: `http://localhost:3000/health`

## Autenticación y roles

La API usa JWT (header `Authorization: Bearer <token>`).

Roles:

- `admin`
- `planner` (en la UI aparece como “Jefe (Planner)”)
- `operator`

### Bootstrap inicial (crear admin/jefe)

Cuando la BD está vacía, el login muestra un bloque de “Configuración inicial”. Eso llama a:

- `GET /api/auth/bootstrap/status`
- `POST /api/auth/bootstrap` (sin token)

Ese bootstrap solo permite crear `admin` y `jefe` si todavía no existen.

### Login

- `POST /api/auth/login`
- `GET /api/auth/operators?username=...` (para llenar el selector de operarios)

La UI ofrece 3 opciones en el selector:

- `admin`
- `jefe` (role `planner`)
- `operarios`: requiere seleccionar un operario y valida contraseña asociada al operario.

## Funcionalidades principales (según el código)

- Planificación por bloque y planificación con prioridad (reubica lo existente).
- Calendario mensual unificado: eventos + festivos.
- Festivos (tabla `holidays`) + reglas de negocio (servicio de días hábiles).
- Registro de tiempos reales (work logs) con `work_date` y `reason`.
- Reportes plan vs real.
- Indicadores: resumen y carga/edición de días hábiles mensuales por operario.
- Auditoría de sesiones (login/logout) en `user_sessions`.

## API (mapa de endpoints)

Base URL: `http://localhost:3000/api`

### Auth

- `POST /auth/login`
- `GET /auth/operators`
- `GET /auth/bootstrap/status`
- `POST /auth/bootstrap`
- `GET /auth/verify` (requiere token)
- `POST /auth/logout` (requiere token)
- `GET /auth/sessions` (admin/planner)

### Planificación (admin/planner)

- `POST /tasks/plan/block`
- `POST /tasks/plan/priority`
- `GET /tasks/plan/mold/:moldId`
- `PATCH /tasks/plan/entry/:entryId`
- `PATCH /tasks/plan/entry/:entryId/next-available`

### Calendario

- `GET /calendar/month-view` (requiere token)

### Work logs

- `POST /work_logs` (requiere token)
- `GET /work_logs` (requiere token)
- `PUT /work_logs/:id` (requiere token)
- `DELETE /work_logs/:id` (admin/planner)

### Moldes / Partes

- `GET /molds` (requiere token)
- `POST /molds` (admin/planner)
- `GET /molds/parts` (requiere token)
- `POST /molds/parts` (admin/planner)
- `GET /molds/in-progress` (admin/planner)
- `GET /molds/:moldId/progress` (admin/planner)

### Recetas de molde

- `GET /molds/:moldId/recipe` (requiere token)
- `POST /molds/:moldId/recipe` (requiere token)

### Máquinas

- `GET /machines` (requiere token)
- `GET /machines/:id` (requiere token)
- `POST /machines` (solo admin)
- `PUT /machines/:id` (solo admin)
- `DELETE /machines/:id` (solo admin)

### Festivos (holidays)

- `GET /holidays` (requiere token)
- `POST /holidays` (solo admin)
- `DELETE /holidays/:date` (solo admin)

### Días laborables (override)

- `GET /working/check` (requiere token)
- `POST /working/override` (admin/planner)

### Datos (histórico)

- `GET /datos` (requiere token)
- `POST /datos` (admin/planner/operator)
- `PUT /datos/:id` (admin/planner)
- `DELETE /datos/:id` (solo admin)
- `GET /datos/meta` (requiere token)

### Importación

- `POST /import/datos` (multipart/form-data, campo `file`, requiere token)
- `GET /import/datos/:batchId/errors` (requiere token)

### Catálogos

- `GET /catalogs/meta` (requiere token)
- `POST /catalogs/sync` (requiere token)

### Configuración (admin/planner)

Todas estas rutas cuelgan de `/api` (no de `/api/config`):

- `GET /config/machines`
- `POST /config/machines`
- `PUT /config/machines/:id`
- `POST /config/molds`
- `POST /config/parts`
- `GET /config/parts`
- `PUT /config/parts/:id`
- `POST /config/operators`
- `GET /config/operators`
- `PUT /config/operators/:id`

### Indicadores (admin/planner)

- `GET /indicators/summary`
- `POST /indicators/working-days`

## Scripts (backend)

En `server/package.json`:

- `npm run dev` (nodemon)
- `npm start` (node)
- `npm test` (jest)
- `npm run reset:password` (utilidad para reset)
- `npm run format` / `npm run check-format`

---

## 👤 Usuarios de ejemplo

- admin / admin (rol: admin)
- Otros usuarios u operarios dependen del seed en `schema.sql` (el backend soporta login para `jefe` y `operarios` si existen en DB)

---

## 🧪 Endpoints (resumen)

Autenticación
- POST /api/auth/login
- GET  /api/auth/operators
- GET  /api/auth/verify

Planificación
- POST /api/tasks/plan/block
- POST /api/tasks/plan/priority
- GET  /api/tasks/plan/mold/:moldId
- PATCH /api/tasks/plan/entry/:entryId
- PATCH /api/tasks/plan/entry/:entryId/next-available

Work logs
- POST   /api/work_logs
- GET    /api/work_logs
- PUT    /api/work_logs/:id
- DELETE /api/work_logs/:id

Calendario
- GET /api/calendar/month-view?year=YYYY&month=1..12

Reportes
- GET /api/reports/planned-vs-actual
- GET /api/reports/detailed-deviations

Datos maestros
- GET/POST/PUT/DELETE /api/machines
- GET/POST /api/molds
- GET/POST /api/molds/parts
 - GET      /api/molds/in-progress          (admin/planner)
 - GET      /api/molds/:moldId/progress     (admin/planner)

Festivos
- GET    /api/holidays
- POST   /api/holidays      (admin)
- DELETE /api/holidays/:date (admin)

Indicadores
- GET  /api/indicators/summary?year=YYYY
- POST /api/indicators/working-days

Catálogos
- GET /api/catalogs/meta

Salud
- GET /health

---

## 🖥️ Uso rápido (planner)

1) Login como `jefe` (si existe) o `admin`
2) Configuración: valida que haya máquinas, moldes y partes
3) Cuadro Planificador:
   - Selecciona Molde y Fecha de Inicio
   - Ajusta “Cantidad de Moldes/Partes”
   - Ingresa horas base por máquina (horas para producir UNA parte)
   - “Crear Planificación” → el sistema distribuye horas en días hábiles
4) Calendario:
   - Verás indicadores de horas por día
   - Festivos y fines de semana resaltados (no se planifica)
5) Indicadores:
  - Abre la pestaña **📊 Indicadores**
  - Selecciona el **Año**
  - Marca los **Operarios a mostrar**
    - La selección queda guardada; al volver a entrar se re-marca automáticamente
  - Las **3 tablas** se cargan/actualizan en base a esa selección
  - Tabla 2 (manual):
    - Escoge Operario (de los seleccionados), Mes y Días
    - “Guardar” → refresca automáticamente las tablas con el cambio

---

## ⚙️ Detalles técnicos clave

Días hábiles
- Fines de semana: siempre excluidos
- Festivos:
  - Automáticos (Colombia) generados por `holidaysColombia.service.js`
  - Festivos en DB se combinan y tienen prioridad en nombre
  - Caché recargada al iniciar y tras POST/DELETE /holidays

Scheduler
- Capacidad diaria por máquina:
  - 1 operario: 9h
  - >1 operario: operarios × 8h
- Salta fines de semana y festivos con `isBusinessDay` / `getNextBusinessDay`
- Respeta capacidad ya ocupada (suma de `plan_entries` por día)

Calendario
- Backend entrega:
  - events: { [día-del-mes]: { tasks:[], machineUsage:{} } }
  - holidays: { 'YYYY-MM-DD': 'Nombre' }

---

## 🐛 Problemas conocidos / siguientes pasos

- Frontend: el registro de trabajo (worklog) está parcialmente simulado en `public/app.js` (backend listo).
- Parrilla: actualmente lista todas las partes; endpoint ideal: GET /molds/:id/parts.
- Mejoras UX: toasts/spinners uniformes, tooltips en calendario, botón “Hoy”.
- Índices recomendados en DB (si no existen): 
  - plan_entries(date, machine_id), 
  - work_logs(recorded_at, machine_id), 
  - holidays(date UNIQUE)

---

## 🧭 Roadmap sugerido

1) Filtros y tooltips en Calendario + botón “Hoy”
2) Worklog completo en frontend (crear/editar)
3) Endpoint /molds/:id/parts y filtrado real en parrilla
4) Reporte de utilización por máquina (semanal/mensual)
5) Export/Import CSV del grid

---

## 👨‍💻 Autor

- Alejandro (@alejo00710) — GitHub: https://github.com/alejo00710
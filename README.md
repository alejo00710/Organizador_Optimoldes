# Sistema de Planificación y Registro de Producción de Moldes

Aplicación web para planificar producción por molde, parte y máquina; registrar horas reales; visualizar calendario operativo; y consultar avance, desviaciones e indicadores.

## Resumen rápido

- Frontend: HTML/CSS/JS Vanilla en `public/`
- Backend: Node.js + Express en `server/src/`
- Base de datos: PostgreSQL (schema en `server/schema.sql`)
- API base: `/api`
- Healthcheck: `/health`

## Estado actual (marzo 2026)

- El sistema trabaja por ciclos de planificación (`planning_history`, `planning_id`).
- Reglas de creación de nueva planificación para el mismo molde:
  - si el ciclo activo está incompleto, bloquea creación nueva;
  - si el ciclo activo está completo, permite crear un nuevo ciclo.
- Se soportan datos legacy con `planning_id` nulo en `plan_entries` y `work_logs` usando reglas por fecha de inicio del ciclo.
- La vista de calendario es implementación propia (no usa librería visual externa tipo FullCalendar).

## Estructura del repositorio

```text
public/                  Frontend estático
  index.html
  app.js
  styles.css

server/
  src/
    app.js               Boot de Express y registro de rutas
    controllers/
    routes/
    services/
    middleware/
    config/
  schema.sql
  package.json

tests/                   Pruebas integración (Jest)
README.md
Dockerfile
docker-compose.yml
```

## Requisitos

- Node.js 18+
- PostgreSQL 14+

## Configuración (`server/.env`)

Ejemplo recomendado:

```env
PORT=3000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=tu_password
DB_NAME=organizador_taller

JWT_SECRET=cambia_este_secreto
JWT_EXPIRES_IN=8h
```

Notas:

- El backend carga variables desde `server/.env`.
- En `NODE_ENV=development`, al iniciar intenta verificar/crear esquema y aplicar migraciones seguras.

## Instalación y arranque local

```bash
cd server
npm install
npm run dev
```

Abrir en navegador:

- UI: `http://localhost:3000`
- Health: `http://localhost:3000/health`

## Arranque con Docker

```bash
docker compose up --build
```

Por defecto levanta:

- `backend` en `http://localhost:3000`
- `postgres` en `localhost:5433`

## Autenticación y roles

JWT por header `Authorization: Bearer <token>`.

Roles:

- `admin`
- `planner` (UI: Jefe)
- `operator` (UI: Operario)

Bootstrap inicial (sin token):

- `GET /api/auth/bootstrap/status`
- `POST /api/auth/bootstrap`

## Funcionalidades principales

- Cuadro planificador (normal, prioridad, reemplazo, consecutivo).
- Calendario mensual con carga/capacidad por máquina y superposición.
- Registro de trabajo real (`work_logs`) con cierre manual por parte/máquina (`is_final_log`).
- Vistas de moldes en curso y moldes terminados por ciclo.
- Historial de movimientos/reprogramaciones.
- Indicadores anuales y carga de días laborables por operario.

## Mapa de API (actual)

Base URL: `http://localhost:3000/api`

### Auth

- `POST /auth/login`
- `GET /auth/operators`
- `GET /auth/bootstrap/status`
- `POST /auth/bootstrap`
- `GET /auth/verify` (token)
- `POST /auth/logout` (token)
- `GET /auth/sessions` (admin/planner)

### Planificación (`/tasks`) (admin/planner)

- `POST /tasks/plan/block`
- `GET /tasks/plan/molds`
- `GET /tasks/plan/snapshot`
- `POST /tasks/plan/replace`
- `POST /tasks/plan/consecutive`
- `POST /tasks/plan/priority`
- `GET /tasks/plan/mold/:moldId`
- `DELETE /tasks/plan/mold/:moldId`
- `PATCH /tasks/plan/entry/:entryId`
- `PATCH /tasks/plan/entry/:entryId/next-available`
- `POST /tasks/plan/mold/:moldId/move-parts`
- `POST /tasks/plan/entries/bulk-move`

### Calendario

- `GET /calendar/month-view` (token)

### Work Logs

- `POST /work_logs` (token)
- `GET /work_logs` (token)
- `PUT /work_logs/:id` (token)
- `DELETE /work_logs/:id` (admin/planner)

### Moldes / Partes

- `GET /molds` (token)
- `POST /molds` (admin/planner)
- `GET /molds/parts` (token)
- `POST /molds/parts` (admin/planner)
- `GET /molds/in-progress` (admin/planner)
- `GET /molds/completed` (admin/planner)
- `GET /molds/:moldId/progress` (admin/planner/operator)

### Recetas de molde

- `GET /molds/:moldId/recipe` (token)
- `POST /molds/:moldId/recipe` (token)

### Máquinas

- `GET /machines` (token)
- `GET /machines/:id` (token)
- `POST /machines` (admin)
- `PUT /machines/:id` (admin)
- `DELETE /machines/:id` (admin)

### Festivos

- `GET /holidays` (token)
- `POST /holidays` (admin)
- `DELETE /holidays/:date` (admin)

### Días laborables (override)

- `GET /working/check` (token)
- `POST /working/override` (admin/planner)

### Datos (histórico)

- `GET /datos` (token)
- `POST /datos` (admin/planner/operator)
- `PUT /datos/:id` (admin/planner)
- `DELETE /datos/:id` (admin)
- `GET /datos/hours-options` (token)
- `GET /datos/meta` (token)

### Importación

- `POST /import/datos` (multipart/form-data, campo `file`, token)
- `GET /import/datos/:batchId/errors` (token)

### Catálogos

- `GET /catalogs/meta` (token)
- `POST /catalogs/sync` (token)

### Configuración (`/api/config/*`) (admin/planner)

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

### Indicadores

- `GET /indicators/summary` (admin/planner)
- `POST /indicators/working-days` (admin/planner)

## Scripts útiles (`server/package.json`)

- `npm run dev` inicia backend en modo desarrollo (nodemon)
- `npm start` inicia backend en modo normal
- `npm test` ejecuta Jest (con cobertura)
- `npm run test:e2e` ejecuta Playwright
- `npm run format` / `npm run check-format` aplica/verifica Prettier
- `npm run reset:password` utilidad de reseteo de contraseña

## Pruebas

Ejemplos:

```bash
cd server
npm test
```

Ejecutar una prueba de integración puntual:

```bash
npm test -- --runInBand ../tests/integration/planner-no-duplicate-mold.test.js
```

## Notas técnicas

- `planning_id` se usa como identificador principal de ciclo.
- Para compatibilidad histórica, el sistema contempla registros legacy sin `planning_id` apoyándose en fecha de inicio del ciclo.
- La sección "Moldes planificados" del cuadro planificador consume `GET /api/tasks/plan/molds` y muestra ciclos activos/incompletos.
- El calendario del frontend está hecho en `public/app.js` (sin librería visual de terceros).
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
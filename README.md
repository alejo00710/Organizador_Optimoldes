# Sistema de Planificación y Registro de Producción de Moldes

Aplicación web para planificar producción por molde/parte/máquina, registrar horas reales de ejecución, visualizar calendario operativo y consultar avance, desvíos e indicadores.

Este README describe el estado actual del proyecto (abril 2026) según el código activo.

## 1) Qué hace el sistema

- Planifica carga por ciclo de molde usando una parrilla por partes y máquinas.
- Mantiene historial de ciclos (`planning_history`) y detalle diario (`plan_entries`).
- Registra trabajo real (`work_logs`) con control por rol y validaciones de negocio.
- Muestra calendario mensual con ocupación por máquina, festivos y capacidad.
- Calcula avance planeado vs real por molde y parte.
- Incluye módulo financiero para liquidación de costos reales de ciclos terminados (rol Gerencia).
- Permite exportar liquidaciones (PDF/CSV).
- Incluye importación de datos y módulo de indicadores anuales.

## 2) Stack tecnológico

### Frontend

- HTML + CSS + JavaScript Vanilla.
- SPA servida como estáticos desde `public/`.
- Sin framework UI externo para calendario (implementación propia en frontend).

### Backend

- Node.js + Express 5.
- Seguridad y middleware: `helmet`, `cors`, `jsonwebtoken`.
- Validación y utilidades: `express-validator`, `date-fns`.
- Carga de archivos para importación: `multer`.

### Base de datos

- PostgreSQL (`pg`).
- Esquema principal en `server/schema.sql`.
- Inicialización/migraciones seguras en `server/src/config/setupDatabase.js`.

### Testing

- Unit/integration: Jest + Supertest.
- E2E: Playwright.

### Tooling

- Formato: Prettier.
- Desarrollo: Nodemon.
- Contenedores: Docker + Docker Compose.

## 3) Arquitectura y estructura

```text
public/                  Frontend estático (SPA)
  index.html
  app.js
  styles.css

server/
  src/
    app.js               Boot de Express + registro de rutas
    controllers/         Lógica de negocio por módulo
    routes/              Endpoints y permisos
    services/            Servicios de dominio (días hábiles, etc.)
    middleware/          Auth, autorización, manejo de errores
    config/              DB, env, setup
  schema.sql
  package.json

tests/                   Pruebas de integración (Jest)
README.md
Dockerfile
docker-compose.yml
```

## 4) Conceptos de dominio y lógica principal

### 4.1 Ciclo de planificación

- La unidad principal es el ciclo (`planning_id`) almacenado en `planning_history`.
- Cada ciclo representa una planificación completa de un molde en un rango de fechas.
- El detalle de distribución diaria/por máquina vive en `plan_entries`.
- El trabajo real asociado al ciclo vive en `work_logs`.

Regla clave:

- Para un mismo molde, no se crea un ciclo nuevo si existe uno activo incompleto.
- Si el ciclo activo está completo, sí puede crearse uno nuevo.

Compatibilidad legacy:

- El sistema contempla datos históricos con `planning_id` nulo en algunos registros legacy usando reglas por fecha cuando aplica.

### 4.2 Planificador

Soporta varios modos:

- Planificación normal en bloque.
- Planificación con prioridad (reacomodo global).
- Reemplazo de planificación de un molde desde fecha base.
- Planificación consecutiva.
- Movimientos masivos de filas/partes.

Además:

- Guarda y consulta snapshot de parrilla para reabrir exactamente lo digitado.
- Puede abrir moldes planificados en vista previa desde la UI.
- Usa precio por hora (`hourly_price`) para el cálculo de "Precio Estimado" en la parrilla.

### 4.3 Work logs (registro real)

Validaciones de negocio importantes:

- `planning_id` obligatorio y válido.
- La combinación `planning_id + moldId + partId + machineId` debe corresponder a una celda planificada válida.
- `hours_worked` debe ser mayor que 0.
- `work_date`, si se envía, debe ser formato `YYYY-MM-DD`.
- Se permite marcar cierre manual por tarea (`is_final_log`) con restricción de unicidad (solo un cierre final por parte/máquina/ciclo).

Restricciones por rol operario:

- Solo puede crear/editar registros propios (`operatorId` del token).
- No puede editar registros de otros operarios.
- No puede cambiar el `operatorId` del registro.
- Ventana de edición limitada a 2 días hacia atrás (`OPERATOR_EDIT_DAYS_LIMIT = 2`), calculada estrictamente sobre `work_date` en zona horaria Colombia.

Al crear/editar/eliminar work logs:

- Se recalcula coherencia/estado del ciclo (`reconcilePlanningStatus`).

### 4.4 Calendario y días hábiles

- Vista mensual de ocupación por máquina y eventos planificados.
- Considera festivos y overrides de días laborables.
- La lógica de negocio de días hábiles se centraliza en servicios del backend.

### 4.5 Avance de moldes

- Moldes en curso y terminados consultan avance plan vs real.
- Avance por molde (`/molds/:moldId/progress`) alimenta UI de calendario/planificador.

### 4.6 Módulo financiero (liquidación de moldes)

Rol objetivo: `management` (Gerencia).

Flujo:

- Consulta ciclos terminados (`COMPLETED`) con cliente y rango de fechas.
- Obtiene desglose de costo real por máquina sumando `hours_worked * hourly_cost`.
- Muestra costo total de mano de obra y permite agregar costos adicionales (materiales/servicios).
- Exporta liquidación a PDF o CSV.
- Permite guardar liquidaciones desde UI y mantener historial de "moldes costeados" (persistencia local en navegador).

Notas:

- El cálculo de costo real usa `hourly_cost`.
- El cálculo de "Precio Estimado" del planificador usa `hourly_price`.

### 4.7 Indicadores

- Resumen anual de indicadores para Admin/Jefe.
- Carga/actualización manual de días hábiles por operario y mes.

### 4.8 Importación

- Importación de datos vía archivo (`multipart/form-data`) con seguimiento de errores por lote.

## 5) Roles y permisos

Roles definidos en el sistema:

- `admin`
- `planner` (UI: Jefe)
- `operator` (UI: Operario)
- `management` (UI: Gerencia)

Resumen funcional:

- `admin`: control total de configuración y operación.
- `planner`: planificación, operación y mantenimiento funcional (similar a admin en muchas rutas operativas).
- `operator`: foco en ejecución real (work logs propios) y consultas operativas habilitadas.
- `management`: foco financiero y consulta/edición de tarifas financieras en endpoints permitidos.

## 6) API actual (base `/api`)

### 6.1 Auth

- `POST /auth/login`
- `GET /auth/operators`
- `GET /auth/bootstrap/status`
- `POST /auth/bootstrap`
- `GET /auth/verify` (token)
- `POST /auth/logout` (token)
- `GET /auth/sessions` (admin/planner)

### 6.2 Planificación (`/tasks`)

Escritura (admin/planner):

- `POST /tasks/plan/block`
- `POST /tasks/plan/replace`
- `POST /tasks/plan/consecutive`
- `POST /tasks/plan/priority`
- `DELETE /tasks/plan/mold/:moldId`
- `PATCH /tasks/plan/entry/:entryId`
- `PATCH /tasks/plan/entry/:entryId/next-available`
- `POST /tasks/plan/mold/:moldId/move-parts`
- `POST /tasks/plan/entries/bulk-move`

Lectura (admin/planner/operator):

- `GET /tasks/plan/molds`
- `GET /tasks/plan/snapshot`
- `GET /tasks/plan/mold/:moldId`

### 6.3 Work logs

- `POST /work_logs` (token)
- `GET /work_logs` (token)
- `PUT /work_logs/:id` (token)
- `DELETE /work_logs/:id` (admin/planner)

### 6.4 Calendario

- `GET /calendar/month-view` (token)
- `GET /calendar/month-view-legacy` (token)

### 6.5 Reportes

- `GET /reports/planned-vs-actual` (admin/planner)
- `GET /reports/detailed-deviations` (admin/planner)

### 6.6 Máquinas

- `GET /machines` (token)
- `GET /machines/:id` (token)
- `POST /machines` (admin)
- `PUT /machines/:id` (admin)
- `DELETE /machines/:id` (admin)

### 6.7 Moldes / Partes

- `GET /molds` (token)
- `POST /molds` (admin/planner)
- `GET /molds/parts` (token)
- `POST /molds/parts` (admin/planner)
- `GET /molds/in-progress` (admin/planner/operator)
- `GET /molds/completed` (admin/planner/operator)
- `GET /molds/:moldId/progress` (admin/planner/operator)

### 6.8 Recetas de molde

- `GET /molds/:moldId/recipe` (token)
- `POST /molds/:moldId/recipe` (token)

### 6.9 Festivos y días laborables

- `GET /holidays` (token)
- `POST /holidays` (admin)
- `DELETE /holidays/:date` (admin)
- `GET /working/check` (token)
- `POST /working/override` (admin/planner)

### 6.10 Datos

- `GET /datos` (token)
- `POST /datos` (admin/planner/operator)
- `PUT /datos/:id` (admin/planner)
- `DELETE /datos/:id` (admin)
- `GET /datos/hours-options` (token)
- `GET /datos/meta` (token)

### 6.11 Importación

- `POST /import/datos` (multipart/form-data, campo `file`, token)
- `GET /import/datos/:batchId/errors` (token)

### 6.12 Catálogos

- `GET /catalogs/meta` (token)
- `POST /catalogs/sync` (token)

### 6.13 Configuración (`/api/config/*`)

- `GET /config/machines` (admin/planner/management)
- `POST /config/machines` (admin/planner)
- `PUT /config/machines/:id` (admin/planner/management)
- `POST /config/molds` (admin/planner)
- `POST /config/parts` (admin/planner)
- `GET /config/parts` (admin/planner)
- `PUT /config/parts/:id` (admin/planner)
- `POST /config/operators` (admin/planner)
- `GET /config/operators` (admin/planner)
- `PUT /config/operators/:id` (admin/planner)

### 6.14 Indicadores

- `GET /indicators/summary` (admin/planner)
- `POST /indicators/working-days` (admin/planner)

### 6.15 Financiero (Gerencia)

- `GET /management/completed-cycles` (management)
- `GET /management/mold-cost-breakdown/:planning_id` (management)

## 7) Requisitos

- Node.js 18+
- PostgreSQL 14+

## 8) Configuración de entorno (`server/.env`)

Ejemplo:

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
- En desarrollo, al iniciar verifica/crea esquema y aplica migraciones seguras.

## 9) Ejecución local

```bash
cd server
npm install
npm run dev
```

Abrir:

- UI: `http://localhost:3000`
- Health: `http://localhost:3000/health`

## 10) Ejecución con Docker

```bash
docker compose up --build
```

Por defecto:

- Backend: `http://localhost:3000`
- Postgres: `localhost:5433`

## 11) Scripts útiles (`server/package.json`)

- `npm run dev` inicia backend con nodemon.
- `npm start` inicia backend en modo normal.
- `npm test` ejecuta Jest con cobertura.
- `npm run test:e2e` ejecuta Playwright.
- `npm run test:e2e:headed` ejecuta E2E en modo visible.
- `npm run test:e2e:ui` runner UI de Playwright.
- `npm run format` aplica Prettier.
- `npm run check-format` verifica formato.
- `npm run reset:password` utilidad de reseteo de contraseña.

## 12) Pruebas

Suite completa:

```bash
cd server
npm test
```

Prueba puntual de integración:

```bash
npm test -- --runInBand tests/integration/planner-smoke.test.js
```

## 13) Estado actual y notas operativas

- La aplicación está orientada al trabajo por ciclos de planificación (`planning_id`).
- La UI de calendario es implementación propia (sin librería visual externa).
- Existen controles por rol en backend y también en frontend para visibilidad/acciones.
- El historial financiero de "moldes costeados" en UI se persiste localmente en el navegador (no en tabla dedicada aún).

## 14) Roadmap sugerido (próximos incrementos)

1. Persistencia backend del historial de liquidaciones (actualmente local en frontend).
2. Reportes financieros consolidados por rango y cliente.
3. Endpoint dedicado para partes por molde (`/molds/:id/parts`) para filtrar parrilla con más precisión.
4. Mejoras UX en calendario (tooltips avanzados, botón "Hoy", filtros más finos).
5. Export/import adicional de configuraciones del grid.

## 15) Autor

- Alejandro (@alejo00710)
- GitHub: https://github.com/alejo00710

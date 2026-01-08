# 📋 Sistema de Planificación y Registro de Producción de Moldes (Checkpoint)

Estado a la fecha: 2026-01-07

Este proyecto es una aplicación web para planificar y registrar trabajo de producción de moldes. Incluye:
- Autenticación por roles con JWT
- Planificador inteligente que distribuye horas automáticamente en días hábiles
- Calendario mensual interactivo con festivos y fines de semana
- Gestión de datos maestros (máquinas, moldes, partes)
- Reportes de planificado vs real
- Indicadores (KPIs): 3 tablas (Horas, Días hábiles manuales, Indicador) + exportación CSV
- Indicadores: selección de operarios persistente (checkboxes) y carga automática de tablas
- Avance Plan vs Real por molde (panel de progreso)
  - Vista "Moldes en curso" debajo del Calendario (no filtrado por mes)
  - Rango del plan visible: inicio → fin

Este README refleja exactamente el estado actual del código.

---

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────┐
│              FRONTEND (Cliente)                  │
│  HTML + CSS + JavaScript (Vanilla)              │
│  Servido como estáticos desde Express           │
└─────────────────┬───────────────────────────────┘
                  │ HTTP/REST API
                  │
┌─────────────────▼───────────────────────────────┐
│              BACKEND (Servidor)                  │
│  Node.js + Express                               │
│  Puerto: 3000                                    │
└─────────────────┬───────────────────────────────┘
                  │ PostgreSQL
                  │
┌─────────────────▼───────────────────────────────┐
│                BASE DE DATOS                    │
│  PostgreSQL 14+                                 │
└─────────────────────────────────────────────────┘
```

---

## 🛠️ Tecnologías

- Backend: Node.js (Express), pg (PostgreSQL), JWT, Helmet, CORS, dotenv
- Frontend: HTML5, CSS3, JavaScript ES6+
- DB: PostgreSQL 14+
- Dev: nodemon

---

## 📂 Estructura

```
Organizador_Optimoldes/
├── public/                      # Frontend
│   ├── index.html
│   ├── app.js
│   └── styles.css
│
├── server/                      # Backend (API)
│   ├── src/
│   │   ├── config/              # env, conexión y setup de DB
│   │   ├── controllers/         # lógica HTTP
│   │   ├── middleware/          # auth, errores
│   │   ├── routes/              # endpoints
│   │   ├── services/            # negocio (scheduler, festivos)
│   │   ├── utils/               # constantes
│   │   └── app.js               # arranque del servidor
│   ├── package.json
│   └── schema.sql               # esquema de BD
└── README.md
```

---

## 🔑 Funcionalidades actuales

1) Autenticación y roles
- Login con usuarios por rol: admin, jefe (planner), operarios
- JWT con middleware `authenticateToken`
- Rutas con autorización por rol (`authorizeRoles`)

2) Planificador (Cuadro planificador)
- Grid por partes (filas) y máquinas (columnas)
- Campo “Cantidad de Moldes/Partes a Producir”
- Cálculo en tiempo real:
  - Total por fila = (suma horas por máquina) × cantidad
  - Resumen total superior (proyectado y base por máquina)
- Envío de planificación: genera múltiples POST /tasks/plan (una por celda con horas > 0)
 - Configuración de parrilla robusta:
   - Siempre muestra una selección principal por defecto (máquinas/partes fijas)
   - Si el catálogo no carga, mantiene la selección y hace fallback a los fijos
   - La selección guardada no se borra si el catálogo está vacío

3) Scheduler (Distribución automática)
- Distribuye `totalHours` en días hábiles por máquina a partir de `startDate`
- Capacidad por máquina:
  - 1 operario: 9h/día
  - >1 operario: operarios × 8h/día
- Respeta capacidad ya usada en cada día (suma de `plan_entries`)
- Días hábiles: excluye sábados, domingos y festivos

4) Festivos (automáticos + base de datos)
- Generación automática de festivos de Colombia (Ley Emiliani + fechas religiosas)
- Combinación con festivos registrados en DB (empresa)
- Caché en memoria: se recarga al iniciar el servidor y al crear/eliminar festivos
- Frontend muestra festivos en el calendario

5) Calendario mensual
- Vista de mes con:
  - Fines de semana resaltados
  - Festivos resaltados (nombre visible)
  - Indicador con total de horas planificadas por día
  - Modal con detalle de tareas por día
- Endpoint unificado: GET /api/calendar/month-view → { events, holidays }

 5.1) Moldes en curso (debajo del Calendario)
 - Lista compacta de paneles de progreso (uno por molde en curso)
 - Cada panel muestra: % completado, plan total, plan a hoy, real a hoy, desviación, y rango del plan (inicio → fin)
 - Fuente de datos: GET /api/molds/in-progress (una sola llamada para eficiencia)

6) Reportes (backend listo)
- Reporte planificado vs real (`/reports/planned-vs-actual`)
- Reporte detallado con combinaciones y alertas (`/reports/detailed-deviations`)
- Umbral de alerta configurable: 5%

7) Indicadores (KPIs)
- Tablas por año (enero..diciembre):
  - Tabla 1: **Suma de Horas** (fuente: `work_logs`)
  - Tabla 2: **Días Hábiles Trabajados** (manual por operario/mes)
  - Indicador (principal): **Horas / (Días × 8)**
- Filtro de operarios con **checkboxes** ("Operarios a mostrar")
  - La selección se **guarda en el navegador** (localStorage) y se rehidrata al volver a entrar
  - Si hay selección guardada, las **3 tablas se cargan automáticamente** al abrir la pestaña
- Exportación CSV del indicador principal


## ✅ Correcciones recientes (críticas)

- SQL corregido (espacios erróneos en alias/columnas) en:
  - services/calendar.service.js
  - services/deviation.service.js
  - controllers/workLogs.controller.js
- Caché de festivos se recarga en `createHoliday` y `deleteHoliday`
- Fechas en `calendar.controller` robustas (evita problemas de zona horaria)
- server/package.json: script `start` corregido (sin espacio en `app.js`)
- server/src/app.js: `startServer()` corregido (sintaxis y arranque)
- Configuración de parrilla: evita limpiar selección cuando catálogos no cargan; fallback a selección por defecto
- Paneles de progreso: agregados "Moldes en curso" (debajo del Calendario) y rango del plan visible
- Endpoint nuevo: `/api/molds/in-progress` (admin/planner)
- Endpoint de progreso por molde: `/api/molds/:moldId/progress` (admin/planner)

---

## 🚀 Instalación

Requisitos: Node.js 18+, PostgreSQL 14+

1) Clonar e instalar
```bash
git clone https://github.com/alejo00710/Organizador_Optimoldes.git
cd Organizador_Optimoldes/server
npm install
```

2) Variables de entorno (server/.env)
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

3) Base de datos
- En `NODE_ENV=development`, el servidor:
  - Crea la BD si no existe
  - Ejecuta `schema.sql`
  - Se asegura de crear usuario admin (admin/admin)

4) Iniciar
```bash
npm run dev
# Servirá la app en http://localhost:3000
```

5) Frontend
- Express sirve /public como estáticos
- Abre http://localhost:3000 en el navegador

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
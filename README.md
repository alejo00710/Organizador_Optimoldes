# 📋 Sistema de Planificación y Registro de Producción de Moldes

## 🎯 Descripción del Proyecto

Sistema web completo para gestionar la planificación y el registro de trabajo en la producción de moldes. Permite a los jefes de producción crear planificaciones automáticas que respetan la capacidad de las máquinas y los días hábiles, mientras que los operarios registran el trabajo real ejecutado.  El sistema compara automáticamente lo planificado vs lo real y marca desviaciones superiores al 5%.

---

## 🏗️ Arquitectura del Sistema

```
┌─────────────────────────────────────────────────┐
│              FRONTEND (Cliente)                  │
│  HTML + CSS + JavaScript Vanilla                │
│  Puerto: Archivo local o servidor web estático  │
└─────────────────┬───────────────────────────────┘
                  │ HTTP/REST API
                  │
┌─────────────────▼───────────────────────────────┐
│              BACKEND (Servidor)                  │
│  Node.js + Express. js                           │
│  Puerto: 3000                                   │
└─────────────────┬───────────────────────────────┘
                  │ SQL Queries
                  │
┌─────────────────▼───────────────────────────────┐
│           BASE DE DATOS                         │
│  MySQL 8.0+                                     │
│  Puerto: 3306                                   │
└─────────────────────────────────────────────────┘
```

---

## 🛠️ Tecnologías Utilizadas

### **Backend**
- **Node.js** v18+ - Entorno de ejecución JavaScript
- **Express.js** v4.18 - Framework web para APIs REST
- **MySQL2** v3.6 - Driver para conectar con MySQL
- **bcrypt** v5.1 - Encriptación de contraseñas
- **jsonwebtoken** v9.0 - Autenticación con JWT
- **date-fns** v2.30 - Manejo de fechas
- **dotenv** v16.3 - Variables de entorno
- **cors** v2.8 - Manejo de CORS
- **helmet** v7.1 - Seguridad HTTP

### **Frontend**
- **HTML5** - Estructura
- **CSS3** - Estilos (gradientes, flexbox, grid)
- **JavaScript ES6+** - Lógica del cliente (async/await, fetch API)

### **Base de Datos**
- **MySQL** v8.0+ - Base de datos relacional

### **Herramientas de Desarrollo**
- **nodemon** v3.0 - Auto-reload del servidor en desarrollo
- **jest** v29.7 - Testing (opcional)
- **VS Code** - Editor recomendado

---

## 📂 Estructura del Proyecto

```
Organizador_Optimoldes/
├── public/                      # Frontend (cliente web)
│   ├── index.html              # Página principal
│   ├── app.js                  # Lógica JavaScript del cliente
│   └── styles.css              # Estilos CSS
│
├── server/                      # Backend (API REST)
│   ├── src/
│   │   ├── config/             # Configuración
│   │   │   ├── database.js     # Conexión MySQL
│   │   │   └── env.js          # Variables de entorno
│   │   │
│   │   ├── middleware/         # Middlewares
│   │   │   ├── auth.js         # Autenticación JWT
│   │   │   └── errorHandler.js # Manejo de errores
│   │   │
│   │   ├── services/           # Lógica de negocio
│   │   │   ├── businessDays.service.js    # Días hábiles
│   │   │   ├── scheduler.service.js       # Algoritmo de planificación
│   │   │   ├── calendar.service.js        # Datos del calendario
│   │   │   └── deviation.service.js       # Cálculo de desviaciones
│   │   │
│   │   ├── controllers/        # Controladores de rutas
│   │   │   ├── auth.controller.js
│   │   │   ├── tasks.controller.js
│   │   │   ├── workLogs.controller.js
│   │   │   ├── calendar.controller.js
│   │   │   ├── reports.controller.js
│   │   │   ├── machines.controller.js
│   │   │   └── holidays.controller.js
│   │   │
│   │   ├── routes/             # Definición de rutas
│   │   │   ├── auth. routes.js
│   │   │   ├── tasks.routes.js
│   │   │   ├── workLogs. routes.js
│   │   │   ├── calendar.routes.js
│   │   │   ├── reports.routes. js
│   │   │   ├── machines.routes.js
│   │   │   └── holidays.routes.js
│   │   │
│   │   ├── utils/              # Utilidades
│   │   │   └── constants.js    # Constantes globales
│   │   │
│   │   └── app.js              # Punto de entrada del servidor
│   │
│   ├── tests/                  # Tests unitarios
│   ├── . env                    # Variables de entorno (NO SUBIR A GIT)
│   ├── .gitignore              # Archivos a ignorar en Git
│   ├── package.json            # Dependencias del proyecto
│   └── schema.sql              # Esquema de base de datos
│
└── README.md                   # Este archivo
```

---

## 🔑 Funcionalidades Principales

### 1. **Sistema de Autenticación**
- Login con credenciales compartidas por rol
- Operarios seleccionan su ID personal al entrar
- Tokens JWT para sesiones seguras
- Roles: Admin, Jefe (Planner), Operario

### 2.  **Planificación Automática** (Algoritmo Scheduler)
- El jefe ingresa: molde, parte, máquina, fecha inicio y total de horas
- El sistema automáticamente:
  - Identifica días hábiles (lunes a viernes, excluyendo festivos)
  - Calcula capacidad diaria por máquina:
    - 1 operario = 9 horas/día
    - >1 operario = operarios × 8 horas/día
  - Distribuye las horas respetando la capacidad disponible
  - Genera entradas en `plan_entries` por cada día

### 3. **Registro de Trabajo Real**
- Operarios registran horas trabajadas por tarea
- Campos: molde, parte, máquina, operario, horas, nota
- Restricciones:
  - Operarios solo pueden editar sus propios registros
  - Solo pueden editar hasta 2 días atrás
  - Jefe/admin pueden editar todo

### 4. **Calendario Visual**
- Muestra planificación (azul) y trabajo real (verde)
- Compatible con FullCalendar (futura implementación)
- Filtros por rango de fechas

### 5. **Reportes y Alertas**
- Compara horas planificadas vs reales
- Marca desviaciones > 5% en rojo
- Reportes agregados por molde/parte/máquina
- Exportación a Excel (futura implementación)

---

## 🚀 Instalación y Configuración

### **Requisitos Previos**

- **Node.js** v18 o superior → [Descargar](https://nodejs.org/)
- **MySQL** v8. 0 o superior → [Descargar](https://dev.mysql.com/downloads/)
- **Git** (opcional) → [Descargar](https://git-scm. com/)

### **Paso 1: Clonar o Descargar el Proyecto**

```bash
# Si tienes Git
git clone https://github.com/alejo00710/Organizador_Optimoldes.git
cd Organizador_Optimoldes

# O descarga el ZIP y descomprime
```

### **Paso 2: Configurar la Base de Datos**

1. Abre MySQL Workbench o tu cliente MySQL favorito
2. Crea la base de datos:

```sql
CREATE DATABASE production_scheduler 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;
```

3. Ejecuta el archivo `server/schema.sql` completo
4. Verifica que se crearon las tablas:

```sql
USE production_scheduler;
SHOW TABLES;
```

Deberías ver:
- users
- operators
- machines
- molds
- mold_parts
- plan_entries
- work_logs
- holidays

### **Paso 3: Configurar el Backend**

1. Navega a la carpeta del servidor:

```bash
cd server
```

2. Instala las dependencias:

```bash
npm install
```

3. Configura las variables de entorno:

Edita el archivo `.env` con tus credenciales:

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_password_de_mysql
DB_NAME=production_scheduler

# JWT
JWT_SECRET=cambia_este_secreto_por_uno_largo_y_aleatorio
JWT_EXPIRES_IN=8h

# Server
PORT=3000
NODE_ENV=development
```

4. (Opcional) Si tienes problemas con las contraseñas, ejecuta:

```bash
node fix-users. js
```

Esto regenerará los hashes de contraseña para que coincidan con `password123`.

### **Paso 4: Iniciar el Backend**

```bash
# Modo desarrollo (con auto-reload)
npm run dev

# O modo producción
npm start
```

Deberías ver:

```
🚀 Servidor de Producción de Moldes iniciado
📡 Puerto: 3000
🌍 Entorno: development
✅ Servidor listo para recibir peticiones
```

### **Paso 5: Abrir el Frontend**

Tienes 3 opciones:

**Opción A: Abrir directamente en el navegador**
```bash
# Simplemente haz doble clic en:
public/index.html
```

**Opción B: Usar Live Server de VS Code**
1. Instala la extensión "Live Server"
2. Click derecho en `public/index.html`
3.  Selecciona "Open with Live Server"

**Opción C: Usar un servidor HTTP simple**
```bash
cd public
npx http-server -p 8080
# Luego abre: http://localhost:8080
```

---

## 👤 Usuarios por Defecto

La base de datos viene con usuarios de ejemplo:

| Usuario    | Contraseña   | Rol       | Descripción                        |
|------------|--------------|-----------|-------------------------------------|
| `admin`    | `password123`| Admin     | Control total del sistema          |
| `jefe`     | `password123`| Planner   | Crea planificaciones y ve reportes |
| `operarios`| `password123`| Operator  | Registra trabajo real              |

**Operarios disponibles:**
- Juan Pérez (ID: 1)
- María García (ID: 2)
- Carlos López (ID: 3)
- Ana Martínez (ID: 4)

---

## 📖 Guía de Uso

### **Como Jefe de Producción**

1. **Login:**
   - Usuario: `jefe`
   - Contraseña: `password123`

2. **Crear una Planificación:**
   - Ve a la pestaña "📅 Planificar"
   - Completa:
     - ID Molde: 1 (M-100)
     - ID Parte: 1 (P1)
     - ID Máquina: 1 (Corte A)
     - Fecha Inicio: mañana
     - Total Horas: 30
   - Click "Crear Planificación"
   - El sistema distribuirá las 30 horas automáticamente

3. **Ver Calendario:**
   - Ve a "📊 Calendario"
   - Selecciona rango de fechas
   - Click "Cargar Calendario"
   - Verás en azul la planificación

4. **Ver Reportes:**
   - Ve a "📈 Reportes"
   - Selecciona fechas
   - Click "Generar Reporte"
   - Verás desviaciones marcadas si superan el 5%

### **Como Operario**

1.  **Login:**
   - Usuario: `operarios`
   - Contraseña: `password123`
   - Selecciona tu operario: Juan Pérez

2. **Registrar Trabajo:**
   - Ve a "⏱️ Registrar Trabajo"
   - Completa:
     - ID Molde: 1
     - ID Parte: 1
     - ID Máquina: 1
     - ID Operario: 1 (auto-completado)
     - Horas Trabajadas: 2. 5
     - Nota: "Trabajo completado sin problemas"
   - Click "Registrar Trabajo"

3. **Restricciones:**
   - Solo puedes ver tus propios registros
   - Solo puedes editar registros de máximo 2 días atrás

---

## 🔧 API REST - Endpoints

### **Autenticación**

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "jefe",
  "password": "password123",
  "operatorId": 1  // Solo para rol 'operarios'
}

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.. .",
  "user": {
    "id": 2,
    "username": "jefe",
    "role": "planner",
    "operatorId": null
  }
}
```

### **Planificación**

```http
POST /api/tasks/plan
Authorization: Bearer {token}
Content-Type: application/json

{
  "moldId": 1,
  "partId": 1,
  "machineId": 1,
  "startDate": "2025-11-28",
  "totalHours": 30
}

Response:
{
  "message": "Planificación creada exitosamente",
  "data": {
    "totalEntries": 4,
    "totalHoursScheduled": 30,
    "startDate": "2025-11-28",
    "endDate": "2025-12-03",
    "entries": [...]
  }
}
```

### **Registro de Trabajo**

```http
POST /api/work_logs
Authorization: Bearer {token}
Content-Type: application/json

{
  "moldId": 1,
  "partId": 1,
  "machineId": 1,
  "operatorId": 1,
  "hours_worked": 2.5,
  "note": "Completado sin problemas"
}
```

### **Calendario**

```http
GET /api/calendar? from=2025-11-01&to=2025-12-31
Authorization: Bearer {token}

Response:
{
  "events": [... ],
  "summary": [...]
}
```

### **Reportes**

```http
GET /api/reports/planned-vs-actual? from=2025-11-01&to=2025-12-31&moldId=1
Authorization: Bearer {token}

Response:
{
  "filters": {... },
  "result": {
    "planned": 30,
    "actual": 28,
    "deviation": -2,
    "deviationPercent": 6.67,
    "hasAlert": true
  }
}
```

---

## 🧮 Algoritmo de Planificación (Scheduler)

### **Lógica del Algoritmo**

```javascript
ENTRADA: moldId, partId, machineId, startDate, totalHours

1. Validar que la parte pertenece al molde
2.  Obtener configuración de la máquina (operarios_count)
3. Calcular capacidad diaria:
   - Si operarios_count == 1 → capacidad = 9 horas
   - Si operarios_count > 1  → capacidad = operarios_count × 8 horas

4. remaining = totalHours
5. currentDate = startDate

6.  MIENTRAS remaining > 0:
   a. Avanzar a próximo día hábil (Lun-Vie, no festivo)
   b. usedCapacity = SUM(hours_planned) de esa máquina en ese día
   c. availableCapacity = capacidad - usedCapacity
   
   d. SI availableCapacity > 0:
      - assign = MIN(availableCapacity, remaining)
      - Crear plan_entry(date, hours_planned = assign)
      - remaining = remaining - assign
   
   e.  Avanzar al siguiente día

7. RETORNAR lista de plan_entries creados
```

### **Ejemplo Práctico**

```
Entrada:
- Máquina: "Corte A" (1 operario → 9h/día)
- Total: 30 horas
- Inicio: Lunes 2025-11-25

Proceso:
Día 1 (Lun 25): 9h disponibles → asigna 9h → quedan 21h
Día 2 (Mar 26): 9h disponibles → asigna 9h → quedan 12h
Día 3 (Mié 27): 9h disponibles → asigna 9h → quedan 3h
Día 4 (Jue 28): 9h disponibles → asigna 3h → quedan 0h

Resultado: 4 entradas de planificación, 30 horas totales
```

---

## 📊 Modelo de Datos

### **Diagrama de Relaciones**

```
users (1) ----< (N) operators
                      |
                      |
                      v
machines              work_logs ---< plan_entries
   ^                    |              |
   |                    |              |
   +--------------------+--------------+
                        |
                        v
                   mold_parts ----< molds
```

### **Tablas Principales**

**users**: Credenciales compartidas por rol
**operators**: Identidades individuales de operarios
**machines**: Máquinas con su cantidad de operarios
**molds**: Catálogo de moldes
**mold_parts**: Partes que componen cada molde
**plan_entries**: Registros de planificación automática
**work_logs**: Registros de trabajo real
**holidays**: Festivos de Colombia

---

## 🔒 Seguridad

- ✅ Contraseñas encriptadas con bcrypt (salt rounds: 10)
- ✅ Autenticación JWT con expiración de 8 horas
- ✅ Headers de seguridad con Helmet. js
- ✅ CORS configurado
- ✅ SQL injection prevención con prepared statements
- ✅ Validación de permisos por rol
- ✅ Variables sensibles en `. env` (no en Git)

---

## 🐛 Solución de Problemas Comunes

### **Error: Cannot connect to MySQL**
```bash
# Verifica que MySQL esté corriendo
# Windows:
services.msc → buscar MySQL → Iniciar

# Verifica credenciales en . env
DB_USER=root
DB_PASSWORD=tu_password_correcto
```

### **Error 401 Unauthorized en login**
```bash
# Regenera los hashes de contraseña
cd server
node fix-users.js
```

### **Frontend no se conecta al backend**
```bash
# Verifica que el backend esté corriendo en puerto 3000
# Abre: http://localhost:3000/health
# Debe responder: {"status":"ok", ... }
```

### **Error: Module not found**
```bash
cd server
npm install
```

---

## 🚧 Roadmap / Mejoras Futuras

- [ ] Integración con FullCalendar para vista más profesional
- [ ] Export a Excel de reportes
- [ ] Notificaciones por email/WhatsApp para alertas
- [ ] Dashboard con gráficos (Chart.js)
- [ ] Gestión de usuarios desde interfaz
- [ ] Modo oscuro
- [ ] App móvil (React Native)
- [ ] Internacionalización (i18n)
- [ ] Tests automatizados (Jest + Supertest)
- [ ] Dockerización del proyecto

---

## 🤝 Contribuir

Si quieres contribuir al proyecto:

1. Fork el repositorio
2. Crea una rama: `git checkout -b feature/nueva-funcionalidad`
3.  Commit cambios: `git commit -am 'Añade nueva funcionalidad'`
4. Push: `git push origin feature/nueva-funcionalidad`
5.  Crea un Pull Request

---

## 📝 Licencia

Este proyecto es de uso educativo y privado para Optimoldes. 

---

## 👨‍💻 Autor

**Alejandro** (@alejo00710)
- GitHub: [alejo00710](https://github.com/alejo00710)

---

## 📞 Soporte

Si tienes dudas o problemas:

1.  Revisa la sección "Solución de Problemas"
2. Verifica los logs del backend (en la terminal donde corre `npm run dev`)
3.  Abre la consola del navegador (F12) para ver errores del frontend
4. Abre un issue en GitHub con capturas de pantalla

---

## 🎓 Aprendizajes del Proyecto

Este proyecto es excelente para aprender:

- ✅ Arquitectura REST API
- ✅ Autenticación con JWT
- ✅ Manejo de fechas y días hábiles
- ✅ Algoritmos de planificación
- ✅ MySQL y relaciones entre tablas
- ✅ Node.js y Express. js
- ✅ JavaScript moderno (ES6+)
- ✅ Manejo de permisos por roles
- ✅ Frontend-Backend integration


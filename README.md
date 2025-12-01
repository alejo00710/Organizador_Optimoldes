# 📋 Sistema de Planificación y Registro de Producción de Moldes (v2.0)

## 🎯 Descripción del Proyecto

Sistema web completo para gestionar la planificación y el registro de trabajo en la producción de moldes. La aplicación permite a los jefes de producción crear planificaciones de trabajo de forma inteligente y visual. El sistema distribuye automáticamente las horas de trabajo a lo largo de los días, respetando la capacidad de cada máquina y **excluyendo fines de semana y festivos**, que son gestionados desde la base de datos.

La interfaz incluye un **calendario interactivo** que ofrece una vista mensual clara de la carga de trabajo, con indicadores visuales y detalles por día, así como un **cuadro planificador** para la entrada masiva de tareas con cálculos automáticos.

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
│  Node.js + Express.js                           │
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
- **dotenv** v16.3 - Variables de entorno
- **cors** v2.8 - Manejo de CORS
- **helmet** v7.1 - Seguridad HTTP

### **Frontend**
- **HTML5** - Estructura semántica
- **CSS3** - Estilos modernos (Flexbox, Grid Layout)
- **JavaScript ES6+** - Lógica del cliente (async/await, Fetch API, manipulación del DOM)

### **Base de Datos**
- **MySQL** v8.0+ - Base de datos relacional

### **Herramientas de Desarrollo**
- **nodemon** v3.0+ - Auto-reload del servidor en desarrollo
- **VS Code** - Editor de código recomendado

---

## 📂 Estructura del Proyecto

```
Organizador_Optimoldes/
├── public/                      # Frontend (archivos que ve el usuario)
│   ├── index.html              # Estructura principal de la página
│   ├── app.js                  # Lógica JavaScript del cliente (el cerebro del frontend)
│   └── styles.css              # Estilos visuales
│
├── server/                      # Backend (la API que procesa todo)
│   ├── src/
│   │   ├── config/             # Configuración de base de datos y entorno
│   │   ├── middleware/         # Autenticación, manejo de errores, etc.
│   │   ├── services/           # Lógica de negocio crítica (planificación, días hábiles)
│   │   ├── controllers/        # Manejan las peticiones HTTP y llaman a los servicios
│   │   ├── routes/             # Definen las URLs de la API (endpoints)
│   │   ├── utils/              # Constantes y utilidades
│   │   └── app.js              # Punto de entrada y configuración del servidor
│   │
│   ├── .env                    # Variables de entorno (credenciales, secretos)
│   ├── package.json            # Dependencias y scripts del proyecto
│   └── schema.sql              # Definición de las tablas de la base de datos
│
└── README.md                   # Este archivo
```

---

## 🔑 Funcionalidades Implementadas

### 1. **Autenticación por Roles**
- Login con credenciales compartidas (`admin`, `jefe`, `operarios`).
- **Selector de Operario:** Al usar el login de `operarios`, se debe seleccionar una identidad personal.
- Sesiones seguras gestionadas con Tokens JWT.

### 2. **Cuadro Planificador Inteligente**
- Interfaz de parrilla (grid) para planificar múltiples partes y máquinas a la vez.
- **Cálculos en Tiempo Real:**
  - "Total Horas Proyectado" por fila: `Cantidad de Partes * Suma de horas de cada máquina`.
  - "Total Horas Máquina" por columna: Suma total de horas asignadas a cada máquina.
- Permite crear una planificación completa con un solo clic.

### 3. **Planificación Automática y Precisa**
- El backend recibe las horas y las distribuye automáticamente.
- **Lógica de Días Hábiles:** El sistema salta automáticamente **sábados, domingos y festivos** (cargados desde la base de datos) al planificar.
- Respeta la capacidad diaria de cada máquina según su número de operarios.

### 4. **Calendario Visual e Interactivo**
- **Vista de Mes en Rejilla:** Muestra el mes actual con un layout claro.
- **Navegación Intuitiva:** Botones para avanzar y retroceder entre meses.
- **Indicadores Visuales:**
  - Los días con tareas muestran un indicador con el total de horas planificadas.
  - Los **fines de semana** y **festivos** tienen un fondo de color distintivo.
- **Ventana Modal con Detalles:** Al hacer clic en un día, se abre una ventana que muestra:
  - Si es festivo y su nombre.
  - El detalle de cada tarea: Molde, Parte y Máquina.
  - El uso total de cada máquina para ese día, con un porcentaje de ocupación.

### 5. **Gestión de Datos Maestros**
- Formularios simples en la pestaña "Configuración" para añadir nuevas máquinas, moldes y partes al sistema.

### 6. **Registro de Trabajo Real**
- Formulario para que los operarios registren las horas efectivamente trabajadas en una tarea.

---

## 🚀 Instalación y Configuración

### **Requisitos Previos**
- **Node.js** v18 o superior ([Descargar](https://nodejs.org/))
- **MySQL** v8.0 o superior ([Descargar](https://dev.mysql.com/downloads/))

### **Paso 1: Clonar o Descargar el Proyecto**
```bash
git clone https://github.com/alejo00710/Organizador_Optimoldes.git
cd Organizador_Optimoldes
```

### **Paso 2: Configurar la Base de Datos**
1.  Abre tu cliente de MySQL (Workbench, DBeaver, etc.).
2.  Crea la base de datos:
    ```sql
    CREATE DATABASE organizador_taller;
    ```
3.  Ejecuta el contenido completo del archivo `server/schema.sql` para crear todas las tablas.
4.  **(Opcional pero recomendado)** Añade algunos festivos a la tabla `holidays` para probar la funcionalidad:
    ```sql
    INSERT INTO holidays (date, name) VALUES ('2025-01-01', 'Año Nuevo');
    INSERT INTO holidays (date, name) VALUES ('2025-05-01', 'Día del Trabajo');
    ```

### **Paso 3: Configurar el Backend**
1.  Navega a la carpeta del servidor: `cd server`
2.  Instala las dependencias: `npm install`
3.  Crea una copia del archivo `.env.example` y renómbralo a `.env`.
4.  Edita el archivo `.env` con tus credenciales de MySQL:
    ```env
    DB_HOST=localhost
    DB_PORT=3306
    DB_USER=tu_usuario_mysql
    DB_PASSWORD=tu_contraseña_mysql
    DB_NAME=organizador_taller
    JWT_SECRET=este_es_un_secreto_muy_largo_y_dificil_de_adivinar
    ```

### **Paso 4: Iniciar el Backend**
```bash
# Desde la carpeta /server
npm run dev
```
El servidor se iniciará en `http://localhost:3000`. La terminal mostrará un mensaje de éxito y cargará los festivos en memoria.

### **Paso 5: Abrir el Frontend**
La forma más sencilla es abrir el archivo `public/index.html` directamente en tu navegador. No requiere un servidor web adicional.

---

## 👤 Usuarios por Defecto

La base de datos viene con usuarios de ejemplo creados por el script `schema.sql`.

| Usuario | Contraseña | Rol | Descripción |
|---|---|---|---|
| `admin` | `admin` | Admin | Control total. |
| `jefe` | `admin` | Planner | Crea planificaciones y ve reportes. |
| `operarios` | `admin` | Operator | Registra trabajo real. |

**Operarios de ejemplo:** Juan Pérez (ID 1), María García (ID 2), etc.

---

## 📖 Guía de Uso Rápido

1.  **Inicia Sesión** con usuario `jefe` y contraseña `admin`.
2.  **Ve a "Configuración"** y asegúrate de que existen al menos una máquina, un molde y una parte.
3.  **Ve a "Cuadro Planificador"**:
    *   Selecciona un molde y una fecha de inicio.
    *   Introduce una **Cantidad de Partes** (ej: 10) en la primera fila.
    *   Introduce las **horas** que toma cada máquina para **una sola parte** (ej: 2 horas en "TOR-01", 1.5 horas en "FRE-02").
    *   Observa cómo el "Total Horas Proyectado" se calcula automáticamente: `10 * (2 + 1.5) = 35 horas`.
    *   Haz clic en **"Crear Planificación"**.
4.  **Ve a "Calendario"**:
    *   Navega al mes correspondiente.
    *   Verás los días laborables ocupados con las horas planificadas. Los fines de semana y festivos habrán sido omitidos.
    *   Haz clic en un día con un indicador de horas para ver los detalles.
---

## 🐛 Solución de Problemas

-   **Error de conexión a MySQL:** Verifica que el servicio de MySQL esté corriendo y que tus credenciales en el archivo `.env` son correctas.
-   **La aplicación no inicia / Cuadro blanco:** Asegúrate de que el backend está corriendo (`npm run dev` en la carpeta `/server`). Abre la consola del navegador (F12) y revisa si hay errores de red (rojos) al intentar conectar con `http://localhost:3000/api`.
-   **Los festivos no aparecen:** Confirma que has insertado los festivos en la tabla `holidays` de tu base de datos. El servidor los carga al iniciar.

---
## 👨‍💻 Autor

**Alejandro** (@alejo00710)
- GitHub: [alejo00710](https://github.com/alejo00710)
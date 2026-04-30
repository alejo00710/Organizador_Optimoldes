const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { port } = require('./config/env');
const errorHandler = require('./middleware/errorHandler');
const { initializeDatabase } = require('./config/setupDatabase');
const { loadHolidays } = require('./services/businessDays.service');

// Importar rutas
const authRoutes = require('./routes/auth.routes');
const tasksRoutes = require('./routes/tasks.routes');
const workLogsRoutes = require('./routes/workLogs.routes');
const calendarRoutes = require('./routes/calendar.routes');
const reportsRoutes = require('./routes/reports.routes');
const machinesRoutes = require('./routes/machines.routes');
const holidaysRoutes = require('./routes/holidays.routes');
const moldsRoutes = require('./routes/molds.routes');
const workingRoutes = require('./routes/working.routes');
const datosRoutes = require('./routes/datos.routes');
const importRoutes = require('./routes/import.routes');
const moldRoutes = require('./routes/mold.routes');
const catalogRoutes = require('./routes/catalog.routes');
const indicatorsRoutes = require('./routes/indicators.routes');
const managementRoutes = require('./routes/management.routes');

const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: true,
        credentials: true
    }
});

// Adjuntar io a la app para inyección en controladores
app.set('io', io);

// Middleware - CONFIGURAR HELMET CORRECTAMENTE
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
                imgSrc: ["'self'", 'data:', 'https:'],
                // Permitir llamadas desde el origen del front (Live Server)
                connectSrc: [
                    "'self'",
                    'http://127.0.0.1:5500',
                    'http://localhost:5173', // Vite default port
                    'https://*.ngrok-free.app',
                    'https://cdn.jsdelivr.net'
                ],
                fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
                objectSrc: ["'none'"],
                mediaSrc: ["'self'"],
                frameSrc: ["'none'"],
            },
        },
        crossOriginEmbedderPolicy: false,
    })
);

app.use(cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {

    // Ignorar health check y favicon
    if (req.originalUrl === '/health' || req.originalUrl === '/favicon.ico') {
        return next();
    }

    console.log("=".repeat(60));
    console.log("📥 REQUEST");
    console.log("🕒", new Date().toISOString());
    console.log("📌", req.method, req.originalUrl);
    console.log("📦 Body:", req.body);
    console.log("🔎 Query:", req.query);

    const originalJson = res.json.bind(res);

    res.json = (data) => {
        console.log("📤 RESPONSE:");
        console.log(data);
        console.log("=".repeat(60));
        return originalJson(data);
    };

    next();
});

// Servir archivos estáticos ANTES de las rutas API
const publicDir = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(publicDir));



// Rutas API
app.use('/api/auth', authRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/work_logs', workLogsRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/machines', machinesRoutes);
app.use('/api/holidays', holidaysRoutes);
app.use('/api/molds', moldsRoutes);
app.use('/api/working', workingRoutes);
app.use('/api/datos', datosRoutes);
app.use('/api/import', importRoutes);
app.use('/api/molds', moldRoutes);
app.use('/api/catalogs', catalogRoutes);
app.use('/api/indicators', indicatorsRoutes);
app.use('/api/management', managementRoutes);

const configRoutes = require('./routes/config.routes');
app.use('/api', configRoutes);

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
});

// Ruta 404 - No encontrada
app.use((req, res) => {
    res.status(404).json({
        error: 'Ruta no encontrada',
        path: req.path,
        method: req.method,
    });
});

// Middleware de manejo de errores (debe ir al final)
app.use(errorHandler);

async function startServer() {
    await initializeDatabase();
    await loadHolidays();

    const httpServer = server.listen(port, () => {
        console.log('='.repeat(50));
        console.log('🚀 Servidor de Producción de Moldes iniciado');
        console.log('='.repeat(50));
        console.log(`📡 Puerto: ${port}`);
        console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🕐 Hora: ${new Date().toLocaleString('es-CO')}`);
        console.log(`🌐 Interfaz web: http://localhost:${port}`);
        console.log('='.repeat(50));
        console.log('\n📋 Endpoints disponibles:');
        console.log('  POST   /api/auth/login');
        console.log('  GET    /api/auth/operators');
        console.log('  POST   /api/tasks/plan/block');
        console.log('  POST   /api/tasks/plan/priority');
        console.log('  GET    /api/tasks/plan/molds');
        console.log('  GET    /api/tasks/plan/snapshot');
        console.log('  GET    /api/tasks/plan/mold/:moldId');
        console.log('  DELETE /api/tasks/plan/mold/:moldId');
        console.log('  PATCH  /api/tasks/plan/entry/:entryId');
        console.log('  PATCH  /api/tasks/plan/entry/:entryId/next-available');
        console.log('  POST   /api/work_logs');
        console.log('  GET    /api/work_logs');
        console.log('  PUT    /api/work_logs/:id');
        console.log('  DELETE /api/work_logs/:id');
        console.log('  GET    /api/calendar/month-view');
        console.log('  GET    /api/reports/planned-vs-actual');
        console.log('  GET    /api/reports/detailed-deviations');
        console.log('  GET    /api/machines');
        console.log('  GET    /api/molds/in-progress');
        console.log('  GET    /api/molds/:moldId/progress');
        console.log('  GET    /api/holidays');
        console.log('  GET    /api/datos/meta');
        console.log('  GET    /health');
        console.log('  GET    /api/indicators/summary');
        console.log('  GET    /api/management/completed-cycles');
        console.log('  GET    /api/management/mold-cost-breakdown/:planning_id');
        console.log('\n✅ Servidor listo para recibir peticiones\n');
    });

    // Manejo de cierre graceful
    process.on('SIGTERM', () => {
        console.log('\n⚠️  SIGTERM recibido.  Cerrando servidor...');
        httpServer.close(() => {
            console.log('✅ Servidor cerrado correctamente');
            process.exit(0);
        });
    });

    process.on('SIGINT', () => {
        console.log('\n⚠️  SIGINT recibido (Ctrl+C). Cerrando servidor...');
        httpServer.close(() => {
            console.log('✅ Servidor cerrado correctamente');
            process.exit(0);
        });
    });
}
if (require.main === module) {
    startServer();

    // Manejo de errores no capturados
    process.on('uncaughtException', (error) => {
        console.error('❌ Error no capturado:', error);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ Promesa rechazada no manejada:', reason);
        process.exit(1);
    });
}

module.exports = app;
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { port } = require('./config/env');
const errorHandler = require('./middleware/errorHandler');

// Importar rutas
const authRoutes = require('./routes/auth.routes');
const tasksRoutes = require('./routes/tasks.routes');
const workLogsRoutes = require('./routes/workLogs.routes');
const calendarRoutes = require('./routes/calendar.routes');
const reportsRoutes = require('./routes/reports.routes');
const machinesRoutes = require('./routes/machines.routes');
const holidaysRoutes = require('./routes/holidays.routes');

const app = express();

// Middleware - CONFIGURAR HELMET CORRECTAMENTE
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:', 'https:'],
                connectSrc: ["'self'"],
                fontSrc: ["'self'"],
                objectSrc: ["'none'"],
                mediaSrc: ["'self'"],
                frameSrc: ["'none'"],
            },
        },
        crossOriginEmbedderPolicy: false,
    })
);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos ANTES de las rutas API
app.use(express.static('public'));

// Logging middleware (opcional pero útil)
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Rutas API
app.use('/api/auth', authRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/work_logs', workLogsRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/machines', machinesRoutes);
app.use('/api/holidays', holidaysRoutes);

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

// Iniciar servidor
const server = app.listen(port, () => {
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
    console.log('  POST   /api/tasks/plan');
    console.log('  POST   /api/work_logs');
    console.log('  GET    /api/work_logs');
    console.log('  PUT    /api/work_logs/:id');
    console.log('  DELETE /api/work_logs/:id');
    console.log('  GET    /api/calendar');
    console.log('  GET    /api/reports/planned-vs-actual');
    console.log('  GET    /api/reports/detailed-deviations');
    console.log('  GET    /api/machines');
    console.log('  GET    /api/holidays');
    console.log('  GET    /health');
    console.log('\n✅ Servidor listo para recibir peticiones\n');
});

// Manejo de cierre graceful
process.on('SIGTERM', () => {
    console.log('\n⚠️  SIGTERM recibido.  Cerrando servidor...');
    server.close(() => {
        console.log('✅ Servidor cerrado correctamente');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('\n⚠️  SIGINT recibido (Ctrl+C). Cerrando servidor...');
    server.close(() => {
        console.log('✅ Servidor cerrado correctamente');
        process.exit(0);
    });
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
    console.error('❌ Error no capturado:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
    process.exit(1);
});

module.exports = app;

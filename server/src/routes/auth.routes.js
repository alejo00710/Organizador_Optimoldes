const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth'); // <-- Importa el middleware
const { ROLES } = require('../utils/constants');

router.post('/login', authController.login);
router.get('/operators', authController.getOperators);

// Bootstrap inicial (sin token): solo permite crear admin/jefe si no existen
router.get('/bootstrap/status', authController.bootstrapStatus);
router.post('/bootstrap', authController.bootstrapInit);

// Esta ruta está protegida. Solo peticiones con un token válido llegarán al controlador.
router.get('/verify', authenticateToken, authController.verify);

// Logout y auditoría
router.post('/logout', authenticateToken, authController.logout);
router.get('/sessions', authenticateToken, authorizeRoles(ROLES.ADMIN, ROLES.PLANNER), authController.listSessions);

module.exports = router;
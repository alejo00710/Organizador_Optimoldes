const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticateToken } = require('../middleware/auth'); // <-- Importa el middleware

router.post('/login', authController.login);
router.get('/operators', authController.getOperators);

// Esta ruta está protegida. Solo peticiones con un token válido llegarán al controlador.
router.get('/verify', authenticateToken, authController.verify);

module.exports = router;
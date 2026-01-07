const express = require('express');
const router = express.Router();
const moldsController = require('../controllers/molds.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { ROLES } = require('../utils/constants');

// Rutas para Moldes
router.get('/', authenticateToken, moldsController.getMolds);
router.post('/', authenticateToken, authorizeRoles(ROLES.ADMIN, ROLES.PLANNER), moldsController.createMold);

// Moldes en curso (avance plan vs real)
router.get('/in-progress', authenticateToken, authorizeRoles(ROLES.ADMIN, ROLES.PLANNER), moldsController.getMoldsInProgress);

// Avance plan vs real por molde
router.get('/:moldId/progress', authenticateToken, authorizeRoles(ROLES.ADMIN, ROLES.PLANNER), moldsController.getMoldProgress);

// Rutas para Partes
router.get('/parts', authenticateToken, moldsController.getParts);
router.post('/parts', authenticateToken, authorizeRoles(ROLES.ADMIN, ROLES.PLANNER), moldsController.createPart);

module.exports = router;
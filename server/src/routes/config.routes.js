const express = require('express');
const router = express.Router();
const configCtrl = require('../controllers/config.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { ROLES } = require('../utils/constants');

// Admin o Planner
const adminOrPlanner = [authenticateToken, authorizeRoles(ROLES.ADMIN, ROLES.PLANNER)];
const adminPlannerOrManagement = [authenticateToken, authorizeRoles(ROLES.ADMIN, ROLES.PLANNER, ROLES.MANAGEMENT)];

// Máquinas (listar, crear, actualizar)
router.get('/config/machines', adminPlannerOrManagement, configCtrl.listMachines);
router.post('/config/machines', adminOrPlanner, configCtrl.createMachine);
router.put('/config/machines/:id', adminPlannerOrManagement, configCtrl.updateMachine);

// Moldes (crear)
router.post('/config/molds', adminOrPlanner, configCtrl.createMold);

// Partes (crear)
router.post('/config/parts', adminOrPlanner, configCtrl.createPart);

// Partes (listar + activar/desactivar)
router.get('/config/parts', adminOrPlanner, configCtrl.listParts);
router.put('/config/parts/:id', adminOrPlanner, configCtrl.updatePart);

// Operarios (crear con contraseña)
router.post('/config/operators', adminOrPlanner, configCtrl.createOperator);

// Operarios (listar/editar)
router.get('/config/operators', adminOrPlanner, configCtrl.listOperators);
router.put('/config/operators/:id', adminOrPlanner, configCtrl.updateOperator);

module.exports = router;
const express = require('express');
const router = express.Router();
const configCtrl = require('../controllers/config.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Admin o Planner
const adminOrPlanner = [authenticateToken, authorizeRoles('admin', 'planner')];

// Máquinas (listar, crear, actualizar)
router.get('/config/machines', adminOrPlanner, configCtrl.listMachines);
router.post('/config/machines', adminOrPlanner, configCtrl.createMachine);
router.put('/config/machines/:id', adminOrPlanner, configCtrl.updateMachine);

// Moldes (crear)
router.post('/config/molds', adminOrPlanner, configCtrl.createMold);

// Partes (crear)
router.post('/config/parts', adminOrPlanner, configCtrl.createPart);

// Partes (listar + activar/desactivar)
router.get('/config/parts', adminOrPlanner, configCtrl.listParts);
router.put('/config/parts/:id', adminOrPlanner, configCtrl.updatePart);

// Operarios (crear con contraseña)
router.post('/config/operators', adminOrPlanner, configCtrl.createOperator);

module.exports = router;
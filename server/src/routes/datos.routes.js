const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { ROLES } = require('../utils/constants');
const datosController = require('../controllers/datos.controller');

// Leer y filtrar
router.get('/', authenticateToken, datosController.listDatos);
// Crear (operarios/planner/admin)
router.post('/', authenticateToken, authorizeRoles(ROLES.ADMIN, ROLES.PLANNER, ROLES.OPERATOR), datosController.createDato);
// Actualizar (planner/admin, opcional operarios si lo deseas)
router.put('/:id', authenticateToken, authorizeRoles(ROLES.ADMIN, ROLES.PLANNER), datosController.updateDato);
// Eliminar (solo admin)
router.delete('/:id', authenticateToken, authorizeRoles(ROLES.ADMIN), datosController.deleteDato);
// Horas disponibles (distinct) desde datos
router.get('/hours-options', authenticateToken, datosController.getHoursOptions);
// Meta para autocompletar
router.get('/meta', authenticateToken, datosController.getMeta);

module.exports = router;
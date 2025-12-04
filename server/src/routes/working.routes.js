const express = require('express');
const router = express.Router();
const { setOverride, checkDate } = require('../controllers/working.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { ROLES } = require('../utils/constants');

// Consultar si una fecha es laborable
router.get('/check', authenticateToken, checkDate);

// Habilitar/deshabilitar día (admin y planner)
router.post('/override', authenticateToken, authorizeRoles(ROLES.ADMIN, ROLES.PLANNER), setOverride);

module.exports = router;
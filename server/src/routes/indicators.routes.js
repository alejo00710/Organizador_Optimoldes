const express = require('express');
const router = express.Router();
const indicators = require('../controllers/indicators.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { ROLES } = require('../utils/constants');

// Solo admin/planner
const adminOrPlanner = [authenticateToken, authorizeRoles(ROLES.ADMIN, ROLES.PLANNER)];

router.get('/summary', adminOrPlanner, indicators.summary);

// Tabla 2 (manual): registrar/actualizar días hábiles por operario/mes
router.post('/working-days', adminOrPlanner, indicators.upsertWorkingDays);

module.exports = router;
const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reports.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { ROLES } = require('../utils/constants');

router.get(
  '/planned-vs-actual',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES. PLANNER),
  reportsController.getPlannedVsActual
);

router.get(
  '/detailed-deviations',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.PLANNER),
  reportsController.getDetailedDeviations
);

module. exports = router;
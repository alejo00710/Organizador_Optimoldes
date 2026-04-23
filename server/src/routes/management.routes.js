const express = require('express');
const router = express.Router();

const managementController = require('../controllers/management.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { ROLES } = require('../utils/constants');

router.use(authenticateToken, authorizeRoles(ROLES.MANAGEMENT));

router.get('/completed-cycles', managementController.getCompletedCycles);
router.get('/mold-cost-breakdown/:planning_id', managementController.getMoldCostBreakdown);

module.exports = router;

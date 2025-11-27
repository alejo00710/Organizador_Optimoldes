const express = require('express');
const router = express.Router();
const tasksController = require('../controllers/tasks.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { ROLES } = require('../utils/constants');

router. post(
  '/plan',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.PLANNER),
  tasksController.createPlan
);

module.exports = router;
const express = require('express');
const router = express.Router();
const tasksController = require('../controllers/tasks.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { ROLES } = require('../utils/constants');

// Planificación NORMAL en bloque (no mezcla)
router.post(
  '/plan/block',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.PLANNER),
  tasksController.planBlock
);

// Planificación con PRIORIDAD en bloque (global, reubica bloques existentes)
router.post(
  '/plan/priority',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.PLANNER),
  tasksController.planPriority
);

// Editor desde calendario
router.get(
  '/plan/mold/:moldId',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.PLANNER),
  tasksController.getMoldPlan
);

router.patch(
  '/plan/entry/:entryId',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.PLANNER),
  tasksController.updatePlanEntry
);

router.patch(
  '/plan/entry/:entryId/next-available',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.PLANNER),
  tasksController.movePlanEntryToNextAvailable
);

module.exports = router;
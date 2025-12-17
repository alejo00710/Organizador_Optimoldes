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

// Planificación con PRIORIDAD en bloque (preempt, reubica bloques existentes)
router.post(
  '/plan/priority',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.PLANNER),
  tasksController.planPriority
);

// Si aún mantienes /plan (por tarea individual), puedes dejarlo, pero la recomendación es usar /plan/block y /plan/priority.
module.exports = router;
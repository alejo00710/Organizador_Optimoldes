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

// Listado de moldes planificados
router.get(
  '/plan/molds',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.PLANNER),
  tasksController.listPlannedMolds
);

// Snapshot de parrilla del planificador (para reabrir exactamente lo digitado)
router.get(
  '/plan/snapshot',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.PLANNER),
  tasksController.getPlannerSnapshot
);

// Reemplazar planificación de un molde (desde startDate)
router.post(
  '/plan/replace',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.PLANNER),
  tasksController.replaceMoldPlan
);

// Reprogramar un molde para que siga consecutivamente al molde anterior (por orden de creación)
router.post(
  '/plan/consecutive',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.PLANNER),
  tasksController.planConsecutive
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

// Eliminar planificación completa de un molde (cancelación)
router.delete(
  '/plan/mold/:moldId',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.PLANNER),
  tasksController.deleteMoldPlan
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

// Mover múltiples PARTES de un molde (solo pendientes) a una fecha o al siguiente disponible
router.post(
  '/plan/mold/:moldId/move-parts',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.PLANNER),
  tasksController.moveMoldParts
);

// Mover múltiples entradas (filas) del planificador del calendario
router.post(
  '/plan/entries/bulk-move',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.PLANNER),
  tasksController.bulkMovePlanEntries
);

module.exports = router;
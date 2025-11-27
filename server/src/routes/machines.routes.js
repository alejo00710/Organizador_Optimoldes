const express = require('express');
const router = express.Router();
const machinesController = require('../controllers/machines.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { ROLES } = require('../utils/constants');

router.get('/', authenticateToken, machinesController.getMachines);
router.get('/:id', authenticateToken, machinesController.getMachineById);
router.post(
  '/',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN),
  machinesController.createMachine
);
router.put(
  '/:id',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN),
  machinesController.updateMachine
);
router.delete(
  '/:id',
  authenticateToken,
  authorizeRoles(ROLES. ADMIN),
  machinesController. deleteMachine
);

module. exports = router;
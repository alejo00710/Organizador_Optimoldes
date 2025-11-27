const express = require('express');
const router = express.Router();
const workLogsController = require('../controllers/workLogs.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { ROLES } = require('../utils/constants');

router. post('/', authenticateToken, workLogsController.createWorkLog);
router.get('/', authenticateToken, workLogsController.getWorkLogs);
router.put('/:id', authenticateToken, workLogsController.updateWorkLog);
router.delete(
  '/:id',
  authenticateToken,
  authorizeRoles(ROLES.ADMIN, ROLES.PLANNER),
  workLogsController.deleteWorkLog
);

module.exports = router;
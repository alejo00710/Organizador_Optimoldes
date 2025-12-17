const express = require('express');
const router = express.Router();
const indicators = require('../controllers/indicators.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Solo admin/planner
const adminOrPlanner = [authenticateToken, authorizeRoles('admin', 'planner')];

router.get('/summary', adminOrPlanner, indicators.summary);

module.exports = router;
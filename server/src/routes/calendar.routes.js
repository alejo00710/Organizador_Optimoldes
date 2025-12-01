const express = require('express');
const router = express.Router();
const calendarController = require('../controllers/calendar.controller');
const { authenticateToken } = require('../middleware/auth');

// Ruta para la nueva vista de calendario por mes
router.get('/month-view', authenticateToken, calendarController.getMonthView);

module.exports = router;
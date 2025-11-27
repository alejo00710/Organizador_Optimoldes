const express = require('express');
const router = express.Router();
const calendarController = require('../controllers/calendar.controller');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, calendarController.getCalendar);

module.exports = router;
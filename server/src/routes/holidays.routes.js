const express = require('express');
const router = express.Router();
const holidaysController = require('../controllers/holidays.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { ROLES } = require('../utils/constants');

router.get('/', authenticateToken, holidaysController.getHolidays);
router.post('/', authenticateToken, authorizeRoles(ROLES.ADMIN), holidaysController.createHoliday);
router.delete(
    '/:date',
    authenticateToken,
    authorizeRoles(ROLES.ADMIN),
    holidaysController.deleteHoliday
);

module.exports = router;

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const catalogCtrl = require('../controllers/catalog.controller');

// Meta y sincronización
router.get('/meta', authenticateToken, catalogCtrl.getMeta);
router.post('/sync', authenticateToken, catalogCtrl.syncFromDatos);

module.exports = router;
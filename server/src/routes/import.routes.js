const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const importController = require('../controllers/import.controller');

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // hasta 50MB
});

// Importar archivo
router.post('/datos', authenticateToken, upload.single('file'), importController.importDatos);

// Descargar diagnóstico completo
router.get('/datos/:batchId/errors', authenticateToken, importController.getImportErrors);

module.exports = router;
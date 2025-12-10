const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const moldRecipes = require('../controllers/moldRecipes.controller');

// Obtener receta de un molde
router.get('/:moldId/recipe', authenticateToken, moldRecipes.getRecipe);

// Guardar receta (reemplaza/añade nueva versión)
router.post('/:moldId/recipe', authenticateToken, moldRecipes.saveRecipe);

module.exports = router;
const { query } = require('../config/database');

// GET /api/molds/:moldId/recipe
exports.getRecipe = async (req, res, next) => {
  try {
    const { moldId } = req.params;
    // Buscar la receta más reciente para ese molde
    const recipes = await query('SELECT * FROM mold_recipes WHERE mold_id = ? ORDER BY updated_at DESC LIMIT 1', [moldId]);
    if (!recipes.length) return res.json({ recipe: null, lines: [] });

    const recipe = recipes[0];
    const lines = await query('SELECT id, part_id, part_name, machine_id, machine_name, base_hours, sequence FROM mold_recipe_lines WHERE recipe_id = ? ORDER BY sequence ASC', [recipe.id]);
    res.json({ recipe, lines });
  } catch (e) { next(e); }
};

// POST /api/molds/:moldId/recipe
// body: { lines: [ { part_id, part_name, machine_id, machine_name, base_hours, sequence } ] }
exports.saveRecipe = async (req, res, next) => {
  try {
    const { moldId } = req.params;
    const userId = req.user?.id || null;
    const { lines } = req.body;
    if (!Array.isArray(lines)) return res.status(400).json({ error: 'Lines array required' });

    // Insertar nueva receta + líneas dentro de transacción sencilla
    await query('START TRANSACTION');
    const ins = await query('INSERT INTO mold_recipes (mold_id, created_by) VALUES (?, ?)', [moldId, userId]);
    const recipeId = ins.insertId;

    const insertLineSql = 'INSERT INTO mold_recipe_lines (recipe_id, part_id, part_name, machine_id, machine_name, base_hours, sequence) VALUES (?,?,?,?,?,?,?)';
    let seq = 0;
    for (const l of lines) {
      const partId = l.part_id || null;
      const partName = (l.part_name || (l.part_id ? null : null)) || null;
      const machineId = l.machine_id || null;
      const machineName = (l.machine_name || (l.machine_id ? null : null)) || null;
      const baseHours = (l.base_hours === undefined || l.base_hours === null) ? null : parseFloat(l.base_hours);
      await query(insertLineSql, [recipeId, partId, partName, machineId, machineName, baseHours, seq++]);
    }

    await query('COMMIT');

    res.json({ message: 'Receta guardada', recipeId });
  } catch (e) {
    try { await query('ROLLBACK'); } catch (_) {}
    next(e);
  }
};
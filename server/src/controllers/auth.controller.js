const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { jwt: jwtConfig } = require('../config/env');

/**
 * POST /auth/login
 * Login con credenciales compartidas + selección de operario
 */
const login = async (req, res, next) => {
    try {
        const { username, password, operatorId } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                error: 'Username y password son requeridos',
            });
        }

        // Buscar usuario
        const userSql = 'SELECT * FROM users WHERE username = ?';
        const users = await query(userSql, [username]);

        if (users.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const user = users[0];

        // Verificar contraseña
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // Si es operario, verificar que haya seleccionado un operatorId válido
        let selectedOperatorId = null;
        let operatorName = null;

        if (user.role === 'operator') {
            if (!operatorId) {
                // Obtener lista de operarios disponibles para este usuario
                const operatorsSql =
                    'SELECT id, name FROM operators WHERE user_id = ?  AND is_active = TRUE';
                const operators = await query(operatorsSql, [user.id]);

                return res.status(400).json({
                    error: 'Debes seleccionar un operario',
                    operators: operators,
                });
            }

            // Verificar que el operatorId pertenezca a este usuario
            const operatorSql =
                'SELECT * FROM operators WHERE id = ? AND user_id = ?  AND is_active = TRUE';
            const operators = await query(operatorSql, [operatorId, user.id]);

            if (operators.length === 0) {
                return res.status(403).json({ error: 'Operario inválido o inactivo' });
            }

            selectedOperatorId = operators[0].id;
            operatorName = operators[0].name;
        }

        // Generar token JWT
        const token = jwt.sign(
            {
                userId: user.id,
                username: user.username,
                role: user.role,
                operatorId: selectedOperatorId,
            },
            jwtConfig.secret,
            { expiresIn: jwtConfig.expiresIn }
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                operatorId: selectedOperatorId,
                operatorName: operatorName,
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /auth/operators
 * Obtiene lista de operarios para credenciales compartidas
 */
const getOperators = async (req, res, next) => {
    try {
        const { username } = req.query;

        if (!username) {
            return res.status(400).json({ error: 'Username es requerido' });
        }

        const sql = `
      SELECT o.id, o.name 
      FROM operators o
      JOIN users u ON o.user_id = u.id
      WHERE u.username = ? AND o.is_active = TRUE
      ORDER BY o.name
    `;

        const operators = await query(sql, [username]);
        res.json(operators);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /auth/verify
 * Verifica si el token del usuario es válido y devuelve los datos del usuario.
 */
const verify = async (req, res, next) => {
    try {
        // El middleware 'authenticateToken' ya validó el token. 
        // El payload está en 'req.user'.
        const userPayload = req.user;
        let operatorName = null;

        // Si es un operario, buscamos su nombre para que el frontend tenga toda la info.
        if (userPayload.role === 'operator' && userPayload.operatorId) {
            const operatorSql = 'SELECT name FROM operators WHERE id = ?';
            const operators = await query(operatorSql, [userPayload.operatorId]);
            if (operators.length > 0) {
                operatorName = operators[0].name;
            }
        }

        // Devolvemos una respuesta exitosa con los datos del usuario.
        res.status(200).json({
            message: 'Token válido',
            user: {
                id: userPayload.userId,
                username: userPayload.username,
                role: userPayload.role,
                operatorId: userPayload.operatorId,
                operatorName: operatorName,
            },
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    login,
    getOperators,
    verify,
};

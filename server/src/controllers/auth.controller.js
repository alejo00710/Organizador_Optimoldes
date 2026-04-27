const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { jwt: jwtConfig } = require('../config/env');
const { ROLES } = require('../utils/constants');

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

        // Login especial: "operarios" + selección de operario + contraseña propia por operario.
        // Nota: Debe emitir JWT con un users.id real para no romper FKs (ej: datos.created_by).
        if (String(username || '').toLowerCase() === 'operarios') {
            if (!operatorId) {
                const operators = await query(
                    'SELECT id, name FROM operators WHERE is_active = TRUE ORDER BY name'
                );
                return res.status(400).json({
                    error: 'Debes seleccionar un operario',
                    operators,
                });
            }

            const rows = await query(
                `
                SELECT
                                    o.id AS "operatorId",
                                    o.name AS "operatorName",
                  o.is_active,
                  o.password_hash AS operator_password_hash,
                  o.user_id,
                                    u.id AS "userId",
                  u.username,
                  u.password_hash AS user_password_hash,
                                    u.role AS "userRole"
                FROM operators o
                LEFT JOIN users u ON u.id = o.user_id
                WHERE o.id = ?
                `,
                [operatorId]
            );

            if (!rows.length) return res.status(403).json({ error: 'Operario inválido' });
            const row = rows[0];
            if (!row.is_active) return res.status(403).json({ error: 'Operario inválido o inactivo' });
            if (!row.userId) {
                return res.status(403).json({
                    error: 'Operario sin usuario asignado. Asigna/restablece contraseña en Configuración.',
                });
            }
            if (row.userRole && row.userRole !== ROLES.OPERATOR) {
                return res.status(403).json({ error: 'Operario inválido (rol de usuario inconsistente)' });
            }

            const hashToCheck = row.operator_password_hash || row.user_password_hash;
            if (!hashToCheck) {
                return res.status(401).json({
                    error: 'Operario sin contraseña. Asigna/restablece contraseña en Configuración.',
                });
            }

            const validPassword = await bcrypt.compare(String(password), hashToCheck);
            if (!validPassword) {
                return res.status(401).json({ error: 'Credenciales inválidas' });
            }

            // Registrar sesión
            const ip = (req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : null) || req.ip || null;
            const ua = req.get('user-agent') || null;
            const sessionRes = await query(
                'INSERT INTO user_sessions (user_id, operator_id, role, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
                [row.userId, Number(row.operatorId), ROLES.OPERATOR, ip, ua]
            );
            const sessionId = sessionRes.insertId;

            // Token JWT
            const token = jwt.sign(
                {
                    userId: row.userId,
                    username: row.username,
                    role: ROLES.OPERATOR,
                    operatorId: Number(row.operatorId),
                },
                jwtConfig.secret,
                { expiresIn: jwtConfig.expiresIn }
            );

            res.cookie('jwt', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 8 * 60 * 60 * 1000 // 8h en ms
            });

            return res.json({
                sessionId,
                user: {
                    id: row.userId,
                    username: row.username,
                    role: ROLES.OPERATOR,
                    operatorId: Number(row.operatorId),
                    operatorName: row.operatorName,
                },
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
            const isSharedOperariosAccount = String(user.username || '').toLowerCase() === 'operarios';

            if (!operatorId) {
                // Obtener lista de operarios disponibles
                // - Cuenta compartida "operarios": lista TODOS los operarios activos (según Configuración)
                // - Cuenta operario individual: lista solo los asignados al user_id
                const operatorsSql = isSharedOperariosAccount
                    ? 'SELECT id, name FROM operators WHERE is_active = TRUE ORDER BY name'
                    : 'SELECT id, name FROM operators WHERE user_id = ? AND is_active = TRUE ORDER BY name';
                const operators = isSharedOperariosAccount
                    ? await query(operatorsSql)
                    : await query(operatorsSql, [user.id]);

                return res.status(400).json({
                    error: 'Debes seleccionar un operario',
                    operators: operators,
                });
            }

            // Validación del operario seleccionado
            // - Cuenta compartida "operarios": permite cualquier operario activo
            // - Cuenta operario individual: debe pertenecer al user_id
            const operatorSql = isSharedOperariosAccount
                ? 'SELECT * FROM operators WHERE id = ? AND is_active = TRUE'
                : 'SELECT * FROM operators WHERE id = ? AND user_id = ? AND is_active = TRUE';
            const operators = isSharedOperariosAccount
                ? await query(operatorSql, [operatorId])
                : await query(operatorSql, [operatorId, user.id]);

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

        // Registrar sesión (para todos los roles)
        const ip = (req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : null) || req.ip || null;
        const ua = req.get('user-agent') || null;
        const sessionRes = await query(
            'INSERT INTO user_sessions (user_id, operator_id, role, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
            [user.id, selectedOperatorId, user.role, ip, ua]
        );
        const sessionId = sessionRes.insertId;

        res.cookie('jwt', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 8 * 60 * 60 * 1000 // 8h en ms
        });

        res.json({
            sessionId,
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
 * POST /auth/logout
 * Marca fin de sesión.
 */
const logout = async (req, res, next) => {
    try {
        const { sessionId } = req.body || {};
        if (!sessionId) return res.status(400).json({ error: 'sessionId requerido' });

        const result = await query(
            'UPDATE user_sessions SET logout_at = NOW() WHERE id = ? AND user_id = ? AND logout_at IS NULL',
            [sessionId, req.user.id]
        );
        res.clearCookie('jwt');
        res.json({ message: 'Sesión finalizada', updated: result.affectedRows || 0 });
    } catch (e) {
        next(e);
    }
};

/**
 * GET /auth/sessions
 * Lista sesiones (solo admin/jefe)
 */
const listSessions = async (req, res, next) => {
    try {
        const rows = await query(
            `
            SELECT
              s.id,
              s.user_id,
              u.username,
              s.operator_id,
              o.name AS operator_name,
              s.role,
              s.ip,
              s.user_agent,
              s.login_at,
              s.logout_at,
              CASE
                WHEN s.logout_at IS NULL THEN NULL
                                ELSE FLOOR(EXTRACT(EPOCH FROM (s.logout_at - s.login_at)) / 60)
              END AS duration_minutes
            FROM user_sessions s
            JOIN users u ON u.id = s.user_id
            LEFT JOIN operators o ON o.id = s.operator_id
            ORDER BY s.login_at DESC
            LIMIT 500
            `
        );
        res.json(rows);
    } catch (e) {
        next(e);
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

        // Para el login de cuenta compartida "operarios": listamos TODOS los operarios activos
        if (String(username || '').toLowerCase() === 'operarios') {
            const operators = await query(
                'SELECT id, name FROM operators WHERE is_active = TRUE ORDER BY name'
            );
            return res.json(operators);
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
                id: userPayload.id,
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
    logout,
    listSessions,
    bootstrapStatus,
    bootstrapInit,
};


/**
 * GET /auth/bootstrap/status
 * Indica si existen admin y jefe (planner). Si existen ambos, ya no se debe mostrar el apartado.
 */
async function bootstrapStatus(req, res, next) {
    try {
        const rows = await query(
            'SELECT username, role FROM users WHERE username IN (?, ?) OR role = ? LIMIT 10',
            ['admin', 'jefe', ROLES.MANAGEMENT]
        );
        const adminExists = rows.some((r) => r.username === 'admin' && r.role === ROLES.ADMIN);
        const jefeExists = rows.some((r) => r.username === 'jefe' && r.role === ROLES.PLANNER);
        const gerenciaExists = rows.some((r) => r.role === ROLES.MANAGEMENT);
        res.json({ adminExists, jefeExists, gerenciaExists, canBootstrap: !(adminExists && jefeExists && gerenciaExists) });
    } catch (e) {
        next(e);
    }
}

/**
 * POST /auth/bootstrap
 * Crea las cuentas admin y jefe (planner) solo si NO existen.
 * Una vez creadas (o si ya existen ambas), se bloquea.
 */
async function bootstrapInit(req, res, next) {
    try {
        const { adminPassword, jefePassword, gerenciaPassword } = req.body || {};

        // Estado actual
        const rows = await query(
            'SELECT username, role FROM users WHERE username IN (?, ?) OR role = ? LIMIT 10',
            ['admin', 'jefe', ROLES.MANAGEMENT]
        );
        const adminExists = rows.some((r) => r.username === 'admin' && r.role === ROLES.ADMIN);
        const jefeExists = rows.some((r) => r.username === 'jefe' && r.role === ROLES.PLANNER);
        const gerenciaExists = rows.some((r) => r.role === ROLES.MANAGEMENT);

        if (adminExists && jefeExists && gerenciaExists) {
            return res.status(403).json({ error: 'Bootstrap ya completado' });
        }

        // Validación: pedimos contraseñas solo para lo que falta
        if (!adminExists && !adminPassword) {
            return res.status(400).json({ error: 'adminPassword requerido' });
        }
        if (!jefeExists && !jefePassword) {
            return res.status(400).json({ error: 'jefePassword requerido' });
        }
        if (!gerenciaExists && !gerenciaPassword) {
            return res.status(400).json({ error: 'gerenciaPassword requerido' });
        }

        const created = { admin: false, jefe: false, gerencia: false };

        if (!adminExists) {
            const hash = await bcrypt.hash(String(adminPassword), 10);
            await query(
                'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
                ['admin', hash, ROLES.ADMIN]
            );
            created.admin = true;
        }

        if (!jefeExists) {
            const hash = await bcrypt.hash(String(jefePassword), 10);
            await query(
                'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
                ['jefe', hash, ROLES.PLANNER]
            );
            created.jefe = true;
        }

        if (!gerenciaExists) {
            const hash = await bcrypt.hash(String(gerenciaPassword), 10);
            await query(
                'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
                ['gerente', hash, ROLES.MANAGEMENT]
            );
            created.gerencia = true;
        }

        const status = {
            adminExists: adminExists || created.admin,
            jefeExists: jefeExists || created.jefe,
            gerenciaExists: gerenciaExists || created.gerencia,
        };
        status.canBootstrap = !(status.adminExists && status.jefeExists && status.gerenciaExists);

        res.status(201).json({ message: 'Bootstrap completado', created, status });
    } catch (e) {
        // Si hay carrera y ya existe, devolvemos mensaje claro
        if (String(e?.code || '') === '23505' || String(e?.code || '').toUpperCase() === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Bootstrap ya se ejecutó (usuario existente)' });
        }
        next(e);
    }
}

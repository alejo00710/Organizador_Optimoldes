const jwt = require('jsonwebtoken');
const { jwt: jwtConfig } = require('../config/env');
const { ROLES } = require('../utils/constants');

function isJefeUser(user) {
  const u = user?.username == null ? '' : String(user.username).trim().toLowerCase();
  return u === 'jefe';
}

/**
 * Normaliza el payload del JWT a un objeto user con id y role.
 * Acepta claves comunes: id, userId, uid; y role en raíz o en user.role.
 */
function normalizeUserPayload(payload) {
  const rawId = payload?.id ?? payload?.userId ?? payload?.uid ?? null;
  const id = rawId == null ? null : Number.parseInt(String(rawId), 10);
  const role = payload?.role ?? payload?.user?.role ?? null;
  const username = payload?.username ?? payload?.user?.username ?? null;
  const rawOperatorId = payload?.operatorId ?? payload?.user?.operatorId ?? null;
  const operatorId = rawOperatorId == null ? null : Number.parseInt(String(rawOperatorId), 10);

  const normalizedRole = role == null ? null : String(role);
  return {
    id: Number.isFinite(id) && id > 0 ? id : null,
    role: normalizedRole,
    username,
    operatorId: Number.isFinite(operatorId) && operatorId > 0 ? operatorId : null,
  };
}

/**
 * Middleware para verificar JWT
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Token de autenticación requerido' });
  }

  jwt.verify(token, jwtConfig.secret, (err, payload) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido o expirado' });
    }

    const user = normalizeUserPayload(payload);
    if (!user.id || !user.role) return res.status(403).json({ error: 'Token sin id/role válidos' });
    if (!Object.values(ROLES).includes(user.role)) return res.status(403).json({ error: 'Rol no válido' });

    req.user = user;
    next();
  });
};

/**
 * Middleware para verificar roles específicos
 */
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    // Compatibilidad: el usuario "jefe" debe tener permisos equivalentes a ADMIN.
    // En la BD "jefe" existe como usuario (role=planner), así que lo elevamos aquí
    // para que pase en endpoints que exigen explícitamente ROLES.ADMIN.
    if (roles.includes(ROLES.ADMIN) && isJefeUser(req.user)) {
      return next();
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'No tienes permisos para realizar esta acción',
      });
    }
    next();
  };
};

/**
 * Middleware para verificar que el operario solo acceda a sus propios datos
 */
const authorizeOperatorOwnData = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Usuario no autenticado' });
  }

  // Admin y planner pueden ver todo
  if ([ROLES.ADMIN, ROLES.PLANNER].includes(req.user.role)) {
    return next();
  }

  // Operario solo puede ver sus propios datos
  if (req.user.role === ROLES.OPERATOR) {
    const requestedOperatorId = parseInt(
      req.params.operatorId || req.body.operatorId || req.query.operatorId
    );

    if (requestedOperatorId && requestedOperatorId !== req.user.operatorId) {
      return res.status(403).json({
        error: 'No puedes acceder a datos de otros operarios',
      });
    }
  }

  next();
};

module.exports = {
  authenticateToken,
  authorizeRoles,
  authorizeOperatorOwnData,
};
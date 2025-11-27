const jwt = require('jsonwebtoken');
const { jwt: jwtConfig } = require('../config/env');
const { ROLES } = require('../utils/constants');

/**
 * Middleware para verificar JWT
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader. split(' ')[1]; // Bearer TOKEN
  
  if (!token) {
    return res.status(401).json({ error: 'Token de autenticación requerido' });
  }
  
  jwt.verify(token, jwtConfig.secret, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido o expirado' });
    }
    
    req.user = user;
    next();
  });
};

/**
 * Middleware para verificar roles específicos
 */
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (! req.user) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403). json({ 
        error: 'No tienes permisos para realizar esta acción' 
      });
    }
    
    next();
  };
};

/**
 * Middleware para verificar que el operario solo acceda a sus propios datos
 */
const authorizeOperatorOwnData = (req, res, next) => {
  if (! req.user) {
    return res.status(401).json({ error: 'Usuario no autenticado' });
  }
  
  // Admin y planner pueden ver todo
  if ([ROLES.ADMIN, ROLES.PLANNER].includes(req.user.role)) {
    return next();
  }
  
  // Operario solo puede ver sus propios datos
  if (req.user.role === ROLES.OPERATOR) {
    const requestedOperatorId = parseInt(req.params.operatorId || req.body.operatorId || req.query.operatorId);
    
    if (requestedOperatorId && requestedOperatorId !== req.user.operatorId) {
      return res.status(403).json({ 
        error: 'No puedes acceder a datos de otros operarios' 
      });
    }
  }
  
  next();
};

module. exports = {
  authenticateToken,
  authorizeRoles,
  authorizeOperatorOwnData
};
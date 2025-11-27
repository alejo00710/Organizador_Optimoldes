module.exports = {
  ROLES: {
    ADMIN: 'admin',
    PLANNER: 'planner',
    OPERATOR: 'operator'
  },
  
  WORKING_DAYS: [1, 2, 3, 4, 5], // Lunes a Viernes
  
  SINGLE_OPERATOR_HOURS: 9,
  MULTI_OPERATOR_HOURS_PER_PERSON: 8,
  
  DEVIATION_THRESHOLD: 0.05, // 5%
  
  OPERATOR_EDIT_DAYS_LIMIT: 2 // días atrás que puede editar un operario
};
module.exports = {
    testEnvironment: 'node',
    // Integración contra la misma BD compartida: ejecutar en serie evita
    // interferencias entre tests (p.ej. planPriority afecta plan_entries globales).
    maxWorkers: 1,
    // Los tests están en la raíz del workspace (/tests), no dentro de /server
    roots: ['<rootDir>/../tests'],
    testMatch: ['**/?(*.)+(spec|test).js'],
    // Permite resolver dependencias desde /server/node_modules aunque los tests estén fuera
    moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
    // Se ejecuta dentro del proceso de cada suite (worker)
    setupFilesAfterEnv: ['<rootDir>/../tests/jest.setupAfterEnv.js'],
    // Prepara BD/esquema y variables antes de correr tests
    globalSetup: '<rootDir>/../tests/jest.globalSetup.js',
    // Cierra pool de Postgres para que Jest no se quede colgado
    globalTeardown: '<rootDir>/../tests/jest.globalTeardown.js',
    // Evita que se mezclen con artefactos o builds
    testPathIgnorePatterns: ['/node_modules/'],
};

const path = require('path');
const dotenv = require('dotenv');

// Cargar .env del proyecto server sin depender del cwd.
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

module.exports = {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    db: {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        name: process.env.DB_NAME || 'production_scheduler',
    },
    jwt: {
        secret: process.env.JWT_SECRET || 'default_secret_change_me',
        expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    },
};

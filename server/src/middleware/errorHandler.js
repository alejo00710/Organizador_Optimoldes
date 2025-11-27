const errorHandler = (err, req, res, next) => {
    console.error('Error:', err);

    // Error de validación
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Error de validación',
            details: err.details,
        });
    }

    // Error de base de datos
    if (err.code && err.code.startsWith('ER_')) {
        return res.status(400).json({
            error: 'Error de base de datos',
            message: err.sqlMessage || err.message,
        });
    }

    // Error genérico
    res.status(err.status || 500).json({
        error: err.message || 'Error interno del servidor',
    });
};

module.exports = errorHandler;

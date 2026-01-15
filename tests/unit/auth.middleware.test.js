const { authorizeRoles } = require('../../server/src/middleware/auth');
const { ROLES } = require('../../server/src/utils/constants');

function makeRes() {
    return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
    };
}

describe('auth middleware: authorizeRoles', () => {
    test('allows admin when ADMIN is required', () => {
        const mw = authorizeRoles(ROLES.ADMIN);
        const req = { user: { id: 1, role: ROLES.ADMIN, username: 'admin' } };
        const res = makeRes();
        const next = jest.fn();

        mw(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    test('allows jefe (planner) when ADMIN is required', () => {
        const mw = authorizeRoles(ROLES.ADMIN);
        const req = { user: { id: 2, role: ROLES.PLANNER, username: 'jefe' } };
        const res = makeRes();
        const next = jest.fn();

        mw(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    test('denies non-jefe planner when ADMIN is required', () => {
        const mw = authorizeRoles(ROLES.ADMIN);
        const req = { user: { id: 3, role: ROLES.PLANNER, username: 'planner1' } };
        const res = makeRes();
        const next = jest.fn();

        mw(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            error: 'No tienes permisos para realizar esta acción',
        });
    });

    test('returns 401 when no user', () => {
        const mw = authorizeRoles(ROLES.ADMIN);
        const req = {};
        const res = makeRes();
        const next = jest.fn();

        mw(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Usuario no autenticado',
        });
    });
});

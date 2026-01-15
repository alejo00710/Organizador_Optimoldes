const request = require('supertest');
const crypto = require('crypto');

const app = require('../../server/src/app');
const { createUserAndToken } = require('../helpers/auth');
const { query } = require('../../server/src/config/database');
const { ROLES } = require('../../server/src/utils/constants');

function pad2(n) {
    return String(n).padStart(2, '0');
}

function toISODate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseISOToLocalDate(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

async function getIdByName(table, name) {
    const rows = await query(`SELECT id FROM ${table} WHERE name = ? LIMIT 1`, [name]);
    return rows?.[0]?.id || null;
}

async function cleanupPlannerArtifacts({ moldName, machineName, partName, overrideDateISO }) {
    try {
        if (overrideDateISO) {
            await query('DELETE FROM working_overrides WHERE date = ?', [overrideDateISO]);
        }

        const moldId = moldName ? await getIdByName('molds', moldName) : null;
        const machineId = machineName ? await getIdByName('machines', machineName) : null;
        const partId = partName ? await getIdByName('mold_parts', partName) : null;

        if (moldId) {
            await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldId]);
            await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldId]);
            await query('DELETE FROM molds WHERE id = ?', [moldId]);
        }

        if (machineId) await query('DELETE FROM machines WHERE id = ?', [machineId]);
        if (partId) await query('DELETE FROM mold_parts WHERE id = ?', [partId]);
    } catch (e) {
        // best-effort
        // eslint-disable-next-line no-console
        console.warn('[planner-priority-negative] cleanup best-effort failed:', e?.message || e);
    }
}

describe('Planificador PRIORIDAD - casos negativos', () => {
    let ctx;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.PLANNER });
    });

    afterAll(async () => {
        if (ctx?.cleanup) await ctx.cleanup();
    });

    it('rechaza startDate en el pasado (400) y no crea datos', async () => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const moldName = `jest_mold_prio_past_${suffix}`;
        const partName = `jest_part_prio_past_${suffix}`;
        const machineName = `jest_machine_prio_past_${suffix}`;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const pastISO = toISODate(yesterday);

        const beforeMolds = await query('SELECT COUNT(*)::int AS c FROM molds WHERE name = ?', [moldName]);
        expect(beforeMolds?.[0]?.c ?? 0).toBe(0);

        try {
            await request(app)
                .post('/api/tasks/plan/priority')
                .set('Authorization', `Bearer ${ctx.token}`)
                .send({
                    moldName,
                    startDate: pastISO,
                    tasks: [{ partName, machineName, totalHours: 4 }],
                })
                .expect(400);

            // Debe cortar antes de crear mold/part/machine
            const molds = await query('SELECT COUNT(*)::int AS c FROM molds WHERE name = ?', [moldName]);
            const parts = await query('SELECT COUNT(*)::int AS c FROM mold_parts WHERE name = ?', [partName]);
            const machines = await query('SELECT COUNT(*)::int AS c FROM machines WHERE name = ?', [machineName]);

            expect(molds?.[0]?.c ?? 0).toBe(0);
            expect(parts?.[0]?.c ?? 0).toBe(0);
            expect(machines?.[0]?.c ?? 0).toBe(0);

            // Y no debe haber plan_entries asociadas a ese molde (si existiera)
            const planCount = await query(
                'SELECT COUNT(*)::int AS c\n' +
                    'FROM plan_entries p\n' +
                    'JOIN molds m ON m.id = p.mold_id\n' +
                    'WHERE m.name = ?',
                [moldName],
            );
            expect(planCount?.[0]?.c ?? 0).toBe(0);
        } finally {
            await cleanupPlannerArtifacts({ moldName, machineName, partName });
        }
    });

    it('rechaza startDate no laborable (400) y no crea datos', async () => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const moldName = `jest_mold_prio_nonwork_${suffix}`;
        const partName = `jest_part_prio_nonwork_${suffix}`;
        const machineName = `jest_machine_prio_nonwork_${suffix}`;

        // Creamos una fecha "segura" (muy adelante para no tocar planes reales) y la marcamos como NO laborable.
        const maxRows = await query("SELECT to_char(MAX(date), 'YYYY-MM-DD') AS max_date FROM plan_entries");
        const maxISO = maxRows?.[0]?.max_date || null;
        const base = maxISO ? parseISOToLocalDate(maxISO) : new Date();
        base.setHours(0, 0, 0, 0);
        base.setDate(base.getDate() + 180);
        const nonWorkingISO = toISODate(base);

        // Override: forzar NO laborable para ese día (esto debe hacer fallar planPriority)
        await query(
            'INSERT INTO working_overrides (date, is_working) VALUES (?, ?)\n' +
                'ON CONFLICT (date) DO UPDATE SET is_working = EXCLUDED.is_working',
            [nonWorkingISO, false],
        );

        try {
            await request(app)
                .post('/api/tasks/plan/priority')
                .set('Authorization', `Bearer ${ctx.token}`)
                .send({
                    moldName,
                    startDate: nonWorkingISO,
                    tasks: [{ partName, machineName, totalHours: 4 }],
                })
                .expect(400);

            // Debe cortar antes de crear mold/part/machine
            const molds = await query('SELECT COUNT(*)::int AS c FROM molds WHERE name = ?', [moldName]);
            const parts = await query('SELECT COUNT(*)::int AS c FROM mold_parts WHERE name = ?', [partName]);
            const machines = await query('SELECT COUNT(*)::int AS c FROM machines WHERE name = ?', [machineName]);

            expect(molds?.[0]?.c ?? 0).toBe(0);
            expect(parts?.[0]?.c ?? 0).toBe(0);
            expect(machines?.[0]?.c ?? 0).toBe(0);

            const planCount = await query(
                'SELECT COUNT(*)::int AS c\n' +
                    'FROM plan_entries p\n' +
                    'JOIN molds m ON m.id = p.mold_id\n' +
                    'WHERE m.name = ?',
                [moldName],
            );
            expect(planCount?.[0]?.c ?? 0).toBe(0);
        } finally {
            await cleanupPlannerArtifacts({ moldName, machineName, partName, overrideDateISO: nonWorkingISO });
        }
    });
});

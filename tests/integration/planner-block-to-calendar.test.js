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

async function findNextWorkingDateISO(token, maxDays = 45) {
    let d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1);

    for (let i = 0; i < maxDays; i++) {
        const iso = toISODate(d);
        const res = await request(app)
            .get(`/api/working/check?date=${encodeURIComponent(iso)}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        if (res.body && res.body.laborable === true) return iso;
        d.setDate(d.getDate() + 1);
    }

    throw new Error('No se encontró una fecha laborable para planificar');
}

describe('Planificador -> Calendario (flujo real)', () => {
    let ctx;

    const suffix = crypto.randomUUID().slice(0, 8);
    const moldName = `jest_mold_plan_${suffix}`;
    const machineName = `jest_machine_plan_${suffix}`;
    const partName = `jest_part_plan_${suffix}`;

    let moldId;
    let machineId;
    let partId;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.PLANNER });
    });

    afterAll(async () => {
        try {
            if (!moldId) {
                const molds = await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [moldName]);
                moldId = molds[0]?.id;
            }
            if (!machineId) {
                const machines = await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]);
                machineId = machines[0]?.id;
            }
            if (!partId) {
                const parts = await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [partName]);
                partId = parts[0]?.id;
            }

            if (moldId) {
                await query('DELETE FROM plan_entries WHERE mold_id = ?', [moldId]);
                await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [moldId]);
                await query('DELETE FROM planning_history WHERE mold_id = ?', [moldId]);
                await query('DELETE FROM molds WHERE id = ?', [moldId]);
            }
            if (machineId) await query('DELETE FROM machines WHERE id = ?', [machineId]);
            if (partId) await query('DELETE FROM mold_parts WHERE id = ?', [partId]);
        } finally {
            if (ctx?.cleanup) await ctx.cleanup();
        }
    });

    it('con datos estrictos (planning_id) aparece en /calendar/month-view', async () => {
        const startDate = await findNextWorkingDateISO(ctx.token);

        const moldRes = await query('INSERT INTO molds (name, is_active) VALUES (?, TRUE)', [moldName]);
        moldId = moldRes.insertId;
        const machineRes = await query('INSERT INTO machines (name, is_active) VALUES (?, TRUE)', [machineName]);
        machineId = machineRes.insertId;
        const partRes = await query('INSERT INTO mold_parts (name, is_active) VALUES (?, TRUE)', [partName]);
        partId = partRes.insertId;

        await query(
            `INSERT INTO planning_history (mold_id, event_type, to_start_date, created_by)
             VALUES (?, 'PLANNED', ?, ?)`,
            [moldId, startDate, ctx.userId]
        );
        const planningRows = await query(
            `SELECT id
             FROM planning_history
             WHERE mold_id = ? AND event_type = 'PLANNED'
             ORDER BY id DESC
             LIMIT 1`,
            [moldId]
        );
        const planningId = Number(planningRows?.[0]?.id || 0);
        expect(planningId).toBeGreaterThan(0);

        await query(
            `INSERT INTO plan_entries (mold_id, planning_id, part_id, machine_id, date, hours_planned, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [moldId, planningId, partId, machineId, startDate, 4, ctx.userId]
        );

        expect(moldId).toBeTruthy();
        expect(machineId).toBeTruthy();
        expect(partId).toBeTruthy();

        const [y, m] = startDate.split('-').map(Number);

        const calRes = await request(app)
            .get(`/api/calendar/month-view?year=${y}&month=${m}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        const eventsByDay = calRes.body?.events || {};
        const allTasks = Object.values(eventsByDay)
            .flatMap(day => (Array.isArray(day?.tasks) ? day.tasks : []));

        expect(allTasks.length).toBeGreaterThan(0);

        const hit = allTasks.find(
            (t) => t && t.mold === moldName && t.machine === machineName && t.part === partName
        );

        expect(hit).toBeTruthy();
        expect(Number(hit.hours)).toBe(4);
        expect(hit).toHaveProperty('entryId');
        expect(String(hit.entryId)).toMatch(/^pe:\d+:\d+:\d+:\d{4}-\d{2}-\d{2}$/);
        expect(Number(hit.planningId)).toBe(planningId);
        expect(Number(hit.planningId)).toBeGreaterThan(0);
    });
});

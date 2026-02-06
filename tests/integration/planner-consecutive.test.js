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

function nextLocalWorkingISO(startISO) {
    const d = parseISOToLocalDate(startISO);
    d.setHours(0, 0, 0, 0);
    do {
        d.setDate(d.getDate() + 1);
    } while (d.getDay() === 0 || d.getDay() === 6);
    return toISODate(d);
}

function pickFarFutureBaseDateISO(seed) {
    const base = new Date(2099, 0, 1);
    const offset = Number.parseInt(String(seed).slice(0, 6), 16) % 300;
    base.setDate(base.getDate() + offset);
    base.setHours(0, 0, 0, 0);
    while (base.getDay() === 0 || base.getDay() === 6) base.setDate(base.getDate() + 1);
    return toISODate(base);
}

describe('Planificador CONSECUTIVO no borra plan del molde anterior', () => {
    let ctx;

    const suffix = crypto.randomUUID().slice(0, 8);
    const machineName = `jest_machine_consec_${suffix}`;

    const prevMold = `jest_mold_prev_consec_${suffix}`;
    const prevPart = `jest_part_prev_consec_${suffix}`;

    const curMold = `jest_mold_cur_consec_${suffix}`;
    const curPart = `jest_part_cur_consec_${suffix}`;

    let ids = {};

    beforeAll(async () => {
        // Admin simplifica permisos para work_logs y planificación
        ctx = await createUserAndToken({ role: ROLES.ADMIN });

        const operatorName = `jest_op_consec_${suffix}`;
        const opRes = await query('INSERT INTO operators (name, user_id, is_active) VALUES (?, NULL, TRUE)', [operatorName]);
        ids.operatorId = opRes.insertId;
    });

    afterAll(async () => {
        try {
            // Resolver IDs si faltan
            if (!ids.prevMoldId) ids.prevMoldId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [prevMold]))?.[0]?.id;
            if (!ids.curMoldId) ids.curMoldId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [curMold]))?.[0]?.id;
            if (!ids.machineId) ids.machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
            if (!ids.prevPartId) ids.prevPartId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [prevPart]))?.[0]?.id;
            if (!ids.curPartId) ids.curPartId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [curPart]))?.[0]?.id;

            // Cleanup: work_logs primero
            if (ids.prevMoldId) await query('DELETE FROM work_logs WHERE mold_id = ?', [ids.prevMoldId]);

            // plan_entries y snapshots
            if (ids.prevMoldId) {
                await query('DELETE FROM plan_entries WHERE mold_id = ?', [ids.prevMoldId]);
                await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [ids.prevMoldId]);
            }
            if (ids.curMoldId) {
                await query('DELETE FROM plan_entries WHERE mold_id = ?', [ids.curMoldId]);
                await query('DELETE FROM planner_grid_snapshots WHERE mold_id = ?', [ids.curMoldId]);
            }

            // Catálogos
            if (ids.operatorId) await query('DELETE FROM operators WHERE id = ?', [ids.operatorId]);
            if (ids.machineId) await query('DELETE FROM machines WHERE id = ?', [ids.machineId]);
            if (ids.prevMoldId) await query('DELETE FROM molds WHERE id = ?', [ids.prevMoldId]);
            if (ids.curMoldId) await query('DELETE FROM molds WHERE id = ?', [ids.curMoldId]);
            if (ids.prevPartId) await query('DELETE FROM mold_parts WHERE id = ?', [ids.prevPartId]);
            if (ids.curPartId) await query('DELETE FROM mold_parts WHERE id = ?', [ids.curPartId]);
        } finally {
            if (ctx?.cleanup) await ctx.cleanup();
        }
    });

    it('mantiene el 2do día del molde anterior y arranca después del fin planificado', async () => {
        const baseDate = pickFarFutureBaseDateISO(suffix);
        const day2 = nextLocalWorkingISO(baseDate);
        const day3 = nextLocalWorkingISO(day2);
        const day4 = nextLocalWorkingISO(day3);

        // 1) Planificar molde anterior en 2 días (16h con cap default 8h)
        await request(app)
            .post('/api/tasks/plan/block')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName: prevMold,
                startDate: baseDate,
                tasks: [{ partName: prevPart, machineName, totalHours: 16 }],
            })
            .expect(201);

        // 2) Planificar molde actual (para que exista y tenga orden de creación posterior)
        await request(app)
            .post('/api/tasks/plan/block')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldName: curMold,
                startDate: day4,
                tasks: [{ partName: curPart, machineName, totalHours: 2 }],
            })
            .expect(201);

        // IDs
        ids.prevMoldId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [prevMold]))?.[0]?.id;
        ids.curMoldId = (await query('SELECT id FROM molds WHERE name = ? LIMIT 1', [curMold]))?.[0]?.id;
        ids.machineId = (await query('SELECT id FROM machines WHERE name = ? LIMIT 1', [machineName]))?.[0]?.id;
        ids.prevPartId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [prevPart]))?.[0]?.id;
        ids.curPartId = (await query('SELECT id FROM mold_parts WHERE name = ? LIMIT 1', [curPart]))?.[0]?.id;

        expect(ids.prevMoldId).toBeTruthy();
        expect(ids.curMoldId).toBeTruthy();
        expect(ids.machineId).toBeTruthy();
        expect(ids.prevPartId).toBeTruthy();

        // Confirmar que el molde anterior quedó en baseDate..day2
        const prevRange = await query(
            "SELECT to_char(MIN(date), 'YYYY-MM-DD') AS min_date, to_char(MAX(date), 'YYYY-MM-DD') AS max_date, COUNT(DISTINCT date) AS days FROM plan_entries WHERE mold_id = ?",
            [ids.prevMoldId],
        );
        expect(prevRange?.[0]?.min_date).toBe(baseDate);
        expect(prevRange?.[0]?.max_date).toBe(day2);
        expect(Number(prevRange?.[0]?.days || 0)).toBeGreaterThanOrEqual(2);

        // 3) Marcar el molde anterior como COMPLETO pero con finish_date = baseDate (todas las horas cargadas el día 1)
        await request(app)
            .post('/api/work_logs')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldId: ids.prevMoldId,
                partId: ids.prevPartId,
                machineId: ids.machineId,
                operatorId: ids.operatorId,
                hours_worked: 16,
                note: 'jest-consec',
                work_date: baseDate,
            })
            .expect(201);

        // 4) Ejecutar consecutivo sobre el molde actual
        const res = await request(app)
            .post('/api/tasks/plan/consecutive')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({
                moldId: ids.curMoldId,
                moldName: curMold,
                tasks: [{ partName: curPart, machineName, totalHours: 2 }],
            })
            .expect(200);

        // Debe arrancar después del fin planificado (day2 -> day3)
        expect(res.body).toHaveProperty('startDate');
        expect(res.body.startDate).toBe(day3);

        // 5) Asegurar que NO se borró el 2do día del molde anterior
        const stillHasDay2 = await query(
            "SELECT COUNT(*) AS c FROM plan_entries WHERE mold_id = ? AND to_char(date, 'YYYY-MM-DD') = ?",
            [ids.prevMoldId, day2],
        );
        expect(Number(stillHasDay2?.[0]?.c || 0)).toBeGreaterThan(0);

        // Y que el molde actual se movió a day3
        const curMin = await query("SELECT to_char(MIN(date), 'YYYY-MM-DD') AS min_date FROM plan_entries WHERE mold_id = ?", [ids.curMoldId]);
        expect(curMin?.[0]?.min_date).toBe(day3);
    });
});

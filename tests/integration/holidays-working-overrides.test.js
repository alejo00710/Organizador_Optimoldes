const request = require('supertest');
const crypto = require('crypto');

const app = require('../../server/src/app');
const { createUserAndToken } = require('../helpers/auth');
const { query } = require('../../server/src/config/database');
const { ROLES } = require('../../server/src/utils/constants');

function toISODate(d) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function pickFutureWeekdayISO(seed, baseYear, baseMonthIndex) {
    const d = new Date(Date.UTC(baseYear, baseMonthIndex, 1));
    const offset = Number.parseInt(String(seed).slice(0, 6), 16) % 25; // 0..24
    d.setUTCDate(d.getUTCDate() + offset);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    return toISODate(d);
}

describe('Festivos + días no laborables (override)', () => {
    let ctx;

    const suffix = crypto.randomUUID().slice(0, 8);
    const holidayDate = pickFutureWeekdayISO(suffix, 2099, 11); // Diciembre 2099
    const overrideDate = pickFutureWeekdayISO(suffix.split('').reverse().join(''), 2099, 10); // Noviembre 2099
    const holidayName = `jest_holiday_${suffix}`;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.ADMIN });
    });

    afterAll(async () => {
        try {
            await query('DELETE FROM holidays WHERE date = ?', [holidayDate]);
            await query('DELETE FROM working_overrides WHERE date = ?', [overrideDate]);
        } finally {
            if (ctx?.cleanup) await ctx.cleanup();
        }
    });

    it('POST /api/holidays crea y GET /api/holidays lo lista', async () => {
        await request(app)
            .post('/api/holidays')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ date: holidayDate, name: holidayName })
            .expect(201);

        const year = Number(holidayDate.slice(0, 4));
        const listRes = await request(app)
            .get(`/api/holidays?year=${year}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        const normalizeISO = (v) => {
            if (!v) return null;
            if (v instanceof Date) return v.toISOString().slice(0, 10);
            return String(v).slice(0, 10);
        };

        const hit = (listRes.body || []).find((h) => {
            const d = normalizeISO(h?.date_str ?? h?.date);
            return d === holidayDate;
        });
        expect(hit).toBeTruthy();
    });

    it('POST /api/working/override marca no laborable y /check lo refleja', async () => {
        await request(app)
            .post('/api/working/override')
            .set('Authorization', `Bearer ${ctx.token}`)
            .send({ date: overrideDate, isWorking: false })
            .expect(200);

        const checkRes = await request(app)
            .get(`/api/working/check?date=${encodeURIComponent(overrideDate)}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        expect(checkRes.body).toHaveProperty('laborable', false);
    });
});

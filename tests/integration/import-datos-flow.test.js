const request = require('supertest');
const crypto = require('crypto');
const XLSX = require('xlsx');

const app = require('../../server/src/app');
const { createUserAndToken } = require('../helpers/auth');
const { query } = require('../../server/src/config/database');
const { ROLES } = require('../../server/src/utils/constants');

describe('Importar datos (flujo real)', () => {
    let ctx;
    let batchId;

    const suffix = crypto.randomUUID().slice(0, 8);
    const nombre_operario = `jest_imp_op_${suffix}`;
    const tipo_proceso = `jest_imp_proc_${suffix}`;
    const molde = `jest_imp_mold_${suffix}`;
    const parte = `jest_imp_part_${suffix}`;
    const maquina = `jest_imp_machine_${suffix}`;
    const operacion = `jest_imp_opr_${suffix}`;

    beforeAll(async () => {
        ctx = await createUserAndToken({ role: ROLES.ADMIN });
    });

    afterAll(async () => {
        try {
            if (batchId) {
                await query('DELETE FROM import_errors WHERE batch_id = ?', [batchId]);
                await query('DELETE FROM datos WHERE import_batch_id = ?', [batchId]);
                await query('DELETE FROM import_batches WHERE id = ?', [batchId]);
            }

            await query('DELETE FROM operators WHERE name = ?', [nombre_operario]);
            await query('DELETE FROM processes WHERE name = ?', [tipo_proceso]);
            await query('DELETE FROM molds WHERE name = ?', [molde]);
            await query('DELETE FROM mold_parts WHERE name = ?', [parte]);
            await query('DELETE FROM machines WHERE name = ?', [maquina]);
            await query('DELETE FROM operations WHERE name = ?', [operacion]);
        } finally {
            if (ctx?.cleanup) await ctx.cleanup();
        }
    });

    it('POST /api/import/datos importa 1 fila y aparece en /api/datos', async () => {
        const rows = [
            [null, null, null, 'NOMBRE DE OPERARIO', 'TIPO PROCESO', 'MOLDE', 'PARTE', 'MÁQUINA', 'OPERACIÓN', 'HORAS'],
            [null, null, null, '', '', '', '', '', '', ''],
            [null, null, null, nombre_operario, tipo_proceso, molde, parte, maquina, operacion, 2.25],
        ];

        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'DATOS');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const importRes = await request(app)
            .post('/api/import/datos')
            .set('Authorization', `Bearer ${ctx.token}`)
            .attach('file', buffer, 'datos.xlsx')
            .expect(200);

        expect(importRes.body).toHaveProperty('batchId');
        expect(importRes.body).toHaveProperty('ok', 1);
        expect(importRes.body).toHaveProperty('fail', 0);
        batchId = importRes.body.batchId;

        const datosRes = await request(app)
            .get(`/api/datos?limit=20&offset=0&molde=${encodeURIComponent(molde)}`)
            .set('Authorization', `Bearer ${ctx.token}`)
            .expect(200);

        const items = datosRes.body?.items || [];
        const hit = items.find((r) => r && r.molde === molde && r.maquina === maquina && r.parte === parte);
        expect(hit).toBeTruthy();
        expect(hit).toHaveProperty('source', 'import');
    });
});

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const crypto = require('crypto');
const XLSX = require('xlsx');

const { ensureE2EUsers } = require('./utils/seed');
const { loginAs, openTab } = require('./utils/ui');

test.describe('E2E - Importar', () => {
  test('Importar Datos shows success toast', async ({ page }, testInfo) => {
    const users = await ensureE2EUsers();
    await loginAs(page, { username: 'admin', password: users.admin.password });

    await openTab(page, 'importar');

    const suffix = crypto.randomUUID().slice(0, 8);
    const nombre_operario = `e2e_imp_op_${suffix}`;
    const tipo_proceso = `e2e_imp_proc_${suffix}`;
    const molde = `e2e_imp_mold_${suffix}`;
    const parte = `e2e_imp_part_${suffix}`;
    const maquina = `e2e_imp_machine_${suffix}`;
    const operacion = `e2e_imp_opr_${suffix}`;

    const rows = [
      [null, null, null, 'NOMBRE DE OPERARIO', 'TIPO PROCESO', 'MOLDE', 'PARTE', 'MÁQUINA', 'OPERACIÓN', 'HORAS'],
      [null, null, null, '', '', '', '', '', '', ''],
      [null, null, null, nombre_operario, tipo_proceso, molde, parte, maquina, operacion, 2.25],
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DATOS');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filePath = testInfo.outputPath('import.xlsx');
    fs.writeFileSync(filePath, buffer);

    await page.setInputFiles('#importFile', filePath);
    await page.locator('#importBtn').click();

    await expect(page.locator('#toastHost .toast')).toContainText('Importación completada');
  });
});

const { test, expect } = require('@playwright/test');

const { ensureE2EUsers } = require('./utils/seed');
const { loginAs, openTab } = require('./utils/ui');

test.describe('E2E - Indicadores', () => {
  test('Can select operator in Config and export CSV', async ({ page }) => {
    const users = await ensureE2EUsers();
    await loginAs(page, { username: 'admin', password: users.admin.password });

    // Select operator for indicators in Config (stored in localStorage).
    await openTab(page, 'config');

    const rows = page.locator('#operatorsTable tbody tr');
    await expect
      .poll(async () => rows.count(), { timeout: 15_000 })
      .toBeGreaterThan(0);

    const idx = await rows.evaluateAll((trs, expectedName) => {
      const normalizedExpected = String(expectedName || '').trim().toLowerCase();
      return trs.findIndex(tr => {
        const inp = tr.querySelector('input.op-name');
        const v = inp ? String(inp.value || '').trim().toLowerCase() : '';
        return v === normalizedExpected;
      });
    }, users.operator.name);

    expect(idx).toBeGreaterThanOrEqual(0);
    const row = rows.nth(idx);
    await expect(row).toBeVisible();

    const checkbox = row.locator('input.op-indicators');
    await checkbox.check();

    // Now load indicators.
    await openTab(page, 'indicators');

    const year = String(new Date().getFullYear());
    await page.locator('#indYear').fill(year);
    await page.locator('#loadIndicatorsBtn').click();

    const headerCells = page.locator('#indMainTable thead th');
    await expect
      .poll(async () => headerCells.count(), { timeout: 15_000 })
      .toBeGreaterThan(2);

    // Export should download a CSV.
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#exportIndicatorsBtn').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(new RegExp(`^indicadores_${year}\\.csv$`));
  });
});

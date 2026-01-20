const { test, expect } = require('@playwright/test');
const { ensureE2EUsers } = require('./utils/seed');
const { loginAs, loginAsSharedOperario } = require('./utils/ui');

test.describe('E2E - Auth & roles', () => {
  test('Admin can login and sees full tabs', async ({ page }) => {
    const users = await ensureE2EUsers();

    await loginAs(page, { username: 'admin', password: users.admin.password });

    await expect(page.locator('#displayUsername')).toHaveText('admin');

    // Admin should see all main tabs.
    const tabs = [
      'plan',
      'calendar',
      'config',
      'datos',
      'importar',
      'indicators',
      'sesiones',
      'tiempos',
      'registros',
    ];

    for (const t of tabs) {
      await expect(page.locator(`.tabs button[data-tab="${t}"]`)).toBeVisible();
    }
  });

  test('Shared Operarios login shows restricted tabs', async ({ page }) => {
    const users = await ensureE2EUsers();

    await loginAsSharedOperario(page, {
      operatorName: users.operator.name,
      password: users.operator.password,
    });

    await expect(page.locator('#displayUsername')).toHaveText('operario');

    // Operator should only see tiempos + registros (per showMainApp).
    await expect(page.locator('.tabs button[data-tab="tiempos"]')).toBeVisible();
    await expect(page.locator('.tabs button[data-tab="registros"]')).toBeVisible();

    await expect(page.locator('.tabs button[data-tab="plan"]')).toBeHidden();
    await expect(page.locator('.tabs button[data-tab="config"]')).toBeHidden();
    await expect(page.locator('.tabs button[data-tab="importar"]')).toBeHidden();
    await expect(page.locator('.tabs button[data-tab="indicators"]')).toBeHidden();
  });
});

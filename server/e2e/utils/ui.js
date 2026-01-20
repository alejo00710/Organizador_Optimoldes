const { expect } = require('@playwright/test');

async function openTab(page, tabName) {
  await page.locator(`.tabs button[data-tab="${tabName}"]`).click();
  await expect(page.locator(`#tab-${tabName}`)).toBeVisible();
}

async function loginAs(page, { username, password }) {
  await page.goto('/');

  await page.locator('#username').selectOption(username);
  await page.locator('#password').fill(password);

  await page.locator('#loginBtn').click();
  await expect(page.locator('#mainApp')).toBeVisible();
}

async function loginAsSharedOperario(page, { operatorName, password }) {
  await page.goto('/');

  await page.locator('#username').selectOption('operarios');

  const group = page.locator('#operatorSelectGroup');
  await expect(group).toBeVisible();

  const operatorSelect = page.locator('#operatorId');
  await expect(operatorSelect).toBeVisible();

  // Wait for the operators list to populate.
  await expect
    .poll(async () => operatorSelect.locator('option').count(), { timeout: 10_000 })
    .toBeGreaterThan(1);

  await operatorSelect.selectOption({ label: operatorName });
  await page.locator('#password').fill(password);

  await page.locator('#loginBtn').click();
  await expect(page.locator('#mainApp')).toBeVisible();
}

module.exports = {
  openTab,
  loginAs,
  loginAsSharedOperario,
};

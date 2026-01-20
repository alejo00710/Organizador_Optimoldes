const { test, expect } = require('@playwright/test');
const { ensureE2EUsers, ensureE2ECatalog } = require('./utils/seed');
const { loginAs, openTab } = require('./utils/ui');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

async function apiLogin({ request, username, password }) {
  const res = await request.post('/api/auth/login', { data: { username, password } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.token) {
    throw new Error(`API login failed: status=${res.status()} body=${JSON.stringify(data)}`);
  }
  return data.token;
}

async function findNextWorkingDate({ request, token, fromDateISO }) {
  // Scan forward for a laborable day (weekends/holidays/overrides aware).
  let cursor = new Date(`${fromDateISO}T00:00:00`);

  for (let i = 0; i < 40; i++) {
    const iso = localISO(cursor);
    const res = await request.get(`/api/working/check?date=${encodeURIComponent(iso)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.laborable === true) return iso;
    cursor.setDate(cursor.getDate() + 1);
  }

  throw new Error('Could not find a working date in scan window');
}

const ES_MONTH_TO_INDEX = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

async function navigateCalendarTo(page, { year, monthIndex0 }) {
  const header = page.locator('#calendar-month-year');

  for (let i = 0; i < 24; i++) {
    const text = (await header.textContent()) || '';
    const parts = text.trim().split(/\s+/);
    const monthName = (parts[0] || '').toLowerCase();
    const y = Number(parts[1]);
    const m = ES_MONTH_TO_INDEX[monthName];

    if (Number.isFinite(y) && m != null && y === year && m === monthIndex0) return;

    // Decide direction based on lexicographic month/year ordering.
    const current = (Number.isFinite(y) && m != null) ? (y * 12 + m) : null;
    const target = year * 12 + monthIndex0;

    if (current != null && current < target) {
      await page.locator('#next-month-btn').click();
    } else {
      await page.locator('#prev-month-btn').click();
    }

    // Wait for header to update.
    await expect(header).not.toHaveText(text);
  }

  throw new Error('Could not navigate calendar to target month/year');
}

function dayOfMonth(isoDate) {
  return Number.parseInt(String(isoDate).slice(8, 10), 10);
}

test.describe('E2E - Planner + Calendar', () => {
  test('Create plan from Cuadro Planificador, verify in Calendario, edit/move entry and toggle working override', async ({ page, request }) => {
    const users = await ensureE2EUsers();
    const catalog = await ensureE2ECatalog();

    const token = await apiLogin({ request, username: 'jefe', password: users.planner.password });

    const todayISO = localISO(new Date());
    const startDate = await findNextWorkingDate({ request, token, fromDateISO: todayISO });

    await loginAs(page, { username: 'jefe', password: users.planner.password });

    // --- Planificador ---
    await openTab(page, 'plan');

    await page.locator('#planMoldFilter').fill(catalog.moldName);

    const moldSelect = page.locator('#planMoldSelect');
    await expect
      .poll(async () => moldSelect.locator('option').count(), { timeout: 10_000 })
      .toBeGreaterThan(0);

    await moldSelect.selectOption({ label: catalog.moldName });

    await page.locator('#gridStartDate').fill(startDate);

    // Fill the first row with qty + hours for the first machine input.
    const firstRow = page.locator('#planningGridFixed tbody tr').first();
    await firstRow.locator('.qty-input').fill('1');
    await firstRow.locator('.hours-input').first().fill('1');

    await page.locator('#submitGridPlanBtn').click();
    await expect(page.locator('#toastHost .toast')).toContainText(/Plan|Planificaci|cread|bloque/i);

    // --- Calendario: go to month of startDate and verify mold appears in day modal ---
    await openTab(page, 'calendar');
    await expect
      .poll(() => page.locator('#calendar-grid .calendar-day').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);

    const targetYear = Number(startDate.slice(0, 4));
    const targetMonthIndex0 = Number(startDate.slice(5, 7)) - 1;
    await navigateCalendarTo(page, { year: targetYear, monthIndex0: targetMonthIndex0 });

    const d = dayOfMonth(startDate);
    const dayCell = page
      .locator('#calendar-grid .calendar-day')
      .filter({ has: page.locator('.day-number', { hasText: new RegExp(`^${d}$`) }) })
      .first();

    await dayCell.click();
    await expect(page.locator('#day-details-modal')).toBeVisible();
    await expect(page.locator('#modal-body')).toContainText(catalog.moldName);

    // --- Editar este molde: move entry to next available ---
    const editBtn = page.locator('#modal-body button[data-edit-mold]').first();
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    await expect(page.locator('#modal-title')).toContainText('Editar molde');
    const nextBtn = page.locator('#modal-body button.pe-next-btn').first();
    await expect(nextBtn).toBeVisible();
    await nextBtn.click();

    await expect(page.locator('#toastHost .toast')).toContainText(/Movido al siguiente disponible|siguiente disponible/i);

    const newDateText = (await page.locator('#modal-body table tbody tr').first().locator('td').first().textContent()) || '';
    const newDate = newDateText.trim();
    expect(newDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(newDate > startDate).toBeTruthy();

    // --- Volver al día y toggle working override ---
    await page.locator('#moldEditorBackBtn').click();
    await expect(page.locator('#toggleWorkingBtn')).toBeVisible();

    const toggleBtn = page.locator('#toggleWorkingBtn');
    const initialToggleText = (await toggleBtn.textContent()) || '';

    // Only perform the toggle if the UI is offering to disable (i.e., currently laborable).
    if (/Deshabilitar/i.test(initialToggleText)) {
      await toggleBtn.click();
      await expect(page.locator('#toastHost .toast')).toContainText(/deshabilitado correctamente/i);

      // Modal closes; reopen and verify button flipped.
      await expect(page.locator('#day-details-modal')).toBeHidden();
      await dayCell.click();
      await expect(page.locator('#day-details-modal')).toBeVisible();
      await expect(page.locator('#toggleWorkingBtn')).toHaveText(/Habilitar/i);
    }
  });
});

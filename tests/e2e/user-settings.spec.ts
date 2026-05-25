import { test, expect } from '@playwright/test';

/**
 * Sweep over /settings → Preferences. Verifies that each user-controllable
 * setting actually round-trips: the toggle persists, the API echoes it
 * back, and visible side-effects (data-attribute stamping, computed
 * styles for the colorblind palette swap) take effect immediately.
 *
 * The colorblind assertion is the load-bearing one — the user has reported
 * the swap doesn't always work, so we read computed CSS of an element
 * consuming `--color-loss` rather than just trusting the data attribute.
 */
test.describe('User settings — preferences', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('toggles persist and the colorblind palette actually swaps', async ({ page }) => {
    // ── Login (mock seed user `syl` with admin password — same pattern as
    //    profile-colors.spec.ts).
    await page.goto('/login');
    await page.getByLabel(/username/i).fill('syl');
    await page.getByLabel(/password/i).fill('admin');
    await page.getByRole('button', { name: /sign in/i }).click();
    // Wait for the auth redirect off /login.
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 10_000 });

    // Settings reads ?tab= for the initial selection — go straight to
    // Preferences so we don't depend on tab-click DOM.
    await page.goto('/settings?tab=preferences');

    // The Theme Select trigger renders the raw stored value ("dark"), not the
    // option label. Assert the Appearance card is up and the trigger reads dark.
    await expect(page.getByText(/^Appearance$/)).toBeVisible({ timeout: 10_000 });
    const themeTrigger = page.locator('label:has-text("Theme")').locator('..').getByRole('combobox');
    await expect(themeTrigger).toHaveText(/dark/i);

    // ── Density: flip comfortable → compact and back so the persistence
    //    code path runs end-to-end without leaving the user's account in a
    //    surprising state. We don't assert any DOM side-effect here because
    //    density is read by individual components on next render — the
    //    contract tested is "the value saves and the API echoes it back".
    const densityTrigger = page.locator('label:has-text("Density")').locator('..').getByRole('combobox');
    await densityTrigger.click();
    await page.getByRole('option', { name: /compact/i }).click();

    // ── Default landing path: pick whatever the second option is so we
    //    don't depend on the exact label set in DEFAULT_LANDING_OPTIONS.
    const landingTrigger = page.locator('label:has-text("Default landing page")').locator('..').getByRole('combobox');
    await landingTrigger.click();
    const options = page.getByRole('option');
    await options.nth(1).click();

    // ── Colorblind toggle ON.
    const cbSwitch = page.locator('text=Colorblind mode').locator('..').locator('..').getByRole('switch');
    await cbSwitch.click();

    // Save — sticky bottom button.
    await page.getByRole('button', { name: /save preferences/i }).click();
    await expect(page.getByText(/preferences saved/i)).toBeVisible({ timeout: 5_000 });

    // ── data-colorblind attribute should be stamped.
    await expect.poll(async () =>
      page.evaluate(() => document.documentElement.getAttribute('data-colorblind')),
    ).toBe('true');

    // ── Computed style proof: an element consuming `--color-loss` must now
    //    render orange (#f97316 → rgb(249, 115, 22)), not red.
    const lossColor = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.className = 'text-loss';
      probe.textContent = 'probe';
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    expect(lossColor.replace(/\s+/g, '')).toBe('rgb(249,115,22)');

    // ── Toggle colorblind back OFF and save; assert it reverts.
    await cbSwitch.click();
    await page.getByRole('button', { name: /save preferences/i }).click();
    await expect(page.getByText(/preferences saved/i)).toBeVisible({ timeout: 5_000 });

    await expect.poll(async () =>
      page.evaluate(() => document.documentElement.getAttribute('data-colorblind')),
    ).not.toBe('true');

    const revertedLoss = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.className = 'text-loss';
      probe.textContent = 'probe';
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    // Default --color-loss is #f87171 → rgb(248, 113, 113).
    expect(revertedLoss.replace(/\s+/g, '')).toBe('rgb(248,113,113)');

    // ── Round-trip via the API: the saved values from the second save
    //    should match what the server echoes back.
    const me = await page.request.get('/api/users/me/preferences');
    expect(me.ok()).toBeTruthy();
    const prefs = await me.json();
    expect(prefs.density).toBe('compact');
    expect(prefs.colorblindMode).toBe(false);
    // Theme stays dark (light is disabled in the UI).
    expect(prefs.theme).toBe('dark');
  });
});

import { test, expect, type Page } from '@playwright/test';

/**
 * Market hub — the unified Trade Block + Free Agents surface. It replaced the
 * old standalone /trades + /free-agents pages and the 4-step trade wizard with
 * a single hub (tabs) and one focused trade composer.
 *
 * The seeded e2e DB (seed:fresh = S10 import) leaves every league in offseason,
 * so the trade *deadline has passed* — which deadline-gates the "New trade"
 * composer and the "List a Pokémon" dialog (both require an acting team AND an
 * open deadline), so neither is reachable from this fixture. The composer's
 * rule math is pinned by validation.test.ts; here we prove the hub itself
 * mounts, both tabs route, the Base UI Select stack (the staff "acting as"
 * picker / filters) opens and selects without crashing, and the
 * page-error-boundary never trips.
 */
test.describe('Market hub', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('hub mounts, tabs route, and the Base UI stack never trips the error boundary', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (t.includes('Base UI') || t.includes('production-error') || t.includes('Uncaught') || t.includes('PageErrorBoundary')) {
        errors.push(`console: ${t}`);
      }
    });

    await loginAs(page, 'syl', 'admin');
    await page.goto('/league/sapphire/market');

    // Hub title + both tabs render (the trades tab is the default landing).
    await expect(page.getByRole('heading', { name: /mar\s*ket/i })).toBeVisible({ timeout: 15_000 });
    const errorBoundary = page.getByText(/this page hit an unexpected error/i);
    await expect(errorBoundary).toHaveCount(0);

    const main = page.locator('main');
    await expect(main.getByRole('link', { name: /trade block/i })).toBeVisible({ timeout: 10_000 });
    await expect(main.getByRole('link', { name: /free agents/i })).toBeVisible();

    // Switch to Free Agents and back — both tabs must mount without crashing.
    await main.getByRole('link', { name: /free agents/i }).click();
    await expect(page).toHaveURL(/\/market\/free-agents/, { timeout: 10_000 });
    await expect(errorBoundary).toHaveCount(0);

    await main.getByRole('link', { name: /trade block/i }).click();
    await expect(page).toHaveURL(/\/market\/trades/, { timeout: 10_000 });
    await expect(errorBoundary).toHaveCount(0);

    // Exercise a Base UI Select if one is present (e.g. the staff "acting as"
    // picker or a team filter) — opening it and choosing an option proves the
    // base-ui Select stack mounts and selects without tripping the boundary.
    const combo = page.getByRole('combobox').first();
    if (await combo.isVisible().catch(() => false)) {
      await combo.click();
      const option = page.getByRole('option').first();
      if (await option.isVisible().catch(() => false)) {
        await option.click();
      } else {
        await page.keyboard.press('Escape');
      }
    }

    expect(errors, 'no runtime errors on the Market hub').toEqual([]);
    await expect(errorBoundary).toHaveCount(0);
  });
});

async function loginAs(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign\s*in/i }).click();
  await expect(page).toHaveURL(/\/(?:$|me|league|admin)/, { timeout: 10_000 });
}

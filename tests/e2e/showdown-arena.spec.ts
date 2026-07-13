import { test, expect, type Page } from '@playwright/test';

/**
 * Showdown / Arena surface.
 *
 * The Showdown page is a single PS client (the main iframe) plus a collapsible
 * Arena footer. There is deliberately NO second in-page PS client: a coach
 * plays their live match — and watches others — in that one client (the "Live"
 * pill's Watch button opens someone else's room in a new tab). We assert the
 * page mounts cleanly with the PS iframe + the footer's connection pill, and
 * that no Base UI/React error fires.
 */
test.describe('Showdown / Arena', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('page mounts with the PS iframe and arena footer, no runtime errors', async ({ page }) => {
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
    await page.goto('/showdown');

    // The PS iframe is the load-bearing element (titled "Pokemon Showdown").
    await expect(page.locator('iframe[title="Pokemon Showdown"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/this page hit an unexpected error/i)).toHaveCount(0);

    // The arena footer renders a connection pill ("Connected" / "Reconnecting...")
    // regardless of whether a battle is live — proves the footer mounted.
    await expect(page.getByText(/connected|reconnecting/i).first()).toBeVisible({ timeout: 10_000 });

    expect(errors, 'no runtime errors on /showdown').toEqual([]);
  });

  /**
   * No second in-page PS client. The page must render exactly ONE Showdown
   * iframe — the main client. The old Battle HUD mounted a second PS iframe
   * (titled "Pokemon Showdown Battle"); two clients on one origin corrupt each
   * other's session, so it was removed. Guard against it creeping back.
   */
  test('renders a single PS client, never a second in-page battle iframe', async ({ page }) => {
    await loginAs(page, 'syl', 'admin');
    await page.goto('/showdown');

    await expect(page.locator('iframe[title="Pokemon Showdown"]')).toBeVisible({ timeout: 15_000 });
    // The removed HUD's iframe was titled "Pokemon Showdown Battle".
    await expect(page.locator('iframe[title="Pokemon Showdown Battle"]')).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(1);
  });
});

async function loginAs(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign\s*in/i }).click();
  await expect(page).toHaveURL(/\/(?:$|me|league|admin)/, { timeout: 10_000 });
}

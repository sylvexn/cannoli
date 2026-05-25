import { test, expect } from '@playwright/test';

/**
 * Minimal smoke suite — verifies the app boots and the league overview renders
 * the seeded S10 data. Intended as the floor for "is the dev environment alive";
 * deeper flow specs (draft, trades, profile colors, admin config) live in
 * sibling files.
 */
test.describe('Smoke', () => {
  test('home page loads with seeded leagues', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Sapphire/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Ruby/).first()).toBeVisible();
    await expect(page.getByText(/Emerald/).first()).toBeVisible();
  });

  test('login page is reachable', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel(/username/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test('health endpoint returns ok', async ({ request }) => {
    const res = await request.get('http://localhost:3001/health');
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

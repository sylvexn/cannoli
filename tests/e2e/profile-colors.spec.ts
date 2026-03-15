import { test, expect } from '@playwright/test';

/**
 * Verifies §2g player profile colors round-trip end-to-end:
 *   1. log in as syl
 *   2. open Settings → Profile Colors
 *   3. pick a primary swatch + save
 *   4. reload, confirm primary persists in /api/auth/me
 */
test.describe('Profile colors', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('user can save profile colors and they persist', async ({ page, request }) => {
    await page.goto('/login');
    await page.getByLabel(/username/i).fill('syl');
    await page.getByLabel(/password/i).fill('admin');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page).toHaveURL(/\/$|\/league|\/admin/, { timeout: 10_000 });

    await page.goto('/settings');
    await expect(page.getByText(/profile colors/i)).toBeVisible();

    // Pick the first non-transparent swatch under "Primary"
    const primaryRegion = page.locator('text=Primary').locator('..').locator('..');
    const firstSwatch = primaryRegion.locator('button').first();
    await firstSwatch.click();
    await page.getByRole('button', { name: /save colors/i }).click();
    await expect(page.getByText(/profile colors saved/i)).toBeVisible({ timeout: 5000 });

    // Verify via API
    const me = await request.get('http://localhost:3001/api/auth/me');
    const body = await me.json();
    expect(body.user?.primaryColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

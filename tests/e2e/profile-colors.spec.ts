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

  test('user can save profile colors and they persist', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/username/i).fill('syl');
    await page.getByLabel(/password/i).fill('admin');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 10_000 });

    await page.goto('/settings');
    await expect(page.getByText(/profile colors/i)).toBeVisible();

    // The Profile Colors card defaults to editing the "Primary" slot. The
    // swatch grid lives in the "Editing Primary" panel; each swatch is a
    // button with an aria-label "Set Primary to <hex>". Pick the first one.
    const firstSwatch = page.getByRole('button', { name: /^Set Primary to #/i }).first();
    await firstSwatch.click();

    // The Profile card has a single sticky "Save changes" button (covers
    // identity + colors). Click it and wait for the success toast.
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText(/profile saved/i)).toBeVisible({ timeout: 5000 });

    // Verify via API — use page.request so the authenticated session cookie
    // (and the same-origin Vite proxy) are reused.
    const me = await page.request.get('/api/auth/me');
    const body = await me.json();
    expect(body.user?.primaryColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

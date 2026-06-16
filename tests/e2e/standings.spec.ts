import { test, expect, type Page } from '@playwright/test';

/**
 * League Hub / Standings page — the default landing for any league and one of
 * the highest-traffic surfaces. A render crash here blanks the page the
 * moment a coach picks a league, so we assert the page-error-boundary never
 * fires and the load-bearing interactive bits work:
 *
 *   1. The standings table renders rows with a qualify-line marker.
 *   2. Expanding a row reveals the roster detail (sprites, K/D, point cap) —
 *      this is the "no separate teams page, browse via expandable rows"
 *      pattern, so the expand toggle is the only way to see a roster.
 *   3. Team names link to the team profile (entity cross-link convention).
 *
 * Sapphire is left in offseason by the seed (post-S10 import), so the page
 * also exercises the playoffs/standings view toggle.
 */
test.describe('League Hub — standings', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('renders, expands a roster row, and never trips the error boundary', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (t.includes('Base UI') || t.includes('production-error') || t.includes('Uncaught') || t.includes('PageErrorBoundary')) {
        errors.push(`console: ${t}`);
      }
    });

    // Guests can read the league hub, but log in so the "your row" identity
    // glow / isMe branch in StandingsRow is exercised too.
    await loginAs(page, 'syl', 'admin');
    await page.goto('/league/sapphire');

    // Title + standings card.
    await expect(page.getByRole('heading', { name: /league\s*hub/i })).toBeVisible({ timeout: 15_000 });
    const errorBoundary = page.getByText(/this page hit an unexpected error/i);
    await expect(errorBoundary).toHaveCount(0);

    // The qualify-line footer is rendered by the standings table specifically.
    await expect(page.getByText(/qualify for playoffs/i)).toBeVisible({ timeout: 10_000 });

    // Each standings row is a <button> (the expand toggle) whose accessible
    // name begins with the team's rank. Grab the rank-1 row and expand it.
    const rowButton = page.locator('main').getByRole('button', { name: /^\s*1\b/ }).first();
    await expect(rowButton).toBeVisible();

    // The roster detail is always mounted but height-clipped via a
    // grid-rows-[0fr]→[1fr] reveal (the project's always-mounted + CSS-transition
    // pattern), so the roster sprites sit in the DOM even while collapsed —
    // counting <img>s never changes on expand. Instead assert the row's rendered
    // height grows once the detail unclips.
    const row = rowButton.locator('xpath=..');
    const collapsedHeight = (await row.boundingBox())?.height ?? 0;
    await rowButton.click();
    await expect(async () => {
      const h = (await row.boundingBox())?.height ?? 0;
      expect(h).toBeGreaterThan(collapsedHeight);
    }).toPass({ timeout: 5_000 });

    expect(errors, 'no runtime errors on the standings page').toEqual([]);
  });

  test('team names link to the team profile page', async ({ page }) => {
    await page.goto('/league/sapphire');
    await expect(page.getByText(/qualify for playoffs/i)).toBeVisible({ timeout: 15_000 });

    // The first team-name link in the standings table should navigate to a
    // /league/sapphire/teams/:id route.
    const teamLink = page.locator('a[href*="/teams/"]').first();
    await expect(teamLink).toBeVisible({ timeout: 10_000 });
    await teamLink.click();
    await expect(page).toHaveURL(/\/league\/sapphire\/teams\//, { timeout: 10_000 });
  });
});

async function loginAs(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign\s*in/i }).click();
  await expect(page).toHaveURL(/\/(?:$|me|league|admin)/, { timeout: 10_000 });
}

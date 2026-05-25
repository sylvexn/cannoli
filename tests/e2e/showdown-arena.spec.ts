import { test, expect, type Page } from '@playwright/test';

/**
 * Showdown / Arena surface.
 *
 * The full Battle HUD (live K/D stats + scouting panels) only mounts when the
 * arena WS reports an active battle the user is viewing — that path needs the
 * PS fork running and a real |win|/|tie| stream, which is the Showdown
 * integration suite's job, not this one. What we CAN cover deterministically:
 *
 *   - /showdown is a top-level route OUTSIDE the AppShell's page-error-boundary
 *     wrapper... actually it's inside the AppShell <Outlet>, so a render crash
 *     here is caught — we assert it mounts cleanly with the PS iframe + the
 *     collapsible Arena footer, and that no Base UI/React error fires.
 *
 * See the fixme below for the BattleHud render bug this suite would otherwise
 * catch (LAUNCH-BUG: hud-glyph).
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
   * LAUNCH-BUG: hud-glyph — battle-hud.tsx lines 208/210 render the literal
   * strings "☠" and "●" as JSX text children instead of the skull /
   * status-dot glyphs they were meant to be (a `\u` escape only decodes inside
   * a JS string literal, not as raw JSX text). The fainted/alive indicator in
   * the Live Stats panel therefore shows the seven characters "☠" rather
   * than a skull. Also violates the no-emoji/use-lucide-icons convention.
   *
   * Skipped because reaching the Battle HUD requires a live PS battle stream
   * (PS fork + |win| capture) that this suite doesn't stand up. Re-enable once
   * the arena fixture can inject a viewingBattle + liveStats, or cover via a
   * component render test (see component-harness note in findings). Proposed
   * fix: replace the two <span>\uXXXX</span> children with the actual glyph in
   * a JS expression ({'☠'}) or, preferably, a lucide-react Skull / Circle
   * icon to honour the no-emoji rule.
   */
  test.fixme('battle HUD renders the fainted glyph, not the literal escape', async () => {
    // Intentionally empty — see LAUNCH-BUG: hud-glyph above.
  });
});

async function loginAs(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign\s*in/i }).click();
  await expect(page).toHaveURL(/\/(?:$|me|league|admin)/, { timeout: 10_000 });
}

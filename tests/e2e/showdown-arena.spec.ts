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
   * hud-glyph (FIXED) — battle-hud.tsx used to render literal "☠"/"●" glyphs
   * as JSX text children (violating the no-emoji / use-lucide rule). They are
   * now lucide-react Skull / Circle icons.
   *
   * Reaching the live Battle HUD in e2e requires a real PS battle stream
   * (PS fork + |win| capture) that this suite intentionally does NOT stand up,
   * and there's no component-render harness in the e2e project. So rather than
   * deleting the coverage, we assert at the source level that the HUD imports
   * and renders the lucide icons (and no longer contains the raw glyphs) — a
   * regression guard for the no-emoji convention. Promote to a live-HUD
   * assertion if/when the arena fixture can inject viewingBattle + liveStats.
   */
  test('battle HUD uses lucide Skull/Circle icons, not literal glyphs', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/src/pages/showdown/battle-hud.tsx'),
      'utf8',
    );
    // No raw skull/dot glyphs left in the source.
    expect(src.includes('☠'), 'no literal skull glyph in battle-hud').toBe(false);
    expect(src.includes('●'), 'no literal status-dot glyph in battle-hud').toBe(false);
    // lucide icons imported and rendered for the fainted/alive indicator.
    expect(/import\s+\{[^}]*\bSkull\b[^}]*\bCircle\b[^}]*\}\s+from\s+['"]lucide-react['"]/.test(src)
      || (/\bSkull\b/.test(src) && /\bCircle\b/.test(src) && src.includes("from 'lucide-react'")))
      .toBe(true);
    expect(/<Skull\b/.test(src), 'renders <Skull> for fainted').toBe(true);
    expect(/<Circle\b/.test(src), 'renders <Circle> for alive').toBe(true);
  });
});

async function loginAs(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign\s*in/i }).click();
  await expect(page).toHaveURL(/\/(?:$|me|league|admin)/, { timeout: 10_000 });
}

import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Practice-draft smoke at /league/sapphire/draft/practice.
 *
 * Exercises the surfaces that have caught real bugs (Base UI #31 in the
 * top-bar dropdowns, the team picker / filter Selects, the quick-draft
 * popover flow) without committing to running the entire 120-pick snake.
 *
 * What we drive:
 *   1. Login → /league/sapphire/draft/practice.
 *   2. Configuring panel: select a team via the combobox, drop the timer
 *      to 10s, click Start Draft.
 *   3. Run until ≥ 20 picks have landed. AI teams auto-pick on their own;
 *      we only nudge the user's slot along by clicking a free-agent card,
 *      then the "Draft" button that surfaces in the quick-draft popover.
 *   4. Assert no Base UI / React errors fired and the page-level error
 *      boundary never rendered.
 *
 * Why 20 picks: it's enough to traverse multiple AI cycles plus 1–2 user
 * turns and the captain-reserve / mega-cap conflict paths the popover relies
 * on. A literal-completion test is uneconomical here — see scope discussion
 * in the task notes.
 */
test.describe('Practice draft simulator', () => {
  test.setTimeout(180_000);
  test.use({ storageState: { cookies: [], origins: [] } });

  test('draft starts and 20+ picks land without Base UI errors', async ({ page }) => {
    const captured: { type: 'console' | 'pageerror'; message: string }[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (
        text.includes('Base UI') ||
        text.includes('production-error') ||
        text.includes('PageErrorBoundary') ||
        text.includes('Uncaught') ||
        text.includes('The above error')
      ) {
        captured.push({ type: 'console', message: text });
      }
    });
    page.on('pageerror', (err) => {
      captured.push({ type: 'pageerror', message: `${err.name}: ${err.message}` });
    });

    await loginAs(page, 'syl', 'admin');
    await page.goto('/league/sapphire/draft/practice');

    // Configuring panel: team picker + Start button. The team picker is the
    // combobox showing literal text "none" before any team is chosen — Base
    // UI renders the raw `value` since the Select is initialized to 'none'
    // rather than left undefined. Filter-bar selects on the same page render
    // "all" / "tier-desc", so this filter is unambiguous.
    const teamPicker = page.getByRole('combobox').filter({ hasText: 'none' }).first();
    await expect(teamPicker).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/this page hit an unexpected error/i)).toHaveCount(0);

    await teamPicker.click();
    const firstTeamOption = page.getByRole('option').first();
    await expect(firstTeamOption).toBeVisible({ timeout: 5_000 });
    await firstTeamOption.click();

    // Drop the per-pick timer to its minimum (10s). The NumberInput is a
    // controlled <input type="text"> — fill() drives the React onChange.
    const timerInput = page.locator('input[inputmode="numeric"]').first();
    if (await timerInput.count() > 0) {
      await timerInput.fill('10');
      await timerInput.blur().catch(() => {});
    }

    await page.getByRole('button', { name: /^start draft$/i }).click();
    await page.waitForSelector('[data-pokemon]', { timeout: 15_000 });

    const errorBoundary = page.getByText(/this page hit an unexpected error/i);
    const yourPickBadge = page.getByText(/your pick/i).first();

    // Pick progress comes from the on-the-clock header: "R{round} · P{pick} ·
    // pick #{overallPick}/{total}". When the next-up overall is ≥ 20 we know
    // 19 have already landed (the index points at the pending slot).
    const pickHeader = page.getByText(/pick #\d+\/\d+/i).first();
    const readPickIndex = async (): Promise<number> => {
      const text = await pickHeader.textContent().catch(() => '');
      const m = text?.match(/pick #(\d+)\//);
      return m ? Number(m[1]) : 0;
    };

    const TARGET_PICKS = 20;
    const deadline = Date.now() + 150_000;

    while (Date.now() < deadline) {
      if (await errorBoundary.isVisible().catch(() => false)) break;
      if (captured.length > 0) break;

      const nextPickIndex = await readPickIndex();
      if (nextPickIndex > TARGET_PICKS) break;

      // If it's the user's turn, drive the quick-draft popover. Otherwise
      // just wait — the simulator AI handles non-user slots itself.
      const userTurn = await yourPickBadge.isVisible().catch(() => false);
      if (userTurn) {
        // Free agents are the cards without aria-disabled (mega-cap / dup
        // species / unaffordable) and without data-conflict. Owned cards
        // can sneak through this filter, but a click on an owned card just
        // opens its detail sheet (handleCardClick falls back to SET_DETAIL),
        // which we ignore — the next loop iteration finds another card.
        const pickable = page.locator(
          '[data-pokemon]:not([aria-disabled="true"]):not([data-conflict])'
        );
        if (await pickable.count() > 0) {
          await pickable.first().click({ timeout: 1_000, force: true }).catch(() => {});
          // Popover renders a Button labeled "Draft" (or "Blocked" for an
          // illegal pick — we swallow that and try the next card next loop).
          const draftBtn = page.getByRole('button', { name: /^draft$/i });
          await draftBtn.first().click({ timeout: 2_000 }).catch(() => {});
          await page.waitForTimeout(300);
          continue;
        }
      }
      await page.waitForTimeout(300);
    }

    if (captured.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[draft-practice] captured runtime errors:', captured);
    }
    expect(captured, 'no runtime errors during draft').toEqual([]);
    await expect(errorBoundary).toHaveCount(0);

    const reached = await readPickIndex();
    expect(reached, `expected next pick index > ${TARGET_PICKS} (i.e. ≥ ${TARGET_PICKS} picks landed)`).toBeGreaterThan(TARGET_PICKS);
  });

  /**
   * Targeted regression for Base UI #31 — the kebab dropdown in the draft
   * top-bar previously rendered DropdownMenuLabel directly under
   * DropdownMenuContent without a DropdownMenuGroup wrapper, which crashes
   * Base UI's Menu group context. Opening the menu must not error.
   */
  test('top-bar kebab opens without Base UI errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await loginAs(page, 'syl', 'admin');
    await page.goto('/league/sapphire/draft/practice');

    const kebab = page.getByRole('button', { name: /more draft options/i });
    await expect(kebab).toBeVisible({ timeout: 10_000 });
    await kebab.click();
    await expect(page.getByRole('menuitem', { name: /rules/i })).toBeVisible();
    await page.keyboard.press('Escape');

    // Density menu — same DropdownMenuLabel issue, second call site.
    const density = page.getByRole('button', { name: /card density/i });
    if (await density.count() > 0) {
      await density.first().click();
      await expect(
        page.getByRole('menuitem', { name: /comfortable|compact|detailed/i }).first(),
      ).toBeVisible();
      await page.keyboard.press('Escape');
    }

    expect(
      errors.filter((e) => e.includes('Base UI') || e.includes('production-error')),
    ).toEqual([]);
  });
});

async function loginAs(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign\s*in/i }).click();
  await expect(page).toHaveURL(/\/(?:$|me|league|admin)/, { timeout: 10_000 });
}

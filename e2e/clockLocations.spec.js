import { expect, test } from "@playwright/test";

import { ACCOUNTS, signIn, tag } from "./helpers";

/**
 * The clock-in locations screen.
 *
 * This exists because of a bug that no unit test could have caught and that
 * looked, from the outside, like "adding a location does nothing".
 *
 * `useFetchSelectQuery` calls its fetchFn as `fetchFn(signal)` — the query's
 * AbortSignal. Passed to a server action that destructures an options object
 * out of its first argument, reading any property off it throws *on the
 * server*:
 *
 *   Cannot access includeArchived on the server. You cannot dot into a
 *   temporary client reference from a server component.
 *
 * The action itself was fine; calling it directly worked. What broke was the
 * query feeding the card, so the card never left its loading state and the add
 * form was never rendered at all. Nothing appeared in the browser console
 * beyond a 500.
 *
 * So the assertion that matters is the plain one: the form is on the screen and
 * using it adds a row. A test of the server action alone would still pass today
 * with this bug fully restored.
 */

const SETTINGS = "/admin/leaveManagement/settings";

test.describe("clock-in locations", () => {
  test("a super admin can add, rename and archive an office", async ({
    page,
  }) => {
    const serverErrors = [];
    page.on("pageerror", (e) => serverErrors.push(e.message));

    await signIn(page, ACCOUNTS.acmeSuper);
    await page.goto(SETTINGS);

    // The card renders its form, rather than spinning for ever on a failed
    // query — which is exactly what the bug looked like.
    const nameInput = page.locator("#newLocation");
    await expect(nameInput).toBeVisible({ timeout: 30_000 });

    const name = `Northgate ${tag()}`;
    await nameInput.fill(name);
    await page.getByRole("button", { name: "Add" }).click();

    const row = page.locator("tr").filter({ hasText: name });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText("Office");

    // Rename.
    const renamed = `${name} renamed`;
    await row.getByRole("button", { name: "Rename" }).click();
    const editor = page.locator("tr input").first();
    await editor.fill(renamed);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("tr").filter({ hasText: renamed })).toBeVisible({
      timeout: 20_000,
    });

    // Archive — the row leaves the list, and the history behind it is kept.
    await page
      .locator("tr")
      .filter({ hasText: renamed })
      .getByRole("button")
      .last()
      .click();
    await expect(page.locator("tr").filter({ hasText: renamed })).toHaveCount(
      0,
      { timeout: 20_000 },
    );

    expect(serverErrors, "the page threw").toEqual([]);
  });

  test("two locations cannot share a name", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeSuper);
    await page.goto(SETTINGS);

    const nameInput = page.locator("#newLocation");
    await expect(nameInput).toBeVisible({ timeout: 30_000 });

    const name = `Dockside ${tag()}`;
    await nameInput.fill(name);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.locator("tr").filter({ hasText: name })).toBeVisible({
      timeout: 20_000,
    });

    // Same name again: refused, and said so rather than failing silently.
    await nameInput.fill(name);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText(/location with that name exists/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator("tr").filter({ hasText: name })).toHaveCount(1);
  });
});

import { expect, test } from "@playwright/test";

import { ACCOUNTS, signIn } from "./helpers";

/**
 * The clock in/out lifecycle, through the admin attendance screen.
 *
 * This walks the one path a person actually takes end to end — clock in, take
 * a break, come back, clock out — and asserts the row's status after each step.
 * It is the counterpart to the node suites: those prove the rules and the
 * writes in isolation, this proves the screen is wired to them.
 *
 * The QR scanner itself is not covered here and cannot easily be: it needs a
 * camera and a code displayed on a second device. scripts/test-clock-tokens.mjs
 * covers what that flow actually turns on — that a code is single-use, tied to
 * its site, and useless to another company.
 *
 * Runs against the fixture database, never the real one — see
 * playwright.config.js.
 */

/**
 * Pick one employee to drive, and keep every assertion inside their row.
 *
 * The table lists the whole office, so "is there a Clock in button" is always
 * true somewhere on the page — it says nothing about the person being acted
 * on. Everything below is scoped to a single row for that reason.
 */
async function pickEmployee(page) {
  const button = page.getByRole("button", { name: "Clock in" }).first();
  await expect(button).toBeVisible({ timeout: 20_000 });

  const row = button.locator("xpath=ancestor::tr[1]");
  // The name cell, used to re-find this row after each re-render.
  const name = (await row.locator("td").nth(0).innerText()).trim().split("\n")[0];
  expect(name.length).toBeGreaterThan(0);
  return name;
}

const rowFor = (page, name) =>
  page.locator("tr").filter({ hasText: name }).first();

/** Click a quick action within one row and confirm it. */
async function quickAction(page, name, label, confirmText) {
  await rowFor(page, name).getByRole("button", { name: label }).click();

  // "alertdialog", not "dialog": the confirmation is a Radix AlertDialog, and
  // the two roles are distinct.
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: confirmText, exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

/** Wait for one row to settle on a status badge. */
async function expectStatus(page, name, status) {
  await expect(rowFor(page, name)).toContainText(status, { timeout: 20_000 });
}

test.describe("clock in and out", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeSuper);
    await page.goto("/admin/attendance");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 30_000 });
  });

  test("an employee can be clocked in, take a break, and clock out", async ({
    page,
  }) => {
    const name = await pickEmployee(page);

    await quickAction(page, name, "Clock in", "Clock In");
    await expectStatus(page, name, "Checked In");

    // You cannot clock in twice: the button is gone from this row.
    await expect(
      rowFor(page, name).getByRole("button", { name: "Clock in" }),
    ).toHaveCount(0);

    await quickAction(page, name, "Start break", "Start Break");
    await expectStatus(page, name, "On Break");

    // While on a break the only way forward is to end it — no clock-out is
    // offered, because the record is not in a state that allows one.
    await expect(
      rowFor(page, name).getByRole("button", { name: "Clock out" }),
    ).toHaveCount(0);

    await quickAction(page, name, "End break", "End Break");
    await expectStatus(page, name, "Checked In");

    await quickAction(page, name, "Clock out", "Clock Out");
    await expectStatus(page, name, "Completed");

    // A finished shift offers nothing further.
    const row = rowFor(page, name);
    await expect(row.getByRole("button", { name: "Clock out" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Start break" })).toHaveCount(0);
  });

});

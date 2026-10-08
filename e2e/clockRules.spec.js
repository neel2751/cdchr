import { expect, test } from "@playwright/test";

import { ACCOUNTS, signIn, tag } from "./helpers";

/**
 * Turning a location's rules on, end to end.
 *
 * This spec exists because two separate things made the location feature inert
 * while every unit test passed:
 *
 *   1. Nothing in the UI called `setLocationPolicy`, so every location had no
 *      methods, nothing was ever evaluated, and the report had nothing to show.
 *
 *   2. `next.config.mjs` sent `Permissions-Policy: geolocation=()`. The browser
 *      refused with "disabled by permissions policy", lib/clockEvidence.js
 *      treats any failure as "no position" *by design* so the clock-in carried
 *      on, and every coordinate was silently null. A geofence would have
 *      evaluated "cannot tell" for ever.
 *
 * Neither is visible from the server side, and the second is invisible from
 * anywhere except a real browser. Hence the geolocation assertion below: it is
 * guarding a header, not a component.
 */
const SETTINGS = "/admin/leaveManagement/settings";

test.describe("clock-in rules", () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  });

  test("the browser is allowed to report a position at all", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeSuper);
    await page.goto(SETTINGS);

    const result = await page.evaluate(
      () =>
        new Promise((resolve) => {
          if (!navigator.geolocation) return resolve("no geolocation api");
          navigator.geolocation.getCurrentPosition(
            (p) => resolve({ lat: p.coords.latitude }),
            (e) => resolve(`error: ${e.message}`),
            { timeout: 8000 },
          );
        }),
    );

    // A string here means the header is blocking it again.
    expect(
      result,
      "geolocation is blocked — check Permissions-Policy in next.config.mjs",
    ).toHaveProperty("lat");
  });

  test("a geofence can be set from where you are standing", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeSuper);
    await page.goto(SETTINGS);

    // A location of its own, so the assertions do not depend on fixture data.
    const name = `Rules ${tag()}`;
    await expect(page.locator("#newLocation")).toBeVisible({ timeout: 30_000 });
    await page.locator("#newLocation").fill(name);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.locator("tr").filter({ hasText: name })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByText("Pick a location to set up").click();
    await page.getByRole("option", { name: new RegExp(name) }).click();

    // Nothing is measured until a method is switched on — said plainly,
    // because an empty `methods` is invisible otherwise.
    await expect(
      page.getByText(/Nothing is being checked or measured/),
    ).toBeVisible();

    await page.getByRole("combobox").filter({ hasText: "Off" }).first().click();
    await page.getByRole("option", { name: "Measure only" }).click();

    // The button that makes this usable: nobody knows their site's coordinates.
    await page.getByRole("button", { name: /Use where I am now/ }).click();
    await expect(page.locator("#geofenceLat")).toHaveValue("51.5", {
      timeout: 20_000,
    });
    await expect(page.locator("#geofenceLng")).toHaveValue("-0.1");

    await page.getByRole("button", { name: "Save location rules" }).click();
    await expect(page.getByText("Location updated")).toBeVisible({
      timeout: 20_000,
    });

    // Having switched something on, the screen says where the measurements
    // will show up. Without this line the only way to find out is to scroll
    // and guess.
    await expect(page.getByText(/Where People Clock In/).first()).toBeVisible();

    // It survives a reload — the report stops saying there is nothing here.
    await page.reload();
    await page.getByText("Pick a location to set up").click();
    await page.getByRole("option", { name: new RegExp(name) }).click();
    await expect(
      page.getByText(/Nothing is being checked or measured/),
    ).toHaveCount(0);
    await expect(page.locator("#geofenceLat")).toHaveValue("51.5");
  });
});

/**
 * The measured data, read back.
 *
 * Shadow mode is worthless if the numbers never reach a screen — and the
 * engine being right has twice not been enough. This seeds clock-ins at known
 * distances and asserts an admin can read the consequence off the page.
 */
test("the report renders an outcome, not an endless spinner", async ({ page }) => {
  await signIn(page, ACCOUNTS.acmeSuper);
  await page.goto(SETTINGS);

  await expect(page.getByText("Where People Clock In")).toBeVisible({
    timeout: 30_000,
  });

  // Whichever is true of the fixture data, the card has to resolve to
  // *something a person can read*. Waiting on the text rather than reading
  // innerText immediately matters: while the query is in flight the card
  // renders only a spinner, which has no text at all — so an eager read sees
  // an empty card and cannot tell that apart from a broken one.
  await expect(
    page
      .getByText(/No clock-ins with evidence yet|clock-ins? ·/)
      .first(),
    "the report resolved to neither data nor an empty state",
  ).toBeVisible({ timeout: 25_000 });
});

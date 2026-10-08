import { expect, test } from "@playwright/test";

import { ACCOUNTS, signIn } from "./helpers";

/**
 * Ordering tags, and turning that order into hardware.
 *
 * Two screens that never meet: a customer places an order in their own
 * company's settings, and provider staff work it in the platform console. The
 * seam between them is the thing worth testing end to end — a server test of
 * either half would pass with the other half unreachable, which has happened
 * three times already in this work.
 *
 * The assertion that matters most is the negative one: **no key material ever
 * reaches the customer's screen.** Keys are generated during fulfilment and
 * never leave the server; a key a customer can read is a key they can leak.
 */
const SETTINGS = "/admin/leaveManagement/settings";

test.describe("tag ordering", () => {
  test("a customer orders tags, and never sees a key", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeSuper);
    await page.goto(SETTINGS);

    await expect(page.getByText("Order Tags")).toBeVisible({ timeout: 30_000 });

    // The most valuable field on the form. NFC does not work on bare metal and
    // site cabins are steel, so ordering plain discs for them buys things that
    // do not work — and it gets reported as a software bug.
    await expect(page.locator("#onMetal")).toBeVisible();

    await page.getByText("Choose a tag").click();
    await page.getByRole("option").first().click();
    await page.locator("#tagQuantity").fill("10");
    await page.locator("#tagAddress").fill("1 Elm Street");
    await page.getByRole("button", { name: "Place order" }).click();

    await expect(page.getByText("Your orders")).toBeVisible({ timeout: 20_000 });
    const body = await page.locator("body").innerText();
    expect(body).toMatch(/TAG-[\w-]+/);

    // Nothing about keys, ever.
    expect(body).not.toMatch(/keyRef|TAG_KEY|[0-9A-F]{32}/);
  });

  test("a minimum order quantity is enforced", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeSuper);
    await page.goto(SETTINGS);
    await expect(page.getByText("Order Tags")).toBeVisible({ timeout: 30_000 });

    await page.getByText("Choose a tag").click();
    await page.getByRole("option").first().click();
    await page.locator("#tagQuantity").fill("1");
    await page.locator("#tagAddress").fill("1 Elm Street");
    await page.getByRole("button", { name: "Place order" }).click();

    await expect(page.getByText(/minimum order/i)).toBeVisible({
      timeout: 20_000,
    });
  });

  test("provider staff accept an order and get one key at a time", async ({
    page,
  }) => {
    // Place one first — the queue is only interesting with something in it.
    await signIn(page, ACCOUNTS.acmeSuper);
    await page.goto(SETTINGS);
    await expect(page.getByText("Order Tags")).toBeVisible({ timeout: 30_000 });
    await page.getByText("Choose a tag").click();
    await page.getByRole("option").first().click();
    await page.locator("#tagQuantity").fill("10");
    await page.locator("#tagAddress").fill("1 Elm Street");
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page.getByText("Your orders")).toBeVisible({ timeout: 20_000 });

    const orderNumber = (await page.locator("body").innerText()).match(
      /TAG-[\w-]+/,
    )?.[0];
    expect(orderNumber, "no order number was shown").toBeTruthy();

    // Now the provider side.
    await page.context().clearCookies();
    await signIn(page, ACCOUNTS.platformOps);
    await page.goto("/platform/tags");

    const row = page.getByText(orderNumber).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await page.getByRole("button", { name: /Accept/ }).click();
    // Ten units ordered, ten keys sealed — one per tag, never shared, so
    // losing one sticker is a one-tag problem.
    await expect(page.getByRole("button", { name: "Get key" })).toHaveCount(10, {
      timeout: 20_000,
    });

    await page.getByRole("button", { name: "Get key" }).first().click();

    // The one screen in the product that shows a live key — one, and only
    // until its chip is written.
    await expect(page.getByText(/Key for unit 0/)).toBeVisible({
      timeout: 20_000,
    });
    const shown = await page.locator("code").first().innerText();
    expect(shown, "that is not a 16-byte AES key").toMatch(/^[0-9A-F]{32}$/);
  });
});

/**
 * Maintaining the catalogue.
 *
 * It used to live only in a seed script — a catalogue somebody has to remember
 * to edit and re-run is a catalogue that goes stale.
 */
test.describe("tag catalogue", () => {
  test("provider staff can change a price", async ({ page }) => {
    await signIn(page, ACCOUNTS.platformOps);
    await page.goto("/platform/catalogue");

    await expect(page.getByRole("heading", { name: "Tag Catalogue" })).toBeVisible({
      timeout: 30_000,
    });
    // Seeded by scripts/seed-tag-catalogue.mjs.
    await expect(page.getByText("RND-30-213").first()).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).first().click();
    // The SKU is fixed once a product exists: orders reference it.
    await expect(page.locator("#sku")).toBeDisabled();

    const price = (1 + Math.random() * 8).toFixed(2);
    await page.locator("#price").fill(price);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Product updated")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(new RegExp(price.replace(".", "\\.")))).toBeVisible({
      timeout: 20_000,
    });
  });

  test("a customer cannot reach the catalogue editor", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeSuper);
    await page.goto("/platform/catalogue");
    await expect(page).toHaveURL(/unauthorized|\/admin/, { timeout: 30_000 });
  });
});

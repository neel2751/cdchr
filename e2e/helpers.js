import { expect } from "@playwright/test";
import { authenticator } from "otplib";

import {
  FIXTURE_PASSWORD,
  TOTP_SECRET,
} from "../scripts/lib/fixture-secrets.mjs";

export const PASSWORD = FIXTURE_PASSWORD;

export const ACCOUNTS = {
  acmeAdmin: { email: "admin@acme.test", role: "admin" },
  acmeSuper: { email: "super@acme.test", role: "superAdmin" },
  acmeUser: { email: "user@acme.test", role: "user" },
};

/**
 * Sign in and clear the two-factor challenge.
 *
 * Every admin and super admin in this app is forced through 2FA (auth.js), so
 * there is no such thing as a one-step login for the accounts that can use
 * expenses. Rather than weaken that gate for tests, the fixtures enable 2FA with
 * a known secret and this generates a real code — the same path a person walks.
 */
export async function signIn(page, account) {
  await page.goto("/auth");

  // By id, not by label: the password field shares its accessible name with the
  // "Show password" toggle beside it, so getByLabel matches two elements.
  // GlobalForm derives the id from the field name.
  await page.locator("#email").fill(account.email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Privileged accounts land on /verify; everyone else goes straight through.
  await page.waitForURL(/\/(verify|admin|employee|hr|unauthorized)/, {
    timeout: 45_000,
  });

  if (page.url().includes("/verify")) {
    await enterTotp(page);
  }
}

/** Type a current TOTP code into the six-slot OTP input. */
async function enterTotp(page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // input-otp renders one hidden text input that owns the whole value; typing
  // into it drives every slot, and `onComplete` fires on the sixth digit.
  const field = dialog.locator("input").first();
  await field.click();
  await field.fill(authenticator.generate(TOTP_SECRET));

  await page.waitForURL(/\/(admin|employee|hr)/, { timeout: 45_000 });
}

/** A value unique to this run, so reruns never collide on the duplicate check. */
export const tag = () => Math.random().toString(36).slice(2, 7);

/**
 * Choose a value from one of GlobalForm's Radix selects.
 *
 * Addressed by id rather than label: the trigger's accessible name is its
 * placeholder ("Select an option"), not the visible label beside it, so
 * getByLabel cannot reach it. GlobalForm sets the id from the field name.
 *
 * @param {string} fieldName the form field's `name`
 * @param {RegExp|string} [option] which option; the first one if omitted
 */
export async function selectOption(page, dialog, fieldName, option) {
  await dialog.locator(`#${fieldName}`).click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  if (option) {
    await listbox.getByRole("option", { name: option }).click();
  } else {
    await listbox.getByRole("option").first().click();
  }
  await expect(listbox).toBeHidden();
}

/**
 * Pick a day from one of GlobalForm's date pickers.
 *
 * react-day-picker puts a button inside each gridcell, and the *cell* has no
 * accessible name — the button does, as a full date ("Saturday, August 15th,
 * 2026"). Matching the button's text content is what actually identifies a day.
 */
export async function pickDate(page, dialog, fieldName, day = "15") {
  await dialog.locator(`#${fieldName}`).click();

  const grid = page.getByRole("grid");
  await expect(grid).toBeVisible();
  await grid
    .getByRole("button", { name: new RegExp(`\\b${day}(st|nd|rd|th),`) })
    .first()
    .click();

  await page.keyboard.press("Escape");
}

/** The row in the expense table whose title cell matches exactly. */
export function expenseRow(page, title) {
  return page.locator("tr", { has: page.getByRole("cell", { name: title, exact: true }) });
}

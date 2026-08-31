import { test, expect } from "@playwright/test";

import {
  ACCOUNTS,
  signIn,
  tag,
  expenseRow,
  selectOption,
  pickDate,
} from "./helpers.js";

/**
 * The expense feature, driven through a browser.
 *
 * Everything below the UI is covered by scripts/test-expense.mjs, which calls
 * the server actions directly. This exists for the half that cannot reach:
 * whether the page actually renders, whether the buttons are wired to the
 * actions, and whether the table's columns line up — the off-by-one that
 * prompted this suite built and linted cleanly for months.
 *
 * See playwright.config.js: this runs against its own server on 3100 and a
 * local fixture database, never the one `.env` points at.
 */

const RUN = tag();
const CATEGORY = `E2E Materials ${RUN}`;

test.describe("expenses", () => {
  test.describe.configure({ mode: "serial" });

  test("an admin can reach the expenses page", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeAdmin);
    await page.goto("/admin/expense");

    // CardTitle renders a div, not a heading, so these are text matches.
    await expect(page.getByText("All Expense Categories")).toBeVisible();
    await expect(page.getByText("All Expenses", { exact: true })).toBeVisible();
  });

  test("an admin can create an expense category", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeAdmin);
    await page.goto("/admin/expense");

    await page.getByRole("button", { name: /add expense category/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.locator("#name").fill(CATEGORY);
    await dialog.locator("#budget").fill("5000");
    // No company step: the server takes it from the session.
    await expect(dialog.locator("#companyId")).toHaveCount(0);

    await dialog.getByRole("button", { name: /add expense/i }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole("cell", { name: CATEGORY })).toBeVisible();
  });

  test("an admin can file an expense, and it starts pending", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeAdmin);
    await page.goto("/admin/expense");

    const title = `E2E Cement ${RUN}`;
    await fileExpense(page, title, "250");

    const row = expenseRow(page, title);
    await expect(row).toBeVisible();
    await expect(row.getByText("pending")).toBeVisible();
  });

  test("the expense table's headers and cells line up", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeAdmin);
    await page.goto("/admin/expense");

    // The regression this suite was written for: nine headers over ten cells,
    // which silently mislabelled every column from Status rightward. Runs after
    // an expense exists — with none, the only row is the empty-state colspan.
    const table = page
      .locator("table")
      .filter({ has: page.getByRole("columnheader", { name: "Receipts" }) });
    await expect(table).toBeVisible();

    const headers = await table.locator("thead th").count();
    expect(headers).toBe(8);
    // The company is fixed by who you are signed in as, so it is not a column.
    await expect(
      table.getByRole("columnheader", { name: "Company" })
    ).toHaveCount(0);

    // A specific data row, not `tbody tr` first — the loading and empty states
    // are single colspan cells and would satisfy a naive "a row exists".
    const row = expenseRow(page, `E2E Cement ${RUN}`);
    await expect(row).toBeVisible();
    expect(await row.locator("td").count()).toBe(headers);

    // Status belongs under Status, not under Receipts. Checked positionally
    // because that is exactly what the off-by-one got wrong.
    const statusIndex = (
      await table.locator("thead th").allTextContents()
    ).findIndex((h) => h.trim() === "Status");
    await expect(row.locator("td").nth(statusIndex)).toContainText(
      /pending|approved|rejected/
    );
  });

  test("an admin can edit an expense", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeAdmin);
    await page.goto("/admin/expense");

    const title = `E2E Editable ${RUN}`;
    await fileExpense(page, title, "100");

    // Clicking Edit used to be an uncaught TypeError: the handler was never
    // passed down from either caller.
    await expenseRow(page, title).getByTitle("Edit").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/edit expense/i)).toBeVisible();
    await dialog.locator("#amount").fill("275");
    await dialog.getByRole("button", { name: /save changes/i }).click();

    await expect(dialog).toBeHidden();
    await expect(expenseRow(page, title).getByText("£275.00")).toBeVisible();
  });

  test("a super admin can approve someone else's expense", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeAdmin);
    await page.goto("/admin/expense");

    const title = `E2E Approvable ${RUN}`;
    await fileExpense(page, title, "60");
    await expect(expenseRow(page, title).getByText("pending")).toBeVisible();

    await page.context().clearCookies();
    await signIn(page, ACCOUNTS.acmeSuper);
    await page.goto("/admin/expense");

    await expenseRow(page, title).getByTitle("Approve").click();
    await expect(expenseRow(page, title).getByText("approved")).toBeVisible();
  });

  test("nobody can approve their own expense", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeAdmin);
    await page.goto("/admin/expense");

    const title = `E2E SelfApprove ${RUN}`;
    await fileExpense(page, title, "45");

    await expenseRow(page, title).getByTitle("Approve").click();

    await expect(page.getByText(/cannot approve or reject an expense you filed/i))
      .toBeVisible();
    await expect(expenseRow(page, title).getByText("pending")).toBeVisible();
  });

  test("an admin can delete an expense", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeAdmin);
    await page.goto("/admin/expense");

    const title = `E2E Doomed ${RUN}`;
    await fileExpense(page, title, "30");
    await expect(expenseRow(page, title)).toBeVisible();

    await expenseRow(page, title).getByTitle("Delete").click();
    await expect(expenseRow(page, title)).toHaveCount(0);
  });

  test("the invoice carries this company's branding, not the original client's", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.acmeAdmin);
    await page.goto("/admin/expense");

    const title = `E2E Invoice ${RUN}`;
    await fileExpense(page, title, "120");
    await expenseRow(page, title).getByTitle("View invoice").click();

    const invoice = page.locator(".print-target");
    await expect(invoice).toBeVisible();
    await expect(invoice.getByText(title)).toBeVisible();
    await expect(invoice.getByText("£120.00").first()).toBeVisible();

    // The literals this screen used to be hard-coded to.
    await expect(invoice).not.toContainText("Creative Design");
    await expect(invoice).not.toContainText("cdc.construction");
    await expect(invoice).not.toContainText("020-8004-3327");
    await expect(invoice.locator('img[src*="cloudinary"]')).toHaveCount(0);
  });

  test("printing an invoice prints only the invoice", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeAdmin);
    await page.goto("/admin/expense");

    const title = `E2E Printable ${RUN}`;
    await fileExpense(page, title, "80");
    await expenseRow(page, title).getByTitle("View invoice").click();
    await expect(page.locator(".print-target")).toBeVisible();

    // window.print() opens a native dialog no automation can assert against,
    // but the stylesheet that decides what lands on the page can be emulated.
    await page.emulateMedia({ media: "print" });

    const layout = await page.evaluate(() => {
      const target = document.querySelector(".print-target");
      const box = target.getBoundingClientRect();
      return {
        documentHeight: document.documentElement.scrollHeight,
        top: box.top,
        height: box.height,
        // Anything still taking up space that is not the invoice becomes a
        // blank sheet of paper.
        otherBodyChildren: [...document.body.children]
          .filter((el) => !el.classList.contains("print-root"))
          .map((el) => el.getBoundingClientRect().height)
          .filter((h) => h > 0),
      };
    });

    // Checked as geometry, not just visibility: the first version of this rule
    // used `visibility: hidden`, which passed a visibility assertion while
    // still reserving 1660px of blank page and pushing the invoice to -675px.
    expect(layout.otherBodyChildren).toEqual([]);
    expect(layout.top).toBeGreaterThanOrEqual(0);
    expect(layout.height).toBeGreaterThan(0);
    // One sheet of paper. A4 at 96dpi is ~1123px, so anything under that cannot
    // spill onto a second page — which is what the old rule did, four times
    // over, because hidden content still occupied 1660px.
    expect(layout.documentHeight).toBeLessThan(1123);

    await page.emulateMedia({ media: null });
  });

  test("the site and category filters narrow the table", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeAdmin);
    await page.goto("/admin/expense");

    await expect(page.getByText("All Expenses")).toBeVisible();

    const officeTitle = `E2E Office ${RUN}`;
    await fileExpense(page, officeTitle, "70");
    await expect(expenseRow(page, officeTitle)).toBeVisible();

    // What the two suites each prove: the backend tests already check that
    // "office" and a site id select the right rows, using data built directly.
    // This one checks the control is wired to the parameter at all — which is
    // the half that cannot be seen from the server side.

    // A site with nothing filed against it empties the table. `exact` because
    // scripts/test-expense.mjs leaves its own "Acme Yard <suffix>" sites behind,
    // and role-name matching is substring by default.
    await page.locator("#projectId").click();
    await page.getByRole("option", { name: "Acme Yard", exact: true }).click();
    await expect(page).toHaveURL(/projectId=/);
    await expect(expenseRow(page, officeTitle)).toHaveCount(0);

    // Office is the absence of a site, so the office expense comes back.
    await page.locator("#projectId").click();
    await page.getByRole("option", { name: "Office (no site)" }).click();
    await expect(expenseRow(page, officeTitle)).toBeVisible();

    // And cleared again — which this filter could not do before it had an
    // "all" entry, because Radix will not take an empty-string option.
    await page.locator("#projectId").click();
    await page.getByRole("option", { name: "All sites" }).click();
    await expect(page).not.toHaveURL(/projectId=/);
    await expect(expenseRow(page, officeTitle)).toBeVisible();

    // The category filter offers the categories that could actually match —
    // with no site selected, the company-wide ones, which is what office
    // expenses are filed against.
    await page.locator("#categoryId").click();
    await page.getByRole("option", { name: CATEGORY, exact: true }).click();
    await expect(page).toHaveURL(/categoryId=/);
    await expect(expenseRow(page, officeTitle)).toBeVisible();

    await page.locator("#categoryId").click();
    await page.getByRole("option", { name: "All categories" }).click();
    await expect(page).not.toHaveURL(/categoryId=/);
  });

  test("the date filter narrows the table", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeAdmin);
    // Driven through the URL: the range picker writes these two parameters, and
    // it is the server's reading of them that was broken — a one-ended range
    // used to be ignored entirely.
    await page.goto("/admin/expense?fromDate=2020-01-01&toDate=2020-12-31");

    await expect(page.getByText("No expenses yet.")).toBeVisible();

    await page.goto("/admin/expense");
    await expect(page.getByText("No expenses yet.")).toHaveCount(0);
  });

  test("the category filter lists site categories too, not just office ones", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.acmeAdmin);
    await page.goto("/admin/expense");

    // A category attached to a site. With no site filter selected, the filter
    // must offer this alongside the office categories — it used to send "no
    // project", which the server read as "office", so only one ever appeared.
    const siteCategory = `E2E SiteCat ${RUN}`;
    await page.getByRole("button", { name: /add expense category/i }).click();
    // Scoped to the form dialog: the multi-select opens a Radix popover, which
    // also carries role="dialog", so a bare getByRole("dialog") matches two.
    const dialog = page.getByRole("dialog").filter({ has: page.locator("#name") });
    await dialog.locator("#name").fill(siteCategory);
    await dialog.locator("#budget").fill("1200");

    await dialog.locator("#projectIds").click();
    await page.getByRole("option", { name: "Acme Yard", exact: true }).click();
    // Close the popover by its trigger rather than Escape, which the dialog
    // beneath would take for itself.
    await dialog.locator("#projectIds").click();

    await dialog.getByRole("button", { name: /add expense/i }).click();
    await expect(dialog).toBeHidden();

    await page.locator("#categoryId").click();
    const listbox = page.getByRole("listbox");
    await expect(listbox.getByRole("option", { name: CATEGORY, exact: true })).toBeVisible();
    await expect(
      listbox.getByRole("option", { name: siteCategory, exact: true })
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("a category can be deleted, behind a confirmation", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeAdmin);
    await page.goto("/admin/expense");

    const doomed = `E2E DoomedCat ${RUN}`;
    await page.getByRole("button", { name: /add expense category/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#name").fill(doomed);
    await dialog.locator("#budget").fill("300");
    await dialog.getByRole("button", { name: /add expense/i }).click();
    await expect(dialog).toBeHidden();

    const row = page.locator("tr", {
      has: page.getByRole("cell", { name: doomed, exact: true }),
    });
    await expect(row).toBeVisible();

    // Cancelling must leave it alone — the point of the step.
    await row.getByTitle("Delete").click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(row).toBeVisible();

    await row.getByTitle("Delete").click();
    await page.getByRole("button", { name: "Delete category" }).click();
    await expect(row).toHaveCount(0);
  });

  test("an ordinary employee cannot reach the page at all", async ({ page }) => {
    await signIn(page, ACCOUNTS.acmeUser);
    await page.goto("/admin/expense");

    // proxy.js sends them to their dashboard; the actions would refuse anyway.
    await expect(page).not.toHaveURL(/\/admin\/expense/);
  });
});

/** Fill and submit the Add Expense dialog. */
async function fileExpense(page, title, amount) {
  await page.getByRole("button", { name: "Add Expense", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await dialog.locator("#title").fill(title);
  await dialog.locator("#amount").fill(amount);
  await pickDate(page, dialog, "date");
  // No company step, and the category list no longer waits for one — it used to
  // sit empty until the user picked the only option in a list of one.
  await expect(dialog.locator("#companyId")).toHaveCount(0);
  await selectOption(page, dialog, "category", CATEGORY);

  await dialog.getByRole("button", { name: /add expense/i }).click();
  await expect(dialog).toBeHidden();
}

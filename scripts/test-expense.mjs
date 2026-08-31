/**
 * Expense feature tests — categories, expenses, isolation and authorisation.
 *
 * Unlike scripts/test-announcements.mjs, this drives the *server actions*
 * themselves. In this feature the action is where the validation, the duplicate
 * rule and (the point of section D) the authorisation check live, so testing
 * under them would test nothing that matters. scripts/lib/action-loader.mjs
 * swaps the session module for a stub, which is what makes that possible.
 *
 * Needs a LOCAL database — the script refuses anything else, because it writes.
 *
 *   docker run -d --name cdchr-test-mongo -p 27017:27017 mongo:7 \
 *     --replSet rs0 --bind_ip_all
 *   docker exec cdchr-test-mongo mongosh --quiet --eval \
 *     'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_dev?replicaSet=rs0" \
 *     node --import ./scripts/lib/alias-loader.mjs scripts/seed-dev-fixtures.mjs
 *
 * Then:
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_dev?replicaSet=rs0" \
 *   TENANT_ENFORCEMENT=enforce \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-expense.mjs
 *
 * The isolation sections assert real separation only under `enforce`; under
 * `shadow` nothing is filtered, so they assert the leak instead. Both must pass.
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const MODE = process.env.TENANT_ENFORCEMENT || "shadow";
const ENFORCING = MODE === "enforce";

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}

const oid = () => new mongoose.Types.ObjectId();
const uniq = () => Math.random().toString(36).slice(2, 8);

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database seeded with fixtures.");
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const { runWithTenant } = await import("@/lib/tenantContext");
  const { actAs } = await import("@/scripts/lib/session-stub");
  const Category = (await import("@/models/expense/expenseCategoryModel")).default;
  const Expense = (await import("@/models/expense/expenseModel")).default;
  const Company = (await import("@/models/companyModel")).default;

  const actions = await import("@/server/expenseServer/expenseServer");
  const {
    addExpenseCategoryAction,
    updateExpenseCategoryAction,
    deleteExpenseCategoryAction,
    getAllExpenseCategories,
    addExpenseAction,
    getAllExpenses,
  } = actions;

  // Fixtures. Read outside any tenant scope — companies are a global model.
  const [acme, beta] = await Promise.all([
    Company.findOne({ slug: "acme" }).lean(),
    Company.findOne({ slug: "beta" }).lean(),
  ]);
  assert(acme && beta, "fixtures missing — run scripts/seed-dev-fixtures.mjs");

  const db = mongoose.connection.db;
  const staff = await db.collection("officeemployes").find({}).toArray();
  const byEmail = Object.fromEntries(staff.map((s) => [s.email, s]));

  const A = String(acme._id);
  const B = String(beta._id);

  const acmeAdmin = {
    _id: String(byEmail["admin@acme.test"]._id),
    role: "admin",
    tenantId: A,
  };
  const acmeSuper = {
    _id: String(byEmail["super@acme.test"]._id),
    role: "superAdmin",
    tenantId: A,
  };
  const acmeUser = {
    _id: String(byEmail["user@acme.test"]._id),
    role: "user",
    tenantId: A,
  };
  const betaAdmin = {
    _id: String(byEmail["admin@beta.test"]._id),
    role: "admin",
    tenantId: B,
  };

  /** Run `fn` as `user`, inside that user's tenant scope. */
  const as = (user, fn) =>
    runWithTenant(user.tenantId, async () => {
      actAs(user);
      try {
        return await fn();
      } finally {
        actAs(null);
      }
    });

  // Site rows the lookups can resolve. Written directly: there is no seeded
  // project fixture, and the point here is the join, not how sites are created.
  const acmeSite = oid();
  const betaSite = oid();
  // siteDelete/isActive included because the site dropdown filters on them —
  // a row without them exists but can never be selected.
  const site = (id, name, tenantId) => ({
    _id: id,
    siteName: name,
    siteType: "site",
    siteDelete: false,
    isActive: true,
    tenantId,
  });
  await db.collection("projectsites").insertMany([
    site(acmeSite, `Acme Yard ${uniq()}`, acme._id),
    site(betaSite, `Beta Yard ${uniq()}`, beta._id),
  ]);

  // Permission grants. An `admin` reaches expenses through their role's
  // permission list, not their role name, so without these rows every admin in
  // this file would be refused and the tests would pass for the wrong reason.
  // acmeUser deliberately gets none.
  const grant = (employee, tenantId, permissions) => ({
    _id: oid(),
    name: "Fixture role",
    employeeId: createId(employee._id),
    permissions,
    isActive: true,
    isDeleted: false,
    tenantId: createId(tenantId),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const unpermittedAdmin = {
    _id: String(byEmail["user@acme.test"]._id),
    role: "admin",
    tenantId: A,
  };
  await db.collection("rolebaseds").deleteMany({
    employeeId: { $in: [createId(acmeAdmin._id), createId(betaAdmin._id)] },
  });
  await db.collection("rolebaseds").insertMany([
    grant(acmeAdmin, A, ["/admin/expense", "/admin/dashboard"]),
    grant(betaAdmin, B, ["/admin/expense"]),
  ]);

  // Everything this run writes, so the fixtures stay reusable.
  const tag = uniq();

  // ── A. Category creation and validation ────────────────────────────────
  let acmeCatId;
  const catName = `Materials-${tag}`;

  await check("category: an admin can create one", async () => {
    const res = await as(acmeAdmin, () =>
      addExpenseCategoryAction({
        name: catName,
        budget: 5000,
        companyId: A,
        description: "Bricks and mortar",
      })
    );
    assert.equal(res.success, true, res.message);
    // Pinned on tenantId rather than left to the scope: fixture setup must not
    // depend on the isolation these tests exist to check, or a shadow-mode run
    // silently hands section B the wrong tenant's ids.
    const row = await runWithTenant(A, () =>
      Category.findOne({ name: catName, tenantId: acme._id }).lean()
    );
    assert(row, "category was not written");
    assert.equal(String(row.tenantId), A, "category was not stamped with the tenant");
    acmeCatId = String(row._id);
  });

  await check("category: budget is required", async () => {
    const res = await as(acmeAdmin, () =>
      addExpenseCategoryAction({ name: `NoBudget-${tag}`, companyId: A })
    );
    assert.equal(res.success, false, "a category with no budget was accepted");
  });

  await check("category: a negative budget is rejected", async () => {
    const res = await as(acmeAdmin, () =>
      addExpenseCategoryAction({ name: `Negative-${tag}`, budget: -500, companyId: A })
    );
    assert.equal(res.success, false, "a negative budget was accepted");
  });

  await check("category: duplicate name in the same company is rejected", async () => {
    const res = await as(acmeAdmin, () =>
      addExpenseCategoryAction({ name: catName.toUpperCase(), budget: 100, companyId: A })
    );
    assert.equal(res.success, false, "a case-insensitive duplicate was accepted");
  });

  let betaCatId;
  await check("category: another tenant may reuse the same name", async () => {
    const res = await as(betaAdmin, () =>
      addExpenseCategoryAction({ name: catName, budget: 900, companyId: B })
    );
    assert.equal(res.success, true, res.message);
    const row = await runWithTenant(B, () =>
      Category.findOne({ name: catName, tenantId: beta._id }).lean()
    );
    betaCatId = String(row._id);
  });

  await check("category: the duplicate check is tenant-scoped", async () => {
    // Two categories with this name now exist, one per tenant. Under
    // enforcement each tenant must see exactly its own.
    const rows = await runWithTenant(A, () => Category.find({ name: catName }).lean());
    if (ENFORCING) assert.equal(rows.length, 1, `Acme sees ${rows.length} rows named ${catName}`);
    else assert.equal(rows.length, 2, "shadow mode should not filter");
  });

  await check("category: a project-scoped duplicate check still honours the company", async () => {
    // Both tenants attach a category to *their own* site, same name. The second
    // must be allowed: they share no project, so they are not duplicates.
    const name = `Plant-${tag}`;
    const first = await as(acmeAdmin, () =>
      addExpenseCategoryAction({
        name,
        budget: 200,
        companyId: A,
        projectIds: [String(acmeSite)],
      })
    );
    assert.equal(first.success, true, first.message);

    const second = await as(betaAdmin, () =>
      addExpenseCategoryAction({
        name,
        budget: 200,
        companyId: B,
        projectIds: [String(betaSite)],
      })
    );
    assert.equal(
      second.success,
      true,
      `a different tenant's project-scoped category was rejected: ${second.message}`
    );
  });

  // ── A2. The company comes from the session ─────────────────────────────
  // The form used to ask for it, from a picker that offered exactly one option.
  // Now the server takes it from the caller, so a client cannot name a company
  // at all — including someone else's.
  await check("company: a category is stamped with the caller's own company", async () => {
    const name = `Derived-${tag}`;
    const res = await as(acmeAdmin, () =>
      addExpenseCategoryAction({ name, budget: 100 })
    );
    assert.equal(res.success, true, res.message);

    const row = await runWithTenant(A, () =>
      Category.findOne({ name, tenantId: acme._id }).lean()
    );
    assert.equal(String(row.companyId), A, "the category took the wrong company");
  });

  await check("company: a spoofed companyId is ignored", async () => {
    const name = `Spoofed-${tag}`;
    const res = await as(acmeAdmin, () =>
      // Beta's id, sent by an Acme caller. Previously this was the value used.
      addExpenseCategoryAction({ name, budget: 100, companyId: B })
    );
    assert.equal(res.success, true, res.message);

    const row = await runWithTenant(A, () =>
      Category.findOne({ name, tenantId: acme._id }).lean()
    );
    assert.equal(
      String(row.companyId),
      A,
      "a client-supplied companyId reached the record"
    );
  });

  await check("company: an expense is stamped with the caller's own company", async () => {
    const title = `Derived expense ${tag}`;
    const res = await as(acmeAdmin, () =>
      addExpenseAction({
        title,
        amount: 15,
        date: "2026-08-07",
        companyId: B, // ignored
        category: acmeCatId,
      })
    );
    assert.equal(res.success, true, res.message);

    const row = await runWithTenant(A, () =>
      Expense.findOne({ title, tenantId: acme._id }).lean()
    );
    assert.equal(String(row.companyId), A, "the expense took the wrong company");
  });

  await check("company: the ledger no longer joins the companies collection", async () => {
    // Dropped once the column came off both tables and the invoice took its
    // name from branding. Asserted rather than assumed: a join nothing reads is
    // a per-row cost on every page load, and it is easy to add back by habit.
    const res = await as(acmeAdmin, () => getAllExpenses({ limit: 5 }));
    const { expenses } = JSON.parse(res.data);
    assert(expenses.length > 0, "no expenses to judge");
    for (const row of expenses) {
      assert.equal(row.company, undefined, "the company join is still running");
    }

    const cats = await as(acmeAdmin, () => getAllExpenseCategories({ limit: 5 }));
    for (const row of JSON.parse(cats.data).categories) {
      assert.equal(row.company, undefined, "the company join is still running");
    }
  });

  await check("company: a category cannot be moved to another company", async () => {
    const before = await runWithTenant(A, () => Category.findById(acmeCatId).lean());
    const res = await as(acmeAdmin, () =>
      updateExpenseCategoryAction(acmeCatId, { companyId: B, budget: 4321 })
    );
    assert.equal(res.success, true, res.message);

    const after = await runWithTenant(A, () => Category.findById(acmeCatId).lean());
    assert.equal(after.budget, 4321, "the update did not apply");
    assert.equal(
      String(after.companyId),
      String(before.companyId),
      "companyId was changed by the request"
    );
  });

  // ── B. Cross-tenant access to a known id ───────────────────────────────
  await check("isolation: listing categories shows only this tenant's", async () => {
    const res = await as(acmeAdmin, () => getAllExpenseCategories({ limit: 100 }));
    assert.equal(res.success, true, res.message);
    const { categories } = JSON.parse(res.data);
    const foreign = categories.filter((c) => String(c.tenantId) !== A);
    if (ENFORCING) assert.equal(foreign.length, 0, `${foreign.length} foreign categories listed`);
  });

  // These two assert the *difference* between the modes rather than skipping
  // under shadow. Shadow adds no filter, so the cross-tenant write goes
  // through — stating that plainly is what makes the enforce-mode pass mean
  // something, instead of a green tick that would look identical either way.
  await check("isolation: updating another tenant's category is refused", async () => {
    const res = await as(acmeAdmin, () =>
      updateExpenseCategoryAction(betaCatId, { name: `Stolen-${tag}`, budget: 1 })
    ).catch((e) => ({ success: false, message: e.message }));
    const after = await runWithTenant(B, () => Category.findById(betaCatId).lean());

    if (ENFORCING) {
      assert.equal(res.success, false, "Acme edited a Beta category");
      assert.equal(after.name, catName, "the Beta category was modified");
    } else {
      assert.equal(after.name, `Stolen-${tag}`, "shadow mode should not filter");
    }
  });

  await check("isolation: deleting another tenant's category is refused", async () => {
    const res = await as(acmeAdmin, () => deleteExpenseCategoryAction(betaCatId)).catch(
      (e) => ({ success: false, message: e.message })
    );
    const after = await runWithTenant(B, () => Category.findById(betaCatId).lean());

    if (ENFORCING) {
      assert.equal(res.success, false, "Acme deleted a Beta category");
      assert.equal(after.isDeleted, false, "the Beta category was soft-deleted");
    } else {
      assert.equal(after.isDeleted, true, "shadow mode should not filter");
    }
  });

  // ── C. Expenses ────────────────────────────────────────────────────────
  await check("expense: an admin's expense starts pending", async () => {
    const res = await as(acmeAdmin, () =>
      addExpenseAction({
        title: `Cement ${tag}`,
        amount: 250,
        date: "2026-08-01",
        companyId: A,
        projectId: String(acmeSite),
        category: acmeCatId,
      })
    );
    assert.equal(res.success, true, res.message);
    const row = await runWithTenant(A, () =>
      Expense.findOne({ title: `Cement ${tag}`, tenantId: acme._id }).lean()
    );
    assert(row, "expense was not written");
    assert.equal(row.status, "pending");
    assert.equal(String(row.tenantId), A, "expense was not stamped with the tenant");
    assert.equal(row.categoryLabel, catName, "the category label was not denormalised");
  });

  await check("expense: a superAdmin's expense is auto-approved", async () => {
    const res = await as(acmeSuper, () =>
      addExpenseAction({
        title: `Scaffold ${tag}`,
        amount: 900,
        date: "2026-08-02",
        companyId: A,
        category: acmeCatId,
      })
    );
    assert.equal(res.success, true, res.message);
    const row = await runWithTenant(A, () =>
      Expense.findOne({ title: `Scaffold ${tag}`, tenantId: acme._id }).lean()
    );
    assert.equal(row.status, "approved");
  });

  await check("expense: a negative amount is rejected", async () => {
    const res = await as(acmeAdmin, () =>
      addExpenseAction({
        title: `Refund ${tag}`,
        amount: -100,
        date: "2026-08-03",
        companyId: A,
        category: acmeCatId,
      })
    );
    assert.equal(res.success, false, "a negative expense amount was accepted");
  });

  await check("expense: an unknown category is rejected", async () => {
    const res = await as(acmeAdmin, () =>
      addExpenseAction({
        title: `Ghost ${tag}`,
        amount: 10,
        date: "2026-08-03",
        companyId: A,
        category: String(oid()),
      })
    );
    assert.equal(res.success, false, "an expense referencing no category was accepted");
  });

  await check("expense: another tenant's category cannot be used", async () => {
    const res = await as(acmeAdmin, () =>
      addExpenseAction({
        title: `Borrowed ${tag}`,
        amount: 10,
        date: "2026-08-03",
        companyId: A,
        category: betaCatId,
      })
    ).catch((e) => ({ success: false, message: e.message }));
    if (ENFORCING) {
      assert.equal(res.success, false, "an expense was filed against a Beta category");
    }
  });

  let betaExpenseTitle = `Beta spend ${tag}`;
  await check("isolation: listing expenses shows only this tenant's", async () => {
    await as(betaAdmin, () =>
      addExpenseAction({
        title: betaExpenseTitle,
        amount: 400,
        date: "2026-08-04",
        companyId: B,
        projectId: String(betaSite),
        category: betaCatId,
      })
    );

    const res = await as(acmeAdmin, () => getAllExpenses({ limit: 100 }));
    assert.equal(res.success, true, res.message);
    const { expenses } = JSON.parse(res.data);
    const leaked = expenses.filter((e) => e.title === betaExpenseTitle);
    if (ENFORCING) assert.equal(leaked.length, 0, "a Beta expense appeared in Acme's list");
  });

  await check("isolation: the site join does not resolve across tenants", async () => {
    // An Acme expense pointing at a Beta site. The row is Acme's, so it is
    // listed — but the joined site name must not come back.
    const title = `Mislinked ${tag}`;
    await runWithTenant(A, () =>
      Expense.create({
        employeeId: createId(acmeAdmin._id),
        title,
        amount: 5,
        date: new Date("2026-08-05"),
        categoryId: createId(acmeCatId),
        categoryLabel: catName,
        companyId: acme._id,
        projectId: betaSite,
        tenantId: acme._id,
      })
    );

    const res = await as(acmeAdmin, () => getAllExpenses({ query: `Mislinked ${tag}` }));
    const { expenses } = JSON.parse(res.data);
    assert.equal(expenses.length, 1, "the expense itself should still be listed");
    if (ENFORCING) {
      assert(!expenses[0].project, "a Beta site name leaked through the $lookup");
    }
  });

  await check("expense: pagination reports a consistent total", async () => {
    const res = await as(acmeAdmin, () => getAllExpenses({ page: 1, limit: 2 }));
    const { expenses, pagination } = JSON.parse(res.data);
    assert(expenses.length <= 2, "limit was ignored");
    assert.equal(pagination.totalPages, Math.ceil(pagination.totalCount / 2));
    assert.equal(res.totalCount, pagination.totalCount);
  });

  // ── C2. Filtering ──────────────────────────────────────────────────────
  const filterTag = `Filt${tag}`;
  let filterCatId;
  let filterSite;

  await check("filter: fixtures for the filter tests", async () => {
    const res = await as(acmeAdmin, () =>
      addExpenseCategoryAction({ name: `${filterTag}-cat`, budget: 999 })
    );
    assert.equal(res.success, true, res.message);
    filterCatId = String(
      await runWithTenant(A, () =>
        Category.findOne({ name: `${filterTag}-cat`, tenantId: acme._id })
          .select("_id")
          .lean()
      ).then((r) => r._id)
    );

    filterSite = oid();
    await db.collection("projectsites").insertOne({
      ...site(filterSite, `${filterTag} Yard`, acme._id),
    });

    // Three days, two categories, one on a site and one at the office.
    const rows = [
      { title: `${filterTag} early`, date: "2026-03-01", projectId: null },
      { title: `${filterTag} middle`, date: "2026-03-15", projectId: filterSite },
      { title: `${filterTag} late`, date: "2026-03-30", projectId: null },
    ];
    for (const row of rows) {
      const added = await as(acmeAdmin, () =>
        addExpenseAction({
          title: row.title,
          amount: 10,
          date: row.date,
          category: row.projectId ? acmeCatId : filterCatId,
          ...(row.projectId ? { projectId: String(row.projectId) } : {}),
        })
      );
      assert.equal(added.success, true, added.message);
    }
  });

  const titlesFrom = (res) =>
    JSON.parse(res.data).expenses.map((e) => e.title);

  await check("filter: a date range selects only what falls inside it", async () => {
    const res = await as(acmeAdmin, () =>
      getAllExpenses({ query: filterTag, fromDate: "2026-03-10", toDate: "2026-03-20", limit: 50 })
    );
    const titles = titlesFrom(res);
    assert.deepEqual(titles.sort(), [`${filterTag} middle`]);
  });

  await check("filter: the range includes expenses on its end dates", async () => {
    const res = await as(acmeAdmin, () =>
      getAllExpenses({ query: filterTag, fromDate: "2026-03-01", toDate: "2026-03-30", limit: 50 })
    );
    assert.equal(titlesFrom(res).length, 3, "an expense on a boundary date was dropped");
  });

  await check("filter: an open-ended range still filters", async () => {
    // Only a start date. The condition guarding this was `fromDate && toDate`,
    // so half a range was silently ignored and every expense came back.
    const res = await as(acmeAdmin, () =>
      getAllExpenses({ query: filterTag, fromDate: "2026-03-20", limit: 50 })
    );
    assert.deepEqual(titlesFrom(res).sort(), [`${filterTag} late`]);

    const until = await as(acmeAdmin, () =>
      getAllExpenses({ query: filterTag, toDate: "2026-03-10", limit: 50 })
    );
    assert.deepEqual(titlesFrom(until).sort(), [`${filterTag} early`]);
  });

  await check("filter: an unparseable date is ignored, not applied", async () => {
    // `new Date("rubbish")` is Invalid Date, and a $gte against it matches
    // nothing — so a malformed parameter emptied the table instead of being
    // treated as absent.
    const res = await as(acmeAdmin, () =>
      getAllExpenses({ query: filterTag, fromDate: "rubbish", limit: 50 })
    );
    assert.equal(titlesFrom(res).length, 3, "a bad date silently emptied the list");
  });

  await check("filter: by category", async () => {
    const res = await as(acmeAdmin, () =>
      getAllExpenses({ query: filterTag, categoryId: filterCatId, limit: 50 })
    );
    assert.deepEqual(
      titlesFrom(res).sort(),
      [`${filterTag} early`, `${filterTag} late`].sort()
    );
  });

  await check("filter: by project", async () => {
    const res = await as(acmeAdmin, () =>
      getAllExpenses({ query: filterTag, projectId: String(filterSite), limit: 50 })
    );
    assert.deepEqual(titlesFrom(res).sort(), [`${filterTag} middle`]);
  });

  await check("filter: office-only excludes everything filed against a site", async () => {
    // "Office" is the absence of a project — what the table already labels these
    // rows. Without a value to ask for, there was no way to request them.
    const res = await as(acmeAdmin, () =>
      getAllExpenses({ query: filterTag, projectId: "office", limit: 50 })
    );
    assert.deepEqual(
      titlesFrom(res).sort(),
      [`${filterTag} early`, `${filterTag} late`].sort()
    );
  });

  await check("filter: category options mean three different things", async () => {
    // A category on a site, alongside the office ones already created.
    const onSite = `${filterTag}-sitecat`;
    await as(acmeAdmin, () =>
      addExpenseCategoryAction({
        name: onSite,
        budget: 500,
        projectIds: [String(filterSite)],
      })
    );

    const labels = async (params) =>
      JSON.parse((await as(acmeAdmin, () => actions.getSelectExpenseCategory(params))).data)
        .map((o) => o.label);

    // No project: everything. This case used to share a branch with OFFICE, so
    // the filter dropdown listed only the office categories however many the
    // company had — the "why can I see only one category" report.
    const all = await labels({});
    assert(all.includes(onSite), "an all-categories request hid a site category");
    assert(all.includes(`${filterTag}-cat`), "an all-categories request hid an office category");

    // A site: only that site's.
    const site = await labels({ projectId: String(filterSite) });
    assert.deepEqual(site, [onSite]);

    // Office: only the ones tied to no site.
    const office = await labels({ projectId: "office" });
    assert(!office.includes(onSite), "an office request offered a site category");
    assert(office.includes(`${filterTag}-cat`), "an office request hid an office category");
  });

  await check("filter: a deleted category stops being offered", async () => {
    const name = `${filterTag}-gone`;
    await as(acmeAdmin, () =>
      addExpenseCategoryAction({ name, budget: 50 })
    );
    const row = await runWithTenant(A, () =>
      Category.findOne({ name, tenantId: acme._id }).select("_id").lean()
    );

    const before = JSON.parse(
      (await as(acmeAdmin, () => actions.getSelectExpenseCategory({}))).data
    ).map((o) => o.label);
    assert(before.includes(name), "the new category was not offered");

    const res = await as(acmeAdmin, () =>
      deleteExpenseCategoryAction(String(row._id))
    );
    assert.equal(res.success, true, res.message);

    const after = JSON.parse(
      (await as(acmeAdmin, () => actions.getSelectExpenseCategory({}))).data
    ).map((o) => o.label);
    assert(!after.includes(name), "a deleted category is still offered");

    // Soft, so expenses already filed against it keep their history.
    const stored = await runWithTenant(A, () => Category.findById(row._id).lean());
    assert.equal(stored.isDeleted, true);
    assert.equal(stored.name, name, "the record was destroyed rather than retired");
  });

  // ── D. Authorisation ───────────────────────────────────────────────────
  // A server action is a POST endpoint. Being signed in is not the same as
  // being allowed, and nothing above this line checks the difference.
  await check("auth: an ordinary employee cannot create a category", async () => {
    const res = await as(acmeUser, () =>
      addExpenseCategoryAction({ name: `Sneaky-${tag}`, budget: 10, companyId: A })
    ).catch((e) => ({ success: false, message: e.message }));
    assert.equal(res.success, false, "a 'user' role created an expense category");
  });

  await check("auth: an ordinary employee cannot delete a category", async () => {
    const res = await as(acmeUser, () => deleteExpenseCategoryAction(acmeCatId)).catch(
      (e) => ({ success: false, message: e.message })
    );
    assert.equal(res.success, false, "a 'user' role deleted an expense category");
  });

  await check("auth: an admin without the page permission is refused", async () => {
    // Same employee as acmeUser, presenting the admin role but holding no
    // permission grant — the shape a role name alone would wave through.
    const res = await as(unpermittedAdmin, () =>
      addExpenseCategoryAction({ name: `Ungranted-${tag}`, budget: 10, companyId: A })
    ).catch((e) => ({ success: false, message: e.message }));
    assert.equal(res.success, false, "an admin with no /admin/expense grant got in");
  });

  // Reads answer with an empty page rather than an error — see emptyPage() in
  // the server. So "refused" is asserted on the payload, not on `success`.
  const readsNothing = (res, what) => {
    const parsed = JSON.parse(res.data);
    assert.equal((parsed.expenses || parsed.categories).length, 0, what);
    assert.equal(res.totalCount, 0, what);
  };

  await check("auth: an ordinary employee cannot read the company ledger", async () => {
    const res = await as(acmeUser, () => getAllExpenses({ limit: 100 })).catch((e) => ({
      success: false,
      message: e.message,
    }));
    readsNothing(res, "a 'user' role read expenses");
  });

  await check("auth: an ordinary employee cannot list categories", async () => {
    const res = await as(acmeUser, () => getAllExpenseCategories({ limit: 100 })).catch(
      (e) => ({ success: false, message: e.message })
    );
    readsNothing(res, "a 'user' role read expense categories");
  });

  await check("auth: a signed-out caller is refused", async () => {
    const res = await runWithTenant(A, async () => {
      actAs(null);
      return getAllExpenses({ limit: 10 });
    }).catch((e) => ({ success: false, message: e.message }));
    readsNothing(res, "an unauthenticated caller read the ledger");
  });

  // ── D2. Plan gating ────────────────────────────────────────────────────
  await check("plan: a company without the expenses module is refused", async () => {
    // Beta's plan drops the module. Its super admin — who passes every role
    // check there is — must still be turned away.
    await Company.updateOne({ _id: beta._id }, { $set: { "features.expenses": false } });
    try {
      const write = await as(betaAdmin, () =>
        addExpenseCategoryAction({ name: `OffPlan-${tag}`, budget: 10, companyId: B })
      );
      assert.equal(write.success, false, "an off-plan company created a category");

      const read = await as(
        { ...betaAdmin, role: "superAdmin" },
        () => getAllExpenses({ limit: 100 })
      );
      readsNothing(read, "an off-plan company read expenses");
    } finally {
      await Company.updateOne({ _id: beta._id }, { $unset: { "features.expenses": "" } });
    }
  });

  await check("plan: an absent flag still means enabled", async () => {
    // Nothing sets features.expenses on the Acme fixture. A company predating a
    // flag must not silently lose the module.
    const res = await as(acmeAdmin, () => getAllExpenses({ limit: 5 }));
    assert.equal(res.success, true, res.message);
    const { expenses } = JSON.parse(res.data);
    assert(expenses.length > 0, "Acme lost the module to an absent flag");
  });

  // ── E. Capabilities the UI implies but the server never got ────────────
  const {
    updateExpenseAction,
    deleteExpenseAction,
    setExpenseStatusAction,
    getExpenseReceiptUrl,
  } = actions;

  /** File a fresh expense as `who` and hand back its id. */
  const fileExpense = async (who, title, extra = {}) => {
    const res = await as(who, () =>
      addExpenseAction({
        title,
        amount: 100,
        date: "2026-08-10",
        companyId: A,
        category: acmeCatId,
        ...extra,
      })
    );
    assert.equal(res.success, true, res.message);
    const row = await runWithTenant(A, () =>
      Expense.findOne({ title, tenantId: acme._id }).lean()
    );
    return String(row._id);
  };

  await check("api: an expense can be edited", async () => {
    const id = await fileExpense(acmeAdmin, `Editable ${tag}`);
    const res = await as(acmeAdmin, () =>
      updateExpenseAction(id, { amount: 250, title: `Edited ${tag}` })
    );
    assert.equal(res.success, true, res.message);

    const row = await runWithTenant(A, () => Expense.findById(id).lean());
    assert.equal(row.amount, 250);
    assert.equal(row.title, `Edited ${tag}`);
  });

  await check("api: editing rejects a negative amount", async () => {
    const id = await fileExpense(acmeAdmin, `Unedited ${tag}`);
    const res = await as(acmeAdmin, () => updateExpenseAction(id, { amount: -5 }));
    assert.equal(res.success, false, "an edit set a negative amount");

    const row = await runWithTenant(A, () => Expense.findById(id).lean());
    assert.equal(row.amount, 100, "the expense was changed anyway");
  });

  await check("api: changing the amount withdraws an approval", async () => {
    // Filed by the super admin, so it starts approved.
    const id = await fileExpense(acmeSuper, `Reapprove ${tag}`);
    const beforeRow = await runWithTenant(A, () => Expense.findById(id).lean());
    assert.equal(beforeRow.status, "approved");

    const res = await as(acmeAdmin, () => updateExpenseAction(id, { amount: 999 }));
    assert.equal(res.success, true, res.message);

    const row = await runWithTenant(A, () => Expense.findById(id).lean());
    assert.equal(row.status, "pending", "an approved figure was changed silently");
  });

  await check("api: an expense can be deleted", async () => {
    const id = await fileExpense(acmeAdmin, `Doomed ${tag}`);
    const res = await as(acmeAdmin, () => deleteExpenseAction(id));
    assert.equal(res.success, true, res.message);

    const row = await runWithTenant(A, () => Expense.findById(id).lean());
    assert.equal(row.isDeleted, true, "the expense was not soft-deleted");

    const list = await as(acmeAdmin, () => getAllExpenses({ query: `Doomed ${tag}` }));
    assert.equal(JSON.parse(list.data).expenses.length, 0, "a deleted expense is listed");
  });

  await check("api: a pending expense can be approved", async () => {
    const id = await fileExpense(acmeAdmin, `Approvable ${tag}`);
    const res = await as(acmeSuper, () => setExpenseStatusAction(id, "approved"));
    assert.equal(res.success, true, res.message);

    const row = await runWithTenant(A, () => Expense.findById(id).lean());
    assert.equal(row.status, "approved");
  });

  await check("api: a pending expense can be rejected", async () => {
    const id = await fileExpense(acmeAdmin, `Rejectable ${tag}`);
    const res = await as(acmeSuper, () => setExpenseStatusAction(id, "rejected"));
    assert.equal(res.success, true, res.message);

    const row = await runWithTenant(A, () => Expense.findById(id).lean());
    assert.equal(row.status, "rejected");
  });

  await check("api: nobody rules on their own expense", async () => {
    const id = await fileExpense(acmeAdmin, `SelfApprove ${tag}`);
    const res = await as(acmeAdmin, () => setExpenseStatusAction(id, "approved"));
    assert.equal(res.success, false, "an admin approved their own claim");

    const row = await runWithTenant(A, () => Expense.findById(id).lean());
    assert.equal(row.status, "pending");
  });

  await check("api: an unknown status is refused", async () => {
    const id = await fileExpense(acmeAdmin, `BadStatus ${tag}`);
    const res = await as(acmeSuper, () => setExpenseStatusAction(id, "paid"));
    assert.equal(res.success, false, "an off-enum status was written");
  });

  await check("api: another tenant's expense cannot be edited or approved", async () => {
    const betaId = await runWithTenant(B, async () => {
      const row = await Expense.create({
        employeeId: createId(betaAdmin._id),
        title: `Beta private ${tag}`,
        amount: 77,
        date: new Date("2026-08-11"),
        categoryId: createId(betaCatId),
        categoryLabel: "Beta",
        companyId: beta._id,
        tenantId: beta._id,
      });
      return String(row._id);
    });

    const edit = await as(acmeAdmin, () =>
      updateExpenseAction(betaId, { amount: 1 })
    ).catch((e) => ({ success: false, message: e.message }));
    const approve = await as(acmeSuper, () =>
      setExpenseStatusAction(betaId, "approved")
    ).catch((e) => ({ success: false, message: e.message }));

    const after = await runWithTenant(B, () => Expense.findById(betaId).lean());
    if (ENFORCING) {
      assert.equal(edit.success, false, "Acme edited a Beta expense");
      assert.equal(approve.success, false, "Acme approved a Beta expense");
      assert.equal(after.amount, 77, "the Beta expense was modified");
    }
  });

  await check("api: a receipt on this expense can be opened", async () => {
    const key = `tenants/${A}/expenses/receipts/open-${tag}.pdf`;
    const id = await runWithTenant(A, async () => {
      const row = await Expense.create({
        employeeId: createId(acmeAdmin._id),
        title: `With receipt ${tag}`,
        amount: 40,
        date: new Date("2026-08-12"),
        categoryId: createId(acmeCatId),
        categoryLabel: catName,
        companyId: acme._id,
        tenantId: acme._id,
        receiptFiles: [
          { key, access: "private", fileSize: 10, fileType: "application/pdf" },
        ],
      });
      return String(row._id);
    });

    const res = await as(acmeAdmin, () => getExpenseReceiptUrl(id, key));
    assert.equal(res.success, true, res.message);
    assert(res.url?.includes("X-Amz-Signature"), "no signed URL came back");
  });

  await check("api: a key not on the named expense is refused", async () => {
    // A real key this company owns, but belonging to a different record — the
    // shape that would otherwise let the receipt viewer read a payslip.
    const otherKey = `tenants/${A}/documents/payslip-${tag}.pdf`;
    const id = await fileExpense(acmeAdmin, `Borrower ${tag}`);

    const res = await as(acmeAdmin, () => getExpenseReceiptUrl(id, otherKey)).catch(
      (e) => ({ success: false, message: e.message })
    );
    assert.equal(res.success, false, "an unrelated key was signed");
  });

  // ── E2. The result shape hooks/use-query.js relies on ──────────────────
  // unwrap() throws on `success: false` and parses `data` otherwise. An action
  // that returns neither — or returns success with unparseable data — renders
  // as a silent empty table, which is the failure mode F3 existed to end.
  await check("contract: every read returns parseable data", async () => {
    const reads = [
      ["getAllExpenses", () => getAllExpenses({ limit: 5 })],
      ["getAllExpenseCategories", () => getAllExpenseCategories({ limit: 5 })],
      [
        "getSelectExpenseCategory",
        () => actions.getSelectExpenseCategory({}),
      ],
      [
        "getSelectExpenseCategoryBySite",
        () => actions.getSelectExpenseCategoryBySite({ projectId: String(acmeSite) }),
      ],
    ];

    for (const [name, call] of reads) {
      const res = await as(acmeAdmin, call);
      assert.equal(res.success, true, `${name} did not succeed`);
      assert.equal(typeof res.data, "string", `${name} returned no data string`);
      JSON.parse(res.data); // throws here rather than in the browser
    }
  });

  await check("contract: a refused read still returns parseable data", async () => {
    // The empty-page path. A caller who may not look must get a shape the hook
    // can parse, or the table shows an error where it should show nothing.
    for (const call of [
      () => getAllExpenses({ limit: 5 }),
      () => getAllExpenseCategories({ limit: 5 }),
      () => actions.getSelectExpenseCategory({}),
    ]) {
      const res = await as(acmeUser, call);
      assert.equal(res.success, true, "a refused read broke the shape");
      JSON.parse(res.data);
    }
  });

  await check("contract: a refused write carries a message", async () => {
    const res = await as(acmeUser, () =>
      addExpenseCategoryAction({ name: `Shape-${tag}`, budget: 10, companyId: A })
    );
    assert.equal(res.success, false);
    assert(
      typeof res.message === "string" && res.message.length > 0,
      "a refusal with no message shows the user a blank toast"
    );
  });

  // ── E3. Branding the invoice depends on ────────────────────────────────
  // The invoice is the one customer-facing screen in this feature. Everything
  // that used to be hard-coded to the original client now comes from here, so
  // these assert the pipeline that feeds it rather than the rendering.
  await check("branding: a tenant's own identity reaches the invoice", async () => {
    const { resolveBranding, resolveLocale } = await import("@/lib/tenant");

    await Company.updateOne(
      { _id: beta._id },
      {
        $set: {
          "branding.supportEmail": "help@beta.test",
          "branding.supportPhone": "020 7946 0000",
          "locale.currency": "EUR",
        },
      }
    );
    try {
      const tenant = await Company.findById(beta._id).lean();
      const branding = resolveBranding(tenant);
      const locale = resolveLocale(tenant);

      assert.equal(branding.appName, "Beta HR", "the fixture's app name was lost");
      assert.equal(branding.supportEmail, "help@beta.test");
      assert.equal(branding.supportPhone, "020 7946 0000");
      assert.equal(locale.currency, "EUR");

      // The literals the invoice used to carry.
      const serialised = JSON.stringify({ branding, locale });
      for (const leak of [
        "Creative Design",
        "cdc.construction",
        "020-8004-3327",
        "res.cloudinary.com",
      ]) {
        assert(
          !serialised.includes(leak),
          `another company's ${leak} reached Beta's branding`
        );
      }
    } finally {
      await Company.updateOne(
        { _id: beta._id },
        {
          $unset: {
            "branding.supportEmail": "",
            "branding.supportPhone": "",
            "locale.currency": "",
          },
        }
      );
    }
  });

  await check("branding: a company that sets nothing gets working defaults", async () => {
    const { resolveBranding, resolveLocale } = await import("@/lib/tenant");
    const branding = resolveBranding({});
    const locale = resolveLocale({});

    assert(branding.logoUrl, "no fallback logo — the invoice would render broken");
    assert(branding.appName, "no fallback app name");
    assert.equal(branding.supportEmail, "", "an unset contact must be empty, not invented");
    assert.equal(branding.supportPhone, "");
    assert.equal(locale.currency, "GBP", "the existing business must keep GBP");
  });

  await check("branding: supportPhone survives a round trip through the editor", async () => {
    // The allow-list in tenantOps.BRANDING_FIELDS drops anything it does not
    // know, so a new field that is not added there saves silently and vanishes.
    const { BRANDING_FIELDS } = await import("@/server/tenantServer/tenantOps");
    assert(
      BRANDING_FIELDS.includes("supportPhone"),
      "supportPhone is not allow-listed, so the settings form cannot save it"
    );
  });

  await check("locale: amounts format in the company's currency", async () => {
    const { formatCurrency } = await import("@/utils/time");

    assert(formatCurrency(1234.5, "GBP").includes("£"));
    assert(formatCurrency(1234.5, "EUR").includes("€"));
    assert(formatCurrency(1234.5, "USD").includes("$"));
    // Defaulting keeps every existing caller unchanged.
    assert(formatCurrency(1234.5).includes("£"));
    // Previously rendered "£NaN" on an expense with no amount.
    assert.equal(formatCurrency(undefined), "—");
    assert.equal(formatCurrency(null), "—");
    // An unknown code must not throw the page away.
    assert(formatCurrency(10, "ZZZ").length > 0);
  });

  // ── F. Receipt storage ─────────────────────────────────────────────────
  await check("storage: a legacy receipt key resolves to its owning tenant", async () => {
    const { assertKeyOwnedByTenant } = await import("@/lib/tenantAssets");
    // Pre-prefix shape: no tenant in the key, so ownership can only be decided
    // by finding the record that references it.
    const legacyKey = `${acmeAdmin._id}/receipt-${tag}.pdf`;
    await runWithTenant(A, () =>
      Expense.create({
        employeeId: createId(acmeAdmin._id),
        title: `Legacy receipt ${tag}`,
        amount: 12,
        date: new Date("2026-08-06"),
        categoryId: createId(acmeCatId),
        categoryLabel: catName,
        companyId: acme._id,
        tenantId: acme._id,
        receiptFiles: [
          { key: legacyKey, access: "private", fileSize: 10, fileType: "application/pdf" },
        ],
      })
    );

    await runWithTenant(A, () => assertKeyOwnedByTenant(legacyKey));
  });

  await check("storage: another tenant's receipt key is refused", async () => {
    const { assertKeyOwnedByTenant } = await import("@/lib/tenantAssets");
    await assert.rejects(
      () => runWithTenant(A, () => assertKeyOwnedByTenant(`tenants/${B}/expenses/x.pdf`)),
      "Acme was granted a key under Beta's prefix"
    );
  });

  // ── Report ─────────────────────────────────────────────────────────────
  const failed = results.filter(([s]) => s === "FAIL");
  console.log(`\nExpense tests — TENANT_ENFORCEMENT=${MODE}\n`);
  for (const [status, name] of results) {
    console.log(`  ${status === "pass" ? "✓" : "✗"} ${name}`);
  }
  console.log(`\n  ${results.length - failed.length}/${results.length} passed\n`);

  await mongoose.disconnect();
  process.exit(failed.length ? 1 : 0);
}

function createId(v) {
  return new mongoose.Types.ObjectId(String(v));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

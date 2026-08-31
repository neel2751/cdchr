# Expense Feature — End-to-End Test Report and Fix Plan

**Date:** 2026-08-28
**Branch:** `feat/multi-tenancy-phase-1`
**Scope:** the whole Expenses module — models, server actions, admin UI, the site-level
expense tab, receipt storage, plan gating and branding.

---

## 1. How this was tested

Two passes, because neither alone is honest about this feature.

**Backend — executed, not read.** `scripts/test-expense.mjs` (new) drives the *real*
server actions against a local two-tenant database. Existing test scripts
(`test-announcements.mjs`, `test-tenant-scope.mjs`) deliberately test *under* the
actions, because the actions call `auth()` and there is no request in a script. That
skips exactly what needed checking here: in this feature the action is where the
validation and the (missing) authorisation live. `scripts/lib/action-loader.mjs` (new)
extends the alias loader to swap `server/session/session.js` for a stub the test
controls, which makes "call this as an ordinary employee" expressible.

```
docker run -d --name cdchr-test-mongo -p 27017:27017 mongo:7 --replSet rs0 --bind_ip_all
docker exec cdchr-test-mongo mongosh --quiet --eval \
  'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_dev?replicaSet=rs0" \
  node --import ./scripts/lib/alias-loader.mjs scripts/seed-dev-fixtures.mjs
MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_dev?replicaSet=rs0" \
  TENANT_ENFORCEMENT=enforce \
  node --import ./scripts/lib/action-loader.mjs scripts/test-expense.mjs
```

**Frontend — read first, driven later.** The UI findings below were found by reading
source, not by clicking; each is stated with the line that produces it. Browser coverage
was added afterwards and is described in §6 — it found three further bugs that reading
had missed.

### Baseline result: 15 of 28 passed

This is the **starting** state, before any fix — the findings in §2 and §3 describe this
run. Phase 1 has since landed; see §5 for where the suite stands now (it has also grown
to 32 tests, four of them added while fixing).

```
✓ category: an admin can create one
✓ category: budget is required
✗ category: a negative budget is rejected
✓ category: duplicate name in the same company is rejected
✓ category: another tenant may reuse the same name
✓ category: the duplicate check is tenant-scoped
✓ category: a project-scoped duplicate check still honours the company
✓ isolation: listing categories shows only this tenant's
✓ isolation: updating another tenant's category is refused
✓ isolation: deleting another tenant's category is refused
✓ expense: an admin's expense starts pending
✓ expense: a superAdmin's expense is auto-approved
✗ expense: a negative amount is rejected
✗ expense: an unknown category is rejected
✗ expense: another tenant's category cannot be used
✓ isolation: listing expenses shows only this tenant's
✓ isolation: the site join does not resolve across tenants
✓ expense: pagination reports a consistent total
✗ auth: an ordinary employee cannot create a category
✗ auth: an ordinary employee cannot delete a category
✗ auth: an ordinary employee cannot read the company ledger
✗ auth: a signed-out caller is refused
✗ api: an expense can be edited
✗ api: an expense can be deleted
✗ api: a pending expense can be approved or rejected
✗ api: a receipt can be opened
✗ storage: a legacy receipt key resolves to its owning tenant
✓ storage: another tenant's receipt key is refused
```

**The good news first.** Every tenant-isolation test passed. Cross-tenant reads, writes,
deletes and `$lookup` joins are all correctly blocked — and none of that is thanks to
the expense code, which contains no tenant logic at all. It is entirely
`lib/tenantPlugin.js` doing its job underneath. That is the plugin design working
exactly as intended, and it is worth saying plainly: the isolation here is sound.

**The bad news.** Everything the plugin *cannot* know about is missing.

---

## 2. Findings — backend

### B1 · No authorisation on any expense action — **critical**

`server/expenseServer/expenseServer.js` exports seven server actions. Not one checks who
is calling.

A server action is a POST endpoint with a generated ID. `proxy.js` guards *navigation*
to `/admin/expense` by role and permission (`proxy.js:274-343`), but it does not sit in
front of an action invocation. Any signed-in employee — the `user` role, who has no
Expenses entry in their sidebar and is redirected away from the page — can invoke them
directly from the browser console.

Confirmed by test: a `user`-role account created a category, **deleted** a category, and
read the company's entire expense ledger. A caller with *no session at all* also read the
ledger: `getAllExpenses` never touches `getServerSideProps`, so there is nothing to be
absent.

`server/announcementServer/announcementServer.js:36-53` already has the right pattern —
`requireAuthor()`, super admin passes, admin must hold the menu path in their role
permissions, everyone else is refused. Expenses needs the same guard, with a read
variant.

| Action | Line | Guard needed |
|---|---|---|
| `addExpenseCategoryAction` | :51 | write |
| `deleteExpenseCategoryAction` | :121 | write |
| `updateExpenseCategoryAction` | :173 | write |
| `getAllExpenseCategories` | :277 | read |
| `getExpenseCategoryById` | :524 | read (also dead — §4) |
| `getExpenseCategoriesStats` | :620 | read (also dead — §4) |
| `addExpenseAction` | :675 | write |
| `getAllExpenses` | :761 | read |

### B2 · The feature has no edit, no delete, no approval — **high**

`ExpenseModel.status` is an enum of `pending | approved | rejected`
(`models/expense/expenseModel.js:71-75`). `addExpenseAction:740` sets it once:
`approved` if the author is a superAdmin, `pending` otherwise.

There is no action that changes it afterwards. **Every expense filed by an admin is
permanently pending.** The approval workflow the model describes does not exist.

Nor is there `updateExpenseAction` or `deleteExpenseAction`. The table renders an Edit
button (`category/expenseTable.jsx:77`) that has nothing to call, and a wrong expense —
wrong amount, wrong category, duplicate — can never be corrected or removed.

### B3 · Receipts are write-only — **high**

`addExpenseAction:700` uploads receipts to S3 with `access: "private"`. Nothing in the
expense feature reads them back. The table shows a count (`expenseTable.jsx:72`) and
that is the end of it. The only place a receipt is reachable is Media Management, which
unions `receiptFiles` in from a different server
(`server/document/documentManagementServer.js:87-92`).

Users are uploading receipts into a hole.

### B4 · `assertKeyOwnedByTenant` cannot recognise an expense receipt — **high**

`lib/tenantAssets.js:60`:

```js
ExpenseModel.exists({ "receipt.key": key }),
```

The schema field is `receiptFiles`, an array (`expenseModel.js:69`). There is no
`receipt` path on the model, so this predicate is always false.

This is the legacy-key fallback: objects written before keys were tenant-prefixed live
at `{employeeId}/{file}` and can only be judged by finding the record that references
them. For expense receipts that lookup never matches, so **every pre-prefix receipt is
permanently unreachable** — `assertKeyOwnedByTenant` throws "That file belongs to
another company" against its own tenant's file. Confirmed by test.

Fix is one string: `"receiptFiles.key"`.

### B5 · Input validation is thin — **medium**

- **Negative amounts accepted.** `addExpenseAction:686` guards `!amount`, which rejects
  `0` and `undefined` but passes `-500`. Same at `:61` for category budget. Both
  confirmed by test. The client has `min: 0` rules
  (`addExpense.jsx:71`, `AllExpense.jsx:127`) — client-side only, and a server action is
  directly callable.
- **The category is never verified.** `:712` does `findById(data.category)` and, if it
  finds nothing, files the expense anyway with `categoryLabel: "Uncategorized"`
  (`:723`). A garbage id, a deleted category, or another tenant's category all produce a
  saved expense. Under enforcement the cross-tenant case still writes the row — the
  lookup returns null and the code shrugs. Confirmed by test.
- **No `min: 0` on the model.** `expenseModel.js:46` and
  `expenseCategoryModel.js:16` — the last line of defence is absent too.

### B6 · `checkDuplicateName` drops the company when projects are given — **medium**

`expenseServer.js:28-44`. When `projectIds` is non-empty the query matches on
`projectIds` alone; `companyId` is never applied. Two different *businesses* inside one
tenant that share a project therefore collide, and the error message says "already
exists in this selected projects" for a category the admin cannot see.

The tenant plugin masks the worst of it — the query is still tenant-filtered, so this
cannot leak across tenants (the test confirms two tenants may both create the same
project-scoped name). It is a correctness bug inside a tenant, not an isolation one.

### B7 · Plan gating is cosmetic — **medium**

`lib/tenantPlan.js:15` maps `/admin/expense` → the `expenses` feature flag, and
`filterMenuByFeatures` removes the sidebar entry for a tenant without it
(`selectServer.js:375`). But `proxy.js` builds its guard from the raw `MENU` and never
calls `isPathAllowed`, and no expense action checks `features.expenses`.

A tenant whose plan excludes Expenses can still use the entire feature by typing the
URL. The flag hides the door; it does not lock it.

### B8 · Missing index for the common query — **low**

`getAllExpenses` filters on `tenantId + projectId + date` and sorts by `createdAt`. The
plugin adds `{ tenantId: 1, createdAt: -1 }` (`tenantPlugin.js:280`), which does not
serve the site-expense tab's `projectId` filter. Worth
`{ tenantId: 1, projectId: 1, date: -1 }` on the expense schema before this grows.

---

## 3. Findings — frontend

### F1 · The expense table's columns are off by one — **high**

`app/(feature)/Expense/category/expenseTable.jsx`. Nine `<TableHead>` (lines 38-46) and
**ten** `<TableCell>` per row (lines 53-81). An extra cell was inserted for "View
Invoice" without a matching header.

Every column from "Status" rightward is mislabelled:

| Header | What is actually under it |
|---|---|
| Status | the "View Invoice" link |
| Receipt Files | the status badge |
| Action | the receipt *count* |
| *(no header)* | the View / Edit buttons |

### F2 · The Edit button throws — **high**

`expenseTable.jsx:78` calls `setIntialValues(expense)`. Neither caller passes it —
`category/allExpenseCategory.js:34` renders `<ExpenseTable filter={filter} />`, and
`app/admin/siteAssign/features/siteExpense.js:44` the same. Clicking Edit is an
uncaught `TypeError`. (Note the spelling: `setIntialValues`, not `setInitialValues`.)

The adjacent "View" button (`:76`) has no `onClick` at all.

### F3 · Every server-side failure renders as an empty table, silently — **high**

`hooks/use-query.js:16`:

```js
const parsedData = JSON.parse(response?.data);
```

Unconditional. Every expense action returns `{ success: false, message }` with **no
`data`** on failure, so this is `JSON.parse(undefined)` → throws → React Query retries
three times at 2s intervals → `data` stays undefined → the table renders zero rows and
the user is told nothing.

"Not authorised", "database down" and "no expenses yet" are visually identical. This
hook is shared far beyond Expenses, so the fix is broad — see §5, Phase 3.

### F4 · Search, date filter and pagination do not reach categories — **medium**

`AllExpense.jsx:29` — `export default function AllExpense()` takes no props, but
`Expense.js:9` passes `filter={searchParams}`. It is dropped. The query hardcodes
`{ page: 1, limit: 10, isActive: true }` (`:56-62`), and `totalCount` is destructured
at `:65` and never used, so no pagination control is rendered.

With more than ten categories, the eleventh is unreachable through the UI.

### F5 · A second, inert Add-Expense dialog — **medium**

`AllExpense.jsx:86` renders `<AddExpense />` inside `CardContent` with no props at all —
no `fields`, no `open`, no `onClose`. `category/addExpense.jsx:29` then evaluates
`open={initialValues ? true : open}` where both are `undefined`, handing the Radix
Dialog an `undefined` `open` prop, which silently switches it to uncontrolled. It is a
stray duplicate of the dialog `AddAdminExpense` already owns (`addExpense.jsx:157`).

### F6 · `FetchExpenseCategory` checks the wrong field — **medium**

`ExpenseCategory.js:10` — `if (response.status)`. Every action in this module returns
`success`, never `status`. The condition is always false and the hook always returns
`[]`.

Its only consumer is `ExpenseChart.jsx:18`, which is itself never mounted (F7).

### F7 · Dead code

- `ExpenseChart.jsx` and `ExpenseCategoryChart.jsx` — never imported by any page.
- `pdf.jsx` — a zero-byte file.
- `getExpenseCategoryById` and `getExpenseCategoriesStats` — no caller anywhere, yet
  both are live unauthenticated endpoints (B1).

`getExpenseCategoryById` is also incoherent on its own terms: `:531` picks
`categoryId || projectId || companyId` merely to validate *something* is an ObjectId,
then builds the match from all three and returns `result[0]` — so calling it with only a
`companyId` returns an arbitrary one of that company's categories.

### F8 · The two components are named the wrong way round — **low**

`AllExpense.jsx` renders **"All Expense Categories"**.
`category/allExpenseCategory.js` renders **"Site Expenses"**.

Both files are lying about their contents, and the `category/` directory contains the
expense list while the parent contains the category list. This is why F4 and F5 were
easy to introduce.

---

## 4. Branding — where it stands and how to use it

### What already exists

The branding infrastructure is built and working; Expenses simply never adopted it.

| Piece | Where |
|---|---|
| Stored per tenant | `models/companyModel.js:42-59` — `appName`, `logoUrl`, `logoDarkUrl`, `faviconUrl`, `primaryColor`, `accentColor`, `radius`, `supportEmail`, `emailFromName`, `emailFooterHtml` |
| Defaults applied | `lib/tenant.js:41-56` — `resolveBranding(tenant)` |
| Server-side read | `server/tenantServer/tenantServer.js:266` — `getBrandingForCurrentUser()`, open to any signed-in user |
| Injected into the shell | `app/admin/layout.jsx:34-42` — writes `--primary`, `--accent`, `--radius` into `:root` |
| Client hook | `app/admin/providers.jsx:19` — `useBranding()` |
| Edited by the tenant | `app/admin/settings/brandingForm.jsx` |
| Edited by the platform | `app/platform/tenants/[id]/tenantDetail.jsx:177` |

Because colours land as CSS variables, **every component built on the design tokens is
already white-labelled with no work**. The tables, cards, buttons and dialogs in
Expenses are all fine. Today `useBranding()` has exactly one consumer:
`components/sidebar/sideBarCom.jsx:48`.

### Where Expenses breaks white-labelling

`app/(feature)/Expense/invoice.jsx` is the one screen that ignores all of it. It is
customer-facing — the closest thing this app has to a document a tenant would show
someone outside their company — and it is hardcoded to the original client:

| Line | Hardcoded | Should be |
|---|---|---|
| :93 | a Cloudinary logo URL | `branding.logoUrl` |
| :108 | `"Creative Design & Construction Ltd."` | `branding.appName` / tenant `name` |
| :201 | `info@cdc.construction` | `branding.supportEmail` |
| :208 | `020-8004-3327` | *no field exists yet — see below* |
| :177 | `£{amount.toFixed(2)}` | `formatCurrency(amount, locale.currency)` |
| :53-83 | a fixed decorative SVG in `#B2E7FE` / `#FF8F5D` / `#4C48FF` | design tokens, or drop it |

Serve `Beta Corp` an invoice today and it says Creative Design & Construction Ltd. with
a competitor's logo on it.

Two supporting gaps:

- **`utils/time.js:41`** — `formatCurrency(value, currency = "GBP")` with a hardcoded
  `en-GB` locale. `companyModel.js:85-94` already stores `locale.currency`,
  `locale.dateFormat`, `locale.timezone` and `locale.country` per tenant, and nothing
  reads them. A tenant configured for EUR still sees `£`.
- **No support phone.** `brandingSchema` has `supportEmail` but no phone number, so
  invoice.jsx:208 has nothing to bind to. Add `supportPhone` to the schema and to both
  branding forms.

Also note `invoice.jsx:180-190`: the "Invoice PDF" and "Print" buttons have no handlers.
Print is a two-line fix (`window.print()` plus an `@media print` block). PDF is real
work — `pdf.jsx` is the empty file someone started for it.

*(Phase 4 wired Print and removed the dead PDF button and file. A real PDF export is
still outstanding — see §7.)*

### The rule to apply

> Anything a tenant's own people see gets branding from CSS tokens automatically and
> needs no code. Anything that names, logos or contacts the company — the invoice, and
> emails — must read `useBranding()` (client) or `getBrandingForCurrentUser()` (server).
> Currency and dates must come from the tenant's `locale`, never a literal.

---

## 5. Fix plan

Five phases, ordered so the highest-risk item ships first and nothing depends on a later
phase. Each ends with `scripts/test-expense.mjs` going further green — the numbers below
are the tests that should flip.

### Phase 1 — Authorisation ✅ **DONE** *(fixed B1, B7)*

**Result: 23/32 under `enforce`, 24/32 under `shadow`. Every authorisation and plan test
passes in both modes; all remaining failures are Phase 2 and 3 items.** The existing
suites still pass unchanged (`test-tenant-scope` 12/12, `test-announcements` 44/44), and
`next build` is clean.

What shipped:

1. **`requireExpenseAccess()`** in `server/expenseServer/expenseServer.js`, modelled on
   `announcementServer.js:36-53` — plan flag, then superAdmin, then admin-with-the-
   `/admin/expense`-grant, then refused. Applied to all eight actions.

   It takes no `write` argument in the end. The plan proposed read and write variants,
   but they would have returned the same answer at every call site, and a parameter that
   never changes an outcome is a comment pretending to be code. The docblock records
   where the two rules *would* diverge — when employees can file their own expenses —
   so the split can be made when there is something to split.

2. **Reads return an empty page, not an error.** Following `announcementServer.js:23`.
   Two reasons: `hooks/use-query.js` parses `data` unconditionally and would throw on a
   payload that has none (F3, still open), and a caller who may not see the ledger should
   not be able to distinguish "not allowed" from "nothing here". Writes return
   `{ success: false, message: "Not authorised" }`.

3. **`lib/tenantFeatures.js`** (new) — `getTenantFeatures()`, lifted out of a private
   copy in `selectServer.js` so the menu filter and the expense guard read the flags
   through one function. Deliberately not `"use server"`, same as `lib/tenantAssets.js`:
   it backs an authorisation decision and must not be published as an endpoint.
   `lib/tenantPlan.js` stays pure, with no database behind it.

4. **`proxy.js`** now applies `isPathAllowed`, above the role checks so super admins are
   gated too.

   With one restriction the plan did not anticipate. The features available in the proxy
   come from `resolveTenant()`, which keys off the **hostname** — and `lib/tenantContext`
   is explicit that the hostname decides branding while the session decides data. So the
   check only denies when the host resolved to a real tenant *and* that tenant matches
   `session.user.tenantId`. An unresolved host, a single-domain deployment or a mismatch
   falls through, exactly as the rest of that file fails open. This is defence in depth
   for navigation; `requireExpenseAccess` is the enforcement that counts.

Two related gaps found while doing this:

- `getSelectExpenseCategory` and `getSelectExpenseCategoryBySite` fed the expense forms
  with no guard at all. **Fixed in Phase 2** — moved into the expense server rather than
  guarded where they sat.
- `RoleBasedModel` has no fixture in `seed-dev-fixtures.mjs`, so `scripts/test-expense.mjs`
  creates its own permission grants. Without them every admin in the suite would be
  refused and the tests would have passed for the wrong reason. Still outstanding as a
  fixture gap, though the test now covers itself.

### Phase 2 — Complete the API ✅ **DONE** *(fixed B2, B3, B4, B5, B6, B8)*

**Result: 39/39 in both `enforce` and `shadow`.** `test-tenant-scope` 12/12,
`test-announcements` 44/44, `next build` clean, no new lint.

1. **`updateExpenseAction`** and **`deleteExpenseAction`** (soft, matching the category
   actions). Receipts are deliberately not editable — replacing one orphans the old
   object and needs the S3 delete path in the same unit of work. A deleted expense keeps
   its receipt objects: it is still a financial record someone may have to produce, and
   Media Management already reclaims orphans.

   One rule that was not in the plan: **editing the amount or category of an approved
   expense returns it to pending.** An approval is a statement about a specific figure;
   letting that figure change underneath one would make the audit trail assert something
   nobody agreed to.

2. **`setExpenseStatusAction(id, status)`**, wrapped in `withAudit`. Plus a rule the plan
   did not call for: **nobody may rule on their own claim**, super admins included. An
   approval workflow where the filer is the approver records a decision that was never
   made.

   All four expense mutations are audited, not just this one — `Expense.create`,
   `.update`, `.delete`, `.setStatus`. The category mutations are **not**; they are
   configuration rather than money moving, and that felt like the line to draw. Easy to
   revisit.

3. **`getExpenseReceiptUrl(expenseId, key)`** — reuses `generateDownloadUrl` from
   `server/aws/upload.js` as the plan asked, but narrower than proposed. That helper
   accepts any key the company owns, which for the expense page is too much: it would
   let the receipt viewer sign an employment contract or a payslip. The key must appear
   on the named expense first, so this feature's reach stops at this feature's files.

4. **`lib/tenantAssets.js`** → `"receiptFiles.key"`.

5. **Validation.** `positiveAmount()` on expense amounts and category budgets, real date
   parsing, ObjectId checks on company and project, `min: 0` on both schemas. The
   category is now resolved **before** the receipt upload rather than after — uploading
   first left an orphaned object counted against the company's storage allowance for an
   expense that was never created. An unresolvable category is refused instead of being
   written as `"Uncategorized"`.

6. **`checkDuplicateName`** now always carries `companyId`. Also escapes regex
   metacharacters in the name — it interpolates straight into a `RegExp`, so a category
   called `A+` or `(new)` was either a syntax error or a pattern matching the wrong rows.

7. **Deleted `getExpenseCategoryById` and `getExpenseCategoriesStats`.** Both were dead
   *and* live endpoints. The stats one was redundant besides:
   `getAllExpenseCategories` already returns the same totals in its `summary` block, so
   Phase 5's charts have something to read without it.

8. **Added `{ tenantId, projectId, date }`** to the expense schema (B8, pulled forward —
   it is one line and belongs with these changes).

**A bug the tests found that no amount of reading had:** `ExpenseModel` never had
`createdBy`, `updatedBy` or `isActive` fields, so Mongoose silently discarded all three
on every write `addExpenseAction` made. The self-approval check read `createdBy` and
therefore matched nobody — the test failed, which is the only reason it surfaced. The
filer is `employeeId`; `updatedBy` is now a real field carrying the approver, and the
two phantom writes are gone.

**Also fixed (the flagged item from Phase 1):** `getSelectExpenseCategory` and
`getSelectExpenseCategoryBySite` moved out of `selectServer.js` into the expense server,
behind `requireExpenseAccess`. Moving them beat guarding them in place — every other
export in `selectServer.js` is open to any signed-in user, and bolting one
feature-shaped guard onto a shared file invites the next person to assume the rest are
guarded too. `getSelectExpenseCategoryBySite` also now rejects a non-ObjectId
`projectId`, which the site tab passes as the literal `"__no_project__"`.

### Phase 3 — Make the UI tell the truth ✅ **DONE** *(fixed F1, F2, F3, F5)*

**Result: 42/42 in both modes, `test-tenant-scope` 12/12, `test-announcements` 44/44,
`next build` clean, Phase 3 files lint clean.**

1. **`expenseTable.jsx` rebuilt.** Columns now come from one `COLUMNS` array, so the
   header row and the body row cannot drift again — that is what produced the off-by-one.
   Edit calls the Phase 2 update action, the invoice opens from an icon, and pending rows
   get approve / reject. Receipts are one button per file, signed on click rather than
   rendered into the table: a row of pre-signed URLs would start expiring the moment the
   page loaded. Loading, error and empty are now three distinct states.

2. **`hooks/use-query.js`** — the blast radius turned out to be much smaller than the plan
   assumed, and it is worth recording why. **The old line already threw.**
   `JSON.parse(undefined)` parses the string `"undefined"` and raises a SyntaxError, so
   React Query was already treating every refusal as an error and leaving `data`
   undefined. The control flow across all 77 consumers is unchanged. What changed:

   - the error carries the server's own message instead of `"undefined is not valid JSON"`;
   - a business refusal is no longer retried three times at 2s intervals. Roughly twelve
     actions report an *empty* result as `{ success: false, message: "No Data Found" }`,
     and those were each costing three pointless round-trips. `ActionError` marks a
     refusal so `retryPolicy` can skip it while still retrying genuine failures.

   Three new tests pin the contract the hook now depends on, since the hook itself needs
   a browser to test: every read returns parseable data, a *refused* read still does (the
   empty-page path — otherwise the table would show an error where it should show
   nothing), and a refused write always carries a non-empty message.

3. **F5 pulled forward from Phase 5.** The stray propless `<AddExpense />` in
   `AllExpense.jsx` had to go now rather than later: the dialog it renders was being
   reworked around it, and leaving a second broken copy behind while rewriting its
   neighbours was not defensible.

Two things the plan did not anticipate:

- **`category/addExpense.jsx` now handles add *and* edit.** Splitting them would have
  duplicated six field definitions to change a title and a mutation. It filters the form
  down to the fields `updateExpenseAction` accepts, so company and receipt are absent in
  edit mode rather than shown and silently ignored.
- **`allExpenseCategory.js` became a client component.** The edit selection has to live
  above both the table and the dialog, and `AddAdminExpense` is what owns the form fields
  and the category options — so the state sits in their common parent, which needed
  `"use client"`.

### Phase 4 — Branding the invoice ✅ **DONE** *(fixes §4)*

**Result: 46/46 in both modes** (four new branding/locale tests), `test-tenant-scope`
12/12, `test-announcements` 44/44, `next build` clean.

1. **`invoice.jsx` rewritten.** Logo, issuer name, support email and support phone all
   come from `useBranding()`. The hard-coded Cloudinary logo, "Creative Design &
   Construction Ltd.", `info@cdc.construction` and `020-8004-3327` are gone.

2. **`supportPhone`** added to `brandingSchema`, `resolveBranding`, `BRANDING_FIELDS`,
   `brandingForm.jsx` and `tenantDetail.jsx`. That allow-list matters: a field missing
   from `tenantOps.BRANDING_FIELDS` saves silently and vanishes, so there is a test
   asserting it is there.

3. **`locale.currency` plumbed through.** A new `resolveLocale()` in `lib/tenant.js`
   mirrors `resolveBranding()`, and `getBrandingForCurrentUser()` now selects `locale`
   and returns it alongside. Currency deliberately did *not* go into `resolveBranding` —
   a company can be white-labelled without changing currency and vice versa.

   `formatCurrency` takes the code and derives the number locale from it, so EUR renders
   as `€1.234,56` rather than `€1,234.56`. Defaults stay GBP/en-GB, so the four existing
   callers are unchanged. Both expense tables now pass the company's currency too — the
   invoice was not the only place hard-coded to sterling.

4. **The decorative SVG** was a fixed `#B2E7FE`/`#FF8F5D`/`#4C48FF` composition that
   fought every tenant's palette. Rebuilt on `bg-primary` and the card token, so it
   follows whatever the company set.

5. **Print wired**, `pdf.jsx` deleted. `window.print()` alone would have printed the
   invoice wrapped in the sidebar and the page behind it, so `app/globals.css` gained a
   `@media print` block that hides everything except a `.print-target`. It uses
   `visibility` rather than `display` because `display: none` on an ancestor would take
   the invoice down with it.

Two things worth recording:

- **The footer renders nothing when a company has set no contacts.** The old version
  could not do that — the address and number were literals — so every tenant's invoice
  told the reader to email a company they had never heard of. Saying nothing beats
  saying something false.
- **`formatCurrency(null)` returned `"£0.00"`** until a test caught it: `Number(null)` is
  `0`, so a missing amount rendered as a real figure of zero. It now returns `"—"`, as do
  `undefined` and `""`. The old code also rendered `"£NaN"` for undefined, and
  `invoice.jsx` called `.toFixed(2)` on the amount unguarded, which threw outright.

### Phase 5 — Tidy ✅ **DONE** *(fixes F4, F6, F7, F8)*

**Result: 46/46 in both modes, `test-tenant-scope` 12/12, `test-announcements` 44/44,
`next build` clean — and the expense feature is lint-clean for the first time.**

1. **The charts are deleted, not mounted.** The plan left this open; the code decided it.
   Both import `@/actions/siteExpenseAction/siteExpenseAction` — **there is no `actions/`
   directory in this repo.** `ExpenseChart` also imports `react-toastify` (not installed;
   the app uses `sonner`), `@/components/SearchBox` and `@/components/Chart/BarChartLabel`
   (neither exists). They are not dead code so much as fossils from an earlier codebase:
   mounting them would have meant writing four missing modules and adding a package the
   app deliberately replaced. `ExpenseCategory.js` went with them — the broken
   `status`/`success` hook (F6) had no other consumer.

2. **`categoryList.jsx` pages properly** (F4). It asked for `page: 1` and read
   `totalCount` without using it, so an eleventh category was unreachable.

   It pages in **component state, not the URL**, which the plan did not anticipate:
   `PaginationWithLinks` writes a fixed `?page=` param, and this card shares a page with
   the expense ledger that already owns it — wiring both would have made paging one page
   the other. This is the secondary table, so it keeps its position locally.

   It also no longer takes `filter`. The plan said to pass the URL filters in, but the
   search and date controls on that page sit *inside the expenses card* and read as
   belonging to it. Feeding them to a second table would have filtered it from a box that
   does not appear to be about it. Dropping the dead prop is the honest fix; the real
   defect was the pagination. Loading, error and empty are now distinct states here too.

3. **Renamed so the files say what they are** (F8), and the `category/` directory is
   gone — it held three files about *expenses* and none about categories, which is how F4
   and F5 went unnoticed in the first place:

   | Was | Now |
   |---|---|
   | `AllExpense.jsx` (rendered categories) | `categoryList.jsx` |
   | `expenseCategoryTable.jsx` | `categoryTable.jsx` |
   | `expenseForm.jsx` (category dialog) | `categoryDialog.jsx` |
   | `category/allExpenseCategory.js` (rendered expenses) | `expenseList.jsx` |
   | `category/expenseTable.jsx` | `expenseTable.jsx` |
   | `category/addExpense.jsx` | `expenseDialog.jsx` |
   | `addExpense.jsx` (the button) | `addExpenseButton.jsx` |

   `AddExpense` also became `ExpenseDialog`, since Phase 3 gave it the edit path too.

**Worth recording:** the rename broke a relative import (`../invoice` → `./invoice`) and
**ESLint passed anyway** — `next build` caught it. Lint is not a substitute for the build
on this codebase.

---

## 6. End-to-end tests ✅ **DONE**

**`e2e/expense.spec.js` — 10 tests, all passing.** `npm run e2e`.

This closes the gap the five phases could not: the backend suite calls server actions
directly, so nothing above them had ever been exercised. The off-by-one that started this
whole report built and linted cleanly for months.

**It runs its own server on port 3100 against the local fixture database.** That is the
single most important thing in `playwright.config.js`: `.env` points `MONGO_DB_URL` at a
shared Atlas cluster, and these tests create, edit, approve and delete records. It also
builds first and runs in production mode — Next 16 refuses to start a second *dev* server
in a directory that already has one, and a build is what actually ships.

Getting a browser through the front door needed two fixture additions, both of which were
real gaps rather than test conveniences:

- **Permission grants.** An `admin` reaches a page through their role's permission list,
  not their role name. With no `RoleBased` row, every admin fixture was refused
  everywhere — which made them useless for testing anything an admin should be able to do.
- **Two-factor.** `auth.js` forces every admin and super admin through 2FA, so no fixture
  account could reach the app at all. Rather than weaken that gate for tests, the fixtures
  now enable 2FA with a known secret (`scripts/lib/fixture-secrets.mjs`) and the tests
  generate real TOTP codes with `otplib`. The gate is *satisfied*, not bypassed.

  That constant lives in its own module because `seed-dev-fixtures.mjs` calls `main()` at
  import time — importing a constant from it seeds a database as a side effect, which on
  the first attempt meant an end-to-end run tried to reseed the production cluster. It was
  refused (the script checks the host), but nothing should depend on that.

### Three bugs it found immediately

None of these were reachable from the backend suite, and all three shipped through five
phases of review:

1. **The receipt field was labelled "(optional)" and validated as required.** Every
   expense filed without a receipt was refused, with the form contradicting both its own
   label and `addExpenseAction`, which treats receipts as optional. In both the admin and
   site forms.

2. **Editing an expense always failed with "Category is required".** The category field
   carries `dependField: ["companyId", "projectId"]` so its options reload when the
   company changes. GlobalForm's dependency effect fires once on mount and blanks the
   field it watches — and the edit form has no company picker, so it wiped the expense's
   existing category before the user could save. Fixed by stripping the dependency in edit
   mode; the general fix in GlobalForm was left alone because that effect is shared by
   every form in the app.

3. **Every `<Label>` on a select or date field named nothing.** `FormLabel` sets
   `htmlFor={name}` but no control carried that id, so the label was orphaned — a screen
   reader announces the control unnamed. Three one-line `id=` additions in
   `form-field.jsx`. This is app-wide, not expense-specific.

### What it does not cover

Printing. `window.print()` opens a native dialog no browser automation can assert
against, so the `@media print` rule in `app/globals.css` is still unverified — the one
thing from Phase 4 that has to be checked by a person, once, on paper.

## 7. Where this ended up

All five phases are done. The suite went from **15/28 to 46/46**, in both
`enforce` and `shadow`, with `test-tenant-scope` and `test-announcements` untouched at
12/12 and 44/44.

What is materially different:

- Eight unauthenticated server actions now have an authorisation guard and a plan check.
- The approval workflow the model always described actually exists, and is audited.
- Expenses can be corrected and removed; receipts can be read back.
- Every pre-prefix receipt is reachable again (`receiptFiles.key`).
- The invoice carries the viewing company's name, logo, contacts and currency.
- The table's columns line up, its buttons work, and a failure says so.

**Six bugs surfaced that no amount of reading had found, every one because a test ran.**
From the backend suite: `ExpenseModel` silently discarding
`createdBy`/`updatedBy`/`isActive`; `formatCurrency(null)` rendering `"£0.00"` for a
missing amount; and the charts' imports pointing at a directory that does not exist. From
the browser suite: a receipt field labelled optional and validated as required; an edit
dialog that blanked its own category and could never save; and every select and date
label in the app naming nothing to a screen reader.

That ratio is the argument for both suites. Five rounds of careful reading found the
first three only when something executed, and the last three only when something
clicked.

## 8. What is still unverified

Stated plainly so it is not mistaken for tested:

- ~~**No click-through happened.**~~ Closed by §6. Ten browser tests now cover the page,
  the table's alignment, the add and edit dialogs, approval, deletion and the invoice.
- **Printing is still unverified, and cannot be automated.** `window.print()` opens a
  native dialog no browser automation can assert against, so the `@media print` rule in
  `app/globals.css` has never been exercised. Print CSS looks right in source and comes
  out wrong on paper — this needs one person, once, with a print preview.
- **The category list's paging is not covered by the browser tests.** It needs more than
  ten categories to show a pager, and the fixtures have one. The logic is small and the
  clamp is derived rather than effected, but nobody has clicked Next.
- **The receipt *upload* path is still untested.** `scripts/test-expense.mjs` never sends
  a file, so `uploadImage` → `generatePreSignedUrl` → `assertStorageAllows` is exercised
  only by its existing S3 tests. B4 and the new `getExpenseReceiptUrl` were proven by
  writing the key shapes directly; the download side is covered, the upload side is not.
- **`getAllExpenses`' `decrypt` branch is untested.** `expenseServer.js:775` decrypts a
  non-ObjectId `projectId`; the tests pass real ObjectIds. That path is how the
  site-expense tab calls it (`addSiteExpense.jsx:24`), so it is live in production.
- ~~**Shadow mode was not run.**~~ Both modes now run and agree. Doing so caught two
  problems in the tests themselves: fixture lookups were resolving ids through the tenant
  scope — the very thing under test, so a shadow run silently handed later sections the
  wrong tenant's records — and two isolation tests asserted unconditionally where they
  should state the difference between the modes explicitly, per `test-announcements.mjs`.
- **Phase 1's `proxy.js` change is not covered by a test.** Middleware needs a request;
  the suite has none. The guard is small and fails open, but it was verified by reading
  and by `next build`, not by exercising it.

The test database is still up (`docker rm -f cdchr-test-mongo` to remove it).

# Branches, and sharing site employees between them

Status: **parked.** Options recorded below; no decision taken, nothing scheduled.
Written against `feat/multi-tenancy-phase-1`.

**Built so far:** phase 0 only — the login duplicate fix (§6), which was a live
bug and is independent of whichever option is eventually chosen. Everything else
here is design, not code.

## 0. The short version

The app has no concept of a branch, so customers create a second company to stand
in for one. That works for office staff, who belong to one branch, and fails for
site staff, who move between branches.

Four ways out, none of them started:

| | Idea | Sharing site staff | Tenant isolation | Migration needed | Verdict |
|---|---|---|---|---|---|
| **A** | Branches live inside one company | Free — same tenant | Untouched | Merge existing split companies | **Best if branches can share billing** |
| **B** | Keep two companies, share employee records across them | Works | **Hole in the plugin** | None | Rejected — blast radius |
| **C** | Company groups with a sharing policy | Works | Bounded hole | None | Fallback if A's merge is unacceptable |
| **D** | One `Worker` identity, one employment per company | Works | Untouched in daily queries | Reconcile duplicates | **Best if branches must stay separate** |

The question that decides A vs D: **is a branch ever billed separately, or need
its own domain and branding?** Yes → D. No → A. (§7 Q1 and Q4.)

Moving employees between companies as a way to *share* them was considered and
does not work — §8.

---

## 1. The situation

CDC is one business with two branches, London and Leeds. The app has no idea
what a branch is, so customers reach for the only thing that looks like one: they
create a second **company**. A company is a tenant, so "CDC London" and "CDC
Leeds" become two entirely separate worlds.

That is fine for office staff — they genuinely belong to one branch and are not
shared. It falls apart for site staff, who are shared by nature: the same
bricklayer is on a London site on Monday and a Leeds site on Wednesday.

Today there is no way to express that. To assign someone to a Leeds site, they
must exist as an `Employe` row with `tenantId = Leeds`. So the customer creates
the person twice, once per branch.

---

## 2. What is actually broken today

Verified against the code, not assumed.

**2.1 The same person in two branches cannot reliably log in.**
`LoginData` finds a site employee by email with no tenant filter and no sort
(`server/authServer/authServer.js:225`, inside `escapeTenant`). With two
`Employe` rows sharing an email it returns whichever Mongo hands back first —
and neither employee model has a unique index on `email`. The worker lands in an
arbitrary branch, and it can change between logins. **This is a live bug for any
customer already doing the workaround**, independent of everything else in this
document.

**2.2 Hours are split and nobody sees the total.**
`SiteClock` rows carry `tenantId`, so London's clock-ins and Leeds' clock-ins sit
in different tenants and are never summed. Weekly hours, overtime thresholds and
holiday accrual are each computed against half the truth.

**2.3 Right-to-work is tracked twice and drifts.**
Visa dates live on the `Employe` record. Two records means two copies. London
renews a visa, Leeds does not — and Leeds keeps someone on site whose record
says they are legal. The visa reminder cron (`server/visaServer/visaReminderJob.js`)
iterates tenants, so it also emails the same person twice.

**2.4 Pay is defined per copy.** `payRate` is on the `Employe` record
(`models/employeModel.js:111`), so the two branches can silently disagree about
what someone is paid.

**2.5 Announcements, documents and devices are duplicated** — including the
feature just built: a site employee shared across two branches gets two
"everyone" announcements, and acknowledges each separately.

Not affected, checked: **seat billing**. `checkTenantSeats` counts
`OfficeEmployeeModel` only (`server/officeServer/officeServer.js:27`), so
duplicating a *site* employee costs nothing in licensing.

---

## 3. There is no branch concept to build on

- `Employe` has no `company` field at all — only the `tenantId` the plugin adds.
- `OfficeEmploye` has `company`, but it is the legacy alias for `tenantId`
  (see the comment in `scripts/seed-dev-fixtures.mjs`), not a branch.
- `ProjectSite` has neither.

So this is a clean slate rather than a half-built feature to finish.

---

## 4. The options

Three are set out here. A fourth — **Option D**, one worker identity with an
employment per company — came out of the "can we just move people?" question and
lives in §8.3. Read that too before deciding; it is the strongest option whenever
branches have to stay separate companies.

### Option A — A branch is a thing *inside* one company (recommended)

CDC is one tenant. London and Leeds become `Branch` records within it. Sites,
office staff and rotas carry a `branchId`. Site employees belong to the company,
not to a branch, so assigning one to any branch's site is simply an assignment —
there is nothing to share.

- **Everything the customer asked for is free.** One person, one record, one
  visa, one pay rate, one timesheet across both branches.
- **The tenant boundary is untouched.** No exception to the plugin, nothing new
  that can leak between customers.
- **Branch separation for office staff becomes a second, weaker filter** layered
  over tenant scoping. A bug there shows a colleague the wrong branch. A bug in
  cross-tenant sharing shows a *different customer's* data. Those blast radii are
  not comparable, and this is the whole reason to prefer A.
- **Cost:** branch-scoping the office-facing screens, and a migration for
  customers who have already split into two companies (§6, phase 3).

### Option B — Keep branches as tenants, share site employees across them

A `SiteEmployeeSharing` edge, modelled on `TenantMembership`: one canonical
`Employe` owned by a home tenant, plus grants to others.

- **No merge migration**; branches keep separate branding, domains and billing.
- **But it puts a hole in the one invariant the codebase is built around.**
  `lib/tenantPlugin.js` exists precisely so a tenant filter cannot be forgotten,
  and `TENANT_SHADOW_FINDINGS.md` is the record of how hard that was to get
  right. Every read of `Employe` — and of clocks, assignments, documents,
  announcements that reference one — would need to know about shared rows.
- Ownership questions have no clean answer: which branch's payroll lock applies,
  who may edit the visa, who sees the bank details.
- `TenantMembership` is not the precedent it looks like. It is consulted *once*,
  at login, to decide which tenant the session runs as. It never makes a query
  return two tenants' rows at the same time. Sharing employees would.

### Option C — Company groups

A group above companies, with sharing declared as group policy rather than
per-record. Bounded version of B; still needs the plugin exception. Worth
revisiting only if A's migration turns out to be unacceptable.

---

## 5. Recommendation

*Superseded by §8.5, which weighs Option D as well. Kept because the reasoning
against B still stands.*

**Option A**, of the three above. A branch shares billing, branding, domain and
staff with its parent — which is the definition of *not* being a separate tenant.
Modelling it as one is what created this problem, and B would spend the
codebase's strongest safety property to preserve that mistake.

The honest catch: A is more work up front, and existing split customers need
merging. B looks cheaper because its cost is deferred into every future query
anyone writes against employees.

---

## 6. Phased plan

### Phase 0 — Stop the bleeding — **DONE**

Independent of every option below, and shipped.

1. ✅ `LoginData` (`server/authServer/authServer.js`) now searches all four
   account collections instead of short-circuiting, sorts deterministically, and
   reports duplicates to the audit log as `Auth.duplicateEmail`.
2. ✅ `DUPLICATE_LOGIN_POLICY=warn|block` — `warn` (default) picks
   deterministically without locking anyone out; `block` refuses the login. Same
   shape as `TENANT_ENFORCEMENT`'s shadow → enforce rollout, and documented in
   `.env.example`.
3. ✅ `npm run audit:duplicate-emails` (`scripts/find-duplicate-emails.mjs`) —
   read-only report of everyone who exists more than once, flagging which
   duplicates span companies and which record currently wins the login.

**Not done, deliberately:** the unique index on `email`. Adding one that existing
data violates fails quietly and would give false confidence. It is the right step
*after* the report comes back empty.

**Outstanding operational step:** run the report against production. Nobody has
yet, so the number of affected people is still unknown — and that number is also
the input to §7 Q5.

### Phase 1 — Branches exist
3. `models/branchModel.js` — `{ name, code, address, isActive }`, tenant-scoped
   like everything else.
4. `branchId` on `ProjectSite` and `OfficeEmploye` (optional at first, so
   existing records stay valid — the same rollout shape `tenantId` used).
5. Branch CRUD under `/admin/branches`, a `MENU` entry, and a plan flag.
6. A branch picker in the header for multi-branch companies, defaulting to
   "All branches" for anyone entitled to see more than one.

### Phase 2 — Branch becomes a filter
7. `lib/branchContext.js` — the current branch for a request, mirroring
   `lib/tenantContext.js` but deliberately **not** a Mongoose plugin: this is a
   UI filter, not a security boundary, and pretending otherwise would blur the
   two. Applied explicitly at the screens that need it.
8. Office staff, sites, rotas and attendance filtered by branch.
9. Site employees stay company-wide, and the assignment picker offers all of
   them — which is the feature this document is about.

### Phase 3 — Merge the customers who already split
10. A merge tool in the platform console: pick two companies, map one to a branch
    of the other, move rows, and reconcile duplicated site employees by email
    into a single record — keeping the union of clock history and the *latest*
    visa data, with a dry-run first. Same shape as
    `scripts/migrate-s3-tenant-prefix.mjs`, which already does dry-run-then-apply.

### Phase 4 — Follow-ups
11. Announcements: an optional branch axis on the audience (`audience.mode =
    "branches"`), which slots into the existing `audience.js` resolver.
12. Payroll and reporting grouped by branch.

---

## 7. Open questions for you

1. **Do branches share a login domain?** If London staff sign in at
   `london.cdc.com` and Leeds at `leeds.cdc.com`, that is a domain-per-branch
   requirement, and `tenantDomainSchema` currently binds domains to a company.
2. **Can an office employee ever belong to two branches** — a regional manager,
   say? You said office staff are not shared; confirming it means `branchId` can
   be a single value rather than an array.
3. **Whose payroll does a shared site employee land in** when they worked three
   days in London and two in Leeds? Split by clock record is the obvious answer
   and Option A supports it, but it needs to match how CDC actually invoices.
4. **Is a branch ever billed separately?** If yes, that pushes toward C and the
   answer to §5 changes.
5. **How many customers have already split into two companies?** If the answer is
   "one, and it is CDC", phase 3 could be a one-off script rather than a tool.

---

## 8. "Can we just move the employee between companies?"

Short answer: yes, it is buildable — but it answers a different question than the
one being asked. Moving is right for a worker who **relocates**. It is wrong for
a worker who is **shared**, and shared is the case in §1.

### 8.1 Why moving does not solve sharing

A move is a point-in-time change of `tenantId` on one record. That runs into five
walls, all of them verified against the code rather than guessed.

**The history cannot come with them.** `SiteClock`, `Clock`, `Attendance`,
`LeaveRequest` and `TimeOff` are all tenant-scoped. Two options, both wrong:

- *Move the history too* — London's own attendance and cost reports change
  retroactively every time a worker leaves. An audit trail that rewrites itself
  is not an audit trail.
- *Leave the history* — London keeps clock rows pointing at an `employeeId` that
  no longer resolves there. The plugin scopes `$lookup` into `employes` by
  tenant (`scopeLookupStage`, `lib/tenantPlugin.js`), so those joins match
  nothing and London's historical reports show blank names for work that really
  happened.

**Next week's rota cannot be built.** `SiteAssignment` is tenant-scoped and the
assignment picker only lists employees in the current tenant. Leeds cannot roster
someone for Wednesday until they already own them — so planning has to happen
after the move, which defeats the point of a rota.

**Two branches cannot both have them.** Ownership is exclusive. If London and
Leeds both need the same worker in the same week, one of them loses. The whole
premise in §1 is that both need them.

**Payroll lands wherever they happen to be sitting.** Whoever owns the record on
payroll day pays for hours the other branch consumed.

**It would run daily.** "Some days London, some days Leeds" means a destructive,
global, audit-generating operation per worker per day. Nobody will do that
reliably, and the day someone forgets, a worker clocks in against the wrong
company's books.

### 8.2 The distinction worth drawing

| | What it means | Right mechanism |
|---|---|---|
| **Transfer** | Worker leaves London, joins Leeds. Permanent. | A move. Small, genuinely useful, §8.4. |
| **Sharing** | Worker works for both, ongoing. | Not a move. §8.3 or Option A. |

### 8.3 Option D — one worker identity, many employments (best fit if branches stay separate companies)

This is the answer to "how do we share them" that does **not** require merging
companies and does **not** put a hole in tenant isolation.

Split the person from the job:

- **`Worker`** — the human. Email, password, name, NI, visa dates, right-to-work
  documents. Global, like `TenantMembership`, and in `GLOBAL_MODELS` for the same
  reason: it is read at login, before any tenant is known.
- **`Employe`** — becomes the *employment*, one per company, gaining a
  `workerId`. Keeps its own `payRate`, `projectSite`, assignments, clocks and
  leave, all still tenant-scoped exactly as today.

What this buys:

- One login, several employments — resolved at sign-in the same way office staff
  already choose between companies. **This is not a new pattern: it is precisely
  what `TenantMembership` does for office logins today**, applied to site staff.
- Right-to-work has one home, so London renewing a visa cannot leave Leeds
  holding a stale copy (§2.3). The reminder cron reads the worker, so it stops
  emailing the same person twice.
- Each branch keeps its own hours, its own pay rate and its own payroll —
  correct by construction, because clock records never move.
- **No cross-tenant reads in day-to-day queries.** Every operational screen still
  reads only its own tenant's `Employe` rows. The only shared collection is
  `Worker`, which is identity, not operations. That is what makes this materially
  safer than Option B in §4.

Costs, stated plainly: a schema change to a busy model, a login rework, and a
migration that reconciles today's duplicate rows into one worker each — which
`scripts/find-duplicate-emails.mjs` already reports.

### 8.4 If you want moving anyway — build it as *transfer*, not as sharing

Worth having regardless, because permanent relocations are real:

- Platform-console (or super-admin) action: pick employee, pick destination
  company, confirm.
- **History stays where it happened.** The employment is closed in the old
  company with an end date, and a new one opens in the new company. Nothing is
  rewritten.
- Under Option D this is trivial: close one employment, open another, same
  worker. Under today's model it means copying a record and accepting the split
  history in §8.1.

### 8.5 Recommendation

- If you are willing to merge London and Leeds into one company: **Option A**
  (§4) stays the recommendation. Sharing then costs nothing at all.
- If branches must stay separate companies — separate branding, domains,
  billing, office staff: **Option D**. It is the same shape as the membership
  model already proven here.
- **Moving records around as a way to share people: no.** Build transfer (§8.4)
  for relocations and pick A or D for sharing.

---

## 9. Sizing

**Option A — branches inside one company**

| Phase | Estimate |
|---|---|
| 0 — login duplicate fix | half a day — **done** |
| 1 — branch model, CRUD, picker | 3–4 days |
| 2 — branch filtering across office screens | 4–6 days |
| 3 — merge tool | 3–5 days, depends on Q5 |
| 4 — announcements + payroll by branch | 2–3 days |

**Option D — worker identity, many employments** (§8.3)

| Phase | Estimate |
|---|---|
| 0 — login duplicate fix | **done** |
| 1 — `Worker` model, `workerId` on `Employe`, backfill one worker per person | 2–3 days |
| 2 — login resolves worker → employments, with a company chooser | 2–3 days |
| 3 — move visa / right-to-work onto the worker, repoint the reminder cron | 1–2 days |
| 4 — assign an existing worker to a second company from the admin UI | 2 days |
| 5 — transfer action for permanent relocations (§8.4) | 1 day |

Roughly comparable in total. The difference is where the risk sits: A concentrates
it in a one-off migration you can rehearse, D spreads it across the login path
and the employee schema. A ends with a simpler system; D avoids ever having to
merge two live companies.

Phase 0 is done either way.

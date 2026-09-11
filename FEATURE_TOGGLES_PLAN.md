# Per-Tenant Feature Toggles — Report & Plan

Status: **all five phases built** (§5). Remaining optional work in §9.
Branch: `feat/multi-tenancy-phase-1`.

Two regression checks guard this work; run both after touching
`data/features.js` or any gated module:

    npm run audit:features         registry, gating, presets, dependencies
    npm run audit:feature-guards   server actions actually check the plan

Goal: a platform admin can turn a module on or off per company, so the same
codebase serves a construction firm (needs Project Sites, Site Employees, Site
Assignments) and a dental practice, hospital or warehouse (needs none of them,
and should never see them).

---

## 1. Headline: most of this already exists

This is not a greenfield feature. The plumbing was built with multi-tenancy and
is live today:

| Layer | File | State |
|---|---|---|
| Storage | `models/companyModel.js:68` `featuresSchema` | 8 boolean flags, all `default: true` |
| Decision | `lib/tenantPlan.js` `isFeatureEnabled` / `isPathAllowed` | works |
| Read | `lib/tenantFeatures.js` `getTenantFeatures` | works, fails open |
| Sidebar | `server/selectServer/selectServer.js:358` | filters MENU by features |
| Route guard | `proxy.js:281` | redirects to `/unauthorized` on a gated path |
| Platform UI | `app/platform/tenants/[id]/tenantDetail.jsx:467` `PlanTab` | 8 switches, saves |
| Write | `server/tenantServer/platformServer.js:235` `updateTenantPlan` | audited |

So the answer to "how can we ship this" is mostly **finish and harden what is
there**, not build something new. That is good news for the estimate and it also
means the risky part is different from what it looks like: the danger is a
company that *has* a module losing it, not a company seeing one it shouldn't.

### The 8 flags today

`crm`, `expenses`, `visitors`, `siteProjects`, `documents`, `devices`, `ai`,
`announcements`.

---

## 2. What is actually broken or missing

### 2.1 The user's own example is not gated

`siteProjects` covers `/admin/siteProject`, `/admin/siteAssign`,
`/admin/siteAssignEmployee` — but **not `/admin/employee` ("Site Employees")**,
and not `/admin/previousEmployee` ("Previous Site Employees").

A dental practice with `siteProjects: false` today still gets a "Site Employees"
menu item, a whole second staff population, and the `/employee` portal those
people sign into. This is the single most visible gap and it is exactly the case
that prompted the request.

### 2.2 Thirteen menu paths cannot be switched off at all

Not in `FEATURE_BY_PATH`, therefore permanently on:

`/admin/leaveManagement`, `/admin/officeEmployee`, `/admin/attendance`,
`/admin/weeklyRota`, `/admin/employee`, `/admin/filterAttendance`,
`/admin/roleType`, `/admin/company`, `/admin/auditLogs`, `/admin/settings`,
`/admin/email`, `/admin/previousOfficeEmployee`, `/admin/previousEmployee`.

Some of those *should* be permanently on (Company, Settings, Audit Logs — core).
Others are plainly optional per vertical: a small dental practice does not want
Weekly Rota or Filter Attendance. Right now there is no way to express that.

### 2.3 Three flags gate paths that aren't in the menu

`visitors` → `/admin/visitors`, `devices` → `/admin/device`, `crm` →
`/admin/leads` — none of these have a live `MENU` entry (the CRM one is
commented out at `data/menu.js:145`). The switches exist in the platform UI and
appear to do something; they only affect a URL nobody can navigate to. Either
wire the pages into MENU or mark the flags as not-yet-shipped in the UI.

### 2.4 Gating is navigation-only for 7 of 8 modules

`proxy.js` guards page loads. Server actions are separate entry points and are
**not** guarded — except `expenses`, which does it properly at
`server/expenseServer/expenseServer.js:113`. That is the pattern; nothing else
follows it.

Concretely: with `siteProjects: false`, a POST to a site-project server action
from a crafted client still executes. Low severity (the caller must already be
an authenticated user of that company), but it is a plan-enforcement hole and it
will become a real one when billing depends on these flags.

### 2.5 Three places to add a feature

Adding a flag today means editing `featuresSchema` (companyModel),
`FEATURE_BY_PATH` (tenantPlan) and `FEATURE_LABELS` (tenantDetail.jsx:74).
Miss one and the failure is silent: a switch that saves nothing, or a flag that
gates nothing. This is the same class of bug `data/emailFeatures.js` was written
to stop — the fix there was one registry, and it should be the fix here.

### 2.6 No dependencies between flags — **fixed in Phase 4**

Site Assignments without Project Sites is a broken screen. Site Attendance
without Site Employees is an empty table. Nothing stops a platform admin
producing those combinations, and nothing warns them.

### 2.7 No presets — 8+ switches, flipped by hand, per company — **fixed in Phase 4**

Onboarding a dental practice means knowing which of N switches to turn off. That
is tribal knowledge, done differently each time, with no record of intent. There
is no "industry" on the company at all (`models/companyModel.js` has `billing.plan`
as free text, and signup does not ask).

### 2.8 Surfaces that ignore features entirely

- **Dashboard** (`app/admin/dashboard/dash.js`) renders a "Total Site" count card
  regardless. A warehouse sees a site metric it has no sites for.
- **Permissions screen** (`app/admin/permissions/permission.jsx:70`) offers every
  MENU path as an assignable permission, including modules the company doesn't
  have — admins grant access to a page that then redirects to `/unauthorized`.
- **`/employee` portal** (`app/employee/layout.jsx`) has no feature check.
- **`/hr` reception portal** and `/visitor` — same.
- ~~**Cron routes** don't check the flag before delivering.~~ **Wrong — see
  Phase 3.** `announcementScheduler.js` has always skipped disabled tenants.

---

## 3. Design decisions to take before building

These are the real forks. My recommendation on each is marked.

**D1 — Registry shape.** One `data/features.js` exporting a list of
`{ key, label, description, paths[], requires[], core }`, from which the
schema keys, `FEATURE_BY_PATH`, and the platform UI are all derived.
→ *Recommended.* Fixes §2.5 permanently and makes §2.6 expressible.

**D2 — Default for a flag not in the document.** Keep "absent = enabled".
→ *Recommended, do not change.* Every existing company relies on it; flipping to
"absent = disabled" would take modules away from live customers on deploy. It
also means new flags added in §4 are safe to ship — nobody loses anything until
someone explicitly switches it off.

**D3 — Presets vs. per-flag only.** Add named industry presets (Construction,
Healthcare/Clinic, Warehouse/Logistics, Office/Professional) that *apply* a set
of flags at one click, but store only the resulting booleans — the preset is not
persisted as a mode.
→ *Recommended.* Keeps one source of truth (the booleans) and avoids a second
enforcement path. A stored `industry` string that gating reads would be a
parallel system that can disagree with the flags.

**D4 — Hard-off vs. soft-off for data that already exists.** If a company with
200 site employees is switched to `siteEmployees: false`, the records stay in the
database and become unreachable. Do we hide or warn?
→ *Recommended:* keep data, and have the platform UI warn before saving when the
module being switched off has non-zero records ("this company has 200 site
employees; they will be hidden, not deleted"). Never delete on toggle.

**D5 — Who else can toggle.** Platform admin only, or also the company's own
super admin?
→ *Recommended:* platform admin only, for now. These flags are the commercial
boundary; a customer switching their own modules on is a billing question, not a
settings question. Revisit if self-serve plans ship.

---

## 4. Proposed flag set after this work

Existing (unchanged keys, so no migration):
`crm`, `expenses`, `visitors`, `siteProjects`, `documents`, `devices`, `ai`,
`announcements`.

New, all defaulting to on:

| Key | Covers | Why optional |
|---|---|---|
| `siteEmployees` | `/admin/employee`, `/admin/previousEmployee`, the `/employee` portal | Non-construction verticals have one staff population, not two |
| `weeklyRota` | `/admin/weeklyRota`, `/admin/my-weekly-shifts` | Shift planning; salaried offices don't roster |
| `leave` | `/admin/leaveManagement`, `/admin/my-leaves` | Some customers run leave in an external HR system |
| `attendanceReports` | `/admin/filterAttendance` | Reporting layer, not everyone buys it |
| `reception` | `/hr`, `/admin/reception` | Front-desk/visitor scanning is a clinic/office thing |

Explicitly **core, never gateable**: `/admin/dashboard`, `/admin/company`,
`/admin/settings`, `/admin/email`, `/admin/auditLogs`, `/admin/officeEmployee`,
`/admin/attendance`, `/admin/permissions`, `/admin/my-*`. Marking these `core:
true` in the registry documents the decision instead of leaving it implied by
absence.

Dependencies (`requires`): `siteProjects` → `siteEmployees`; `attendanceReports`
→ nothing; `siteAssignEmployee` paths live under `siteProjects` and therefore
inherit.

Presets:

- **Construction** — everything on (today's behaviour).
- **Healthcare / Clinic** — off: `siteProjects`, `siteEmployees`, `devices`, `weeklyRota` on, `reception` on.
- **Warehouse / Logistics** — off: `siteProjects`, `visitors`, `crm`; on: `siteEmployees`, `weeklyRota`.
- **Office / Professional** — off: `siteProjects`, `siteEmployees`, `devices`, `visitors`.

---

## 5. Shipping plan

Four phases. Each is independently deployable and each leaves the app working.

### Phase 1 — One registry, no behaviour change ✅ **DONE**

1. New `data/features.js`: the list from §4, existing keys only, with
   `paths[]`, `requires[]`, `core`.
2. `lib/tenantPlan.js` derives `FEATURE_BY_PATH` from it (keep the exported name
   — `proxy.js` imports the behaviour, not the constant).
3. `models/companyModel.js` builds `featuresSchema` from the registry.
4. `tenantDetail.jsx` drops its local `FEATURE_LABELS` and reads the registry,
   rendering `description` under each switch.

**Verified:** the derived `PATH_TO_FEATURE` was diffed against the previous
hard-coded map and the derived key list against the previous schema keys — both
identical, so no company's effective plan changed. Registry integrity (no
duplicate key, no path claimed by two modules, no unknown `requires`) checked in
the same pass. `eslint` clean on all four files; `next build` succeeds including
the Proxy middleware, which is what proves `data/features.js` stays edge-safe.

One addition beyond the refactor: each switch now renders its `description`, so
the operator is not guessing what a two-word label takes away.

### Phase 2 — Close the coverage gaps ✅ **DONE**

1. Five new flags added — `siteEmployees`, `weeklyRota`, `leave`,
   `attendanceReports`, `reception` — all defaulting on, so no live company's
   effective plan moved. 13 modules, 21 gated paths.
2. Missing paths mapped, including **`/admin/employee` and `/admin/previousEmployee`
   under `siteEmployees`** — the §2.1 fix.
3. `/employee` and `/hr` added to the registry (so `proxy.js` gates them for
   free) *and* backstopped in their layouts, which had to be split into a server
   layout + a client shell (`employeeShell.jsx`, `receptionShell.jsx`) because a
   `"use client"` layout cannot await a feature lookup. The layout check is what
   covers single-domain deployments, where the `proxy.js` gate's
   hostname-matches-session condition never holds.
4. `CORE_PATHS` added: the 14 paths that must never be gateable, each with the
   reason. Nothing reads it — gating still works by absence — but the decision is
   now reviewable instead of indistinguishable from an oversight.
5. Dashboard: the site-count and site-employee cards drop out with their modules.
   Permissions picker: modules the plan excludes are no longer offerable (they
   previously appeared to grant and then bounced the admin to `/unauthorized`).
   Both go through a new `getPlanFeatures` action and `useTenantFeatures` hook,
   since these are client components.

**Correction to §2.3:** the `crm`, `visitors` and `devices` pages *do* exist —
they are simply absent from `data/menu.js`. So `shipped: false` was the wrong
framing: the flags gate real URLs and work. They are now listed in
`UNLINKED_FEATURE_KEYS` and carry a "no menu entry" badge in the platform UI,
which warns that switching one **on** will not make it appear for anyone.
Whether they belong in the sidebar is a product question, left open.

**Verified:** a scripted check over the registry — no duplicate key, no path
claimed by two modules, no unknown `requires`, every `CORE_PATHS` entry survives
with all 13 flags off, and both `{}` and `undefined` features gate nothing.
Path-prefix collisions checked explicitly: `/admin/employeeAttendance` is not
swallowed by `/admin/employee`, nor `/employeeXYZ` by `/employee`. `eslint`
clean; `next build` compiles.

One unplanned improvement: `/employee`, `/hr`, `/hr/scanner` and
`/hr/employeeScan` were being **statically prerendered** despite being
authenticated portals. The `force-dynamic` the plan check requires has made them
dynamic, which is what they should always have been.

### Phase 3 — Enforce in server actions ✅ **DONE**

`lib/requireFeature.js` exports `featureRefusal(key)` — named for what it
returns (the refusal, or `null` when allowed) rather than `requireFeature`,
which reads as if it throws. It returns `{ success: false, message }` because
that is the shape `hooks/use-query.js` unwraps; throwing would surface as a
generic client error instead of a sentence the user can read. Not a `"use
server"` module, for the same reason as `lib/tenantFeatures.js`.

It short-circuits to "allowed" when there is no session. Saying "not included in
your plan" to a signed-out caller would be misleading, and the action's own auth
guard already refuses in its own words.

Applied to **54 exported actions** across seven files. Two of them needed one
edit each rather than many, because every export already funnelled through a
single guard — `requireAuthor()` for announcements (11 exports) and
`requireSuperAdmin()` for documents (4). In both the plan check goes **before**
the role check: a super admin passes every role test and must still not operate
a module their company does not have.

**Two corrections the code forced:**

1. **The cron was already handled.** §2.8 claimed
   `app/api/cron/announcements` delivered regardless of the flag. It does not —
   `announcementScheduler.js` has skipped disabled tenants since it was written.
   It compared the raw flag by hand, so it now calls `isFeatureEnabled` instead,
   keeping "absent means enabled" a single decision. No behaviour change.
2. **`deviceManagementServer.js` is not the devices module.** Despite the name it
   backs the *reception desk's* trusted-tablet list
   (`app/admin/reception/components/deviceManagement.jsx`); the `devices` module
   is the inventory in `deviceServer.js`. Gating it under `devices` would have
   broken reception for any company with the front desk but not the inventory,
   so it is gated under `reception`.

**Deliberately left ungated,** each with a comment saying why:

- `verifyDevice` — the device-trust check itself, called from
  `/api/reception/verify-device` before a session exists. `featureRefusal`
  answers "allowed" without one, so a gate here would look like enforcement
  while doing nothing.
- Site clock-in (`storeSiteEmployeeClockTime`, `canEmployeeClockToday`) — reached
  through QR scanning, and attendance is the one path where a wrong refusal
  costs someone their pay. The `/employee` portal that issues the codes is
  already closed by Phase 2, so the exposure is a stale QR code. Worth doing,
  worth doing carefully, and not as a side effect of this phase.

**Verified:** `scripts/audit-feature-guards.mjs` (`npm run audit:feature-guards`)
statically checks that every exported action in each gated file reaches the
plan check — following both the shared-guard and the `withAudit(…, someHandler)`
indirections. It found nothing by luck: run against a deliberately removed
guard it reports the exact export and exits 1. It also covers
`expenseServer.js`, the original pattern, at 12 exports. `eslint` clean; `next
build` compiles.

The audit exists because this rule is invisible: a new export added to any of
these files is ungated by default and nothing else would complain.

### Phase 4 — Platform admin UX ✅ **DONE**

1. **Presets** — four vertical buttons (Construction, Healthcare/clinic,
   Warehouse/logistics, Office/professional) that set the switches locally; the
   operator still reviews and presses Save. Nothing but booleans is stored (D3),
   and the button for whichever preset the current switches happen to match is
   highlighted — derived, never persisted, so editing a switch simply clears it.

   Each preset lists only what it switches **off**. A module added to the
   registry later is therefore ON under every existing preset, matching the
   absent-means-enabled rule; the alternative would silently exclude new modules
   from customers nobody asked.

2. **Grouping** — six headings (Workforce, Sites & projects, Front desk &
   visitors, Finance, Communication & files, Advanced). `FEATURE_GROUPS` is
   filtered against `FEATURES`, so a module given a group the console does not
   render cannot go missing silently.

3. **Dependencies enforced, not advertised** —
   `resolveFeatureDependencies()` in `lib/tenantPlan.js` runs to a fixed point
   (capped at `FEATURES.length` passes, so a `requires` cycle from a bad edit
   cannot hang it). **Off wins**: an unmet prerequisite switches the dependent
   off, never the reverse — the opposite rule would let switching one module on
   quietly enable another the customer is not paying for.

   Applied in both places: the console cascades as you toggle and disables a
   dependent whose prerequisite is off (a switch that springs back is worse than
   one that will not move), and `updateTenantPlan` resolves again on save, so a
   direct API call cannot store an inconsistent pair either. The save resolves
   against the company's *existing* flags merged with the incoming ones, so a
   partial update is judged together with the flags it does not mention. Cascaded
   modules are named back in the success message.

   `updateTenantPlan` now also ignores keys absent from the registry. It used to
   write `features.<anything>` straight through.

4. **Impact warning** (D4) — `getTenantModuleUsage()` counts each module's
   records for the company, and a switch being turned off shows "N records will
   be hidden, not deleted". Modules with no records of their own (attendance
   reports, AI) are absent from the map rather than reported as `0`, which reads
   as "nothing there" and is a different claim.

5. **Core modules** — there are no `core: true` *flags* to render as locked rows,
   because core is a property of paths, not modules (`CORE_PATHS`). A locked
   switch for something that has no flag would be theatre. Instead the section
   ends with a plain sentence naming what is always included.

**Verified:** `npm run audit:features` — 42 assertions over registry shape,
core-path reachability, prefix collisions, absent-means-enabled, menu filtering,
group coverage, preset completeness and consistency, and dependency resolution
(enforcement of every declared `requires`, purity, idempotence, termination on
all-off and all-on). Negative-control tested: against a preset with an unknown
key, a path that swallows `/admin`, and a group nothing renders, it reports all
three and exits 1. `audit:feature-guards` still passes at 54 actions; `eslint`
clean; `next build` compiles.

**Assumption to confirm (§8 Q4):** the four presets are the ones proposed in §4,
which you have not yet confirmed. They are pure data in `data/features.js` —
changing the list or what each excludes is a one-file edit with no code change.

### Phase 5 — The customer's view of their own plan ✅ **DONE**

§8 Q3, answered: **hidden everywhere operational, listed on one informational
page.** The split is the whole design.

**Operational UI — completely hidden.** Already true, and re-checked: the
sidebar drops the entry (`selectServer.getEmployeeMenu`), the route redirects
(`proxy.js`), the actions refuse (`lib/requireFeature.js`), the dashboard omits
the cards and the permissions picker will not offer them. A sweep of the
sidebar, dashboard and notification components found no hard-coded link to a
gated module — the sidebar renders only the filtered list it is handed.

**Informational UI — a Plan tab on `/admin/settings`**
(`app/admin/settings/planPanel.jsx`). Every module, grouped as in the console,
each either ticked as included or shown locked and greyed with the badge
**"Not included in your plan"** and *"Contact support to enable"*. Strictly
read-only: what a company may use is a commercial decision, so nothing on the
page can write, and it takes no `run` handler.

`/admin/settings` is in `CORE_PATHS`, so a company with modules switched off can
always still reach the page that explains why — a plan overview behind a plan
gate would be a trap, and the audit asserts core paths survive with all thirteen
flags off.

The support link comes from a new `PLATFORM_SUPPORT_EMAIL` (documented in
`.env.example`). Unset is handled: the badge and the sentence still render, just
without a link — better than a `mailto:` nobody reads. When set, the link
pre-fills a subject naming the module and the company.

**Why the informational half is worth having:** "can we do expenses?" has no
answer inside the product today, so it becomes a support ticket — or the
customer concludes the product cannot do it at all. One page answers it and says
how to change it.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| A live company silently loses a module | Every new flag defaults to on (D2); Phase 2 changes no existing company's effective state. Verify on a copy of prod before deploy. |
| Orphaned data after a toggle-off | Never delete (D4); warn with counts; the flag is reversible and the records return unchanged. |
| Gated page still reachable through a stale sidebar cache | `invalidateTenantCache()` is already called by `updateTenantPlan`; confirm the menu query is invalidated client-side too (the recent query-invalidation commit `0e9e3ab` is the relevant precedent). |
| Enforcement helper applied too broadly, breaking working screens | Phase 3 limited to entry actions; each module verified individually before the next. |
| Presets drift from the registry | Presets are defined *in* `data/features.js` and reference keys from the same file, so an unknown key is a build-time-visible mistake. |

---

## 7. Estimate

| Phase | Work | Days |
|---|---|---|
| 1 | Single registry, refactor only | 0.5 |
| 2 | Coverage: new flags, portals, dashboard, permissions | 1.5 |
| 3 | Server-action enforcement | 1.0 |
| 4 | Platform UX: presets, groups, dependencies, warnings | 1.0 |
| 5 | Customer-facing plan overview (added after §8 Q3 was answered) | 0.5 |
| | **Total** | **4.5** |

Phase 1+2 alone delivers the request as stated (a platform admin can hide Site
Projects / Site Employees from a dental or warehouse tenant). Phases 3 and 4 are
what make it trustworthy and fast to operate.

---

## 8. Open questions for you

1. Should **Weekly Rota** and **Leave Management** be gateable, or are they core
   to every customer you sell to? Phase 2 shipped them as gateable and defaulted
   ON, so nothing changed for anyone — moving either into `CORE_PATHS` is a
   two-line reversal if you disagree.
2. ~~Do the `crm` / `visitors` / `devices` pages exist?~~ **Answered from the
   code:** they exist and are gated; they just have no sidebar entry. Open part:
   do you want them linked into `data/menu.js`, or are they deliberately parked?
3. ~~Should a company's own super admin ever see which modules are off?~~
   **Answered and built — see Phase 5.** Hidden everywhere operational; listed
   read-only with a "Not included in your plan" badge on the Plan tab of
   `/admin/settings`.
4. Are the four presets in §4 the right verticals for who you're selling to?
   Built as proposed; still unconfirmed. They are pure data in
   `data/features.js`, so changing them is a one-file edit.

Only 4 is still open, and nothing is blocked on it. Remaining optional work is
listed in §9.

---

## 9. What is left

Nothing here is blocking; the feature is complete and shippable as it stands.

1. **Confirm the presets** (§8 Q4). Pure data in `data/features.js`.
2. **Site clock-in enforcement.** `storeSiteEmployeeClockTime` and
   `canEmployeeClockToday` are the one gated-module surface still ungated, on
   purpose — attendance is where a wrong refusal costs someone their pay, and
   the portal that issues the QR codes is already closed. Worth doing
   deliberately, with a test against a real clock-in.
3. **Link or park `crm` / `visitors` / `devices`** (§8 Q2). Their pages exist and
   are gated, but no sidebar entry points at them, so switching one on changes
   nothing visible. Either add `data/menu.js` entries or accept the "no menu
   entry" badge as the permanent answer.
4. **Seat and storage limits.** `checkSeats` and `checkStorage` in
   `lib/tenantPlan.js` are written and tested but, like the feature flags once
   were, not called from many places. Same class of gap this work closed for
   modules.
5. **A dependency worth considering.** `weeklyRota` arguably requires
   `siteEmployees` for site crews. Not declared, because office staff are
   rostered too — but if rota turns out to be site-only in practice, it is a
   one-line `requires` entry and the resolver handles the rest.

### Where things live

| Concern | File |
|---|---|
| The registry — modules, groups, paths, presets | `data/features.js` |
| Pure decisions — is it on, is a path allowed, dependencies | `lib/tenantPlan.js` |
| Reading a company's flags | `lib/tenantFeatures.js` |
| Refusing a server action | `lib/requireFeature.js` |
| Flags for client components | `server/tenantServer/featureServer.js`, `hooks/useTenantFeatures.js` |
| Route guard | `proxy.js` |
| Sidebar filter | `server/selectServer/selectServer.js` |
| Platform console (write) | `app/platform/tenants/[id]/tenantDetail.jsx`, `server/tenantServer/platformServer.js` |
| Customer plan overview (read-only) | `app/admin/settings/planPanel.jsx` |
| Regression checks | `scripts/audit-features.mjs`, `scripts/audit-feature-guards.mjs` |

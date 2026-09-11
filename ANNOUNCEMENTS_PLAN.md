# Announcements — Feature Plan

Status: **all three phases built** (see §10).
Branch: `feat/multi-tenancy-phase-1`.

Requires `CRON_SECRET` to be set, or scheduled publishing stays off — the app
logs one line at startup saying so. Immediate publishing works without it.

## Decisions taken

1. **Field (site) employees:** excluded from v1; added in phase 3 as an opt-in
   per announcement, so nothing published before it changes audience.
2. **Who can post:** super admins, plus admins granted `/admin/announcements`
   through the existing permissions screen.
3. **Body format:** markdown, via the already-installed `react-markdown`.
4. **Acknowledgement:** soft — a button and a report, nothing blocking.
5. **Email:** opt-in per announcement (and phase 2 regardless).

---

## 1. What the feature is

A company-internal broadcast board. A privileged user writes one message, chooses
who it is for, and the system makes sure those people see it — in the app, and
optionally by email and browser push. Whoever posted it can then see who has read
it and who has not.

This is the one module the product does not have today. Everything currently in
the app is transactional (attendance, leave, rota, expenses). There is no way for
a company to say "the office is closed on Monday" to everybody at once. HR teams
work around it with WhatsApp groups and personal email, which means no record, no
targeting, and no proof anyone read it.

### What it is NOT (deliberately out of scope)

- Not a chat / comment thread. One-way broadcast only. Replies are a separate
  feature and a much bigger surface (moderation, notifications-per-reply, etc.).
- Not a document library. Media Management (`/admin/document`) already does files;
  announcements only *attach* to it, they do not replace it.
- Not a cross-company platform bulletin. Platform-to-tenant messaging (from
  `/platform`) is a distinct feature — noted in §11 as a possible phase 4.

---

## 2. How it works, from each side

### Author (superAdmin, or admin with the permission)

1. Goes to **Announcements** in the sidebar → "New announcement".
2. Writes a title and a body (markdown — `react-markdown` is already a dependency
   and is already used elsewhere).
3. Picks a **category**: General / Policy / HR / Safety / IT / Event.
   Category drives the colour and icon, nothing else.
4. Picks a **priority**: Normal / Important / Urgent.
   - Normal → appears in the bell and on the announcements page.
   - Important → additionally pinned to the top of the list.
   - Urgent → additionally shows a dismissible banner across the top of every
     admin page until read/acknowledged.
5. Picks the **audience** (see §3.2): everyone, or by role, department, site
   project, or a hand-picked list of people.
6. Optionally attaches files (goes through the existing S3 + storage-allowance path).
7. Chooses **delivery**: in-app always; email and/or push are opt-in per
   announcement.
8. Chooses **timing**: publish now, or schedule for a date/time; optional expiry
   date after which it drops off the list.
9. Optionally ticks **"require acknowledgement"** — recipients must click
   "I have read this", and the author gets a read/ack report.
10. Saves as **draft** or **publishes**.

### Recipient (any role, including `user` and `reception`)

- Sees an unread count on the header bell; opening it lists their announcements.
- Has a **My Announcements** page listing everything addressed to them, newest
  first, pinned at top, with unread ones marked.
- An urgent announcement shows a banner at the top of the page until dismissed
  (or until acknowledged, if acknowledgement is required).
- Opening one marks it read. If it requires acknowledgement, an explicit button
  records that separately — read ≠ acknowledged.

### Author, afterwards

- Opens the announcement's **Recipients** tab: total targeted, read count, ack
  count, and the list of who has not read it, with a "send reminder" action.
- Can edit (creates a new version note), unpublish, or archive.

---

## 3. Data model

Two new models, both tenant-scoped through `applyTenantScope` exactly like every
other model in `models/`.

### 3.1 `models/announcementModel.js` — `Announcement`

```
title            String, required
body             String, required            // markdown
category         String, enum, default "general"
priority         String, enum [normal|important|urgent], default "normal"
status           String, enum [draft|scheduled|published|archived], default "draft"

audience         { see 3.2 }

attachments      [{ mediaId, fileName, fileType, fileSize, key }]

channels         { inApp: true, email: false, push: false }
requireAck       Boolean, default false

publishAt        Date            // null = publish immediately on publish action
expiresAt        Date            // null = never expires
publishedAt      Date

createdBy        ObjectId ref OfficeEmploye
createdByName    String          // denormalised; authors leave the company
updatedBy        ObjectId ref OfficeEmploye

recipientCount   Number, default 0   // snapshot at publish time, for the report
isDeleted        Boolean, default false
```

Indexes: `{ tenantId: 1, status: 1, publishAt: 1 }` for the scheduler,
`{ tenantId: 1, status: 1, priority: 1, publishedAt: -1 }` for the list.
(`tenantPlugin` already adds `{ tenantId: 1, createdAt: -1 }`.)

### 3.2 Audience sub-document

```
mode          String, enum [all | roles | departments | sites | people]
roles         [String]        // "superAdmin" | "admin" | "user" | "siteEmployee" | "reception"
departments   [ObjectId]      // ref RoleType
sites         [ObjectId]      // ref SiteProject
people        [{ kind: "office"|"field", employeeId: ObjectId }]
includeField  Boolean, default false   // include site (field) employees — see §9.3
```

`mode` is a single choice, not a combination. Combining audience axes ("admins in
the London department") sounds useful and is a common request, but it doubles the
resolver's complexity and the UI's, and nobody asks for it until they have used
the simple version. Single-axis for v1; the field is already shaped so an
`and`/`or` combination can be added later without a migration.

**Resolving an audience → recipient list** lives in one function,
`resolveAudience(audience)` in `server/announcementServer/audience.js`, returning
`[{ kind, employeeId, email, name }]`. Every channel (in-app count, email, push,
report) uses that one function, so the four cannot drift apart.

### 3.3 `models/announcementReceiptModel.js` — `AnnouncementReceipt`

One row per (announcement, person). Written lazily — on first read, not at
publish time. Publishing to 400 people should not write 400 documents.

```
announcementId   ObjectId ref Announcement, required
employeeId       ObjectId, required
employeeKind     String, enum [office|field], required
readAt           Date
acknowledgedAt   Date
dismissedAt      Date        // banner dismissal for non-ack announcements
```

Unique index `{ tenantId: 1, announcementId: 1, employeeId: 1 }` so a double
click cannot create two receipts. `employeeKind` is required because office and
field staff live in **two different collections** with independent id spaces —
an `employeeId` alone is ambiguous (§9.3).

---

## 4. Server layer

New directory `server/announcementServer/`, following the shape of
`server/policyServer/` and `server/document/`:

| File | Exports |
|---|---|
| `announcementServer.js` | `createAnnouncement`, `updateAnnouncement`, `publishAnnouncement`, `unpublishAnnouncement`, `archiveAnnouncement`, `deleteAnnouncement`, `getAnnouncements` (admin list, paginated), `getAnnouncementById` |
| `myAnnouncementServer.js` | `getMyAnnouncements`, `getMyUnreadCount`, `markAnnouncementRead`, `acknowledgeAnnouncement`, `dismissAnnouncement` |
| `audience.js` | `resolveAudience`, `countAudience` — plain functions, no `"use server"` |
| `announcementDelivery.js` | `deliverAnnouncement` (email + push fan-out), context-free so the cron can call it |
| `announcementReport.js` | `getAnnouncementRecipients` (read/ack report, paginated), `remindUnread` |

Conventions to follow, all already established in this repo:

- Every mutating export wrapped in `withAudit("Announcement.create", …, { module: "Announcement" })`
  with `recordAudit({ entityId, before, after, description })` inside — same as
  `server/permissionServer/permissionServer.js`.
- List actions return `{ success, data: JSON.stringify(rows), totalCount }` so
  `useFetchQuery` (`hooks/use-query.js`) consumes them unchanged.
- Pagination via the `page` / `pageSize` search params and the existing
  `lib/pagination.js` + `context/commonContext` wiring.
- `await connect()` first, `try/catch` returning `{ success:false, message }`.

---

## 5. Delivery channels

### 5.1 In-app (always on) — the source of truth

- **Header bell.** `components/notification/notificationBell.jsx` today is
  hardcoded to visa alerts and returns `null` for anyone who is not
  admin/superAdmin. It needs to become two sections — "Announcements" for
  everyone, "Visa alerts" for privileged users only — rather than a second bell
  next to the first.
- **Banner.** `components/notificationBanner.jsx` is the push-permission prompt,
  not a general banner; a new `components/announcementBanner.jsx` renders urgent
  unacknowledged announcements. Mount it in `app/admin/providers.jsx` so it
  covers every admin page without touching each one.
- **Dashboard card.** A "Latest announcements" card in
  `app/admin/dashboard/components/` shown in both the `@admin` and `@employe`
  slots.

### 5.2 Email (opt-in per announcement)

Goes through `sendTenantMail` in `server/email/tenantMail.js`, which already
resolves the company's SMTP account and applies its branding — so an announcement
email arrives wearing the company's colours, not the platform's. Needs one new
template at `server/email/templates/announcementTemplate.js`, modelled on
`visaReminderTemplate.js`.

Two constraints:
- Sends are recorded to `EmailUsage` (feature `"announcement"`), consistent with
  how the rest of the app tracks mail.
- Fan-out is **batched and rate-limited** — a 400-person company on a shared SMTP
  fallback will get throttled or blacklisted if we fire 400 messages in a loop.
  Chunk of 25 with a short pause, failures logged per recipient, never aborting
  the whole run.

### 5.3 Browser push (opt-in per announcement)

`web-push` is already configured in
`server/attendanceServer/notificationServer.js`. **Caveat:** `pushSubscription`
exists only on `OfficeEmployeeModel`. Field employees cannot receive push until
that field is added to `employeModel` too — treat push to field staff as phase 3.
Expired subscriptions (410/404) should be cleared rather than merely logged;
today they are only logged.

### 5.4 Realtime (nice-to-have, cheap)

`server.mjs` already runs Socket.IO with a per-tenant room
(`tenantRoom(tenantId)` from `lib/socketAuth.js`). Emitting
`announcement:new` to that room on publish makes the bell increment without a
refresh. Roughly ten lines; the client listener already has a precedent in the QR
screens.

---

## 6. UI surfaces

```
app/admin/announcements/
  page.js                      admin list (server component, reads session)
  announcementTable.jsx        list + filters + pagination
  announcementForm.jsx         create / edit (react-hook-form, as elsewhere)
  audienceSelector.jsx         the audience picker
  [id]/page.jsx                detail + Recipients (read/ack) tab

app/admin/my-announcements/
  page.js                      recipient's own list
  announcementList.jsx
  [id]/page.jsx                full view + acknowledge button

components/announcementBanner.jsx
components/announcements/announcementCard.jsx
```

Everything is built from existing `components/ui/*` (shadcn) — dialog, tabs,
badge, scroll-area, popover are all already present. No new UI dependency.

---

## 7. Permissions, plan gating and menu wiring

Access control in this app is menu-driven: `data/menu.js` is the list of pages,
`proxy.js` checks the requested path against a role's granted paths, and the
permissions screen offers exactly the entries in `MENU`. So wiring up
announcements is four small edits:

1. **`data/menu.js` → `MENU`** — add
   `{ name: "Announcements", path: "/admin/announcements", role: ["superAdmin","admin"], icon: "Megaphone" }`.
   This one edit gives it a sidebar entry, a route guard in `proxy.js`, and a
   checkbox on the permissions screen.
2. **`data/menu.js` → `COMMONMENUITEMS`** — add
   `{ name: "Announcements", path: "/admin/my-announcements", icon: "Megaphone" }`.
   `COMMONMENUITEMS` paths bypass the permission check in `proxy.js`, which is
   right: every employee must be able to read what was sent to them.
3. **`components/sidebar/sideBarMenu.jsx`** — add `Megaphone` to `ICON_MAP`.
   Missing this is a silent failure: the item renders with no icon.
4. **Plan gating** — add `announcements: { type: Boolean, default: true }` to
   `featuresSchema` in `models/companyModel.js`, and
   `"/admin/announcements": "announcements"` to `FEATURE_BY_PATH` in
   `lib/tenantPlan.js`. Defaulting to `true` means no existing company loses
   anything, matching how the other flags were introduced.

Note `/admin/my-announcements` is deliberately **not** feature-gated: if a
company had the module and it is later switched off, people must still be able to
read announcements already sent to them.

---

## 8. Scheduling and expiry

Reuse the pattern already proven by the visa reminder:

- `server/announcementServer/announcementScheduler.js` — a context-free job
  (no `next/headers`, no next-auth) that finds `status:"scheduled"` with
  `publishAt <= now` across all tenants, and for each one calls
  `runWithTenant(tenantId, …)` to publish and deliver. Same structure as
  `server/visaServer/visaReminderJob.js`, which iterates tenants exactly this way.
- `app/api/cron/announcements/route.js` — POST guarded by the `x-cron-secret`
  header, mirroring `app/api/cron/visa-reminders/route.js`.
- `server.mjs` — a `scheduleAnnouncements(port)` alongside
  `scheduleVisaReminders(port)`. Visa runs daily; announcements need a tighter
  tick — **every 5 minutes**, so "publish at 09:00" means 09:00 and not "some
  time tomorrow".

Expiry needs no job. `expiresAt` is applied as a filter at read time
(`$or: [{expiresAt: null}, {expiresAt: {$gt: now}}]`), which cannot drift out of
sync the way a sweeper can.

---

## 9. Things in this codebase that will bite

These are specific to this repo and are the reason a generic "add a CRUD module"
estimate would be wrong.

**9.1 Tenant scoping.** `applyTenantScope` handles `find`/`save`/`aggregate` and
rewrites `$lookup`/`$unionWith`. But the recipient report joins receipts to two
employee collections; write it as a plain `$lookup` and let the plugin scope it —
do not hand-roll a tenant match, and do not use `bulkWrite`, which the plugin
explicitly does not cover (see the LIMITS comment in `lib/tenantPlugin.js`).

**9.2 Read-only support sessions.** `ReadOnlySessionError` makes *every* write
throw during a platform support visit — including `markAnnouncementRead`. If we
call that on page load unguarded, a support visitor gets a 500 on the
announcements page. Guard the read-marking with `isReadOnly()` and skip it.

**9.3 Two employee collections.** `OfficeEmploye` and `Employe` are separate
models with separate id spaces. Audience resolution, receipts, the report, and
every count must carry `kind`. This is the single most likely source of bugs in
this feature and the reason `resolveAudience` must be the only place that knows
how the two are combined.

**9.4 Field employees have almost no portal.** `app/employee/` is a QR clock-in
screen and a change-password form — there is nowhere to show them an
announcement. Targeting field staff in v1 means email only, or building them a
minimal announcements screen. Recommendation: **v1 targets office staff
(`/admin` users) only**; field staff are phase 3, together with their portal.

**9.5 Attachment storage counts against the plan.** Uploads must go through
`assertStorageAllows` (`server/aws/storageGuard.js`) before
`uploadImage`/`generatePreSignedUrl`, or announcements become a way to bypass the
per-company storage cap that was just enforced on every other upload path.

**9.6 The bell is currently privileged-only.** `notificationBell.jsx` returns
`null` for role `user`. Announcements are for everyone, so that early return has
to become per-section rather than whole-component.

---

## 10. Build plan

### Phase 1 — Core — **BUILT**

1. ✅ `models/announcementModel.js`, `models/announcementReceiptModel.js`.
2. ✅ `server/announcementServer/audience.js` — resolver + counts, office staff only.
3. ✅ `server/announcementServer/announcementServer.js` — CRUD + publish, audited.
4. ✅ `server/announcementServer/myAnnouncementServer.js` — list, unread count, read, ack.
5. ✅ Menu / icon / plan-flag wiring (§7), plus the feature label in
   `app/platform/tenants/[id]/tenantDetail.jsx` so the platform console can
   toggle the new flag.
6. ✅ `app/admin/announcements/` — list, form, audience selector, edit route.
7. ✅ `app/admin/my-announcements/` — list and reader.
8. ✅ Bell rework: announcements section for all roles.

Deliverable: publish now, target all/roles/departments/people, read + acknowledge,
in-app only.

**One design change from the plan as written.** §3.2 assumed the recipient list
would come from `resolveAudience`. It does not: resolving every announcement's
audience on every page load is a query per announcement per view. Because the
audience is stored as a mode plus a list, the question inverts — `visibilityFilter()`
turns "who is this for" into "which of these is for me" as a single indexed `$or`,
so a recipient's list is one query no matter how many announcements exist.
`resolveAudience` remains, and is what the counts, the report and the phase-2
email fan-out use. The cost is that the two directions could drift, which is why
role derivation sits in `roleOfOfficeEmployee()` and both call it.

**Tested.** `scripts/test-announcements.mjs` (`npm run announcements:test`) —
25 assertions, passing under both `TENANT_ENFORCEMENT=enforce` and `shadow`,
against a local seeded database. It covers audience resolution for every mode,
cross-tenant isolation, the live filter (draft / archived / expired), pin
ordering, receipt uniqueness, tenant stamping, and the read-only support-session
guard. The load-bearing one is *"resolveAudience and visibilityFilter agree"*,
which cross-checks every audience against every employee from both directions —
that is the drift this design trades for the query saving described above.

Still unexercised: the server actions themselves (they read a session through
`next/headers`, so they need a browser), and therefore the permission check in
`requireAuthor()`.

### Phase 2 — Reach and timing — **BUILT**

9. ✅ Scheduler: `announcementScheduler.js`, `app/api/cron/announcements/route.js`,
   and a 5-minute `scheduleAnnouncements()` tick in `server.mjs`. (`expiresAt`
   filtering already landed in phase 1.)
10. ✅ Email: `server/email/templates/announcementTemplate.js` and
    `announcementDelivery.js` — batched 25-at-a-time with a pause, per-recipient
    failures never aborting the run, outcomes to the audit log.
11. ✅ `components/announcementBanner.jsx` mounted in `app/admin/providers.jsx`,
    and `announcementsCard.jsx` on both dashboard slots.
12. ✅ `announcementReport.js` + a Recipients tab on the admin detail page,
    with "remind unread".
13. ✅ `announcementAttachments.js` — upload behind `assertStorageAllows`,
    signed downloads that re-check the caller is in the audience.

**Two corrections to this plan, found while building it.**

*EmailUsage.* §5.2 said sends would be recorded to `EmailUsage`, "consistent
with how the rest of the app tracks mail". That was wrong: nothing in the app
writes that collection — it is only read — and its required `emailId` is the
`EmailAccount` a message went through, which `sendTenantMail` resolves
internally and does not return. Delivery outcomes go to the **audit log**
instead, which is the pattern the visa reminder already uses and is queryable
from the Audit Logs screen.

*Email is not awaited on publish.* 400 recipients at 25 per batch is ~16
seconds. `publishAnnouncement` starts delivery and returns; the announcement is
already readable in-app, so the mail is a best-effort tail. Safe only because
this deploys as a long-lived server (`server.mjs`), not a function frozen when
the response is sent — **if that ever changes, this needs a queue.**

**Tested.** 32 assertions, passing under both enforcement modes
(`npm run announcements:test`). Phase 2 added coverage for the scheduler
(due vs not-due, double-run idempotence, no cross-tenant publishing), the email
body (markdown rendering, HTML and `javascript:` links escaped out, priority in
the subject), and the report's read-vs-acknowledged split.

Running app code under plain node needed two harness additions:
`scripts/lib/next-headers-stub.mjs` and `next/*` subpath resolution in
`scripts/lib/alias-loader.mjs` — `lib/audit.js` imports `next/headers` at module
scope, which nothing outside Next can resolve. The existing `tenant:test` suite
still passes 12/12.

Still unexercised: the server actions themselves (they need a session, so a
browser), a real SMTP send, and a real S3 attachment round-trip.

### Phase 3 — Field staff and polish — **BUILT**

14. ✅ Push: `pushSubscription` added to `employeModel`, `announcementPush.js`,
    and `saveSubscription` generalised across both collections.
15. ✅ Realtime: `lib/realtime.js`, `hooks/useAnnouncementSocket.js`, emitting
    `announcement:new` on every publish (manual and scheduled).
16. ✅ Field portal: `app/employee/announcements/` list and reader, a menu
    entry, and a working bell replacing the decorative one.
17. ✅ Site targeting: `audience.mode = "sites"`, plus the `includeField` opt-in
    and the `siteEmployee` role, exposed in the audience picker.

**The v1 office-only decision is now reversed, but opt-in.** Existing
announcements are unaffected: `includeField` defaults to false, so "everyone"
keeps meaning the office. Two modes ignore the toggle because they name field
staff outright — picking the "Site staff" role, and targeting a site. All three
behaviours are pinned by tests.

**Design notes.**

*Site targeting reads `employe.projectSite`, not `SiteAssignment`.* The latter
answers "who is on this site today", which would make an announcement's audience
— and so its recipient count and its read report — change overnight. The
employee's assigned site is a stable property.

*The realtime bridge is a global.* Socket.IO is created in `server.mjs`, which
imports the app rather than the other way round, so there is no import path back.
It parks the server on `globalThis` and `lib/realtime.js` reads it. Everything is
best-effort: under `next start`, in a test, or during a build there is no socket
server and the bell just updates on its next fetch.

*Push payloads carry only a title and a deep link*, and the link differs by
population — field staff go to `/employee/announcements/…`, office staff to
`/admin/my-announcements/…`.

**One bug found by the tests, fixed in the code rather than the fixture.**
`web-push` reports a malformed stored subscription as a plain `Error` with no
`statusCode`, which is indistinguishable at the catch site from a network blip —
so such a row would have been retried on every send forever. `announcementPush.js`
now validates the subscription shape itself (endpoint scheme, 65-byte `p256dh`,
16-byte `auth`) and clears anything that fails, treating it as the permanent
failure it is. Transient errors are still kept and retried.

**Tested.** 44 assertions, passing under both enforcement modes. Phase 3 added
field fixtures (one on a site, one without), nine new audience cases, and
extended the agreement invariant to cross-check **both** populations — the kind
is part of the identity, since the two collections have independent id spaces.
`tenant:test` still passes 12/12.

Still unexercised: the server actions (they need a session), a real SMTP send, a
real S3 attachment round-trip, a live push endpoint returning 410, and the
socket round-trip.

Phase 1 is the bulk of the work; phases 2 and 3 are each individually small and
independently shippable. Nothing in phase 1 needs to be revisited to add them —
the schema fields (`publishAt`, `channels`, `expiresAt`, `audience.sites`,
`includeField`) are all present from the start and simply unread.

---

## 11. Decisions I need from you before building

1. **Field (site) employees in v1?** My recommendation is no — they have no
   portal to read anything in, and adding one is a real chunk of work that is
   independent of announcements themselves. Confirm and I plan phase 1 as
   office-staff-only.
2. **Who can post?** Options: superAdmin only; superAdmin + admins holding the
   `/admin/announcements` permission (my recommendation — it fits the existing
   permission model exactly); or a separate capability like
   `SENSITIVE_DETAILS_VIEW`.
3. **Rich text or markdown?** Markdown is nearly free (`react-markdown` is
   already installed, and `lib/tiptap-utils.js` suggests a rich editor was
   considered but not adopted). A WYSIWYG editor is a new dependency and roughly
   two extra days.
4. **Acknowledgement — how strict?** Soft (a button, and a report showing who
   has not) versus hard (a modal that blocks the app until acknowledged). Soft is
   the safe default; hard is genuinely useful for safety notices but is
   disruptive if misused.
5. **Email on by default, or opt-in per announcement?** Opt-in is my
   recommendation — an author who accidentally emails 400 people cannot take it
   back.

---

## 12. Rough sizing

| Phase | Scope | Estimate |
|---|---|---|
| 1 | Models, audience, CRUD, both UIs, bell, wiring | 4–5 days |
| 2 | Scheduling, email, banner, report, attachments | 3–4 days |
| 3 | Push, realtime, field portal, site targeting | 3–4 days |

Assumes the answers in §11 are settled up front; question 1 (field employees) is
the one that moves the phase-1 number most.

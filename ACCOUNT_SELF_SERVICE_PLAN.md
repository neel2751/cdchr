# Employee Self-Service — Report & Plan

Status: **Steps 1–7 built.** `/admin/me` is live, the id is out of the URL, the
three server holes are closed, the profile is read-only with a change-request
route to HR, bank holidays are back where staff can see them, and people can set
their own photo. Only step 8 — deleting the redirect stubs — is outstanding, and
that one waits on a release.
Branch: `feat/multi-tenancy-phase-1`.

Goal: replace `/admin/account/<encrypted-id>/<tab>` with a `/admin/me` area that
never puts a record id in the URL, shows an ordinary employee their own details
without pretending they can edit them, and stops duplicating what the sidebar
already offers.

> ## Scope rule — read this first
>
> **The HR / superAdmin view of an employee does not change.**
> `/admin/officeEmployee/<id>/<tab>` keeps the same URL, the same tabs, the same
> components and the same behaviour it has today. Every change below is either
> confined to the self-service side or is written so that the HR side is
> byte-for-byte unaffected. Where a shared file has to be touched, the plan says
> exactly why the HR path still behaves identically.

---

## 1. Where things actually stand

Checked in the code, not assumed:

| | State |
|---|---|
| Self-service entry point | `components/sidebar/sideBarCom.jsx:283` → `/admin/account/${encrypt(user._id)}/overview` |
| Route | `app/admin/account/[...id]/page.jsx` — a thin copy of `app/admin/officeEmployee/[...id]/page.jsx` |
| Tabs | Both routes import the **same** `officeMenu` + `officeSlugComponentmap` from `app/admin/_components/menu.js` |
| Id in the URL | AES-GCM via `lib/algo.js` — key is `NEXT_PUBLIC_ALGO_KEY`, **inlined into the browser bundle** |
| Does the server trust that id? | **No, not for ordinary users.** `extractData` (`server/officeServer/officeEmployeeDetails.js:15`) returns `_id` unless the caller holds the `/admin/officeEmployee` permission |
| Sidebar personal items | `/admin/my-attendance`, `/admin/my-weekly-shifts`, `/admin/my-leaves` — registered in `data/menu.js:262` and hardcoded again in `sideBarCom.jsx:115` |
| Profile photo | **Does not exist.** No image field on `officeEmployeeModel`; `AvatarContext.jsx` falls back to a hardcoded `vercel-storage.com` JPEG in `localStorage` |
| Media + storage plumbing | Exists and works — `server/aws/media.js`, `server/aws/storageGuard.js`, `/api/asset/[...key]` |

### The four problems

**P1 — The URL names a record that can only ever be you.** And it names it with
a token the browser can mint, because the key is `NEXT_PUBLIC_`. That reads
badly to a user and it is not a boundary. It also is not load-bearing: the
server already ignores it for exactly the people who see it. **Removing the id
costs nothing functionally.**

**P2 — Two doors into the same room.** `officeMenu` has Attendance, Weekly Rota
and Leave tabs rendering `OfficeEmployeeAttendance`, `EmployeeWeeklyRota` and
`EmployeeLeaveDeatails`. `/admin/my-attendance`, `/admin/my-weekly-shifts` and
`/admin/my-leaves` render those same three components. Same data, two
navigations, and neither knows about the other.

**P3 — Company data filed as personal data.** Bank Holiday is one calendar
shared by everyone in the company. On a per-person account page it implies a
per-person setting.

**P4 — "Edit" and "Document" are offered to people who should not have them,
and the servers behind them do not check.** Covered in §2 — it is the one part
of this that is not a UX question.

---

## 2. Two server holes this depends on

These are real today, independent of the redesign, and the redesign should not
ship without them. **Neither fix changes anything a superAdmin or admin can
currently do** — both are written to reject only callers who were never
supposed to be there.

**H1 — the employee update action has no authorization at all.** ✅ **fixed**

> **Correction found while building this.** The function named here first,
> `updateOfficeEmployeeData` in `officeEmployeeDetails.js`, turned out to have
> **no callers anywhere in the app** — the edit form goes through
> `handleOfficeEmployee` in `officeServer.js:88`. That did not make it harmless:
> an exported `"use server"` function is an addressable endpoint whether or not
> a button points at it, so a dead one that assigns client data onto a record is
> if anything worse than a live one. It was deleted. The live path was carrying
> the same hole and was fixed.

`handleOfficeEmployee(data, id)` took both the target id and the payload from
its caller, then:

```js
Object.assign(updatedEmp, buildOfficeEmployeePayload(data));
await updatedEmp.save();
```

Any signed-in account could write any field of any employee record — `isAdmin`,
`isSuperAdmin`, `isActive` and the bank sub-document included.

**The fix, as built.** `lib/employeeAccess.js` resolves the caller once:
`superAdmin`, or anyone holding a staff-management permission, may name a
target and is completely unaffected. Everybody else may write only their own
record, and only the fields in `SELF_EDITABLE_FIELDS` — phone, address, and
next of kin. That constant is the answer to Q2 below, in one place, easy to
change.

Two things fell out of doing it:

- The uniqueness checks ran `findOne({ email: undefined })` when a payload
  carried no email. Mongoose drops undefined keys, so the query became "any
  other employee in this company" and refused a legitimate save. Each check is
  now conditional on the field being present.
- `buildOfficeEmployeePayload()` fills in `country` from `immigrationType`.
  With neither field present — which is every self-edit — it reset a non-UK
  employee's country to United Kingdom. The self path assigns its whitelist
  directly and skips that builder.

**H2 — `/admin/account/*` bypasses the account-status gate.** ✅ **fixed.** Was
`proxy.js:255`:

```js
const isAdminAccountRoute = requestedPath.startsWith("/admin/account/");
if (isAdminAccountRoute) return pass();
```

That `pass()` sits **above** the `isActive` / `sessionsValidFrom` /
`mustChangePassword` block. So a deactivated employee, or one whose sessions
were revoked by "sign out of all devices", still reaches the account area and
can change their password there. The `mustChange && !startsWith("/admin/account/")`
guard at line 310 is dead code for the same reason. Fix: delete the bypass;
`/admin/me/*` goes through the normal gate like every other page.

**H3 — the document actions trusted the caller's `employeeId`.** ✅ **fixed.**
`getEmployeeDocuments` now resolves the target the same way, so a caller
without a staff-management permission reads their own files whatever slug they
send. `uploadDocument` and `deleteEmployeeDocument` require the permission —
filing something against somebody's record, or removing it, is an HR act (§5).

**Still open, deliberately not touched:** `changeOfficeEmployeePassword` skips
the current-password check for `admin` as well as `superAdmin`, so an admin can
change their own password without proving they know the old one. Fixing it
changes what an admin experiences today, which is outside the scope rule at the
top — worth a decision of its own.

---

## 3. The shape

Two surfaces with different grammar. Only the left column is new work.

| | URL | Means | Changing? |
|---|---|---|---|
| Self-service | `/admin/me/...` | "me" — no id, ever | **new** |
| HR view | `/admin/officeEmployee/<id>/...` | names a record; the id belongs here | **no** |

### 3.1 Routes

```
/admin/me              → redirect to /admin/me/profile
/admin/me/profile        personal details, read-only + "Request a change"
/admin/me/documents      list + download only
/admin/me/security       password · 2FA · backup codes · active sessions
/admin/me/attendance     (was /admin/my-attendance)
/admin/me/shifts         (was /admin/my-weekly-shifts)
/admin/me/leave          (was /admin/my-leaves)
```

### 3.2 The rule that removes the duplication

Frequently used things live in the **sidebar**. Rarely used things live behind
the **avatar**. Nothing appears in both.

- Sidebar "My Work" group: Attendance · Shifts · Leave · Announcements
- Avatar dropdown → "My Profile" → `/admin/me` with three tabs: Profile ·
  Documents · Security

Bank Holiday leaves the account area entirely: a read-only overlay on the shifts
calendar and a strip on the leave page, where it actually informs a decision.

### 3.3 Capabilities, not a second copy of every component

`EmployeeFiles`, `EmployeeEdit`, `PasswordChange`, `SessionManagement` and
friends are shared by both surfaces. Do **not** fork them, and do **not** change
their call sites.

Give each an optional prop:

```js
export default function EmployeeFiles({ can = FULL_ACCESS }) { … }
```

`FULL_ACCESS` is the default, so `app/admin/officeEmployee/[...id]/page.jsx`
keeps working untouched and the HR view is unchanged. Only the new `/admin/me`
container passes a restricted object, and it derives that object **server-side
from the session**, never from a client prop:

```js
// in the /admin/me layout, on the server
const can = {
  editAll:  isPrivileged(role, permissions),   // superAdmin, admin, HR
  upload:   isPrivileged(role, permissions),
  editOwn:  true,                              // phone, address, emergency
};
```

Consequence worth stating: **a superAdmin opening their own `/admin/me` sees
exactly what they see in the account page today** — full edit, upload, the lot.
Only role `user` gets the read-only treatment. That is what keeps "don't change
the superAdmin side" true even for their own record.

### 3.4 Do not touch `officeMenu`

`app/admin/_components/menu.js` exports `officeMenu` and
`officeSlugComponentmap`, and **both routes import them**. Editing either export
changes the HR view. So:

- `/admin/me` gets its **own** `selfMenu` + `selfSlugComponentmap` — new
  exports, or a small local module under `app/admin/me/`.
- `officeMenu` is left exactly as it is.
- Its `role: [..., "employee", "user"]` entries become moot once
  `/admin/account` is gone. Leaving them costs nothing; clean them up later, or
  never.

### 3.5 Reaching `/admin/me` without a permission grant

`proxy.js:399` waves through anything matching `COMMONMENUITEMS`, which is how
`my-attendance` is reachable by role `user` today. Add one entry for
`/admin/me` in `data/menu.js` and every role can open it. No change to the
permission model, no change to `MENU`, nothing the HR side reads.

---

## 4. Profile: read-only, with a way out ✅ **built**

**As built.** One table, `lib/profileFields.js`, drives the screen, the server
whitelist and the request form together, so a field cannot appear on the page in
a state the server will not honour. Each field is one of three things:

| | Means | Examples |
|---|---|---|
| `self` | changed in place, now | phone, address, emergency contact |
| `request` | ask, HR decides | name, email, date of birth, start date, visa dates |
| `read` | shown, not negotiable here | department, role, employment type, days per week |

That last row is the one the first draft missed. A department is not a
*correction* — it is a decision, and offering a "request a change" button on it
would pretend an employee could ask their way into another team.

Bank details and the NI number never travel through a request at all. They are
stripped from every profile read by `lib/sensitiveAccess.js` and released only
against a re-typed password; putting a new sort code in a request collection
would route around all of that. They raise a **note with no value** — HR
confirms it with the person and types it on the record, which is how payroll is
supposed to handle a bank change anyway.

Files:

```
lib/profileFields.js                     the table; SELF_EDITABLE_FIELDS derives from it
models/profileChangeRequestModel.js      field · oldValue · newValue · reason · status
server/officeServer/profileChangeServer.js
app/admin/me/profile/myProfile.jsx       the read-only profile + request dialogs
app/admin/profileRequests/               the HR queue
```

`updateMyProfile` is a separate action rather than a call into
`handleOfficeEmployee`, for the same `country` reason as §2: this screen saves
one section at a time, and that action's payload builder would reset a non-UK
employee's country on every address edit. Its whitelist applies to everyone, HR
included — on this page a super admin is an employee looking at their own record.

**Operational note:** the queue is a new permission, `/admin/profileRequests`.
Super admins reach it automatically; **an `admin` has to be granted it in
`/admin/permissions`** or the sidebar link 404s them to the dashboard, the same
as any other page.

---

## 4a. The original proposal, for reference

Sections: Personal · Contact · Emergency contact · Employment · Bank · Right to
work.

**Not everything should be read-only.** Give the employee a small owned subset
they can save directly:

- phone number
- personal email
- home address
- emergency contact (name, relation, phone, address)

Those are the fields HR chases people for anyway, and none of them carries a
payroll or compliance consequence. Everything else — name, job title, start
date, department, NI number, bank details, visa dates — renders read-only with a
**Request a change** button per section.

A request captures `field`, `oldValue`, `newValue`, `reason`, `status` and lands
in an HR queue. On approval it applies the change and writes an audit row
through the existing `withAudit` / `recordAudit` path.

`issueTicketModel` is the tempting reuse, but it has no field/old/new shape — a
small `profileChangeRequestModel` is cleaner and keeps the HR queue meaningful.

Bank details are already gated behind `revealSensitiveDetails()` (re-checks
permission **and** password). Keep that untouched; on the self page show a
masked summary plus a change request, never the raw form.

---

## 5. Documents: see the shelf, don't touch it

List title, type, uploaded date, expiry. Download your own. **No upload, no
delete — for anybody, on this page.**

> **Changed from the first draft.** This originally said "no upload for role
> `user`", with HR keeping their buttons here the way they keep them everywhere
> else in `/admin/me`. That was wrong. What the company holds about a person is
> a record HR keeps, not a folder the person keeps — so the employee's view of
> their own file is read-only whoever is signed in. An HR user who needs to add
> or remove something does it from the employee's record at
> `/admin/officeEmployee/<id>`, where it is an HR act against that employee with
> an audit trail attached, rather than quietly from their own profile page.
> `/admin/me/documents` hardcodes `manage: false`.

Add a **Missing / expiring** banner driven off `visaEndDate`,
`rightToWorkChecks` and `lastRightToWorkCheckDate`, all already on
`officeEmployeeModel`. This is what makes a read-only list useful rather than
crippled: it tells the employee *why* they would contact HR, instead of leaving
them staring at a list they cannot act on.

If employee uploads are wanted later, do it the way the market does: **HR
initiates.** HR creates a requested-document slot, the employee sees a
pre-labelled prompt and can upload into that slot only. Never a generic upload
button.

---

## 6. Profile photo ✅ **built**

**As built.**

```
models/officeEmployeeModel.js                 profileImage: { key, mediaId }
server/aws/avatar.js                          the S3 write, types, 2 MB cap
server/officeServer/profileImageServer.js     upload · remove · read
components/Avatar/squareImage.js              browser-side square + shrink
app/admin/me/profile/profilePhoto.jsx         the control
```

Four decisions worth writing down:

**Private, as recommended.** `"avatars"` is *not* in `PUBLIC_CATEGORIES`. The
asset route's existing private branch already does the right thing — a session
in the same company, or a 404. One change there: avatars get
`private, max-age=600` instead of `no-store`, because the sidebar renders one on
every screen and `no-store` meant refetching a photograph on each navigation. A
replacement takes a fresh random key, so a cached copy can never be the wrong
picture.

**Squared in the browser, not cropped by hand.** `squareImage()` centre-crops
and re-encodes to a 512px JPEG before upload, so a 4 MB phone photo never leaves
the device. No cropper UI: the middle of a portrait is the part you want, and
this keeps the control at one file picker. It falls back to the original file if
canvas fails, and the server enforces type and size either way.

**The whole chain of housekeeping runs on replace.** Archive the old Media row,
delete the old object, let the storage figure drop — `deleteFileFromS3` already
reduces it by the object's real size. Ordered after the employee record saves,
so a failed write leaves the person with the photo they had rather than a record
pointing at bytes that are gone. Tidy-up failures are logged, never thrown.

**The sidebar footer showed the company logo as your avatar.** Both avatars
there did — so every account looked identical and the footer said "you are
signed in as this company". They now show the person, with the logo still behind
it as the fallback. Fetched rather than read from the session token, which is
minted at sign-in and would serve the old photo until the next one.

**The stock-avatar system is gone.** `AvatarList` — fourteen Cloudinary faces
written to one shared `selectedAvatar` localStorage key — has been deleted, and
with it the key, the vercel-blob default in `AvatarContext`, and the two
kiosk screens that read that key directly and could therefore only ever get
their own fallback. It was presented as "pick an avatar" but the value was
per-browser rather than per person: it showed the same stranger's face on every
employee's record and changed for everyone the moment anybody picked again.

**localStorage now caches the photo instead.** `components/Avatar/useProfileImage.js`
keeps the person's image key under `profileImage:<userId>` so the sidebar — which
renders an avatar on every screen — does not query the database on each
navigation. It consults the server only when there is nothing cached, when the
copy is over twelve hours old, or when the photo changes, which tells the cache
directly. Two properties it had to have, both learned from the key it replaces:

- **Keyed by user.** The old key was shared by everyone who used the browser.
  Here a different account simply misses the cache.
- **A copy, never the record.** `/api/asset` still refuses an avatar to anyone
  outside the company, so a stale or hand-edited entry buys nothing but a broken
  image.

Built on `useSyncExternalStore`, which is what localStorage actually is — state
owned outside React, changed by other tabs and by other components.

**The HR edit tab was tidied with it** — see §6b, which grew into its own job.

---

## 6a. The original proposal, for reference

1. **Model.** Add `profileImage: { mediaId, key }` to
   `models/officeEmployeeModel.js`. No image field exists today.
2. **Upload.** Existing `useUploader` with
   `path = tenants/<tenantId>/avatars`, then `addMedia({ category: "avatar", … })`
   from `server/aws/media.js` so it appears in Media Management.
3. **Quota.** `checkStorage` before the write, `noteStorageDelta(+size)` after —
   `server/aws/storageGuard.js` already does both for documents.
4. **Serving.** Through `/api/asset/tenants/<id>/avatars/<key>`, which keeps
   `img-src` at `'self'` and avoids expiring signed URLs.

**On "public": keep avatars private.** Do not add `"avatars"` to
`PUBLIC_CATEGORIES` in `app/api/asset/[...key]/route.js`. Avatars only ever
render to signed-in users in the same tenant, so the session check costs
nothing, and "public" means anyone holding the URL can fetch a photo of a member
of staff forever, with no way to withdraw it. Widen it only if avatars ever need
to appear before sign-in — they do not today.

Two details that bite if skipped:

- **On replace:** `archiveMedia(oldId)` + delete the S3 object +
  `noteStorageDelta(-size)`. Otherwise someone re-cropping ten times eats the
  tenant's allowance ten times over.
- **Constrain the input:** images only, ≤ 2 MB, square-cropped client-side
  before upload.

Once a real field exists, remove the `selectedAvatar` `localStorage` fallback in
`components/Avatar/AvatarContext.jsx` — it points at a stray
`hebbkx1anhila5yf.public.blob.vercel-storage.com` JPEG.

## 6b. The HR employee Edit tab ✅ **rebuilt**

`/admin/officeEmployee/<id>` → Edit was showing **three fields**: name, phone,
email. It took `OFFICEFIELD` — which is the complete office-employee form,
around thirty fields — filtered it down to those three for a "Basic" tab, and
then re-listed three of the other groups as separate tabs. Everything nobody
had explicitly named was simply not editable from an employee's own page:
address, date of birth, employee ID, employment type, days per week, the whole
weekly-hours pattern, country of work.

**What changed.**

- `hooks/useOfficeEmployeeFields.js` decorates `OFFICEFIELD` once — the three
  fields whose choices come from the database (department, company, and the
  fixed-hours figure) plus the sensitive-field filter. Both this tab and the
  staff-list sheet need exactly that, and each was doing it by hand. **Both now
  use the hook**, so the two cannot drift apart again: roughly forty lines came
  out of `officeEmplyee.jsx`, along with its local `PROTECTED_FIELD_NAMES` and
  four now-unused imports. The hook hands the department and company lists back
  out, because that page's filter row needs the same two — same query keys, so
  React Query still makes one request each.
- The tab groups the decorated list by name into Personal · Address ·
  Employment · Hours · Right to work · Emergency. **Anything no group claims
  falls into an "Other" tab** rather than vanishing — that catch-all is the
  actual fix, because the old screen could only ever show fields somebody had
  remembered to list.
- The tab strip wraps instead of being a fixed four-column grid; the number of
  tabs now depends on what the viewer may edit.

**A second defect, found on the way.** The submit button was rendered with
`isHide={role === "superAdmin" ? false : true}` — so an `admin` with staff
management permission saw the whole form, with every field enabled, and **no
save button and nothing saying why**. It now asks the server the same question
the server asks itself (`canManageEmployees`, shaped like the existing
`canViewSensitiveDetails`) and, when the answer is no, says so in a line under
the form.

**Bank details and NI are deliberately still not here.** `employeeDeatils()`
strips them from every profile read — they are released only by
`revealSensitiveDetails()`, against a re-typed password — so a form here would
show blanks and ask HR to retype an NI number in order to save a visa date.
They are read on the Overview tab, through `SensitiveDetailsCard`, and the Edit
tab now says so instead of leaving a silent gap. Omitting them is also what
keeps the stored values safe: no bank fields in the payload means
`buildOfficeEmployeePayload` leaves `bankDetail` alone.

### A correction I made to myself here

I first wrote that saving one tab reset a non-UK employee's `country`, on the
reasoning that each tab submits only its own fields. **That was wrong, and I
checked it rather than shipping it.** React Hook Form hands `handleSubmit` a
clone of its form values, which keeps the defaults of fields that were never
mounted — so the whole record round-trips on every tab save. (That is also why
`rightToWorkChecks` has to be stripped in `buildOfficeEmployeePayload`.) The
guard I added there stays, because `country` is derived rather than entered and
any genuinely partial caller would hit exactly that trap, but it is a guard
against a latent problem, not a fix for a live one — and the comment in the
code says so.

---

### A bug this surfaced

`/admin/me/leave` threw *"Attempted to call useQuery() from the server"*.
`bankHoliday.jsx` has always been a client component — `useBankHoliday`,
`useBankHolidayRule`, `useState` — but had no `"use client"` directive. It got
away with it because its only importer was `_components/menu.js`, which is
`"use client"`, so it inherited the boundary. Imported directly by a server page
it was treated as a server module. The directive is now stated on the file, so
the component is correct wherever it is used rather than correct only when
reached through one particular importer.

## 6c. My leave: the numbers did not match the list ✅ **fixed**

Reported as "total 2, and date is gone 2 — maybe old data". Both figures were
right, about questions nobody had asked.

**`leaveCount()` had no leave-year filter at all.** The list below it is scoped
to one leave year; the tiles above counted every leave year on record. So a
person with one booking this year and one from two years ago saw "Total 2" over
a list of one.

**And for a super admin the tiles were company-wide.** The `total`, `pending`,
`rejected`, `approved` and `dateIsGone` facets carried no employee filter —
only the `own*` ones did — and a super admin got **both sets appended**, ten
tiles with five duplicated labels and nothing distinguishing them. On a
personal leave page that is simply the wrong question.

`leaveCount` now takes `{ slug, leaveYear }`. Naming an employee switches it to
a scoped mode: every facet gets the year, the company-wide block is suppressed,
and the slug goes through `resolveEmployeeTarget` so asking about someone else
without the permission counts you. Called with no arguments — which is what the
Leave Management overview does — it behaves exactly as before.

**The filter was decorative.** Both Selects in the leave card had a
`defaultValue`, no `value`, no `onValueChange` and no state behind them. The
popover opened, every option was listed, and picking one did nothing; the leave
year was pinned to today's with no way to look at another. Both are wired now,
the year list runs three years back instead of one, and `leaveYear` is part of
the React Query key — without that the new year would have been answered from
the old year's cache entry.

Three smaller things fixed in passing:

- `isCurrent` compared the leave year's starting year against the **calendar**
  year, so between January and March it marked the wrong row "(Current)".
- The list header said "All Leave Request (n)" whatever was being shown. It now
  names the year and the status filter, which is what made "2" mysterious.
- An empty year rendered as blank space, which reads as a page that failed. It
  now says there is no leave booked in that year.

---

## 6d. The leave entitlement sheet ✅ **fixed**

The eye button beside the leave card, which opens the allowance / used /
remaining table. Four things were wrong with it, and they compounded.

**It was rendered only when the employee had no leave.** The condition was
`newData?.length === 0` — so the sheet appeared while the year was empty and
**disappeared the moment they booked anything**. Exactly backwards: an
allowance is most worth looking at once some of it has been spent.

**The name in its heading could never be filled in.** It read
`newData[0]?.employee.name`, evaluated in the one case where `newData` is
empty — so the header always said "Leave details of" and then nothing. Nothing
in the spread beside it supplied a name either.

**It showed the wrong person's entitlements.** `getEmployeeLeaveData()` took no
arguments at all: always the signed-in user, always today's leave year. So HR
opening someone else's Leave tab saw **their own allowance** under that
employee's name — and the new year filter could not move it. It now takes
`{ slug, leaveYear }` through the same access rule as everything else, and with
no arguments behaves as before.

That last one reached further than the sheet. The same value is handed to
`LeaveRequestNew` as `newData`, where it backs the "you only have N days left"
check — so booking leave **for** an employee was being validated against the
**admin's** remaining balance.

**Its edits refreshed nothing.** No `queryKey` was passed, so the sheet's
own mutations invalidated no cache.

One smaller thing: `getEmployeeLeaveData` returned `undefined` when a year had
no entitlement record, because `getLeaveData` falls off the end without an
`else`. It now returns `{ success: true, data: null }`. `getLeaveData` itself
is deliberately untouched — `syncMissingLeaveTypes` branches on its result
being falsy.

---

## 6e. The leave-year type mismatch ✅ **fixed**

Chasing `getLeaveData` returning `undefined` turned up why it was never
noticed: everything that depended on that branch was dead, and dead because it
could not work.

**`CommonLeave.leaveYear` is a String** — `"2026-27"`, written by
`getLeaveYearString()`. Five functions in `leaveServer.js` looked it up with a
**number**: `new Date().getFullYear()` / `getYear(new Date())`, which Mongoose
casts to `"2026"`. That matches nothing, ever.

So the "branches on falsy" I flagged earlier was not a style choice — **the
else branch was the only branch that ever ran**. `syncMissingLeaveTypes` could
never find an existing record, so every call created a *second* `CommonLeave`
row for an employee who already had one. `storeEmployeeLeave` was worse: its
balance update silently matched no document, while `editLeaveRequest`, which it
calls first, really did rewrite the leave request. Leave edited, balance
untouched.

All five were dead — `syncMissingLeaveTypes`, `checkWithStoreLeaveType`,
`storeEmployeeLeave`, `checkEligibility`, `editLeaveRequest`. Two were exported
`"use server"` functions, which are addressable endpoints whether or not a
button points at them, and working replacements already exist
(`syncMissingLeaveTypesNew` in `countLeaveServer.js`, which the scan button and
`handleOfficeEmployee` actually call and which builds its year with
`getLeaveYearString`; and `storeEmployeeLeaveData` for booking). Deleted, with
a note in their place. `isDateOverLapping` is kept — exported, read-only, no
year bug, just no caller.

**`getLeaveData` now says when it found nothing.** It returns
`{ success: false, notFound: true, message }` instead of falling off the end of
an `if` with no `else`. Still `success: false`, deliberately: every caller's
else branch means "no record for this year, make one", which is right for a
miss. `notFound` is there for the one caller that must tell a miss from a
failure — `getEmployeeLeaveData` maps it to an empty result, because a year
with no entitlements set is ordinary. Both copies of the function are fixed;
there are two, one in `leaveServer.js` and one in `countLeaveServer.js`.

### Still open — not touched

`storeLeave` and `countLeave` in `leaveServer.js` have the **same** number-year
bug: `countLeave` builds the record with `leaveYear: getYear(new Date())`. They
are also dead — `storeLeave`'s only import, in `officeServer.js`, was never
called (that dead import is removed). The live creation path is
`countLeaveNewFirstTime` in `countLeaveServer.js`. They should probably go the
same way as the five above, but that is a third cluster and worth deciding
separately rather than sweeping up.

---

## 6f. The password tab ✅ **rebuilt**

**The broken image was a CSP block, not a dead link.** The card hotlinked an
illustration from `notioly.com`, and `next.config.mjs` pins `img-src` to
`'self'`, our own S3, `cdc.construction` and Cloudinary. It was never going to
load in any environment. Removed rather than re-hosted: a decorative drawing
beside the password rules earns nothing.

**The rules now tick themselves off.** The static bullet list is a live
checklist against the value as it is typed, next to the same four-bar strength
meter the admin reset dialog uses — one scorer, so "Strong" means the same
thing wherever it is shown.

**Generate a strong one.** A button fills *both* the new and confirm boxes from
`generatePassword()` and copies the value, because filling only the first
leaves a sixteen-character random string to be retyped into the second, which
is the transcription most likely to go wrong. Same helper the admin dialog
uses.

The form was `GlobalForm`, which owns its own react-hook-form instance and
therefore gives a caller no way to set a field — so generate could not have
worked through it. It is now built the way the reset dialog is: `useGlobalForm`
+ `FormProvider` + `FormInput`, which keeps the eye toggle, the error styling
and the as-you-type validation the rest of the app has.

**Sign out everywhere** is a new action, `signOutAllDevices()` in
`authServer.js`. It moves the caller's own `sessionsValidFrom` forward — the
same lever the admin reset dialog already pulls on somebody else's account.

It ends **this** device too, and cannot do otherwise: sessions are JWTs refused
by issue time, so there is no token it could spare. Rather than leave that as a
surprise, the confirm dialog says so and the page signs the person out itself
instead of leaving them on a screen whose next request will bounce them. The
write is read back afterwards, for the same reason the admin reset does it — a
server holding a pre-`sessionsValidFrom` schema would report success having
saved nothing.

### Deliberately not changed

Changing your password still does **not** end your other sessions. Arguably it
should, and the card says plainly that it does not and points at the control
that will. Making it automatic would sign the person out of the tab they are
standing in the moment they change a password, which is a bigger decision than
this asked for.

---

---

## 7. Order of work

Each step is a commit that leaves the app working.

| # | Step | Touches HR view? | State |
|---|---|---|---|
| 1 | **H1 + H2 + H3** (§2) | No — privileged branch unchanged | ✅ done |
| 2 | `/admin/me` + `SELF_TABS`, rendering existing components with `can`; old routes still live | No — `can` defaults to full | ✅ done |
| 3 | Sidebar + avatar dropdown point at `/admin/me`; `/admin/account/[...id]` becomes a redirect (own id → `/admin/me`, otherwise → `/admin/officeEmployee/<id>`); drop the `proxy.js` bypass | No | ✅ done |
| 4 | Read-only profile + `profileChangeRequestModel` + HR approval queue | Adds an HR queue page; existing employee screens untouched | ✅ done |
| 5 | Documents read-only for self + expiry banner | No | part done — upload and delete are gone for everyone here; the expiry banner is not built |
| 6 | Bank Holiday out of the account area, onto shifts + leave | No | part done — on `/admin/me/leave`; the rota-calendar overlay is not built |
| 7 | Profile photo: model, upload, media, quota, replace | No | ✅ done |
| 8 | Delete `my-attendance` / `my-weekly-shifts` / `my-leaves` once redirects have shipped a release | No | |

### What steps 1–3 actually put in place

```
lib/employeeAccess.js              who may act on whose record, + SELF_EDITABLE_FIELDS
app/admin/me/page.jsx              → /admin/me/profile
app/admin/me/_components/          selfMenu · selfProvider · profileShell
app/admin/me/profile|documents|security
app/admin/me/attendance|shifts|leave
```

Three things that were not in the written plan and had to be dealt with:

1. **`data/features.js` gates by path**, so the new routes needed registering or
   a company with the rota or leave module switched off would have reached them
   through the new URLs. `/admin/me/shifts` and `/admin/me/leave` now sit with
   their modules; `/admin/me` is core, like the account area it replaces.
2. **The old paths still need to be reachable** for their redirects to run —
   the route guard would otherwise bounce an old bookmark to the dashboard. They
   are `hidden: true` entries in `COMMONMENUITEMS`: a permission bypass with no
   sidebar link. The sidebar filters that flag out.
3. **`/admin/my-leaves` was broken for super admins** — it passed an empty
   `searchParams`, which `employeeLeaveDetailsNew` feeds to `extractData`, so a
   super admin opening their own leave got nothing back. `/admin/me/leave`
   passes their own id and works for every role.

---

## 8. Open questions

**Q1 — `/admin/me` or `/me`?** `/me` reads better; an ordinary employee should
not be browsing a URL that says "admin". But `proxy.js:381` pins role `user` to
the `/admin` prefix, so `/me` means touching the role-prefix guard and the
post-login redirects. `/admin/me` now, `/me` as a later rename.

**Q2 — Which fields are self-editable?** ✅ **answered in code.** The `self` rows
of `lib/profileFields.js`: phone, address, street, city, postcode, and the four
emergency-contact fields. **`email` was dropped from the §4 proposal** — the
model has one email field and it is the login identifier, so editing it changes
which account they are; it is a `request` instead. Moving a field between the
three states is a one-word edit in that table, and the server follows.

**Q3 — approval or notify-only?** ✅ **approval**, as proposed. Nothing changes
until HR presses the button, and approving writes an audit row against the
employee.

**Q4 — Should the queue have its own permission, or ride on
`/admin/officeEmployee`?** It has its own (`/admin/profileRequests`), which
means admins need it granted before the link works. Folding it into the staff-
list permission would save that step but would also hand the queue to everyone
who can see the list, which is not the same population.

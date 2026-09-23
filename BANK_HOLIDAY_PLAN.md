# Bank Holidays — Report & Plan

Status: **Phases 1–4 built, plus per-nation regions.**
Branch: `feat/multi-tenancy-phase-1`.

Goal: a company decides whether it observes UK bank holidays. Observed, the
office is shut and the day costs nobody a day of annual leave. Not observed, it
is an ordinary working day and a day off on it is deducted like any other.

---

## 1. Where things actually stand

Checked in the code, not assumed:

| | State |
|---|---|
| Bank holiday data | **Already fetched** — `server/holidayServer/holidayServer.js` pulls gov.uk, cached a day, `england-and-wales` |
| Used for anything? | **No.** `useBankHoliday` has exactly one consumer: `bankHoliday.jsx`, a card that lists them. Display only. |
| Leave date picker | Disables **Sundays only** (`getDay() === 0`, `column-calendar.jsx:59`). Saturdays and bank holidays are freely selectable |
| Leave deduction | `leaveDates` is whatever the picker sent. Nothing filters it |
| Filter attendance | **No leave awareness at all** — zero references to leave in `fetchFilterClockRecordData` |
| Settings home | `leaveSettings/settingsTab.jsx` + `WorkSetting` (tenant-scoped), both landed today |

### So: you are right

Today every company behaves as "does not observe bank holidays" — a day off on
Christmas Day is deducted from annual leave, because nothing anywhere treats
that date differently. There is no setting to change it. That is exactly the
mismatch you described.

### Two corrections

**1. "Observed" cannot mean "nobody worked".** Site crews do work bank
holidays. If the setting made the day non-working for reporting, a real clock
record on that date would be contradicted by the calendar. The rule has to be:
*a bank holiday is not a working day by default, but an actual clock record
always wins* — the same precedence `eae57f9` already uses on office attendance,
where clocking in beats a booked holiday.

**2. Deduction is decided at booking, not at reporting.** The balance is spent
when `leaveDates` is written. Changing only the attendance screens would leave
balances wrong while the reports looked right. Both ends have to move, and the
booking end is the one that actually protects the balance.

### One thing worth knowing now — ✅ **now fixed**

`REGION` was hard-coded to `england-and-wales`. It is now a per-company setting
(`WorkSetting.bankHolidayRegion`) offering all three lists gov.uk publishes.
Verified against the live feed: Scotland has 2 January and not Easter Monday;
Northern Ireland adds St Patrick's Day and the Twelfth.

---

## 2. The decisions

**D1 — Default for existing companies.** `observesBankHolidays: false`.
Every company today deducts bank holidays, so `false` is what they are already
doing and nobody's balance moves on deploy. The same absent-means-current-
behaviour rule the feature flags use. Companies that do observe them flip it on
deliberately.

**D2 — Does turning it on re-value leave already booked?** No. An approved
request that spent a day on 25 December stays spent. Retroactively refunding
days would rewrite balances that have already been reported on and paid against.
The setting governs bookings from the moment it is set; anything earlier is
corrected by hand if it needs to be.

**D3 — Where the flag lives.** `WorkSetting`, beside `fixedWeeklyHours`. It is
already tenant-scoped, already has a settings panel under Leave Management, and
"is this a working day" is a working-time default. Not `LeaveSetting`, which is
about leave years and carry-forward.

**D4 — Enforced on the server, not just hidden in the picker.** A disabled date
in the calendar is a courtesy; `addLeaveRequest` is the single engine every
submission path funnels through, so the exclusion belongs there too — the same
argument `lib/sickNote.js` already makes for its own rule.

---

## 3. Plan

### Phase 0 — Foundation ✅ **DONE** — `616478a` ported

Filter Attendance shows clock records and nothing else on this branch. Main's
`616478a` unions leave into it as its own row kind and adds the totals block;
`eae57f9` and `bb57773` do the equivalent for Office Attendance.

Bank holidays have nowhere to surface on Filter Attendance until that exists.
**Phases 1–3 do not depend on it** — they fix booking and balances, which is the
part that actually costs people days. Phase 4 is where it matters.

### Phase 1 — The setting ✅ **DONE**

1. `WorkSetting.observesBankHolidays: { type: Boolean, default: false }`.
2. `getWorkSettings` / `updateWorkSettings` already round-trip the document —
   the field comes along with no server change beyond validation.
3. A switch in `workHoursSettings.jsx`, worded so the consequence is legible:
   on = "the office is closed, these days do not come out of anyone's
   allowance"; off = "an ordinary working day; a day off on one is deducted".

### Phase 2 — One shared rule ✅ **DONE** (`lib/bankHolidays.js`)

`lib/bankHolidays.js`, dependency-free so the forms and the server agree:

- `toDayKey(date)` — UTC day stamp, the keying `lib/sickNote.js` already uses.
- `isBankHoliday(date, holidays)`
- `excludeBankHolidays(dates, holidays)` — returns `{ kept, removed }`
- `describeExclusion(removed)` — the sentence shown to the user

The gov.uk list is passed in rather than fetched inside, so the rule stays pure
and testable and the caller decides where the list comes from.

### Phase 3 — Booking ✅ **DONE** ← *the part that protects balances*

1. Date picker disables bank holidays when observed, with the same treatment
   Sundays already get.
2. `addLeaveRequest` drops observed bank holidays from `leaveDates` before the
   day count is taken, and says so in the response: "2 days booked. 26 December
   is a bank holiday and was not deducted."
3. Half-day and multi-year splitting run on the filtered list, so the counts
   downstream cannot disagree.
4. Nothing changes when the flag is off — the list passes through untouched.

### Phase 4 — Reporting ✅ **DONE** (Filter Attendance)

`fetchFilterClockRecordData` now returns the company's bank holidays falling
inside the reported range, and the screen names them above the table — with the
count carried into the CSV totals block so an export says the same thing.

Bank holidays **cannot** be unioned into the aggregation the way leave is: leave
is a collection, gov.uk is not. They are fetched alongside and returned with the
result, rather than faked into the row set.

There is no "expected hours" figure on this screen to subtract from — it reports
what happened, row per record. So when the office is closed there is simply no
clock record and no leave request for the day, and the hours look low for no
stated reason. Naming the holidays is what turns an unexplained gap into an
explained one, which is the mismatch this was meant to remove.

Empty, and therefore silent, when the company does not observe bank holidays —
they are ordinary working days then and the report should say nothing.

**Office Attendance ✅ — `eae57f9` and `bb57773` now ported.**

Those commits already shipped a bank holiday caption and a `bank-holiday` row
status, but they asked gov.uk directly: always the England and Wales list, and
flagged whether or not the company closes that day. So a business that works
bank holidays was told a normal working day had "expected low turnout" and its
staff were reported as bank-holiday rather than absent — the same mismatch this
feature exists to remove, arriving from the other direction.

The board now reads `useBankHolidayRule()`, so the caption and the status follow
the company's own setting and its own nation. A clock record still wins over the
calendar, verified: `clockIn` is tested before `onLeave`, which is tested before
`isBankHoliday`, with `absent` the fallback.

A server-side lookup was written for this and then deleted — the board computes
it client-side, and two sources for one answer is what this whole feature is
trying to avoid.

**Weekly rota ✅.** Autofill no longer rosters anyone onto a day the office is
shut, and the cell is locked the way Sunday already was. Sunday had been handled
three slightly different ways across the two autofill branches and the edit
guard; all three now share one `nonWorking(day, date)` predicate, which is what
stops them drifting apart again.

**Bank Holiday tab ✅ (view only).** The tab could only ever show England and
Wales. It now opens on the company's configured nation and offers all three as a
local view switch — present on the loading, error and empty states too, so a
failed fetch cannot strand whoever switched to get there. It writes nothing: the
setting that decides whether the office closes stays in Settings, and the tab
says so.

Another nation's cards carry a dashed amber border and the year heading names
the nation, so a glance or a screenshot cannot be mistaken for the company's own
days off. Dashed rather than tint alone, for the same reason `bb57773` gave its
unpaid-leave badge a dashed border: the two states have to stay apart without
relying on colour.

### Phase 5 — Verification ✅ **DONE** (ad hoc, not yet a committed script)

Run during development, not kept: 24 assertions on the rule, 11 end-to-end on
booking cost, 10 on region selection against the live gov.uk feed, and 10 on the
report's range filtering. Worth promoting to `npm run audit:bank-holidays`
alongside the other audits if this area keeps changing.

---

## 4. Risks

| Risk | Mitigation |
|---|---|
| Balances silently change on deploy | D1: default off = today's behaviour exactly |
| Past reports shift when gov.uk republishes | gov.uk publishes past dates stably; if it becomes a problem, snapshot the list per leave year |
| A company flips the flag mid-year | D2: bookings already made stand; the change is forward-only and the UI says so |
| Someone genuinely worked the bank holiday | Clock record always wins over the calendar (§1 correction 1) |
| ~~Scottish/NI tenants get English dates~~ | **Fixed** — `bankHolidayRegion` per company, verified against the live feed |
| A company picks the wrong nation | Region is only asked once the toggle is on, and the help text names what differs between the lists |

---

## 5. Estimate

| Phase | Days |
|---|---|
| 0 — port `616478a` (+`eae57f9`, `bb57773`) | 1.0 |
| 1 — the setting | 0.5 |
| 2 — shared rule | 0.5 |
| 3 — booking | 1.0 |
| 4 — reporting | 1.0 |
| | **3.0, or 4.0 with Phase 0** |

Phases 1–3 are the ones that stop people losing annual leave they should have
kept. Phase 4 makes the screens agree with the balances.

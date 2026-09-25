# Clocking In Without a Device at Every Location — Plan

**Date:** 2026-09-21
**Branch:** `feat/multi-tenancy-phase-1`
**Scope:** how an employee proves they are at work, when there is no screen to scan.

---

## 1. The problem, stated properly

Three complaints, one cause:

- Many sites, two employees each. A scanning device per site is not affordable.
- The site manager holds the device and arrives after the employees, so they wait.
- One company, two offices. Office 1 has 10–20 people and justifies a device.
  Office 2 has 4–5 and does not.

The common thread is **not** cost. It is that every method we have needs *a person or
a powered device to already be there*. The late manager and the small office are the
same failure wearing different clothes.

**The fix is to make the place itself the credential.** A place is never late and never
needs charging.

---

## 2. What the code says today

Checked before planning, because two of these change the order of work.

### 2.1 There is no second office

A clock record carries `locationType: "office" | "site"` and a `siteId` that is **null
for every office** (`models/clockInModel.js`). Office 1 and Office 2 are the same place
in the data — indistinguishable, unreportable, unfilterable.

So the two-office problem is not only a hardware problem. Even if both offices had a
device tomorrow, the records would still be indistinguishable.

### 2.2 Sites have an address, not a position

`models/siteProjectModel.js` has `siteAddress` as free text. There are no coordinates,
so there is nothing to geofence against yet.

### 2.3 Both new mechanisms already exist elsewhere in this codebase

`models/officeModel.js` (the office *account*, not a building) already has:

```js
authorizedDevices: [{ deviceId, deviceName, addedAt }],
restrictedIPAddresses: [{ ipAddress, addedAt }],
enforceDeviceLock: { type: Boolean, default: true },
```

and `app/auth/loginUi.jsx` already computes a FingerprintJS device id at sign-in. IP
allowlisting and device binding are concepts this app already has — they are simply not
connected to clocking.

### 2.4 Site managers cannot currently do a roll-call

This one corrects an assumption. The screens that carry clock actions are:

| Screen | Path | Role gate |
|---|---|---|
| Office attendance | `/admin/attendance` | `superAdmin`, `admin` |
| Site attendance | `/admin/siteAssignEmployee` | **`superAdmin` only** |

A site manager holds the `user` role and reaches `/admin/siteAssign` ("Site Managers"),
which has **no clock actions on it at all**. So the roll-call capability exists as a
screen, but the person who would use it cannot open it.

That is a menu role change plus a permission check, not a feature. It is the cheapest
item in this whole plan and it is listed first in §8.

### 2.5 `x-forwarded-for` is read in a way that must not be used for authorisation

`lib/audit.js:222` and `auth.js:62` both do:

```js
h.get("x-forwarded-for") || h.get("x-real-ip")
```

Caddy **appends** to whatever the client sent. A client sending
`X-Forwarded-For: 203.0.113.9` produces `203.0.113.9, <their real IP>`. Reading the
whole header, or its first entry, reads the value the client chose.

That is acceptable for an audit note. It is a hole if it ever gates a clock-in. See §7.1.

---

## 3. The model: everything is a location

**There is no such thing as "the office" as a special case.** Office 1 and Office 2 are
places you clock in at, exactly like Elm Street is. Modelling them as a separate concept
is what produced §2.1, where every office collapsed into one null.

So: **one entity, `ClockLocation`, covering offices and sites alike.** `kind` is a label
for grouping and reporting, not a structural difference — nothing branches on it.

```js
ClockLocation {
  tenantId,
  name: "Head Office" | "Northgate Office" | "Elm Street",
  kind: "office" | "site",     // label only. No code branches on this.
  projectSiteId,               // set when this location is an existing ProjectSite
  isActive,

  geofence: { lat, lng, radiusMetres },
  networks: [ "203.0.113.0/24", "2001:db8::/32" ],

  methods: [                   // several, evaluated together
    { type: "deviceQr" | "network" | "geofence" | "nfc" | "rollCall",
      mode: "off" | "shadow" | "enforce" }
  ],
  requireAll: false,           // false = any accepted method lets them in
}
```

Clock records gain `locationId`, and the evidence that let them in:

```js
locationId,                    // required going forward. Replaces siteId.
clockInEvidence: {
  method: "nfc",
  coords: { lat, lng, accuracyMetres },
  ip: "203.0.113.42",
  deviceId: "<fingerprint>",
  tagId, tagCounter,           // see §5
  tokenJti,                    // if a rotating code was used
}
```

### 3.1 What this changes structurally

- `siteId: null` stops meaning "the office". Every record names its place.
- The unique index moves from `(tenantId, employeeId, date, siteId)` to
  `(tenantId, employeeId, date, locationId)`.
- `canClockAtLocation` in `server/2FAServer/qrcodeServer.js` loses its
  `if (!siteId) { must be an office employee }` branch entirely. It becomes one
  question asked of one location.

### 3.2 Who is allowed at a location

Sites already answer this: `SiteAssignmentModel` is a daily roster. Offices have no
roster and never will — office staff simply turn up. So the permission check is:

> **rostered** at this location today (sites), **or** this location is in the employee's
> permitted set (offices).

That needs `permittedLocationIds` (or a single `defaultLocationId`) on the employee.
Without it, unifying the model would leave office staff with nothing to check against.

### 3.3 The one thing the migration cannot do

Existing office records are all `siteId: null`. **Nothing in the data says which office
they happened at** — that information was never recorded. So the backfill can only put
every historical office record into a single default location.

Splitting history between Office 1 and Office 2 retrospectively is not possible, and no
amount of cleverness makes it possible. From the cutover forward it is recorded
correctly; before it, it is one office. Say this to whoever reads the reports.

**Do §3 even if nothing else here ships.** It is what gives per-office attendance,
which is impossible today.

### 3.4 Running the migration — order, and what production taught us

Run them in this order. It is **not** the order they were written in:

```
npm run clock:dedupe      # no duplicate employee-days, so the unique index can build
npm run clock:locations    # create the places, stamp every existing record
npm run clock:migrate      # move clocks + siteclocks into clockrecords
npm run clock:cutover      # fence off the imported history from the review queue
```

Each takes `--apply`; without it they are a dry run and write nothing.

`clock:migrate` predates locations and originally ran second. It has to run **last**:
the unique index on `clockrecords` keys on `locationId`, so a batch of rows arriving
with a null one collides with itself the moment two share an employee and a day. It
now resolves a location per row and refuses to guess — a row it cannot place is
reported as unusable rather than inserted unstamped.

Two things the first production run found, both worth keeping in mind for the next
tenant:

- **A company may already have named its office.** `ensureDefaultLocation()` used to
  create "Head Office" unconditionally; against a database with one existing office
  that would have split their history across two places, and reassignment is
  deliberately not retroactive, so it would not have been fixable afterwards. It now
  adopts a lone existing office as the default instead.
- **Migrated history has to be fenced off.** The auto-closer flags shifts nobody
  clocked out of so an admin can settle them. Pointed at imported history it flagged
  24 — spread over sixteen months, the newest five months old, none of them now
  answerable. A queue of unanswerable items is one people stop opening. So each
  company has a **cutover date** (`clockCutoverDate` on WorkSetting): nothing before it
  is flagged, and nothing before it is priced for overtime either, since writing a pay
  figure onto a pre-cutover record is the same retroactive change and a quieter one.
  Set it with `npm run clock:cutover -- --apply` after the three migrations, or edit it
  on the clock rules screen. `null` — the default — means no floor, which is correct
  for a company with no legacy data: there is nothing unreviewed to hide, and a floor
  would only mask real gaps.
- **Two sites may share a name.** The name-uniqueness index applied to every location
  and halted the backfill halfway on a company running two jobs both called "Park Road
  New". That is not a data error. Uniqueness now applies to **offices only** — an
  office name is typed by a person, a site's is owned by the site. The one case the
  partial index cannot see, a site named onto an *office's* name, is checked in code
  (`officeNameTaken`) on every path that sets a name.

## 4. The methods

Dropped from the earlier shortlist: **printed QR**. A static printed code is
photographed once and used from home forever; next to a geofence it adds nothing but
ceremony. It is not in this plan.

| Method | Hardware | Works on site | Spoofing | Friction | Status |
|---|---|---|---|---|---|
| Rotating QR on a device | screen + power + network | needs both | **hard** — 30s, single-use, site-bound | queue at the screen | **built** (Phase 3) |
| IP allowlist | none | no | medium — VPN, shared line | none | to build |
| Geofence | none | **yes** | medium — fake-GPS apps | one permission | to build |
| NFC tag | £1–4 sticker | **yes** | low → **hard**, see §4.3 and §5 | lowest (tap) | to build |
| Manager roll-call | none | yes | attested, not proven | manager-dependent | **exists, mis-gated** (§2.4) |

### 4.1 IP allowlist — for Office 2

Store CIDR ranges on the location. On clock-in, compare the client IP.

Good: zero hardware, zero friction, and "be on the office WiFi" is a natural
instruction for someone who is in the office anyway.

Honest about the limits: it proves **which network**, not which place. Anyone with VPN
access to the office network can clock in from their sofa. For a four-person office
that is probably acceptable — but decide it deliberately rather than inherit it.

Needs: the XFF fix (§7.1), IPv6 prefix matching (match on `/64`, not a single address),
a self-service "add my current IP" for an admin, and an alert when clock-ins at a
location start failing — a dynamic broadband IP changing overnight would otherwise lock
the whole office out at 08:00.

### 4.2 Geofence — for sites

Browser Geolocation against `geofence.lat/lng/radiusMetres`.

It is the **only** method needing nothing at the location: no power, no network, no
person, no sticker. For a two-person site that is the whole argument.

Rules that matter:

- **Never refuse on a poor fix.** Steel frames and urban canyons give 50 m+ accuracy.
  Accept it, store `accuracyMetres`, and flag the record — we already have
  `needsReview` from Phase 4 for exactly this shape of problem.
- Store the coordinates. The audit trail is half the value.
- Use a cached position (`maximumAge`) so a cold GPS fix does not make someone stand in
  the rain for 30 seconds.
- Fake-GPS apps exist on rooted Android. Combined with device binding (§2.3) the bar is
  reasonable; alone it is moderate.

### 4.3 NFC — the one worth explaining properly

You asked how this actually works. It is a better idea than it first looks, but only if
the right chip is bought.

**How a tap reaches the app.** An NFC tag stores an NDEF record. If that record is a
**URI**, both platforms handle it natively with *no app installed*:

- **iPhone XS / XR and later, iOS 14+** — *background tag reading*. With the phone
  unlocked and no app in the way, holding it near the tag raises a banner; tapping the
  banner opens the URL in Safari. Older iPhones (7/8/X) can read NFC only from inside an
  app using Core NFC, so they are out.
- **Android** — the same: the system reads the URI record and offers to open it. Chrome
  also exposes the **Web NFC API** (`NDEFReader`), which lets our page scan a tag while
  it is open. That is Android-Chrome only; it is a nice enhancement, never the baseline.

So the baseline is: **tag holds a URL, tap opens it, the URL tells us the location.**

```
https://hr.example.com/clock?loc=<locationId>
```

**Why a plain tag is not enough.** That URL is static. After one tap it is in the
employee's browser history and can be revisited from anywhere. A plain NTAG213 is
therefore in the same category as a printed QR — with one genuine advantage: you cannot
photograph an NFC tag or send it over WhatsApp. You have to be within about 4 cm of it.
That stops casual sharing but not a determined person.

**The chip that makes this properly secure: NTAG 424 DNA.** This chip does **SUN**
(Secure Unique NFC) messaging: on every single tap it increments an internal counter and
computes an AES-CMAC over the counter and its UID using a key held on the chip, then
injects both into the URL it emits:

```
https://hr.example.com/clock?loc=ELM&picc=<encrypted UID+counter>&cmac=<signature>
```

The server holds the same key, decrypts, verifies the CMAC, and checks the counter is
**higher than the last one seen for that tag**. A replayed URL fails on the counter. A
forged URL fails on the CMAC.

That is the same security property as the rotating QR — unique per tap, unreplayable,
bound to one location — in a sticker that costs a few pounds, needs no power, no
network, and no person.

**Practicalities:**

| | NTAG213/215 | NTAG 424 DNA |
|---|---|---|
| Cost each | ~£0.30–1 | ~£2–4 |
| URL per tap | static | unique + signed |
| Replay-proof | no | **yes** |
| Programming | any phone + NXP TagWriter | needs key config (TagXplorer, or buy pre-programmed) |
| Server work | read a query param | AES-CMAC verify + counter store |

**Two physical gotchas that will bite:**

1. **NFC does not work on bare metal.** Stuck to a steel cabin or container, the metal
   detunes the antenna and the tag is dead. Site cabins are usually metal. Buy
   **on-metal tags** (ferrite-backed) for those, or mount on a non-metal surface.
2. **Outdoor sites need weatherproof/industrial tags**, and the tag can be prised off or
   swapped. Mount inside the cabin, and treat a tag as revocable — a tag id that starts
   appearing from the wrong geofence should be disabled.

**Recommendation:** pair it. Tag (convenience + presence) **plus** geofence (the
control). If you later want the tag to *be* the control on sites with poor GPS, move
those sites to NTAG 424 DNA and drop the geofence requirement there.

### 4.4 Manager roll-call — already built, wrongly gated

See §2.4. It does not solve lateness — nothing person-dependent can — but it is the
override path every other method needs, and it should be reachable by the person who
would use it.

---

## 5. NFC tag binding and reassignment

A tag is not a sticker with a URL on it. It is a piece of hardware with a lifecycle —
bought, programmed, mounted, moved when a site closes, lost, stolen, retired — and none
of that is expressible unless tags are **registered entities the app knows about**.

Without a registry you cannot: revoke a stolen tag, say which tag was tapped, move a tag
to a new location, or notice a cloned one. For NTAG 424 DNA the registry is not even
optional: the replay defence *is* the stored counter.

### 5.1 The model

```js
ClockTag {
  tenantId,
  label: "Elm Street — cabin door",
  chipType: "ntag213" | "ntag424",
  uid: "04A2B3C4D5E680",        // from the chip. Unique per tenant.

  locationId,                    // current binding. Null while unassigned.
  status: "unassigned" | "active" | "suspended" | "retired",

  // NTAG 424 DNA only
  keyRef,                        // reference to the AES key. NEVER the key itself.
  lastCounter: Number,           // the replay defence. Only ever increases.

  lastSeenAt,
  lastSeenLocationId,            // where the tap actually came from, per geofence

  assignedBy, assignedByName, assignedAt,
  history: [
    { fromLocationId, toLocationId, at, byName, reason }
  ],
}
```

Constraints that carry weight:

- **`uid` unique per tenant.** Two tags must not be able to claim one identity.
- **`lastCounter` only ever increases.** A tap whose counter is less than or equal to
  the stored value is a replay and is refused. This is the whole security property of
  the 424 DNA variant; storing it is mandatory, not an optimisation.
- **Per-tag keys, never one shared key.** If every tag shares a key, losing one tag
  means re-keying every tag in the company. Per-tag keys make a loss a one-tag problem.
- **The AES key does not belong in the database in plaintext.** Store an encrypted blob
  or a reference resolved from an environment-held master key. `lib/algo.js` already has
  the encrypt/decrypt used elsewhere for ids; this needs at least that, and ideally a
  key that never leaves the server's environment.

### 5.2 Binding a tag: tap to enrol

Typing a 14-character hex UID off a sticker is how the wrong tag ends up bound to the
wrong site. Instead:

1. SuperAdmin taps a brand-new tag with their phone.
2. The tap reaches the app, which finds no matching `ClockTag` — so it records it as
   **seen but unknown** rather than simply refusing.
3. The admin screen shows *"Unknown tag, seen 10 seconds ago"* with an **Assign**
   button.
4. They give it a label and a location. Bound.

The UID is read from the chip, never transcribed. The same screen is where a tag that
has been prised off and moved will surface.

### 5.3 Reassigning a tag — a move, not an edit

**SuperAdmin only.** A site finishes, the cabin moves to the next job, the tag goes with
it. Reassignment points the tag at a different `ClockLocation`.

The rule that matters:

> **Reassignment is not retroactive.** Clock records written before the move keep the
> location they were written with. They are a record of where someone actually was.

Getting this wrong would silently re-attribute historical attendance — and therefore
pay and CIS — to a site the work never happened on. So:

- `locationId` changes from the moment of the move forward.
- Every move appends to `history` with who, when, from, to, and why.
- The move is written through `withAudit`, like every other consequential action here.
- A tap already in flight resolves against whatever the tag pointed at when it was
  verified. A second either way does not matter; silently rewriting six months does.

### 5.4 Status, and what each one does to a tap

| Status | Tap behaviour | When |
|---|---|---|
| `unassigned` | refused, surfaced for enrolment (§5.2) | fresh tag, or one whose location was deleted |
| `active` | accepted, subject to the location's methods | normal |
| `suspended` | refused: *"this tag has been deactivated — tell your manager"* | suspected clone, tag missing, site paused |
| `retired` | refused, and never re-enrollable under the same UID | lost, stolen, damaged |

Suspension has to be instant and reversible — it is what a manager reaches for when a
tag goes missing on a Friday afternoon and nobody yet knows whether it was stolen.

### 5.5 Detecting a cloned or moved tag

This is why `lastSeenLocationId` is stored. A tag bound to Elm Street whose taps arrive
from coordinates twenty miles away is either cloned, or physically moved without anyone
reassigning it. Neither is acceptable silently.

- With geofence enforcing, the tap is refused anyway — the tag says Elm Street, the
  coordinates disagree.
- With geofence only shadowing, the tap succeeds but the mismatch is recorded and
  surfaced on the anomaly report (§7, Phase D).
- Either way the pairing is the detector: **a tag alone cannot tell you it has been
  moved. A tag plus a position can.**

A counter that jumps backwards, or a UID seen with two different counters in the same
minute, is a cloned chip. Both are refusals, not warnings.

### 5.6 Programming the tags

- **NTAG213** — any phone and NXP TagWriter (free). The chip supports a *UID mirror*, so
  the URL it emits can carry its own UID without per-tag hand-editing. It also has a read
  counter, but that counter is **not signed**, so it identifies a tag without proving
  anything. Fine for the tag-plus-geofence pairing; not a control on its own.
- **NTAG 424 DNA** — needs key configuration (NXP TagXplorer, a vendor tool, or bought
  pre-programmed with keys supplied). This is a procurement decision more than a coding
  one; budget for it before ordering twenty tags.

### 5.7 Admin screens this needs

- **Tags list** — label, chip type, UID, bound location, status, last seen, with filters
  for unassigned and unseen-for-N-days.
- **Assign / Reassign** — superAdmin only, location picker, reason field, writes history.
- **Suspend / Retire** — one click, immediate.
- **Unknown tags** — the enrolment queue from §5.2.
- **Tag history** — every move, who made it, why. Read-only.

---

## 6. Hardware ordering and provisioning

§5 assumes tags arrive from somewhere. They do not — somebody has to buy, programme and
post them, and asking every customer to source NFC chips and configure AES keys is not a
product. This makes the hardware part of the platform.

All of it sits on things this codebase already has: `app/platform/` for the provider-side
screens, `platformAdmin` for who staffs them, `GLOBAL_MODELS` for a catalogue that is not
tenant-scoped, `data/features.js` for gating, and per-tenant currency from
`lib/tenant.js`.

### 6.1 The customer never generates, sees, or handles a key

This is the rule the rest of the section exists to protect.

A key the customer generates is a key that gets emailed, pasted into a spreadsheet, or
reused across every tag they own. A key they can read is one they can leak. And a key
they can lose is a support call where the tag is unverifiable and the only remedy is
re-provisioning the hardware.

> **Keys are generated in the backend during fulfilment, per tag, and never leave the
> server.** Not shown to the customer. Not shown in our own admin screens. Not logged.

The customer's mental model should be "I ordered twenty tags and they work". Nothing
about AES should ever reach them.

### 6.2 The catalogue

Platform-level, not tenant-scoped — one catalogue every company orders from. Belongs in
`GLOBAL_MODELS` alongside `Companie` and `PlatformUser`.

```js
TagProduct {
  sku, name: "Round disc 30mm",
  formFactor: "round" | "card" | "keyfob" | "sticker" | "wristband",
  chipType: "ntag213" | "ntag424",
  onMetal: Boolean,            // ferrite-backed
  weatherproof: Boolean,
  unitPrice, currency, minQuantity, leadTimeDays,
  customisation: { logo: Boolean, text: Boolean, colours: [...] },
  isActive,
}
```

**The ordering screen must ask where the tag is going to be mounted.** §5.6 records that
NFC does not work on bare metal and that site cabins are usually steel. A customer who
orders twenty plain round discs for steel cabins has bought twenty things that do not
work, and will report it as a software bug. One question — *"metal surface?"* — and the
list filters to on-metal products. That question is worth more than any other field on
the form.

### 6.3 Ordering

```js
TagOrder {
  tenantId, orderNumber,
  status: "draft" | "placed" | "accepted" | "provisioning"
        | "shipped" | "delivered" | "cancelled",
  items: [{ productSku, quantity, customisation: { text, logoAssetId, colour } }],
  shippingAddress, notes,
  placedBy, placedByName, placedAt,
  fulfilledBy, shippedAt, carrier, trackingRef,
}
```

- Placed by a tenant **superAdmin**, behind a `tagOrdering` feature key.
- Priced in the tenant's own currency (`formatCurrency` already takes one).
- Every status change through `withAudit` — this is an order for physical goods.
- Billing is **not** in scope for the first cut: quote and invoice outside the app, and
  the order carries a total for reference. Say so explicitly rather than half-building a
  checkout.

### 6.4 Provisioning — the security-critical part

When an order is accepted, the backend creates one `ClockTag` row per unit ordered and
generates a key for each:

```js
key = crypto.randomBytes(16)            // AES-128, per tag. Never one shared key (§5.1).
keyRef = envelopeEncrypt(key, MASTER_KEY_FROM_ENV)
```

Stored as `keyRef` on the tag, decryptable only by the server at tap-verification time.
The plaintext key exists in memory during provisioning and nowhere else.

An operator then programmes each physical chip at a **provisioning station** — an NFC
writer plus a small tool. The station is the one place a live key is handed out, which
makes it the most sensitive surface in this whole plan:

- Authenticated as a `platformAdmin`, over a short-lived token scoped to one order.
- **One fetch per tag.** Once a tag is marked `written`, the endpoint refuses to hand
  its key out again. There is no legitimate second fetch.
- Key material is never written to a log, an error message, or an audit entry. The audit
  records *that* a key was issued, never the key.
- A write that fails half way marks the tag `failed` and **issues a new key on retry**.
  Never re-use a key that may have been partially written to a chip.

Per-tag provisioning status: `pending → keyed → written → verified → shipped`, plus
`failed`.

### 6.5 Verify before it goes in the box

After writing, the operator taps the tag on the station and the server verifies the CMAC
and records the starting counter. **A tag that has not verified does not ship.**

Without this step a customer receives a tag that silently does not work, three days
later, two hundred miles away, and nobody can tell whether the fault is the chip, the
key, the URL or the phone. Catching it at the bench costs seconds.

### 6.6 What the customer receives

The tags arrive **already in their registry**, as `unassigned` (§5.4) — because the
order created the `ClockTag` rows and provisioning filled in each UID.

So the unboxing is: carry a tag to the cabin door, stick it up, tap it. Tap-to-enrol
(§5.2) recognises an unassigned tag belonging to that tenant and offers to bind it to a
location. No UID is ever typed, no key is ever mentioned, and the customer does not need
to know what NTAG 424 DNA is.

### 6.7 Screens

**Tenant side** — catalogue with the mounting-surface question, basket, order history
with tracking, and reorder.

**Platform side** (`app/platform/`) — order queue by status, the provisioning station
view (one order, its tags, their statuses, the write/verify actions), and dispatch.

### 6.8 The catalogue is maintained in the app, not in a script

Prices change, products get withdrawn, new shapes get added. A seed script somebody has
to remember to edit and re-run is a catalogue that goes stale, so the platform console
owns it: **Platform Console → Catalogue**.

One rule holds the accounting straight: **a price change applies to orders placed after
it.** `placeTagOrder` copies the unit price onto the order line, so nothing on this
screen can re-price an invoice after the fact. Products are withdrawn from sale rather
than deleted, because an order references a SKU and a product that vanishes turns every
order that bought it into a row nobody can explain.

Each row shows how many units have actually sold, because that is the question a price
change raises.

### 6.9 Delivery and order tracking — BUILT (E3)

What exists today is the minimum that gets hardware to a customer: an order is marked
shipped with a carrier and a tracking reference, and the customer sees that string on
their orders list. That is enough to send twenty tags and not enough to run a hardware
line.

What is missing, roughly in the order it will start to hurt:

- **Status the customer can read.** "shipped" plus an opaque reference is not a
  delivery. A tracking *link* per carrier, and a delivered state, so nobody has to ask
  us where their box is.
- **Partial shipments.** An order of fifty where forty verify and ten fail currently
  cannot ship at all — §6.5 refuses while anything is unverified, which is right for the
  tags and wrong for the customer waiting on the forty.
- **Dispatch detail**: weight, parcel count, label printing, an address that is
  validated rather than a free-text line.
- **Returns and replacements.** A tag that arrives dead needs a route back that retires
  the old UID and provisions a new one against the same order, or the customer's
  registry fills with tags nobody can account for.
- **Stock.** Lead times are currently a number typed into the catalogue rather than
  anything that knows how many blanks are on the shelf.
- **Payments and invoicing.** Deliberately outside the app for now — the order carries a
  total for reference and the invoice happens separately.

**What E3 built**, of the above:

- **Tracking the customer can read.** `data/carriers.js` holds a carrier per row with a
  tracking URL template; the customer sees a link, not a reference to paste somewhere.
  A carrier with no template, or one whose URL we get wrong, degrades to plain text —
  a missing link reads as "copy this", a broken one reads as "your parcel does not
  exist".
- **Partial shipments.** An order now has *shipments*, each with its own carrier,
  reference, parcel count and units. The "nothing unverified ships" rule moved from the
  order to the unit, so forty verified tags go out while ten are still being made and
  the order reads `partially-shipped`.
- **A delivered state**, per shipment, recorded either by us or by the customer
  confirming receipt — `deliveredSource` keeps those apart, because they are different
  claims and a dispute turns on which was made.
- **Returns and replacements.** A returned unit retires its ClockTag (the half that
  matters — a dead chip left active is a tag nobody can account for) and a replacement
  is appended to the same order, linked in both directions, starting from `pending` with
  a fresh key.
- **Status is derived**, in `lib/tagOrderStatus.js`, never set by hand. The old flag was
  written by the ship action, which is exactly how an order could read "shipped" with
  half its units on the bench: it recorded that somebody pressed a button.

**Stock** (added after E3). `TagStockMovement` is a ledger of every blank on or off the
shelf; `TagProduct.stockOnHand` is a cache rebuilt by summing it, so a count that drifts
heals rather than staying wrong.

A blank is counted as gone **at key issue, not at write**. That looks early and is the
only correct point: fetching a key is an operator holding one physical chip. Counting at
write would miss every chip that failed; counting at both write and failure would count
a written-then-failed chip twice, because that is one blank, not two. A failed unit is
reissued a new key and fetched again, which takes another blank — which is what happens
on the bench.

**Stock refuses nothing.** A count saying zero while an operator holds a blank is the
count being wrong, not the blank being imaginary. Shortfalls warn, everywhere they
matter, and block nothing. The catalogue shows three numbers rather than one — on hand,
promised to open orders, and actually free — because twenty blanks with eighteen
promised is two available, and ordering against the twenty is how the next customer
waits a fortnight.

**Labels** print from the provisioning station, per shipment. What they are **not** is a
carrier's postage label: those carry a scannable barcode the carrier allocates through
their own account and API, and a parcel carrying an invented barcode gets stopped rather
than delivered. That integration needs credentials and is still outstanding. What prints
is the dispatch label that goes on the box beside the carrier's own — who it is for,
what is in it (with the UIDs, so a customer quoting a dead tag can be found on the
order), which order and shipment, and where to return it. Sender details live in
`PlatformSetting`, a one-document platform-level model, because every other settings
model in the codebase belongs to a customer.

**Carrier postage** (added after the labels above). `lib/carrierProviders.js` holds one
adapter per carrier behind a single contract: given a shipment, an address and a weight,
return a tracking number *and* a label, or throw. Never one without the other — a
tracking number with no label is postage nobody can print.

**Royal Mail Click & Drop** is implemented against
`https://api.parcel.royalmail.com/doc/v1/click-and-drop-api-v1.yaml`:
`POST /orders` with a Bearer key and `label.includeLabelInResponse`, which returns the
tracking number and a base64 PDF in one call.

**UPS** takes two: `POST {host}/security/v1/oauth/token` (Basic client id/secret,
form-encoded `grant_type=client_credentials`) then
`POST {host}/api/shipments/v2409/ship`, which returns the tracking number and a base64
GIF label together. Three UPS-specific traps, all of which would be quiet bugs:
`PackageResults` is an **object** for one package and an **array** for several, so
reading `[0]` of the single form yields undefined on a shipment already charged for;
weight is a **string** with an explicit unit; and `PaymentInformation` is required —
without it UPS refuses rather than billing the shipper by default.

UPS is also the only carrier here with a published **test host** (`wwwcie.ups.com`), so
it is the only one where the environment toggle does anything — and given that nothing
here has been run for real, it defaults to test, and a label bought there says on the
screen that it is not real postage.

**DHL Express** (MyDHL API) is `provisional` on the same split as Yodel. Verified
publicly: both base URLs — `https://express.api.dhl.com/mydhlapi` and
`.../mydhlapi/test` — and that authentication is HTTP Basic sent pre-emptively. Behind
DHL's login: the endpoint path (so `/shipments` is a default, not a fact) and every
field name. Two traps encoded up front: `plannedShippingDateAndTime` wants DHL's own
format (`2026-09-25T12:00:00 GMT+00:00`), not ISO 8601; and the label is picked out of
`documents` **by type**, because that array also carries invoices and customs papers —
`[0]` is only the label until a shipment needs an invoice too. DHL Express prices on
size as well as weight, so a standard box is declared on the account rather than
measured per shipment.

**Yodel** is `provisional`, and the split is worth stating:
verified from their public portal are the sandbox base `https://api-sb.yodel.co.uk`,
the path `/shipping/v1.0/orders`, and the create → confirm → download-label flow. Not
verified, because the reference sits behind portal registration and the product list
renders empty to anonymous visitors, are the auth scheme, the HTTP method per
operation, every field name, and the production host.

So the unknowns are **configured, not invented**: the API key header name and the
production base are fields on the account, and the request body is a starting point.
What makes that defensible where it was not for Evri is that Yodel publishes a working
sandbox and this adapter passes their error text through verbatim — a first sandbox call
names the field that is wrong, and the fix is one file. `provisional: true` puts that
caveat on the account screen rather than leaving it in a comment.

**DPD UK** takes three: `POST /user/?action=login` (Basic auth, returns
`data.geoSession`), `POST /shipping/shipment` with `GEOClient`/`GEOSession`, then
`GET /shipping/shipment/{id}/label/` with `Accept: application/pdf`. The session is
fetched per purchase rather than cached — an expired cached session fails the *second*
call, after the consignment exists, which is the worst place to fail. Two details that
differ from Royal Mail and are easy to get wrong: DPD weighs in **kilograms**, and its
`networkCode` (the service) is specific to the account's contract, so it is a stored
setting rather than a constant. If the label fetch fails, the consignment already exists
and is chargeable, so the message names it and sends somebody to MyDPD rather than
implying nothing happened.

> **No adapter here has been run against a live account.** They are written to published
> specifications, which is not the same as having watched one work. The account screen
> says so, accounts are off until tested, and a failed purchase leaves the shipment
> untouched — the operator buys on the carrier's site and types the number in, which is
> why `manual` is the default and stays supported rather than being a stepping stone.

Two things the API demanded that were on the "not built" list, and so had to stop being:

- **Weight**, per product, in grams. Zero means not measured, and a label cannot be
  bought — better than guessing a number that becomes a surcharge charged later, to us.
- **A structured address.** Collected from the customer in parts rather than parsed out
  of the free-text line, because deciding which typed line is the city is a guess and a
  wrong guess delivers the parcel somewhere else without anything looking broken.

Credentials are sealed with `lib/secretBox.js` (AES-256-GCM under `TAG_KEY_MASTER`, the
same key as tag keys — one trust boundary, one key to rotate, and rotating it means
re-entering carrier tokens as well as re-provisioning hardware). Only a four-character
hint ever reaches a screen.

A label is bought **at most once per shipment**, guarded on the stored label still being
absent so two operators cannot both buy.

**Cancelling** voids the postage at the carrier and then clears our copy — in that
order, and the order is the point: the carrier is asked first and nothing local changes
until they confirm. A cancel that fails leaves the label and the tracking number exactly
as they were, because the postage is still live and still chargeable, and clearing our
copy would only mean nobody can find it again to cancel it properly. On success both go,
since both are void, and the shipment stays so a replacement can be bought.

Every API provider can cancel: Royal Mail `DELETE /orders/{id}`, DPD
`DELETE /shipping/shipment/{id}`, UPS `DELETE /api/shipments/{v}/void/cancel/{tracking}`,
Yodel and DHL by delete on their own resource. Two of those report failure inside a 200
and are checked accordingly — Royal Mail returns `deletedOrders` and `errors` side by
side, and UPS puts the outcome in `SummaryResult.Status` rather than the status code.
Royal Mail's own warning is passed on to whoever pressed the button: a cancelled label
must be destroyed, cancellations are shared with their Revenue Protection team, and a
cancelled label found in their network is charged for with a handling fee.

**Discard** survives alongside it, for the different situation it answers: a label
already cancelled on the carrier's own site, or one from a carrier whose API cannot. It
still says plainly that it cancels nothing.

**Postcodes** are validated in two separate ways, because they answer two different
questions with different consequences.

**Shape blocks.** `lib/postcode.js` holds the government's published pattern — kept
verbatim, because every hand-tidied version of it rejects somebody's real address — and
a malformed UK postcode is refused both when the order is placed and again when postage
is bought. It is decided offline, so it cannot fail because a third party is down, and a
carrier would refuse it anyway. Postcodes are normalised on the way in (`sw1a1aa` →
`SW1A 1AA`), since carriers vary in how forgiving they are and one postcode stored three
ways cannot be compared.

**Existence only warns.** `server/addressServer/postcode.js` checks postcodes.io — ONS
open data, no key, no licence — which knows whether a postcode exists and which local
authority it is in. It does not know which addresses are at it; that is Royal Mail's PAF
and PAF is licensed.

Three reasons the second one must not block, all load-bearing:

- ONS data lags new building by months, so a real new-build postcode may be absent.
- The service being unreachable must never stop an order. `checked` and `known` are
  separate fields precisely so a timeout can never be reported as "that postcode does
  not exist".
- The lookup returns the *local authority*, so SW1A 1AA comes back as **Westminster**
  while anybody sensible types **London**. Town mismatches warn and nothing more.

Worth recording, because it is the clearest argument for keeping the two questions
apart: run against the live service, **DN55 1PT, W1A 0AX and PL1 1AA all pass the shape
check and all 404**. They are the examples the government's own validation documentation
uses, and they are not real postcodes.

**Still not built:**

- **Postcode lookup to a full address (PAF).** Knowing a postcode is real is not the
  same as knowing which houses are on it. That needs a licensed provider and a key.
- **Evri.** Deliberately not written, and this is the reason rather than a to-do: Evri
  publishes no developer portal, no API reference and no machine-readable specification.
  Credentials come from an account manager, the endpoint and OAuth shapes are not
  public, and the sandbox host older integrations used no longer resolves. An adapter
  built from guesswork would sit in the provider list looking like a working option and
  fail as though this code were buggy. Evri is `manual`, which is fully functional. To
  add it: get credentials and the sandbox pack from an Evri account manager, build
  against their OAuth flow, and put test labels through their approval before go-live —
  the contract is ready, the information is what is missing.
- **Payments and invoicing.** Deliberately outside the app — the order carries a total
  for reference and the invoice happens separately.

---

## 7. Traps

### 7.1 The `x-forwarded-for` trap (blocking for §4.1)

Before IP gates anything, add a single helper that returns the **hop Caddy appended**,
not the client's claim, and use only that for authorisation:

```js
// The LAST entry is the one our own proxy added. Everything to its left is
// whatever the client chose to send, and is not evidence of anything.
const hops = (h.get("x-forwarded-for") || "").split(",").map(s => s.trim());
const clientIp = hops.at(-1) || h.get("x-real-ip");
```

This must be verified against the live Caddy config before being trusted — if a CDN is
ever put in front, the trusted-hop index changes.

### 7.2 Never let a control stop work starting

Phone dead, no signal, GPS will not fix, tag prised off. Whatever is switched on, there
must always be a path that records the attendance and flags it. `needsReview` from
Phase 4 is that path; do not build a second one.

### 7.3 Other

- Dynamic IP → whole office locked out at 08:00. Alert + self-service update.
- iOS geolocation needs HTTPS and a user gesture, same as the notification fix.
- Sites with no mobile signal cannot reach the server at all — see §8, Phase E.

---

## 8. Order of work

**Phase 0 — ungate the roll-call (hours).**
Give the site-manager role the site attendance screen, behind the existing permission
system. Smallest possible change; makes today's fallback actually usable, and every
other method below needs it as the override path.

**Phase A — make locations real (no policy change).**
`ClockLocation` covering offices and sites alike (§3). Coordinates and networks on it,
`permittedLocationIds` on the employee (§3.2), `locationId` on clock records, unique
index moved off `siteId`. Backfill: one location per existing ProjectSite, and every
historical office record into a single default office — with §3.3 written down
somewhere the reports' readers will see it.

Ship this alone. It delivers per-office attendance, which is impossible today, and
nothing else here can be built on top of `siteId: null`.

**Phase B — record evidence, enforce nothing.**
Capture method, coordinates + accuracy, IP and device on every clock-in. Add a report
answering *"would this have been refused?"* per location, per method. Same shadow
pattern as `TENANT_ENFORCEMENT`, which this codebase already runs and trusts.

Run it for a few weeks. It lets geofence radii be chosen from real data instead of
guessed, and finds the sites where GPS is unreliable **before** anyone is locked out.

**Phase C — tags: registry, binding and reassignment (§5).**
`ClockTag`, the tap-to-enrol flow, the superAdmin assign/reassign/suspend/retire
screens, and the audited history. Start with **NTAG213 + geofence**: the tag identifies
the location and makes the action one tap, the geofence is the control.

Deliberately after Phase B, because the enrolment flow needs somewhere to record a tap
from an unknown tag, and the clone detection in §5.5 needs the coordinates Phase B is
already collecting.

Note the chip decision lands here, not in Phase E: what §6 sells is whatever §5
verifies. Shipping 424 DNA tags before the CMAC verification exists means shipping
hardware the server cannot check.

**Phase D — enforce, one location at a time.**
Flip `mode` per method per location.

- Office 1 → `deviceQr` (keep what works and is already paid for)
- Office 2 → `network`, with `geofence` as the fallback on mobile data
- Sites → `geofence` + `nfc`
- Everywhere → `rollCall` as the override

**Phase E — hardware ordering and provisioning (§6).**
Catalogue, ordering, the provisioning station, key generation and the verify-before-ship
step. Sits after Phase C because provisioning's whole output is `ClockTag` rows, and
there is nothing to create them in until the registry exists.

Worth splitting in two if it gets long: **E1** key generation + provisioning station,
which is what lets *us* programme tags for a customer at all; **E2** the customer-facing
catalogue and ordering screens. E1 has value on its own — it is how the first real
customer gets working tags, even if the order arrives by email.

**E3, when a real customer needs it:** delivery and order tracking (§6.9). Shipping is
currently a carrier name and a reference string. Everything past that — tracking links, a
delivered state, partial shipments, returns, stock — is deferred deliberately and listed
so it is a known piece of work rather than a surprise.

**Phase F — the remaining gaps.**
Offline capture for dead-signal sites (the service worker and manifest added in the
notification work are the foundation). The anomaly report over Phase B's evidence,
including the cloned/moved-tag signals from §5.5. NTAG 424 DNA support (§5.6) if a tag
is to become the control on sites where GPS cannot be relied on.

## 9. What this costs per location

| | Device QR | IP | Geofence | NFC (plain) | NFC (424 DNA) |
|---|---|---|---|---|---|
| Hardware | £100+ tablet | £0 | £0 | ~£1 | ~£3 |
| Power at location | yes | no | no | **no** | **no** |
| Network at location | yes | yes | no | **no** | **no** |
| Person present | yes | no | no | no | no |

The bottom two rows are the answer to the original question. A tag or a geofence is the
only thing in this table that a two-person site can actually sustain.

---

## 10. After the migration: four problems found by looking at the screens

Raised after the locations screen went live. The first one is not a clock problem at
all — the locations list is telling the truth and the **Site Projects screen is lying**.

### 10.1 Six sites are missing from Site Projects, not extra in Locations

`server/siteProjectServer/siteProjectServer.js:23`:

```js
const query = { siteDelete: false };
```

`siteDelete` was added to the schema later, with `default: false`. A default only
applies to documents **written after it exists** — the six sites created before it have
no such field, and `{ siteDelete: false }` does not match a missing field. The same
filter is in `server/selectServer/selectServer.js:90`, which feeds every site dropdown.

Measured on production, one tenant:

| | Count |
|---|---|
| Sites that exist | 10 |
| Visible on the Site Projects screen | **4** |
| Active sites | 7 |
| Selectable in any site dropdown | **2** |

So five of seven active sites cannot be picked for a rota, an assignment or an expense,
and have not been pickable since `siteDelete` was introduced. This is a pre-existing
bug with nothing to do with clocking; the locations backfill simply made it visible by
listing all ten.

**Fix**

1. `{ siteDelete: { $ne: true } }` in both queries — matches missing, false and null,
   and excludes only a genuine deletion. Use `$ne: true` rather than backfilling alone,
   so the next field added with a default does not repeat this.
2. A one-time script to stamp `siteDelete: false` on the six, so the data matches the
   schema.
3. While in there: the aggregation does `$skip` → `$limit` → `$sort`, so it sorts
   *within the page it already cut*. Page 2 is not the second page of a sorted list.
   `$sort` must come first.

### 10.2 Two sites with the same name

Both `Park Road New` rows are real, undeleted sites — one Active, one On Hold. Only one
was visible on the Site Projects screen, because of §10.1, which is why the pair looked
like a locations bug.

Uniqueness belongs **at the source, not at the mirror**. A location's name is a copy of
the site's; refusing the copy while allowing the original leaves the two permanently
disagreeing, which is what the migration hit. So:

1. Refuse a duplicate **when a site is created or renamed** in Site Projects, checked
   against other sites *and* offices in that company. That is where a person types a
   name and where the message can be acted on.
2. Keep the site sync forgiving. A site must never fail to save because of its clock
   location, so `syncLocationForSite` keeps auto-disambiguating.
3. Surface existing clashes on the Locations screen rather than silently living with
   them — a short "2 locations share a name" warning with a link to rename.

**Order matters.** §10.1 first: right now they cannot see one of the two Park Road News
to rename it. Enforcing uniqueness before that would refuse edits to a site whose
duplicate is invisible.

### 10.3 There is no way to set the default office

`isDefault` is shown as a star and blocks archiving, but nothing anywhere sets it. It
gets its value from `ensureDefaultLocation()`, which adopts a lone existing office —
which is why **London Office** is marked default: it was the only office at migration
time, so it was adopted rather than a second "Head Office" being invented (§3.4).

What the flag actually means, and what the screen never says: *this is where a clock-in
that names no location is recorded* — an office scan before locations existed, and the
fallback if a scan arrives with no site.

**Fix**: a `setDefaultLocation` action (super admin, offices only — a site cannot be the
fallback for records that have no site), a "Make default" row action, and one line of
explanation on the card. The unique partial index already prevents two.

### 10.4 A QR scan cannot say which office it happened at

The reception desk at `/hr` mints codes through `OfficeQRCode`. With no `siteId` it
shows a picker — "Which office is this screen in?" — and remembers the answer in
`localStorage`.

That is too weak to attribute attendance:

- It is **per browser**, so it is lost on a cache clear, a new device or a private tab.
- It is **chosen by whoever is standing there**, not by an administrator.
- A wrong choice **fails silently** — attendance lands at the other office and nothing
  looks broken.

The token itself is already fine: `ClockToken` carries an authoritative `locationId`
(§3), so only the *choosing* is weak.

Two ways to fix it, and they are not equivalent:

**A — bind the location to the reception account.** A desk is a fixed thing; so is the
account that stands at it. Add `clockLocationId` to the reception user, set by the super
admin on the existing reception form. `/hr/code` reads it and shows no picker.
*Cheapest, and an administrator makes the decision.*

Complication found while checking: `getReceptionUsers` filters on `{ delete: false }`
only, so the "Reception Users" screen currently lists **every** office employee, and
there is no field marking an account as reception at all. Option A therefore needs that
concept to exist first — small, but not zero.

**B — bind the location to the registered device.** `models/officeModel.js` already has
`authorizedDevices[{ deviceId, deviceName }]` and `enforceDeviceLock`, and
`/admin/reception` already manages them. Add `locationId` to each device entry: the
screen in Office 2 is enrolled once and identifies itself thereafter, regardless of who
signs in. *Survives shared accounts and one account running several desks, and reuses
machinery that already exists.*

**Recommendation: B**, with A's account field as the fallback when a device is not
enrolled. B matches the physical reality — the *screen* is in an office, the person is
not — and it is the same enrolment story NFC tags already use (§5), so there is one
mental model rather than two.

Either way the picker stays as a last resort for a company with one office, where there
is nothing to get wrong.

### 10.5 Suggested order

1. §10.1 — the site list. Largest blast radius, unblocks the rest, unrelated to clocking.
2. §10.3 — default office. Self-contained, small.
3. §10.2 — name uniqueness. Needs §10.1 done so both duplicates are visible.
4. §10.4 — QR office binding. Largest, and the only one needing a decision first.

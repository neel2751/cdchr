# Multi-Tenancy & White-Labelling — Assessment and Plan

**Status:** Research / proposal only. No code has been changed.
**Date:** 2026-08-25
**Scope:** Turn the current single-company HR app into a multi-tenant SaaS where each
company gets isolated data, its own branding (logo, colours, app name), its own
domain (`acme.com` / `hr.acme.com`), and its own email sending — managed from a
platform-level dashboard.

---

## 1. Where the codebase stands today

### 1.1 The short version

The app is **single-tenant by construction**. There is a `Companie` collection, but it
is a *label*, not a boundary — it exists on one model only and is never used to
restrict what anyone can see.

| Dimension | Today |
|---|---|
| Models | 48 (`models/`) |
| Server-action files | 66 (`server/`), 59 marked `"use server"`, ~25.4k LOC |
| DB query call sites | ~515 (`find`/`findOne`/`aggregate`/`updateOne`/…) |
| Collections carrying a company reference | **1** (`officeEmployeeModel.company`) |
| Collections that are tenant-scoped in queries | **0** |
| DB connections | 1 shared Mongoose connection (`db/db.js`) to 1 database |
| Domain handling | One hardcoded host special-case in `proxy.js` |
| Branding | Hardcoded logo paths, app name, and email HTML |
| Email | Global `EMAIL_*` env vars + a per-*feature* SMTP table (no tenant dimension) |

### 1.2 The company model is a stub

`models/companyModel.js` — the entire schema:

```js
{ name, description, isActive, delete }
```

It is referenced from exactly one place, and it is **optional there**:

`models/officeEmployeeModel.js:28-32`
```js
company: {
  type: mongoose.Types.ObjectId,
  ref: "Companie",
  required: false, // make it after true
},
```

Usage of that field across the whole codebase is:

- `server/officeServer/officeServer.js` — a `$lookup` to show the company name in the
  employee table, and an **optional** filter (`filterData.filter.company`) the admin can
  choose. If the filter isn't set, all employees from all companies are returned.
- `server/officeServer/officeEmployeeDetails.js` — same `$lookup`, display only.
- `server/visaServer/visaReminderJob.js` — resolves a company name to put in an email.
- `server/selectServer/selectServer.js` — populates the company dropdown.

So the "company" concept today is a **reporting dimension on office employees**, nothing
more. Every other collection — weekly rota, leave requests, attendance, clock-ins,
documents, expenses, devices, visitors, QR codes, sessions, audit logs, role
permissions, departments (`RoleType`), leave settings, holidays, site projects — has **no
company field at all**.

There are three dead `// companyId` comments in `models/leaveSettingModel.js:4-7`,
`models/payrollLockModel.js:5-7` and `server/leaveSettingServer.js:114` — a previous
intention that was never carried through. `models/document/documentModel.js:33` and
`models/expense/expenseModel.js:65` do have a `tenantId`, but it is used as a
*business* attribute (which company an expense belongs to), not enforced as a boundary.

### 1.3 Authentication is global, not per-tenant

`server/authServer/authServer.js:200-322` — `LoginData(email, password, deviceId)`:

```js
let user = await OfficeEmployeeModel.findOne({ email, delete: { $ne: true } }).lean();
if (!user) user = await EmployeModel.findOne({ email, ... });     // site staff
if (!user) user = await OfficeUserModel.findOne({ email, ... });  // reception
```

A single global email lookup across three collections. There is no notion of "which
company is this person logging into". The JWT (`app/api/auth/[...nextauth]/option.js:124-145`)
carries `id`, `name`, `email`, `role`, `deviceId`, and 2FA flags — **no tenant**.

Roles are derived from booleans on the employee record: `isSuperAdmin` → `superAdmin`,
`isAdmin` → `admin`, else `user`; site staff → `siteEmployee`; reception → `reception`.
Note that `superAdmin` is currently a **company-level** role that bypasses all permission
checks (`proxy.js:123-144`) — it is not a platform/provider role. Multi-tenancy needs a
new role above it.

### 1.4 Routing already has a proof-of-concept for domain awareness

Middleware lives in **`proxy.js`** (Next.js 16 renamed `middleware.js` → `proxy.js`).
It already special-cases one hostname:

`proxy.js:13-24`
```js
const hostname = req?.headers?.get("host") || "";
const customBrandDomain = "form.cdcproperty.management";
if (hostname === customBrandDomain) {
  if (requestedPath.startsWith("/visitor")) return NextResponse.next();
  return NextResponse.redirect(new URL("/unauthorized", req.url));
}
```

This is exactly the shape of the mechanism we need — it just needs to become
data-driven instead of a hardcoded string.

Two things to note about the current middleware:

- The matcher is `["/admin/:path*", "/employee/:path*", "/hr/:path*"]` — `/auth`, `/api`,
  `/visitor`, `/verify` and the root are **not** covered. Tenant resolution needs to happen
  earlier and wider than the current matcher.
- It performs **`fetch()` calls back into the app** from middleware
  (`/api/account/status`, `/api/reception/verify-device`, `/api/role`). Two of those use
  `process.env.NEXTAUTH_URL || http://${host}`, but `/api/role` uses
  `process.env.NEXTAUTH_URL` **unconditionally** (`proxy.js:154`). Under multiple domains
  that becomes a cross-domain call to the wrong origin. This pattern is useful though —
  it proves the middleware can reach the database indirectly, which is how tenant
  resolution will work.

### 1.5 Branding is hardcoded in at least five places

| Where | What |
|---|---|
| `components/sidebar/sideBarCom.jsx:59, 213, 243` | `"/images/Interiorlogo.svg"` |
| `components/sidebar/sideBarCom.jsx:68` | `"Hr Management"` label |
| `app/layout.js` | `metadata: { title: "HR Management", description: "Hr Management System" }` |
| `server/email/email.js:22, 49, 76` | `from: "Interior Studio Ltd HR"` |
| `server/email/email.js:247-262` | Cloudinary logo URL, "Creative Design & Construction", `support@cdc.construction`, and a **`http://localhost:3000/` action link** |

The good news: the app uses **Tailwind v4 with CSS custom properties**
(`app/globals.css` — `:root { --primary, --background, --sidebar, --chart-1..5, --radius }`).
Per-tenant theming is a matter of overriding those variables server-side; no component
rewrite is needed.

Constraint to be aware of: `next.config.mjs` pins a **static CSP** with
`img-src 'self' data: blob: https://*.amazonaws.com https://cdc.construction https://res.cloudinary.com`
and a static `images.remotePatterns` allowlist. If every tenant uploads a logo to a
different host, both lists break. (Solution in §4.4: serve all tenant assets from our own
S3 bucket / our own domain.)

### 1.6 Email: one good foundation, one legacy path

**Legacy path** — `server/email/email.js`: builds a Nodemailer transport straight from
`process.env.EMAIL_HOST / EMAIL_USERNAME / EMAIL_PASSWORD`, with the from-name hardcoded.
Used by login-notification and rota-reminder emails.

**Modern path** — `models/emailAccountmodel.js` + `server/email/emailSMTP.js`: a real
SMTP account table with `host`, `port`, `secure`, `userName`, **AES-encrypted `password`**
(via `lib/algo.js` `pre('save')` hook), `fromName`, `feature`, `isPrimary`, `isActive`,
`isDeleted`, plus test-connection helpers and `getSMTPForFeature(feature)` with a
primary→any-active fallback.

**This second system is 80% of a per-tenant email setup already.** It needs a `tenantId`
and a changed unique index — see the landmine in §1.8.

### 1.7 Real-time (Socket.IO) has no auth and broadcasts globally

`server.mjs` runs a custom Node HTTP server with Socket.IO. Two problems that are latent
today and become serious the moment there is a second tenant:

- **No handshake authentication.** Any client that can reach the origin can connect and
  emit `generate-office-qr`, `admin-clock-update`, `stop-qr`, etc. Nothing checks who they
  are.
- **Global broadcasts.** `io.emit("refresh-clock-table", employeeId)`,
  `io.emit("office-qr-used", token)`, `io.emit("office-qr-expired", token)` go to *every*
  connected socket. With multiple tenants, Acme's office screen receives Beta's clock and
  QR events, including employee IDs.

QR tokens are signed with the single global `NEXTAUTH_SECRET` and carry `{ action, siteId }`
or `{ employeeId }` — no tenant claim, so a token minted in one tenant would validate in
another.

### 1.8 Two unique indexes that will actively break tenant #2

These are the concrete, immediate blockers — worth flagging separately because they
won't fail at design time, they'll fail in production on the day a second company is
onboarded.

**a) `models/emailAccountmodel.js`**
```js
emailAccountSchema.index(
  { feature: 1, isPrimary: 1 },
  { unique: true, partialFilterExpression: { isPrimary: true } }
);
```
Only **one** primary SMTP account per feature can exist **across the entire platform**.
Acme sets a primary "HR" sender; Beta cannot. Must become `{ tenantId, feature, isPrimary }`.

**b) `models/officeModel.js`** (reception users)
```js
email: { type: String, required: true, unique: true }
```
Globally unique reception email. Two companies both using `reception@…` — or the same
managed-services provider running reception for both — collide. Must become a compound
unique index with `tenantId`.

### 1.9 Other findings that affect the design

- **`db/db.js`** holds a module-level `isConnected` flag and a single connection. Fine for
  a shared-database design; it would need rewriting for database-per-tenant.
- **`lib/algo.js` uses `NEXT_PUBLIC_ALGO_KEY`**, which `next.config.mjs` inlines into the
  browser bundle. Encrypted record IDs in URLs are therefore **obfuscation, not
  authorisation** — already documented in `.env.example`. Multi-tenancy makes this matter
  more: every server action must independently verify tenant ownership; a "you can't guess
  the ID" argument does not hold.
- **`/api/role` and `/api/account/status` are unauthenticated POST endpoints** that accept
  an arbitrary `employeeId` and return that person's permissions / account status. Today
  that's an information leak; multi-tenant it becomes cross-tenant enumeration. They need
  locking down (shared secret, or moved out of HTTP entirely) as part of this work.
- **`withTransaction`** (`lib/mongodb.js:28-42`) swallows errors and returns
  `{ success: false, message }` instead of rethrowing. Tenant guards that throw inside a
  transaction will be converted into soft failures — needs care.
- **`withAudit` / `recordAudit`** (`lib/audit.js`) is a clean single choke point using
  **`AsyncLocalStorage`**. Adding `tenantId` to audit logs is a one-file change — and
  more importantly, **this file is the proven in-repo pattern for the tenant-context
  mechanism proposed in §3.2**.
- **`getSuperAdmins()`** is used to pick email recipients for rota reminders
  (`server/email/email.js:106`). Unscoped, it would email every tenant's super admins.
- **Visa reminder cron** (`server.mjs:267-304` → `server/visaServer/visaReminderJob.js`)
  iterates globally and sends via the global SMTP config. It needs to run per tenant with
  that tenant's sender and branding.
- **S3 keys are `${employeeId}/${filename}`** (`server/aws/upload.js`) — no tenant prefix,
  one shared bucket.

---

## 2. Choosing the isolation model

Three realistic options:

### Option A — Shared database, shared collections, `tenantId` on every document
**Recommended.**

- One connection, one database, one set of collections. Every document gets `tenantId`.
  Every query is filtered by it.
- **Pros:** No change to deployment or connection handling. Cross-tenant reporting for the
  platform dashboard is trivial. One migration per schema change. Cheapest to run.
- **Cons:** Isolation is enforced by *code discipline*. One missed `$match` is a data leak.
  With ~515 query sites, "just remember to add it" is not a strategy — this is why §3.2
  proposes automated enforcement rather than manual edits.

### Option B — Shared cluster, one database per tenant (`connection.useDb()`)
- **Pros:** Strong isolation; a missed filter cannot leak across tenants. Easy per-tenant
  backup/restore/export and deletion.
- **Cons:** Every model in `models/` is a **module-level singleton**
  (`mongoose.models.X || mongoose.model("X", schema)`). Making them per-connection means
  touching all 48 models *and* every one of the ~515 call sites to obtain the model from a
  request-scoped connection — i.e. **more** refactoring than Option A, not less. Schema
  migrations run N times. Connection-pool pressure grows with tenant count. Platform-wide
  reporting requires fan-out queries.

### Option C — Separate deployment per tenant
- **Pros:** Zero application change; perfect isolation.
- **Cons:** N deployments, N sets of env vars, N upgrade windows, N SSL certs, no platform
  dashboard without building one anyway. Doesn't scale past a handful of customers.

### Recommendation

**Option A**, with three hard requirements that make its main weakness manageable:

1. Tenant filtering is applied **automatically by a Mongoose plugin**, not by hand at 515
   call sites.
2. The tenant identity is taken from the **session**, never from a client-supplied value,
   and cross-checked against the request host.
3. There is a **shadow-mode rollout** (log unscoped queries in production without
   enforcing) before the guard is switched to fail-closed.

If a future customer contractually requires physical data separation, Option B can be
layered on later for that customer only — a `Tenant.databaseName` field and a connection
factory — without changing the application logic, because by then everything already goes
through a tenant-context layer.

---

## 3. Target architecture

### 3.1 The Tenant model

Replace the `Companie` stub with a proper tenant record (keeping the collection name so
existing `company` references stay valid):

```js
{
  name, slug,                    // "Acme Ltd", "acme"  — slug drives *.ourapp.com
  status,                        // active | suspended | trial | cancelled
  domains: [{
    host,                        // "hr.acme.com"
    isPrimary,                   // one per tenant
    verified, verificationToken, verifiedAt,
    sslStatus,                   // pending | issued | failed
  }],
  branding: {
    appName, logoUrl, logoDarkUrl, faviconUrl,
    primaryColor, accentColor, radius,
    loginBackgroundUrl, supportEmail, emailFromName, emailFooterHtml,
  },
  features: { crm, expenses, visitors, siteProjects, ai, ... },  // plan gating
  limits:   { maxEmployees, maxStorageBytes, ... },
  locale:   { timezone, dateFormat, currency, weekStartsOn, country },
  billing:  { plan, seats, renewsAt },
  createdBy, createdAt, updatedAt
}
```

`domains` as an array (not a single string) matters: tenants will want
`acme.com` + `www.acme.com` + `hr.acme.com` all pointing at their instance, and a
`acme.ourapp.com` fallback that always works while DNS propagates.

### 3.2 Tenant context — the core mechanism

This is the single most important design decision. **Do not hand-edit 515 query sites.**

Two cooperating pieces:

**(a) Request-scoped tenant context via `AsyncLocalStorage`** — the same pattern already
proven in `lib/audit.js`:

```js
// lib/tenant.js  (sketch)
const tenantContext = new AsyncLocalStorage();

export function getTenantId() {
  const store = tenantContext.getStore();
  if (!store?.tenantId) throw new TenantContextError("No tenant in context");
  return store.tenantId;
}

export function withTenant(handler) {          // wraps a server action
  return async (...args) => {
    const session = await getServerSession(options);
    const tenantId = session?.user?.tenantId;      // authoritative: from the JWT
    return tenantContext.run({ tenantId, role: session?.user?.role }, () => handler(...args));
  };
}
```

**(b) A Mongoose plugin applied to every schema** that adds the field, the index, and the
automatic filter:

```js
// lib/tenantPlugin.js  (sketch)
export function tenantPlugin(schema) {
  schema.add({ tenantId: { type: ObjectId, ref: "Companie", index: true } });

  // Reads & writes
  schema.pre(/^find|^count|^update|^delete|^replace/, function () {
    if (this.getOptions?.().skipTenant) return;
    this.where({ tenantId: getTenantId() });
  });

  // Inserts
  schema.pre("save", function () {
    if (!this.tenantId) this.tenantId = getTenantId();
  });

  // Aggregations — see the caveat below
  schema.pre("aggregate", function () {
    if (this.options?.skipTenant) return;
    this.pipeline().unshift({ $match: { tenantId: getTenantId() } });
  });
}
```

**Aggregation caveat — this is where leaks will hide.** The codebase uses `aggregate()`
with `$lookup` heavily (`officeServer.js`, `deviceServer.js`, `selectServer.js`, …). The
`pre("aggregate")` hook only scopes the *root* collection. A `$lookup` into
`roletypes` / `companies` / `officeemployes` runs **unfiltered** unless the lookup's own
`pipeline` includes a tenant `$match`. Every existing `$lookup` must be reviewed and
converted from the `localField`/`foreignField` form to the `pipeline` form with a tenant
match, e.g.:

```js
{ $lookup: {
    from: "roletypes",
    let: { dep: "$department" },
    pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$dep"] }, tenantId } }],
    as: "departments",
} }
```

An `escapeTenant()` helper (explicit `skipTenant: true`) is needed for the handful of
legitimate cross-tenant reads: the platform dashboard, the login lookup, the domain
resolver, and the cron job's tenant iteration. Make it **loud** — a named export that
greps easily, so an audit can confirm every use is intentional.

### 3.3 Tenant resolution from the request

Resolution order for an incoming request:

1. **Custom domain** exact match on `Host` → `Tenant.domains.host` (verified only)
2. **Subdomain** of the platform apex → `Tenant.slug` (`acme.ourapp.com`)
3. **Platform apex itself** (`app.ourapp.com`) → platform dashboard / tenant chooser
4. No match → generic "unknown workspace" page (never leak that a tenant exists)

Where this runs: `proxy.js`. It cannot import Mongoose directly on the Edge runtime, so
either run the proxy on the Node runtime, or — matching the pattern already in the file —
call an internal `/api/tenant/resolve?host=…` route backed by an **in-process TTL cache**
(domain→tenant changes are rare; a 60s cache makes this ~free).

**Security rules that are not optional:**

- The proxy must **delete any inbound `x-tenant-id` header** before setting its own.
  Otherwise a client sets the header and reads another tenant's data.
- The host-derived tenant is used for **branding and routing**. The **session-derived**
  tenant (from the JWT) is used for **data queries**. If they disagree, sign the user out
  and redirect to the correct tenant's login. Branding can trust the host; data never can.

### 3.4 Authentication changes

- **JWT gains `tenantId` and `companySlug`** (`option.js` `jwt`/`session` callbacks).
- **`LoginData` becomes tenant-scoped**: `findOne({ email, companyId, delete: { $ne: true } })`.
  Email uniqueness moves from global to per-tenant — one person can legitimately exist in
  two workspaces, which is a feature, not a bug.
- **Cookie isolation.** Separate custom domains get separate cookies automatically — good.
  For the `*.ourapp.com` subdomain fallback, **do not** set a `.ourapp.com` cookie domain,
  or a session minted at `acme.ourapp.com` will be sent to `beta.ourapp.com`.
- **`NEXTAUTH_URL` is a single static value** and NextAuth v4 uses it to build callback
  URLs. With N domains this is wrong for N−1 of them. This is a genuine decision point:
  either upgrade to Auth.js v5 (`trustHost: true`, host-derived URLs), or add a shim that
  derives the origin from `x-forwarded-host` per request. **Resolve this before Phase 5** —
  it gates custom domains entirely.
- **A new `platformAdmin` role** for the provider, stored in a separate `PlatformUser`
  collection, allowed only on the platform apex domain. Do not overload the existing
  `superAdmin`, which is (and should remain) a tenant-level role.
- Middleware gains a cross-tenant guard before any of the existing role checks.

### 3.5 The platform dashboard

New route segment `/platform`, served **only** on the platform apex host:

- Tenant list, create, suspend, delete (with data export)
- Per-tenant: branding editor, domain management + verification status, SMTP setup,
  feature/plan toggles, seat counts, storage usage
- Platform-wide audit log (`AuditLog` gains `tenantId`, plus platform-actor entries)
- "Impersonate / support login" — time-boxed, always audited, visibly banner-flagged

---

## 4. White-labelling

### 4.1 Theme

Tailwind v4 already drives everything from CSS variables in `app/globals.css`. Per-tenant
theming = a server-rendered `<style>` block in the root layout that overrides `:root`:

```jsx
// app/layout.js (sketch) — resolved server-side, so no flash of default branding
const tenant = await getTenantFromHost();
<style>{`:root{--primary:${tenant.branding.primaryColor};--radius:${tenant.branding.radius}}`}</style>
```

Rendering server-side avoids FOUC entirely. No component changes required beyond removing
the hardcoded values in §1.5.

### 4.2 Logo, favicon, app name

- Replace the three hardcoded `"/images/Interiorlogo.svg"` in `components/sidebar/sideBarCom.jsx`
  and the sidebar label with values from a `TenantBrandingProvider` (a React context
  hydrated from the server layout — the repo already has `context/` providers for this
  shape of thing).
- `app/layout.js` static `metadata` becomes `generateMetadata()` reading the host.
- Favicon and app icon served per tenant.

### 4.3 Emails

- Move the inline HTML in `server/email/email.js` into a template layer that takes a
  branding object: `{ appName, logoUrl, primaryColor, supportEmail, appUrl }`.
- Fix `from: "Interior Studio Ltd HR"` → `tenant.branding.emailFromName`.
- Fix the `http://localhost:3000/` action link → the tenant's **primary verified domain**.
- Fix the hardcoded `support@cdc.construction` and the Cloudinary logo URL.

### 4.4 Asset storage — and why it matters for CSP

Store tenant assets under `tenants/{tenantId}/branding/…` in **our own S3 bucket**, served
through our own domain or CloudFront. Do **not** let tenants supply arbitrary external
logo URLs: `next.config.mjs` has a static CSP `img-src` allowlist and a static
`images.remotePatterns`, and neither can be extended per request. Keeping assets on our
own origin keeps both lists fixed.

While there: S3 keys should gain a tenant prefix (`tenants/{tenantId}/{employeeId}/…`) so
that per-tenant export and deletion are a prefix operation.

---

## 5. Custom domains — the operational piece

Application routing is the easy half. The hard half is DNS + TLS for domains you don't
own. Three viable approaches for a self-hosted Node server (`server.mjs`):

| Approach | How | Trade-off |
|---|---|---|
| **Cloudflare for SaaS** | Tenant CNAMEs to us; Cloudflare issues and renews certs per hostname via API | Cleanest; per-hostname cost; vendor dependency |
| **Caddy with on-demand TLS** in front of `server.mjs` | Caddy asks an internal `/api/tenant/domain-allowed?host=` endpoint, then gets a Let's Encrypt cert on first request | Fully self-hosted, no per-domain cost; you own renewal and rate-limit handling |
| **Vercel Domains API** | If deployment moves to Vercel | Would require replacing the custom `server.mjs`, which hosts Socket.IO — significant change |

**Recommendation: Caddy on-demand TLS**, since the app already runs its own Node server and
that choice preserves it. The `domain-allowed` endpoint is a one-line lookup against
`Tenant.domains` — and it is mandatory, otherwise anyone pointing a DNS record at your IP
makes you request a cert for it.

Verification flow: tenant adds `hr.acme.com` → we show a `TXT _verify.hr.acme.com=<token>`
record → background job checks DNS → mark `verified` → only then does the domain resolve to
the tenant and become eligible for a certificate.

Also needs updating: `SOCKET_CORS_ORIGINS` in `server.mjs` is a static env list. It must
become a dynamic check against verified tenant domains, or Socket.IO breaks on every custom
domain.

---

## 6. Per-tenant email

The `EmailAccountModel` design is already close. Changes:

1. Add `tenantId` to `models/emailAccountmodel.js`.
2. **Change the unique index** from `{ feature, isPrimary }` to
   `{ companyId, feature, isPrimary }` (see §1.8a — this blocks tenant #2 otherwise).
3. `getSMTPForFeature(feature)` → `getSMTPForFeature(feature, companyId)`, with a fallback
   chain: tenant primary → tenant any-active → **platform default sender**. A tenant that
   hasn't configured SMTP must still receive password resets.
4. Retire the legacy `server/email/email.js` transport in favour of the SMTP-account path,
   so there is one sending code path to make tenant-aware rather than two.
5. Per-tenant cron: `runVisaReminderJob()` iterates tenants, and for each uses that
   tenant's recipients, sender and branding. Same for the rota reminder — `getSuperAdmins()`
   must be tenant-scoped.

**Deliverability recommendation:** default to sending from *our* domain with the tenant's
display name (`"Acme HR" <noreply@ourapp.com>`) — zero setup, good deliverability. Offer
BYO SMTP or a verified sending domain (SPF/DKIM/DMARC) as an upgrade for tenants who want
mail to come from `@acme.com`. Sending as `@acme.com` without DKIM alignment will land in
spam and will be blamed on us.

---

## 7. Phased delivery plan

Each phase is independently shippable and leaves the app working.

### Phase 0 — Decisions and foundations *(no behaviour change)*
- Confirm Option A (shared DB + `tenantId`).
- Decide the platform apex domain and subdomain scheme.
- Resolve the **`NEXTAUTH_URL` / NextAuth v4 vs Auth.js v5** question (§3.4) — it gates Phase 5.
- Decide the custom-domain TLS approach (§5).
- Write down the "escape hatch" list: which queries are legitimately cross-tenant.

### Phase 1 — Tenant model + resolution + platform shell ✅ *implemented*
- Expand `companyModel.js` into the full tenant schema (§3.1), backwards compatible.
- Build host→tenant resolution with TTL cache; wire into `proxy.js` alongside the existing
  `form.cdcproperty.management` case; strip inbound `x-tenant-id`.
- Create the existing business as **tenant #1**; everything continues to work.
- `/platform` route with a read-only tenant list, gated to the apex host + `platformAdmin`.

Delivered on `feat/multi-tenancy-phase-1`:

| File | Purpose |
|---|---|
| `models/companyModel.js` | Full tenant schema — slug, status, domains, branding, features, limits, locale, billing. All optional; partial/sparse unique indexes so they apply safely to a live collection |
| `models/platformUserModel.js` | Provider-side admins, separate from `OfficeEmploye` |
| `lib/tenantHost.js` | Dependency-free hostname parsing (Edge-safe, importable from `proxy.js`) |
| `lib/tenant.js` | Tenant document helpers — `isTenantUsable`, `primaryDomain`, `resolveBranding`, `toTenantSummary` |
| `server/tenantServer/tenantServer.js` | Host→tenant resolution with TTL cache; tenant list / detail / stats reads |
| `app/api/tenant/resolve/route.js` | Node-runtime lookup the Edge proxy calls |
| `proxy.js` | Tenant resolution, header stripping, `/platform` gating, request-origin fetches |
| `app/platform/**` | Provider console: stats + read-only tenant list |
| `scripts/seed-tenant.mjs` | Idempotent provisioning for tenant #1 and the first platform admin |
| `lib/roleHome.js` | Single source for per-role landing paths |

Two decisions made during implementation, both deviating slightly from the sketch above:

1. **`x-tenant-*` headers are a hint, never an authority.** Server code calls
   `getRequestTenant()`, which re-derives the tenant from the `Host` header. The proxy
   still strips inbound tenant headers, so both layers have to fail before anything is
   spoofable.
2. **Resolution is bounded and fails open.** A 2s database race and a 2.5s fetch timeout,
   with short-lived negative caching. Verified with the database fully unreachable: the
   resolve endpoint answers in ~2s with `{"type":"unknown"}` and every existing route is
   completely unaffected. Before the bounds were added, an outage cost 10s per lookup.

### Phase 2 — Tenant context + backfill *(shadow mode)* ✅ *implemented*
- Build the tenant context (AsyncLocalStorage) and `lib/tenantPlugin.js` (§3.2).
- Apply the plugin to all tenant-scoped schemas; add `tenantId` + compound indexes.
- Migration script backfilling `tenantId` on every collection.
- **Shadow mode:** the plugin *logs* every query that runs without tenant context instead
  of throwing. Run in production until the log is silent.

Delivered:

| File | Purpose |
|---|---|
| `lib/tenantContext.js` | AsyncLocalStorage scope + per-request session fallback |
| `lib/tenantPlugin.js` | Adds `tenantId`, filters reads/writes/aggregates, flags unscoped `$lookup` |
| `scripts/backfill-tenant.mjs` | Idempotent backfill with per-employee attribution |
| `scripts/seed-dev-fixtures.mjs` | Two-tenant fixtures (refuses any non-local database) |
| `scripts/test-tenant-scope.mjs` | 9 cross-tenant isolation tests (`npm run tenant:test`) |
| `scripts/lib/alias-loader.mjs` | Resolves `@/…` so models can be tested outside Next |

Applied to **42 models**; 7 are deliberately global (`GLOBAL_MODELS` in the plugin):
the tenant itself, platform users, and the five auth-time collections consulted before a
tenant is known.

**The context problem, solved without touching 515 call sites.** The original sketch
wrapped every server action in `withTenant`, which meant editing 59 files. Instead
`currentTenantId()` falls back to the session of the request in flight, memoised per
request with React's `cache()`. Existing queries get a tenant with no edit at all;
`runWithTenant()` remains for crons, scripts and the platform console, which have no
session.

**A trap worth recording.** `runWithTenant(id, () => Model.find())` silently lost the
context: a Mongoose Query is lazy, so the callback returns before anything executes and
the `await` — with every hook — lands outside the scope. All nine tests failed with "no
tenant in context" despite being correctly wrapped. Both `runWithTenant` and
`escapeTenant` now await inside the scope so a lazy Query cannot escape it.

**`$lookup` detection works.** Run against the real pipeline in
`server/officeServer/officeServer.js`, shadow mode reports both lookups (`companies`,
`roletypes`) as unscoped and says to convert them to pipeline form — and goes silent once
converted. The §9 "highest-risk surface" is now a mechanically-produced checklist rather
than a manual audit.

**The tenant field is `tenantId`, not `companyId`.** `expenses`,
`expensecategories` and `documents` already had a `companyId` of their own — a
business attribute the user picks on the form. Reusing that name would have
fused two meanings: a user choosing a different company on an expense could
later hide the row from their own tenant. `expense.companyId` keeps its meaning;
`expense.tenantId` is the boundary.

**Escape hatches so far** (`grep escapeTenant` lists every one): the login account
lookup, the platform console's employee counts, and the two proxy-called routes
`/api/role` and `/api/account/status`, both reached over HTTP without a cookie and pinned
to an employeeId taken from the caller's own signed token.

**Not yet done, and needed before Phase 3.** Shadow mode has produced no findings from
live traffic yet, because the admin pages fetch through react-query *after* hydration —
so driving them with curl never invokes the server actions. Real signal needs the app
exercised through a browser, or the actions called directly. Until that has run, the size
of Phase 3 is still an estimate.

### Phase 3 — Enforce isolation
- Flip the plugin to fail-closed.
- Convert all `$lookup` stages to tenant-matched pipeline form (§3.2 caveat).
- Tenant-scope `LoginData`; add `tenantId` to the JWT; add the cross-tenant middleware
  guard; fix cookie scoping.
- Fix the two unique indexes (§1.8).
- Lock down `/api/role` and `/api/account/status`.
- Add `tenantId` to `withAudit` / `logAuditDirect`.
- **Automated cross-tenant tests**: seed two tenants, then assert every list/detail server
  action returns nothing for the other tenant's IDs.

### Phase 4 — Branding
- Branding schema + editor in the platform dashboard and in tenant settings.
- Server-rendered CSS variable overrides; `TenantBrandingProvider`; `generateMetadata()`.
- Replace all hardcoded logos/names (§1.5).
- Tenant asset upload to S3 under a tenant prefix.

### Phase 5 — Custom domains
- Domain CRUD + DNS TXT verification job.
- TLS automation (§5) + `domain-allowed` endpoint.
- Dynamic Socket.IO CORS from verified domains.
- Fix `process.env.NEXTAUTH_URL` usages to derive origin per request.

### Phase 6 — Per-tenant email
- `tenantId` on `EmailAccountModel` + index change + resolution fallback chain.
- Branded template layer; retire the legacy transport.
- Per-tenant cron iteration.

### Phase 7 — Real-time, storage, plans
- Socket.IO handshake auth (verify the NextAuth JWT) + `tenant:{id}` rooms; replace every
  `io.emit` with a room emit. Add `tenantId` to QR token claims and verify it.
- Tenant-prefixed S3 keys; per-tenant storage accounting.
- Feature flags / plan gating; seat limits; per-tenant rate limiting (`lib/rateLimit.js`).

### Phase 8 — Lifecycle and hardening
- Tenant provisioning wizard (create tenant → first super admin → seed departments,
  leave settings, holidays).
- Suspend / reactivate / export / hard-delete.
- Support impersonation with audit trail.
- Penetration pass focused specifically on cross-tenant access.

---

## 8. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| A missed query filter leaks data across tenants | **Critical** | Automatic plugin, not manual edits; shadow mode; two-tenant automated test suite |
| `$lookup` sub-pipelines bypass the root `$match` | **Critical** | Explicit audit of every `aggregate` in `server/`; convert to pipeline-form lookups |
| Client-spoofed `x-tenant-id` header | **Critical** | Strip inbound header in proxy; query tenant always from session JWT |
| Session/cookie bleeding across `*.ourapp.com` subdomains | High | Never set a parent-domain cookie; verify per-host cookie scoping |
| `NEXTAUTH_URL` single-value assumption breaks multi-domain auth | High | Resolve in Phase 0; Auth.js v5 or per-request origin shim |
| Socket.IO global broadcast leaks events cross-tenant | High | Handshake auth + rooms (Phase 7). Note: the missing auth is a *current* issue too |
| The two unique indexes (§1.8) silently block tenant #2 | High | Fixed in Phase 3; test by onboarding a second tenant in staging first |
| Backfill migration mis-assigns historical records | High | Dry-run with counts per collection; take a full backup; make the script idempotent and re-runnable |
| `NEXT_PUBLIC_ALGO_KEY` means encrypted IDs are not a boundary | Medium | Never rely on ID obfuscation for authorisation; every action re-checks tenant |
| Custom-domain TLS rate limits / failed issuance | Medium | Always keep `slug.ourapp.com` working as a fallback; surface `sslStatus` in the UI |
| Cross-tenant reporting queries slow down as tenants grow | Medium | Every compound index leads with `tenantId` |
| `withTransaction` swallowing tenant-guard errors | Low | Rethrow `TenantContextError` specifically |

---

## 9. Effort shape

Rough relative sizing, not a schedule:

| Phase | Size | Notes |
|---|---|---|
| 0 — Decisions | XS | Mostly discussion |
| 1 — Tenant model + resolution | S | Contained; new code, little modification |
| 2 — Context + plugin + backfill | **L** | 48 schemas, migration, shadow-mode observation period |
| 3 — Enforcement + auth | **XL** | The `$lookup` audit and the two-tenant test suite dominate |
| 4 — Branding | M | Mostly mechanical once the tenant object is available |
| 5 — Custom domains | M | Application side is small; ops/TLS is the real work |
| 6 — Per-tenant email | S–M | Good foundation already exists |
| 7 — Sockets, storage, plans | M | Socket rework also fixes a current security gap |
| 8 — Lifecycle + hardening | M | |

**Phases 2 and 3 are ~60% of the total effort.** That is where the isolation guarantee is
actually built, and it is not worth compressing — everything else is comparatively
mechanical.

---

## 10. Recommended immediate next steps

1. **Agree the isolation model** (Option A) and the domain scheme.
2. **Settle the NextAuth question** — v4 with a per-request origin shim, or upgrade to
   Auth.js v5. It blocks custom domains and is cheaper to decide now than to retrofit.
3. **Fix the two unique indexes** (§1.8) — small, safe, and they are hard blockers.
4. **Prototype the tenant plugin in shadow mode** against a copy of production. The log
   output will tell us the true size of Phase 3 far more accurately than any estimate here.
5. **Audit every `aggregate()` with `$lookup`** and produce a checklist. This is the single
   highest-risk surface and it can be inventoried before any code changes.

---

# Progress report — where we are, where we stopped

Twelve commits on `feat/multi-tenancy-phase-1`. `main` untouched.

| Phase | State | Notes |
|---|---|---|
| 0 — Decisions | ✅ done | Shared DB + discriminator; field named `tenantId`, not `companyId`; Auth.js v5 with `trustHost` |
| 1 — Tenant model + resolution | ✅ done | Full tenant schema, host resolution, `/platform` shell |
| 2 — Context + plugin + backfill | ✅ done | 42 models scoped; production backfilled (336 docs, one tenant) |
| 3 — Enforce isolation | ✅ **live** | `TENANT_ENFORCEMENT=enforce` in production. `$lookup` rewritten automatically; auth scoped; `/api/role` and `/api/account/status` locked down; audit carries `tenantId`; 12 cross-tenant tests |
| 4 — Branding | ✅ done | Per-company branding, applied server-side; logo is still a pasted URL, no upload |
| 5 — Custom domains | ✅ done | Claim/verify ownership, subdomain routing, Caddy on-demand TLS with an ask endpoint, dynamic socket CORS |
| 6 — Per-tenant email | ✅ done | Per-company SMTP with platform fallback, branded templates, per-tenant cron; the index blocker is fixed and migrated |
| 7 — Sockets, storage, plans | ✅ done | Socket handshake auth + per-company rooms, tenant-bound QR tokens, dynamic socket CORS, S3 tenant prefixes, feature flags and seat limits enforced |
| 8 — Lifecycle | 🟡 mostly | Provisioning, suspend/reactivate, export and permanent delete done. **Support impersonation deliberately not built — see below** |

Delivered beyond the original plan:

- **Multi-company ownership** — `TenantMembership`, company switcher, per-company settings
- **2FA bypass fixed** — the gate was cleared from the client's payload with no server check
- **Three dead `$lookup` collection names** fixed; the leave list was broken for every role below super admin
- **`escapeTenant` silently did nothing inside server actions** — Next bundles the action layer separately, so the AsyncLocalStorage existed twice

## The SMTP blocker — fixed

`emailaccounts` carried `{ feature, isPrimary }` unique, so only **one** company
on the whole platform could have a primary sender per feature. The key now leads
with `tenantId`, and `scripts/migrate-smtp-index.mjs` has replaced it in
production — Mongoose creates the new index but never drops the old one, so it
had to be explicit. The same script cleared the stale `companyId_*` indexes left
by the tenant-field rename.

## Recommended order from here

1. Socket.IO handshake auth + per-tenant rooms — currently unauthenticated and every event is broadcast to every connected client
2. TLS automation for custom domains, and Socket.IO CORS from verified domains
3. S3 tenant prefixes

---

# Domain ownership — claim, verify, and transfer

## The problem with what is there now

`addDomain` refuses a hostname the moment any other company has it listed, verified or not. So the first company to *type* a domain locks everyone else out, including the company that actually controls the DNS. A typo or a squatter blocks the rightful owner, and the only way out is a database edit.

The unique index makes this structural:

```js
companySchema.index({ "domains.host": 1 }, { unique: true, sparse: true });
```

Two companies cannot even hold the same hostname as a pending claim.

## The model we want

Ownership is earned by proving DNS control, not by typing first.

1. **Claiming is open.** Any company may add a hostname, even one another company has already claimed, as long as nobody has verified it. Each claim gets its own verification token.
2. **Verifying is exclusive.** The first company to publish its token and pass the DNS check owns the domain. Every other pending claim on that hostname is dropped at that moment — they can never win it.
3. **A verified domain is closed.** Adding a hostname already verified elsewhere is refused with a message that says so and points at support, rather than a bare "already in use".
4. **Transfer is a human decision.** Only the platform team can release a verified domain, which returns it to the open pool.

This is how Vercel, Netlify and Cloudflare for SaaS behave, and for the same reason: DNS control is the only trustworthy claim.

### Why the check has to be at verification time

Every claim gets a **different** token. Nothing stops the domain's real owner publishing two TXT records and letting two companies both pass the DNS check. So the exclusivity test cannot live in the DNS check alone — verification must also confirm that no other company has already verified this hostname, and both must happen together.

### Schema and index

The unique index has to go: it is what prevents a second pending claim. Uniqueness moves to "at most one **verified** claim per hostname", which a Mongo index cannot express across array elements — a `partialFilterExpression` applies to the document, so a company with one verified and one pending domain would index both.

It is enforced in application code inside a transaction instead. The replica set already supports them, and the window is one document read plus one write.

Each domain also gains `claimedBy` context so the platform console can show who else wanted a hostname and settle disputes.

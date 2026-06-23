# HR Management System — Feature & Security Report

**Prepared for:** UK Government / Home Office (UKVI) Compliance Submission
**System name:** CDC HR Management System
**Software version:** 1.1.0 (Security Hardening release)
**Build / package version:** 0.1.0
**Release branch:** `security-hardening`
**Build reference (commit):** _see git log on branch `security-hardening`_
**Build date:** June 2026
**Document date:** 23 June 2026
**Vendor / author:** Webmints (Neel Patel)

> **Version 1.1.0 — Security Hardening** adds: env-only encryption keys,
> restricted real-time CORS, HTTPS outbound calls, HTTP security headers,
> login rate-limiting/lockout, locked-account visibility & audited admin
> password reset (office + site employees), mandatory 2FA for privileged roles,
> self-service password recovery, and emergency account lockdown with
> live-session termination.

---

## 1. Executive Summary

The CDC HR Management System is a web-based human-resources and workforce-management
platform used to manage office and site-based employees, attendance, leave,
right-to-work / immigration status, scheduling, documents and company records.

The platform is built on a modern, actively-maintained technology stack (Next.js 15,
React 19, Node.js, MongoDB) and applies defence-in-depth security controls across
authentication, authorisation, data protection, auditability and immigration
compliance. This document lists the functional features of the software and
describes the security measures that protect **both the individual user and the
company** operating the system.

---

## 2. Technology & Platform Overview

| Layer | Technology |
|---|---|
| Web framework | Next.js 15.3 (React 19) |
| Runtime | Node.js (custom server, `server.mjs`) |
| Database | MongoDB (via Mongoose ODM) |
| Authentication | NextAuth (JWT, encrypted) + credentials provider |
| Two-factor auth | TOTP (RFC 6238) via `otplib` |
| File / document storage | AWS S3 (private buckets, pre-signed URLs) |
| Email | SMTP / Microsoft Graph (encrypted credentials) |
| Real-time | Socket.IO (QR clock-in/out) |
| Password hashing | bcrypt |
| Encryption | AES-256-GCM (authenticated encryption) |

---

## 3. Functional Feature List

### 3.1 Employee & Workforce Management
- Office employee management (onboarding, profile, status, off-boarding).
- Site / field employee management.
- Reception / front-desk user role.
- Department and role-type management.
- Company record management.
- Employee document and "other details" records.

### 3.2 Attendance & Time Tracking
- Clock in / clock out for office and site employees.
- **QR-code-based attendance** — time-limited, single-use QR tokens generated in
  real time over an authenticated socket channel.
- Personal "My Attendance" view for each employee.
- Attendance filtering, correction and admin override (audited).
- Attendance reporting and export (CSV/Excel).

### 3.3 Scheduling & Rota
- Weekly rota / shift planning.
- Site assignment of managers and employees.
- "My Weekly Shifts" employee self-service view.
- Add/view employees per shift.

### 3.4 Leave Management
- Leave requests, approvals and entitlement tracking.
- Leave categories and configurable leave settings / leave-year rules.
- Personal "My Leaves" view.
- Leave reporting and export.
- Time-off / requests-off workflow.

### 3.5 Immigration & Right-to-Work Compliance (UKVI relevant)
- Capture of immigration type (British vs. visa holder), visa end-date and
  employment end-date.
- **Automatic block of sign-in** when a visa or employment end-date has expired.
- **Automated visa-expiry reminders** (milestone-based) via a scheduled daily job.
- Visa milestone tracking to support sponsor record-keeping duties.

### 3.6 Documents & Media
- Secure document / media management.
- Document table, upload and categorisation.
- Files stored privately in cloud storage; access only via short-lived signed links.

### 3.7 Visitor & Front-Desk
- Visitor management and visitor records.
- Lead / enquiry capture (marketing) with export.
- Dedicated public, restricted visitor portal on a separate brand domain.

### 3.8 Communications & Notifications
- Email integration (SMTP and Microsoft 365 / Graph).
- Email template management and configurable SMTP.
- Web push notifications.
- Real-time in-app notifications.

### 3.9 Administration & Governance
- Role-based access control (RBAC) with granular per-module permissions.
- **Audit logs** of privileged actions.
- Form template builder.
- Expense management.
- Issue / ticket reporting.
- Analytics dashboard.
- QR code management.
- Integrations management.

---

## 4. Security Architecture

### 4.1 Authentication
- **Credential authentication** with server-side validation; passwords are never
  stored in plain text — they are hashed with **bcrypt** (salted, adaptive).
- Sessions are issued as **JWTs with encryption enabled** and signed with a secret
  held only in server environment configuration (`NEXTAUTH_SECRET`).
- Failed logins return generic messages and do not disclose whether the email or
  the password was incorrect beyond what is necessary.
- Inactive, deleted, or expired-visa/expired-contract accounts are denied access
  at login.
- **Brute-force protection:** repeated failed login attempts from the same
  email/IP source are counted and, once a threshold is exceeded, that source is
  temporarily locked out for a cool-down period. Counters reset on successful
  login. Throttling is scoped to the email/IP pair so a single malicious source
  cannot deny service to a legitimate user signing in from elsewhere.
- **Locked-account visibility & recovery:** locked accounts are flagged in both
  the office and site employee management lists so a super administrator can
  identify them and reset the affected user's password (which also clears the
  lock). A reason is mandatory and the reset is fully audit-logged (see §4.7).
- **Self-service password recovery:** a "Forgot password?" flow issues a
  single-use, 30-minute reset link by email (only a hash of the token is stored).
  This provides an account-recovery path for every user — including a sole super
  administrator — without depending on another administrator. The endpoint does
  not disclose whether an email is registered (no account enumeration).
- **Emergency lockdown:** a super administrator can instantly deactivate a
  suspected-compromised account; combined with a per-request account-status check
  in middleware, this terminates the account's live sessions on its next request
  (even for another super administrator). A reason is mandatory and audited.

### 4.2 Two-Factor Authentication (2FA)
- Time-based One-Time Password (**TOTP**, RFC 6238) using `otplib`, compatible
  with standard authenticator apps (Google Authenticator, Microsoft Authenticator).
- QR-code provisioning for enrolment.
- When 2FA is required, the user is **forced through a verification step** before
  any protected route can be accessed (enforced in middleware).
- **2FA is mandatory for privileged roles:** administrators and super
  administrators who have not yet enrolled are redirected to a forced 2FA
  set-up screen and cannot reach any protected page until enrolment is complete.
  This ensures a stolen/guessed password alone cannot compromise a privileged
  account.
- 2FA state is managed centrally; disabling requires administrative control.

### 4.3 Authorisation & Access Control
- **Role model:** `superAdmin`, `admin`, `user`, `siteEmployee`, `reception`.
- **Route-prefix guards** in middleware: each role is restricted to its own area
  (`/admin`, `/employee`, `/hr`), with `superAdmin` having full scope.
- **Granular permission system:** admin/user access to each module is checked
  against per-user permission records on every protected request.
- Unauthorised access attempts are redirected to an `/unauthorized` page or the
  user's permitted dashboard — never silently allowed.
- A separate brand domain is locked to the public visitor portal only.

### 4.4 Device Binding & Session Integrity
- **Device fingerprinting** (FingerprintJS) identifies the device used at login.
- **Device lock** for reception/front-desk accounts: only pre-authorised devices
  may sign in; unknown devices are rejected (`DEVICE_UNAUTHORIZED`).
- Active-account/device re-verification on sensitive route access.
- Session records capture IP address, approximate geolocation (retrieved over
  HTTPS), platform, browser and device type for monitoring and incident
  investigation.
- Server-side session/login-token validation endpoint to confirm session validity.

### 4.5 Data Protection & Encryption
- **In transit:** served over HTTPS/TLS in production.
- **At rest (application level):** sensitive values (e.g. stored email account
  credentials) are encrypted using **AES-256-GCM**, an authenticated-encryption
  algorithm that protects both confidentiality and integrity (tamper detection
  via the GCM authentication tag).
- **Passwords:** one-way hashed with bcrypt — not recoverable, not reversible.
- Encryption keys and all secrets are sourced **exclusively from environment
  configuration with no in-code fallback**. Secrets are excluded from source
  control (`.env*` is git-ignored) and documented via a non-sensitive
  `.env.example` template.
- **Note on the record-ID obfuscation key:** the application also obfuscates
  database record IDs inside URLs, and this transformation runs in the browser.
  Its key is therefore necessarily inlined into the client bundle and is *not*
  treated as a true secret — it protects against casual ID enumeration, not as a
  confidentiality control. Genuinely sensitive material (passwords, stored email
  credentials) uses server-only keys and one-way hashing. Separating this
  client-side obfuscation key from server-only secrets entirely is on the
  hardening roadmap (see §8).

### 4.6 Secure Document Handling
- Documents are stored in **private** cloud storage (AWS S3, `ACL: private`).
- Files are never publicly addressable; access is granted only through
  **short-lived pre-signed URLs** (typically 60 seconds to 1 hour), after which
  the link expires automatically.
- Upload and download both flow through signed, time-limited URLs.

### 4.7 Auditability & Accountability
- All privileged actions performed by `admin` / `superAdmin` users are recorded in
  an **immutable audit log**, capturing:
  - actor identity (ID, name, email, role and actor type),
  - action name and affected module/entity,
  - **before/after state** of changed records,
  - success/failure outcome and error message,
  - IP address and request metadata,
  - timestamp.
- **Sensitive fields are automatically redacted** from audit entries
  (passwords, tokens, secrets, OTPs, PINs, authorisation headers, cookies).
- **Administrative password resets are fully accountable:** each reset records
  *who* performed it (actor identity/role), *for whom* (the target employee),
  *why* (a mandatory free-text reason) and *when* (timestamp). The new password
  value itself is never stored in the log (redacted).
- Audit logging is **best-effort and non-blocking** — it can never alter or break
  the underlying business action, but provides a defensible record for compliance
  and investigation.
- Audit logs are indexed for efficient compliance review by actor, module, entity
  and action.

### 4.8 Background Jobs & Internal Endpoints
- Scheduled jobs (e.g. visa-expiry reminders) run server-side and their trigger
  endpoints are **protected by a shared secret** (`CRON_SECRET`); requests without
  the correct secret are rejected with HTTP 401, preventing public invocation.

### 4.9 Secrets Management
- No credentials, API keys or encryption keys are committed to source control.
- All environment files (`.env*`) and certificate files (`*.pem`) are git-ignored.
- Configuration is injected at runtime via environment variables.

### 4.10 Transport & Browser Hardening
- **HTTP security headers** applied to all responses:
  - `Strict-Transport-Security` (HSTS, in production) — forces HTTPS.
  - `Content-Security-Policy` — restricts the sources from which scripts, styles,
    images, fonts and connections may load, mitigating cross-site scripting (XSS)
    and data-injection.
  - `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'` — prevent
    click-jacking via framing.
  - `X-Content-Type-Options: nosniff` — prevents MIME-type sniffing.
  - `Referrer-Policy: strict-origin-when-cross-origin` — limits referrer leakage.
  - `Permissions-Policy` — disables unused device APIs (microphone, geolocation);
    camera is permitted only for same-origin QR-code scanning.
- **Real-time channel CORS lock-down:** Socket.IO connections are restricted to an
  explicit allow-list of configured origins (no wildcard).
- **Outbound calls over HTTPS:** third-party lookups (e.g. IP geolocation) use
  encrypted HTTPS endpoints.

---

## 5. How the Software Protects the **User**

- Personal data is access-controlled — employees can only view their own
  attendance, leave and shift records via dedicated self-service views.
- Strong, irreversible password storage means a database compromise does not
  expose user passwords.
- Optional/required **2FA** protects accounts even if a password is leaked.
- Personal documents are kept in private storage and shared only through
  expiring links, limiting exposure.
- Sessions are tied to device and location data, helping detect account misuse.
- Sensitive fields are redacted from logs, so user secrets are not exposed to
  administrators or in audit trails.

## 6. How the Software Protects the **Company**

- **Role and permission enforcement** ensures staff only access the functions and
  data appropriate to their job, reducing insider risk.
- **Full audit trail** of administrative changes provides accountability and
  evidence for HR, legal and regulatory enquiries.
- **Immigration controls** (visa-expiry login blocks and automated reminders)
  support the company's right-to-work and **UKVI sponsor compliance** obligations.
- **Device locking** for front-desk terminals prevents off-site or unauthorised
  access to reception functions.
- **Encrypted credentials and private document storage** reduce the impact of a
  data breach and support data-protection obligations.
- **Secrets segregation** and protected internal jobs reduce the attack surface
  exposed to the public internet.

---

## 7. Data Protection / Regulatory Alignment

The system's design supports compliance with the **UK GDPR** and the **Data
Protection Act 2018** through:

- **Access control & data minimisation** — role-scoped access to personal data.
- **Integrity & confidentiality (Art. 5(1)(f))** — encryption in transit, AES-256-GCM
  for sensitive data at rest, bcrypt password hashing.
- **Accountability (Art. 5(2))** — comprehensive, redacted audit logging.
- **Right-to-work / sponsor duties** — automated immigration-status monitoring and
  reminders to support Home Office sponsor record-keeping requirements.

---

## 8. Hardening Status

The following controls, previously identified for improvement, have been
**implemented** in this release:

1. ✅ Application-level encryption keys are sourced **exclusively** from
   environment configuration; all in-code fallback default keys have been removed.
2. ✅ The real-time (Socket.IO) channel is restricted to an explicit origin
   allow-list rather than a wildcard.
3. ✅ Outbound third-party calls (e.g. IP geolocation) use HTTPS.
4. ✅ HTTP security headers added (HSTS, Content-Security-Policy, X-Frame-Options,
   X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
5. ✅ Account lockout / rate-limiting on repeated failed login attempts
   (MongoDB-backed, scoped per email/IP with a temporary lockout window).
6. ✅ Mandatory 2FA enrolment for administrator / super-administrator accounts.
7. ✅ Self-service password recovery ("Forgot password?") via single-use,
   time-limited, hashed email tokens.
8. ✅ Emergency account lockdown with live-session termination, for containing a
   compromised account.

The following remain on the continuous-improvement roadmap:

9. ⏳ Rotation of any encryption key previously present in source-control history,
   with re-encryption of affected data.
10. ⏳ Fully separate the client-side record-ID obfuscation key from server-only
    secret keys (distinct keys for URL obfuscation vs. credential encryption).
11. ⏳ Scheduled dependency vulnerability scanning and periodic penetration testing.
12. ⏳ Maintain at least two super-administrator accounts so a compromised or
    locked-out super admin can always be recovered by a peer.

---

*This report describes the security features as implemented in version 1.0
(build `11e98fd`). It is intended to demonstrate the platform's security posture
for the individual user and for the operating company.*

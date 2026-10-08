"use server";

/**
 * Bringing a company's existing staff list in from whatever they used before.
 *
 * A company switching to this app arrives with a spreadsheet, and until now the
 * only way in was to type every person into the form one at a time. This reads
 * the spreadsheet instead.
 *
 * THE PART THAT MATTERS: EMAIL
 *
 * An email address is not just a field on an employee — it is the credential.
 * `findAccountsByEmail` in server/authServer/authServer.js looks an email up
 * across four collections and *every tenant*, with no tenant filter, because at
 * login time there is no session to scope by. Two records sharing an address are
 * therefore two candidates for one login, and the app picks the first
 * deterministically while logging the clash (DUPLICATE_LOGIN_POLICY). A bulk
 * import is the fastest way anybody could ever manufacture hundreds of those,
 * so the checking here is deliberately stricter than the single-employee forms:
 *
 *   - the forms check their own collection, in the current tenant. This checks
 *     all four collections, across all tenants, before writing anything.
 *   - a clash inside another company is refused outright, not warned about.
 *     There is no correct way to resolve it from inside this company's import,
 *     and creating it would hand two companies a shared login.
 *   - matching is case-insensitive, because office emails have been lower-cased
 *     on write for years and site employee emails never have, so the same
 *     person is on file in two different casings depending on which list they
 *     are on.
 *
 * Everything is checked before a single document is written, and checked again
 * at the moment of writing. Nothing is half-imported: a row either lands
 * completely or is reported back with the reason, in a file that can be fixed
 * and re-uploaded.
 */

import crypto from "node:crypto";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { logAuditDirect } from "@/lib/audit";
import { escapeTenant } from "@/lib/tenantContext";
import { checkSeats } from "@/lib/tenantPlan";
import { parseCsv, toCsv } from "@/lib/csv";
import { coerceRow, matchHeaders, rowLabel } from "@/lib/migration/columns";
import { cleanText, emailKey, phoneKey } from "@/lib/migration/normalize";
import { emailButton } from "@/lib/emailTemplate";
import CompanyModel from "@/models/companyModel";
import EmployeModel from "@/models/employeModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import OfficeUserModel from "@/models/officeModel";
import PlatformUserModel from "@/models/platformUserModel";
import RoleTypesModel from "@/models/roleTypeModel";
import { hashPassword } from "@/utils/bcrypt";
import { syncMissingLeaveTypesNew } from "@/server/leaveServer/countLeaveServer";
import { getLeaveConfiguredState } from "@/server/leaveServer/leaveSetupServer";
import { resolveTenantAppUrl, sendTenantMail } from "@/server/email/tenantMail";
import { getServerSideProps } from "@/server/session/session";

/**
 * How many rows one file may carry.
 *
 * Not a technical ceiling — a server action holds the whole file in memory and
 * a few thousand rows is nothing. It is a blast-radius limit: an import is the
 * single largest write anybody can make in this app, and a file this size is
 * still small enough that the preview is readable before it is committed.
 */
const ROW_LIMIT = 2000;

const UNITED_KINGDOM = "United Kingdom";

/**
 * Tenants with an import running right now.
 *
 * Two admins importing overlapping files at the same moment is the one race the
 * pre-write checks cannot see: both would read "this email is free" and both
 * would then create it. Mongo has no unique index on email to stop them — it
 * cannot have one until the existing duplicates reported by
 * scripts/find-duplicate-emails.mjs are cleaned up — so the second import is
 * made to wait its turn instead.
 *
 * Process-local, which is exactly as far as it needs to go: the app runs as a
 * single Node process (server.mjs). If it is ever run multi-process this
 * becomes advisory, which is why the per-row re-check below exists as well.
 */
const importsInFlight = new Set();

/** The account collections an email could already be signing into. */
const ACCOUNT_SOURCES = [
  { kind: "office", label: "office staff", model: () => OfficeEmployeeModel },
  { kind: "site", label: "site employee", model: () => EmployeModel },
  { kind: "reception", label: "reception", model: () => OfficeUserModel },
  { kind: "platform", label: "platform administrator", model: () => PlatformUserModel },
];

/** Case-insensitive equality, which is what an email comparison has to be. */
const CASELESS = { locale: "en", strength: 2 };

/* -------------------------------------------------------------------------- */
/* Guards                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Only a super admin may import.
 *
 * Not the usual employee-management permission set: those let somebody edit the
 * staff they can already see, whereas this creates sign-in credentials in bulk
 * and can be aimed at either collection. It is the same bar as Company Settings
 * and Attendance Settings, for the same reason.
 */
async function requireImporter() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) {
    return { error: { success: false, message: "Not signed in" } };
  }
  if (user.role !== "superAdmin") {
    return {
      error: {
        success: false,
        message: "Only a super admin can import employee data",
      },
    };
  }
  if (!user.tenantId) {
    return {
      error: {
        success: false,
        message: "No company is associated with this account",
      },
    };
  }
  return { user };
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Read the file and work out, for every row, exactly what would happen.
 *
 * Writes nothing. Both the preview and the commit call this — the commit calls
 * it again rather than trusting what the preview decided, so a record created
 * between the two (by this import screen or by anybody using the ordinary form)
 * is seen.
 */
async function buildPlan({ kind, csvText, options, user }) {
  const dateOrder = options?.dateOrder === "MDY" ? "MDY" : "DMY";
  const duplicateStrategy = options?.duplicateStrategy === "update" ? "update" : "skip";
  const allowSharedPhones = options?.allowSharedPhones === true;
  const createMissingDepartments = options?.createMissingDepartments === true;
  const tenantId = String(user.tenantId);

  const { headers, rows } = parseCsv(csvText);

  if (!headers.length) {
    return { error: "That file has no header row." };
  }
  if (!rows.length) {
    return { error: "That file has headers but no rows underneath them." };
  }
  if (rows.length > ROW_LIMIT) {
    return {
      error: `That file has ${rows.length} rows. Import at most ${ROW_LIMIT} at a time.`,
    };
  }

  const columnReport = matchHeaders(headers, kind);
  if (columnReport.missingRequired.length) {
    return {
      error:
        "The file is missing columns the import cannot do without: " +
        columnReport.missingRequired.map((c) => c.header).join(", "),
      columns: columnReport,
    };
  }

  // Pass one: read every cell, with no database involved.
  const plan = rows.map((row) => {
    const { values, errors, warnings } = coerceRow(
      kind,
      row.cells,
      columnReport.byKey,
      { dateOrder }
    );
    return {
      line: row.line,
      cells: row.cells,
      values,
      errors,
      warnings,
      label: rowLabel(kind, values),
      email: values.email || "",
      phone: phoneKey(kind === "site" ? values.phone : values.phoneNumber),
      status: "create",
      existingId: null,
    };
  });

  // Pass two: the file against itself. Done before the database is asked
  // anything, because a file that repeats a person is a mistake in the file and
  // saying so is more useful than saying "already exists" after the first copy
  // of them has been created.
  const seenEmail = new Map();
  const seenPhone = new Map();
  for (const row of plan) {
    if (row.email) {
      const first = seenEmail.get(row.email);
      if (first) {
        row.errors.push(
          `The same email appears on line ${first} of this file as well`
        );
      } else {
        seenEmail.set(row.email, row.line);
      }
    }
    if (row.phone) {
      const first = seenPhone.get(row.phone);
      if (first && !allowSharedPhones) {
        row.errors.push(
          `The same phone number appears on line ${first} of this file as well`
        );
      } else if (first) {
        row.warnings.push(`Shares a phone number with line ${first}`);
      } else {
        seenPhone.set(row.phone, row.line);
      }
    }
  }

  await connect();

  // Pass three: the file against every account on the platform.
  const emails = [...seenEmail.keys()];
  const existingByEmail = await findExistingAccounts(emails);

  for (const row of plan) {
    if (!row.email) continue;
    const matches = existingByEmail.get(row.email) || [];
    if (!matches.length) continue;

    const live = matches.filter((m) => !m.deleted);
    if (!live.length) {
      row.warnings.push(
        "A deleted record in this company uses this email — importing anyway"
      );
      continue;
    }

    const elsewhere = live.find((m) => m.tenantId && m.tenantId !== tenantId);
    if (elsewhere) {
      row.errors.push(
        "This email already signs in to a different company on this platform. " +
          "One email cannot belong to two companies — change it, or ask support to move the account."
      );
      continue;
    }

    const platform = live.find((m) => m.kind === "platform");
    if (platform) {
      row.errors.push("This email belongs to a platform administrator account.");
      continue;
    }

    const wrongList = live.find((m) => m.kind !== kind);
    if (wrongList) {
      row.errors.push(
        `This email is already in use by ${wrongList.label} in this company. ` +
          "The same person cannot be on both lists — they would have two sign-ins."
      );
      continue;
    }

    // A record on the list we are importing into: the person is already here.
    const same = live.find((m) => m.kind === kind);
    row.existingId = String(same._id);
    row.status = duplicateStrategy === "update" ? "update" : "skip";
    row.warnings.push(
      duplicateStrategy === "update"
        ? "Already on this list — their record will be updated"
        : "Already on this list — skipped"
    );
  }

  // Pass four: phone numbers, within this company and this list only. A phone
  // is not a credential, so a clash across companies is nobody's problem.
  await checkExistingPhones({ kind, plan, allowSharedPhones });

  // Pass five: departments, which office staff cannot be saved without.
  const departments = await resolveDepartments({
    kind,
    plan,
    createMissingDepartments,
  });

  // Anything with an error is not going to be written, whatever it was before.
  for (const row of plan) {
    if (row.errors.length) row.status = "error";
  }

  const creating = plan.filter((row) => row.status === "create").length;
  const seats = await checkImportSeats({ kind, tenantId, adding: creating });

  // Whether imported office staff will come out with a leave entitlement.
  // Reported rather than enforced: a company may legitimately want the staff
  // list in before it decides its leave year, and Leave → Setup builds every
  // missing entitlement in one press afterwards. What it must not do is happen
  // silently — an entitlement written against the wrong leave year is skipped by
  // every later sync, so it would have to be deleted by hand.
  const leave = await checkLeaveReadiness(kind);

  return {
    kind,
    dateOrder,
    duplicateStrategy,
    headers,
    columns: columnReport,
    departments,
    seats,
    leave,
    rows: plan,
    totals: {
      rows: plan.length,
      create: creating,
      update: plan.filter((row) => row.status === "update").length,
      skip: plan.filter((row) => row.status === "skip").length,
      error: plan.filter((row) => row.status === "error").length,
      warnings: plan.filter(
        (row) => row.status !== "error" && row.warnings.length
      ).length,
    },
  };
}

/**
 * Every live or deleted account answering to any of these emails, anywhere.
 *
 * Deliberately unscoped: the whole point is to see accounts in other tenants,
 * which is exactly what a tenant-filtered query would hide. `escapeTenant`
 * takes a reason string for the same purpose it does everywhere else — so the
 * audit of who opts out of scoping stays readable.
 *
 * One query per collection rather than one per row: a 500-row file costs four
 * queries, not two thousand.
 */
async function findExistingAccounts(emails) {
  const byEmail = new Map();
  if (!emails.length) return byEmail;

  for (const source of ACCOUNT_SOURCES) {
    const rows = await escapeTenant(
      "migration: an email may already sign in to another company",
      () =>
        source
          .model()
          .find({ email: { $in: emails } })
          .collation(CASELESS)
          .select("_id email tenantId delete")
          .lean()
    );

    for (const row of rows) {
      const key = emailKey(row.email);
      if (!byEmail.has(key)) byEmail.set(key, []);
      byEmail.get(key).push({
        _id: row._id,
        kind: source.kind,
        label: source.label,
        tenantId: row.tenantId ? String(row.tenantId) : null,
        deleted: row.delete === true,
      });
    }
  }

  return byEmail;
}

/**
 * Phone clashes inside this company's own list.
 *
 * A warning by default rather than a refusal, because a shared number is a real
 * thing — a couple working for the same firm, a site office landline given for
 * everybody on it — and the single-employee form's flat refusal on phone is a
 * frequent complaint. `allowSharedPhones` flips it, and the screen says which
 * way it is set.
 *
 * Phones are stored as Numbers by both schemas, so the comparison is on the
 * national digits with the leading zero gone — see phoneKey().
 */
async function checkExistingPhones({ kind, plan, allowSharedPhones }) {
  const field = kind === "site" ? "phone" : "phoneNumber";
  const Model = kind === "site" ? EmployeModel : OfficeEmployeeModel;

  const numbers = [
    ...new Set(
      plan
        .filter((row) => row.phone && !row.errors.length)
        .map((row) => Number(row.phone))
        .filter((n) => Number.isFinite(n))
    ),
  ];
  if (!numbers.length) return;

  const existing = await Model.find({
    [field]: { $in: numbers },
    delete: { $ne: true },
  })
    .select(`_id ${field}`)
    .lean();

  if (!existing.length) return;

  const takenBy = new Map(
    existing.map((row) => [String(row[field]), String(row._id)])
  );

  for (const row of plan) {
    if (!row.phone) continue;
    const holder = takenBy.get(row.phone);
    if (!holder) continue;
    // Their own record, found by email a moment ago. Not a clash.
    if (holder === row.existingId) continue;

    if (allowSharedPhones) {
      row.warnings.push("This phone number is already on another employee here");
    } else {
      row.errors.push(
        "This phone number already belongs to somebody else in this company"
      );
    }
  }
}

/**
 * Turn the department names in the file into the ids the schema stores.
 *
 * Office staff cannot be saved without one — it is a required ObjectId ref — so
 * an unrecognised name is an error unless the person importing has said to
 * create the missing ones. Creating them is offered because a migration is
 * precisely the moment when the departments do not exist yet: the company has
 * not typed any of them in.
 */
async function resolveDepartments({ kind, plan, createMissingDepartments }) {
  if (kind !== "office") return { needed: [], missing: [], willCreate: false };

  const existing = await RoleTypesModel.find({ delete: false })
    .select("_id roleTitle")
    .lean();

  const byName = new Map(
    existing.map((role) => [cleanText(role.roleTitle).toLowerCase(), role])
  );

  const needed = new Set();
  const missing = new Set();

  for (const row of plan) {
    const name = cleanText(row.values.department);
    if (!name) continue;
    needed.add(name);
    const found = byName.get(name.toLowerCase());
    if (found) {
      row.departmentId = String(found._id);
      continue;
    }
    missing.add(name);
    if (!createMissingDepartments && !row.errors.length) {
      row.errors.push(
        `Department "${name}" does not exist. Create it first, or tick "create missing departments".`
      );
    }
  }

  return {
    needed: [...needed],
    missing: [...missing],
    willCreate: createMissingDepartments && missing.size > 0,
  };
}

/**
 * Whether imported office staff will come out with a leave entitlement.
 *
 * Only office staff have one: CommonLeave references OfficeEmploye, and site
 * employees have never had entitlements in this app — so for a site import the
 * question does not arise and is reported as not applying rather than as a
 * problem.
 *
 * Fails open as configured, for the same reason getLeaveConfiguredState does: a
 * screen that cannot read the leave settings must not tell a company that has
 * been running for years that it has no leave set up.
 */
async function checkLeaveReadiness(kind) {
  if (kind !== "office") return { applies: false, configured: true };
  try {
    const response = await getLeaveConfiguredState();
    const state = response?.data ? JSON.parse(response.data) : null;
    return {
      applies: true,
      configured: state?.configured !== false,
      leaveYear: state?.leaveYear || null,
      leaveYearStartMonth: state?.leaveYearStartMonth || null,
    };
  } catch (error) {
    console.log("Migration leave readiness check failed:", error?.message);
    return { applies: true, configured: true };
  }
}

/**
 * Whether the company's licence has room for the new records.
 *
 * Fails open, like the seat check on the single-employee form: a company must
 * never be blocked from taking on staff because a limit could not be read. Only
 * office staff count against it, because that is what checkTenantSeats counts.
 */
async function checkImportSeats({ kind, tenantId, adding }) {
  if (kind !== "office" || adding <= 0) return { allowed: true };
  try {
    const tenant = await escapeTenant("migration: the company's seat limit", () =>
      CompanyModel.findById(tenantId).select("limits").lean()
    );
    const limit = tenant?.limits?.maxEmployees ?? null;
    if (!limit) return { allowed: true };
    const used = await OfficeEmployeeModel.countDocuments({
      delete: { $ne: true },
    });
    return checkSeats({ limit, used, adding });
  } catch (error) {
    console.log("Migration seat check failed:", error?.message);
    return { allowed: true };
  }
}

/* -------------------------------------------------------------------------- */
/* Building records                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A password nobody knows, including us.
 *
 * Every imported account is created with one of these and `mustChangePassword`,
 * so an imported record cannot be signed into until its owner sets their own
 * password through the normal reset flow. The alternative — one shared starting
 * password across a whole company's staff, which is what the single-employee
 * forms do ("Cdc@1234", "Interior@1234") — would be a company-wide open door
 * from the moment the import finished.
 */
function randomPassword() {
  return `${crypto.randomBytes(18).toString("base64url")}Aa1!`;
}

/** The address country the forms imply: British staff are never asked. */
const resolveCountry = (values) =>
  values.immigrationType === "British"
    ? UNITED_KINGDOM
    : cleanText(values.country) || UNITED_KINGDOM;

/** Bank details, or nothing at all — never a half-filled sub-document. */
function buildBankDetail(values) {
  if (!values.accountName || !values.accountNumber || !values.sortCode) {
    return null;
  }
  return {
    accountName: values.accountName,
    bankName: values.bankName || "",
    accountNumber: values.accountNumber,
    sortCode: values.sortCode,
  };
}

/** Fields shared by both record shapes, dropped in as-is when present. */
function assignIfPresent(target, values, keys) {
  for (const key of keys) {
    if (values[key] !== undefined && values[key] !== "") target[key] = values[key];
  }
}

const OFFICE_OPTIONAL = [
  "employeId",
  "dateOfBirth",
  "immigrationCategory",
  "dayPerWeek",
  "weeklyHourType",
  "weeklyHours",
  "countryOfWork",
  "employeNI",
  "address",
  "streetAddress",
  "city",
  "postCode",
  "visaStartDate",
  "visaEndDate",
  "endDate",
  "emergencyName",
  "emergencyPhoneNumber",
  "emergencyRelation",
  "emergencyAddress",
];

const SITE_OPTIONAL = [
  "employeId",
  "dateOfBirth",
  "immigrationCategory",
  "utr",
  "employeNI",
  "visaStartDate",
  "eVisaExp",
  "endDate",
  "emergencyName",
  "emergencyPhoneNumber",
  "emergencyRelation",
  "emergencyAddress",
];

function buildOfficeDoc({ values, departmentId, tenantId }) {
  // Should never fire — resolveDepartments turns an unresolved department into
  // a row error, and an error row is never written. Here so that if it ever
  // does, it says which employee rather than "Cast to ObjectId failed".
  if (!isValidObjectId(departmentId)) {
    throw new Error(`No department could be resolved for ${values.name}`);
  }
  const doc = {
    name: values.name,
    email: values.email,
    phoneNumber: values.phoneNumber,
    roleType: values.roleType,
    employeType: values.employeType,
    immigrationType: values.immigrationType,
    joinDate: values.joinDate,
    department: createObjectId(departmentId),
    company: createObjectId(tenantId),
    country: resolveCountry(values),
    weeklyHourType: values.weeklyHourType || "fixed",
    dayPerWeek: values.dayPerWeek ?? 5,
  };
  assignIfPresent(doc, values, OFFICE_OPTIONAL);
  const bankDetail = buildBankDetail(values);
  if (bankDetail) doc.bankDetail = bankDetail;
  return doc;
}

function buildSiteDoc({ values }) {
  const doc = {
    firstName: values.firstName,
    lastName: values.lastName,
    email: values.email,
    phone: values.phone,
    // Weekly is CIS, monthly is payroll — the same derivation handleEmploye
    // makes from the same field.
    employeType: values.paymentType === "Monthly" ? "Payroll" : "CIS",
    paymentType: values.paymentType,
    cisDeduction: values.cisDeduction ?? 0,
    payType: values.payType,
    payRate: values.payRate,
    startDate: values.startDate,
    employeRole: values.employeRole,
    immigrationType: values.immigrationType,
    eAddress: {
      address: values.address,
      streetAddress: values.streetAddress || "",
      city: values.city || "",
      postCode: values.postCode,
      country: resolveCountry(values),
    },
  };
  assignIfPresent(doc, values, SITE_OPTIONAL);
  const bankDetail = buildBankDetail(values);
  if (bankDetail) doc.bankDetail = bankDetail;
  return doc;
}

/**
 * The fields an update is allowed to touch.
 *
 * Email is not among them: it is what the row was matched on, so changing it
 * would mean the row no longer describes the record it just updated. Neither is
 * anything that decides privilege or lifecycle — `isAdmin`, `isSuperAdmin`,
 * `delete`, `isActive`, `password`, `tenantId` — none of which appear in the
 * column whitelist either. This is the second of the two places that has to
 * hold for a CSV not to be a way of granting yourself access.
 */
function applyUpdate(record, doc) {
  const changes = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key === "email" || key === "password" || key === "company") continue;
    if (value === undefined || value === "") continue;
    record[key] = value;
    changes[key] = value;
  }
  return changes;
}

/* -------------------------------------------------------------------------- */
/* The two actions                                                             */
/* -------------------------------------------------------------------------- */

/** The preview's view of a planned row — no bank details, no addresses. */
const toReportRow = (row) => ({
  line: row.line,
  label: row.label,
  email: row.email,
  status: row.status,
  errors: row.errors,
  warnings: row.warnings,
});

/**
 * Read a file and report what importing it would do. Writes nothing.
 *
 * @param {{ kind: "office"|"site", csvText: string, options: object }} input
 */
export async function analyseMigration({ kind, csvText, options } = {}) {
  const { error, user } = await requireImporter();
  if (error) return error;

  if (kind !== "office" && kind !== "site") {
    return { success: false, message: "Choose what kind of staff this file holds" };
  }
  if (!csvText || typeof csvText !== "string") {
    return { success: false, message: "No file was uploaded" };
  }

  try {
    const plan = await buildPlan({ kind, csvText, options, user });
    if (plan.error) return { success: false, message: plan.error };

    return {
      success: true,
      data: JSON.stringify({
        kind: plan.kind,
        totals: plan.totals,
        columns: {
          matched: plan.columns.matched,
          ignored: plan.columns.ignored,
          duplicated: plan.columns.duplicated,
        },
        departments: plan.departments,
        seats: plan.seats,
        leave: plan.leave,
        rows: plan.rows.map(toReportRow),
      }),
    };
  } catch (err) {
    console.log("analyseMigration failed:", err);
    return { success: false, message: "That file could not be read" };
  }
}

/**
 * Do it.
 *
 * Re-plans from the file rather than trusting the preview, holds the tenant's
 * import lock for the duration, and writes one record at a time — re-checking
 * the email against the target list immediately before each insert, so a record
 * created while somebody was reading the preview is still caught.
 *
 * Not a transaction. A half-finished import that reports exactly which rows
 * landed is more useful here than an all-or-nothing rollback: the failures in a
 * migration are per-row and the fix is per-row, which is what the returned
 * error file is for.
 */
export async function commitMigration({ kind, csvText, options } = {}) {
  const { error, user } = await requireImporter();
  if (error) return error;

  if (kind !== "office" && kind !== "site") {
    return { success: false, message: "Choose what kind of staff this file holds" };
  }
  if (!csvText || typeof csvText !== "string") {
    return { success: false, message: "No file was uploaded" };
  }

  const tenantId = String(user.tenantId);
  if (importsInFlight.has(tenantId)) {
    return {
      success: false,
      message:
        "An import is already running for this company. Wait for it to finish before starting another.",
    };
  }
  importsInFlight.add(tenantId);

  try {
    const plan = await buildPlan({ kind, csvText, options, user });
    if (plan.error) return { success: false, message: plan.error };

    if (!plan.seats.allowed) {
      return { success: false, message: plan.seats.message };
    }

    const actionable = plan.rows.filter(
      (row) => row.status === "create" || row.status === "update"
    );
    if (!actionable.length) {
      return {
        success: false,
        message:
          plan.totals.error > 0
            ? "Every row in that file has a problem. Fix them and upload it again."
            : "There is nothing new in that file — every row is already on the list.",
      };
    }

    if (plan.departments.willCreate) {
      await createDepartments(plan);
    }

    const outcome = await writeRows({
      kind,
      plan,
      tenantId,
      sendWelcomeEmails: options?.sendWelcomeEmails === true,
      leaveConfigured: plan.leave?.configured !== false,
    });

    await logAuditDirect({
      actor: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      action: "Migration.import",
      module: "Migration",
      tenantId,
      status: outcome.failed.length ? "failure" : "success",
      description:
        `Imported ${kind === "site" ? "site employees" : "office staff"} from a file: ` +
        `${outcome.created} created, ${outcome.updated} updated, ` +
        `${plan.totals.skip} already on the list, ${outcome.failed.length} failed.`,
      // Deliberately a summary and not the file. The rows carry home addresses,
      // dates of birth, NI numbers and bank details, and an audit entry is read
      // by more people, for longer, than the import screen is.
      metadata: {
        kind,
        rows: plan.totals.rows,
        created: outcome.created,
        updated: outcome.updated,
        skipped: plan.totals.skip,
        failed: outcome.failed.length,
        emailed: outcome.emailed,
        entitlementsBuilt: outcome.leave.built,
        entitlementsSkipped: outcome.leave.skipped,
        departmentsCreated: plan.departments.willCreate
          ? plan.departments.missing
          : [],
      },
    });

    return {
      success: true,
      data: JSON.stringify({
        created: outcome.created,
        updated: outcome.updated,
        skipped: plan.totals.skip,
        failed: outcome.failed.length,
        emailed: outcome.emailed,
        entitlementsBuilt: outcome.leave.built,
        entitlementsSkipped: outcome.leave.skipped,
        emailFailures: outcome.emailFailures,
        leave: outcome.leave,
        rows: outcome.results,
        // Everything that did not land, back in the shape it arrived in, so it
        // can be corrected in a spreadsheet and uploaded again. The rejected
        // rows only — re-uploading the whole file would be reported as hundreds
        // of duplicates.
        errorCsv: outcome.failed.length
          ? buildErrorCsv(plan, outcome.failed)
          : null,
      }),
    };
  } catch (err) {
    console.log("commitMigration failed:", err);
    return { success: false, message: "The import stopped part-way. Nothing further was written." };
  } finally {
    importsInFlight.delete(tenantId);
  }
}

/** Create the departments the file mentions that the company does not have. */
async function createDepartments(plan) {
  for (const name of plan.departments.missing) {
    const created = await RoleTypesModel.create({
      roleTitle: name,
      roleDescription: "Created during a staff data import",
      isActive: true,
      delete: false,
    });
    for (const row of plan.rows) {
      if (
        cleanText(row.values.department).toLowerCase() === name.toLowerCase()
      ) {
        row.departmentId = String(created._id);
        // The error was added before we knew the department would be made.
        row.errors = row.errors.filter(
          (message) => !message.startsWith(`Department "${name}"`)
        );
        if (!row.errors.length && row.status === "error") row.status = "create";
      }
    }
  }

  // Re-derive the counts the rest of the run reports against.
  plan.totals.error = plan.rows.filter((row) => row.status === "error").length;
  plan.totals.create = plan.rows.filter((row) => row.status === "create").length;
}

/** The write loop. One row at a time, each one re-checked as it goes in. */
async function writeRows({
  kind,
  plan,
  tenantId,
  sendWelcomeEmails,
  leaveConfigured,
}) {
  const Model = kind === "site" ? EmployeModel : OfficeEmployeeModel;

  const results = [];
  const failed = [];
  let created = 0;
  let updated = 0;
  let emailed = 0;
  let entitlementsBuilt = 0;
  let entitlementsSkipped = 0;
  let entitlementsFailed = 0;
  const emailFailures = [];

  // Only resolved when something actually needs to be sent.
  let appUrl = null;

  for (const row of plan.rows) {
    if (row.status !== "create" && row.status !== "update") continue;

    try {
      if (row.status === "create") {
        // The last look before writing. Between the plan and here, somebody may
        // have added this person through the ordinary form — this is cheap and
        // catches it.
        const taken = await Model.findOne({ email: row.email })
          .collation(CASELESS)
          .select("_id")
          .lean();
        if (taken) {
          row.errors.push("Somebody created this email while the import was running");
          failed.push(row);
          results.push(toReportRow({ ...row, status: "error" }));
          continue;
        }

        const doc =
          kind === "site"
            ? buildSiteDoc({ values: row.values })
            : buildOfficeDoc({
                values: row.values,
                departmentId: row.departmentId,
                tenantId,
              });

        const record = new Model({
          ...doc,
          password: await hashPassword(randomPassword()),
          // Nobody knows the password above, so the account is unusable until
          // its owner sets one. This flag makes the app insist on that the
          // first time they do sign in.
          mustChangePassword: true,
          isActive: true,
          delete: false,
        });
        // .save() rather than insertMany: the tenant plugin stamps tenantId in
        // a pre-save hook, and validation runs per document so one bad record
        // fails alone instead of taking the batch with it.
        await record.save();
        created++;

        if (kind === "office") {
          // Office staff need a leave entitlement for the current leave year or
          // the leave screens show them as having none. Worked out from their
          // own start date against the company's chosen leave year: somebody who
          // joined before it began gets the full 5.6 weeks × their contracted
          // days, somebody who joined part way through gets the share of it
          // they are employed for.
          //
          // Best-effort, and skipped entirely when the company has not set leave
          // up: generating against the April default and then having the company
          // choose January would leave four hundred balances filed under the
          // wrong twelve months, and an entitlement once written is skipped by
          // every later sync. The preview says so before the import runs, and
          // Leave → Setup builds them all in one press afterwards.
          if (!leaveConfigured) {
            entitlementsSkipped++;
          } else {
            try {
              const synced = await syncMissingLeaveTypesNew(
                record.joinDate,
                record.dayPerWeek,
                record._id
              );
              if (synced?.success) entitlementsBuilt++;
              else {
                entitlementsFailed++;
                row.warnings.push(
                  "Imported, but the leave entitlement did not build — " +
                    "rebuild it from Leave → Setup"
                );
              }
            } catch (leaveError) {
              entitlementsFailed++;
              row.warnings.push(
                "Imported, but the leave entitlement did not build"
              );
              console.log("Migration leave sync failed:", leaveError?.message);
            }
          }
        }

        if (sendWelcomeEmails && !hasExpiredVisa(kind, row.values)) {
          if (appUrl === null) appUrl = await resolveTenantAppUrl(tenantId);
          const sent = await sendWelcome({
            tenantId,
            appUrl,
            to: record.email,
            name: row.label,
          });
          if (sent) emailed++;
          else emailFailures.push(record.email);
        }

        results.push(toReportRow({ ...row, status: "create" }));
      } else {
        const record = await Model.findById(row.existingId);
        if (!record) {
          row.errors.push("The matching record disappeared while importing");
          failed.push(row);
          results.push(toReportRow({ ...row, status: "error" }));
          continue;
        }
        const doc =
          kind === "site"
            ? buildSiteDoc({ values: row.values })
            : buildOfficeDoc({
                values: row.values,
                departmentId: row.departmentId,
                tenantId,
              });
        applyUpdate(record, doc);
        await record.save();
        updated++;
        results.push(toReportRow({ ...row, status: "update" }));
      }
    } catch (err) {
      console.log(`Migration row ${row.line} failed:`, err?.message);
      row.errors.push(readableMongoError(err));
      failed.push(row);
      results.push(toReportRow({ ...row, status: "error" }));
    }
  }

  return {
    created,
    updated,
    emailed,
    emailFailures,
    failed,
    results,
    leave: {
      configured: leaveConfigured,
      built: entitlementsBuilt,
      skipped: entitlementsSkipped,
      failed: entitlementsFailed,
    },
  };
}

/**
 * A record whose visa has already run out is history being filed, not somebody
 * starting on Monday. Both single-employee create paths refuse to email those;
 * so does this.
 */
function hasExpiredVisa(kind, values) {
  const end = kind === "site" ? values.eVisaExp : values.visaEndDate;
  return end instanceof Date && end < new Date();
}

/**
 * Tell somebody their account exists.
 *
 * Note what is *not* in it: a password. The single-employee flow emails one in
 * plain text, which is survivable for one person and is not for four hundred —
 * a mail archive with a company's entire staff list and their starting
 * credentials is a different kind of object. Imported accounts have a random
 * password nobody holds, so the link goes to the reset flow instead.
 */
async function sendWelcome({ tenantId, appUrl, to, name }) {
  try {
    const resetUrl = `${String(appUrl).replace(/\/$/, "")}/forgot-password`;
    const html = `<p>Dear ${name},</p>
      <p>Your account has been set up. To use it, choose a password:</p>
      ${emailButton("Set your password", resetUrl)}
      <p>If the button does not work, open: ${resetUrl}</p>
      <p>Sign in afterwards with this email address: <strong>${to}</strong></p>`;
    const sent = await sendTenantMail({
      tenantId,
      feature: "HR",
      to,
      subject: "Your account is ready",
      heading: "Set your password",
      html,
    });
    return Boolean(sent?.success);
  } catch (err) {
    console.log("Migration welcome email failed:", err?.message);
    return false;
  }
}

/** Mongoose's complaints, in words the person importing can act on. */
function readableMongoError(err) {
  if (err?.name === "ValidationError") {
    const fields = Object.keys(err.errors || {}).join(", ");
    return `The record was rejected (${fields || "validation failed"})`;
  }
  if (err?.code === 11000) {
    return "A record with these details already exists";
  }
  return "Could not save this row";
}

/**
 * The rejected rows, as they arrived, with the reason appended.
 *
 * Same headers as the uploaded file so it round-trips: fix the cells, delete
 * the reason column or leave it (it is ignored on the way back in), upload.
 */
function buildErrorCsv(plan, failedRows) {
  const headers = [...plan.headers, "Import Error"];
  const rows = failedRows.map((row) => {
    const cells = plan.headers.map((_, index) => row.cells[index] ?? "");
    return [...cells, row.errors.join("; ")];
  });
  return toCsv(headers, rows);
}

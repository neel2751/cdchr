"use server";
import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import bcrypt from "bcryptjs";
import UserSession from "@/models/sessionModel";
import { sendTenantMail } from "../email/tenantMail";
import { getServerSideProps } from "../session/session";
import EmployeModel from "@/models/employeModel";
import OfficeUserModel from "@/models/officeModel";
import PlatformUserModel from "@/models/platformUserModel";
import { escapeTenant } from "@/lib/tenantContext";
import TenantMembershipModel from "@/models/tenantMembershipModel";
import CompanyModel from "@/models/companyModel";
import { NO_MATCH_MESSAGE } from "@/lib/authErrors";
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  recordFailedLogin,
} from "@/lib/rateLimit";


/**
 * LoginDataOld and LoginDataNew used to sit here.
 *
 * Two earlier credential checks, both dead — nothing in the app, the scripts
 * or the tests called either — and both still exported from a "use server"
 * module, which is to say both were still public endpoints that would check a
 * password for anyone who asked. The throttle added to LoginData below does
 * nothing for a caller who knocks on a different door, so the doors are gone.
 * Git has them if the superseded logic is ever wanted.
 */

/**
 * What to do when one email matches several accounts.
 *
 *   warn  (default) — pick deterministically and record it. Nobody is locked
 *                     out, which matters on a live HR system: a consistent
 *                     company is strictly better than today's arbitrary one,
 *                     and support gets the list to clean up.
 *   block           — refuse the login. Switch to this once the duplicates
 *                     reported by scripts/find-duplicate-emails.mjs are gone,
 *                     so a new one cannot quietly reappear.
 *
 * Deliberately the same shape as TENANT_ENFORCEMENT's shadow → enforce rollout.
 */
const DUPLICATE_LOGIN_POLICY =
  process.env.DUPLICATE_LOGIN_POLICY === "block" ? "block" : "warn";

/**
 * ONE SENTENCE FOR "no such email" AND "wrong password".
 *
 * Two different sentences let anybody discover who has an account here by
 * typing addresses and reading the wording. Imported rather than written out,
 * because lib/authErrors.js recognises the failure by its wording in order to
 * pick a wire code — so a copy of this string that drifts by one word becomes
 * SERVER_ERROR and tells the user the app is broken.
 */
const NO_MATCH = NO_MATCH_MESSAGE;

/**
 * A real bcrypt hash of nothing in particular, compared against when no
 * account exists, so an unknown address costs the same time as a known one.
 * Fixed rather than generated: generating one per request is slower than the
 * comparison it is hiding.
 */
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

// Which collection wins when an email exists in more than one. Preserves the
// original order: office, then site, then reception, then platform.
const ACCOUNT_SOURCES = [
  { userType: "office", model: () => OfficeEmployeeModel, lower: false },
  { userType: "site", model: () => EmployeModel, lower: false },
  { userType: "reception", model: () => OfficeUserModel, lower: false },
  // Provider-side staff who administer the platform itself. Checked last, so
  // this is only reached for an email that belongs to no tenant — a deployment
  // with no platform users behaves exactly as it did before.
  { userType: "platform", model: () => PlatformUserModel, lower: true },
];

/**
 * Every account answering to an email, best candidate first.
 *
 * All four collections are searched rather than stopping at the first hit: the
 * point is to notice that a second account exists, which a short-circuit cannot
 * do. Within a collection the sort is oldest-first on `_id`, which is stable
 * across calls — the previous `findOne` had no sort at all, so its answer came
 * back in whatever order the storage engine felt like.
 */
async function findAccountsByEmail(email) {
  const found = [];

  for (const source of ACCOUNT_SOURCES) {
    const rows = await source
      .model()
      .find({
        email: source.lower ? email.toLowerCase() : email,
        delete: { $ne: true },
      })
      .sort({ _id: 1 })
      .lean();

    for (const user of rows) {
      found.push({ user, userType: source.userType });
    }
  }

  return found;
}

/**
 * Make sure every company this email works for is reachable from one login.
 *
 * The same person added to two companies has a separate employee record in
 * each — HR creates them independently, because that is what the screens
 * offer. Nothing linked those records, so signing in picked one company
 * deterministically and the company switcher, which reads memberships, was
 * empty for exactly the people it exists for.
 *
 * So the memberships are written here, from what the records already say:
 * one row per company, carrying that company's own record id and the role
 * that record actually has. Done at login rather than as a migration because
 * it is self-healing — a person added to a third company next month is linked
 * the next time they sign in, with nobody having to remember.
 *
 * Only ever adds. It never deletes a membership and never changes a role that
 * somebody granted deliberately through the platform console, because an
 * explicit grant outranks anything inferred from an employee record.
 *
 * Best-effort: a failure here must not stop a correct password from signing
 * somebody in.
 */
async function linkCompaniesForEmail(email, matches) {
  try {
    const officeMatches = matches.filter(
      (m) => m.userType === "office" && m.user?.tenantId
    );
    if (officeMatches.length < 2) return;

    const normalized = String(email || "").trim().toLowerCase();

    for (const { user } of officeMatches) {
      const role = user.isSuperAdmin
        ? "superAdmin"
        : user.isAdmin
        ? "admin"
        : "user";

      await escapeTenant("login: link this email's companies", () =>
        TenantMembershipModel.updateOne(
          { email: normalized, tenantId: user.tenantId },
          {
            $setOnInsert: {
              userId: user._id,
              userModel: "OfficeEmploye",
              email: normalized,
              tenantId: user.tenantId,
              role,
              isActive: true,
              isDefault: false,
            },
          },
          { upsert: true }
        )
      );
    }
  } catch (error) {
    console.log("[login] could not link companies:", error?.message);
  }
}

/** Log a duplicate and record it, without ever failing the login for it. */
async function reportDuplicateLogin(email, matches) {
  const describe = matches
    .map(
      (m) => `${m.userType}:${m.user._id}${m.user.tenantId ? `@${m.user.tenantId}` : ""}`
    )
    .join(", ");

  // It no longer says which one signs in, because at this point nothing knows.
  // The password decides that, and it has not been checked yet — this used to
  // name matches[0] because matches[0] was the answer by construction. Saying
  // it anyway would make the log contradict the login it is describing.
  console.warn(
    `[login-duplicate] "${email}" matches ${matches.length} accounts (${describe}); ` +
      `whichever one the password opens will be used`
  );

  try {
    // Imported lazily on purpose. lib/audit pulls in the session helper, which
    // pulls in @/auth, which imports this file — a cycle through the login
    // path. It would probably survive ESM hoisting; "probably" is not a good
    // enough guarantee for the one code path that lets anyone in.
    const { logAuditDirect } = await import("@/lib/audit");
    await logAuditDirect({
      action: "Auth.duplicateEmail",
      module: "Auth",
      // The first record's company, chosen only so the entry is visible
      // somewhere. It is NOT "the company they landed in" — that is decided by
      // which record the password opens, which this code runs before. Every
      // match is listed in the metadata below, which is the part to read.
      tenantId: matches[0].user.tenantId,
      actor: { system: true },
      status: "failure",
      description:
        `"${email}" matches ${matches.length} accounts (${describe}). ` +
        `Sign-in uses whichever record the password opens. ` +
        `Each person should exist once.`,
      metadata: {
        email,
        policy: DUPLICATE_LOGIN_POLICY,
        matches: matches.map((m) => ({
          userType: m.userType,
          id: String(m.user._id),
          tenantId: m.user.tenantId ? String(m.user.tenantId) : null,
        })),
      },
    });
  } catch (error) {
    // Never let the audit write decide whether someone can sign in.
    console.log("[login-duplicate] audit write failed:", error?.message);
  }
}

/**
 * The credential check itself. Private — see LoginData below for why.
 */
const verifyCredentials = async (email, password, deviceId) => {
  if (!email || !password)
    return { status: false, message: "Please provide all details" };

  email = email.trim();
  password = password.trim();

  await connect();

  // Cross-tenant by necessity: at this point there is no session, so there is
  // no tenant — working out which one the account belongs to is the whole
  // purpose of this lookup. Which tenant they may then reach is enforced
  // afterwards, from the signed session.
  const matches = await escapeTenant("login: find account by email", () =>
    findAccountsByEmail(email)
  );

  // No user found.
  //
  // THE SAME SENTENCE AS A WRONG PASSWORD, on purpose. This used to say "Email
  // not found" while a bad password said "Invalid password. Try again.", so
  // anybody could type an address and learn from the wording alone whether it
  // had an account here. requestPasswordReset goes to real trouble over this —
  // it always answers "If an account exists for that email, a reset link has
  // been sent" — and login gave it away in two words.
  //
  // The dummy comparison is the other half. Without it an unknown address
  // returns with no bcrypt work done at all while a real one takes ~50ms per
  // candidate, which answers the same question in a different language.
  if (!matches.length) {
    await isMatchedPassword(password, DUMMY_HASH);
    return { status: false, message: NO_MATCH };
  }

  /**
   * More than one account answers to this email.
   *
   * This happens when the same person has been created in two companies — the
   * workaround for the app having no concept of a branch. It matters because
   * the old lookup took whichever record Mongo returned first, with no sort:
   * the same worker could land in a different company between logins and clock
   * in against the wrong one's payroll.
   *
   * `matches` is ordered deterministically (see findAccountsByEmail), so the
   * pick below is at least stable. The duplicate is reported either way.
   */
  if (matches.length > 1) {
    await reportDuplicateLogin(email, matches);
    // One identity, several companies: link them so the switcher can move
    // between them after signing in.
    await linkCompaniesForEmail(email, matches);
    if (DUPLICATE_LOGIN_POLICY === "block") {
      return {
        status: false,
        message:
          "This email is registered to more than one company. " +
          "Please contact your administrator.",
      };
    }
  }

  /**
   * WHICH OF THESE RECORDS IS THIS PERSON? THE PASSWORD SAYS.
   *
   * This used to take `matches[0]` — the oldest record — and check that one's
   * password. There is no user table in this app: a person IS an employee
   * record, a record belongs to one company, and the password is a field on
   * it. So one address can own two records with two different passwords, and
   * picking before checking meant picking blind.
   *
   * It broke three ways, all seen in production on 2026-10-16:
   *
   *   A password set on the record that did NOT sort first was simply never
   *   consulted. Two new employees had correct passwords, correctly hashed,
   *   and were told "Invalid password" — with nothing anywhere to explain it,
   *   because every part in isolation was working.
   *
   *   `isActive` was judged on the picked record, so a leaver marked inactive
   *   by one company was refused entry to the company that still employs
   *   them, and told to contact an admin who no longer employs them.
   *
   *   Each company's super admin can reset the password on their own record,
   *   correctly and within their own tenant. Only the first record's password
   *   was ever used, so one of the two admins was always silently wrong.
   *
   * The password is the ONE thing in the request that distinguishes these
   * records, so it is what resolves them: compare against every candidate and
   * let whichever matches be the answer. Several may match — the same password
   * set in both companies — and that is not ambiguous, it is agreement.
   *
   * Cost: one bcrypt comparison per record instead of one. ~50ms each, paid
   * only by people who actually have duplicates. The alternative was a login
   * that cannot be made to work for them at all.
   *
   * It does NOT reduce the duplicates, and is not meant to. Two passwords that
   * both work is better than one that silently does not; one credential per
   * person is the real answer and a bigger change.
   */
  const authenticated = [];
  for (const candidate of matches) {
    // A record with no password cannot authenticate anybody. Guarded because
    // bcrypt on undefined throws, and a throw here would be a 500 on the login
    // screen for everyone sharing that address.
    if (!candidate.user?.password) continue;
    if (await isMatchedPassword(password, candidate.user.password)) {
      authenticated.push(candidate);
    }
  }

  if (!authenticated.length) {
    return { status: false, message: NO_MATCH };
  }

  // ACTIVE IS JUDGED AFTER THE PASSWORD, not before and not during.
  //
  // Only now is it safe to say "your account is inactive": the person has
  // proved they hold the password, so the sentence tells them something they
  // are entitled to know rather than confirming to a stranger that the
  // address exists.
  //
  // And it looks at EVERY record they authenticated as, so one company
  // deactivating them cannot shut them out of another that has not.
  const live = authenticated.filter((m) => m.user.isActive !== false);
  if (!live.length) {
    return {
      status: false,
      message: "Your account is inactive. Please contact admin.",
    };
  }

  // Still deterministic, and now it only chooses between records that all
  // accepted the same password — so the choice can no longer be wrong in the
  // way that matters. Which company they land in is then theirs to change
  // (components/companyChoicePrompt.jsx).
  const { user, userType } = live[0];

  if (userType === "reception" && user.enforceDeviceLock) {
    console.log("Checking device authorization for reception user");
    const isAuthorizedDevice = user?.authorizedDevices?.some(
      (device) => device?.deviceId === deviceId
    );
    if (!isAuthorizedDevice) {
      return {
        status: false,
        message: "DEVICE_UNAUTHORIZED",
        detectedId: deviceId,
      };
    }
  }

  // Date/visa checks only for Office Employee
  if (userType === "office") {
    if (user.immigrationType === "British") {
      if (new Date(user.endDate) < new Date()) {
        return {
          status: false,
          message: "Your EndDate has expired. Please contact Admin.",
        };
      }
    } else if (userType === "site") {
      if (
        new Date(user.endDate) < new Date() ||
        new Date(user.visaEndDate) < new Date()
      ) {
        return {
          status: false,
          message: "Your visa has expired. Please contact Admin.",
        };
      }
    }
  }

  // Set role based on user type
  if (userType === "office") {
    if (user.isSuperAdmin) user.role = "superAdmin";
    else if (user.isAdmin) user.role = "admin";
    else user.role = "user";
    // const siteAssignment = await SiteAssignManagerModel.findOne({
    //   email,
    //   isActive: true,
    //   isDelete: false,
    // });
    // if (siteAssignment && siteAssignment.projectSiteID) {
    //   user.siteId = siteAssignment?.projectSiteID;
    // }
  } else if (userType === "site") {
    user.role = "siteEmployee";
  } else if (userType === "platform") {
    // Deliberately distinct from superAdmin, which is the top role *inside* a
    // tenant. platformAdmin sits outside every tenant and can only reach
    // /platform (see rolePathMap in proxy.js).
    user.role = "platformAdmin";
  } else {
    user.role = "reception";
    //
  }

  delete user.password;
  // Set employeType based on user type
  user.employeType =
    userType === "office"
      ? "OfficeEmployee"
      : userType === "site"
      ? "SiteEmployee"
      : userType === "platform"
      ? "PlatformUser"
      : "ReceptionEmployee";
  // user.employeType = userType === "office" ? "OfficeEmployee" : "SiteEmployee";
  user.name = user.name || user.firstName || "User";
  // Which company this login lands in. The employee record's own tenant is the
  // default, but a membership marked default wins — that is what lets one login
  // own several companies and choose where it starts.
  user.tenantId = user.tenantId ? String(user.tenantId) : null;
  if (userType === "office" && user._id) {
    try {
      const preferred = await TenantMembershipModel.findOne({
        userId: user._id,
        isActive: true,
        isDefault: true,
      })
        .lean()
        .exec();
      if (preferred?.tenantId) {
        user.tenantId = String(preferred.tenantId);
        user.role = preferred.role || user.role;
      }
    } catch (error) {
      // A membership lookup failure must never block signing in; the account
      // simply starts in its own company.
      console.log("Membership lookup failed:", error?.message);
    }
  }

  // The company's address, carried on the session so proxy.js can send someone
  // who signed in on the wrong host to their own workspace. Middleware runs on
  // the edge and cannot ask the database, so the slug has to travel with the
  // token or the redirect is impossible to build.
  //
  // Best-effort, like the membership lookup above: without it the proxy simply
  // keeps its old behaviour.
  user.tenantSlug = null;
  if (user.tenantId) {
    try {
      const company = await escapeTenant("login: workspace address", () =>
        CompanyModel.findById(user.tenantId).select("slug").lean().exec()
      );
      if (company?.slug) user.tenantSlug = company.slug;
    } catch (error) {
      console.log("Workspace address lookup failed:", error?.message);
    }
  }

  return {
    status: true,
    data: user,
  };
};

/**
 * Check someone's password, throttled.
 *
 * THE THROTTLE LIVES HERE, not in the caller. It used to sit entirely in the
 * `authorize()` callback in auth.js: check the limit, call LoginData, record
 * the failure. But this is an exported "use server" function, which makes it a
 * public endpoint reachable directly — so auth.js was guarding one of two doors
 * into the same credential check, and the other one counted nothing and refused
 * nobody. An unlimited password-guessing oracle, one POST away, for any email
 * address.
 *
 * Moved rather than duplicated: had both layers recorded failures, every real
 * failed login would have counted twice and locked people out in half the
 * attempts.
 *
 * A wrapper around the implementation rather than edits inside it, because the
 * check has a dozen separate refusal paths and a throttle that forgets one of
 * them is not a throttle. `ip` is passed by auth.js, which has the request;
 * a direct caller supplies nothing and is limited on the email alone.
 */
export const LoginData = async (email, password, deviceId, ip = "") => {
  const rate = await checkLoginRateLimit(email, ip);
  if (!rate.allowed) {
    return {
      status: false,
      message: "RATE_LIMITED",
      retryAfterSec: rate.retryAfterSec,
    };
  }

  const result = await verifyCredentials(email, password, deviceId);

  if (!result?.status) {
    // An unrecognised device is a known user on new hardware, handled by the
    // approval flow — not a guess, so it is not counted as one. Same judgement
    // auth.js made before this moved.
    if (result?.message !== "DEVICE_UNAUTHORIZED") {
      await recordFailedLogin(email, ip);
    }
    return result;
  }

  await clearLoginAttempts(email, ip);
  return result;
};

/**
 * `compare`, not `compareSync`.
 *
 * bcrypt is slow on purpose, and the sync call spends that time on the single
 * thread that serves every other request — so one sign-in froze the whole
 * server for ~50ms. It was `await bcrypt.compareSync(...)`, which awaits a
 * boolean and therefore looks asynchronous while being the opposite.
 *
 * It matters more now than it did: verifyCredentials compares against every
 * record an address owns, so a person with two companies cost two blocking
 * comparisons back to back. The async form hands the work to libuv's thread
 * pool and the event loop keeps serving.
 */
export const isMatchedPassword = async (password, hashword) => {
  try {
    return await bcrypt.compare(password, hashword);
  } catch (error) {
    console.log(`Error in Matching Password ${error}`);
    return false;
  }
};

export const storeSession = async (data) => {
  try {
    const {
      _id: userId,
      employeType: userType,
      platform,
      browser,
      device,
      query: ipAddress,
      country,
      city,
      zip,
      lat: latitude,
      lon: longitude,
      isp,
    } = data;
    const obj = {
      userId,
      userType:
        userType === "OfficeEmployee"
          ? "OfficeEmploye"
          : userType === "PlatformUser"
          ? "PlatformUser"
          : "Employe",
      platform,
      browser,
      device,
      ipAddress,
      country,
      city,
      zip,
      latitude,
      longitude,
      isp,
    };
    const alreadyStore = await UserSession.findOne({ userId, ipAddress });
    if (alreadyStore) {
      const update = await UserSession.updateOne({ userId, ipAddress }, obj);
      if (update) {
        return { status: true, message: "Session Updated" };
      }
    } else {
      const session = await UserSession.create(obj);
      if (session) {
        // Sent as the user's own company, so the notice carries their branding
        // rather than whichever company the deployment was first built for.
        await sendTenantMail({
          tenantId: data.tenantId,
          feature: "All",
          to: data.email,
          subject: "New sign-in to your account",
          heading: "New sign-in detected",
          html: loginNoticeBody(obj),
        });
        return { status: true };
      }
    }
    return { status: false, message: "Failed to store session" };
  } catch (error) {
    console.log(`Error in Storing Session ${error}`);
    return { status: false, message: "Failed to store session" };
  }
};

/** Body of the "new sign-in" notice; the branded shell is added by the sender. */
function loginNoticeBody(info) {
  const row = (label, value) =>
    value ? `<p style="margin:4px 0"><strong>${label}:</strong> ${value}</p>` : "";
  return `
    <p>We noticed a sign-in to your account:</p>
    ${row("IP address", info.ipAddress)}
    ${row("Device", info.device)}
    ${row("Browser", info.browser)}
    ${row("Location", [info.city, info.country].filter(Boolean).join(", "))}
    ${row("Time", new Date().toUTCString())}
    <p>If this was you, no action is needed. If not, change your password and
    contact your administrator.</p>`;
}

export const getSessionData = async () => {
  try {
    const { props } = await getServerSideProps();
    const userId = props?.session?.user?._id;
    if (!userId) return { status: false, message: "User not found" };

    // and near date on top result
    const user = await UserSession.find({ userId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return { status: true, data: JSON.stringify(user) };
  } catch (error) {
    console.log(`Error in Getting Session Data ${error}`);
    return { status: false, message: "Failed to get session data" };
  }
};

export const verifyPassword = async (password) => {
  try {
    if (!password) return { success: false, message: "Password is required" };
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    const employee = await OfficeEmployeeModel.findById(employeeId)
      .lean()
      .exec();
    if (!employee) return { success: false, message: "User not found" };

    const isMatch = await isMatchedPassword(password, employee.password);
    if (!isMatch) return { success: false, message: "Invalid Password" };

    return { success: true, message: "Password Verified" };
  } catch (error) {
    console.log(`Error in Verifying Password ${error}`);
    return { success: false, message: "Failed to verify password" };
  }
};

// const storeToken = async (data) => {
//   try {
//     const loginToken = crypto.randomUUID();
//     const user = await OfficeEmployeeModel.findOne({ email: data.email });
//     if (!user) return { success: false, message: "User not found" };
//     const userId = await LoginTokenModel.findOne({ userId: user._id });
//     if (!userId) {
//       const token = await LoginTokenModel.create({
//         loginToken,
//         userId: user._id,
//       });
//       if (token) {
//         return { success: true, token: loginToken };
//       }
//     } else {
//       const update = await LoginTokenModel.updateOne(
//         { userId: user._id },
//         { loginToken }
//       );
//       if (update) {
//         return { success: true, token: loginToken };
//       }
//     }
//   } catch (error) {
//     console.log(`Error in Storing Token ${error}`);
//     return { success: false, message: "Failed to store token" };
//   }
// };

// export const handleSignOut = async () => {
//   try {
//     const { props } = await getServerSideProps();
//     const userId = props.session.user._id;
//     const loginToken = "";
//     const update = await LoginTokenModel.updateOne({ userId }, { loginToken });
//   } catch (error) {
//     console.log(`Error in SignOut ${error}`);
//   }
// };

// export function getClientFingerprint(req) {
//   const userAgent = req.headers["user-agent"] || "";
//   const ip =
//     req.headers["x-forwarded-for"] || req.connection.remoteAddress || "";
//   return `${userAgent}-${ip}`; // Simple fingerprint example
// }

/**
 * End every signed-in session for the caller's own account.
 *
 * Sessions are JWTs, so there is nothing to delete: each token carries the
 * moment it was issued, and moving this stamp forward makes proxy.js refuse
 * anything older. The admin reset dialog already did this to somebody else's
 * account; this is the same lever, for your own.
 *
 * It ends **this** device too, and cannot do otherwise — the mechanism is a
 * timestamp, not a session list, so there is no token it could spare. The
 * screen says so and signs the person out rather than leaving them clicking
 * around a page whose next request will bounce them.
 *
 * Office employees only: site staff sign in at /employee, which has no
 * equivalent screen.
 */
export async function signOutAllDevices() {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    if (!employeeId) return { success: false, message: "Not signed in" };

    await connect();
    const employee = await OfficeEmployeeModel.findById(employeeId);
    if (!employee) return { success: false, message: "Record not found" };

    employee.sessionsValidFrom = new Date();
    await employee.save();

    // Read back rather than assume. Mongoose drops unknown paths silently, and
    // a server still holding a schema from before this field existed would
    // report success having saved nothing — the same trap the admin reset
    // dialog documents.
    const saved = await OfficeEmployeeModel.findById(employeeId)
      .select("sessionsValidFrom")
      .lean();
    if (!saved?.sessionsValidFrom) {
      return {
        success: false,
        message:
          "Could not end the other sessions — the server is running an older " +
          "version of the employee record. Restart the app and try again.",
      };
    }

    return { success: true, message: "Signed out everywhere" };
  } catch (error) {
    console.log("signOutAllDevices error:", error?.message);
    return { success: false, message: "Could not sign out the other devices" };
  }
}

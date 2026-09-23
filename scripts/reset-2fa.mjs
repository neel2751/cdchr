/**
 * Break-glass: remove an account's two-factor enrolment from the command line.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE IN-APP RESET
 *
 * A super admin can reset an office employee's 2FA from the employee list
 * (resetTwoFactorForEmployee in server/2FAServer/TwoAuthserver.js). That covers
 * everyone inside a tenant, because there is always someone above them.
 *
 * A platform admin has nobody above them. They live in `platformusers`, outside
 * every tenant, the in-app reset cannot see them, and a deployment normally has
 * exactly one. The signIn callback in auth.js requires 2FA of every platform
 * admin — so if that one account loses both its authenticator app and its
 * recovery codes, the platform console is gone for good and no amount of
 * clicking brings it back. This script is the way back in, and it deliberately
 * needs nothing but database access.
 *
 * It works for any account, not just platform admins: the same lockout can
 * happen to the only super admin of a company.
 *
 * WHAT IT DOES
 *
 * Deletes the enrolment record rather than disabling it, for the same reason
 * the in-app reset does: re-enrolment must not be able to fall back to the old
 * shared secret. If the reset was prompted by a compromise, that secret has to
 * die with it. It also clears any failed-login lockout, which usually
 * accompanies a lockout, and writes an audit entry so the reset is on the
 * record — a privileged account's second factor should never be removed
 * silently.
 *
 * Afterwards the account signs in with just its password and is sent straight
 * to /setup-2fa to re-enrol, where it is issued a fresh set of recovery codes.
 *
 * USAGE
 *
 *   npm run 2fa:reset -- --email someone@example.com --reason "lost phone"
 *   npm run 2fa:reset -- --email someone@example.com            # shows a dry run
 *
 * Without --reason it reports what it *would* do and changes nothing, so the
 * safe thing is also the default.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

/** Collections an account can live in, with the label used in output. */
const ACCOUNT_SOURCES = [
  { collection: "officeemployes", label: "office employee", lower: false },
  { collection: "employes", label: "site employee", lower: false },
  { collection: "officeusers", label: "reception user", lower: false },
  { collection: "platformusers", label: "platform admin", lower: true },
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

async function main() {
  const email = (arg("email") || "").trim();
  const reason = (arg("reason") || "").trim();

  if (!email) {
    fail(
      "Usage: npm run 2fa:reset -- --email <address> [--reason \"why\"]\n" +
        "Without --reason nothing is changed; you get a dry run."
    );
  }

  const uri = process.env.MONGO_DB_URL;
  if (!uri) fail("MONGO_DB_URL is not set.");

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  // Search every collection rather than stopping at the first hit: an address
  // present twice is worth seeing before removing anyone's second factor.
  const matches = [];
  for (const source of ACCOUNT_SOURCES) {
    const rows = await db
      .collection(source.collection)
      .find({
        email: source.lower ? email.toLowerCase() : email,
        delete: { $ne: true },
      })
      .toArray();
    for (const user of rows) matches.push({ user, source });
  }

  if (!matches.length) {
    await mongoose.disconnect();
    fail(`No account found for "${email}".`);
  }

  if (matches.length > 1) {
    console.log(`\n"${email}" matches ${matches.length} accounts:`);
    for (const m of matches) {
      console.log(`  - ${m.source.label} ${m.user._id}`);
    }
    await mongoose.disconnect();
    fail(
      "Refusing to guess which one to reset. Resolve the duplicate first " +
        "(npm run audit:duplicate-emails)."
    );
  }

  const { user, source } = matches[0];
  const enrolment = await db
    .collection("twofas")
    .findOne({ employeeId: user._id });

  const unused = (enrolment?.backupCodes || []).filter((c) => !c.usedAt).length;
  const lockouts = await db
    .collection("loginattempts")
    .countDocuments({ email: email.toLowerCase() });

  console.log(`\naccount    : ${user.name || user.firstName || "(no name)"} <${user.email}>`);
  console.log(`type       : ${source.label}`);
  console.log(`id         : ${user._id}`);
  console.log(`2FA record : ${enrolment ? (enrolment.isEnabled ? "enabled" : "present but disabled") : "none"}`);
  if (enrolment) console.log(`codes left : ${unused} unused recovery code(s)`);
  console.log(`login locks: ${lockouts} failed-attempt record(s)`);

  if (!enrolment && !lockouts) {
    console.log("\nNothing to reset: no enrolment and no lockout.\n");
    await mongoose.disconnect();
    return;
  }

  if (!reason) {
    console.log(
      "\nDRY RUN — nothing was changed.\n" +
        "Re-run with --reason \"why\" to actually reset:\n" +
        `  npm run 2fa:reset -- --email ${email} --reason "lost phone"\n`
    );
    await mongoose.disconnect();
    return;
  }

  if (enrolment) {
    await db.collection("twofas").deleteOne({ employeeId: user._id });
  }
  // Cleared even when there is no enrolment: being locked out of the password
  // step is its own problem and this is the tool people will reach for.
  await db.collection("loginattempts").deleteMany({ email: email.toLowerCase() });

  // Written straight to the collection rather than through lib/audit, which
  // pulls in the Next request context this script does not have. The shape
  // matches what logAuditDirect writes for a system actor.
  await db.collection("auditlogs").insertOne({
    actorType: "System",
    actorName: "System",
    actorRole: "system",
    action: "TwoFactor.reset",
    module: "Security",
    entityId: user._id,
    tenantId: user.tenantId ?? undefined,
    description:
      `Two-factor enrolment reset from the command line for ${source.label} ` +
      `<${user.email}>. Reason: ${reason}`,
    before: {
      twoFactorEnabled: !!enrolment?.isEnabled,
      unusedRecoveryCodes: unused,
      loginLockRecords: lockouts,
    },
    after: {
      twoFactorEnabled: false,
      unusedRecoveryCodes: 0,
      loginLockRecords: 0,
      reason,
      via: "scripts/reset-2fa.mjs",
    },
    status: "success",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log(
    `\nDone. ${enrolment ? "Enrolment deleted" : "No enrolment to delete"}; ` +
      `${lockouts} lockout record(s) cleared; audit entry written.\n` +
      `${user.email} can now sign in with their password alone and will be ` +
      `asked to set up 2FA again immediately, with a fresh set of recovery codes.\n`
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("reset-2fa failed:", error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

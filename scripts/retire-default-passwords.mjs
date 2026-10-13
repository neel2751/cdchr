/**
 * Retire the shared starting passwords from accounts that still hold one.
 *
 * WHY THIS EXISTS
 *
 * Until the fix in server/officeServer/officeServer.js,
 * server/employeServer/employeServer.js and
 * server/receptionServer/receptionServer.js, every account those forms created
 * was given one of two hardcoded passwords — "Cdc@1234" for office staff and
 * reception desks, "Interior@1234" for site staff. The same string in every
 * company, written in this repository. Anyone who has ever seen the source, or
 * guessed one from a colleague, could sign in as any member of staff who had
 * not changed it.
 *
 * The forms no longer do that. This is for the accounts created before they
 * stopped: it replaces the shared password with one nobody knows and emails
 * its owner a link to choose their own.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not touch an account whose password is anything other than a known
 * default. Somebody who already chose their own password keeps it and hears
 * nothing — the check is a bcrypt comparison against each default, not a
 * guess from the record's age.
 *
 * It does not rotate an account whose invitation could not be sent. Rotating
 * without a working email locks the owner out with no way back except an
 * administrator, so a failed send leaves the password alone and reports it.
 * `--force` overrides that for an address you know is dead.
 *
 * Platform admins ARE included, now that the reset flow serves them. They are
 * the account that matters most here — one shared password on `platformusers`
 * is every customer's data, not one company's — and they are also the account
 * with nobody above them to fix it, which is why the reset flow had to learn
 * about them first (see findAccountsByEmail in
 * server/authServer/passwordResetServer.js).
 *
 * USAGE
 *
 *   npm run passwords:retire                      # dry run: who still holds one
 *   npm run passwords:retire -- --apply           # rotate and email
 *   npm run passwords:retire -- --apply --only someone@example.com
 *   npm run passwords:retire -- --apply --force   # rotate even if the email fails
 *
 * Safe to run twice: the second run finds nothing, because the first left no
 * default behind.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

dotenv.config();

const {
  sendPasswordInvite,
  unknowablePassword,
} = await import("../server/authServer/passwordInvite.js");

/**
 * The passwords the forms used to assign.
 *
 * Listed in the clear deliberately: they are already public — they were
 * constants in the source, which is the entire problem — and the script's job
 * is to find the accounts still holding one. Nothing is added to this list
 * unless it was once a shipped default.
 */
const SHARED_DEFAULTS = ["Cdc@1234", "Interior@1234"];

/**
 * Collections the reset flow can serve, with the userType it expects.
 *
 * The order matches ACCOUNT_SOURCES in authServer.js and in the reset flow, so
 * the account this script treats as primary is the one login checks.
 */
const SOURCES = [
  {
    collection: "officeemployes",
    label: "office employee",
    userType: "office",
    name: (d) => d.name,
    // Only these two carry the flag; officeusers has no such field, so the
    // update must not invent one.
    hasMustChange: true,
  },
  {
    collection: "employes",
    label: "site employee",
    userType: "site",
    name: (d) => [d.firstName, d.lastName].filter(Boolean).join(" "),
    hasMustChange: true,
  },
  {
    collection: "officeusers",
    label: "reception user",
    userType: "reception",
    name: (d) => d.name,
    hasMustChange: false,
  },
  {
    collection: "platformusers",
    label: "platform admin",
    userType: "platform",
    name: (d) => d.name,
    hasMustChange: false,
    // The only collection whose addresses are stored lowercased.
    lower: true,
  },
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri) fail("MONGO_DB_URL is not set.");

  const only = (arg("only") || "").trim().toLowerCase();

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(`database: ${db.databaseName}`);

  const companies = await db
    .collection("companies")
    .find({}, { projection: { name: 1 } })
    .toArray();
  // A platform admin belongs to no company, which is not a missing value.
  const companyName = (id) =>
    !id
      ? "the platform itself"
      : companies.find((c) => String(c._id) === String(id))?.name ||
        "(unknown company)";

  /** Which default, if any, this account still holds. */
  const heldDefault = async (hash) => {
    if (!hash) return null;
    for (const candidate of SHARED_DEFAULTS) {
      // One at a time rather than in parallel: bcrypt is deliberately slow and
      // a whole company's staff at once is a lot of CPU for no gain in a
      // script nobody is waiting on.
      if (await bcrypt.compare(candidate, hash)) return candidate;
    }
    return null;
  };

  const affected = [];
  for (const source of SOURCES) {
    const query = { delete: { $ne: true } };
    if (only) {
      query.email = new RegExp(
        `^${only.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i",
      );
    }

    const rows = await db.collection(source.collection).find(query).toArray();
    for (const user of rows) {
      const held = await heldDefault(user.password);
      if (held) affected.push({ user, source, held });
    }
  }

  if (!affected.length) {
    console.log(
      only
        ? `\nNothing to do: "${only}" is not on a shared default password.\n`
        : "\nNothing to do: no account is on a shared default password.\n",
    );
    await mongoose.disconnect();
    return;
  }

  console.log(
    `\n${affected.length} account${affected.length === 1 ? "" : "s"} still on a ` +
      "shared default:\n",
  );
  for (const { user, source, held } of affected) {
    console.log(
      `  ${source.label.padEnd(15)} ${(source.name(user) || "(no name)").padEnd(24)} ` +
        `<${user.email || "no email"}>  ${companyName(user.tenantId)}  [${held}]`,
    );
  }

  const withoutEmail = affected.filter((a) => !a.user.email);
  if (withoutEmail.length) {
    const n = withoutEmail.length;
    console.log(
      `\n${n} of them ${n === 1 ? "has" : "have"} no email address, so no link ` +
        "can be sent. Skipped unless --force.",
    );
  }

  if (!APPLY) {
    console.log(
      "\nDRY RUN — nothing was changed.\n" +
        "Re-run with --apply to rotate these passwords and email each owner a " +
        "link to choose their own:\n" +
        "  npm run passwords:retire -- --apply\n",
    );
    await mongoose.disconnect();
    return;
  }

  console.log("\napplying:\n");
  let rotated = 0;
  let skipped = 0;

  for (const { user, source } of affected) {
    const who = `${source.name(user) || "(no name)"} <${user.email || "no email"}>`;

    // The invitation goes first. If it cannot be sent, the account keeps its
    // old password rather than becoming unreachable — the whole point of the
    // ordering.
    const invite = user.email
      ? await sendPasswordInvite({
          userId: user._id,
          userType: source.userType,
          email: user.email,
          name: source.name(user),
          tenantId: user.tenantId ? String(user.tenantId) : null,
          companyName: companyName(user.tenantId),
        })
      : { sent: false, message: "no email address on the record" };

    if (!invite.sent && !FORCE) {
      console.log(`  SKIPPED  ${who} — ${invite.message}`);
      skipped += 1;
      continue;
    }

    const set = { password: await bcrypt.hash(unknowablePassword(), 10) };
    if (source.hasMustChange) set.mustChangePassword = true;
    await db.collection(source.collection).updateOne({ _id: user._id }, { $set: set });

    // Written straight to the collection rather than through lib/audit, which
    // pulls in the Next request context this script does not have. The shape
    // matches what logAuditDirect writes for a system actor — the same
    // approach as scripts/reset-2fa.mjs.
    await db.collection("auditlogs").insertOne({
      actorType: "System",
      actorName: "System",
      actorRole: "system",
      action: "Password.retireDefault",
      module: "Security",
      entityId: user._id,
      tenantId: user.tenantId ?? undefined,
      description:
        `Shared default password retired from the command line for ` +
        `${source.label} <${user.email || "no email"}>` +
        (invite.sent
          ? " and a link to set a new one was emailed"
          : " WITHOUT a working email (--force)"),
      // Never the password, old or new. That it was a shipped default is the
      // part worth keeping; the value is already public and the replacement
      // must not be anywhere it can be read.
      after: { method: "retire-default-passwords", inviteEmailed: invite.sent },
      status: "success",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(
      `  ROTATED  ${who}` + (invite.sent ? " — link emailed" : " — NO EMAIL SENT"),
    );
    rotated += 1;
  }

  console.log(
    `\n${rotated} rotated, ${skipped} skipped.` +
      (skipped
        ? "\nThe skipped ones keep their old password. Fix the address, or " +
          "re-run with --force\nand set their password by hand."
        : ""),
  );
  console.log();

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("\nretire-default-passwords failed:", error?.message || error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

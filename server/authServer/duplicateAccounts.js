/**
 * NOT a "use server" module, deliberately.
 *
 * This enumerates accounts by email address. As a server action it would be a
 * public endpoint for asking "does this person work here", which is the user
 * enumeration that requestPasswordReset goes out of its way to avoid by always
 * returning the same generic sentence. It has no caller but other server code.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * WHY A PASSWORD RESET CAN LAND ON THE WRONG RECORD.
 *
 * One email can own several employee records — one per company — because HR in
 * each company creates their own, which is what the screens offer. Each record
 * carries its OWN password field. Sign-in picks one of them deterministically
 * and checks that one's password (findAccountsByEmail in authServer.js).
 *
 * So resetting the record an admin happens to be looking at is not necessarily
 * resetting the one sign-in will check. On 2026-10-16 that is exactly what
 * happened: two new employees had their passwords reset successfully, the hash
 * was correct, and both were told "invalid password" — because each also had a
 * leftover test record in another company, and sign-in was checking that.
 *
 * resetPasswordWithToken already handles this, by writing to every record the
 * address owns. An administrator's reset CANNOT do that: a super admin of one
 * company must not be able to set a password that opens an account in another
 * company. That is a tenant boundary, and silently crossing it to make a reset
 * "work" would be a worse bug than the one being fixed.
 *
 * So the admin path warns instead, and this is what it asks.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It does NOT reuse findAccountsByEmail. There are already two versions of that
 * — authServer.js sorts on `_id` and is case-sensitive, passwordResetServer.js
 * sorts on `createdAt` and is not — and they can therefore disagree about which
 * record is "first". Consolidating them changes which account people sign in
 * as, which is not something to do in passing while fixing a reset. This asks a
 * narrower question that no sort order can affect: does another record exist,
 * and whose company is it in. Consolidating the three is its own job.
 */
import { connect } from "@/db/db";
import { escapeTenant } from "@/lib/tenantContext";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";
import OfficeUserModel from "@/models/officeModel";
import PlatformUserModel from "@/models/platformUserModel";

/** Everywhere an email can own a password. */
const SOURCES = [
  { userType: "office", model: () => OfficeEmployeeModel },
  { userType: "site", model: () => EmployeModel },
  { userType: "reception", model: () => OfficeUserModel },
  { userType: "platform", model: () => PlatformUserModel },
];

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Other records this email owns, outside the one being changed.
 *
 * Cross-tenant on purpose, and that is the whole point: the record that breaks
 * a reset is by definition the one in a company the admin cannot see. A scoped
 * query would return nothing and the warning would never fire — which is
 * precisely how this went unnoticed.
 *
 * Returns `[{ _id, userType, tenantId, companyName, name }]`, newest last.
 * Never throws: a warning that fails must not fail the reset it was warning
 * about, because the reset itself is still a correct and useful thing to have
 * done.
 */
export async function otherAccountsForEmail(email, excludeId) {
  try {
    const normalized = String(email || "").trim();
    if (!normalized) return [];
    await connect();

    const rx = new RegExp(`^${escapeRegex(normalized)}$`, "i");
    const skip = excludeId ? String(excludeId) : null;

    return await escapeTenant(
      "password reset: is this email shared with another company",
      async () => {
        const found = [];
        for (const source of SOURCES) {
          const rows = await source
            .model()
            .find({ email: rx, delete: { $ne: true }, isDeleted: { $ne: true } })
            .select("_id name firstName lastName tenantId")
            .lean();

          for (const row of rows) {
            if (skip && String(row._id) === skip) continue;
            found.push({
              _id: String(row._id),
              userType: source.userType,
              tenantId: row.tenantId ? String(row.tenantId) : null,
              name:
                row.name ||
                `${row.firstName || ""} ${row.lastName || ""}`.trim() ||
                "unnamed",
            });
          }
        }

        // The company name, because "another account exists" is not actionable
        // and "there is also an account at Creative Design & Construction" is.
        const tenantIds = [...new Set(found.map((f) => f.tenantId).filter(Boolean))];
        if (tenantIds.length) {
          const mongoose = (await import("mongoose")).default;
          const companies = await mongoose.connection.db
            .collection("companies")
            .find({ _id: { $in: tenantIds.map((id) => new mongoose.Types.ObjectId(id)) } })
            .project({ name: 1 })
            .toArray();
          const byId = new Map(companies.map((c) => [String(c._id), c.name]));
          for (const f of found) f.companyName = byId.get(f.tenantId) || null;
        }

        return found;
      },
    );
  } catch (error) {
    console.log("Could not check for duplicate accounts:", error?.message);
    return [];
  }
}

/**
 * The sentence to append to a reset that may not take effect.
 *
 * Returns "" when there is nothing to say, so callers can concatenate without
 * branching. Deliberately blunt: the admin has just been told the password was
 * reset, and if sign-in is going to check a different record then that message
 * on its own is misleading.
 *
 * IT NAMES THE TOOL THAT DOES WORK, because "there is a duplicate" is a
 * diagnosis and not a fix, and the obvious reading of it — delete the other
 * record — is wrong whenever the person genuinely works for both companies,
 * which is a thing that happens and is supported (linkCompaniesForEmail in
 * authServer.js links the companies so the switcher can move between them).
 *
 * "Forgot password" is the answer in both cases. resetPasswordWithToken writes
 * the new password to EVERY record the address owns, which an administrator's
 * reset deliberately cannot do — and it is allowed to, because the person
 * following a link sent to their own email owns all of those records, while a
 * super admin of one company does not.
 */
export function duplicateAccountWarning(others) {
  if (!others?.length) return "";
  const where = others
    .map((o) => o.companyName || "another company")
    .filter((name, i, all) => all.indexOf(name) === i);
  return (
    ` ⚠ This email also has an account at ${where.join(" and ")}, with its own ` +
    `password, and sign-in may check that one instead — so this reset may not ` +
    `let them in. Ask them to use "Forgot password" on the sign-in page: that ` +
    `sets one password across all their company records, which a reset from ` +
    `here cannot do.`
  );
}

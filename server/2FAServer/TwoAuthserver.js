"use server";
import { authenticator } from "otplib";
import qrcode from "qrcode";
import crypto from "node:crypto";
import { getServerSideProps } from "../session/session";
import TwoFAMoldel from "@/models/2FAmodel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { createObjectId } from "@/lib/mongodb";
import { connect } from "@/db/db";
import { logAuditDirect, withAudit, recordAudit } from "@/lib/audit";
import { clearLockByEmail } from "@/lib/rateLimit";
import { PLATFORM_APP_NAME } from "@/lib/tenant";

// --- Backup / recovery codes -------------------------------------------------
// The escape hatch for "the authenticator app is gone". Every admin, super admin
// and platform admin is *required* to use 2FA (see the signIn callback in
// auth.js), so without a second factor they can satisfy, a lost phone locks them
// out of the product permanently.

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 10; // 10 chars from a 32-symbol alphabet = 50 bits
// Crockford-style alphabet: no I, O, 0 or 1, so codes survive being written down
// and read back by a person under pressure.
const BACKUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateBackupCode() {
  const bytes = crypto.randomBytes(BACKUP_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < BACKUP_CODE_LENGTH; i++) {
    code += BACKUP_CODE_ALPHABET[bytes[i] % BACKUP_CODE_ALPHABET.length];
  }
  // Grouped for readability: ABCDE-FGHJK
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

// Codes are high-entropy random values, so a plain SHA-256 is enough — bcrypt's
// work factor only buys anything against guessable secrets, and here it would
// mean ten slow comparisons on every recovery attempt.
function hashBackupCode(code) {
  const normalized = String(code || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/** A fresh set of codes, replacing any previous set. Returns plaintext + hashes. */
function buildBackupCodes() {
  const plain = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);
  const hashed = plain.map((code) => ({
    codeHash: hashBackupCode(code),
    usedAt: null,
  }));
  return { plain, hashed };
}

/**
 * Record that this account cleared a second-factor challenge, just now.
 *
 * `auth.js` will not lift a session's 2FA gate without this stamp
 * (hasRecentTwoFactorVerification), so *every* path that counts as passing the
 * challenge has to write it — a recovery code included. Miss it and the user is
 * told their code was accepted and then bounced straight back to /verify.
 */
async function stampVerification(twoFAId) {
  await TwoFAMoldel.updateOne(
    { _id: twoFAId },
    { $set: { lastVerifiedAt: new Date() } }
  );
}

export async function existEmployee() {
  try {
    const { props } = await getServerSideProps();
    const { _id: employeeId, email } = props?.session?.user;
    if (!email) return { success: false, message: "User not authenticated" };

    const existEmployee = await TwoFAMoldel.findOne({ employeeId });
    const result = existEmployee ? { data: existEmployee } : {};
    return { success: true, ...result, email, employeeId };
  } catch (error) {
    return { success: false, message: "Something went wrong" };
  }
}

async function generate2FA({ user, service = PLATFORM_APP_NAME, secret }) {
  try {
    const otpauth = authenticator.keyuri(user, service, secret);
    const qrCodeUrl = await qrcode.toDataURL(otpauth);
    return qrCodeUrl;
  } catch (error) {
    return;
  }
}

export async function check2FA() {
  try {
    const employee = await existEmployee();
    if (!employee.success) return employee;
    if (employee.data) {
      const { isEnabled, backupCodes } = employee.data;
      const backupCodesRemaining = (backupCodes || []).filter(
        (c) => !c.usedAt
      ).length;
      return {
        success: true,
        data: JSON.stringify({ isEnabled, backupCodesRemaining }),
      };
    } else {
      return {
        success: false,
        data: JSON.stringify({ isEnabled: false, backupCodesRemaining: 0 }),
      };
    }

    // Generate a secret key for the user
  } catch (error) {
    console.error("Error generating 2FA:", error);
    return { success: false, message: "Error generating 2FA" };
  }
}

export async function verify2FA(code, secret) {
  const isValid = authenticator.check(code, secret);
  return {
    success: isValid,
    message: isValid ? "Code is valid" : "Invalid verification code",
  };
}

export async function enable2FA(code, secret) {
  try {
    const { props } = await getServerSideProps();
    const { email, _id: employeeId } = props?.session?.user || {};
    if (!email) {
      return { success: false, message: "User not authenticated" };
    }
    // Logic to enable 2FA for the user
    if (!code) {
      return { success: false, message: "Code is required" };
    }
    // Verify the code
    const isValid = await verify2FA(code, secret);
    if (!isValid.success) return isValid;

    await connect();
    const id = createObjectId(employeeId);
    const existEmployee = await TwoFAMoldel.findOne({ employeeId: id });

    if (existEmployee?.isEnabled) {
      return { success: false, message: "Your 2FA is already enabled" };
    }

    // Enrolling always mints a fresh set of recovery codes. This is the only
    // moment they exist in plaintext — they are returned to be shown once and
    // never stored unhashed.
    const { plain, hashed } = buildBackupCodes();

    await TwoFAMoldel.updateOne(
      { employeeId: id },
      {
        $set: {
          employeeId: id,
          secret,
          isEnabled: true,
          isVerified: true,
          qrCodeUrl: "",
          backupCodes: hashed,
          backupCodesGeneratedAt: new Date(),
          // Enrolment required a live code, so it counts as passing the
          // challenge — otherwise the forced-setup flow would enrol and then
          // immediately demand a verification the user has just done.
          lastVerifiedAt: new Date(),
        },
      },
      { upsert: true }
    );

    await logAuditDirect({
      actor: props?.session?.user,
      action: "TwoFactor.enable",
      module: "Security",
      entityId: employeeId,
      description: `Two-factor authentication enabled and ${plain.length} recovery codes issued`,
    });

    return {
      success: true,
      message: "Your 2FA is enabled.",
      backupCodes: plain,
    };
  } catch (error) {
    console.error("Error enabling 2FA:", error);
    return { success: false, message: "Error enabling 2FA" };
  }
}

export async function disable2FA(employeeId, check) {
  try {
    // Turning 2FA off retires the recovery codes with it, so a code printed
    // under the old enrolment can never unlock a later one.
    const update = check
      ? { $set: { isEnabled: true } }
      : {
          $set: { isEnabled: false, backupCodes: [] },
          $unset: { backupCodesGeneratedAt: "" },
        };

    await TwoFAMoldel.updateOne({ employeeId }, update);
    return { success: true, message: "2FA disabled successfully" };
  } catch (error) {
    console.error("Error disabling 2FA:", error);
    return { success: false, message: "Error disabling 2FA" };
  }
}

export async function onEnableChange(check) {
  try {
    const employee = await existEmployee();
    if (!employee.success) return employee;
    if (!check) {
      if (!employee.data) {
        return { success: false, message: "2FA not configured" };
      }
      await disable2FA(employee.employeeId, check);
      return { success: true, message: "2FA disabled successfully" };
    }

    // Enabling Flow
    const user = employee.email;
    const service = PLATFORM_APP_NAME;
    const secret = employee.data?.secret || authenticator.generateSecret();
    const qrCodeUrl = await generate2FA({ user, service, secret });
    if (!employee.data) {
      return {
        success: true,
        data: JSON.stringify({
          qrCodeUrl,
          isEnabled: false,
          isVerified: false,
          secret,
        }),
      };
    }
    return {
      success: true,
      data: JSON.stringify({
        qrCodeUrl,
        isEnabled: employee.data?.isEnabled,
        isVerified: employee.data?.isVerified,
        secret,
      }),
    };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Something Wrong" };
  }
}

export async function checkUserHas2FA() {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    if (!employeeId)
      return { success: false, message: "User not authenticated" };
    await connect();
    const existEmployee = await TwoFAMoldel.findOne({ employeeId });
    if (existEmployee && existEmployee.isEnabled) return true;
    return false;
  } catch (error) {
    console.log(error);
    return false;
  }
}

export async function check2FAEnabled(employeeId) {
  try {
    await connect();
    const exist = await TwoFAMoldel.findOne({ employeeId });
    if (exist && exist.isEnabled) return true;
    return false;
  } catch (error) {
    console.error("Error checking 2FA enabled:", error);
    return false;
  }
}

/**
 * Whether this account passed a TOTP challenge in the last few minutes.
 *
 * The evidence auth.js needs before it will clear a session's 2FA gate. The
 * window only has to cover the moment between the code being accepted and the
 * session being updated.
 */
export async function hasRecentTwoFactorVerification(employeeId, maxAgeMs = 5 * 60 * 1000) {
  try {
    await connect();
    const exist = await TwoFAMoldel.findOne({ employeeId }).lean();
    if (!exist?.lastVerifiedAt) return false;
    return Date.now() - new Date(exist.lastVerifiedAt).getTime() <= maxAgeMs;
  } catch (error) {
    console.error("Error checking recent 2FA verification:", error);
    return false;
  }
}

export async function verify2FAWithDB(code) {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    if (!employeeId)
      return { success: false, message: "User not authenticated" };
    await connect();

    const exist = await TwoFAMoldel.findOne({ employeeId });
    if (!exist) return { success: false, message: "2FA not enabled" };
    const isValid = await verify2FA(code, exist.secret);

    if (isValid.success) {
      // Record that a code was actually accepted. auth.js checks this stamp
      // before clearing the login's 2FA gate — without it, the gate could be
      // lifted by a client simply claiming to have verified.
      await stampVerification(exist._id);
      return isValid;
    }

    // Previously fell through and returned undefined on a wrong code.
    return { success: false, message: "Invalid verification code" };
  } catch (error) {
    console.error("Error verifying 2FA with DB:", error);
    return { success: false, message: "Error verifying 2FA" };
  }
}

/**
 * Spend one recovery code, in place of the authenticator app.
 *
 * Each code works exactly once: the matching entry is stamped used in the *same*
 * query that matches it, so a replayed code — or two attempts racing each other
 * — cannot both succeed. `modifiedCount` is therefore the authority on whether
 * the code was good, not a separate read.
 *
 * Stamps the verification like verify2FAWithDB does. That is the difference
 * between this working and appearing to work: auth.js will not clear the 2FA
 * gate without a recent stamp, so without it the user is told their code was
 * accepted and then sent back to /verify.
 */
export async function verifyBackupCode(code) {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user;
    const employeeId = user?._id;
    if (!employeeId)
      return { success: false, message: "User not authenticated" };

    const normalized = String(code || "").replace(/[^a-zA-Z0-9]/g, "");
    if (normalized.length !== BACKUP_CODE_LENGTH) {
      return { success: false, message: "Invalid recovery code" };
    }

    await connect();
    const codeHash = hashBackupCode(normalized);
    const id = createObjectId(employeeId);

    const result = await TwoFAMoldel.updateOne(
      {
        employeeId: id,
        isEnabled: true,
        backupCodes: { $elemMatch: { codeHash, usedAt: null } },
      },
      {
        $set: {
          "backupCodes.$.usedAt": new Date(),
          lastVerifiedAt: new Date(),
        },
      }
    );

    if (!result?.modifiedCount) {
      return {
        success: false,
        message: "Invalid or already used recovery code",
      };
    }

    const exist = await TwoFAMoldel.findOne({ employeeId: id }).lean();
    const remaining = (exist?.backupCodes || []).filter((c) => !c.usedAt).length;

    await logAuditDirect({
      actor: user,
      action: "TwoFactor.backupCodeUsed",
      module: "Security",
      entityId: employeeId,
      description: `Signed in with a recovery code; ${remaining} code(s) remaining`,
    });

    return { success: true, message: "Recovery code accepted", remaining };
  } catch (error) {
    console.error("Error verifying backup code:", error);
    return { success: false, message: "Could not verify recovery code" };
  }
}

/**
 * Issue a new set of recovery codes, invalidating every previous one.
 *
 * Requires a live authenticator code: an unattended session must not be able to
 * quietly mint itself a fresh way back in.
 */
export async function regenerateBackupCodes(code) {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user || {};
    const employeeId = user._id;
    if (!employeeId) {
      return { success: false, message: "User not authenticated" };
    }
    if (!/^\d{6}$/.test(String(code || ""))) {
      return { success: false, message: "Enter the 6-digit code from your app" };
    }

    await connect();
    const id = createObjectId(employeeId);
    const exist = await TwoFAMoldel.findOne({ employeeId: id });
    if (!exist || !exist.isEnabled) {
      return { success: false, message: "2FA is not enabled" };
    }

    const isValid = await verify2FA(code, exist.secret);
    if (!isValid.success) {
      return { success: false, message: "Invalid verification code" };
    }

    const { plain, hashed } = buildBackupCodes();
    await TwoFAMoldel.updateOne(
      { employeeId: id },
      { $set: { backupCodes: hashed, backupCodesGeneratedAt: new Date() } }
    );

    await logAuditDirect({
      actor: user,
      action: "TwoFactor.regenerateBackupCodes",
      module: "Security",
      entityId: employeeId,
      description: `Recovery codes regenerated; ${plain.length} new codes issued and all previous codes invalidated`,
    });

    return {
      success: true,
      message: "New recovery codes generated",
      backupCodes: plain,
    };
  } catch (error) {
    console.error("Error regenerating backup codes:", error);
    return { success: false, message: "Could not generate recovery codes" };
  }
}

/** How many unused recovery codes the signed-in user has left. */
export async function getBackupCodeStatus() {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    if (!employeeId)
      return { success: false, message: "User not authenticated" };

    await connect();
    const exist = await TwoFAMoldel.findOne({ employeeId }).lean();
    const remaining = (exist?.backupCodes || []).filter((c) => !c.usedAt).length;
    return {
      success: true,
      data: JSON.stringify({
        remaining,
        total: exist?.backupCodes?.length || 0,
        generatedAt: exist?.backupCodesGeneratedAt || null,
      }),
    };
  } catch (error) {
    console.error("Error reading backup code status:", error);
    return { success: false, message: "Could not read recovery code status" };
  }
}

/**
 * Super-admin escape hatch for someone who can satisfy neither their
 * authenticator app nor a recovery code — the "phone was wiped, codes were never
 * saved" lockout.
 *
 * The enrolment record is deleted outright rather than disabled, so the next
 * login cannot fall back to the old shared secret: if the reset was prompted by
 * a compromise, that secret has to die with it.
 *
 * Afterwards the target's next login sees no 2FA on the account, and because the
 * privileged-role rule in the signIn callback then sets mustSetup2FA, they are
 * marched straight to /setup-2fa to re-enrol and handed a fresh set of codes
 * before they can reach anything else.
 *
 * Scoped by the tenant plugin, not by hand: OfficeEmployeeModel is
 * tenant-scoped, so a super admin can only ever find — and therefore only ever
 * reset — an employee of their own company. TwoFA is a global model, which is
 * why the enrolment lookup here is keyed on the employee id alone.
 *
 * NOTE: this covers office employees only. A platformAdmin lives in a separate
 * collection outside every tenant and has no one above them, so their lockout
 * needs the offline break-glass script instead (see FEATURE plan step 5).
 */
export const resetTwoFactorForEmployee = withAudit(
  "TwoFactor.reset",
  async ({ employeeId, reason } = {}) => {
    const { props } = await getServerSideProps();
    const actor = props?.session?.user;

    if (actor?.role !== "superAdmin") {
      return {
        success: false,
        message: "Only a super admin can reset two-factor authentication",
      };
    }
    if (!employeeId) return { success: false, message: "Employee is required" };
    if (!reason || !String(reason).trim()) {
      return { success: false, message: "A reason for the reset is required" };
    }

    try {
      await connect();
      const employee = await OfficeEmployeeModel.findById(employeeId).exec();
      if (!employee) return { success: false, message: "Employee not found" };

      // Resetting your own 2FA here would leave you running without it until
      // your next login, since the enrolment requirement is only evaluated at
      // sign-in. Re-enrol from Account settings instead, which re-checks
      // immediately.
      if (String(employee._id) === String(actor?._id)) {
        return {
          success: false,
          message:
            "Use Account settings to re-enrol your own 2FA, not the reset action",
        };
      }

      const existing = await TwoFAMoldel.findOne({
        employeeId: createObjectId(employeeId),
      });
      if (!existing) {
        return {
          success: false,
          message: "This account has no two-factor enrolment to reset",
        };
      }

      const unusedCodes = (existing.backupCodes || []).filter(
        (c) => !c.usedAt
      ).length;

      await TwoFAMoldel.deleteOne({ employeeId: createObjectId(employeeId) });

      // A locked-out user has usually burned through failed logins too, so lift
      // any rate-limit lockout in the same move — otherwise the reset appears
      // not to have worked.
      await clearLockByEmail(employee.email);

      const targetName = employee.name || employee.firstName || "employee";
      // withAudit captures who did it; this records for-whom and why. The shared
      // secret is never included — it is gone.
      recordAudit({
        entityId: employeeId,
        module: "Security",
        description: `Two-factor authentication reset by ${
          actor?.name || actor?.email
        } for ${targetName} <${employee.email}>. Reason: ${String(
          reason
        ).trim()}`,
        before: {
          twoFactorEnabled: existing.isEnabled,
          unusedRecoveryCodes: unusedCodes,
        },
        after: {
          target: {
            id: String(employeeId),
            name: targetName,
            email: employee.email,
          },
          twoFactorEnabled: false,
          unusedRecoveryCodes: 0,
          reason: String(reason).trim(),
          loginLockCleared: true,
        },
      });

      return {
        success: true,
        message: `2FA reset for ${targetName}. They will be asked to set it up again at their next login.`,
      };
    } catch (error) {
      console.log("Error in resetTwoFactorForEmployee:", error);
      return { success: false, message: "Error resetting two-factor auth" };
    }
  },
  { module: "Security" }
);

"use server";
import { authenticator } from "otplib";
import qrcode from "qrcode";
import crypto from "node:crypto";
import { getServerSideProps } from "../session/session";
import TwoFAMoldel from "@/models/2FAmodel";
import { createObjectId } from "@/lib/mongodb";
import { connect } from "@/db/db";
import { logAuditDirect, withAudit, recordAudit } from "@/lib/audit";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { clearLockByEmail } from "@/lib/rateLimit";

// --- Backup / recovery codes -------------------------------------------------
// These are the escape hatch for the "authenticator app was uninstalled" case:
// without them, an admin who loses the app can never satisfy the 2FA gate and
// is locked out of the product entirely.

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 10; // 10 chars from a 32-symbol alphabet = 50 bits
// Crockford-style alphabet: no I, O, 0 or 1, so codes survive being written down.
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

/** Create a fresh set of codes, replacing any previous set. Returns plaintext. */
function buildBackupCodes() {
  const plain = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);
  const hashed = plain.map((code) => ({
    codeHash: hashBackupCode(code),
    usedAt: null,
  }));
  return { plain, hashed };
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

async function generate2FA({ user, service = "HR Management", secret }) {
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

    // Enabling always mints a fresh set of recovery codes: they are shown to the
    // user exactly once here, which is the only point at which we hold them in
    // plaintext.
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

/**
 * Issue a new set of recovery codes, invalidating every previous one. Requires a
 * live authenticator code so that an unattended session cannot silently mint
 * itself a new way in.
 */
export async function regenerateBackupCodes(code) {
  try {
    const { props } = await getServerSideProps();
    const { _id: employeeId } = props?.session?.user || {};
    if (!employeeId) {
      return { success: false, message: "User not authenticated" };
    }
    if (!/^\d{6}$/.test(String(code || ""))) {
      return { success: false, message: "Enter the 6-digit code from your app" };
    }

    await connect();
    const exist = await TwoFAMoldel.findOne({
      employeeId: createObjectId(employeeId),
    });
    if (!exist || !exist.isEnabled) {
      return { success: false, message: "2FA is not enabled" };
    }

    const isValid = await verify2FA(code, exist.secret);
    if (!isValid.success) {
      return { success: false, message: "Invalid verification code" };
    }

    const { plain, hashed } = buildBackupCodes();
    await TwoFAMoldel.updateOne(
      { employeeId: createObjectId(employeeId) },
      { $set: { backupCodes: hashed, backupCodesGeneratedAt: new Date() } }
    );

    await logAuditDirect({
      actor: props?.session?.user,
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
    const exist = await TwoFAMoldel.findOne({ employeeId });
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
 * Spend one recovery code. Each code works exactly once — the matching entry is
 * stamped as used in the same query that matches it, so a replay of the same
 * code (or two parallel attempts) cannot both succeed.
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

    const result = await TwoFAMoldel.updateOne(
      {
        employeeId: createObjectId(employeeId),
        isEnabled: true,
        backupCodes: { $elemMatch: { codeHash, usedAt: null } },
      },
      { $set: { "backupCodes.$.usedAt": new Date() } }
    );

    if (!result?.modifiedCount) {
      return { success: false, message: "Invalid or already used recovery code" };
    }

    const exist = await TwoFAMoldel.findOne({
      employeeId: createObjectId(employeeId),
    });
    const remaining = (exist?.backupCodes || []).filter((c) => !c.usedAt).length;

    await logAuditDirect({
      actor: user,
      action: "TwoFactor.backupCodeUsed",
      module: "Security",
      entityId: employeeId,
      description: `Signed in with a recovery code; ${remaining} code(s) remaining`,
    });

    return {
      success: true,
      message: "Recovery code accepted",
      remaining,
    };
  } catch (error) {
    console.error("Error verifying backup code:", error);
    return { success: false, message: "Could not verify recovery code" };
  }
}

/**
 * Super-admin escape hatch for a user who can satisfy neither their authenticator
 * app nor a recovery code — the classic "phone was wiped, codes were never
 * saved" lockout. The enrolment record is deleted outright rather than just
 * disabled, so the next login cannot fall back to the old shared secret: if the
 * reset was prompted by a compromise, that secret has to die with it.
 *
 * After this, the target's next login sees no 2FA on the account. Because the
 * privileged-role rule in the signIn callback then sets mustSetup2FA, they are
 * marched straight to /setup-2fa to re-enrol and are handed a fresh set of
 * recovery codes before they can reach anything else.
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
      // not to work.
      await clearLockByEmail(employee.email);

      const targetName = employee.name || employee.firstName || "employee";
      // withAudit captures who; here we record for-whom and why. The secret is
      // never included — logAuditDirect/withAudit redact it, but it is gone.
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

export async function disable2FA(employeeId, check) {
  try {
    // Turning 2FA off retires the recovery codes with it, so a code printed
    // under the old enrolment can never unlock a later one.
    const update = check
      ? { $set: { isEnabled: true } }
      : { $set: { isEnabled: false, backupCodes: [] }, $unset: { backupCodesGeneratedAt: "" } };

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
    const service = "HR Management"; // Replace with actual service name
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

export async function verify2FAWithDB(code) {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    if (!employeeId)
      return { success: false, message: "User not authenticated" };
    await connect();

    const exist = await TwoFAMoldel.findOne({ employeeId });
    if (!exist) return { success: false, message: "2FA not enabled" };
    return await verify2FA(code, exist.secret);
  } catch (error) {
    console.error("Error verifying 2FA with DB:", error);
    return { success: false, message: "Error verifying 2FA" };
  }
}

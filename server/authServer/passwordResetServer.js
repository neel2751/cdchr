"use server";
import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";
import OfficeUserModel from "@/models/officeModel";
import PlatformUserModel from "@/models/platformUserModel";
import PasswordResetTokenModel from "@/models/passwordResetTokenModel";
import { originForHost, platformApexHost } from "@/lib/tenantHost";
import { hashPassword } from "@/utils/bcrypt";
import { sendTenantMail, resolveTenantAppUrl } from "../email/tenantMail";
import { emailButton } from "@/lib/emailTemplate";
import { clearLockByEmail } from "@/lib/rateLimit";
import { logAuditDirect } from "@/lib/audit";
import { escapeTenant } from "@/lib/tenantContext";
import {
  RESET_TTL_MIN,
  hashToken,
  issuePasswordToken,
  passwordLink,
} from "./passwordInvite";

const TOKEN_TTL_MIN = RESET_TTL_MIN;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every account answering to one email address.
 *
 * CROSS-TENANT BY NECESSITY, and this is why the whole flow was dead. The
 * three employee collections are tenant-scoped, and under
 * TENANT_ENFORCEMENT=enforce a query with no tenant in context throws. Nobody
 * is signed in when they press "Forgot password", so there was no tenant, so
 * the lookup threw, so the catch below returned the reassuring generic
 * message — and no link was ever generated for anybody. Same position as the
 * login lookup in authServer.js, which escapes the scope for the same reason:
 * working out which company the account belongs to is the point of the query.
 *
 * ALL the matches, not the first. One email can now be an employee of several
 * companies on purpose, with a separate record in each (see
 * linkCompaniesForEmail), and each record carries its own password field.
 * Login checks the first record deterministically, so resetting one record and
 * leaving the others would set a password that the next sign-in might not be
 * the one to check — the symptom being a reset that "did not work".
 *
 * Office, site, reception, then platform — the same order as ACCOUNT_SOURCES
 * in authServer.js, so the record this flow treats as primary is the one login
 * will actually check.
 *
 * PLATFORM ADMINS ARE INCLUDED, and were not. They are the one kind of account
 * with nobody above them: there is no administrator who can reset them, and a
 * deployment usually has exactly one. Leaving them out of the only
 * self-service recovery there is meant a lost platform password could be fixed
 * only by editing the database.
 */
const ACCOUNT_SOURCES = [
  { type: "office", model: () => OfficeEmployeeModel },
  { type: "site", model: () => EmployeModel },
  { type: "reception", model: () => OfficeUserModel },
  { type: "platform", model: () => PlatformUserModel },
];

/** The collection a token's userType refers to. */
function modelForType(type) {
  return (
    ACCOUNT_SOURCES.find((s) => s.type === type)?.model() ||
    OfficeEmployeeModel
  );
}

async function findAccountsByEmail(email) {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return [];
  const rx = new RegExp(`^${escapeRegex(normalized)}$`, "i");
  const query = { email: rx, delete: { $ne: true } };

  return escapeTenant("password reset: find the account by email", async () => {
    const found = [];
    for (const source of ACCOUNT_SOURCES) {
      const rows = await source.model().find(query).sort({ createdAt: 1 });
      for (const user of rows) found.push({ user, type: source.type });
    }
    return found;
  });
}

/**
 * Starts the forgot-password flow: emails a single-use, 30-minute reset link.
 * Always returns a generic message so the endpoint cannot be used to discover
 * which emails have accounts (no user enumeration).
 */
export async function requestPasswordReset(email) {
  const generic = {
    success: true,
    message: "If an account exists for that email, a reset link has been sent.",
  };
  try {
    if (!email || !String(email).trim()) {
      return { success: false, message: "Email is required" };
    }
    await connect();
    const accounts = await findAccountsByEmail(email);
    if (!accounts.length) return generic;

    // The first, which is the record login checks. Setting the password
    // applies to every record for this address — see resetPasswordWithToken.
    const { user, type } = accounts[0];

    const rawToken = await issuePasswordToken({
      userId: user._id,
      userType: type,
      email: user.email,
      ttlMs: TOKEN_TTL_MIN * 60 * 1000,
    });

    // The link must point at the user's own company, not at one fixed host —
    // and a platform admin has no company, so theirs points at the platform's
    // own host. Without this their link would be built from
    // NEXT_PUBLIC_WEB_URL, which on a multi-tenant deployment is somebody
    // else's workspace.
    const tenantId = user.tenantId ? String(user.tenantId) : null;
    const baseUrl =
      type === "platform"
        ? originForHost(platformApexHost()) ||
          process.env.NEXT_PUBLIC_WEB_URL ||
          ""
        : await resolveTenantAppUrl(tenantId);
    const link = passwordLink({ baseUrl, userId: user._id, token: rawToken });
    const name = user.name || user.firstName || "there";
    const html = `
        <p>Hi ${name},</p>
        <p>We received a request to reset your password. Choose a new one with
        the button below. The link is valid for ${TOKEN_TTL_MIN} minutes and can
        be used once.</p>
        ${emailButton("Reset password", link)}
        <p>If the button does not work, copy and paste this link:</p>
        <p style="word-break:break-all;color:#4f46e5">${link}</p>
        <p>If you did not request this, you can safely ignore this email — your
        password will not change.</p>`;

    // Through the company's own sender if it has configured one, and through
    // the platform's otherwise — resolveAccount() falls back to a
    // platform-level account and then to the EMAIL_* environment, precisely so
    // that a company whose admin has set up no mailbox can still get password
    // resets. A reset the customer cannot send is a customer locked out of
    // their own workspace with nobody able to let them back in.
    const sent = await sendTenantMail({
      tenantId,
      feature: "All",
      to: user.email,
      subject: "Reset your password",
      heading: "Password reset",
      html,
    });

    // Logged, not returned: the reply stays generic whatever happens, because
    // a different answer for "sent" and "not sent" tells an attacker which
    // addresses have accounts. But a failure that leaves no trace at all is
    // how this flow stayed broken — the token is written and the message is
    // silently lost, and nothing anywhere says so.
    if (!sent?.success) {
      console.log(
        `Password reset email for ${user.email} was not sent:`,
        sent?.message,
      );
    }

    return generic;
  } catch (error) {
    console.log("requestPasswordReset error:", error?.message);
    return generic;
  }
}

/**
 * Completes the forgot-password flow: validates the token (exists, unused,
 * unexpired, hash matches), sets the new password, consumes the token and
 * clears any active lockout. Records an audit entry.
 */
export async function resetPasswordWithToken({ uid, token, newPassword } = {}) {
  try {
    if (!uid || !token) {
      return { success: false, message: "Invalid reset link" };
    }
    if (!newPassword || String(newPassword).length < 8) {
      return {
        success: false,
        message: "Password must be at least 8 characters",
      };
    }
    await connect();

    const record = await PasswordResetTokenModel.findOne({
      userId: uid,
      usedAt: null,
    }).sort({ createdAt: -1 });

    if (!record || new Date(record.expiresAt) < new Date()) {
      return {
        success: false,
        message: "Reset link is invalid or has expired",
      };
    }
    if (record.tokenHash !== hashToken(token)) {
      return {
        success: false,
        message: "Reset link is invalid or has expired",
      };
    }

    const Model = modelForType(record.userType);

    // Outside the tenant scope, like the lookup that sent the link: whoever is
    // following it is not signed in, so there is no tenant, and under
    // enforcement a scoped read here threw — the link worked right up to the
    // moment somebody typed a new password, and then said "Error resetting
    // password".
    const user = await escapeTenant("password reset: load the account", () =>
      Model.findById(uid),
    );
    if (!user) return { success: false, message: "Account not found" };

    const hashed = await hashPassword(String(newPassword));
    if (!hashed) {
      return { success: false, message: "Failed to secure the new password" };
    }

    // Every record this address owns, not just the one the link named.
    //
    // One person can be an employee of several companies, with a separate
    // record and a separate password field in each. Login checks whichever
    // record sorts first, so setting the password on one and leaving the
    // others is a reset that appears to do nothing: the new password is real,
    // and the record being checked still holds the old one.
    //
    // `mustChangePassword` is cleared in the same write. The flag exists to
    // trap somebody on the change-password screen until they have chosen their
    // own password, and they have just done exactly that.
    const siblings = await findAccountsByEmail(user.email);
    const targets = siblings.length ? siblings : [{ user, type: record.userType }];

    let updated = 0;
    for (const target of targets) {
      target.user.password = hashed;
      if (target.user.schema?.path("mustChangePassword")) {
        target.user.mustChangePassword = false;
      }
      await escapeTenant("password reset: set the password", () =>
        target.user.save(),
      );
      updated += 1;
    }

    record.usedAt = new Date();
    await record.save();

    await clearLockByEmail(user.email);

    await logAuditDirect({
      actor: {
        _id: String(uid),
        name: user.name || user.firstName || "User",
        email: user.email,
        role: record.userType,
      },
      action: "Password.resetSelf",
      module: "Account",
      entityId: uid,
      description:
        `Self-service password reset via email link for ${user.email}` +
        (updated > 1 ? ` (${updated} company records)` : ""),
      after: {
        target: user.email,
        method: "forgot-password-email",
        recordsUpdated: updated,
      },
    });

    return {
      success: true,
      message: "Password reset successfully. You can now sign in.",
    };
  } catch (error) {
    console.log("resetPasswordWithToken error:", error?.message);
    return { success: false, message: "Error resetting password" };
  }
}

"use server";
import crypto from "crypto";
import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";
import OfficeUserModel from "@/models/officeModel";
import PasswordResetTokenModel from "@/models/passwordResetTokenModel";
import { hashPassword } from "@/utils/bcrypt";
import { sendTenantMail, resolveTenantAppUrl } from "../email/tenantMail";
import { emailButton } from "@/lib/emailTemplate";
import { clearLockByEmail } from "@/lib/rateLimit";
import { logAuditDirect } from "@/lib/audit";

const TOKEN_TTL_MIN = 30;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findUserByEmail(email) {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return null;
  const rx = new RegExp(`^${escapeRegex(normalized)}$`, "i");

  let user = await OfficeEmployeeModel.findOne({
    email: rx,
    delete: { $ne: true },
  });
  if (user) return { user, type: "office" };

  user = await EmployeModel.findOne({ email: rx, delete: { $ne: true } });
  if (user) return { user, type: "site" };

  user = await OfficeUserModel.findOne({ email: rx, delete: { $ne: true } });
  if (user) return { user, type: "reception" };

  return null;
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
    const found = await findUserByEmail(email);
    if (!found) return generic;

    const { user, type } = found;

    // Invalidate any previous outstanding tokens for this account.
    await PasswordResetTokenModel.deleteMany({
      userId: user._id,
      usedAt: null,
    });

    const rawToken = crypto.randomBytes(32).toString("hex");
    await PasswordResetTokenModel.create({
      userId: user._id,
      userType: type,
      email: user.email,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MIN * 60 * 1000),
    });

    // The link must point at the user's own company, not at one fixed host.
    const tenantId = user.tenantId ? String(user.tenantId) : null;
    const baseUrl = await resolveTenantAppUrl(tenantId);
    const link = `${baseUrl}/reset-password?uid=${user._id}&token=${rawToken}`;
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

    await sendTenantMail({
      tenantId,
      feature: "All",
      to: user.email,
      subject: "Reset your password",
      heading: "Password reset",
      html,
    });

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

    const Model =
      record.userType === "site"
        ? EmployeModel
        : record.userType === "reception"
          ? OfficeUserModel
          : OfficeEmployeeModel;

    const user = await Model.findById(uid);
    if (!user) return { success: false, message: "Account not found" };

    const hashed = await hashPassword(String(newPassword));
    if (!hashed) {
      return { success: false, message: "Failed to secure the new password" };
    }
    user.password = hashed;
    await user.save();

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
      description: `Self-service password reset via email link for ${user.email}`,
      after: { target: user.email, method: "forgot-password-email" },
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

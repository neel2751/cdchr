/**
 * NOT a "use server" module, deliberately.
 *
 * Every export of a "use server" module is a public HTTP endpoint. These
 * functions mint a password-setting token and email a link to whatever address
 * they are given — as actions, an anonymous request could post somebody's id
 * and have a working link to their account sent wherever it liked. They have
 * no caller to authorise because they have no caller but other server code:
 * the employee forms, which authorise their own.
 *
 * Nothing imports this from the client. Do not add the directive.
 */
import crypto from "node:crypto";

import { connect } from "@/db/db";
import PasswordResetTokenModel from "@/models/passwordResetTokenModel";
import { emailButton } from "@/lib/emailTemplate";
import { resolveTenantAppUrl, sendTenantMail } from "../email/tenantMail";

/**
 * Letting a new employee choose their own password.
 *
 * WHAT THIS REPLACES. Both employee forms created the account with one
 * hardcoded password — "Cdc@1234" for office staff, "Interior@1234" for site —
 * and then emailed a welcome message that named no password at all. So the
 * employee had nothing to sign in with, and the company had a password that is
 * the same for every member of staff and written in this repository. The CSV
 * importer already refused to do that (see randomPassword in
 * migrationServer.js, which calls it "a company-wide open door"); the forms
 * are now consistent with it.
 *
 * So the account is created with a password nobody knows, and the welcome
 * email carries a link that lets its owner set one. Nothing to hand over, no
 * shared starting password, and no employee waiting on an administrator to
 * read them a string over the phone.
 *
 * A LONG WINDOW, UNLIKE A RESET. A reset link lasts 30 minutes because the
 * person asking for it is sitting at the screen. An invite is sent to somebody
 * who may be starting on Monday, so it lasts a week — and when it does lapse,
 * "Forgot password" issues a fresh one with no administrator involved.
 */
export const INVITE_TTL_DAYS = 7;
export const RESET_TTL_MIN = 30;

/** Only ever the hash is stored, so a database leak is not a box of live links. */
export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * A password nobody knows, including us.
 *
 * Shaped to satisfy any strength rule it passes through on the way in. It is
 * never shown, never emailed and never stored in the clear — the only way into
 * the account is a link to choose a real one.
 */
export function unknowablePassword() {
  return `${crypto.randomBytes(18).toString("base64url")}Aa1!`;
}

/**
 * Mint a single-use token and return the raw value, which is the only time it
 * exists in a readable form.
 *
 * Outstanding tokens for the account are dropped first: two live links to one
 * account means the older one still works after the newer has been used, and
 * "use once" should mean once.
 */
export async function issuePasswordToken({ userId, userType, email, ttlMs }) {
  await connect();
  await PasswordResetTokenModel.deleteMany({ userId, usedAt: null });

  const raw = crypto.randomBytes(32).toString("hex");
  await PasswordResetTokenModel.create({
    userId,
    userType,
    email,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return raw;
}

/**
 * The link to put in a message.
 *
 * `welcome=1` only changes what the page says — a first-time arrival is told to
 * choose a password, not to reset one they never had. It carries no authority:
 * the token does that, and the page would refuse without it.
 */
export function passwordLink({ baseUrl, userId, token, welcome = false }) {
  const base = `${baseUrl}/reset-password?uid=${userId}&token=${token}`;
  return welcome ? `${base}&welcome=1` : base;
}

/**
 * Welcome a new employee and let them set their own password.
 *
 * Best-effort by design. The employee record is already saved by the time this
 * runs, and a mail server having a bad afternoon must not undo somebody's
 * first day — so it reports what happened and leaves the decision to the
 * caller, which tells HR rather than failing the save. A message that never
 * arrives is recoverable by the employee alone through "Forgot password".
 *
 * @returns {Promise<{sent: boolean, message: string}>}
 */
export async function sendPasswordInvite({
  userId,
  userType,
  email,
  name,
  tenantId,
  companyName,
}) {
  try {
    if (!email) return { sent: false, message: "That employee has no email address" };

    const token = await issuePasswordToken({
      userId: String(userId),
      userType,
      email,
      ttlMs: INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
    });

    // Their own company's address, so the link lands in the workspace they
    // actually belong to rather than at one fixed host.
    const baseUrl = await resolveTenantAppUrl(tenantId);
    const link = passwordLink({ baseUrl, userId, token, welcome: true });
    const where = companyName ? ` at ${companyName}` : "";

    const html = `
      <p>Hi ${name || "there"},</p>
      <p>Your account${where} is ready. Choose your password with the button
      below and you are in.</p>
      ${emailButton("Choose your password", link)}
      <p>If the button does not work, copy and paste this link:</p>
      <p style="word-break:break-all;color:#4f46e5">${link}</p>
      <p>The link is valid for ${INVITE_TTL_DAYS} days and can be used once. If
      it has expired by the time you get to it, use <strong>Forgot
      password</strong> on the sign-in page and a new one will be sent.</p>`;

    const sent = await sendTenantMail({
      tenantId,
      feature: "HR",
      to: email,
      subject: "Set your password",
      heading: "Your account is ready",
      html,
    });

    if (!sent?.success) {
      // Not the mail server's wording. `sent.message` is for logs; what comes
      // back here is shown to HR, who need to know the account exists and what
      // to do next.
      console.log(`Password invite to ${email} failed:`, sent?.message);
      return {
        sent: false,
        message:
          "but the welcome email could not be sent — ask them to use " +
          "Forgot password on the sign-in page",
      };
    }

    return { sent: true, message: "and a link to set their password was emailed" };
  } catch (error) {
    console.log("sendPasswordInvite error:", error?.message);
    return {
      sent: false,
      message:
        "but the welcome email could not be sent — ask them to use " +
        "Forgot password on the sign-in page",
    };
  }
}

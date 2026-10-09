"use server";

import { connect } from "@/db/db";
import CompanyModel from "@/models/companyModel";
import EmailAccountModel from "@/models/emailAccountmodel";
import { decrypt } from "@/lib/algo";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { primaryDomain, resolveBranding } from "@/lib/tenant";
import { escapeTenant, runWithTenant } from "@/lib/tenantContext";
import { originForHost } from "@/lib/tenantHost";
import { renderBrandedEmail } from "@/lib/emailTemplate";
import { envSmtpConfig, resolveSmtpHost } from "@/lib/smtp";
import { DEFAULT_EMAIL_FEATURE } from "@/data/emailFeatures";
import { sendMail as transportSend } from "../nodeMailerServer/nodemailerServer";

/**
 * Sending mail on behalf of a company.
 *
 * Two things have to be resolved per company rather than per deployment: which
 * SMTP account to send through, and whose name and colours the message wears.
 * Both are looked up here so callers pass a tenant id and a body, nothing else.
 *
 * The sender is chosen in this order:
 *   1. the company's primary account for the feature
 *   2. any active account the company has for the feature
 *   3. the company's default ("All") account — so configuring one sender is
 *      enough, and adding a narrower feature key never silently moves mail off
 *      the company's own identity
 *   4. a platform-level account for the feature (no tenantId) — the shared
 *      fallback, so a company that has configured nothing can still receive
 *      password resets
 *   5. the EMAIL_* environment variables, which is what the app used before
 *      any of this existed
 *
 * Which feature each kind of message asks for is listed in data/emailFeatures.js.
 */

/** Decrypt an account's password and shape it for the transport. */
function toTransportConfig(smtp) {
  return {
    host: resolveSmtpHost(smtp),
    port: smtp.port || 587,
    secure: !!smtp.secure,
    userName: smtp.userName,
    password: decrypt(smtp.password),
  };
}

/**
 * Find the SMTP account a company should send a given feature through.
 * Returns null when nothing is configured anywhere and the caller should fall
 * back to the environment.
 */
async function resolveAccount(tenantId, feature) {
  await connect();

  const forTenant = async (wanted) => {
    const base = { feature: wanted, isDeleted: false, isActive: true };
    // Primary first, then any active account for the feature — an account can
    // be configured for "HR" without anyone having marked it primary.
    return (
      (await EmailAccountModel.findOne({ ...base, isPrimary: true }).lean()) ||
      (await EmailAccountModel.findOne(base)
        .sort({ isPrimary: -1, updatedAt: -1 })
        .lean())
    );
  };

  if (tenantId && isValidObjectId(tenantId)) {
    const own = await runWithTenant(String(tenantId), () => forTenant(feature));
    if (own) return own;

    // The company's default sender, before giving up on the company entirely.
    //
    // This step was missing, and it is what makes granular senders safe to
    // introduce: asking for "Accounts" at a company that has only configured a
    // default used to skip straight past them to the platform's credentials, so
    // the message went out under the wrong identity. Now a company can
    // configure exactly as much as it cares about.
    if (feature !== DEFAULT_EMAIL_FEATURE) {
      const fallback = await runWithTenant(String(tenantId), () =>
        forTenant(DEFAULT_EMAIL_FEATURE)
      );
      if (fallback) return fallback;
    }
  }

  // Platform-level fallback: no tenantId, so it is invisible to a scoped query
  // and has to be read outside the scope.
  return escapeTenant("email: platform fallback sender", () =>
    EmailAccountModel.findOne({
      feature,
      isDeleted: false,
      isActive: true,
      tenantId: { $in: [null, undefined] },
    })
      .sort({ isPrimary: -1, updatedAt: -1 })
      .lean()
  );
}

/** Branding plus the absolute URL to use in links, for one company. */
async function resolveSenderIdentity(tenantId) {
  if (!tenantId || !isValidObjectId(tenantId)) {
    return { branding: resolveBranding(null), appUrl: "", companyName: "" };
  }
  await connect();
  const tenant = await escapeTenant("email: sender branding", () =>
    CompanyModel.findById(createObjectId(tenantId))
      .select("name branding domains slug")
      .lean()
  );
  if (!tenant) {
    return { branding: resolveBranding(null), appUrl: "", companyName: "" };
  }

  const host =
    primaryDomain(tenant) ||
    (tenant.slug && process.env.PLATFORM_ROOT_DOMAIN
      ? `${tenant.slug}.${process.env.PLATFORM_ROOT_DOMAIN}`
      : "");

  return {
    branding: resolveBranding(tenant),
    // Falls back to the configured public URL so links are never relative.
    appUrl: host ? originForHost(host) : process.env.NEXT_PUBLIC_WEB_URL || "",
    companyName: tenant.name,
  };
}

/**
 * The absolute origin to put in a company's links.
 *
 * Its primary verified domain, else its <slug>.<root> address, else the
 * configured public URL. Never NEXTAUTH_URL, which is deliberately unset so
 * Auth.js derives per-request URLs, and which pointed at one fixed host anyway.
 */
export async function resolveTenantAppUrl(tenantId) {
  const { appUrl } = await resolveSenderIdentity(tenantId);
  return appUrl || process.env.NEXT_PUBLIC_WEB_URL || "";
}

/**
 * The mailbox a company wants copied on a feature's mail, e.g. its HR inbox.
 * Empty when nothing is configured, which callers treat as "no copy".
 */
export async function resolveTenantFeatureMailbox(tenantId, feature) {
  const account = await resolveAccount(tenantId, feature);
  return account?.toEmail || "";
}

/**
 * Send one message as a company.
 *
 * @param {object} options
 * @param {string} options.tenantId  company the mail belongs to
 * @param {string} options.feature   which configured sender to use, e.g. "HR"
 * @param {string|string[]} options.to
 * @param {string} options.subject
 * @param {string} options.html      body; wrapped in the company's branding
 * @param {string} [options.heading] optional title inside the branded shell
 * @param {boolean} [options.raw]    send `html` untouched, no branded wrapper
 */
export async function sendTenantMail({
  tenantId,
  feature = "All",
  to,
  subject,
  html,
  heading,
  cc,
  raw = false,
} = {}) {
  try {
    const recipients = Array.isArray(to) ? to.filter(Boolean).join(",") : to;
    if (!recipients) return { success: false, message: "No recipient" };

    const [account, identity] = await Promise.all([
      resolveAccount(tenantId, feature),
      resolveSenderIdentity(tenantId),
    ]);

    const body = raw
      ? html
      : renderBrandedEmail({
          branding: identity.branding,
          companyName: identity.companyName,
          appUrl: identity.appUrl,
          heading,
          html,
        });

    // The company's chosen sender name, falling back to its app name.
    const fromName =
      account?.fromName ||
      identity.branding.emailFromName ||
      identity.branding.appName;

    if (account) {
      return transportSend({
        ...toTransportConfig(account),
        fromName,
        toEmail: recipients,
        subject,
        html: body,
        cc,
      });
    }

    // Nothing configured anywhere — the pre-multi-tenant behaviour.
    const env = envSmtpConfig();
    if (!env.host || !env.userName) {
      return { success: false, message: "No sender configured" };
    }
    return transportSend({
      ...env,
      fromName,
      toEmail: recipients,
      subject,
      html: body,
      cc,
    });
  } catch (error) {
    console.log("sendTenantMail error:", error?.message);
    return { success: false, message: "Error sending email" };
  }
}

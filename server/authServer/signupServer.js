"use server";

import crypto from "crypto";

import { connect } from "@/db/db";
import CompanyModel from "@/models/companyModel";
import EmployeModel from "@/models/employeModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import OfficeUserModel from "@/models/officeModel";
import PendingSignupModel from "@/models/pendingSignupModel";
import PlatformUserModel from "@/models/platformUserModel";
import RoleTypesModel from "@/models/roleTypeModel";
import TenantMembershipModel from "@/models/tenantMembershipModel";
import { logAuditDirect } from "@/lib/audit";
import { emailButton } from "@/lib/emailTemplate";
import { startSession } from "@/lib/mongodb";
import { escapeTenant, runWithTenant } from "@/lib/tenantContext";
import {
  RESERVED_SUBDOMAINS,
  normalizeHost,
  originForHost,
  platformRootDomain,
} from "@/lib/tenantHost";
import { hashPassword } from "@/utils/bcrypt";
import { sendTenantMail } from "../email/tenantMail";
import { invalidateTenantCache } from "../tenantServer/tenantServer";

/**
 * Self-serve signup: someone with no account creates a company and becomes its
 * super admin.
 *
 * Two steps, and the split matters. `startSignup()` only records the intent and
 * emails a link; `completeSignup()` is what actually creates the company, its
 * first employee record and the membership that ties them together. Until that
 * link is clicked nothing exists — see the note on models/pendingSignupModel.js
 * for why it is ordered that way.
 *
 * The whole flow runs unauthenticated, so every value is treated as hostile:
 * the role is hard-coded rather than read from the form, the slug is checked
 * against the same rules the platform console applies, and the reply to
 * `startSignup()` is deliberately identical whether or not the email is already
 * in use.
 */

const TOKEN_TTL_HOURS = 24;
// A "send it again" any sooner is almost always an impatient double-click.
const RESEND_COOLDOWN_MS = 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;

// The department every new company starts with. A company needs at least one,
// because OfficeEmploye.department is required — the owner cannot be created
// without it — and "Management" is a defensible default for the founder.
const FIRST_DEPARTMENT = "Management";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Same shape the company schema and the platform console enforce. */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Why a slug cannot be used, or "" when it is fine.
 * Format only — availability needs the database and is checked separately.
 */
function slugComplaint(slug) {
  if (!slug) return "Pick a workspace address";
  if (slug.length < 3) return "Use at least 3 characters";
  if (slug.length > 63) return "Use 63 characters or fewer";
  if (!SLUG_PATTERN.test(slug)) {
    return "Use lowercase letters, numbers and hyphens, not starting or ending with a hyphen";
  }
  // These resolve to the platform's own hosts, so a tenant can never hold one.
  if (RESERVED_SUBDOMAINS.has(slug)) return "That address is reserved";
  return "";
}

/**
 * The origin to build the confirmation link from.
 *
 * The host the person is actually on, so a deployment serving several domains
 * sends them back to the one they started on rather than to a single configured
 * URL. Falls back to NEXT_PUBLIC_WEB_URL when there is no usable Host header.
 */
async function signupOrigin() {
  try {
    // Imported lazily so this module still loads under plain node — the
    // signup path is exercised by a script outside the Next bundler, and a
    // static "next/headers" import cannot be resolved there.
    const { headers } = await import("next/headers");
    const store = await headers();
    const host = normalizeHost(
      store.get("x-forwarded-host") || store.get("host")
    );
    if (host) return originForHost(host);
  } catch {
    // Outside a request (tests, scripts) — fall through to the configured URL.
  }
  return process.env.NEXT_PUBLIC_WEB_URL || "";
}

/** Does any account anywhere already use this email? Deliberately unscoped. */
async function emailInUse(email) {
  const rx = new RegExp(`^${escapeRegex(email)}$`, "i");
  return escapeTenant("signup: is this email already registered", async () => {
    const [office, site, reception, platform] = await Promise.all([
      OfficeEmployeeModel.exists({ email: rx, delete: { $ne: true } }),
      EmployeModel.exists({ email: rx, delete: { $ne: true } }),
      OfficeUserModel.exists({ email: rx, delete: { $ne: true } }),
      PlatformUserModel.exists({ email: rx, delete: { $ne: true } }),
    ]);
    return !!(office || site || reception || platform);
  });
}

/**
 * Is a workspace address free? Called as the person types, so it answers only
 * this one question and never reveals anything about who holds a taken one.
 */
export async function checkWorkspaceAvailability(rawSlug) {
  try {
    const slug = String(rawSlug || "").trim().toLowerCase();
    const complaint = slugComplaint(slug);
    if (complaint) return { available: false, message: complaint };

    await connect();
    const taken = await CompanyModel.exists({ slug, delete: { $ne: true } });
    if (taken) return { available: false, message: "That address is taken" };

    return { available: true, message: "Available" };
  } catch (error) {
    console.log("checkWorkspaceAvailability error:", error?.message);
    // Never claim an address is free when the check itself failed.
    return { available: false, message: "Could not check that address" };
  }
}

/**
 * Step one: record the signup and email a confirmation link.
 *
 * Always reports success once the input itself is valid. Saying "that email is
 * already registered" would turn this into a way to test whether any given
 * address has an account here, so an email that is already in use gets a
 * message telling *its owner* instead — which is the only person who should
 * learn anything from it.
 */
export async function startSignup(form = {}) {
  const sent = {
    success: true,
    message: "Check your inbox — we've sent you a link to confirm your email.",
  };

  try {
    const companyName = String(form.companyName || "").trim();
    const name = String(form.name || "").trim();
    const email = String(form.email || "").trim().toLowerCase();
    const slug = String(form.slug || "").trim().toLowerCase();
    const phoneDigits = String(form.phoneNumber || "").replace(/\D/g, "");
    const password = String(form.password || "");

    if (!companyName) return { success: false, message: "Company name is required" };
    if (!name) return { success: false, message: "Your name is required" };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
      return { success: false, message: "Enter a valid email address" };
    }
    if (!phoneDigits) return { success: false, message: "Phone number is required" };
    if (phoneDigits.length > 15) {
      return { success: false, message: "That phone number is too long" };
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return {
        success: false,
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      };
    }

    const complaint = slugComplaint(slug);
    if (complaint) return { success: false, message: complaint };

    await connect();

    // The address is public information — it becomes a hostname — so unlike the
    // email, saying it is taken gives nothing away.
    if (await CompanyModel.exists({ slug, delete: { $ne: true } })) {
      return { success: false, message: "That workspace address is taken" };
    }

    const origin = await signupOrigin();

    // Someone who already has an account is told so by email, not by this
    // reply. They are the only person who can read it.
    if (await emailInUse(email)) {
      await sendTenantMail({
        tenantId: null,
        feature: "All",
        to: email,
        subject: "You already have an account",
        heading: "Account already registered",
        html: `
        <p>Hi ${name},</p>
        <p>Someone — probably you — tried to create a new workspace with this
        email address. It already has an account, so we have not created
        anything new.</p>
        ${emailButton("Sign in", `${origin}/auth`)}
        <p>If you have forgotten your password, you can
        <a href="${origin}/forgot-password" style="color:#4f46e5">reset it here</a>.</p>
        <p>If this was not you, you can safely ignore this email — nothing has
        changed.</p>`,
      }).catch((error) => console.log("signup notice email failed:", error?.message));

      return sent;
    }

    // An unconfirmed signup that is still warm: do not send another link yet.
    const outstanding = await PendingSignupModel.findOne({
      email,
      usedAt: null,
    })
      .sort({ createdAt: -1 })
      .lean();
    if (
      outstanding?.lastSentAt &&
      Date.now() - new Date(outstanding.lastSentAt).getTime() < RESEND_COOLDOWN_MS
    ) {
      return sent;
    }

    // Replace rather than stack, so only the newest link ever works.
    await PendingSignupModel.deleteMany({ email, usedAt: null });

    const passwordHash = await hashPassword(password);
    if (!passwordHash) {
      return { success: false, message: "Could not secure your password" };
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    await PendingSignupModel.create({
      companyName,
      slug,
      name,
      email,
      phoneNumber: Number(phoneDigits),
      passwordHash,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000),
      lastSentAt: new Date(),
    });

    const link = `${origin}/signup/verify?token=${rawToken}`;
    const root = platformRootDomain();
    const address = root ? `${slug}.${root}` : slug;

    const mail = await sendTenantMail({
      tenantId: null,
      feature: "All",
      to: email,
      subject: `Confirm your email to create ${companyName}`,
      heading: "Confirm your email",
      html: `
        <p>Hi ${name},</p>
        <p>You are one click away from creating <strong>${companyName}</strong>
        at <strong>${address}</strong>. Confirm this email address and we will
        set the workspace up for you.</p>
        ${emailButton("Confirm and create workspace", link)}
        <p>If the button does not work, copy and paste this link:</p>
        <p style="word-break:break-all;color:#4f46e5">${link}</p>
        <p>The link is valid for ${TOKEN_TTL_HOURS} hours and can be used once.
        Until you use it, nothing has been created.</p>
        <p>If you did not request this, you can safely ignore this email.</p>`,
    });

    if (!mail?.success) {
      // The pending record is useless without the link the person never got.
      await PendingSignupModel.deleteMany({ email, usedAt: null });
      console.log("signup email failed:", mail?.message);
      return {
        success: false,
        message: "We could not send the confirmation email. Please try again.",
      };
    }

    return sent;
  } catch (error) {
    console.log("startSignup error:", error?.message);
    return { success: false, message: "Could not start your signup" };
  }
}

/**
 * Step two: the link was clicked, so build the workspace.
 *
 * Creates the company, its first department, the owner's employee record and
 * the membership that lets them sign in to it — all in one transaction, so a
 * failure half way through cannot leave a company nobody can log in to.
 */
export async function completeSignup(rawToken) {
  const invalid = {
    success: false,
    message: "This confirmation link is invalid or has expired.",
  };

  try {
    const token = String(rawToken || "").trim();
    if (!token) return invalid;

    await connect();

    const pending = await PendingSignupModel.findOne({
      tokenHash: hashToken(token),
    });

    if (!pending) return invalid;
    // Already confirmed: say so plainly rather than pretending the link is
    // broken, so someone who clicks twice knows their workspace exists.
    if (pending.usedAt) {
      return {
        success: false,
        alreadyUsed: true,
        message: "This link has already been used. Your workspace is ready — sign in.",
      };
    }
    if (new Date(pending.expiresAt) < new Date()) return invalid;

    // Re-checked here, not just at startSignup: an unconfirmed signup reserves
    // nothing, so the address and the email can both have gone in the meantime.
    if (await CompanyModel.exists({ slug: pending.slug, delete: { $ne: true } })) {
      return {
        success: false,
        message: `The address "${pending.slug}" was taken while you were confirming. Please sign up again with a different one.`,
      };
    }
    if (await emailInUse(pending.email)) {
      return {
        success: false,
        message: "An account with this email already exists. Please sign in instead.",
      };
    }

    const session = await startSession();
    let created = null;

    try {
      await session.withTransaction(async () => {
        const [company] = await CompanyModel.create(
          [
            {
              name: pending.companyName,
              description: "",
              slug: pending.slug,
              // Every self-serve workspace starts on trial; the platform
              // console is what promotes one to "active".
              status: "trial",
              domains: [],
              isActive: true,
              delete: false,
            },
          ],
          { session }
        );

        const tenantId = String(company._id);

        // tenantId is set explicitly on each document as well as scoping the
        // block: the plugin stamps from context, but being explicit means a
        // record can never land in the wrong company even if context is lost.
        await runWithTenant(tenantId, async () => {
          const [department] = await RoleTypesModel.create(
            [
              {
                tenantId: company._id,
                roleTitle: FIRST_DEPARTMENT,
                roleDescription: "Created with the workspace",
              },
            ],
            { session }
          );

          const [owner] = await OfficeEmployeeModel.create(
            [
              {
                tenantId: company._id,
                name: pending.name,
                email: pending.email,
                phoneNumber: pending.phoneNumber,
                // Already hashed at signup — never re-hash.
                password: pending.passwordHash,
                department: department._id,
                roleType: FIRST_DEPARTMENT,
                company: company._id,
                employeType: "Full-Time",
                immigrationType: "British",
                joinDate: new Date(),
                countryOfWork: "United Kingdom",
                isActive: true,
                // The founder runs the company. Hard-coded rather than taken
                // from the form: this whole flow is unauthenticated.
                isAdmin: true,
                isSuperAdmin: true,
                delete: false,
              },
            ],
            { session }
          );

          await TenantMembershipModel.create(
            [
              {
                userId: owner._id,
                userModel: "OfficeEmploye",
                email: pending.email,
                tenantId: company._id,
                role: "superAdmin",
                // Their only company, so it is where they land at sign-in.
                isDefault: true,
                isActive: true,
              },
            ],
            { session }
          );

          created = { company, owner };
        });

        pending.usedAt = new Date();
        await pending.save({ session });
      });
    } finally {
      await session.endSession();
    }

    if (!created) return { success: false, message: "Could not create your workspace" };

    await logAuditDirect({
      actor: {
        _id: String(created.owner._id),
        name: created.owner.name,
        email: created.owner.email,
        role: "superAdmin",
      },
      action: "Signup.createWorkspace",
      module: "Account",
      tenantId: String(created.company._id),
      entityId: String(created.company._id),
      description: `${created.owner.email} created the company ${created.company.name} via self-serve signup`,
      after: {
        company: created.company.name,
        slug: created.company.slug,
        owner: created.owner.email,
      },
    });

    await invalidateTenantCache();

    const root = platformRootDomain();
    return {
      success: true,
      message: `${created.company.name} is ready.`,
      data: JSON.stringify({
        companyName: created.company.name,
        slug: created.company.slug,
        email: created.owner.email,
        workspaceUrl: root ? originForHost(`${created.company.slug}.${root}`) : "",
      }),
    };
  } catch (error) {
    // The unique partial index on `slug` is the real guard against two people
    // confirming the same address at once; the check above only buys a better
    // message when there is time for one.
    if (error?.code === 11000) {
      return {
        success: false,
        message:
          "That workspace address was taken moments ago. Please sign up again with a different one.",
      };
    }
    console.log("completeSignup error:", error?.message);
    return { success: false, message: "Could not create your workspace" };
  }
}

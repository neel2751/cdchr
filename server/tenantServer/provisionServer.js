"use server";

import { connect } from "@/db/db";
import CompanyModel from "@/models/companyModel";
import EmployeModel from "@/models/employeModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import OfficeUserModel from "@/models/officeModel";
import PlatformUserModel from "@/models/platformUserModel";
import TenantMembershipModel from "@/models/tenantMembershipModel";
import { isValidObjectId, startSession } from "@/lib/mongodb";
import { escapeTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import { trialEndFrom } from "@/lib/tenantAccess";
import { slugComplaint } from "@/lib/workspaceSlug";
import { originForHost, platformRootDomain } from "@/lib/tenantHost";
import { INDUSTRY_TEMPLATES, industryTemplate } from "@/data/terminology";
import { featuresForPreset } from "@/data/features";
import { hashPassword } from "@/utils/bcrypt";
import { getServerSideProps } from "../session/session";
import { sendPasswordInvite, unknowablePassword } from "../authServer/passwordInvite";
import { defaultTrialDays } from "../billingServer/pricingStore";
import { ensureAccount, refreshAccount } from "../billingServer/accountStore";
import { createCompanyWithOwner } from "./companySetup";
import { invalidateTenantCache } from "./tenantServer";

/**
 * The platform admin creating a company for a customer — the console's
 * "New company".
 *
 * It asks for what the register page asks for (the company, its address,
 * its type of business, and who runs it), because a company with nobody to
 * sign in to it is no use to anyone. Who runs it is either:
 *
 *   someone new — their own account is made, as for a self-serve signup;
 *   someone who already runs a company here — another branch or business of
 *     theirs. They get a record in the new company with the same email and
 *     password (that is how one person is in two companies in this app), and
 *     memberships linking every one, so they switch between them from the
 *     sidebar. Optionally it goes on the same bill, at the extra-company
 *     price (billingServer/accountStore.js).
 */

const MIN_PASSWORD_LENGTH = 8;
const MAX_TRIAL_DAYS = 365;

async function requirePlatformAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user) return { error: "Not signed in" };
  if (user.role !== "platformAdmin") return { error: "Not authorised" };
  return { user };
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const exactEmail = (email) => new RegExp(`^${escapeRegex(email)}$`, "i");

/** Does any account anywhere already use this email? */
async function emailInUse(email) {
  const rx = exactEmail(email);
  return escapeTenant("platform: is this email already registered", async () => {
    const [office, site, reception, platform] = await Promise.all([
      OfficeEmployeeModel.exists({ email: rx, delete: { $ne: true } }),
      EmployeModel.exists({ email: rx, delete: { $ne: true } }),
      OfficeUserModel.exists({ email: rx, delete: { $ne: true } }),
      PlatformUserModel.exists({ email: rx, delete: { $ne: true } }),
    ]);
    return !!(office || site || reception || platform);
  });
}

/** Someone's office records, in every company, owners first, oldest first. */
async function officeRecordsFor(email) {
  const rows = await escapeTenant("platform: find a person's companies", () =>
    OfficeEmployeeModel.find({ email: exactEmail(email), delete: { $ne: true } })
      .select("name email phoneNumber password tenantId isSuperAdmin isAdmin isActive")
      .sort({ _id: 1 })
      .lean()
  );
  return rows
    .filter((r) => r.tenantId)
    .sort((a, b) => Number(!!b.isSuperAdmin) - Number(!!a.isSuperAdmin));
}

/**
 * Who has this email, and which companies they are in — for the form, so the
 * platform admin can see they have the right person before adding a company.
 */
export async function findCompanyOwner(rawEmail) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    const email = String(rawEmail || "").trim().toLowerCase();
    if (!email) return { success: false, message: "Enter their email" };

    await connect();
    const records = await officeRecordsFor(email);
    if (!records.length) {
      return {
        success: false,
        message: "Nobody runs a company with that email. Choose “Someone new” instead.",
      };
    }
    const companies = await CompanyModel.find({
      _id: { $in: records.map((r) => r.tenantId) },
      delete: { $ne: true },
    })
      .select("name slug billing.accountId billing.demo")
      .lean();
    const byId = new Map(companies.map((c) => [String(c._id), c]));

    return {
      success: true,
      data: JSON.stringify({
        name: records[0].name,
        companies: records
          .map((r) => {
            const c = byId.get(String(r.tenantId));
            if (!c) return null;
            return {
              _id: String(c._id),
              name: c.name,
              slug: c.slug || "",
              role: r.isSuperAdmin ? "Super admin" : r.isAdmin ? "Admin" : "Staff",
              owner: !!r.isSuperAdmin,
              billedWithOthers: !!c.billing?.accountId,
              demo: !!c.billing?.demo,
            };
          })
          .filter(Boolean),
      }),
    };
  } catch (error) {
    console.log("findCompanyOwner error:", error?.message);
    return { success: false, message: "Could not look that up" };
  }
}

/**
 * Create a company and the person who runs it.
 *
 * @param {object} form
 * @param {string} form.companyName
 * @param {string} form.slug
 * @param {string} form.industry          a data/terminology.js key
 * @param {string} [form.description]
 * @param {"trial"|"active"} form.start   free trial, or paying from today
 * @param {number} [form.trialDays]
 * @param {"new"|"existing"} form.ownerMode
 * @param {{ name, email, phone, password? }} [form.owner]   ownerMode "new"
 * @param {string} [form.existingEmail]   ownerMode "existing"
 * @param {string} [form.billWithCompanyId] ownerMode "existing": put the new
 *   company on this company's bill, at the extra-company price
 */
export async function createCompanyForCustomer(form = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };

    // --- The company ---------------------------------------------------
    const companyName = String(form.companyName || "").trim();
    const slug = String(form.slug || "").trim().toLowerCase();
    const industry = String(form.industry || "").trim();
    const description = String(form.description || "").trim().slice(0, 500);
    if (!companyName) return { success: false, message: "Company name is required" };
    const complaint = slugComplaint(slug);
    if (complaint) return { success: false, message: complaint };
    if (!INDUSTRY_TEMPLATES.some((t) => t.key === industry)) {
      return { success: false, message: "Choose the type of business" };
    }
    if (!["trial", "active"].includes(form.start)) {
      return { success: false, message: "Choose a free trial or paying" };
    }

    await connect();
    let trialDays = null;
    if (form.start === "trial") {
      trialDays = form.trialDays === undefined || form.trialDays === ""
        ? await defaultTrialDays()
        : Number(form.trialDays);
      if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > MAX_TRIAL_DAYS) {
        return { success: false, message: `Trial length must be 1 to ${MAX_TRIAL_DAYS} days` };
      }
    }
    if (await CompanyModel.exists({ slug, delete: { $ne: true } })) {
      return { success: false, message: "That workspace address is taken" };
    }

    // --- Who runs it ---------------------------------------------------
    let owner;
    let others = [];
    let billWith = null;
    let invite = false;

    if (form.ownerMode === "new") {
      const name = String(form.owner?.name || "").trim();
      const email = String(form.owner?.email || "").trim().toLowerCase();
      const phoneDigits = String(form.owner?.phone || "").replace(/\D/g, "");
      const password = String(form.owner?.password || "");
      if (!name) return { success: false, message: "The owner's name is required" };
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
        return { success: false, message: "Enter a valid email for the owner" };
      }
      if (!phoneDigits) return { success: false, message: "The owner's phone number is required" };
      if (phoneDigits.length > 15) return { success: false, message: "That phone number is too long" };
      if (password && password.length < MIN_PASSWORD_LENGTH) {
        return {
          success: false,
          message: `A password must be at least ${MIN_PASSWORD_LENGTH} characters — or leave it empty to email them a link`,
        };
      }
      if (await emailInUse(email)) {
        return {
          success: false,
          message:
            "That email already has an account. If they run another company here, choose “Someone who already has a company”.",
        };
      }
      const passwordHash = await hashPassword(password || unknowablePassword());
      if (!passwordHash) return { success: false, message: "Could not secure the password" };
      owner = {
        name,
        email,
        phoneNumber: Number(phoneDigits),
        passwordHash,
        // A password typed here is one the platform admin knows: they are
        // made to choose their own at first sign-in. Without one, they are
        // emailed a link to choose it.
        mustChangePassword: Boolean(password),
      };
      invite = !password;
    } else if (form.ownerMode === "existing") {
      const email = String(form.existingEmail || "").trim().toLowerCase();
      if (!email) return { success: false, message: "Enter the email of the person who runs it" };
      const records = await officeRecordsFor(email);
      if (!records.length) {
        return { success: false, message: "Nobody runs a company with that email" };
      }
      const source = records.find((r) => r.password) || null;
      if (!source) return { success: false, message: "That account has no password set yet" };
      // The same person: same name, email and password, so one sign-in
      // opens every company of theirs.
      owner = {
        name: source.name,
        email: String(source.email).trim().toLowerCase(),
        phoneNumber: source.phoneNumber,
        passwordHash: source.password,
      };
      others = records;

      if (form.billWithCompanyId) {
        if (
          !isValidObjectId(form.billWithCompanyId) ||
          !records.some((r) => String(r.tenantId) === String(form.billWithCompanyId))
        ) {
          return { success: false, message: "They do not run that company" };
        }
        billWith = await CompanyModel.findById(form.billWithCompanyId)
          .select("name billing")
          .lean();
        if (!billWith) return { success: false, message: "That company no longer exists" };
      }
    } else {
      return { success: false, message: "Choose who runs the company" };
    }

    // --- Make it -------------------------------------------------------
    const template = industryTemplate(industry);
    const session = await startSession();
    let created = null;
    try {
      await session.withTransaction(async () => {
        created = await createCompanyWithOwner({
          company: {
            name: companyName,
            description,
            slug,
            status: form.start,
            industry: template.key,
            features: featuresForPreset(template.featurePreset) || {},
            billing: trialDays ? { trialEndsAt: trialEndFrom(new Date(), trialDays) } : {},
          },
          owner,
          // A new person lands in their only company; someone adding a
          // company keeps landing where they always have.
          isDefault: form.ownerMode === "new",
          session,
        });
      });
    } finally {
      await session.endSession();
    }
    if (!created) return { success: false, message: "Could not create the company" };
    const tenantId = String(created.company._id);

    // Link every company of theirs, so the switcher lists them all
    // (membershipServer.js). Only adds; a role somebody granted stays.
    for (const record of others) {
      await TenantMembershipModel.updateOne(
        { email: owner.email, tenantId: record.tenantId },
        {
          $setOnInsert: {
            userId: record._id,
            userModel: "OfficeEmploye",
            email: owner.email,
            tenantId: record.tenantId,
            role: record.isSuperAdmin ? "superAdmin" : record.isAdmin ? "admin" : "user",
            isActive: true,
            isDefault: false,
          },
        },
        { upsert: true }
      );
    }

    // One bill, the new company at the extra-company price.
    let billedWith = "";
    if (billWith) {
      const account = await ensureAccount(billWith);
      await CompanyModel.updateOne(
        { _id: created.company._id },
        { $set: { "billing.accountId": account._id } }
      );
      await refreshAccount(account._id);
      billedWith = account.name;
    }

    await invalidateTenantCache();

    await logAuditDirect({
      actor: {
        _id: auth.user._id,
        name: auth.user.name,
        email: auth.user.email,
        role: "platformAdmin",
      },
      action: "Platform.createTenant",
      module: "Platform",
      tenantId,
      entityId: tenantId,
      description:
        `Created ${companyName} for ${owner.email}` +
        (form.ownerMode === "existing" ? " (who already runs another company)" : "") +
        (billedWith ? `, billed with ${billedWith}` : ""),
      after: {
        name: companyName,
        slug,
        industry: template.key,
        status: form.start,
        trialDays,
        owner: owner.email,
        ownerMode: form.ownerMode,
        billedWith: billedWith || undefined,
      },
    });

    // Their password: a link to choose one, unless the platform admin set it.
    let inviteNote = "";
    if (invite) {
      const sent = await sendPasswordInvite({
        userId: created.owner._id,
        userType: "office",
        email: owner.email,
        name: owner.name,
        tenantId,
        companyName,
      });
      inviteNote = sent.sent
        ? `${owner.email} has been emailed a link to choose their password.`
        : `The email to ${owner.email} could not be sent — ask them to use “Forgot password” on the sign-in page.`;
    }

    const root = platformRootDomain();
    return {
      success: true,
      message: `${companyName} created`,
      data: JSON.stringify({
        _id: tenantId,
        slug,
        ownerEmail: owner.email,
        workspaceUrl: root ? originForHost(`${slug}.${root}`) : "",
        inviteNote,
        passwordNote:
          form.ownerMode === "existing"
            ? `${owner.name} signs in with the email and password they already use, and switches company from the sidebar.`
            : invite
              ? ""
              : "Give them the password you set. They choose their own when they first sign in.",
        billedWith,
      }),
    };
  } catch (error) {
    if (error?.code === 11000) {
      return { success: false, message: "That workspace address was taken moments ago" };
    }
    console.log("createCompanyForCustomer error:", error?.message);
    return { success: false, message: "Could not create the company" };
  }
}

"use server";

import { connect } from "@/db/db";
import CompanyModel from "@/models/companyModel";
import TenantMembershipModel from "@/models/tenantMembershipModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { isTenantUsable } from "@/lib/tenant";
import { escapeTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import { getServerSideProps } from "../session/session";

/**
 * Membership: which companies a login may act as, and switching between them.
 *
 * The switch is the sensitive part. It changes which tenant every subsequent
 * query is filtered by, so it is decided here against the database and never
 * from anything the browser sends — the same rule the 2FA gate now follows.
 */

/** Memberships for an account, newest first, with the company attached. */
/**
 * Not exported: it takes the user id to look up from its caller, and reads
 * TenantMembership and Companie, both of which sit outside tenant scoping. As
 * an export of a "use server" module it was a public endpoint, so an anonymous
 * request naming any user id learned every company that account belongs to, by
 * name. Its callers are in this file (assertCanSwitchTenant and
 * listMyTenants), which authorise first.
 */
async function membershipFilter({ userId, email }) {
  const or = [];
  if (userId && isValidObjectId(userId)) or.push({ userId: createObjectId(userId) });
  // By EMAIL as well as by id, because one person does not have one id.
  //
  // A membership's userId is an employee record, and the same person added to
  // two companies has a different record in each — HR creates them separately,
  // which is the whole situation this supports. Matching on the id alone found
  // only the company they happened to sign in to, so the switcher was empty for
  // exactly the people it exists for. The email is what is stable across
  // companies, and it is already stored on every membership row.
  const clean = String(email || "").trim().toLowerCase();
  if (clean) or.push({ email: clean });
  return or.length ? { $or: or, isActive: true } : null;
}

async function listMembershipsFor(userId, email) {
  await connect();
  const filter = await membershipFilter({ userId, email });
  if (!filter) return [];
  const rows = await TenantMembershipModel.find(filter).lean().exec();
  if (!rows.length) return [];

  const tenants = await CompanyModel.find({
    _id: { $in: rows.map((r) => r.tenantId) },
    delete: { $ne: true },
  })
    .select("name slug status isActive branding")
    .lean()
    .exec();

  const byId = new Map(tenants.map((t) => [String(t._id), t]));
  return rows
    .map((r) => {
      const tenant = byId.get(String(r.tenantId));
      if (!tenant || !isTenantUsable(tenant)) return null;
      return {
        tenantId: String(r.tenantId),
        name: tenant.name,
        slug: tenant.slug || "",
        appName: tenant.branding?.appName || tenant.name,
        role: r.role,
        isDefault: !!r.isDefault,
        // Which employee record to act AS in that company. The session swaps
        // to it on a switch, so personal data — attendance, leave, documents —
        // resolves against the right company's record rather than coming back
        // empty under a tenant that has never heard of this id.
        userId: r.userId ? String(r.userId) : null,
      };
    })
    .filter(Boolean);
}

/**
 * Confirm an account may act as a company, and with what role.
 * Returns null when there is no active membership.
 */
async function resolveMembership({ userId, email }, tenantId) {
  if (!isValidObjectId(tenantId)) return null;
  await connect();
  const filter = await membershipFilter({ userId, email });
  if (!filter) return null;
  const row = await TenantMembershipModel.findOne({
    ...filter,
    tenantId: createObjectId(tenantId),
  })
    .lean()
    .exec();
  if (!row) return null;

  const tenant = await CompanyModel.findById(tenantId).lean().exec();
  if (!tenant || !isTenantUsable(tenant)) return null;

  return {
    tenantId: String(tenantId),
    role: row.role,
    // The record to act as in that company — see listMembershipsFor.
    userId: row.userId ? String(row.userId) : null,
  };
}

/** The companies the signed-in user can switch between. */
export async function getMyTenants() {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user;
    if (!user?._id) return { success: false, message: "Not signed in" };

    const memberships = await listMembershipsFor(user._id, user.email);
    return {
      success: true,
      data: JSON.stringify({
        activeTenantId: user.tenantId || null,
        tenants: memberships,
      }),
    };
  } catch (error) {
    console.log("getMyTenants error:", error?.message);
    return { success: false, message: "Could not load your companies" };
  }
}

/**
 * Check a requested switch. The session update itself is applied by the jwt
 * callback in auth.js, which calls this — a client asserting a tenant id is
 * not enough, exactly as with the 2FA gate.
 */
export async function assertCanSwitchTenant(userId, tenantId, email) {
  return resolveMembership({ userId, email }, tenantId);
}

// --- Platform-side management --------------------------------------------

async function requirePlatformAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user) return { error: "Not signed in" };
  if (user.role !== "platformAdmin") return { error: "Not authorised" };
  return { user };
}

/** Everyone who can act as a company, for the platform console. */
export async function listTenantMembers(tenantId) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(tenantId)) {
      return { success: false, message: "Invalid company" };
    }

    await connect();
    const rows = await TenantMembershipModel.find({
      tenantId: createObjectId(tenantId),
    })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return {
      success: true,
      data: JSON.stringify(
        rows.map((r) => ({
          _id: String(r._id),
          userId: String(r.userId),
          email: r.email,
          role: r.role,
          isDefault: !!r.isDefault,
          isActive: r.isActive !== false,
        }))
      ),
    };
  } catch (error) {
    console.log("listTenantMembers error:", error?.message);
    return { success: false, message: "Could not load members" };
  }
}

/**
 * Let an existing login also manage this company.
 *
 * Looks the account up by email across every tenant, which is why it escapes
 * the tenant scope — the whole point is to connect an account in one company
 * to another company.
 */
export async function grantMembership(tenantId, email, role = "superAdmin") {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(tenantId)) {
      return { success: false, message: "Invalid company" };
    }
    if (!["superAdmin", "admin", "user"].includes(role)) {
      return { success: false, message: "Unknown role" };
    }

    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized) return { success: false, message: "Email is required" };

    await connect();
    const tenant = await CompanyModel.findById(tenantId).lean().exec();
    if (!tenant) return { success: false, message: "Company not found" };

    const account = await escapeTenant(
      "platform: find an account by email across tenants",
      () => OfficeEmployeeModel.findOne({ email: normalized, delete: { $ne: true } }).lean()
    );
    if (!account) {
      return {
        success: false,
        message: "No account with that email. Create the employee first.",
      };
    }

    const existing = await TenantMembershipModel.findOne({
      userId: account._id,
      tenantId: createObjectId(tenantId),
    }).lean();
    if (existing) {
      await TenantMembershipModel.updateOne(
        { _id: existing._id },
        { $set: { role, isActive: true } }
      );
    } else {
      await TenantMembershipModel.create({
        userId: account._id,
        email: normalized,
        tenantId: createObjectId(tenantId),
        role,
        // Their first company is where they land after signing in.
        isDefault: !(await TenantMembershipModel.countDocuments({
          userId: account._id,
        })),
      });
    }

    await logAuditDirect({
      actor: {
        _id: auth.user._id,
        name: auth.user.name,
        email: auth.user.email,
        role: "platformAdmin",
      },
      action: "Platform.grantMembership",
      module: "Platform",
      tenantId,
      entityId: tenantId,
      description: `Gave ${normalized} ${role} access to ${tenant.name}`,
      after: { email: normalized, role },
    });

    return { success: true, message: `${normalized} can now manage ${tenant.name}` };
  } catch (error) {
    console.log("grantMembership error:", error?.message);
    return { success: false, message: "Could not grant access" };
  }
}

export async function revokeMembership(tenantId, userId) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(tenantId) || !isValidObjectId(userId)) {
      return { success: false, message: "Invalid request" };
    }

    await connect();
    // An employee's own company is where their record lives; removing that
    // membership would strand them with nowhere to sign in to.
    const account = await escapeTenant("platform: check home tenant", () =>
      OfficeEmployeeModel.findById(userId).select("tenantId email").lean()
    );
    if (account && String(account.tenantId) === String(tenantId)) {
      return {
        success: false,
        message: "This is the account's own company — deactivate the employee instead",
      };
    }

    await TenantMembershipModel.deleteOne({
      userId: createObjectId(userId),
      tenantId: createObjectId(tenantId),
    });

    await logAuditDirect({
      actor: {
        _id: auth.user._id,
        name: auth.user.name,
        email: auth.user.email,
        role: "platformAdmin",
      },
      action: "Platform.revokeMembership",
      module: "Platform",
      tenantId,
      entityId: tenantId,
      description: `Removed ${account?.email || userId} from the company`,
      before: { userId: String(userId) },
    });

    return { success: true, message: "Access removed" };
  } catch (error) {
    console.log("revokeMembership error:", error?.message);
    return { success: false, message: "Could not remove access" };
  }
}

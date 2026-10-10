"use server";
import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import CompanyModel from "@/models/companyModel";
import TenantMembershipModel from "@/models/tenantMembershipModel";
import { getServerSideProps } from "../session/session";

/**
 * A company's own details, for the people who work there.
 *
 * EVERY QUERY IN THIS FILE HAS TO FILTER BY HAND. CompanyModel is in
 * GLOBAL_MODELS (lib/tenantPlugin.js) — the document that defines a tenant
 * cannot be scoped by the tenant it defines — so the plugin that silently
 * protects every other model protects nothing here. A missing filter is not a
 * missing convenience; it is every company on the platform on one screen.
 *
 * Which is what this was: `getCompanies` matched `{ delete: false }` and
 * nothing else, so a tenant admin opening /admin/company read the name,
 * address and contact details of every other customer. Worse, none of these
 * actions checked a session at all — and a "use server" export is a public
 * endpoint, so `companyDelete({ id })` with any id, from anyone who could
 * reach the app, would retire another company's workspace.
 *
 * The rule now: a caller may touch a company only if they belong to it. Both
 * sources of belonging count — the session's active tenant, which is how an
 * ordinary admin is attached to their employer, and TenantMembership, which is
 * how one login owns several companies (see tenantSettingsServer.js, which
 * applies the same rule to branding and domains).
 */

/** The companies this caller belongs to, as a set of id strings. */
async function ownCompanyIds(user) {
  await connect();

  const ids = new Set();
  // An ordinary office admin has no membership row — those are written only by
  // self-serve signup and by the platform console — so the session's tenant is
  // what attaches most people to their employer. Without it this screen would
  // come back empty for every admin in the product.
  if (user?.tenantId && isValidObjectId(user.tenantId)) {
    ids.add(String(user.tenantId));
  }

  if (user?._id && isValidObjectId(user._id)) {
    const rows = await TenantMembershipModel.find({
      userId: createObjectId(user._id),
      isActive: true,
    })
      .select("tenantId")
      .lean()
      .exec();
    for (const row of rows) {
      if (row?.tenantId) ids.add(String(row.tenantId));
    }
  }

  return ids;
}

/**
 * The caller, once established that they may administer a company at all.
 *
 * The route prefix is already gated (proxy.js) and the menu entry is limited to
 * admin and super admin, but neither of those is reachable from a server
 * action: an action is called directly, not navigated to, so it has to ask for
 * itself.
 */
async function requireCompanyAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return { error: "Not signed in" };
  if (user.role !== "admin" && user.role !== "superAdmin") {
    return { error: "Not authorised" };
  }
  return { user };
}

/** The caller, plus the assurance that `id` is one of their own companies. */
async function requireOwnCompany(id) {
  const auth = await requireCompanyAdmin();
  if (auth.error) return auth;

  if (!id || !isValidObjectId(id)) return { error: "Unknown company" };

  const ids = await ownCompanyIds(auth.user);
  // Deliberately the same answer as a company that does not exist: a caller
  // probing ids must not learn which of them are real.
  if (!ids.has(String(id))) return { error: "Unknown company" };

  return { user: auth.user, id: String(id) };
}

export async function getCompanies(filterData) {
  try {
    const auth = await requireCompanyAdmin();
    if (auth.error) return { success: false, message: auth.error };

    await connect();

    const ids = await ownCompanyIds(auth.user);
    if (!ids.size) {
      return { success: true, data: JSON.stringify([]), totalCount: 0 };
    }

    const sanitizedSearch = filterData?.query?.trim() || "";
    const validPage = parseInt(filterData?.page || 1);
    const validLimit = parseInt(filterData?.pageSize || 10);
    const skip = (validPage - 1) * validLimit;

    // The id filter is the security boundary, so it is part of the match rather
    // than something applied afterwards — and it goes in first, where no later
    // edit to the search can widen it.
    const query = {
      _id: { $in: [...ids].map((id) => createObjectId(id)) },
      delete: { $ne: true },
    };
    if (sanitizedSearch) {
      query.$or = [{ name: { $regex: sanitizedSearch, $options: "i" } }];
    }

    const totalCountDocuments = await CompanyModel.countDocuments(query);
    const companies = await CompanyModel.aggregate([
      { $match: query },
      { $sort: { updatedAt: -1 } },
      { $skip: skip },
      { $limit: validLimit },
    ]);

    return {
      success: true,
      data: JSON.stringify(companies),
      totalCount: totalCountDocuments,
    };
  } catch (error) {
    console.log("getCompanies error:", error?.message);
    return { success: false, message: "Error fetching companies" };
  }
}

export const handleCompany = async (data, id) => {
  if (!data) return { success: false, message: "No Data Provided" };

  // Creating a company is not a tenant-level act. It happens at signup, which
  // builds the workspace and its first owner together, or in the platform
  // console. Reached from here it minted a top-level company on the platform
  // from inside somebody's admin area, owned by nobody and visible to no one.
  if (!id) {
    return {
      success: false,
      message:
        "A new company is created by signing up, or by the platform team. It cannot be added here.",
    };
  }

  try {
    const auth = await requireOwnCompany(id);
    if (auth.error) return { success: false, message: auth.error };

    await connect();

    // A whitelist, not `data` from the browser. Short because the company
    // document is mostly things this screen has no business setting: `slug` and
    // `domains` decide which hostnames reach the company, `status`, `features`
    // and `limits` are the plan it is paying for, `branding` has its own screen
    // with its own upload rules. Passing the request object through to $set
    // offered all of them to anyone willing to add a field to the form — a
    // company could have moved itself onto a better plan.
    //
    // These two are what COMPANYFIELD actually edits (data/fields/fields.js).
    const fields = ["name", "description"];
    const update = {};
    for (const field of fields) {
      if (data[field] !== undefined) update[field] = data[field];
    }

    if (!Object.keys(update).length) {
      return { success: false, message: "Nothing to update" };
    }

    const result = await CompanyModel.updateOne(
      { _id: createObjectId(auth.id), delete: { $ne: true } },
      { $set: update }
    );

    if (!result?.matchedCount) {
      return { success: false, message: "Company not found, please try again" };
    }

    return { success: true, message: "Successfully updated information" };
  } catch (error) {
    console.log("handleCompany error:", error?.message);
    return { success: false, message: "Internal Server Error" };
  }
};

export const companyStatus = async (data) => {
  if (!data) return { success: false, message: "Not found" };
  try {
    const auth = await requireOwnCompany(data?.id);
    if (auth.error) return { success: false, message: auth.error };

    await connect();
    await CompanyModel.updateOne(
      { _id: createObjectId(auth.id), delete: { $ne: true } },
      { $set: { isActive: !data?.status } }
    );
    return {
      success: true,
      message: "The Status has been updated successfully",
    };
  } catch (error) {
    console.log("companyStatus error:", error?.message);
    return { success: false, message: "Error Occurred in server problem" };
  }
};

export const companyDelete = async (data) => {
  if (!data) return { success: false, message: "Not found" };
  try {
    const auth = await requireOwnCompany(data?.id);
    if (auth.error) return { success: false, message: auth.error };

    await connect();
    await CompanyModel.updateOne(
      { _id: createObjectId(auth.id) },
      { $set: { isActive: false, delete: true } }
    );
    return {
      success: true,
      message: "The Company has been deleted successfully",
    };
  } catch (error) {
    console.log("companyDelete error:", error?.message);
    return { success: false, message: "Error Occurred in server problem" };
  }
};

export const getCompanyById = async (id) => {
  try {
    const auth = await requireOwnCompany(id);
    if (auth.error) return { success: false, message: auth.error };

    await connect();
    const company = await CompanyModel.findById(createObjectId(auth.id)).lean();
    if (!company) return { success: false, message: "Company not found" };

    return { success: true, data: JSON.stringify(company) };
  } catch (error) {
    console.log("getCompanyById error:", error?.message);
    return { success: false, message: "Something went wrong" };
  }
};

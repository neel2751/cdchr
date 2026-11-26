import CompanyModel from "@/models/companyModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import RoleTypesModel from "@/models/roleTypeModel";
import TenantMembershipModel from "@/models/tenantMembershipModel";
import { runWithTenant } from "@/lib/tenantContext";
import { resolveTerms } from "@/data/terminology";
import { addStarterCategories } from "../weeklyRotaServer/rotaCategoryStore";

/**
 * A new company and the person who runs it, made together — for self-serve
 * signup (authServer/signupServer.js) and for a company the platform admin
 * creates (provisionServer.js), so the two cannot drift apart.
 *
 * Five kinds of record, in the caller's transaction so a failure half way cannot
 * leave a company nobody can sign in to:
 *   the company;
 *   its first department — OfficeEmploye.department is required, so the
 *     owner cannot exist without one, and "Management" is a fair default;
 *   the owner's employee record, as super admin;
 *   the starter weekly rota categories;
 *   the membership that lets that login reach the company.
 *
 * NOT "use server": it trusts what it is given. Callers check who is asking.
 */

export const FIRST_DEPARTMENT = "Management";

/**
 * @param {object} o
 * @param {object} o.company     the company's fields (name, slug, status, …)
 * @param {object} o.owner       { name, email, phoneNumber, passwordHash, mustChangePassword? }
 * @param {boolean} [o.isDefault] where this login lands after signing in —
 *   true for someone's first company, false for another one of theirs
 * @param {import("mongoose").ClientSession} o.session
 * @returns {Promise<{ company: object, owner: object }>}
 */
export async function createCompanyWithOwner({ company, owner, isDefault = true, session }) {
  const [created] = await CompanyModel.create(
    [{ domains: [], isActive: true, delete: false, ...company }],
    { session }
  );

  // tenantId is set explicitly on each document as well as scoping the
  // block: the plugin stamps from context, but being explicit means a record
  // can never land in the wrong company even if context is lost.
  return runWithTenant(String(created._id), async () => {
    const [department] = await RoleTypesModel.create(
      [
        {
          tenantId: created._id,
          roleTitle: FIRST_DEPARTMENT,
          roleDescription: "Created with the workspace",
        },
      ],
      { session }
    );

    const [person] = await OfficeEmployeeModel.create(
      [
        {
          tenantId: created._id,
          name: owner.name,
          email: owner.email,
          phoneNumber: owner.phoneNumber,
          // Already hashed — never re-hash.
          password: owner.passwordHash,
          mustChangePassword: owner.mustChangePassword === true,
          department: department._id,
          roleType: FIRST_DEPARTMENT,
          company: created._id,
          employeType: "Full-Time",
          immigrationType: "British",
          joinDate: new Date(),
          countryOfWork: "United Kingdom",
          isActive: true,
          // The owner runs the company. Hard-coded, never taken from a form.
          isAdmin: true,
          isSuperAdmin: true,
          delete: false,
        },
      ],
      { session }
    );

    // The weekly rota's choices, in the company's words — "Office / Class"
    // for a tuition centre — so a rota can be made on day one. The company
    // changes them on the rota screen (lib/rotaCategories.js).
    await addStarterCategories(resolveTerms(created), { tenantId: created._id, session });

    await TenantMembershipModel.create(
      [
        {
          userId: person._id,
          userModel: "OfficeEmploye",
          email: owner.email,
          tenantId: created._id,
          role: "superAdmin",
          isDefault,
          isActive: true,
        },
      ],
      { session }
    );

    return { company: created, owner: person };
  });
}

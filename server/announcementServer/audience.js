/**
 * Turning an announcement's audience into people, and back again.
 *
 * Two directions are needed and they must agree:
 *
 *   resolveAudience()   audience -> the people in it. Used for the recipient
 *                       count, the read/ack report, and email and push fan-out.
 *
 *   visibilityFilter()  a person -> the announcements addressed to them, as a
 *                       Mongo filter. Used on every recipient page load.
 *
 * The second is deliberately not "resolve every announcement's audience and
 * check whether I am in it" — that would run one audience query per
 * announcement on every page view. Because the audience is stored as a mode
 * plus a list, the question inverts into a single indexed `$or`.
 *
 * The cost of the inversion is that the two directions could disagree, which is
 * why role derivation lives in one function that both of them call, and why the
 * test suite cross-checks every audience against every employee.
 *
 * TWO POPULATIONS
 * Office staff (OfficeEmploye) and field staff (Employe) are separate
 * collections with independent id spaces, so an id alone does not identify a
 * person — everything here carries a `kind` of "office" or "field". Field staff
 * are opt-in per announcement (`audience.includeField`), because most messages
 * are for the office and the two groups read them in different apps.
 *
 * Plain functions, no "use server" — this file is imported by server actions,
 * it is not one itself.
 */

import EmployeModel from "@/models/employeModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";

/** Office staff who are currently employed. */
const ACTIVE_OFFICE = { isActive: true, delete: { $ne: true } };
/** Field staff who are currently employed. Same two flags, same meaning. */
const ACTIVE_FIELD = { isActive: true, delete: { $ne: true } };

/**
 * The role an office employee holds, derived the same way sign-in derives it
 * (server/authServer/authServer.js): two booleans, super admin winning.
 *
 * Note a multi-company login's *session* role comes from TenantMembership and
 * can differ from these flags. This is the tenant-local answer, which is the
 * right one here: an announcement addressed to "admins at Acme" means the
 * people Acme's own records call admins.
 */
export function roleOfOfficeEmployee(employee) {
  if (employee?.isSuperAdmin) return "superAdmin";
  if (employee?.isAdmin) return "admin";
  return "user";
}

/** Field staff all sign in as the same role. */
export const FIELD_ROLE = "siteEmployee";

/** The inverse: a Mongo match selecting office employees holding `role`. */
function officeMatchForRole(role) {
  switch (role) {
    case "superAdmin":
      return { isSuperAdmin: true };
    case "admin":
      return { isAdmin: true, isSuperAdmin: { $ne: true } };
    case "user":
      return { isAdmin: { $ne: true }, isSuperAdmin: { $ne: true } };
    default:
      // An unrecognised role must match nobody rather than everybody.
      return { _id: null };
  }
}

const toOid = (v) => (isValidObjectId(v) ? createObjectId(v) : null);
const oids = (list) => (Array.isArray(list) ? list.map(toOid).filter(Boolean) : []);

/** Ids hand-picked for one population. */
function pickedIds(audience, kind) {
  return oids(
    (audience?.people || [])
      .filter((p) => (p?.kind || "office") === kind)
      .map((p) => p?.employeeId)
  );
}

/**
 * The OfficeEmploye filter for an audience.
 *
 * Returns null when the audience selects no office staff — an empty department
 * list, say, or a site-targeted announcement. Callers must treat null as "none
 * from this population" and NOT fall through to a bare ACTIVE query, which
 * would mail the whole company.
 */
export function buildOfficeQuery(audience) {
  const mode = audience?.mode || "all";

  if (mode === "all") return { ...ACTIVE_OFFICE };

  if (mode === "roles") {
    // siteEmployee is a field-only role; it selects no office staff.
    const roles = (audience?.roles || []).filter(
      (r) => r && r !== FIELD_ROLE
    );
    if (!roles.length) return null;
    return { ...ACTIVE_OFFICE, $or: roles.map(officeMatchForRole) };
  }

  if (mode === "departments") {
    const departments = oids(audience?.departments);
    if (!departments.length) return null;
    return { ...ACTIVE_OFFICE, department: { $in: departments } };
  }

  if (mode === "people") {
    const ids = pickedIds(audience, "office");
    if (!ids.length) return null;
    // Deliberately not filtered by ACTIVE: someone hand-picked these people, and
    // silently dropping one because a flag changed is worse than including them.
    return { _id: { $in: ids } };
  }

  // Office staff are not assigned to a project site, so a site audience is
  // field-only by definition.
  return null;
}

/**
 * The Employe (field staff) filter for an audience.
 *
 * Field staff are included only when the announcement opted in, EXCEPT for the
 * two modes that name them directly: hand-picking a field employee, or
 * targeting a site, both plainly mean to reach them.
 */
export function buildFieldQuery(audience) {
  const mode = audience?.mode || "all";
  const optedIn = !!audience?.includeField;

  if (mode === "people") {
    const ids = pickedIds(audience, "field");
    return ids.length ? { _id: { $in: ids } } : null;
  }

  if (mode === "sites") {
    const sites = oids(audience?.sites);
    if (!sites.length) return null;
    // The employee's assigned site, not the day's rota. SiteAssignment answers
    // "who is on this site today", which would make an announcement's audience
    // — and so its recipient count and read report — change overnight.
    return { ...ACTIVE_FIELD, projectSite: { $in: sites } };
  }

  if (!optedIn) return null;

  if (mode === "all") return { ...ACTIVE_FIELD };

  if (mode === "roles") {
    // Field staff hold exactly one role, so they are in a role audience only if
    // that role was picked.
    return (audience?.roles || []).includes(FIELD_ROLE)
      ? { ...ACTIVE_FIELD }
      : null;
  }

  // Departments are an office-side structure; field staff have none.
  return null;
}

/**
 * The people an audience covers, across both populations.
 * @returns {Promise<Array<{kind:string, employeeId:any, name:string, email:string}>>}
 */
export async function resolveAudience(audience) {
  const officeQuery = buildOfficeQuery(audience);
  const fieldQuery = buildFieldQuery(audience);

  const [office, field] = await Promise.all([
    officeQuery
      ? OfficeEmployeeModel.find(officeQuery).select("_id name email").lean()
      : [],
    fieldQuery
      ? EmployeModel.find(fieldQuery)
          .select("_id firstName lastName email")
          .lean()
      : [],
  ]);

  return [
    ...office.map((p) => ({
      kind: "office",
      employeeId: p._id,
      name: p.name,
      email: p.email,
    })),
    ...field.map((p) => ({
      kind: "field",
      employeeId: p._id,
      name: [p.firstName, p.lastName].filter(Boolean).join(" "),
      email: p.email,
    })),
  ];
}

/** How many people an audience covers, without loading them. */
export async function countAudience(audience) {
  const officeQuery = buildOfficeQuery(audience);
  const fieldQuery = buildFieldQuery(audience);

  const [office, field] = await Promise.all([
    officeQuery ? OfficeEmployeeModel.countDocuments(officeQuery) : 0,
    fieldQuery ? EmployeModel.countDocuments(fieldQuery) : 0,
  ]);

  return office + field;
}

/**
 * The announcements addressed to one person, as a filter fragment.
 *
 * Mirrors buildOfficeQuery/buildFieldQuery from the other side. Every branch
 * here must have a counterpart there, or the count on the author's report will
 * not match who can actually read it.
 *
 * @param {{employeeId:any, kind:string, role:string, departmentId?:any, siteId?:any}} viewer
 */
export function visibilityFilter(viewer) {
  const employeeId = toOid(viewer?.employeeId);
  const departmentId = toOid(viewer?.departmentId);
  const siteId = toOid(viewer?.siteId);
  const isField = viewer?.kind === "field";

  const clauses = [];

  if (isField) {
    // Field staff see the broad audiences only when the author opted them in.
    clauses.push({ "audience.mode": "all", "audience.includeField": true });
    clauses.push({
      "audience.mode": "roles",
      "audience.includeField": true,
      "audience.roles": FIELD_ROLE,
    });
    if (siteId) {
      // Site mode needs no opt-in: naming a site is naming field staff.
      clauses.push({ "audience.mode": "sites", "audience.sites": siteId });
    }
  } else {
    clauses.push({ "audience.mode": "all" });
    clauses.push({ "audience.mode": "roles", "audience.roles": viewer?.role });
    if (departmentId) {
      clauses.push({
        "audience.mode": "departments",
        "audience.departments": departmentId,
      });
    }
  }

  if (employeeId) {
    clauses.push({
      "audience.mode": "people",
      "audience.people": {
        // Matched as a pair: the two collections have independent id spaces, so
        // an id alone could match the wrong person in the other population.
        $elemMatch: {
          employeeId,
          kind: isField ? "field" : "office",
        },
      },
    });
  }

  return { $or: clauses };
}

/**
 * The viewer, as both sides of this file understand them.
 *
 * Reads the role off the employee record rather than trusting the session's,
 * so that "admins" means the same set of people to visibilityFilter() as it
 * does to buildOfficeQuery(). Returns null when the id belongs to neither
 * population in this tenant.
 *
 * @param {string} userId
 * @param {string} [hint] "office" | "field" — the session's employeType, when
 *   known, so the usual case is one query rather than two.
 */
export async function getViewer(userId, hint) {
  const oid = toOid(userId);
  if (!oid) return null;

  const lookupOffice = async () => {
    const employee = await OfficeEmployeeModel.findById(oid)
      .select("_id name email department isAdmin isSuperAdmin")
      .lean();
    if (!employee) return null;
    return {
      kind: "office",
      employeeId: employee._id,
      name: employee.name,
      email: employee.email,
      departmentId: employee.department || null,
      siteId: null,
      role: roleOfOfficeEmployee(employee),
    };
  };

  const lookupField = async () => {
    const employee = await EmployeModel.findById(oid)
      .select("_id firstName lastName email projectSite")
      .lean();
    if (!employee) return null;
    return {
      kind: "field",
      employeeId: employee._id,
      name: [employee.firstName, employee.lastName].filter(Boolean).join(" "),
      email: employee.email,
      departmentId: null,
      siteId: employee.projectSite || null,
      role: FIELD_ROLE,
    };
  };

  if (hint === "field") return (await lookupField()) || lookupOffice();
  if (hint === "office") return (await lookupOffice()) || lookupField();

  // No hint: office first, since that is the larger caller.
  return (await lookupOffice()) || lookupField();
}

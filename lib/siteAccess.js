import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import RoleBasedModel from "@/models/rolebasedModel";
import SiteAssignManagerModel from "@/models/siteAssignManagerModel";
import { getServerSideProps } from "@/server/session/session";

/**
 * Which sites the caller may see and act on.
 *
 * The companion to permissionRefusal() and canManageAttendance(). Those answer
 * "may you use this screen at all"; this answers "for which sites". Until now
 * only the site *dropdown* asked that second question — the site board, the
 * attendance report, assignment and moves took whatever site id the browser
 * sent, and "All" meant every site in the company. A site manager limited to
 * one site in the picker could read and change every other site's attendance
 * by calling the action directly.
 *
 * WHO SEES EVERY SITE
 *   - a super admin, who holds everything by definition;
 *   - reception, for reading only — the front desk scans whoever arrives;
 *   - anyone granted a company-wide site screen (SITE_WIDE_PERMISSIONS).
 *     Holding the Site Managers screen means you can make yourself manager of
 *     any site, so limiting such a person would be decorative.
 *
 * The admin ROLE alone is not enough, for the reason getAllSiteAssign() gives:
 * "admin" covers everyone from HR to a site manager, and a check on it makes
 * the permission an administrator actually grants decorative.
 *
 * WHO SEES SOME SITES
 *   Everyone else sees the sites they manage, through a manager link that is
 *   switched on, not deleted, has started, and has not ended. The dates on the
 *   link were stored and never read; a manager whose end date had passed kept
 *   their site.
 *
 * A SITE EMPLOYEE sees only their own records, on any site, and changes none.
 *
 * Deliberately NOT a "use server" module: it backs authorisation decisions,
 * and exporting it from a server-action file would publish it as an endpoint.
 */

export const SITE_WIDE_PERMISSIONS = [
  "/admin/siteProject",
  "/admin/siteAssign",
  "/admin/employee",
];

function startOfUtcDay(now) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * The caller and the sites open to them.
 *
 * `null` when there is no usable session. Otherwise:
 *   all       every site in the company
 *   readOnly  may look but not change (reception)
 *   selfOnly  may see their own records only (a site employee)
 *   siteIds   the sites managed, as strings, when `all` is false
 *
 * @returns {Promise<{user: object, all: boolean, readOnly: boolean, selfOnly: boolean, siteIds: string[]} | null>}
 */
export async function getSiteScope(now = new Date()) {
  let user;
  try {
    const { props } = await getServerSideProps();
    user = props?.session?.user;
  } catch {
    return null;
  }
  if (!user?._id) return null;

  const scope = (fields) => ({
    user,
    all: false,
    readOnly: false,
    selfOnly: false,
    siteIds: [],
    ...fields,
  });

  if (user.role === "superAdmin") return scope({ all: true });
  if (user.role === "reception") return scope({ all: true, readOnly: true });
  if (user.role === "siteEmployee") {
    return scope({ readOnly: true, selfOnly: true });
  }
  if (!isValidObjectId(user._id)) return null;

  try {
    await connect();
    const employeeId = createObjectId(user._id);

    const roleRows = await RoleBasedModel.find({
      employeeId,
      isActive: { $ne: false },
      isDeleted: { $ne: true },
    })
      .select("permissions")
      .lean();
    const held = roleRows.flatMap((row) => row?.permissions || []);
    if (SITE_WIDE_PERMISSIONS.some((path) => held.includes(path))) {
      return scope({ all: true });
    }

    // A link counts from its start date through the whole of its end date.
    const links = await SiteAssignManagerModel.find({
      roleId: employeeId,
      isActive: true,
      isDelete: { $ne: true },
      startDate: { $lte: now },
      $or: [
        { endDate: null },
        { endDate: { $gte: startOfUtcDay(now) } },
      ],
    })
      .select("projectSiteID")
      .lean();

    const siteIds = [
      ...new Set(
        links
          .map((link) => link.projectSiteID?.toString())
          .filter(Boolean),
      ),
    ];
    return scope({ siteIds });
  } catch (error) {
    // Fails CLOSED, like permissionRefusal(): this decides whose attendance
    // somebody may read and change.
    console.log("getSiteScope error:", error?.message);
    return null;
  }
}

/**
 * Refuse `siteId` unless the scope covers it. `write` also refuses scopes that
 * may only look. Returns the refusal, or null when allowed.
 *
 * A self-only scope passes any site for reading: the caller must also pin the
 * query to `scope.user._id`, which is what makes it theirs.
 */
export function siteRefusal(scope, siteId, { write = false } = {}) {
  if (!scope) return { success: false, message: "Not signed in" };
  if (write && (scope.readOnly || scope.selfOnly)) {
    return { success: false, message: "You are not allowed to change this" };
  }
  if (scope.all) return null;
  if (scope.selfOnly) return null;
  const id = siteId ? String(siteId) : "";
  if (id && scope.siteIds.includes(id)) return null;
  return { success: false, message: "You do not manage this site" };
}

/**
 * A `siteId` match for queries the caller left unfiltered, or undefined when
 * the scope covers every site. "All" means all of *my* sites.
 */
export function scopedSiteMatch(scope) {
  if (!scope || scope.all || scope.selfOnly) return undefined;
  return { $in: scope.siteIds.map((id) => createObjectId(id)) };
}


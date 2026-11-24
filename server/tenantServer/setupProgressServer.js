"use server";

import { connect } from "@/db/db";
import { isValidObjectId } from "@/lib/mongodb";
import { escapeTenant } from "@/lib/tenantContext";
import { isFeatureEnabled } from "@/lib/tenantPlan";
import { withAudit, recordAudit } from "@/lib/audit";
import { fillTerms, resolveTerms } from "@/data/terminology";
import { getServerSideProps } from "../session/session";
import CompanyModel from "@/models/companyModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";
import RoleBasedModel from "@/models/rolebasedModel";
import ProjectSiteModel from "@/models/siteProjectModel";
import SiteAssignManagerModel from "@/models/siteAssignManagerModel";
import LeaveSettingModel from "@/models/leaveSettingModel";
import EmailAccountModel from "@/models/emailAccountmodel";
import ClockLocationModel from "@/models/clockLocationModel";
import ClockTagModel from "@/models/clockTagModel";
import TagOrderModel from "@/models/tagOrderModel";

/**
 * The setup checklist a new company's owner works through: branding, email,
 * staff, places, leave, clock-in, NFC tags.
 *
 * Most steps are worked out from the company's own data — "add your staff" is
 * done when there is more than the owner — so the list cannot fall out of step
 * with reality, and an established company that set things up before the list
 * existed sees them ticked. A few steps are reviews with nothing to count ("is
 * the form right for you?"); those are ticked by the person, as are optional
 * steps they skip. Both are kept on the company (setupProgress.marks).
 *
 * Only a super admin of the company sees or changes it: it is about setting
 * the company up, and it points at screens only they can use.
 */

/**
 * The steps, in the order to do them. `title` and `body` take
 * data/terminology.js tokens. `feature` hides a step from a company without
 * that module. `optional` steps can be skipped; `review` steps have nothing to
 * count and are ticked by hand.
 */
const STEPS = [
  {
    key: "industry",
    group: "Your company",
    title: "Choose your industry and words",
    body: "What your screens call {sites} and the people at them.",
    href: "/admin/settings",
  },
  {
    key: "branding",
    group: "Your company",
    title: "Add your logo and app name",
    body: "So the app, its emails and its sign-in page look like yours.",
    href: "/admin/settings",
  },
  {
    key: "plan",
    group: "Your company",
    title: "Choose your plan",
    body: "Compare the packages and see what yours would cost.",
    href: "/admin/plan",
  },
  {
    key: "form",
    group: "Your company",
    title: "Check the {siteEmployee} form",
    body: "Pay, right to work, guardians, medical notes — keep what you need.",
    href: "/admin/settings",
    feature: "siteEmployees",
    review: true,
  },
  {
    key: "email",
    group: "Your company",
    title: "Connect your email",
    body: "Send invites, payslips and reminders from your own address.",
    href: "/admin/email",
    optional: true,
  },
  {
    key: "staff",
    group: "Your people",
    title: "Add your office staff",
    body: "Everyone who works for the company directly.",
    href: "/admin/officeEmployee",
  },
  {
    key: "permissions",
    group: "Your people",
    title: "Give staff access to screens",
    body: "Decide who can see attendance, leave, {sites} and the rest.",
    href: "/admin/permissions",
  },
  {
    key: "sites",
    group: "Your people",
    title: "Add your {sites}",
    body: "Where people work or attend.",
    href: "/admin/siteProject",
    feature: "siteProjects",
  },
  {
    key: "siteEmployees",
    group: "Your people",
    title: "Add your {siteEmployees}",
    body: "The people who work or attend at your {sites}.",
    href: "/admin/employee",
    feature: "siteEmployees",
  },
  {
    key: "managers",
    group: "Your people",
    title: "Choose your {siteManagers}",
    body: "Who runs each {site}, and sees it on their own page.",
    href: "/admin/siteAssign",
    feature: "siteProjects",
    optional: true,
  },
  {
    key: "leave",
    group: "Time and attendance",
    title: "Set up leave",
    body: "Your leave year, leave types and allowances.",
    href: "/admin/leaveManagement/setup",
    feature: "leave",
  },
  {
    key: "clockIn",
    group: "Time and attendance",
    title: "Choose how people clock in",
    body: "QR code, Wi-Fi, location or NFC tag, for each place.",
    href: "/admin/clockSettings",
    review: true,
  },
  {
    key: "nfc",
    group: "Time and attendance",
    title: "Order NFC tags",
    body: "Tap-to-clock-in tags for the door. Only if you want them.",
    href: "/admin/clockSettings",
    optional: true,
  },
];

async function requireOwner() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return { error: "Not signed in" };
  if (user.role !== "superAdmin" || !isValidObjectId(user.tenantId)) {
    return { error: "Only the company's super admin sets it up" };
  }
  return { user, tenantId: String(user.tenantId) };
}

async function readCompany(tenantId) {
  return escapeTenant("setup: company settings", () =>
    CompanyModel.findById(tenantId)
      .select(
        "industry terms branding fieldBlocks managerRules features setupProgress status billing.planAppliedAt"
      )
      .lean()
  );
}

/** Which steps the data already shows as done. */
async function doneFromData(company) {
  const has = (value) => value && Object.keys(value).length > 0;
  const [
    staff,
    grants,
    sites,
    siteStaff,
    managers,
    leave,
    emailAccounts,
    clockMethods,
    tags,
    tagOrders,
  ] = await Promise.all([
    OfficeEmployeeModel.countDocuments({ delete: { $ne: true } }),
    RoleBasedModel.countDocuments({ isDeleted: { $ne: true } }),
    ProjectSiteModel.countDocuments({ siteDelete: { $ne: true } }),
    EmployeModel.countDocuments({ delete: { $ne: true } }),
    SiteAssignManagerModel.countDocuments({ isDelete: { $ne: true } }),
    LeaveSettingModel.findOne({}).select("configuredAt").lean(),
    EmailAccountModel.countDocuments({}),
    ClockLocationModel.countDocuments({ "methods.mode": { $in: ["shadow", "enforce"] } }),
    ClockTagModel.countDocuments({}),
    TagOrderModel.countDocuments({}),
  ]);

  return {
    // Stored rather than defaulted: a company that never chose has none.
    industry: Boolean(company?.industry),
    branding: Boolean(company?.branding?.appName || company?.branding?.logoUrl),
    // On a package, or a paying customer from before packages existed.
    plan:
      Boolean(company?.billing?.planAppliedAt) ||
      (company?.status || "active") === "active",
    form: has(company?.fieldBlocks) || has(company?.managerRules),
    email: emailAccounts > 0,
    // The owner is the first; staff means somebody else.
    staff: staff > 1,
    permissions: grants > 0,
    sites: sites > 0,
    siteEmployees: siteStaff > 0,
    managers: managers > 0,
    leave: Boolean(leave?.configuredAt),
    clockIn: clockMethods > 0,
    nfc: tags > 0 || tagOrders > 0,
  };
}

/**
 * The checklist for the signed-in owner's company.
 *
 * Each step: `done` (by the data or ticked), `skipped`, and whether it can be
 * ticked (`review`) or skipped (`optional`) by hand.
 */
export async function getSetupProgress() {
  try {
    const auth = await requireOwner();
    if (auth.error) return { success: false, message: auth.error };

    await connect();
    const company = await readCompany(auth.tenantId);
    if (!company) return { success: false, message: "Company not found" };

    const terms = resolveTerms(company);
    const fromData = await doneFromData(company);
    const marks = company.setupProgress?.marks || {};

    const steps = STEPS.filter((s) =>
      isFeatureEnabled(company.features, s.feature)
    ).map((s) => {
      const mark = marks[s.key];
      return {
        key: s.key,
        group: s.group,
        title: fillTerms(s.title, terms),
        body: fillTerms(s.body, terms),
        href: s.href,
        optional: Boolean(s.optional),
        review: Boolean(s.review),
        done: fromData[s.key] || mark === "done",
        skipped: !fromData[s.key] && mark === "skipped",
      };
    });

    const finished = steps.filter((s) => s.done || s.skipped).length;
    return {
      success: true,
      data: JSON.stringify({
        steps,
        finished,
        total: steps.length,
        hidden: Boolean(company.setupProgress?.hidden),
      }),
    };
  } catch (error) {
    console.log("getSetupProgress error:", error?.message);
    return { success: false, message: "Could not load the setup checklist" };
  }
}

/**
 * Tick a review step, skip an optional one, or clear either (`mark: null`).
 * A step the data already shows as done needs neither.
 */
export const markSetupStep = withAudit(
  "Tenant.setupStep",
  async ({ key, mark } = {}) => {
    try {
      const auth = await requireOwner();
      if (auth.error) return { success: false, message: auth.error };

      const step = STEPS.find((s) => s.key === key);
      if (!step) return { success: false, message: "Unknown step" };
      if (mark === "done" && !step.review && !step.optional) {
        return {
          success: false,
          message: "This one ticks itself once it is done",
        };
      }
      if (mark === "skipped" && !step.optional) {
        return { success: false, message: "This step cannot be skipped" };
      }
      if (mark !== null && mark !== "done" && mark !== "skipped") {
        return { success: false, message: "Unknown mark" };
      }

      await connect();
      const update =
        mark === null
          ? { $unset: { [`setupProgress.marks.${key}`]: "" } }
          : { $set: { [`setupProgress.marks.${key}`]: mark } };
      await CompanyModel.updateOne({ _id: auth.tenantId }, update);

      recordAudit({
        module: "Tenant",
        entityId: auth.tenantId,
        after: { step: key, mark },
        description: `Setup checklist: ${key} ${mark || "cleared"}`,
      });
      return { success: true, message: mark ? `Marked ${mark}` : "Cleared" };
    } catch (error) {
      console.log("markSetupStep error:", error?.message);
      return { success: false, message: "Could not save that" };
    }
  },
  { module: "Tenant" }
);

/** Put the checklist away, or bring it back. */
export async function setSetupChecklistHidden(hidden) {
  try {
    const auth = await requireOwner();
    if (auth.error) return { success: false, message: auth.error };
    await connect();
    await CompanyModel.updateOne(
      { _id: auth.tenantId },
      { $set: { "setupProgress.hidden": Boolean(hidden) } }
    );
    return { success: true, message: hidden ? "Checklist hidden" : "Checklist shown" };
  } catch (error) {
    console.log("setSetupChecklistHidden error:", error?.message);
    return { success: false, message: "Could not save that" };
  }
}

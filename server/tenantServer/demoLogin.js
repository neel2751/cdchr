import { connect } from "@/db/db";
import { isValidObjectId } from "@/lib/mongodb";
import CompanyModel from "@/models/companyModel";
import TenantMembershipModel from "@/models/tenantMembershipModel";

/**
 * Does this login reach demo companies and nothing else?
 *
 * A demo login (scripts/seed-demo.mjs) is shared with every customer it is
 * shown to, so it cannot be tied to one person's authenticator app — the
 * two-factor setup that every admin is otherwise made to do is skipped for it
 * (auth.js). That is only safe while EVERY company the login can reach is a
 * demo: view-only, made-up people, nothing to steal. One real company among
 * them — someone adds the demo email to a real company, or uses their own
 * email for the demo — and this says no, so two-factor is back from the next
 * sign-in.
 *
 * Fails closed: any doubt, any error, means "no".
 *
 * NOT "use server": it answers for whatever account it is given.
 *
 * @param {{ tenantId?: string, email?: string }} user
 */
export async function reachesOnlyDemoCompanies(user) {
  try {
    if (!user?.tenantId || !isValidObjectId(user.tenantId)) return false;
    await connect();
    const email = String(user.email || "").trim().toLowerCase();
    // Every company the switcher would offer (membershipServer.js matches by
    // email as well as id), and the one they are signing in to.
    const memberships = email
      ? await TenantMembershipModel.find({ email, isActive: true }).select("tenantId").lean()
      : [];
    const ids = [...new Set([String(user.tenantId), ...memberships.map((m) => String(m.tenantId))])];
    const companies = await CompanyModel.find({ _id: { $in: ids } })
      .select("billing.demo")
      .lean();
    return companies.length === ids.length && companies.every((c) => c.billing?.demo === true);
  } catch (error) {
    console.log("reachesOnlyDemoCompanies failed:", error?.message);
    return false;
  }
}

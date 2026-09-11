import { connect } from "@/db/db";
import { getServerSideProps } from "@/server/session/session";
import { getTenantFeatures } from "@/lib/tenantFeatures";
import { isFeatureEnabled } from "@/lib/tenantPlan";

/**
 * Refuse a server action when the company's plan excludes its module.
 *
 * proxy.js guards *navigation*. Every server action is also a POST endpoint
 * that can be called directly, so a module hidden from the sidebar was still
 * fully operable by anyone who knew the action's name. This closes that, and
 * generalises what `requireExpenseAccess` in server/expenseServer has been doing
 * alone since expenses shipped.
 *
 * Returns the refusal rather than throwing, because every action in this
 * codebase reports failure as `{ success: false, message }` and callers unwrap
 * that shape (hooks/use-query.js). Throwing would surface as a generic client
 * error instead of a sentence the user can read.
 *
 * Usage — one line at the top of an action:
 *
 *   const refusal = await featureRefusal("siteProjects");
 *   if (refusal) return refusal;
 *
 * Deliberately NOT a "use server" module, for the same reason as
 * lib/tenantFeatures.js and lib/tenantAssets.js: this backs an authorisation
 * decision, and exporting it from a server-action file would publish it as an
 * endpoint of its own.
 *
 * This checks the *plan*, not the person. Whether the caller is allowed to use
 * a module their company does have is a separate question, still answered by
 * each module's own role/permission guard.
 *
 * @param {string} key a key from data/features.js
 * @returns {Promise<{success: false, message: string}|null>} null when allowed
 */
export async function featureRefusal(key) {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;

  // No session is not this function's refusal to make — the action's own auth
  // guard says that, and says it in its own words. Answering "not included in
  // your plan" to a signed-out caller would be a misleading message and would
  // also change what actions return for unauthenticated calls.
  if (!user?._id) return null;

  // Before the feature lookup, not after: getTenantFeatures() swallows its own
  // errors and answers "everything on", so an unconnected first call would skip
  // the plan check rather than fail visibly.
  await connect();

  const features = await getTenantFeatures(user.tenantId);
  if (isFeatureEnabled(features, key)) return null;

  return {
    success: false,
    message: "This module is not included in your plan.",
  };
}

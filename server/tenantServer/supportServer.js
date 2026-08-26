"use server";

import { connect } from "@/db/db";
import CompanyModel from "@/models/companyModel";
import SupportSessionModel from "@/models/supportSessionModel";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { isTenantUsable } from "@/lib/tenant";
import { allowWrite, escapeTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import { getServerSideProps } from "../session/session";

/**
 * Support visits: a platform admin looking at one company's data, read-only.
 *
 * Three things make this safe enough to exist:
 *   - it is time-boxed, and the record — not the cookie — decides whether a
 *     visit is still live
 *   - every query made during it is read-only, enforced under Mongoose in
 *     lib/tenantPlugin.js rather than at each call site
 *   - starting and ending are audited against the company, with a reason
 */

// How long a visit lasts before it stops on its own. Not exported: a
// "use server" module may only export async functions.
const SUPPORT_SESSION_MINUTES = 30;
const MAX_MINUTES = 120;

async function requirePlatformAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user) return { error: "Not signed in" };
  if (user.role !== "platformAdmin") return { error: "Not authorised" };
  return { user };
}

/**
 * Begin a visit. Creates the record; the session itself is switched by the jwt
 * callback in auth.js, which reads this collection — the browser cannot name
 * the company it wants to enter.
 */
export async function startSupportSession(tenantId, reason, minutes) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(tenantId)) {
      return { success: false, message: "Invalid company" };
    }

    const why = String(reason || "").trim();
    if (why.length < 5) {
      return {
        success: false,
        message: "Give a reason — it is recorded against the company.",
      };
    }

    const mins = Math.min(
      MAX_MINUTES,
      Math.max(5, parseInt(minutes, 10) || SUPPORT_SESSION_MINUTES)
    );

    await connect();
    const tenant = await CompanyModel.findById(tenantId).select("name status isActive delete").lean();
    if (!tenant) return { success: false, message: "Company not found" };
    if (!isTenantUsable(tenant)) {
      return { success: false, message: "That company is not active" };
    }

    // One visit at a time: a second would make "which company am I in" depend
    // on ordering.
    await allowWrite("support: close any earlier visit", () =>
      SupportSessionModel.updateMany(
        { platformUserId: createObjectId(auth.user._id), endedAt: null },
        { $set: { endedAt: new Date() } }
      )
    );

    const expiresAt = new Date(Date.now() + mins * 60 * 1000);
    await allowWrite("support: open a visit", () =>
      SupportSessionModel.create({
        platformUserId: createObjectId(auth.user._id),
        platformUserEmail: auth.user.email,
        tenantId: createObjectId(tenantId),
        tenantName: tenant.name,
        reason: why,
        expiresAt,
      })
    );

    await logAuditDirect({
      actor: {
        _id: auth.user._id,
        name: auth.user.name,
        email: auth.user.email,
        role: "platformAdmin",
      },
      action: "Platform.startSupportSession",
      module: "Platform",
      tenantId,
      entityId: tenantId,
      description: `Started a ${mins}-minute read-only support session on ${tenant.name}: ${why}`,
      after: { reason: why, expiresAt: expiresAt.toISOString(), readOnly: true },
    });

    return {
      success: true,
      message: `Read-only session on ${tenant.name} for ${mins} minutes`,
      data: JSON.stringify({ tenantId: String(tenantId), expiresAt }),
    };
  } catch (error) {
    console.log("startSupportSession error:", error?.message);
    return { success: false, message: "Could not start the session" };
  }
}

/** End the visit now. Writable during read-only — see allowWrite. */
export async function endSupportSession() {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user;
    if (!user?._id) return { success: false, message: "Not signed in" };

    await connect();
    const active = await escapeTenant("support: find the active visit", () =>
      SupportSessionModel.findActiveFor(createObjectId(user._id))
    );

    if (active) {
      await allowWrite("support: end the visit", () =>
        SupportSessionModel.updateOne(
          { _id: active._id },
          { $set: { endedAt: new Date() } }
        )
      );

      await logAuditDirect({
        actor: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: "platformAdmin",
        },
        action: "Platform.endSupportSession",
        module: "Platform",
        tenantId: String(active.tenantId),
        entityId: String(active.tenantId),
        description: `Ended the support session on ${active.tenantName}`,
      });
    }

    return { success: true, message: "Support session ended" };
  } catch (error) {
    console.log("endSupportSession error:", error?.message);
    return { success: false, message: "Could not end the session" };
  }
}

/**
 * The visit currently in force for an account, or null.
 * Used by auth.js on every session update — the record is the authority.
 */
export async function activeSupportSession(platformUserId) {
  if (!isValidObjectId(platformUserId)) return null;
  await connect();
  return escapeTenant("support: check the active visit", () =>
    SupportSessionModel.findActiveFor(createObjectId(platformUserId))
  );
}

/** Recent visits to a company, for the platform console. */
export async function listSupportSessions(tenantId) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(tenantId)) {
      return { success: false, message: "Invalid company" };
    }

    await connect();
    const rows = await escapeTenant("platform: list support visits", () =>
      SupportSessionModel.find({ tenantId: createObjectId(tenantId) })
        .sort({ startedAt: -1 })
        .limit(20)
        .lean()
    );

    return {
      success: true,
      data: JSON.stringify(
        rows.map((r) => ({
          _id: String(r._id),
          email: r.platformUserEmail,
          reason: r.reason,
          startedAt: r.startedAt,
          expiresAt: r.expiresAt,
          endedAt: r.endedAt || null,
          live: !r.endedAt && new Date(r.expiresAt) > new Date(),
        }))
      ),
    };
  } catch (error) {
    console.log("listSupportSessions error:", error?.message);
    return { success: false, message: "Could not load support sessions" };
  }
}

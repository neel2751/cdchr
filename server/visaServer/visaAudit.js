"use server";

import { logAuditDirect } from "@/lib/audit";
import { getServerSideProps } from "../session/session";

const toISO = (d) => (d ? new Date(d).toISOString() : null);

/**
 * Record a focused, append-only audit entry whenever an employee's visa-expiry
 * date actually changes. Keeps the full history (N changes => N rows) and is
 * filterable on the audit screen under module "Visa". No-op when unchanged.
 *
 * @param {Object} p
 * @param {Date|string|null} p.before  Previous visa date
 * @param {Date|string|null} p.after   New visa date
 * @param {"OfficeEmploye"|"Employe"} p.employeeType
 * @param {string} p.entityId          Employee id
 * @param {string} [p.name]            Employee name (for the description)
 */
export async function logVisaExpiryChange({
  before,
  after,
  employeeType,
  entityId,
  name,
}) {
  try {
    if (toISO(before) === toISO(after)) return; // unchanged

    let actor = { system: true };
    try {
      const { props } = await getServerSideProps();
      const u = props?.session?.user;
      if (u) {
        actor = { _id: u._id, name: u.name, email: u.email, role: u.role };
      }
    } catch {
      // no request context — fall back to system actor
    }

    await logAuditDirect({
      actor,
      action: "Visa.expiryChanged",
      module: "Visa",
      entityId,
      before: { visaEndDate: before || null },
      after: { visaEndDate: after || null },
      description: `Changed visa expiry for ${name || entityId}${
        employeeType === "Employe" ? " (field)" : ""
      }`,
      metadata: { employeeType },
    });
  } catch (e) {
    console.log("logVisaExpiryChange failed:", e?.message);
  }
}

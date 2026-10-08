import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";
import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { escapeTenant } from "@/lib/tenantContext";

// Used by middleware to terminate live sessions for accounts that have been
// deactivated / locked down, and to enforce the two password-reset options.
//
// Middleware runs on the edge, where Mongoose cannot, so anything it needs from
// the database has to come through a route like this one. That is why "sign out
// of all devices" is answered here rather than in the jwt callback: the jwt
// callback that runs during ordinary navigation is the *edge* copy in
// auth.config.js, which never touches the database, so a live cookie would
// otherwise sail past a reset indefinitely.
//
// Fails open (returns active) on any error so a transient problem can never
// lock everyone out.
export async function POST(req) {
  try {
    const { employeeId } = await req.json();
    if (!employeeId || !mongoose.Types.ObjectId.isValid(employeeId)) {
      return NextResponse.json({ isActive: true }, { status: 200 });
    }
    await connect();
    // Same reasoning as /api/role: proxy.js calls this without a cookie, so
    // there is no tenant. Pinned to the employeeId from the caller's own token.
    // Both collections: the reset dialog serves office and site staff alike, so
    // a site employee looked up only in `officeemployes` came back as "not
    // found" and was waved through with no flags at all.
    const emp = await escapeTenant("proxy: account status by employeeId", async () => {
      const projection = "isActive delete sessionsValidFrom mustChangePassword";
      return (
        (await OfficeEmployeeModel.findById(employeeId).select(projection).lean()) ||
        (await EmployeModel.findById(employeeId).select(projection).lean())
      );
    });
    if (!emp) {
      return NextResponse.json({ isActive: true }, { status: 200 });
    }
    const isActive = emp.isActive !== false && emp.delete !== true;
    return NextResponse.json(
      {
        isActive,
        // Milliseconds, so middleware can compare against the token's `iat`
        // without parsing a date on the edge.
        sessionsValidFrom: emp.sessionsValidFrom
          ? new Date(emp.sessionsValidFrom).getTime()
          : null,
        mustChangePassword: emp.mustChangePassword === true,
      },
      { status: 200 }
    );
  } catch (error) {
    console.log("account/status error:", error?.message);
    return NextResponse.json({ isActive: true }, { status: 200 });
  }
}

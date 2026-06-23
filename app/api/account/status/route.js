import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import mongoose from "mongoose";
import { NextResponse } from "next/server";

// Used by middleware to terminate live sessions for accounts that have been
// deactivated / locked down. Fails open (returns active) on any error so a
// transient problem can never lock everyone out.
export async function POST(req) {
  try {
    const { employeeId } = await req.json();
    if (!employeeId || !mongoose.Types.ObjectId.isValid(employeeId)) {
      return NextResponse.json({ isActive: true }, { status: 200 });
    }
    await connect();
    const emp = await OfficeEmployeeModel.findById(employeeId)
      .select("isActive delete")
      .lean();
    if (!emp) {
      return NextResponse.json({ isActive: true }, { status: 200 });
    }
    const isActive = emp.isActive !== false && emp.delete !== true;
    return NextResponse.json({ isActive }, { status: 200 });
  } catch (error) {
    console.log("account/status error:", error?.message);
    return NextResponse.json({ isActive: true }, { status: 200 });
  }
}

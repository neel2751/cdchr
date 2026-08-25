import { connect } from "@/db/db";
import RoleBasedModel from "@/models/rolebasedModel";
import SiteAssignManagerModel from "@/models/siteAssignManagerModel";
import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { escapeTenant } from "@/lib/tenantContext";

export async function POST(req) {
  const { employeeId } = await req.json();

  if (!employeeId) {
    return NextResponse.json(
      {
        message: "Employee ID is required",
      },
      { status: 400 }
    );
  }

  // we have to check this id is monggose id or not
  const isMongooseId = mongoose.Types.ObjectId.isValid(employeeId);
  if (!isMongooseId) {
    return NextResponse.json(
      {
        message: "Invalid Employee ID",
      },
      { status: 400 }
    );
  }

  try {
    await connect();
    // const findSite = await SiteAssignManagerModel.findOne({

    // Called by proxy.js over HTTP, which does not forward the session cookie,
    // so there is no tenant to derive. Safe because the lookup is pinned to a
    // single employeeId taken from that user's own signed token.
    const role = await escapeTenant("proxy: permission lookup by employeeId", () =>
      RoleBasedModel.findOne({
        employeeId,
        isActive: true,
        isDeleted: false,
      })
    );

    if (!role) {
      return NextResponse.json(
        { error: "Role not found for the given employee" },
        { status: 404 }
      );
    }

    return NextResponse.json(role, { status: 200 });
  } catch (error) {
    console.log(error);
    return NextResponse.json(
      {
        error: "Failed to fetch role",
      },
      { status: 500 }
    );
  }
}

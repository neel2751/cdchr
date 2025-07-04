import { connect } from "@/db/db";
import RoleBasedModel from "@/models/rolebasedModel";
import SiteAssignManagerModel from "@/models/siteAssignManagerModel";
import mongoose from "mongoose";
import { NextResponse } from "next/server";

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

    const role = await RoleBasedModel.findOne({
      employeeId,
      isActive: true,
      isDeleted: false,
    });

    if (!role) {
      return NextResponse.json(
        { error: "Role not found for the given employee" },
        { status: 404 }
      );
    }

    return NextResponse.json(role, { status: 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: "Failed to fetch role",
      },
      { status: 500 }
    );
  }
}

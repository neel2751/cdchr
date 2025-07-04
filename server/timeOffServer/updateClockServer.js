"use server";
import { createObjectId, withTransaction } from "@/lib/mongodb";
import ClockModel from "@/models/clockModel";
import SiteAssignmentModel from "@/models/siteAssignmentModel";
import SiteClockModel from "@/models/siteClockModel";
import { getServerSideProps } from "../session/session";

export const updateClockManuallyById = async ({
  id = null,
  employeeId,
  siteId,
  date,
  clockIn,
  clockOut,
  breakIn,
  breakOut,
  status,
  actions = [],
  type = "site", // or 'site'
}) => {
  // if (!id) return { success: false, message: "Clock ID is required" };

  // console.log(id, employeeId, clockIn, type, siteId, date);
  // return {
  //   success: false,
  //   message: "This function is deprecated. Use the new API.",
  // };
  if (type !== "site" && type !== "office") {
    return { success: false, message: "Invalid type specified" };
  }
  if (type === "site" && !siteId) {
    return { success: false, message: "siteId is required for site type" };
  }
  if (!id && (!employeeId || !date)) {
    return {
      success: false,
      message: "Either ID or employeeId, and date are required",
    };
  }
  const model = type === "site" ? SiteClockModel : ClockModel;

  try {
    const updateFields = {};
    if (clockIn !== undefined) updateFields.clockIn = clockIn;
    if (clockOut !== undefined) updateFields.clockOut = clockOut;
    if (breakIn !== undefined) updateFields.breakIn = breakIn;
    if (breakOut !== undefined) updateFields.breakOut = breakOut;
    if (status !== undefined) updateFields.status = status;

    const updateQuery = {
      $set: updateFields,
    };
    if (actions.length > 0) {
      updateQuery.$push = {
        actions: { $each: actions }, // append all actions at once
      };
    }
    let updated;

    if (id) {
      updated = await model.findByIdAndUpdate(createObjectId(id), updateQuery, {
        new: true,
      });
    } else {
      const normalizedDate = date;
      updated = await model.findOneAndUpdate(
        {
          employeeId: createObjectId(employeeId),
          // on site type, siteId is required
          ...(type === "site" && { siteId: createObjectId(siteId) }),
          date: normalizedDate,
        },
        {
          ...updateQuery,
          $setOnInsert: {
            employeeId,
            siteId: type === "site" ? createObjectId(siteId) : undefined,
            date: normalizedDate,
          },
        },
        { new: true, upsert: true }
      );
    }

    if (!updated) {
      return { success: false, message: "Clock entry not found or failed" };
    }

    return {
      success: true,
      message: id ? "Clock updated successfully" : "Clock created successfully",
    };
  } catch (err) {
    console.error("updateClockManuallyById error:", err);
    return { success: false, message: "Failed to update or create clock" };
  }
};

export async function moveEmployeeToNewSite({ employeeId, toSiteId, date }) {
  return withTransaction(async (session) => {
    const { props } = await getServerSideProps();
    const movedBy = props?.session?.user?._id;
    const assignDate = new Date(date);
    const eid = createObjectId(employeeId);
    const toSid = createObjectId(toSiteId);

    // Step 1: Find current assignment based on employeeId and date
    const fromAssignment = await SiteAssignmentModel.findOne({
      assignDate,
      "assignedEmployees.employeeId": eid,
    }).session(session);

    if (!fromAssignment) {
      throw new Error("Employee is not assigned on this date.");
    }

    const fromSiteId = fromAssignment.siteId;
    const assignedEmployee = fromAssignment.assignedEmployees.find((e) =>
      e.employeeId.equals(eid)
    );

    if (assignedEmployee?.isLocked) {
      throw new Error("Employee is locked (already clocked in), cannot move.");
    }

    // Step 2: Check if already assigned to target site
    const toAssignmentExists = await SiteAssignmentModel.findOne({
      siteId: toSid,
      assignDate,
      "assignedEmployees.employeeId": eid,
    }).session(session);

    if (toAssignmentExists) {
      throw new Error(
        "Employee is already assigned to the target site on this date."
      );
    }
    // Step 3: Remove employee from the current site assignment
    await SiteAssignmentModel.updateOne(
      { siteId: fromSiteId, assignDate },
      { $pull: { assignedEmployees: { employeeId: eid } } },
      { session }
    );

    // Step 4: Add to new site (safe insert/update)
    const existingTargetDoc = await SiteAssignmentModel.findOne({
      siteId: toSid,
      assignDate,
    }).session(session);

    if (existingTargetDoc) {
      await SiteAssignmentModel.updateOne(
        { siteId: toSid, assignDate },
        {
          $push: {
            assignedEmployees: {
              employeeId: eid,
              assignedBy: movedBy,
              assignedAt: new Date(),
              isLocked: false,
            },
          },
        },
        { session }
      );
    } else {
      const newAssignment = new SiteAssignmentModel({
        siteId: toSid,
        assignDate,
        assignedEmployees: [
          {
            employeeId: eid,
            assignedBy: movedBy,
            assignedAt: new Date(),
            isLocked: false,
          },
        ],
      });
      await newAssignment.save({ session });
    }

    // Step 5: Verify move
    const afterMoveCheck = await SiteAssignmentModel.findOne({
      siteId: toSid,
      assignDate,
      "assignedEmployees.employeeId": eid,
    }).session(session);

    if (!afterMoveCheck) {
      throw new Error("Failed to move employee to target site.");
    }

    // Step 6: Update siteId in SiteClockModel
    await SiteClockModel.updateMany(
      { employeeId: eid, date: assignDate },
      { $set: { siteId: toSid } },
      { session }
    );
    return { success: true, message: "Employee moved successfully." };
  });
}

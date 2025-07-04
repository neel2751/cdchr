"use server";
import Leave from "@/class/leaveClass";
import { connect } from "@/db/db";
import { getLeaveYearString } from "@/lib/getLeaveYear";
import AttendanceCategoryModel from "@/models/attendanceCategoryModel";
import CommonLeaveModel from "@/models/commonLeaveModel";
import LeaveCategoryModel from "@/models/leaveCategoryModel";

export async function getAttendanceCategories(filterData) {}

export async function handleAttendanceCategory(data, id) {
  if (!data) return { success: false, message: "No data provided" };
  try {
    await connect();
    // we have to chcek if the attendance category already exists by name
    if (id) {
      await AttendanceCategoryModel.findByIdAndUpdate(id, data, {
        new: true,
      });
      return {
        success: true,
        message: "Attendance Category updated successfully",
      };
    } else {
      const existingCategory = await AttendanceCategoryModel.findOne({
        attendanceCategoryName: data.attendanceCategoryName,
        attendanceCategoryValue: data.attendanceCategoryValue,
      });
      if (existingCategory)
        return {
          success: false,
          message: "Attendance Category already exists",
        };
      await AttendanceCategoryModel.create(data);
      return {
        success: true,
        message: "Attendance Category created successfully",
      };
    }
  } catch (error) {
    console.log(" Error creating attendance category", error);
    return { success: false, message: "Error creating attendance category" };
  }
}
export async function fetchLeaveCategory() {
  try {
    await connect();
    const leaveCategories = await LeaveCategoryModel.find({
      isDeleted: false,
    }).sort({
      updatedAt: 1,
    });
    return { success: true, data: JSON.stringify(leaveCategories) };
  } catch (error) {
    console.log(" Error fetching leave categories", error);
    return { success: false, message: "Error fetching leave categories" };
  }
}

export async function handleLeaveCategory(data, id) {
  // we have to make this session because if anything happen so we have to do maunally
  // To do make a session with transaction

  if (!data) return { success: false, message: "No data provided" };
  // if (data?.total <= 0) return { success: false, message: "Check your inputs" };
  try {
    const isPaid = data?.isPaid === "Paid" ? true : false;
    const isHide = data?.isHide === "Hide" ? true : false;
    await connect();
    // we have to chcek if the attendance category already exists by name
    if (id) {
      const existingCategory = await LeaveCategoryModel.findById(id);
      // const updateQuery = {
      //   leaveYear: getLeaveYearString(new Date()),
      //   "leaveData.leaveType": existingCategory?.leaveType,
      // };
      // const updatePayload = {
      //   $set: {
      //     "leaveData.$.leaveType": data?.leaveType,
      //     "leaveData.$.total": data?.total,
      //   },
      // };
      // await CommonLeaveModel.updateMany( updateQuery, updatePayload, { multi: true } );

      await CommonLeaveModel.updateMany(
        {
          leaveYear: getLeaveYearString(new Date()),
          "leaveData.leaveType": existingCategory?.leaveType,
        },
        [
          {
            $set: {
              leaveData: {
                $map: {
                  input: "$leaveData",
                  as: "item",
                  in: {
                    $cond: [
                      {
                        $eq: ["$$item.leaveType", existingCategory?.leaveType],
                      },
                      {
                        leaveType: data?.leaveType,
                        total: Number(data?.total),
                        used: "$$item.used",
                        remaining: {
                          $subtract: [Number(data?.total), "$$item.used"],
                        },
                        type: "$$item.type",
                        isHide: isHide,
                        isPaid: isPaid,
                      },
                      "$$item", // Keep as is if not matching
                    ],
                  },
                },
              },
            },
          },
        ]
      );
      await LeaveCategoryModel.findByIdAndUpdate(id, data, {
        new: true,
      });
      return {
        success: true,
        message: "Leave Category updated successfully",
      };
    } else {
      const existingCategory = await LeaveCategoryModel.findOne({
        leaveType: data?.leaveType,
      });
      if (existingCategory)
        return {
          success: false,
          message: "Leave Category already exists",
        };
      const response = await LeaveCategoryModel.create(data);
      if (response._id) {
        const newLeave = new Leave({
          leaveType: response.leaveType,
          total: response?.total,
          isHide,
          isPaid,
          used: 0,
          remaining: 0,
          type: "days",
        });
        await CommonLeaveModel.updateMany({
          $push: {
            leaveData: {
              ...newLeave,
            },
          },
        });
      } else {
        return { success: false, message: "Error while creating..." };
      }
      return {
        success: true,
        message: "Leave Category created successfully",
      };
    }
  } catch (error) {
    console.log(" Error creating leave category", error);
    return { success: false, message: "Error creating Leave category" };
  }
}

export const leaveCategoryStatus = async (data) => {
  if (!data) return { success: false, message: "Not found" };
  try {
    const id = data?.id;
    const isActive = !data?.status;
    await LeaveCategoryModel.updateOne({ _id: id }, { $set: { isActive } });
    return {
      success: true,
      message: "The Status has been updated successfully",
    };
  } catch (error) {
    console.log(error);
    return { success: false, message: `Error Occurred in server problem` };
  }
};

export const leaveCategoryDelete = async (data) => {
  if (!data) return { success: false, message: "Not found" };
  try {
    const id = data?.id;
    const isActive = false;
    const isDelete = true;
    await LeaveCategoryModel.updateOne(
      { _id: id },
      { $set: { isActive, isDeleted: isDelete } }
    );
    return {
      success: true,
      message: " The Leave Category has been deleted successfully",
    };
  } catch (error) {
    console.log(error);
    return { success: false, message: `Error Occurred in server problem` };
  }
};

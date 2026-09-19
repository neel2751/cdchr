"use server";
import { getServerSideProps } from "../session/session";
import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import LeaveRequestModel from "@/models/leaveRequestModel";
import { decrypt } from "@/lib/algo";
import { hashPassword, isMatchedPassword } from "@/utils/bcrypt";
import { createObjectId } from "@/lib/mongodb";
import DocumentModel from "@/models/document/documentModel";
import { deleteFileFromS3 } from "../aws/upload";
import EmployeModel from "@/models/employeModel";
import { getLeaveYearString } from "@/lib/getLeaveYear";
import RoleBasedModel from "@/models/rolebasedModel";
import {
  getEmployeeManageAccess,
  resolveEmployeeTarget,
} from "@/lib/employeeAccess";

/**
 * decrypt() throws on a tampered or malformed token rather than returning
 * false, and every caller here is about to hand the result to an access check
 * that treats a missing id as "use your own". Swallowing the throw keeps that
 * path intact instead of surfacing a decryption error to the user.
 */
function safeDecrypt(value) {
  if (!value) return null;
  try {
    return decrypt(value) || null;
  } catch {
    return null;
  }
}

export async function extractData(params) {
  try {
    const { props } = await getServerSideProps();
    const { role, _id } = props?.session?.user;
    const res = decrypt(params[0]);
    // we have to check the role here if they have permission to view other employee data
    if (role === "superAdmin") return res;
    const roles = await RoleBasedModel.find({
      employeeId: _id,
      isDeleted: false,
    })
      .lean()
      .exec();
    const permissions = roles.flatMap((r) => r.permissions);
    if (!permissions.includes("/admin/officeEmployee")) {
      return _id; // return their own ID if they don't have permission
    }
    // if they have permission, return the decrypted ID from params
    return res;
  } catch (error) {
    console.error(error);
  }
}

export async function employeeDeatils(params) {
  try {
    const employeeId = await extractData(params);
    await connect();
    const pipeline = [
      {
        $match: {
          _id: createObjectId(employeeId),
        },
      },
      {
        $lookup: {
          from: "roletypes",
          localField: "department",
          foreignField: "_id",
          as: "departmentview",
        },
      },
      {
        $lookup: {
          from: "companies",
          localField: "company",
          foreignField: "_id",
          as: "companys",
        },
      },
      {
        $replaceRoot: {
          newRoot: {
            // remove password
            $mergeObjects: [
              "$$ROOT",
              {
                departmentView: {
                  $arrayElemAt: ["$departmentview.roleTitle", 0],
                },
              },
              // send company name and _id under one company object
              {
                companyName: {
                  $arrayElemAt: ["$companys.name", 0],
                },
              },
            ],
          },
        },
      },
      // Bank details and the NI number are released only through
      // revealSensitiveDetails(), which re-checks permission and password.
      {
        $unset: [
          "password",
          "departmentview",
          "companys",
          "bankDetail",
          "employeNI",
        ],
      },
    ];
    // we have to set the signal as well in this case
    const employeeDeatils = await OfficeEmployeeModel.aggregate(pipeline);
    return { success: true, data: JSON.stringify(employeeDeatils[0]) };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Error fetching employee details" };
  }
}

export async function employeeLeaveDetailsNew(data) {
  try {
    const { props } = await getServerSideProps();
    const { role, _id } = props?.session?.user;
    const params = data?.searchParams;
    const employeeId = role === "superAdmin" ? await extractData(params) : _id;
    const leaveYear = data?.leaveYear;
    if (!employeeId) return { success: false, message: "User not found" };
    await connect();
    const checkLeaveYear = leaveYear || getLeaveYearString(new Date());
    const match = {
      leaveYear: checkLeaveYear,
      employeeId: createObjectId(employeeId),
    };
    const lookup = {
      from: "officeemployes",
      localField: "employeeId",
      foreignField: "_id",
      as: "employees",
    };

    const approveLookup = {
      from: "officeemployes",
      localField: "approvedBy",
      foreignField: "_id",
      as: "admin",
    };

    const pipeline = [
      { $match: match },
      { $sort: { leaveSubmitDate: -1 } },
      { $lookup: lookup },
      { $lookup: approveLookup },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              "$$ROOT",
              {
                employee: {
                  name: { $arrayElemAt: ["$employees.name", 0] },
                  role: { $arrayElemAt: ["$employees.roleType", 0] },
                },
                approvedBy: {
                  name: { $arrayElemAt: ["$admin.name", 0] },
                },
              },
            ],
          },
        },
      },
      { $unset: ["employees", "admin"] },
    ];

    const leaveData = await LeaveRequestModel.aggregate(pipeline);
    return { success: true, data: JSON.stringify(leaveData) };
  } catch (error) {
    console.log("Get Leave Request Data for Admin", error);
    return { success: false, message: "Failed to get leave request data" };
  }
}

export async function employeeLeaveDetails(params) {
  try {
    const employeeId = await extractData(params);
    await connect();
    const pipeline = [
      {
        $match: {
          employeeId: createObjectId(employeeId),
          leaveYear: new Date().getFullYear(),
        },
      },
    ];
    const leaveDetails = await LeaveRequestModel.aggregate(pipeline);
    console.log(leaveDetails);
    return { success: true, data: JSON.stringify(leaveDetails) };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Error fetching employee leave details" };
  }
}

// updateOfficeEmployeeData() was removed here. Nothing in the application
// called it — the employee edit form goes through handleOfficeEmployee() in
// officeServer.js — but it was an exported server action, which is an
// addressable endpoint whether or not a button points at it, and it took an
// employee id and an arbitrary payload from its caller and assigned the payload
// straight onto the record. Deleting it is the fix; the live path is
// authorised in officeServer.js.

export async function changeOfficeEmployeePassword(data, id) {
  if (!data) return { success: false, message: "No Data Provided" };
  const { props } = await getServerSideProps();
  const { role, _id } = props?.session?.user;
  const employeeId = role === "superAdmin" ? decrypt(id) : _id;
  if (!employeeId) return { success: false, message: "User not found" };
  const { password: currentPassword, newPassword } = data;
  if (role !== "superAdmin" && role !== "admin") {
    if (!currentPassword)
      return { success: false, message: "Current Password is required" };
  }
  if (!newPassword)
    return { success: false, message: "New Password is required" };
  try {
    await connect();
    const updatedEmp = await OfficeEmployeeModel.findOne({
      _id: employeeId,
    }).exec();
    if (!updatedEmp) {
      return { success: false, message: "Employee Not Found" };
    }
    // if the user is not superAdmin or admin, check for current password
    if (role !== "superAdmin" && role !== "admin") {
      const isMatch = await isMatchedPassword(
        currentPassword,
        updatedEmp.password
      );
      if (!isMatch) {
        return { success: false, message: "Current Password is Incorrect" };
      }
    }
    const hashedPassword = await hashPassword(newPassword);
    if (!hashedPassword) {
      return { success: false, message: "Error Hashing Password" };
    }
    updatedEmp.password = hashedPassword; // Update the password with the new hashed password
    // Whatever brought them here, they have now chosen their own password, so
    // the forced-change gate in proxy.js lets them back into the app. Without
    // this they would set a new password and still be redirected here — a loop
    // with no way out.
    updatedEmp.mustChangePassword = false;
    const updatedData = await updatedEmp.save();
    if (!updatedData) {
      return { success: false, message: "Error Updating Password" };
    }
    return { success: true, message: "Password Changed Successfully" };
  } catch (error) {
    console.log("Error in changeOfficeEmployeePassword:", error);
    return { success: false, message: "Error Changing Password" };
  }
}

export async function changeEmployeePassword(data, id) {
  if (!data) return { success: false, message: "No Data Provided" };
  const { props } = await getServerSideProps();
  const { role, _id } = props?.session?.user;
  const employeeId = role === "superAdmin" ? decrypt(id) : _id;
  if (!employeeId) return { success: false, message: "User not found" };
  const { password: currentPassword, newPassword } = data;
  if (role !== "superAdmin" && role !== "admin") {
    if (!currentPassword)
      return { success: false, message: "Current Password is required" };
  }
  if (!newPassword)
    return { success: false, message: "New Password is required" };
  try {
    await connect();
    const updatedEmp = await EmployeModel.findOne({
      _id: employeeId,
    }).exec();
    if (!updatedEmp) {
      return { success: false, message: "Employee Not Found" };
    }
    // if the user is not superAdmin or admin, check for current password
    if (role !== "superAdmin" && role !== "admin") {
      const isMatch = await isMatchedPassword(
        currentPassword,
        updatedEmp.password
      );
      if (!isMatch) {
        return { success: false, message: "Current Password is Incorrect" };
      }
    }
    const hashedPassword = await hashPassword(newPassword);
    if (!hashedPassword) {
      return { success: false, message: "Error Hashing Password" };
    }
    updatedEmp.password = hashedPassword; // Update the password with the new hashed password
    // Whatever brought them here, they have now chosen their own password, so
    // the forced-change gate in proxy.js lets them back into the app. Without
    // this they would set a new password and still be redirected here — a loop
    // with no way out.
    updatedEmp.mustChangePassword = false;
    const updatedData = await updatedEmp.save();
    if (!updatedData) {
      return { success: false, message: "Error Updating Password" };
    }
    return { success: true, message: "Password Changed Successfully" };
  } catch (error) {
    console.log("Error in changeEmployeePassword:", error);
    return { success: false, message: "Error Changing Password" };
  }
}

export async function deleteOfficeEmployee(id) {
  if (!id) return { success: false, message: "No Employee ID Provided" };
  try {
    await connect();
    const employeeId = decrypt(id);
    const updatedEmp = await OfficeEmployeeModel.findOneAndUpdate(
      { _id: employeeId },
      { isDeleted: true },
      { new: true }
    ).exec();
    if (!updatedEmp) {
      return { success: false, message: "Employee Not Found" };
    }
    return { success: true, message: "Employee Deleted Successfully" };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Error Deleting Employee" };
  }
}

/**
 * Remove files that reached S3 before the upload was rejected, so a refused
 * upload does not leave objects behind that nothing references.
 *
 * Awaited as a batch: the callers previously used `forEach(async ...)`, which
 * fires each delete without awaiting any of them and returns before they
 * settle. A rejected delete is logged rather than thrown — failing to tidy up
 * must not change the message the caller gets back.
 */
async function discardUploadedFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return;
  const results = await Promise.allSettled(
    files.filter((file) => file?.key).map((file) => deleteFileFromS3(file.key))
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.log("Failed to remove orphaned upload:", result.reason?.message);
    }
  }
}

export async function uploadDocument(data) {
  if (!data) return { success: false, message: "No Data Provided" };
  // Filing a document against somebody's record is an HR act: the file becomes
  // part of what the company holds about them. An employee who wants something
  // added asks for it to be added. Without this the action took an employeeId
  // from its caller, so any session could file anything against anyone.
  const { user, canManage } = await getEmployeeManageAccess();
  if (!user?._id) return { success: false, message: "Not signed in" };
  if (!canManage) {
    await discardUploadedFiles(data?.documentsFiles);
    return {
      success: false,
      message: "Only HR can add documents to an employee record",
    };
  }
  const { _id } = user;
  const { employeeId, title, docType, documentsFiles } = data;
  try {
    await connect();

    // Checked up front for both paths. This used to live inside the "no
    // existing record" branch only, so an upload onto an employee who already
    // had documents skipped validation and could store a file with no title.
    if (!title || !docType || !documentsFiles || documentsFiles.length === 0) {
      await discardUploadedFiles(documentsFiles);
      return {
        success: false,
        message: "Title, DocType and Files are required",
      };
    }

    // The employee's document record, whatever state its files are in. This
    // deliberately does NOT require a live file via `$elemMatch`: once every
    // file had been deleted the record stopped matching, and the upload below
    // created a second record for the same employee.
    const docuemntData = await DocumentModel.findOne({
      employeeId: createObjectId(employeeId),
      isDeleted: false,
    });

    // Only a file that is still there can clash. Deleting a document is a soft
    // delete — the entry stays in `documentsFiles` with `isDeleted: true` — so
    // without this check a deleted title could never be reused, even though it
    // is gone from the employee's file list. Archived files keep
    // `isDeleted: false` and stay visible, so they still block a reused title.
    const hasLiveDuplicate = docuemntData?.documentsFiles?.some(
      (file) => !file.isDeleted && file.title === title && file.docType === docType
    );

    if (hasLiveDuplicate) {
      await discardUploadedFiles(documentsFiles);
      return {
        success: false,
        message: "Document with this title and type already exists",
      };
    }
    if (docuemntData) {
      // If document already exists, update it
      docuemntData.documentsFiles.push(
        ...documentsFiles.map((file) => ({
          fileName: file.fileName,
          title: title,
          docType,
          key: file.key,
          access: file.access,
          fileSize: file.fileSize,
          fileType: file.fileType,
          employeeId: createObjectId(employeeId),
          uploadedAt: new Date(),
          uploadedBy: _id ? createObjectId(_id) : employeeId, // Use _id if available, else use employeeId
        }))
      );
      const updatedDocument = await docuemntData.save();
      if (!updatedDocument) {
        return { success: false, message: "Error Updating Document" };
      }
      return { success: true, data: JSON.stringify(updatedDocument) };
    } else {
      // If document does not exist, create a new one
      const newDocument = new DocumentModel({
        employeeId: createObjectId(employeeId),
        documentsFiles: documentsFiles.map((file) => ({
          fileName: file.fileName,
          title: title,
          docType,
          key: file.key,
          access: file.access,
          fileSize: file.fileSize,
          fileType: file.fileType,
          employeeId: createObjectId(employeeId),
          uploadedAt: new Date(),
          uploadedBy: _id ? createObjectId(_id) : employeeId, // Use _id if available, else use employeeId
        })),
      });
      const savedDocument = await newDocument.save();
      if (!savedDocument) {
        return { success: false, message: "Error Saving Document" };
      }
      return { success: true, data: JSON.stringify(savedDocument) };
    }
  } catch (error) {
    console.log(error);
    return { success: false, message: "Error Uploading Document" };
  }
}

export async function getEmployeeDocuments(params) {
  if (!params) return { success: false, message: "No Params Provided" };
  // The slug is the only thing naming whose documents these are, and it comes
  // from the caller. Anyone without a staff-management permission is pinned to
  // their own id — the rule extractData() already applies to profile reads.
  const { employeeId } = await resolveEmployeeTarget(safeDecrypt(params.slug));
  if (!employeeId) return { success: false, message: "User not found" };
  try {
    await connect();
    const pipeline = [
      {
        $match: {
          employeeId: createObjectId(employeeId),
          isDeleted: false,
        },
      },
      {
        $unwind: "$documentsFiles",
      },
      {
        $match: {
          "documentsFiles.isDeleted": false, // Only include files that are not deleted
        },
      },
      // Group by employeeId and document type
      {
        $group: {
          _id: "$_id",
          employeeId: { $first: "$employeeId" },
          docType: { $first: "$docType" },
          description: { $first: "$description" },
          documentsFiles: { $push: "$documentsFiles" }, // Collect all files in an array
          createdAt: { $first: "$createdAt" },
          updatedAt: { $first: "$updatedAt" },
        },
      },
      {
        $project: {
          _id: 1,
          employeeId: 1,
          docType: 1,
          description: 1,
          documentsFiles: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    ];
    const documents = await DocumentModel.aggregate(pipeline);
    return { success: true, data: JSON.stringify(documents) };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Error Fetching Employee Documents" };
  }
}

export async function deleteEmployeeDocument(data) {
  if (!data) return { success: false, message: "No Data Provided" };
  const { documentId, fileKey } = data;
  if (!documentId || !fileKey) {
    return { success: false, message: "Document ID and File Key are required" };
  }
  // Same reasoning as uploadDocument: a document on file is the company's
  // record, not the employee's copy of it, so removing one is an HR act. The
  // pair of ids here names a file directly and belongs to nobody in
  // particular, which is exactly why the caller has to be checked.
  const { user, canManage } = await getEmployeeManageAccess();
  if (!user?._id) return { success: false, message: "Not signed in" };
  if (!canManage) {
    return {
      success: false,
      message: "Only HR can remove documents from an employee record",
    };
  }
  try {
    await connect();
    // Delete the file from S3

    // Update the document in the database
    const updatedDocument = await DocumentModel.findOneAndUpdate(
      {
        "documentsFiles._id": documentId,
        "documentsFiles.key": fileKey,
      },
      {
        $set: {
          "documentsFiles.$.isDeleted": true,
        },
      },
      { new: true }
    ).exec();

    if (!updatedDocument) {
      return {
        success: false,
        message: "Document Not Found or Already Deleted",
      };
    }
    // If the document has no more files, delete the document itself
    // This is optional, this only for hard delete the document
    // await deleteFileFromS3(fileKey);

    return { success: true, message: "Document Deleted Successfully" };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Error Deleting Document" };
  }
}

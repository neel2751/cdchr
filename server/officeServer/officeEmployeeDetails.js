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
      {
        $unset: ["password", "departmentview", "companys"],
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

export async function updateOfficeEmployeeData(data) {
  if (!data) return { success: false, message: "No Data Provided" };
  const { employeeId: id, tab } = data;
  try {
    const updatedEmp = await OfficeEmployeeModel.findOne({ _id: id }).exec();
    if (id && tab === "basic") {
      // update an existing office employee
      if (!updatedEmp) {
        return { success: false, message: "Employee Not Found" };
      }
      // checking  for unique fields both email and phone
      const hasSameEmail = await OfficeEmployeeModel.findOne({
        email: data.email,
        delete: false, // only check for active employees
        _id: { $ne: id },
      }).exec();
      const hasSamePhone = await OfficeEmployeeModel.findOne({
        phoneNumber: data.phoneNumber,
        delete: false, // only check for active employees
        _id: { $ne: id },
      }).exec();
      if (hasSameEmail || hasSamePhone) {
        throw new Error("This Email or Phone Number is Already In Use");
      }
      // check password is hash or not

      Object.assign(updatedEmp, data);
      const updatedData = await updatedEmp.save();
      if (!updatedData)
        return { success: false, message: "Error Updating Employee" };
      return { success: true, data: JSON.stringify(updatedData) };
    } else {
      Object.assign(updatedEmp, data);
      const updatedData = await updatedEmp.save();
      if (!updatedData)
        return { success: false, message: "Error Updating Employee" };
      return { success: true, data: JSON.stringify(updatedData) };
    }
  } catch (error) {
    console.log(error.message);
    return {
      success: false,
      message: "Something went wrong on Office Employee",
    };
    // return {
    //   success: false,
    //   error: "Failed to create office employee",
    // };
  }
  // const isExists = await OfficeEmployeeModel.findOne({ email }).lean().exec();
}

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

export async function uploadDocument(data) {
  if (!data) return { success: false, message: "No Data Provided" };
  const { props } = await getServerSideProps();
  const { _id } = props?.session?.user;
  const { employeeId, title, docType, documentsFiles } = data;
  try {
    await connect();

    const docuemntData = await DocumentModel.findOne({
      employeeId: createObjectId(employeeId),
      isDeleted: false,
      // we have to check only document is not deleted
      documentsFiles: {
        $elemMatch: { isDeleted: false }, // Check if a document with the same title and type already exists and is not deleted
      },
      // documentsFiles: { $elemMatch: { fileName: title, docType } },
    });
    // Check if the document already exists for the employee
    if (
      docuemntData &&
      docuemntData.documentsFiles.some(
        (file) => file.title === title && file.docType === docType
      )
    ) {
      documentsFiles.forEach(async (file) => {
        console.log("Deleting file from S3:", file.key);
        await deleteFileFromS3(file.key);
      });
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
      if (
        !title ||
        !docType ||
        !documentsFiles ||
        documentsFiles.length === 0
      ) {
        documentsFiles.forEach(async (file) => {
          console.log("Deleting file from S3:", file.key);
          await deleteFileFromS3(file.key);
        });
        return {
          success: false,
          message: "Title, DocType and Files are required",
        };
      }
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
  const employeeId = decrypt(params.slug);
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
  console.log("Deleting Document:", documentId, fileKey);
  if (!documentId || !fileKey) {
    return { success: false, message: "Document ID and File Key are required" };
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

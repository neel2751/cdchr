"use server";
import { sendMail } from "../nodeMailerServer/nodemailerServer";
import { withTransaction } from "@/lib/mongodb";
import { decrypt, encrypt } from "@/lib/algo";
import EmailAccountModel from "@/models/emailAccountmodel";
import { connect } from "@/db/db";

export async function addSMTPAdvance(data, smtpId) {
  return withTransaction(async (sesssion) => {
    const {
      host,
      userName,
      password,
      port,
      icon,
      fromName,
      secure,
      isPrimary,
      feature,
      isTest,
      toEmail,
    } = data;

    if (smtpId) return await updateSMTPAdvance(smtpId, data);

    if (!host || !userName || !password) {
      throw new Error("All fields are required");
    }

    await connect();

    // Check if SMTP already exists
    const existingSMTP = await EmailAccountModel.findOne({
      host,
      userName,
    }).session(sesssion);
    if (existingSMTP) {
      throw new Error("SMTP already exists");
    }

    // Create new SMTP entry
    const smtpData = {
      host,
      otherHost: host === "other" ? data.otherHost : "", // Only set if host is 'other'
      userName,
      password,
      feature: feature || "All", // Default to empty string if not provided
      fromName: fromName, // Default fromName to userName if not provided
      port: port || 587, // Default SMTP port
      secure: secure || false, // Default to false if not provided
      isPrimary: isPrimary || false,
      isTest: isTest || false,
      toEmail: toEmail || userName, // Default to userName if toEmail not provided
      icon: icon || "",
    };
    const smtp = await EmailAccountModel.create([smtpData], {
      session: sesssion,
    });
    if (!smtp) throw new Error("Failed to add SMTP");

    if (smtp) {
      return { success: true, message: "SMTP added successfully" };
    } else {
      throw new Error("Failed to add SMTP");
    }
  });
}
export async function setPrimarySMTPAdvance(smtpId, feature) {
  try {
    if (!smtpId || !feature) {
      return { success: false, message: "smtpId and feature are required" };
    }
    // 1. Unset isPrimary for all EmailUsage entries of this feature
    await EmailAccountModel.updateMany(
      { feature, isPrimary: true },
      { $set: { isPrimary: false } }
    );
    // 2. Set isPrimary to true for this smtpId & feature
    const updatedUsage = await EmailAccountModel.findOneAndUpdate(
      { feature, _id: smtpId },
      { $set: { isPrimary: true } },
      { new: true }
    );
    if (updatedUsage) {
      return {
        success: true,
        message: "Primary SMTP set successfully",
        updatedUsage,
      };
    } else {
      return {
        success: false,
        message: "No EmailUsage found for this SMTP and feature",
      };
    }
  } catch (error) {
    console.error("Error setting primary SMTP:", error);
    return { success: false, message: "Error setting primary SMTP" };
  }
}
export async function getAllSMTPsAdvance({
  page = 1,
  limit = 20,
  includePassword = false,
  search, // new search string param
} = {}) {
  try {
    // Build initial match filter
    await connect();
    const matchStage = { isDeleted: false };

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), "i"); // case-insensitive

      // Add $or to match host or username
      matchStage.$or = [
        { host: { $regex: searchRegex } },
        { username: { $regex: searchRegex } },
      ];
    }

    const skip = (page - 1) * limit;

    const pipeline = [
      { $match: matchStage },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    const smtps = await EmailAccountModel.aggregate(pipeline);

    if (includePassword) {
      smtps.forEach((smtp) => {
        smtp.passwordDecrypted =
          smtp.passwordDecrypted || decrypt(smtp.password);
      });
    }

    // Count total matching documents (without pagination)
    const total = await EmailAccountModel.countDocuments(matchStage);

    return {
      success: true,
      data: JSON.stringify(smtps),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    console.error("Error fetching SMTPs with search:", error);
    return { success: false, message: "Error fetching SMTPs" };
  }
}
export async function updateSMTPStatusAdvance(smtpId, updateFields) {
  try {
    if (!smtpId) {
      return { success: false, message: "SMTP ID is required" };
    }

    if (
      !updateFields ||
      typeof updateFields !== "object" ||
      Object.keys(updateFields).length === 0
    ) {
      return { success: false, message: "No update fields provided" };
    }

    const allowedFields = ["isActive", "isDeleted"];
    // Filter out any fields not allowed to be updated here
    const fieldsToUpdate = {};
    for (const key of Object.keys(updateFields)) {
      if (allowedFields.includes(key)) {
        fieldsToUpdate[key] = updateFields[key];
      }
    }

    if (Object.keys(fieldsToUpdate).length === 0) {
      return { success: false, message: "No valid update fields provided" };
    }

    const updatedSMTP = await EmailAccountModel.findByIdAndUpdate(
      smtpId,
      fieldsToUpdate,
      { new: true }
    );

    if (updatedSMTP) {
      return {
        success: true,
        message: "SMTP updated successfully",
      };
    } else {
      return { success: false, message: "SMTP not found" };
    }
  } catch (error) {
    console.error("Error updating SMTP status:", error);
    return { success: false, message: "Error updating SMTP status" };
  }
}
export async function updateSMTPAdvance(smtpId, data) {
  if (!smtpId || !data) {
    return { success: false, message: "SMTP ID and data are required" };
  }
  try {
    const { host, userName, feature } = data;

    if (!host || !userName) {
      return { success: false, message: "Host and username are required" };
    }

    const existingSMTP = await EmailAccountModel.findOne({
      _id: { $ne: smtpId },
      host,
      username: userName, // be sure this matches your schema
      feature: feature || "All", // Default to 'All' if not provided
      isDeleted: false,
    });

    if (existingSMTP) {
      return {
        success: false,
        message: "SMTP with this host and username already exists",
      };
    }

    const smtpData = {
      ...data,
    };

    const updatedSMTP = await EmailAccountModel.findByIdAndUpdate(
      smtpId,
      smtpData,
      {
        new: true,
      }
    );

    if (updatedSMTP) {
      return {
        success: true,
        message: "SMTP updated successfully",
      };
    } else {
      return { success: false, message: "SMTP not found or update failed" };
    }
  } catch (error) {
    console.error("Error updating SMTP:", error);
    return { success: false, message: "Error updating SMTP" };
  }
}
export async function updateSMTPPassword(newData) {
  const { id: smtpId, newPassword } = newData;

  try {
    const decryptedId = decrypt(smtpId);
    if (!decryptedId) {
      return { success: false, message: "Invalid SMTP ID" };
    }

    if (!newPassword) {
      return { success: false, message: "New password is required" };
    }

    const smtp = await EmailAccountModel.findById(decryptedId);
    if (!smtp) {
      return { success: false, message: "SMTP not found" };
    }

    const decryptedPassword = decrypt(smtp.password);
    if (!decryptedPassword) {
      return { success: false, message: "Failed to decrypt current password" };
    }
    if (newPassword === decryptedPassword) {
      return {
        success: false,
        message: "New password cannot be the same as current password",
      };
    }

    const encryptedPassword = encrypt(newPassword);

    const updatedSMTP = await EmailAccountModel.findByIdAndUpdate(
      decryptedId,
      { password: encryptedPassword },
      { new: true }
    );

    if (updatedSMTP) {
      return { success: true, message: "SMTP password updated successfully" };
    } else {
      return { success: false, message: "SMTP not found or update failed" };
    }
  } catch (error) {
    console.error("Error updating SMTP password:", error);
    return { success: false, message: "Error updating SMTP password" };
  }
}
export async function getPrimarySMTPAdvance() {
  try {
    const primarySMTP = await EmailAccountModel.findOne({
      isPrimary: true,
      isDeleted: false,
    }).lean(); // Use lean() for better performance if you don't need mongoose doc methods

    if (primarySMTP) {
      // Decrypt password before returning
      if (primarySMTP.password) {
        primarySMTP.password = decrypt(primarySMTP.password);
      }

      return { success: true, data: JSON.stringify(primarySMTP) };
    } else {
      return { success: false, message: "No primary SMTP found" };
    }
  } catch (error) {
    console.error("Error fetching primary SMTP:", error);
    return { success: false, message: "Error fetching primary SMTP" };
  }
}
export async function testSMTPEmailAdvance(smtpId) {
  try {
    const smtp = await EmailAccountModel.findById(smtpId);
    if (!smtp) {
      return { success: false, message: "SMTP not found" };
    }

    // Decrypt password before use
    const decryptedPassword = decrypt(smtp.password);
    const data = {
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.secure, // true for 465, false for other ports
      userName: smtp.userName,
      password: decryptedPassword,
      fromName: `"Test SMTP" <${smtp.userName}>`,
      toEmail: smtp.userName, // Sending to the SMTP username for testing
      subject: "SMTP Test Email",
      text: "This is a test email sent to verify SMTP configuration.",
      html: "<p>This is a test email sent to verify SMTP configuration.</p>",
    };
    const result = await sendMail(data);
    if (result.success) {
      return { success: true, message: "Test email sent successfully" };
    }
    return { success: false, message: "Failed to send test email" };
  } catch (error) {
    console.error("Error testing SMTP email:", error);
    return { success: false, message: "Error testing SMTP email" };
  }
}
export async function getSMTPForFeature(feature) {
  // Get primary EmailUsage for the feature
  const smtp = await EmailAccountModel.findOne({
    feature,
    isPrimary: true,
    isDeleted: false,
    isActive: true,
  });
  if (!smtp) {
    throw new Error(`No primary SMTP configured for feature: ${feature}`);
  }
  // Decrypt password before use
  smtp.password = decrypt(smtp.password);
  return {
    success: true,
    data: JSON.stringify({ ...smtp, password: null }),
  };
}

export async function getOneSMTPEmail(smtpId) {
  try {
    if (!smtpId) return { success: false, message: "Id is required!" };
    const decryptedId = decrypt(smtpId);
    if (!decryptedId) return { success: false, message: "Id is not valid" };
    await connect();
    const smtp = await EmailAccountModel.findById(decryptedId);
    if (!smtp) return { success: false, message: "Data is not found" };
    return { success: true, data: JSON.stringify(smtp) };
  } catch (error) {
    console.log("Error on emailSMTP file under getOneSMTPEmail", error);
    return { success: false, message: "Something want wrong" };
  }
}

export async function testSMTPConnection(smtp) {
  try {
    const data = {
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.secure || false, // true for 465, false for other ports
      userName: smtp.userName,
      password: smtp.password ? decrypt(smtp.password) : "", // Decrypt if password is encrypted
      // password: smtp.password,
      fromName: `"Test SMTP" <${smtp.fromName}>`,
      toEmail: smtp.toEmail || smtp.userName, // Sending to the SMTP username for testing
      subject: "SMTP Test Email",
      text: "This is a test email sent to verify SMTP configuration.",
      html: "<p>This is a test email sent to verify SMTP configuration.</p>",
    };
    const result = await sendMail(data);
    if (result.success) {
      return { success: true, message: "Test email sent successfully" };
    }
    return { success: false, message: "Failed to send test email" };
  } catch (error) {
    console.error("Error testing SMTP email:", error);
    return { success: false, message: "Error testing SMTP email" };
  }
}

export async function addSMTP(data) {
  try {
    const { host, userName, password, port, icon } = data;

    if (!host || !userName || !password) {
      return { success: false, message: "All field are required" };
    }

    // we have to chc if SMTP already exists
    const existingSMTP = await EmailAccountModel.findOne({ host, userName });
    if (existingSMTP) {
      return { success: false, message: "SMTP already exists" };
    }

    // we have to upload icon on the Aws Server Todo...
    // const iconUrl = icon ? await uploadFile(icon, 'smtp') : '';
    const smtpData = {
      host,
      userName,
      password,
      port: port || 587, // Default SMTP port
      icon: icon || "",
    };
    const smtp = await EmailAccountModel.create(smtpData);
    if (smtp) {
      return { success: true, message: "SMTP added successfully" };
    } else {
      return { success: false, message: "Failed to add SMTP" };
    }
  } catch (error) {
    console.error("Error adding SMTP:", error);
    return { success: false, message: "Error adding SMTP" };
  }
}
export async function setPrimarySMTP(smtpId) {
  try {
    // First, set all SMTPs to not primary
    await EmailAccountModel.updateMany({}, { isPrimary: false });

    // Then, set the specified SMTP as primary
    const updatedSMTP = await EmailAccountModel.findByIdAndUpdate(
      smtpId,
      { isPrimary: true },
      { new: true }
    );

    if (updatedSMTP) {
      return { success: true, message: "SMTP set as primary successfully" };
    } else {
      return { success: false, message: "Failed to set SMTP as primary" };
    }
  } catch (error) {
    console.error("Error setting primary SMTP:", error);
    return { success: false, message: "Error setting primary SMTP" };
  }
}
export async function getAllSMTPs() {
  try {
    const smtps = await EmailAccountModel.find({ isDeleted: false }).sort({
      createdAt: -1,
    });
    return { success: true, data: JSON.stringify(smtps) };
  } catch (error) {
    console.error("Error fetching SMTPs:", error);
    return { success: false, message: "Error fetching SMTPs" };
  }
}
export async function updateSMTPstatus(smtpId, status) {
  try {
    const updatedSMTP = await EmailAccountModel.findByIdAndUpdate(
      smtpId,
      { isActive: status },
      { new: true }
    );

    if (updatedSMTP) {
      return { success: true, message: "SMTP status updated successfully" };
    } else {
      return { success: false, message: "Failed to update SMTP status" };
    }
  } catch (error) {
    console.error("Error updating SMTP status:", error);
    return { success: false, message: "Error updating SMTP status" };
  }
}
export async function deleteSMTP(smtpId) {
  try {
    const deletedSMTP = await EmailAccountModel.findByIdAndUpdate(
      smtpId,
      { isDeleted: true },
      { new: true }
    );

    if (deletedSMTP) {
      return { success: true, message: "SMTP deleted successfully" };
    } else {
      return { success: false, message: "Failed to delete SMTP" };
    }
  } catch (error) {
    console.error("Error deleting SMTP:", error);
    return { success: false, message: "Error deleting SMTP" };
  }
}
export async function updateSMTP(smtpId, data) {
  try {
    const { host, userName, password, port, icon } = data;

    if (!host || !userName || !password) {
      return { success: false, message: "All fields are required" };
    }

    // we have to chc if SMTP already exists
    const existingSMTP = await EmailAccountModel.findOne({
      _id: { $ne: smtpId },
      host,
      userName,
    });
    if (existingSMTP) {
      return { success: false, message: "SMTP already exists" };
    }

    // we have to upload icon on the Aws Server Todo...
    // const iconUrl = icon ? await uploadFile(icon, 'smtp') : '';
    const smtpData = {
      host,
      userName,
      password,
      port: port || 587, // Default SMTP port
      icon: icon || "",
    };

    const updatedSMTP = await EmailAccountModel.findByIdAndUpdate(
      smtpId,
      smtpData,
      {
        new: true,
      }
    );

    if (updatedSMTP) {
      return { success: true, message: "SMTP updated successfully" };
    } else {
      return { success: false, message: "Failed to update SMTP" };
    }
  } catch (error) {
    console.error("Error updating SMTP:", error);
    return { success: false, message: "Error updating SMTP" };
  }
}
export async function getPrimarySMTP() {
  try {
    const primarySMTP = await EmailAccountModel.findOne({
      isPrimary: true,
      isDeleted: false,
    });
    if (primarySMTP) {
      return { success: true, data: JSON.stringify(primarySMTP) };
    } else {
      return { success: false, message: "No primary SMTP found" };
    }
  } catch (error) {
    console.error("Error fetching primary SMTP:", error);
    return { success: false, message: "Error fetching primary SMTP" };
  }
}
export async function testSMTPEmil(smtpId) {
  try {
    const smtp = await EmailAccountModel.findById(smtpId);
    if (!smtp) {
      return { success: false, message: "SMTP not found" };
    }

    const data = {
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.secure, // true for 465, false for other ports
      userName: smtp.userName,
      password: smtp.password,
      fromName: `"Test SMTP" <${smtp.userName}>`,
      toEmail: smtp.userName, // Sending to the SMTP username for testing
      subject: "SMTP Test Email",
      text: "This is a test email sent to verify SMTP configuration.",
      html: "<p>This is a test email sent to verify SMTP configuration.</p>",
    };
    const result = await sendMail(data);
    if (result.success) {
      return { success: true, message: "Test email sent successfully" };
    }
    return { success: false, message: "Failed to send test email" };

    // const transporter = nodemailer.createTransport({
    //     host: smtp.host,
    //     port: smtp.port || 587,
    //     secure: smtp.secure, // true for 465, false for other ports
    //     auth: {
    //         user: smtp.userName,
    //         pass: smtp.password,
    //     },
    // });
    // if (!transporter) {
    //     return { success: false, message: "Failed to create transporter" };
    // }
    // const testEmail = {
    //     from: `"Test SMTP" <${smtp.userName}>`,
    //     to: smtp.userName, // Sending to the SMTP username for testing
    //     subject: "SMTP Test Email",
    //     text: "This is a test email sent to verify SMTP configuration.",
    // };
    // const info = await transporter.sendMail(testEmail);
    // transporter.close();
    // if (info.accepted.length > 0) {
    //     return { success: true, message: "Test email sent successfully" };
    // } else {
    //     return { success: false, message: "Failed to send test email" };
    // }
  } catch (error) {
    console.error("Error testing SMTP email:", error);
    return { success: false, message: "Error testing SMTP email" };
  }
}

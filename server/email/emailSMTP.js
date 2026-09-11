"use server";
import { sendMail } from "../nodeMailerServer/nodemailerServer";
import { withTransaction } from "@/lib/mongodb";
import { decrypt, encrypt } from "@/lib/algo";
import EmailAccountModel from "@/models/emailAccountmodel";
import { connect } from "@/db/db";
import { getServerSideProps } from "../session/session";
import { isValidObjectId } from "@/lib/mongodb";
import {
  EMAIL_FEATURE_VALUES,
  isKnownEmailFeature,
} from "@/data/emailFeatures";
import { resolveSmtpHost, smtpConfigError } from "@/lib/smtp";

/**
 * An SMTP id in whichever form the caller has.
 *
 * The detail URL carries the id encrypted (lib/algo), while the edit form has
 * the plain `_id` off the record it loaded. Half the actions in this file
 * decrypt and half do not, which is a standing trap: pass the wrong one and the
 * query matches nothing and reports success. Normalising here means neither
 * caller has to know.
 */
function resolveSmtpId(value) {
  if (!value) return null;
  if (isValidObjectId(value)) return String(value);
  try {
    const decrypted = decrypt(value);
    return decrypted && isValidObjectId(decrypted) ? decrypted : null;
  } catch {
    return null;
  }
}

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

    // "Custom SMTP" with no hostname typed saves an account that looks
    // configured and can never connect — the form makes that one click away.
    const hostProblem = smtpConfigError(data);
    if (hostProblem) throw new Error(hostProblem);

    const chosenFeature = feature || "All";
    if (!isKnownEmailFeature(chosenFeature)) {
      throw new Error(
        `"${chosenFeature}" is not a feature this app sends with. ` +
          `Choose one of: ${EMAIL_FEATURE_VALUES.join(", ")}.`
      );
    }

    await connect();

    // One sender per feature. resolveAccount() picks by feature, so a second
    // account for the same one is never reached — it just sits there looking
    // configured. `isDeleted` is excluded so a feature freed by deleting an
    // account can be used again.
    const featureTaken = await EmailAccountModel.findOne({
      feature: chosenFeature,
      isDeleted: false,
    }).session(sesssion);
    if (featureTaken) {
      throw new Error(
        `This company already has an email account for "${chosenFeature}". ` +
          `Edit that one, or remove it first.`
      );
    }

    // Check if SMTP already exists
    const existingSMTP = await EmailAccountModel.findOne({
      host,
      userName,
      isDeleted: false,
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
      feature: chosenFeature,
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
/**
 * The company's configured SMTP senders.
 *
 * Super admin only. These records are the company's outgoing mail identity, and
 * changing or reading them affects every message the app sends — the same
 * reason /admin/email is a super-admin menu entry. The check lives here as well
 * as in the route guard because a server action can be called directly.
 *
 * It used to take an `includePassword` flag that decrypted and returned the
 * stored SMTP password. No caller ever set it (checked across app/ and
 * server/), so it was pure liability: any signed-in user in the tenant could
 * invoke the action by hand and read the company's mail credentials in plain
 * text. Removed rather than gated — there is no feature to preserve.
 */
export async function getAllSMTPsAdvance({
  page = 1,
  limit = 20,
  search, // new search string param
} = {}) {
  const empty = {
    success: true,
    data: JSON.stringify([]),
    pagination: { page, limit, total: 0, totalPages: 0 },
  };
  try {
    const { props } = await getServerSideProps();
    if (props?.session?.user?.role !== "superAdmin") return empty;

    // Build initial match filter
    await connect();
    const matchStage = { isDeleted: false };

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), "i"); // case-insensitive

      // `userName`, not `username` — the schema has no `username`, so
      // searching by user matched nothing.
      matchStage.$or = [
        { host: { $regex: searchRegex } },
        { userName: { $regex: searchRegex } },
      ];
    }

    const skip = (page - 1) * limit;

    const pipeline = [
      { $match: matchStage },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      // The table only needs to know whether a password is set, to show a
      // "Configured" badge. Sending the stored ciphertext to the browser to
      // answer a yes/no question puts it in the page payload and the client
      // cache for no reason, so the boolean is computed here and the field
      // dropped.
      {
        $addFields: {
          hasPassword: {
            $gt: [{ $strLenCP: { $ifNull: ["$password", ""] } }, 0],
          },
        },
      },
      { $unset: "password" },
    ];

    const smtps = await EmailAccountModel.aggregate(pipeline);

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
/**
 * Which features already have an account, so the form can offer only the ones
 * still free. Prevents the user reaching a duplicate error they could not have
 * predicted from the form.
 */
export async function getUsedEmailFeatures() {
  try {
    const { props } = await getServerSideProps();
    if (props?.session?.user?.role !== "superAdmin") {
      return { success: true, data: JSON.stringify([]) };
    }
    await connect();
    const rows = await EmailAccountModel.find({ isDeleted: false })
      .select("feature")
      .lean();
    return {
      success: true,
      data: JSON.stringify([...new Set(rows.map((r) => r.feature || "All"))]),
    };
  } catch (error) {
    console.log("Error fetching used email features:", error);
    return { success: true, data: JSON.stringify([]) };
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

    const hostProblem = smtpConfigError(data);
    if (hostProblem) return { success: false, message: hostProblem };

    const chosenFeature = feature || "All";
    if (!isKnownEmailFeature(chosenFeature)) {
      return {
        success: false,
        message:
          `"${chosenFeature}" is not a feature this app sends with. ` +
          `Choose one of: ${EMAIL_FEATURE_VALUES.join(", ")}.`,
      };
    }

    await connect();

    // The id arrives raw from the edit form but encrypted from anywhere holding
    // a URL. Accept both, so a caller cannot pick the wrong one — the previous
    // version only worked with the raw form and would silently update nothing.
    const targetId = resolveSmtpId(smtpId);
    if (!targetId) return { success: false, message: "Id is not valid" };

    // One sender per feature, matching addSMTPAdvance — otherwise editing is a
    // way around the rule that creating enforces.
    const featureTaken = await EmailAccountModel.findOne({
      _id: { $ne: targetId },
      feature: chosenFeature,
      isDeleted: false,
    });
    if (featureTaken) {
      return {
        success: false,
        message:
          `This company already has an email account for "${chosenFeature}". ` +
          `Edit that one, or remove it first.`,
      };
    }

    const existingSMTP = await EmailAccountModel.findOne({
      _id: { $ne: targetId },
      host,
      // Was `username`, which is not a field on this schema — so the query
      // matched nothing and this duplicate check never once fired.
      userName,
      isDeleted: false,
    });

    if (existingSMTP) {
      return {
        success: false,
        message: "SMTP with this host and username already exists",
      };
    }

    // An allow-list rather than a spread of `data`. The payload comes from a
    // client form, and spreading it let a caller set `password` (bypassing the
    // password tab, which encrypts), `isDeleted`, or `tenantId`.
    const smtpData = {
      host,
      otherHost: host === "other" ? data.otherHost || "" : "",
      userName,
      feature: chosenFeature,
      fromName: data.fromName || "",
      toEmail: data.toEmail || userName,
      port: data.port || 587,
      secure: !!data.secure,
      isTest: !!data.isTest,
    };

    const updatedSMTP = await EmailAccountModel.findByIdAndUpdate(
      targetId,
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
      host: resolveSmtpHost(smtp),
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
  await connect();
  // Prefer the account marked primary for this feature.
  let smtp = await EmailAccountModel.findOne({
    feature,
    isPrimary: true,
    isDeleted: false,
    isActive: true,
  }).lean(); // Use lean() for better performance if you don't need mongoose doc methods

  // Fallback: an account can be configured with the feature (e.g. "HR")
  // without being explicitly marked primary. Rather than failing the send,
  // use any active account for that feature (newest / any primary first).
  if (!smtp) {
    smtp = await EmailAccountModel.findOne({
      feature,
      isDeleted: false,
      isActive: true,
    })
      .sort({ isPrimary: -1, updatedAt: -1 })
      .lean();
  }

  if (!smtp) {
    return {
      success: false,
      message: `No SMTP account configured for feature: ${feature}`,
    };
  }
  // Decrypt password before use
  smtp.password = decrypt(smtp.password);
  return {
    success: true,
    data: JSON.stringify(smtp),
  };
}
/**
 * One SMTP account, by its encrypted id.
 *
 * Super admin only, for the same reason as getAllSMTPsAdvance: this is the
 * company's outgoing mail identity, and a server action is callable directly
 * whatever the sidebar shows.
 *
 * The stored password is never returned. It was, and the detail screen rendered
 * the whole document — so the encrypted credential was sitting in the page
 * payload of a screen that only ever needed to say whether one is set.
 */
export async function getOneSMTPEmail(smtpId) {
  try {
    if (!smtpId) return { success: false, message: "Id is required!" };

    const { props } = await getServerSideProps();
    if (props?.session?.user?.role !== "superAdmin") {
      return { success: false, message: "Not authorized" };
    }

    const decryptedId = decrypt(smtpId);
    if (!decryptedId) return { success: false, message: "Id is not valid" };
    await connect();
    const smtp = await EmailAccountModel.findById(decryptedId)
      .select("-password")
      .lean();
    if (!smtp) return { success: false, message: "Data is not found" };

    // Presence only, so the screen can show "configured" without the value.
    const stored = await EmailAccountModel.findById(decryptedId)
      .select("password")
      .lean();

    return {
      success: true,
      data: JSON.stringify({ ...smtp, hasPassword: !!stored?.password }),
    };
  } catch (error) {
    console.log("Error on emailSMTP file under getOneSMTPEmail", error);
    return { success: false, message: "Something want wrong" };
  }
}
export async function testSMTPConnection(smtp) {
  try {
    const data = {
      host: resolveSmtpHost(smtp),
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
      host: resolveSmtpHost(smtp),
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
export async function userRegisterEmail(smtp) {
  try {
    const data = {
      host: resolveSmtpHost(smtp),
      port: smtp.port || 587,
      secure: smtp.secure || false, // true for 465, false for other ports
      userName: smtp.userName,
      password: smtp.password,
      fromName: `<${smtp.fromName}>`,
      toEmail: smtp.toEmail || smtp.userName, // Sending to the SMTP username for testing
      subject: smtp.subject || "User Registration Email",
      html: smtp.html || "<p>Welcome to our service!</p>",
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

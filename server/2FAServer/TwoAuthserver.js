"use server";
import { authenticator } from "otplib";
import qrcode from "qrcode";
import { getServerSideProps } from "../session/session";
import TwoFAMoldel from "@/models/2FAmodel";
import { createObjectId } from "@/lib/mongodb";
import { connect } from "@/db/db";

export async function existEmployee() {
  try {
    const { props } = await getServerSideProps();
    const { _id: employeeId, email } = props?.session?.user;
    if (!email) return { success: false, message: "User not authenticated" };

    const existEmployee = await TwoFAMoldel.findOne({ employeeId });
    const result = existEmployee ? { data: existEmployee } : {};
    return { success: true, ...result, email, employeeId };
  } catch (error) {
    return { success: false, message: "Something went wrong" };
  }
}

async function generate2FA({ user, service = "HR Management", secret }) {
  try {
    const otpauth = authenticator.keyuri(user, service, secret);
    const qrCodeUrl = await qrcode.toDataURL(otpauth);
    return qrCodeUrl;
  } catch (error) {
    return;
  }
}

export async function check2FA() {
  try {
    const employee = await existEmployee();
    if (!employee.success) return employee;
    if (employee.data) {
      const { isEnabled } = employee.data;
      return {
        success: true,
        data: JSON.stringify({ isEnabled }),
      };
    } else {
      return { success: false, data: JSON.stringify({ isEnabled: false }) };
    }

    // Generate a secret key for the user
  } catch (error) {
    console.error("Error generating 2FA:", error);
    return { success: false, message: "Error generating 2FA" };
  }
}

export async function verify2FA(code, secret) {
  const isValid = authenticator.check(code, secret);
  return {
    success: isValid,
    message: isValid ? "Code is valid" : "Invalid verification code",
  };
}

export async function enable2FA(code, secret) {
  try {
    const { props } = await getServerSideProps();
    const { email, _id: employeeId } = props?.session?.user || {};
    if (!email) {
      return { success: false, message: "User not authenticated" };
    }
    // Logic to enable 2FA for the user
    if (!code) {
      return { success: false, message: "Code is required" };
    }
    // Verify the code
    const isValid = await verify2FA(code, secret);
    if (!isValid.success) return isValid;

    await connect();
    // This could involve updating a database record or similar
    const TwoFA = {
      employeeId: createObjectId(employeeId),
      secret,
      isEnabled: true,
      isVerified: true,
      qrCodeUrl: "",
    };
    // first check if employee exist or not
    const existEmployee = await TwoFAMoldel.findOne({
      employeeId: createObjectId(employeeId),
    });

    if (!existEmployee) {
      const response = await TwoFAMoldel.create(TwoFA);
      if (response) return { success: true, message: "Your 2FA is enabled." };
    } else {
      if (existEmployee.isEnabled) {
        return { success: false, message: "Your 2FA is already enabled" };
      } else {
        await disable2FA(existEmployee?.employeeId, true);
        return { success: true, message: "2FA enabled successfully" };
      }
    }
  } catch (error) {
    console.error("Error enabling 2FA:", error);
    return { success: false, message: "Error enabling 2FA" };
  }
}

export async function disable2FA(employeeId, check) {
  try {
    await TwoFAMoldel.updateOne(
      {
        employeeId,
      },
      {
        $set: {
          isEnabled: check,
        },
      }
    );
    // This could involve updating a database record or similar
    return { success: true, message: "2FA disabled successfully" };
  } catch (error) {
    console.error("Error disabling 2FA:", error);
    return { success: false, message: "Error disabling 2FA" };
  }
}

export async function onEnableChange(check) {
  try {
    const employee = await existEmployee();
    if (!employee.success) return employee;
    if (!check) {
      if (!employee.data) {
        return { success: false, message: "2FA not configured" };
      }
      await disable2FA(employee.employeeId, check);
      return { success: true, message: "2FA disabled successfully" };
    }

    // Enabling Flow
    const user = employee.email;
    const service = "HR Management"; // Replace with actual service name
    const secret = employee.data?.secret || authenticator.generateSecret();
    const qrCodeUrl = await generate2FA({ user, service, secret });
    if (!employee.data) {
      return {
        success: true,
        data: JSON.stringify({
          qrCodeUrl,
          isEnabled: false,
          isVerified: false,
          secret,
        }),
      };
    }
    return {
      success: true,
      data: JSON.stringify({
        qrCodeUrl,
        isEnabled: employee.data?.isEnabled,
        isVerified: employee.data?.isVerified,
        secret,
      }),
    };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Something Wrong" };
  }
}

export async function checkUserHas2FA() {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    if (!employeeId)
      return { success: false, message: "User not authenticated" };
    await connect();
    const existEmployee = await TwoFAMoldel.findOne({ employeeId });
    if (existEmployee && existEmployee.isEnabled) return true;
    return false;
  } catch (error) {
    console.log(error);
    return false;
  }
}

export async function verify2FAWithDB(code) {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    if (!employeeId)
      return { success: false, message: "User not authenticated" };
    await connect();

    const exist = await TwoFAMoldel.findOne({ employeeId });
    if (!exist) return { success: false, message: "2FA not enabled" };
    const isValid = await verify2FA(code, exist.secret);
    if (isValid.success) return isValid;
  } catch (error) {
    console.error("Error verifying 2FA with DB:", error);
    return { success: false, message: "Error verifying 2FA" };
  }
}

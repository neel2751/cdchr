"use server";
import { connect } from "@/db/db";
import DeviceModel from "@/models/deviceModel";
import { checkip, sendGlobalMail } from "../email/email";
import { getServerSideProps } from "../session/session";

export async function StoreDevice(data) {
  try {
    const { props } = await getServerSideProps();
    await connect();

    // first we have to chcek if this alreday submit the device info
    const exists = await DeviceModel.findOne({ email: data?.submittedBy });
    if (exists)
      return { success: false, message: "You alreday submit the device info" };

    const ipAddress = await checkip();

    const newData = {
      ...data,
      email: data?.submittedBy,
      submittedBy: props?.session?.user?.email || data?.submittedBy,
      ipAddress: ipAddress || "Secret",
    };

    const result = await DeviceModel.create(newData);

    await sendGlobalMail({
      ...newData,
      content: device(newData),
    });
    if (result) return { success: true, message: "Keep this id safe" };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Something went wrong" };
  }
}

export async function GetDevice() {
  try {
    await connect();
    const result = await DeviceModel.find();
    return { success: true, data: JSON.stringify(result) };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Something went wrong" };
  }
}

function device(data) {
  const html = `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
<title></title>
<meta charset="UTF-8" />
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<!--[if !mso]>-->
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<!--<![endif]-->
<meta name="x-apple-disable-message-reformatting" content="" />
<meta content="target-densitydpi=device-dpi" name="viewport" />
<meta content="true" name="HandheldFriendly" />
<meta content="width=device-width" name="viewport" />
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no" />
<style type="text/css">
table {
border-collapse: separate;
table-layout: fixed;
mso-table-lspace: 0pt;
mso-table-rspace: 0pt
}
table td {
border-collapse: collapse
}
.ExternalClass {
width: 100%
}
.ExternalClass,
.ExternalClass p,
.ExternalClass span,
.ExternalClass font,
.ExternalClass td,
.ExternalClass div {
line-height: 100%
}
body, a, li, p, h1, h2, h3 {
-ms-text-size-adjust: 100%;
-webkit-text-size-adjust: 100%;
}
html {
-webkit-text-size-adjust: none !important
}
body, #innerTable {
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale
}
#innerTable img+div {
display: none;
display: none !important
}
img {
Margin: 0;
padding: 0;
-ms-interpolation-mode: bicubic
}
h1, h2, h3, p, a {
line-height: inherit;
overflow-wrap: normal;
white-space: normal;
word-break: break-word
}
a {
text-decoration: none
}
h1, h2, h3, p {
min-width: 100%!important;
width: 100%!important;
max-width: 100%!important;
display: inline-block!important;
border: 0;
padding: 0;
margin: 0
}
a[x-apple-data-detectors] {
color: inherit !important;
text-decoration: none !important;
font-size: inherit !important;
font-family: inherit !important;
font-weight: inherit !important;
line-height: inherit !important
}
u + #body a {
color: inherit;
text-decoration: none;
font-size: inherit;
font-family: inherit;
font-weight: inherit;
line-height: inherit;
}
a[href^="mailto"],
a[href^="tel"],
a[href^="sms"] {
color: inherit;
text-decoration: none
}
.footer {
margin-top: 10px;
font-size: 12px;
color: #888888;
text-align: center;
}
</style>
<style type="text/css">
@media (min-width: 481px) {
.hd { display: none!important }
}
</style>
<style type="text/css">
@media (max-width: 480px) {
.hm { display: none!important }
}
</style>
<style type="text/css">
@media (max-width: 480px) {
.t94{mso-line-height-alt:0px!important;line-height:0!important;display:none!important}.t95{padding-left:30px!important;padding-bottom:40px!important;padding-right:30px!important}.t92{width:353px!important}.t6{padding-bottom:20px!important}.t5{line-height:28px!important;font-size:26px!important;letter-spacing:-1.04px!important}.t145{padding:40px 30px!important}.t128{padding-bottom:36px!important}.t124{text-align:center!important}.t107,.t111,.t115,.t119,.t123{vertical-align:top!important;width:24px!important}.t63,.t68,.t73{vertical-align:middle!important}.t1{padding-bottom:50px!important}.t3{width:80px!important}.t74{text-align:left!important}.t61,.t66{display:revert!important}.t68{width:610px!important}.t65{padding-left:0!important}.t73{width:368px!important}.t63{width:211px!important}
}
</style>
<!--[if !mso]>-->
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;700;800&amp;display=swap" rel="stylesheet" type="text/css" />
<!--<![endif]-->
<!--[if mso]>
<xml>
<o:OfficeDocumentSettings>
<o:AllowPNG/>
<o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings>
</xml>
<![endif]-->
</head>
<body id="body" class="t151" style="min-width:100%;Margin:0px;padding:0px;background-color:#242424;"><div class="t150" style="background-color:#242424;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td class="t149" style="font-size:0;line-height:0;mso-line-height-rule:exactly;background-color:#242424;" valign="top" align="center">
<!--[if mso]>
<v:background xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false">
<v:fill color="#242424"/>
</v:background>
<![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" align="center" id="innerTable"><tr><td><div class="t94" style="mso-line-height-rule:exactly;mso-line-height-alt:45px;line-height:45px;font-size:1px;display:block;">&nbsp;&nbsp;</div></td></tr><tr><td align="center">
<table class="t98" role="presentation" cellpadding="0" cellspacing="0" style="Margin-left:auto;Margin-right:auto;"><tr><td width="600" class="t97" style="width:600px;">
<table class="t96" role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;"><tr><td class="t95" style="background-color:#F8F8F8;padding:0 50px 60px 50px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100% !important;"><tr><td align="left">
<table class="t4" role="presentation" cellpadding="0" cellspacing="0" style="Margin-right:auto;"><tr><td width="130" class="t3" style="width:130px;">
<table class="t2" role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;"><tr><td class="t1" style="padding:0 0 60px 0;"><div style="font-size:0px;"><img class="t0" style="display:block;border:0;height:auto;width:100%;Margin:0;max-width:100%;" width="130" height="130" alt="" src="https://res.cloudinary.com/drcjzx0sw/image/upload/v1749051905/cdc_iyguho.jpg"/></div></td></tr></table>
</td></tr></table>
</td></tr><tr><td align="center">
<table class="t9" role="presentation" cellpadding="0" cellspacing="0" style="Margin-left:auto;Margin-right:auto;"><tr><td width="500" class="t8" style="width:600px;">
<table class="t7" role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;"><tr><td class="t6" style="padding:0 0 15px 0;"><h1 class="t5" style="margin:0;Margin:0;font-family:Roboto,BlinkMacSystemFont,Segoe UI,Helvetica Neue,Arial,sans-serif;line-height:26px;font-weight:400;font-style:normal;font-size:24px;text-decoration:none;text-transform:none;direction:ltr;color:#333333;text-align:left;mso-line-height-rule:exactly;mso-text-raise:1px;">${
    data?.employeeName
  }, Thank you for providing your device information.</h1></td></tr></table>
</td></tr></table>
</td></tr><tr><td align="center">
<table class="t14" role="presentation" cellpadding="0" cellspacing="0" style="Margin-left:auto;Margin-right:auto;"><tr><td width="500" class="t13" style="width:600px;">
<table class="t12" role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;"><tr><td class="t11" style="padding:0 0 22px 0;"><p class="t10" style="margin:0;Margin:0;font-family:Roboto,BlinkMacSystemFont,Segoe UI,Helvetica Neue,Arial,sans-serif;line-height:22px;font-weight:400;font-style:normal;font-size:16px;text-decoration:none;text-transform:none;direction:ltr;color:#333333;text-align:left;mso-line-height-rule:exactly;mso-text-raise:2px;">Keep your submission ID safe, as you will need it later when managing your information. Do not share this ID with anyone.</p></td></tr></table>
</td></tr></table>
</td></tr><tr><td align="center">
<table class="t20" role="presentation" cellpadding="0" cellspacing="0" style="Margin-left:auto;Margin-right:auto;"><tr><td width="500" class="t19" style="width:600px;">
<table class="t18" role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;"><tr><td class="t17"><p class="t16" style="margin:0;Margin:0;font-family:Roboto,BlinkMacSystemFont,Segoe UI,Helvetica Neue,Arial,sans-serif;line-height:22px;font-weight:400;font-style:normal;font-size:16px;text-decoration:none;text-transform:none;direction:ltr;color:#333333;text-align:left;mso-line-height-rule:exactly;mso-text-raise:2px;"><span class="t15" style="margin:0;Margin:0;font-weight:bold;mso-line-height-rule:exactly;">Submission ID</span></p></td></tr></table>
</td></tr></table>
</td></tr><tr><td align="center">
<table class="t25" role="presentation" cellpadding="0" cellspacing="0" style="Margin-left:auto;Margin-right:auto;"><tr><td width="500" class="t24" style="width:600px;">
<table class="t23" role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;"><tr><td class="t22" style="padding:0 0 22px 0;"><p class="t21" style="margin:0;Margin:0;font-family:Roboto,BlinkMacSystemFont,Segoe UI,Helvetica Neue,Arial,sans-serif;line-height:22px;font-weight:400;font-style:normal;font-size:16px;text-decoration:none;text-transform:none;direction:ltr;color:#333333;text-align:left;mso-line-height-rule:exactly;mso-text-raise:2px;">${
    data?.submissionId
  }</p></td></tr></table>
</td></tr></table>
</td></tr><tr><td align="center">
<table class="t31" role="presentation" cellpadding="0" cellspacing="0" style="Margin-left:auto;Margin-right:auto;"><tr><td width="500" class="t30" style="width:600px;">
<table class="t29" role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;"><tr><td class="t28"><p class="t27" style="margin:0;Margin:0;font-family:Roboto,BlinkMacSystemFont,Segoe UI,Helvetica Neue,Arial,sans-serif;line-height:22px;font-weight:400;font-style:normal;font-size:16px;text-decoration:none;text-transform:none;direction:ltr;color:#333333;text-align:left;mso-line-height-rule:exactly;mso-text-raise:2px;"><span class="t26" style="margin:0;Margin:0;font-weight:bold;mso-line-height-rule:exactly;">IP Address</span></p></td></tr></table>
</td></tr></table>
</td></tr><tr><td align="center">
<table class="t36" role="presentation" cellpadding="0" cellspacing="0" style="Margin-left:auto;Margin-right:auto;"><tr><td width="500" class="t35" style="width:600px;">
<table class="t34" role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;"><tr><td class="t33" style="padding:0 0 22px 0;"><p class="t32" style="margin:0;Margin:0;font-family:Roboto,BlinkMacSystemFont,Segoe UI,Helvetica Neue,Arial,sans-serif;line-height:22px;font-weight:400;font-style:normal;font-size:16px;text-decoration:none;text-transform:none;direction:ltr;color:#333333;text-align:left;mso-line-height-rule:exactly;mso-text-raise:2px;">${
    data?.ipAddress
  }</p></td></tr></table>
</td></tr></table>
</td></tr><tr><td align="center">
<table class="t42" role="presentation" cellpadding="0" cellspacing="0" style="Margin-left:auto;Margin-right:auto;"><tr><td width="500" class="t41" style="width:600px;">
<table class="t40" role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;"><tr><td class="t39"><p class="t38" style="margin:0;Margin:0;font-family:Roboto,BlinkMacSystemFont,Segoe UI,Helvetica Neue,Arial,sans-serif;line-height:22px;font-weight:400;font-style:normal;font-size:16px;text-decoration:none;text-transform:none;direction:ltr;color:#333333;text-align:left;mso-line-height-rule:exactly;mso-text-raise:2px;"><span class="t37" style="margin:0;Margin:0;font-weight:bold;mso-line-height-rule:exactly;">Device</span></p></td></tr></table>
</td></tr></table>
</td></tr><tr><td align="center">
<table class="t47" role="presentation" cellpadding="0" cellspacing="0" style="Margin-left:auto;Margin-right:auto;"><tr><td width="500" class="t46" style="width:600px;">
<table class="t45" role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;"><tr><td class="t44"><p class="t43" style="margin:0;Margin:0;font-family:Roboto,BlinkMacSystemFont,Segoe UI,Helvetica Neue,Arial,sans-serif;line-height:22px;font-weight:400;font-style:normal;font-size:16px;text-decoration:none;text-transform:none;direction:ltr;color:#333333;text-align:left;mso-line-height-rule:exactly;mso-text-raise:2px;">${
    data?.userAgent
  }</p></td></tr></table>
</td></tr></table>
</td></tr><tr><td align="center">
<table class="t57" role="presentation" cellpadding="0" cellspacing="0" style="Margin-left:auto;Margin-right:auto;"><tr><td width="500" class="t56" style="width:600px;">
<table class="t55" role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;"><tr><td class="t54"><p class="t53" style="margin:0;Margin:0;font-family:Roboto,BlinkMacSystemFont,Segoe UI,Helvetica Neue,Arial,sans-serif;line-height:22px;font-weight:400;font-style:normal;font-size:16px;text-decoration:none;text-transform:none;direction:ltr;color:#333333;text-align:left;mso-line-height-rule:exactly;mso-text-raise:2px;">United Kingdom - CDC</p></td></tr></table>
</td></tr></table>
</td></tr><tr><td><div class="t58" style="mso-line-height-rule:exactly;mso-line-height-alt:30px;line-height:30px;font-size:1px;display:block;">&nbsp;&nbsp;</div></td></tr><tr><td align="center">
</td></tr></table>
<div class="footer">
<p>&copy; ${new Date().getFullYear()} Creative Design  & Construction. All rights reserved.</p>
</div>
</html>
    `;
  return html;
}

// 1. Get OS Distribution Analytics
export async function getOSDistributionAnalytics() {
  try {
    await connect();

    const osDistribution = await DeviceModel.aggregate([
      {
        $group: {
          _id: {
            os: "$operatingSystem",
            isCompanyAsset: "$isCompanyAsset",
          },
          count: { $sum: 1 },
          users: { $addToSet: "$userInfo.employeeName" },
        },
      },
      {
        $group: {
          _id: "$_id.os",
          companyAssets: {
            $sum: {
              $cond: [{ $eq: ["$_id.isCompanyAsset", true] }, "$count", 0],
            },
          },
          personalDevices: {
            $sum: {
              $cond: [{ $eq: ["$_id.isCompanyAsset", false] }, "$count", 0],
            },
          },
          totalDevices: { $sum: "$count" },
          uniqueUsers: { $addToSet: "$users" },
        },
      },
      {
        $addFields: {
          uniqueUserCount: {
            $size: {
              $reduce: {
                input: "$uniqueUsers",
                initialValue: [],
                in: { $setUnion: ["$$value", "$$this"] },
              },
            },
          },
        },
      },
      { $sort: { totalDevices: -1 } },
    ]);

    return {
      success: true,
      data: JSON.stringify(osDistribution),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// 2. Get Windows Activation Status Analytics
export async function getWindowsActivationAnalytics() {
  try {
    await connect();

    const windowsActivation = await DeviceModel.aggregate([
      {
        $match: {
          operatingSystem: { $regex: /windows/i },
        },
      },
      {
        $group: {
          _id: {
            activationStatus: "$activationStatus",
            isCompanyAsset: "$isCompanyAsset",
            licenseType: "$licenseType",
          },
          count: { $sum: 1 },
          devices: {
            $push: {
              deviceName: "$deviceName",
              employeeName: "$userInfo.employeeName",
              department: "$userInfo.department",
              windowsKey: "$windowsKey",
              serialNumber: "$serialNumber",
            },
          },
        },
      },
      {
        $group: {
          _id: "$_id.activationStatus",
          companyAssets: {
            $sum: {
              $cond: [{ $eq: ["$_id.isCompanyAsset", true] }, "$count", 0],
            },
          },
          personalDevices: {
            $sum: {
              $cond: [{ $eq: ["$_id.isCompanyAsset", false] }, "$count", 0],
            },
          },
          licenseBreakdown: {
            $push: {
              licenseType: "$_id.licenseType",
              count: "$count",
              isCompanyAsset: "$_id.isCompanyAsset",
            },
          },
          deviceDetails: { $push: "$devices" },
        },
      },
    ]);

    return {
      success: true,
      data: windowsActivation,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// 3. Get Devices Requiring Action
export async function getDevicesRequiringAction() {
  try {
    await connect();

    const devicesNeedingAction = await DeviceModel.aggregate([
      {
        $match: {
          $or: [
            {
              activationStatus: {
                $in: ["not-activated", "expired", "invalid"],
              },
            },
            { "detailedSecuritySettings.antivirus.installed": false },
            { "detailedSecuritySettings.deviceEncryption.enabled": false },
            { "detailedSecuritySettings.screenLock.enabled": false },
            { vulnerabilityStatus: { $in: ["vulnerable", "critical"] } },
            {
              osUpdateStatus: { $in: ["outdated", "critical-updates-pending"] },
            },
            {
              "iso9001Compliance.complianceDocumentation.certificationStatus":
                "non-compliant",
            },
          ],
        },
      },
      {
        $addFields: {
          actionItems: {
            $filter: {
              input: [
                {
                  $cond: [
                    {
                      $in: [
                        "$activationStatus",
                        ["not-activated", "expired", "invalid"],
                      ],
                    },
                    "License Activation Required",
                    null,
                  ],
                },
                {
                  $cond: [
                    {
                      $eq: [
                        "$detailedSecuritySettings.antivirus.installed",
                        false,
                      ],
                    },
                    "Install Antivirus",
                    null,
                  ],
                },
                {
                  $cond: [
                    {
                      $eq: [
                        "$detailedSecuritySettings.deviceEncryption.enabled",
                        false,
                      ],
                    },
                    "Enable Device Encryption",
                    null,
                  ],
                },
                {
                  $cond: [
                    {
                      $eq: [
                        "$detailedSecuritySettings.screenLock.enabled",
                        false,
                      ],
                    },
                    "Enable Screen Lock",
                    null,
                  ],
                },
                {
                  $cond: [
                    {
                      $in: ["$vulnerabilityStatus", ["vulnerable", "critical"]],
                    },
                    "Security Vulnerability Fix",
                    null,
                  ],
                },
                {
                  $cond: [
                    {
                      $in: [
                        "$osUpdateStatus",
                        ["outdated", "critical-updates-pending"],
                      ],
                    },
                    "OS Updates Required",
                    null,
                  ],
                },
                {
                  $cond: [
                    {
                      $eq: [
                        "$iso9001Compliance.complianceDocumentation.certificationStatus",
                        "non-compliant",
                      ],
                    },
                    "ISO9001 Compliance Review",
                    null,
                  ],
                },
              ],
              as: "item",
              cond: { $ne: ["$$item", null] },
            },
          },
          priorityLevel: {
            $switch: {
              branches: [
                {
                  case: { $in: ["$vulnerabilityStatus", ["critical"]] },
                  then: "Critical",
                },
                {
                  case: {
                    $or: [
                      { $in: ["$activationStatus", ["expired", "invalid"]] },
                      {
                        $eq: [
                          "$detailedSecuritySettings.deviceEncryption.enabled",
                          false,
                        ],
                      },
                    ],
                  },
                  then: "High",
                },
              ],
              default: "Medium",
            },
          },
        },
      },
      {
        $group: {
          _id: {
            isCompanyAsset: "$isCompanyAsset",
            department: "$userInfo.department",
          },
          devices: {
            $push: {
              deviceName: "$deviceName",
              employeeName: "$userInfo.employeeName",
              actionItems: "$actionItems",
              priorityLevel: "$priorityLevel",
              operatingSystem: "$operatingSystem",
            },
          },
          totalDevices: { $sum: 1 },
          criticalCount: {
            $sum: {
              $cond: [{ $eq: ["$priorityLevel", "Critical"] }, 1, 0],
            },
          },
          highPriorityCount: {
            $sum: {
              $cond: [{ $eq: ["$priorityLevel", "High"] }, 1, 0],
            },
          },
        },
      },
    ]);

    return {
      success: true,
      data: devicesNeedingAction,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// 4. Get Common Applications Analytics
export async function getCommonApplicationsAnalytics() {
  try {
    await connect();

    const applicationUsage = await DeviceModel.aggregate([
      { $unwind: { path: "$devices", preserveNullAndEmptyArrays: false } },
      { $unwind: "$devices.workApplications" },
      {
        $group: {
          _id: {
            appName: "$devices.workApplications.name",
            isCompanyAsset: "$devices.isCompanyAsset",
          },
          totalInstalls: { $sum: 1 },
          users: {
            $addToSet: {
              employeeName: "$userInfo.employeeName",
              department: "$userInfo.department",
              deviceType: "$devices.deviceType",
            },
          },
          versions: { $addToSet: "$devices.workApplications.version" },
          licenseTypes: { $addToSet: "$devices.workApplications.licenseType" },
        },
      },
      {
        $group: {
          _id: "$_id.appName",
          companyAssetInstalls: {
            $sum: {
              $cond: [
                { $eq: ["$_id.isCompanyAsset", true] },
                "$totalInstalls",
                0,
              ],
            },
          },
          personalDeviceInstalls: {
            $sum: {
              $cond: [
                { $eq: ["$_id.isCompanyAsset", false] },
                "$totalInstalls",
                0,
              ],
            },
          },
          totalInstalls: { $sum: "$totalInstalls" },
          uniqueUsers: { $addToSet: "$users" },
          allVersions: { $addToSet: "$versions" },
          allLicenseTypes: { $addToSet: "$licenseTypes" },
        },
      },
      {
        $addFields: {
          uniqueUserCount: {
            $size: {
              $reduce: {
                input: "$uniqueUsers",
                initialValue: [],
                in: { $setUnion: ["$$value", "$$this"] },
              },
            },
          },
          adoptionRate: {
            $multiply: [
              { $divide: ["$totalInstalls", { $literal: 100 }] }, // Adjust this based on actual total devices/users
              100,
            ],
          },
        },
      },
      { $sort: { totalInstalls: -1 } },
    ]);

    return {
      success: true,
      data: JSON.stringify(applicationUsage),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// 5. Get Department-wise Device Analytics
export async function getDepartmentAnalytics() {
  try {
    await connect();

    const departmentAnalytics = await DeviceModel.aggregate([
      {
        $group: {
          _id: "$userInfo.department",
          totalDevices: { $sum: 1 },
          companyAssets: {
            $sum: {
              $cond: [{ $eq: ["$isCompanyAsset", true] }, 1, 0],
            },
          },
          personalDevices: {
            $sum: {
              $cond: [{ $eq: ["$isCompanyAsset", false] }, 1, 0],
            },
          },
          uniqueUsers: { $addToSet: "$userInfo.employeeName" },
          osBreakdown: {
            $push: "$operatingSystem",
          },
          securityIssues: {
            $sum: {
              $cond: [
                {
                  $or: [
                    {
                      $eq: [
                        "$detailedSecuritySettings.antivirus.installed",
                        false,
                      ],
                    },
                    {
                      $eq: [
                        "$detailedSecuritySettings.deviceEncryption.enabled",
                        false,
                      ],
                    },
                    {
                      $in: ["$vulnerabilityStatus", ["vulnerable", "critical"]],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $addFields: {
          uniqueUserCount: { $size: "$uniqueUsers" },
          devicesPerUser: {
            $divide: ["$totalDevices", { $size: "$uniqueUsers" }],
          },
          securityComplianceRate: {
            $multiply: [
              {
                $divide: [
                  { $subtract: ["$totalDevices", "$securityIssues"] },
                  "$totalDevices",
                ],
              },
              100,
            ],
          },
        },
      },
      { $sort: { totalDevices: -1 } },
    ]);

    return {
      success: true,
      data: departmentAnalytics,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// 6. Get Overall Dashboard Summary
export async function getDashboardSummary() {
  try {
    await connect();

    const summary = await DeviceModel.aggregate([
      {
        $facet: {
          totalStats: [
            {
              $group: {
                _id: null,
                totalDevices: { $sum: 1 },
                companyAssets: {
                  $sum: { $cond: [{ $eq: ["$isCompanyAsset", true] }, 1, 0] },
                },
                personalDevices: {
                  $sum: { $cond: [{ $eq: ["$isCompanyAsset", false] }, 1, 0] },
                },
                uniqueUsers: { $addToSet: "$userInfo.employeeName" },
                windowsDevices: {
                  $sum: {
                    $cond: [{ $regex: ["$operatingSystem", /windows/i] }, 1, 0],
                  },
                },
                macDevices: {
                  $sum: {
                    $cond: [{ $regex: ["$operatingSystem", /mac/i] }, 1, 0],
                  },
                },
                securityIssues: {
                  $sum: {
                    $cond: [
                      {
                        $or: [
                          {
                            $eq: [
                              "$detailedSecuritySettings.antivirus.installed",
                              false,
                            ],
                          },
                          {
                            $eq: [
                              "$detailedSecuritySettings.deviceEncryption.enabled",
                              false,
                            ],
                          },
                          {
                            $in: [
                              "$vulnerabilityStatus",
                              ["vulnerable", "critical"],
                            ],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                activationIssues: {
                  $sum: {
                    $cond: [
                      {
                        $in: [
                          "$activationStatus",
                          ["not-activated", "expired", "invalid"],
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    ]);

    const result = summary[0].totalStats[0];
    result.uniqueUserCount = result.uniqueUsers.length;
    delete result.uniqueUsers;

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// 1. Employee Submission Progress
export async function getEmployeeSubmissionProgress() {
  try {
    await connect();

    const totalEmployees = 40; // You can make this dynamic

    const submissions = await DeviceModel.aggregate([
      {
        $group: {
          _id: "$employeeId",
          employeeName: { $first: "$employeeName" },
          department: { $first: "$department" },
          deviceCount: { $sum: 1 },
          lastSubmission: { $max: "$updatedAt" },
        },
      },
      {
        $group: {
          _id: null,
          totalSubmissions: { $sum: 1 },
          employees: {
            $push: {
              employeeId: "$_id",
              employeeName: "$employeeName",
              department: "$department",
              deviceCount: "$deviceCount",
              lastSubmission: "$lastSubmission",
            },
          },
        },
      },
    ]);

    const result = submissions[0] || { totalSubmissions: 0, employees: [] };
    const completionRate = Math.round(
      (result.totalSubmissions / totalEmployees) * 100
    );
    return {
      success: true,
      data: {
        totalEmployees,
        submissions: result.totalSubmissions,
        completionRate,
        employees: result.employees,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getDeviceComplianceOverview() {
  try {
    await connect();

    const compliance = await DeviceModel.aggregate([
      { $unwind: "$devices" },
      {
        $group: {
          _id: null,
          totalDevices: { $sum: 1 },
          encryptedDevices: {
            $sum: {
              $cond: [
                { $eq: ["$devices.encryptionStatus", "encrypted"] },
                1,
                0,
              ],
            },
          },
          antivirusInstalled: {
            $sum: { $cond: ["$devices.antivirusInstalled", 1, 0] },
          },
          firewallEnabled: {
            $sum: { $cond: ["$devices.firewallEnabled", 1, 0] },
          },
          isoCompliant: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    "$devices.iso9001Compliance.complianceDocumentation.certificationStatus",
                    "compliant",
                  ],
                },
                1,
                0,
              ],
            },
          },
          isoPending: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    "$devices.iso9001Compliance.complianceDocumentation.certificationStatus",
                    "pending-review",
                  ],
                },
                1,
                0,
              ],
            },
          },
          isoNonCompliant: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    "$devices.iso9001Compliance.complianceDocumentation.certificationStatus",
                    "non-compliant",
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const result = compliance[0] || { totalDevices: 0 };

    return {
      success: true,
      data: {
        totalDevices: result.totalDevices,
        encryption:
          Math.round((result.encryptedDevices / result.totalDevices) * 100) ||
          0,
        antivirus:
          Math.round((result.antivirusInstalled / result.totalDevices) * 100) ||
          0,
        firewall:
          Math.round((result.firewallEnabled / result.totalDevices) * 100) || 0,
        isoCompliance: {
          compliant: result.isoCompliant || 0,
          pending: result.isoPending || 0,
          nonCompliant: result.isoNonCompliant || 0,
        },
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 2. Security Hygiene Summary
export async function getSecurityHygieneSummary() {
  try {
    await connect();

    const security = await DeviceModel.aggregate([
      // Step 1: Unwind the devices array
      { $unwind: "$devices" },

      // Step 2: Group and calculate totals
      {
        $group: {
          _id: null,
          totalDevices: { $sum: 1 },

          antivirusInstalled: {
            $sum: {
              $cond: [{ $eq: ["$devices.antivirusInstalled", true] }, 1, 0],
            },
          },
          firewall: {
            $sum: {
              $cond: [{ $eq: ["$devices.firewallEnabled", true] }, 1, 0],
            },
          },

          deviceEncryption: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    "$devices.detailedSecuritySettings.deviceEncryption.enabled",
                    true,
                  ],
                },
                1,
                0,
              ],
            },
          },

          screenLock: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    "$devices.detailedSecuritySettings.screenLock.enabled",
                    true,
                  ],
                },
                1,
                0,
              ],
            },
          },

          osUpdates: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    "$devices.detailedSecuritySettings.autoUpdates.osUpdatesEnabled",
                    true,
                  ],
                },
                1,
                0,
              ],
            },
          },

          securityUpdates: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    "$devices.detailedSecuritySettings.autoUpdates.securityUpdatesEnabled",
                    true,
                  ],
                },
                1,
                0,
              ],
            },
          },

          remoteWipe: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    "$devices.detailedSecuritySettings.remoteWipe.available",
                    true,
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const result = security[0] || { totalDevices: 0 };
    const data = {
      antivirus:
        Math.round((result.antivirusInstalled / result.totalDevices) * 100) ||
        0,
      firewall: Math.round((result.firewall / result.totalDevices) * 100) || 0,
      encryption:
        Math.round((result.deviceEncryption / result.totalDevices) * 100) || 0,
      screenLock:
        Math.round((result.screenLock / result.totalDevices) * 100) || 0,
      osUpdates:
        Math.round((result.osUpdates / result.totalDevices) * 100) || 0,
      securityUpdates:
        Math.round((result.securityUpdates / result.totalDevices) * 100) || 0,
      remoteWipe:
        Math.round((result.remoteWipe / result.totalDevices) * 100) || 0,
    };

    return {
      success: true,
      data,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 4. Network & Connectivity Monitoring
export async function getNetworkConnectivityMonitoring() {
  try {
    await connect();

    const connectivity = await DeviceModel.aggregate([
      { $unwind: "$devices" },
      {
        $group: {
          _id: null,
          totalDevices: { $sum: 1 },
          vpnConfigured: {
            $sum: { $cond: ["$devices.networkInfo.vpnConfigured", 1, 0] },
          },
          publicWifiNoVpn: {
            $sum: {
              $cond: [
                {
                  $and: [
                    {
                      $ne: [
                        "$devices.connectivityAndDataHandling.publicWifiUsage.frequency",
                        "never",
                      ],
                    },
                    {
                      $eq: [
                        "$connectivityAndDataHandling.publicWifiUsage.usesVpn",
                        false,
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
          accessesCompanyDataOnPublicWifi: {
            $sum: {
              $cond: [
                "$devices.connectivityAndDataHandling.publicWifiUsage.accessesCompanyData",
                1,
                0,
              ],
            },
          },
          emailOfflineAccess: {
            $sum: {
              $cond: [
                "$devices.connectivityAndDataHandling.emailAccess.offlineAccess",
                1,
                0,
              ],
            },
          },
          localDataStorage: {
            $sum: {
              $cond: [
                "$devices.connectivityAndDataHandling.dataStorage.storesCompanyDataLocally",
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const result = connectivity[0] || { totalDevices: 0 };

    return {
      success: true,
      data: {
        vpnConfigured:
          Math.round((result.vpnConfigured / result.totalDevices) * 100) || 0,
        publicWifiRisk:
          Math.round((result.publicWifiNoVpn / result.totalDevices) * 100) || 0,
        companyDataOnPublicWifi:
          Math.round(
            (result.accessesCompanyDataOnPublicWifi / result.totalDevices) * 100
          ) || 0,
        emailOfflineAccess:
          Math.round((result.emailOfflineAccess / result.totalDevices) * 100) ||
          0,
        localDataStorage:
          Math.round((result.localDataStorage / result.totalDevices) * 100) ||
          0,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Export functionality
export async function exportDashboardData(reportType, filters = {}) {
  try {
    await connect();

    let pipeline = [];
    let filename = `${reportType}_${
      new Date().toISOString().split("T")[0]
    }.csv`;

    // Add filters if provided
    if (filters.department) {
      pipeline.push({ $match: { department: filters.department } });
    }
    if (filters.assetType) {
      pipeline.push({
        $match: { isCompanyAsset: filters.assetType === "company" },
      });
    }
    if (filters.os) {
      pipeline.push({
        $match: { operatingSystem: { $regex: filters.os, $options: "i" } },
      });
    }

    let data = [];

    switch (reportType) {
      case "security":
        pipeline.push({
          $project: {
            employeeName: "$employeeName",
            department: "$department",
            deviceName: 1,
            operatingSystem: 1,
            antivirusInstalled: 1,
            encryptionStatus: 1,
            firewallEnabled: 1,
            screenLockEnabled: "$detailedSecuritySettings.screenLock.enabled",
            osUpdatesEnabled:
              "$detailedSecuritySettings.autoUpdates.osUpdatesEnabled",
          },
        });
        data = await DeviceModel.aggregate(pipeline);
        break;

      case "compliance":
        pipeline.push({
          $project: {
            employeeName: "$employeeName",
            department: "$department",
            deviceName: 1,
            certificationStatus:
              "$iso9001Compliance.complianceDocumentation.certificationStatus",
            privacyPolicyAccepted: "$privacyConsent.privacyPolicyAccepted",
            dataRetentionConsent: "$privacyConsent.dataRetentionConsent",
          },
        });
        data = await DeviceModel.aggregate(pipeline);
        break;

      case "applications":
        data = await DeviceModel.aggregate([
          ...pipeline,
          { $unwind: "$workApplications" },
          {
            $project: {
              employeeName: "$employeeName",
              department: "$department",
              deviceName: 1,
              appName: "$workApplications.name",
              appVersion: "$workApplications.version",
              licenseType: "$workApplications.licenseType",
            },
          },
        ]);
        break;
    }

    // Convert to CSV
    if (data.length === 0) {
      return { success: false, error: "No data found" };
    }

    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(","),
      ...data.map((row) =>
        headers
          .map((header) => {
            const value = row[header] || "";
            return typeof value === "string" && value.includes(",")
              ? `"${value}"`
              : value;
          })
          .join(",")
      ),
    ].join("\n");

    return {
      success: true,
      data: csvContent,
      filename,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// work application total user and total install usage
export async function workApplications() {
  try {
    await connect();
    const result = await DeviceModel.aggregate([
      // 1. Unwind devices array
      { $unwind: "$devices" },

      // 2. Unwind workApplications array inside each device
      { $unwind: "$devices.workApplications" },

      // 3. Group by app name, count installs and collect users
      {
        $group: {
          _id: "$devices.workApplications.name",
          totalInstalls: { $sum: 1 },
          uniqueUsers: { $addToSet: "$employeeName" }, // adjust if employeeId is unique
        },
      },

      // 4. Add number of users per app
      {
        $addFields: {
          userCount: { $size: "$uniqueUsers" },
        },
      },

      // 5. Calculate total installs for all apps (use $group + $facet trick)
      {
        $facet: {
          appStats: [
            {
              $project: {
                _id: 1,
                totalInstalls: 1,
                userCount: 1,
              },
            },
          ],
          totalInstallCount: [
            {
              $group: {
                _id: null,
                total: { $sum: "$totalInstalls" },
              },
            },
          ],
        },
      },

      // 6. Join and calculate percentage
      {
        $project: {
          appStats: 1,
          total: { $arrayElemAt: ["$totalInstallCount.total", 0] },
        },
      },
      { $unwind: "$appStats" },

      {
        $project: {
          appName: "$appStats._id",
          totalInstalls: "$appStats.totalInstalls",
          userCount: "$appStats.userCount",
          installPercentage: {
            $multiply: [
              { $divide: ["$appStats.totalInstalls", "$total"] },
              100,
            ],
          },
        },
      },

      // 7. Sort by install count
      { $sort: { totalInstalls: -1 } },
    ]);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, message: "Something went wrong" };
  }
}

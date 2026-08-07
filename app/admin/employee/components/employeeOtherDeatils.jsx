import EmployeeOverview from "@/components/tabs/employee-overview";
import { useSiteEmployee } from "@/components/Avatar/AvatarContext";
import SensitiveDetailsCard from "@/components/sensitiveDetails/sensitiveDetailsCard";
import { formatDisplayDate } from "@/lib/formatDate";

const SiteEmployeeOtherDeatils = () => {
  const { newData, slug } = useSiteEmployee();
  const updateData = [
    {
      title: "Personal Details",
      content: [
        { label: "Employee ID", value: newData?.employeId || "-" },
        {
          label: "Date of Birth",
          value: formatDisplayDate(newData?.dateOfBirth),
        },
      ],
    },
    {
      title: "Immigration Deatils",
      content: [
        { label: "Nationality", value: newData?.immigrationType || "-" },
        { label: "Visa Type", value: newData?.immigrationCategory || "-" },
        { label: "Employee Type", value: newData?.employeType || "-" },
        // Employee NI lives in the password-protected card above.
        newData?.immigrationType !== "British" && {
          label: "Visa Start Date",
          value: formatDisplayDate(newData?.visaStartDate),
        },
        newData?.immigrationType !== "British" && {
          label: "Visa End Date",
          // Site employees store the expiry as `eVisaExp`, not `visaEndDate`.
          value: formatDisplayDate(newData?.eVisaExp),
        },

        // { label: "Join Date", value: "22 Sep, 2022" },
        // { label: "End Date", value: "10 Nov, 2023" },
      ],
    },
    {
      title: "Emergency Contact Details",
      content: [
        { label: "Name", value: newData?.emergencyName || "-" },
        { label: "Contact No", value: newData?.emergencyPhoneNumber || "-" },
        { label: "Address", value: newData?.emergencyAddress || "-" },
        { label: "Relation", value: newData?.emergencyRelation || "-" },
      ],
    },
  ];

  return (
    <div className="space-y-2">
      <SensitiveDetailsCard slug={slug} employeeType="site" />
      <EmployeeOverview data={updateData} />
    </div>
  );
};

export { SiteEmployeeOtherDeatils };

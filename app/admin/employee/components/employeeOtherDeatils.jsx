import EmployeeOverview from "@/components/tabs/employee-overview";
import { useSiteEmployee } from "@/components/Avatar/AvatarContext";
import SensitiveDetailsCard from "@/components/sensitiveDetails/sensitiveDetailsCard";
import RightToWorkCard from "@/components/rightToWork/rightToWorkCard";
import { formatDisplayDate } from "@/lib/formatDate";
import { useFieldBlocks } from "@/app/admin/providers";

const SiteEmployeeOtherDeatils = () => {
  const { newData, slug } = useSiteEmployee();
  // Sections follow the parts of the form the company uses
  // (data/fieldBlocks.js): immigration for a builder's workers, guardian,
  // school and medical notes for a tuition centre's students.
  const blocks = useFieldBlocks();
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
    blocks.guardian && {
      title: "Parent or Guardian",
      content: [
        { label: "Name", value: newData?.guardianName || "-" },
        { label: "Relation", value: newData?.guardianRelation || "-" },
        { label: "Phone", value: newData?.guardianPhone || "-" },
        { label: "Email", value: newData?.guardianEmail || "-" },
      ],
    },
    (blocks.education || blocks.medical) && {
      title: "School and Medical",
      content: [
        blocks.education && { label: "School", value: newData?.schoolName || "-" },
        blocks.education && {
          label: "Year / Grade",
          value: newData?.yearGroup || "-",
        },
        blocks.medical && {
          label: "Medical Notes",
          value: newData?.medicalNotes || "-",
        },
      ],
    },
    blocks.rightToWork && {
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
      {/* Sections and rows a block switched off are `false` here. */}
      <EmployeeOverview
        data={updateData
          .filter(Boolean)
          .map((section) => ({
            ...section,
            content: section.content.filter(Boolean),
          }))}
      />
      {blocks.rightToWork && (
        <RightToWorkCard
          immigrationType={newData?.immigrationType}
          visaEndDate={newData?.eVisaExp}
          checks={newData?.rightToWorkChecks}
        />
      )}
    </div>
  );
};

export { SiteEmployeeOtherDeatils };

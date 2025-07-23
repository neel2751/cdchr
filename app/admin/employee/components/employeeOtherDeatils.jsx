import EmployeeOverview from "@/components/tabs/employee-overview";
import { useSiteEmployee } from "@/components/Avatar/AvatarContext";

const SiteEmployeeOtherDeatils = () => {
  const { newData } = useSiteEmployee();
  const updateData = [
    {
      title: "Bank Account Details",
      content: [
        {
          label: "Account Name",
          value: newData?.bankDetail?.accountName || "-",
        },
        {
          label: "Account No",
          value: newData?.bankDetail?.accountNumber || "-",
        },
        { label: "Sort Code", value: newData?.bankDetail?.sortCode || "-" },
      ],
    },
    {
      title: "Immigration Deatils",
      content: [
        { label: "Nationality", value: newData?.immigrationType || "-" },
        { label: "Visa Type", value: newData?.immigrationCategory || "-" },
        { label: "Employee Type", value: newData?.employeType || "-" },
        { label: "Employee NI", value: newData?.employeNI || "-" },
        newData?.immigrationType !== "British" && {
          label: "Visa Start Date",
          value: newData?.visaStartDate || "-",
        },
        newData?.immigrationType !== "British" && {
          label: "Visa End Date",
          value: newData?.visaEndDate || "-",
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

  return <EmployeeOverview data={updateData} />;
};

export { SiteEmployeeOtherDeatils };

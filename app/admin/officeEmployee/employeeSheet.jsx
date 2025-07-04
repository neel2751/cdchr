"use client";
import TableSheet from "@/components/tableStatus/tableSheet";
import { format } from "date-fns";

const EmployeeSheet = ({ item }) => {
  const employeData = [
    {
      label: "Employee ID",
      value: item._id.slice(-4).padStart(item._id.length, "*"),
    },
    {
      label: "Email",
      value: item.email,
    },
    {
      label: "Phone",
      value: item.phoneNumber,
    },
    {
      label: "Role Type",
      value: item.roleType,
    },
    {
      label: "Department",
      value: item?.department?.roleTitle,
    },
    {
      label: "Immigration Type",
      value: item.immigrationType,
    },
    {
      label: "Immigration Category",
      value: item.immigrationCategory || "-",
    },
    {
      label: "Join Date",
      value: format(item.joinDate || new Date(), "PPP"),
    },
    {
      label: "End Date",
      value: item.endDate ? format(item.endDate || new Date(), "PPP") : "N/A",
    },
    {
      label: "Visa Start  Date",
      value:
        item?.immigrationType === "British"
          ? "-"
          : item.visaStartDate
          ? format(item.visaStartDate || new Date(), "PPP")
          : "N/A",
    },
    {
      label: "Visa End Date",
      value:
        item?.immigrationType === "British"
          ? "-"
          : item.visaEndDate
          ? format(item.visaEndDate || new Date(), "PPP")
          : "N/A",
    },
    {
      label: "Employee Status",
      value: item.isActive,
      status: true,
    },
  ];
  return (
    <TableSheet
      data={employeData}
      title={"Employee Details"}
      description={"Detailed view of the employee's information."}
      tableName={item?.name}
      // tableDesc={item?.company?.name || "N/A"}
      tableDesc={item?.roleType || "N/A"}
    />
  );
};

export default EmployeeSheet;

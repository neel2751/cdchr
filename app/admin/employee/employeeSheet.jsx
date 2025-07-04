import TableSheet from "@/components/tableStatus/tableSheet";
import { format } from "date-fns";

const EmployeeSheet = ({ item }) => {
  const data = [
    {
      label: "Employee ID",
      value: item._id.slice(-4).padStart(item._id.length, "*"),
    },
    {
      label: "Name",
      value: item.firstName + " " + item.lastName,
    },
    {
      label: "Email",
      value: item.email,
    },
    {
      label: "Phone",
      value: item.phone,
    },
    {
      label: "Country",
      value: item.eAddress.country,
    },
    {
      label: "Payment Type",
      value: item.paymentType,
    },
    {
      label: "Employee Type",
      value: item.employeType,
    },
    {
      label: "PayRate",
      value: `£${item.payRate.toFixed(2)}`,
    },
    {
      label: "Address",
      value: item.eAddress.address,
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
      data={data}
      tableName={data[1].value}
      title={"Employee Details"}
      description={"This is a description of the employee details"}
      tableDesc={data[2].value}
    />
  );
};

export default EmployeeSheet;

import TableSheet from "@/components/tableStatus/tableSheet";
import { format } from "date-fns";
import { useFieldBlocks } from "@/app/admin/providers";

const EmployeeSheet = ({ item }) => {
  // Rows tagged with a block (data/fieldBlocks.js) show only where the company
  // uses it: pay and visa for a builder's workers, guardian and medical notes
  // for a tuition centre's students.
  const blocks = useFieldBlocks();

  // Any detail may be missing — a record imported or created before a field
  // was required has no address or pay rate — and one absent field must show
  // as "-", not take the whole sheet down.
  const payRate = Number(item.payRate);
  const rows = [
    {
      label: "Employee ID",
      value: String(item._id || "")
        .slice(-4)
        .padStart(String(item._id || "").length, "*"),
    },
    {
      label: "Name",
      value: [item.firstName, item.lastName].filter(Boolean).join(" ") || "-",
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
      value: item.eAddress?.country || "-",
    },
    {
      block: "pay",
      label: "Payment Type",
      value: item.paymentType,
    },
    {
      block: "pay",
      label: "Employee Type",
      value: item.employeType,
    },
    {
      block: "pay",
      label: "PayRate",
      value: Number.isFinite(payRate) ? `£${payRate.toFixed(2)}` : "-",
    },
    {
      label: "Address",
      value: item.eAddress?.address || "-",
    },
    {
      block: "guardian",
      label: "Parent / Guardian",
      value:
        [item.guardianName, item.guardianRelation && `(${item.guardianRelation})`]
          .filter(Boolean)
          .join(" ") || "-",
    },
    {
      block: "guardian",
      label: "Parent / Guardian Phone",
      value: item.guardianPhone || "-",
    },
    {
      block: "guardian",
      label: "Parent / Guardian Email",
      value: item.guardianEmail || "-",
    },
    {
      block: "education",
      label: "School",
      value: item.schoolName || "-",
    },
    {
      block: "education",
      label: "Year / Grade",
      value: item.yearGroup || "-",
    },
    {
      block: "medical",
      label: "Medical Notes",
      value: item.medicalNotes || "-",
    },
    {
      block: "rightToWork",
      label: "Immigration Type",
      value: item.immigrationType,
    },
    {
      block: "rightToWork",
      label: "Immigration Category",
      value: item.immigrationCategory || "-",
    },
    {
      label: "Join Date",
      // Site employees store it as `startDate`; `joinDate` is the office
      // field, and reading it here showed today's date for everyone.
      value:
        item.startDate || item.joinDate
          ? format(item.startDate || item.joinDate, "PPP")
          : "-",
    },
    {
      label: "End Date",
      value: item.endDate ? format(item.endDate || new Date(), "PPP") : "N/A",
    },
    {
      block: "rightToWork",
      label: "Visa Start  Date",
      value:
        item?.immigrationType === "British"
          ? "-"
          : item.visaStartDate
          ? format(item.visaStartDate || new Date(), "PPP")
          : "N/A",
    },
    {
      block: "rightToWork",
      label: "Visa End Date",
      value:
        item?.immigrationType === "British"
          ? "-"
          : // Site employees store the expiry as `eVisaExp`, not `visaEndDate`.
            item.eVisaExp
            ? format(item.eVisaExp || new Date(), "PPP")
            : "N/A",
    },
    {
      label: "Employee Status",
      value: item.isActive,
      status: true,
    },
  ];
  const data = rows.filter((row) => !row.block || blocks[row.block]);
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

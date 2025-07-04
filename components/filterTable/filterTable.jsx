import { format, isValid } from "date-fns";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

export const FilterDataTableHead = ({ attendanceData }) => {
  const tableHead = Object.keys(attendanceData[0] || "");
  return (
    <TableHeader>
      <TableRow>
        {tableHead.map((item, index) => (
          <TableHead className="uppercase text-xs" key={index}>
            {item}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
};

export const FilterDataTableBody = ({ attendanceData }) => {
  if (!attendanceData || !Array.isArray(attendanceData)) {
    console.error("Error: attendanceData is not an array or is empty");
    return null;
  }

  function renderCellValue(value) {
    if (Array.isArray(value)) {
      if (value.every((v) => typeof v === "object" && v?.name)) {
        return value.map((v) => v.name).join(", ");
      }
      return value.join(", ");
    }

    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }
    if (typeof value === "number") {
      return value.toFixed(2);
    }

    if (
      typeof value === "string" &&
      // Only try parsing ISO date format
      /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value)
    ) {
      const date = new Date(value);
      if (isValid(date)) {
        return format(date, "PPP");
      }
    }

    if (typeof value === "object" && value !== null) {
      return JSON.stringify(value);
    }

    return value ?? "-";
  }

  return (
    <TableBody>
      {attendanceData.map((item, index) => (
        <TableRow key={index}>
          {Object.values(item).map((value, index) => (
            <TableCell className="text-sm" key={index}>
              {/* if value is date , format it */}
              {/* {typeof value === "string" &&
              // Only try parsing ISO date format
              /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value)
                ? format(value, "PPP")
                : value} */}
              {renderCellValue(value)}
              {/* {value} */}
              {/* {item[key]} {item[key] === "Weekly" && " (CIS)"} */}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
};

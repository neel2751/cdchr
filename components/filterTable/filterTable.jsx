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

  const filteredTableHead = tableHead.filter((item) => !item.startsWith("_"));

  return (
    <TableHeader>
      <TableRow>
        {filteredTableHead.map((item, index) => (
          <TableHead className="uppercase text-xs" key={index}>
            {item}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
};

export const FilterDataTableBody = ({ attendanceData, showHighlights }) => {
  if (!attendanceData || !Array.isArray(attendanceData)) {
    console.log("Error: attendanceData is not an array or is empty");
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
      {attendanceData.map((item, rowIndex) => {
        // Extract the dynamic style
        const dynamicStyle = showHighlights ? item._rowStyle || "" : "";

        return (
          <TableRow key={rowIndex} className={dynamicStyle}>
            {Object.entries(item).map(([key, value], cellIndex) => {
              // Skip any hidden fields starting with _
              if (key.startsWith("_")) return null;

              return (
                <TableCell
                  key={cellIndex}
                  className={`text-sm ${dynamicStyle ? "font-medium" : ""}`}
                >
                  {renderCellValue(value)}
                </TableCell>
              );
            })}
          </TableRow>
        );
      })}
    </TableBody>
  );
};

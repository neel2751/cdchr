import { Button } from "@/components/ui/button";
import { calculateDurationNew, formatMinutesNew } from "@/lib/utils";
import { format } from "date-fns";
import React, { useMemo } from "react";
import { logCsvExport } from "@/server/auditServer/exportAudit";

export default function AttendanceExport({ rawData }) {
  let grandShiftMinutes = 0;
  let grandBreakMinutes = 0;
  let grandWorkMinutes = 0;
  const data = useMemo(() => {
    return rawData.map((item, index) => {
      const shiftMinutes = calculateDurationNew(item.clockIn, item.clockOut);
      let totalBreakMinutes = 0;
      if (item.breaks && item.breaks.length > 0) {
        item.breaks.forEach((brk) => {
          totalBreakMinutes += calculateDurationNew(brk.breakIn, brk.breakOut);
        });
      }
      const finalMinutes = shiftMinutes - totalBreakMinutes;

      grandShiftMinutes += shiftMinutes;
      grandBreakMinutes += totalBreakMinutes;
      grandWorkMinutes += finalMinutes;
      const breaksString = item.breaks
        ? item.breaks
            .map((b) => `${b.breakIn || "N/A"} - ${b.breakOut || "N/A"}`)
            .join(" | ")
        : "N/A";
      return {
        key: index + 1,
        name: item.employeeName || "N/A",
        date: format(new Date(item.date), "yyyy-MM-dd"),
        clockIn: item.clockIn || "N/A",
        clockOut: item.clockOut || "N/A",
        breaks: item.breaks
          .map(
            (brk) =>
              `${brk.breakIn ? brk.breakIn : "N/A"} - ${
                brk.breakOut ? brk.breakOut : "N/A"
              }`
          )
          .join(" | "),
        totalShiftMinutes: formatMinutesNew(shiftMinutes),
        totalBreakMinutes: formatMinutesNew(totalBreakMinutes),
        finalWorkHours: formatMinutesNew(finalMinutes),
      };
    });
  }, [rawData]);

  const handleExport = () => {
    if (data.length === 0) return;

    console.log(
      "Grand Shift Minutes:",
      grandShiftMinutes,
      "Grand Break Minutes:",
      grandBreakMinutes,
      "Grand Work Minutes:",
      grandWorkMinutes
    );

    const totalRow = [
      "Total",
      "",
      "",
      "",
      "",
      formatMinutesNew(grandShiftMinutes),
      formatMinutesNew(grandBreakMinutes),
      formatMinutesNew(grandWorkMinutes),
    ];

    const headers = Object.keys(data[0]);
    const csvRows = data.map((row) =>
      headers.map((header) => `"${row[header]}"`).join(",")
    );
    // 1. Add headers
    csvRows.unshift(headers.join(","));
    // 2. Add total row at the end
    csvRows.push(totalRow.map((cell) => `"${cell}"`).join(","));

    // 4. Create the file and download
    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `leave_report_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url); // Clean up memory

    logCsvExport({
      source: "attendanceReport",
      label: "Attendance report",
      rowCount: data.length,
    }).catch(() => {});
  };

  return (
    <Button onClick={handleExport} className={"cursor-pointer"}>
      Export Leave Report
    </Button>
  );
}

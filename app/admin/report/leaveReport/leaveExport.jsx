import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import React, { useMemo } from "react";
import { logCsvExport } from "@/server/auditServer/exportAudit";

export default function LeaveExport({ rawData }) {
  const data = useMemo(() => {
    return rawData.map((item, index) => ({
      key: index + 1,
      name: item.employeeName,
      leaveType: item.leaveType,

      leaveDays: item.leaveDays,
      isHalf: item.isHalfDay ? "Yes" : "No",
      leaveStatus: item.leaveStatus,
      leaveYear: item.leaveYear,
      leaveDates: item?.leaveDates
        ?.map((date) => format(new Date(date), "PPP"))
        .join(", "),
    }));
  }, [rawData]);

  const handleExport = () => {
    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csvRows = [];

    // 1. Add headers
    csvRows.push(headers.join(","));

    // 2. Add data rows FIRST
    let totalLeaveDays = 0;
    data.forEach((row) => {
      totalLeaveDays += Number(row.leaveDays) || 0;

      const values = headers.map((header) => {
        // Standard CSV escaping for quotes and commas
        const escaped = ("" + row[header]).replace(/"/g, '""');
        return `"${escaped}"`;
      });
      csvRows.push(values.join(","));
    });

    // 3. Create and Add the total row LAST
    const totalRow = headers.map((header) => {
      if (header === "leaveDays") {
        return `"${totalLeaveDays}"`;
      } else if (header === "key") {
        return `"TOTAL"`;
      } else {
        return '""';
      }
    });

    csvRows.push(totalRow.join(","));

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
      source: "leaveReport",
      label: "Leave report",
      rowCount: data.length,
    }).catch(() => {});
  };

  return (
    <Button onClick={handleExport} className={"cursor-pointer"}>
      Export Leave Report
    </Button>
  );
}

import {
  FilterDataTableBody,
  FilterDataTableHead,
} from "@/components/filterTable/filterTable";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table } from "@/components/ui/table";
import { format } from "date-fns";

import React, { useMemo, useState } from "react";

export default function LeaveTable({ rawData }) {
  const [showHighlights, setShowHighlights] = useState(true);

  if (!rawData || rawData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Leave Report Data Table</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center py-10">No data available.</p>
        </CardContent>
      </Card>
    );
  }
  const data = useMemo(() => {
    return rawData.map((item, index) => {
      let rowStyle = "";
      if (item.leaveStatus === "Approved")
        rowStyle = "bg-green-50 text-green-700";
      else if (item.leaveStatus === "Pending")
        rowStyle = "bg-amber-50 text-amber-700";
      else if (item.leaveStatus === "Rejected")
        rowStyle = "bg-red-100 text-red-500 line-through";
      else if (item.leaveStatus === "Cancelled")
        rowStyle = "bg-gray-100 text-gray-500 line-through";
      else if (item.leaveStatus === "Expired")
        rowStyle = "bg-gray-200 text-gray-600 italic";
      else rowStyle = "";
      return {
        key: index + 1,
        name: item.employeeName,
        leaveType: item.leaveType,

        leaveDays: item.leaveDays,
        isHalf: item.isHalfDay ? "Yes" : "No",
        leaveStatus: item.leaveStatus,
        leaveYear: item.leaveYear,
        // leaveDates: item?.leaveDates
        //   ?.map((date) => format(new Date(date), "PPP"))
        //   .join(", "),
        _rowStyle: rowStyle,
      };
    });
  }, [rawData]);

  return (
    <Card className="overflow-x-auto">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle>Attendance Report</CardTitle>
          <CardDescription>
            Detailed logs with conditional highlighting.
          </CardDescription>
        </div>

        {/* THE TOGGLE SWITCH */}
        <div className="flex items-center space-x-2 bg-slate-100 p-2 rounded-lg dark:bg-slate-800">
          <Switch
            id="highlight-mode"
            checked={showHighlights}
            onCheckedChange={setShowHighlights}
          />
          <Label
            htmlFor="highlight-mode"
            className="cursor-pointer text-xs font-medium"
          >
            Show Highlights
          </Label>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <FilterDataTableHead attendanceData={data} />
          <FilterDataTableBody
            attendanceData={data}
            showHighlights={showHighlights}
          />
        </Table>
      </CardContent>
    </Card>
  );
}

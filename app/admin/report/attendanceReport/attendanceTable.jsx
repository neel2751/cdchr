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
import { Table, TableCell, TableFooter, TableRow } from "@/components/ui/table";
import { calculateDurationNew, formatMinutesNew } from "@/lib/utils";
import { format } from "date-fns";

import React, { useMemo } from "react";

export default function AttendanceTable({ rawData }) {
  const [showHighlights, setShowHighlights] = React.useState(true);

  const data = useMemo(() => {
    if (!Array.isArray(rawData)) return [];

    return rawData.map((item, index) => {
      // Check if the user is missing a Clock Out
      const isMissing = !item.clockOut || item.clockOut === "N/A";
      const noBreaks = !item.breaks || item.breaks.length === 0;

      let rowStyle = "";
      if (isMissing) rowStyle = "bg-red-50 text-red-700";
      else if (noBreaks) rowStyle = "bg-amber-50 text-amber-700";
      // Calculate minutes (if clockOut is missing, shift becomes 0)
      const shiftMinutes =
        Number(calculateDurationNew(item.clockIn, item.clockOut)) || 0;

      let totalBreakMinutes = 0;
      if (item.breaks?.length > 0) {
        item.breaks.forEach((brk) => {
          totalBreakMinutes +=
            Number(calculateDurationNew(brk.breakIn, brk.breakOut)) || 0;
        });
      }

      return {
        name: item.employeeName || "N/A",
        date: item.date ? format(new Date(item.date), "yyyy-MM-dd") : "N/A",
        clockIn: item.clockIn || "N/A",
        clockOut: item.clockOut || "N/A",
        breaks: item.breaks
          ? item.breaks
              .map(
                (brk) =>
                  `${brk.breakIn ? brk.breakIn : "N/A"} - ${
                    brk.breakOut ? brk.breakOut : "N/A"
                  }`
              )
              .join(" | ")
          : "N/A",
        // Add the status flag here
        isMissingClockOut: isMissing,
        totalShiftMinutes: formatMinutesNew(shiftMinutes),
        totalBreakMinutes: formatMinutesNew(totalBreakMinutes),
        finalWorkHours: formatMinutesNew(shiftMinutes - totalBreakMinutes),
        _totalShiftMinutes: shiftMinutes,
        _totalBreakMinutes: totalBreakMinutes,
        _finalWorkHours: shiftMinutes - totalBreakMinutes,
        _rowStyle: rowStyle,
      };
    });
  }, [rawData]);

  const summary = useMemo(() => {
    return data.reduce(
      (acc, item) => {
        if (item.isMissingClockOut) acc.missing++;
        if (!item.breaks || item.breaks === "N/A") acc.noBreaks++;
        acc.total++;
        return acc;
      },
      { missing: 0, noBreaks: 0, total: 0 }
    );
  }, [rawData]);

  const totals = useMemo(() => {
    return data.reduce(
      (acc, curr) => {
        acc.shift += curr._totalShiftMinutes;
        acc.break += curr._totalBreakMinutes;
        acc.work += curr._finalWorkHours;
        return acc;
      },
      { shift: 0, break: 0, work: 0 }
    );
  }, [data]);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        {/* Total Records Card */}
        <Card className="border-l-4 border-l-blue-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Records</CardTitle>
            <div className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.total}</div>
            <p className="text-xs text-muted-foreground">
              Filtered attendance logs
            </p>
          </CardContent>
        </Card>

        {/* Missing Clock Out Card */}
        <Card className="border-l-4 border-l-red-500 shadow-sm bg-red-50/30">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-red-800">
              Missing Clock-Outs
            </CardTitle>
            <span className="text-red-500 font-bold text-xl">!</span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-700">
              {summary.missing}
            </div>
            <p className="text-xs text-red-600/80">
              Require immediate correction
            </p>
          </CardContent>
        </Card>

        {/* No Breaks Card */}
        <Card className="border-l-4 border-l-amber-500 shadow-sm bg-amber-50/30">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-amber-800">
              No Breaks Taken
            </CardTitle>
            <span className="text-amber-500 font-bold text-xl">?</span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-700">
              {summary.noBreaks}
            </div>
            <p className="text-xs text-amber-600/80">
              Compliance review suggested
            </p>
          </CardContent>
        </Card>
      </div>
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
            <TableFooter>
              <TableRow>
                <TableCell colSpan={6} className="font-bold">
                  <span className="font-semibold">Grand Totals:</span>
                </TableCell>
                <TableCell>
                  <span className="font-semibold">Shift Hours: </span>
                  {formatMinutesNew(totals.shift)}
                </TableCell>
                <TableCell>
                  <span className="font-semibold">Break Hours: </span>
                  {formatMinutesNew(totals.break)}
                </TableCell>
                <TableCell>
                  <span className="font-semibold">Work Hours: </span>
                  {formatMinutesNew(totals.work)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

import { useSiteEmployee } from "@/components/Avatar/AvatarContext";
import { DateRangeFilter } from "@/components/filters/filterDate/filterDateRange";
import { PaginationWithLinks } from "@/components/filters/pagination/pagination-client";
import {
  FilterDataTableBody,
  FilterDataTableHead,
} from "@/components/filterTable/filterTable";
import { Button } from "@/components/ui/button";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table } from "@/components/ui/table";
import { useFetchQuery } from "@/hooks/use-query";
import { calculateDuration } from "@/lib/utils";
import { getSiteEmployeAttendanceData } from "@/server/employeServer/employeServer";
import { formatCurrency } from "@/utils/time";
import { format } from "date-fns";
import { DownloadCloud } from "lucide-react";
import React from "react";
import { logCsvExport } from "@/server/auditServer/exportAudit";

export default function SiteAttedanceData() {
  const { slug, searchParams } = useSiteEmployee();

  const { data: attendanceData, isLoading } = useFetchQuery({
    fetchFn: getSiteEmployeAttendanceData,
    params: {
      employeId: slug[0],
      fromDate: searchParams.fromDate
        ? new Date(searchParams.fromDate).toISOString()
        : new Date().toISOString(),
      toDate: searchParams.toDate
        ? new Date(searchParams.toDate).toISOString()
        : new Date().toISOString(),
    },
    queryKey: ["siteEmployeeAttendanceData", slug, searchParams],
    enabled: !!slug,
  });
  const { newData: attendance, totalCount } = attendanceData || {};

  const attendanceTableData =
    attendance?.data?.map((item) => ({
      siteName: item?.siteName || "N/A",
      clockIn: item.clockIn || "N/A",
      breakIn: item.breakIn || "N/A",
      breakOut: item.breakOut || "N/A",
      clockOut: item.clockOut || "N/A",
      date: item?.date ? format(new Date(item.date), "PPP") : "N/A",
      totalHour: calculateDuration(item?.clockIn, item?.clockOut),
      totalBreak: calculateDuration(item?.breakIn, item?.breakOut),
      grandHour: calculateDuration(
        calculateDuration(item?.breakIn, item?.breakOut),
        calculateDuration(item?.clockIn, item?.clockOut)
      ),
    })) || [];

  const exportedData = () => {
    const header = Object.keys(attendanceTableData[0] || {});
    // capitalize the first letter of each header
    const capitalizedHeader = header.map(
      (field) => field.charAt(0).toUpperCase() + field.slice(1)
    );
    const csvRows = [
      capitalizedHeader.join(","), // Add header row
      ...attendanceTableData.map((row) =>
        header.map((field) => JSON.stringify(row[field] || "")).join(",")
      ),
    ];
    const csvString = csvRows.join("\n");
    const blob = new Blob([csvString], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance_data_${slug[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    logCsvExport({
      source: "employeeAttendanceData",
      label: "Employee attendance data",
      rowCount: attendanceTableData.length,
    }).catch(() => {});
  };

  const totalHour = attendanceTableData.reduce((acc, item) => {
    let clockIn = item.clockIn || null;
    let clockOut = item.clockOut || null;
    // we store time like "HH:mm" in the database, so we need to convert it to Date objects
    if (clockIn) {
      const [hours, minutes] = clockIn.split(":").map(Number);
      clockIn = new Date(0, 0, 0, hours, minutes).getTime();
    }
    if (clockOut) {
      const [hours, minutes] = clockOut.split(":").map(Number);
      clockOut = new Date(0, 0, 0, hours, minutes).getTime();
    }

    if (clockIn && clockOut) {
      return acc + (clockOut - clockIn) / 3600000; // Convert milliseconds to hours
    }
    return acc;
  }, 0);

  return (
    <div>
      <div className="flex justify-between items-center border-b pb-4">
        <CardTitle>Employee Attendance Data</CardTitle>
        <div className="flex items-center space-x-2">
          <DateRangeFilter />
          <Button variant="outline" onClick={exportedData}>
            <DownloadCloud />
            Export
          </Button>
        </div>
      </div>
      {/* {JSON.stringify(attendance?.metadata)} */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 border-b py-4">
        <div className="flex flex-col p-4 bg-white rounded-lg shadow-lg space-y-2">
          <CardTitle className={"text-slate-600"}>Total Hour</CardTitle>
          <CardDescription className="text-2xl font-bold text-indigo-600">
            {attendance?.metadata?.totalHour || "00:00"} hrs
          </CardDescription>
        </div>
        <div className="flex flex-col p-4 bg-white rounded-lg shadow-lg space-y-2">
          <CardTitle className={"text-slate-600"}>Gross Pay</CardTitle>
          <CardDescription className="text-2xl font-bold text-blue-600">
            {formatCurrency(attendance?.metadata?.totalPay || 0)}
          </CardDescription>
        </div>
        <div className="flex flex-col p-4 bg-white rounded-lg shadow-lg space-y-2">
          <CardTitle className={"text-slate-600"}>CIS Deduct</CardTitle>
          <CardDescription className="text-2xl font-bold text-amber-600">
            {formatCurrency(attendance?.metadata?.totalCIS || 0)}
          </CardDescription>
        </div>
        <div className="flex flex-col p-4 bg-white rounded-lg shadow-lg space-y-2">
          <CardTitle className={"text-slate-600"}>Net Pay</CardTitle>
          <CardDescription className="text-2xl font-bold text-green-600">
            {formatCurrency(attendance?.metadata?.finalTotalPay || 0)}
          </CardDescription>
        </div>
      </div>
      {/* Employee details section */}
      {attendance?.metadata && (
        <div className="flex justify-between items-center mt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-4">
            <dt className="text-sm font-medium text-gray-500">
              Employee Name:
            </dt>
            <dd className="text-sm text-gray-900 font-semibold">
              {attendance?.metadata.employeeName || "N/A"}
            </dd>
            <dt className="text-sm font-medium text-gray-500">PayRate:</dt>
            <dd className="text-sm text-gray-900 font-semibold">
              {formatCurrency(attendance?.metadata.payRate || 0) || "N/A"}
            </dd>
            <dt className="text-sm font-medium text-gray-500">CIS Deduct:</dt>
            <dd className="text-sm text-gray-900 font-semibold">
              {attendance?.metadata.cisDeduct || 30}%
            </dd>
            <dt className="text-sm font-medium text-gray-500">Pay Type:</dt>
            <dd className="text-sm text-gray-900 font-semibold">
              {attendance?.metadata.payType || "Hourly"}
            </dd>
          </div>
        </div>
      )}
      <div className="flex justify-between items-center mt-4">
        <h2 className="text-lg font-semibold">Attendance Data</h2>
        <div className="text-sm text-gray-500">
          Total Hours: {totalHour.toFixed(2)} hrs
        </div>
      </div>
      <div className="overflow-x-auto mt-4">
        {isLoading ? (
          <div className="text-center">Loading attendance data...</div>
        ) : (
          <>
            <Table>
              <FilterDataTableHead attendanceData={attendanceTableData} />
              <FilterDataTableBody attendanceData={attendanceTableData} />
            </Table>
            {totalCount > 10 && (
              <>
                <Separator className="my-4" />
                <PaginationWithLinks totalCount={totalCount} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

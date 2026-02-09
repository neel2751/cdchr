"use client";
import { useCommonContext } from "@/context/commonContext";
import { useFetchQuery } from "@/hooks/use-query";
import { getAttendanceReportData } from "@/server/reportServer/attendanceReportServer";
import AttendanceFilter from "./attendanceFilter";
import AttendanceTable from "./attendanceTable";
import { AttendanceChartData, AttendancePieChartData } from "./attendanceChart";
import AttendanceExport from "./attendanceExport";

export default function AttendanceReport() {
  const { searchParams } = useCommonContext();
  const startDate = searchParams.fromDate || "";
  const endDate = searchParams.toDate || "";
  const leaveYear = searchParams.leaveYear || "";
  const employeeId = searchParams.employeeId || "";

  const queryKey = [
    "leaveAttendanceReportData",
    { startDate, endDate, leaveYear, employeeId },
  ];

  const { data } = useFetchQuery({
    fetchFn: getAttendanceReportData,
    queryKey,
    params: { startDate, endDate, leaveYear, employeeId },
  });

  const { newData } = data || {};

  return (
    <div className="p-4 space-y-4">
      {newData?.chartData && (
        <>
          <AttendanceFilter>
            <AttendanceExport rawData={newData?.list || {}} />
          </AttendanceFilter>
          <div className="grid 2xl:grid-cols-2 xl:grid-cols-2 lg:grid-cols-2 grid-cols-1 gap-4 mt-4">
            <AttendanceChartData rawData={newData?.chartData || []} />
            <AttendancePieChartData rawData={newData?.chartData || []} />
          </div>
          <AttendanceTable rawData={newData?.list || []} />
        </>
      )}
    </div>
  );
}

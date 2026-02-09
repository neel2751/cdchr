"use client";
import { useCommonContext } from "@/context/commonContext";
import { useFetchQuery } from "@/hooks/use-query";
import { getLeaveReportData } from "@/server/reportServer/leaveReportServer";
import LeaveFilter from "./leaveFilter";
import {
  LeaveStatusChartData,
  LeaveStatusPieChartData,
  LeaveTypeChartData,
  LeaveTypePieChartData,
} from "./leaveChart";
import LeaveTable from "./leaveTable";
import LeaveExport from "./leaveExport";

export default function LeaveReports() {
  const { searchParams } = useCommonContext();
  const startDate = searchParams.fromDate || "";
  const endDate = searchParams.toDate || "";
  const leaveType = searchParams.leaveType || "";
  const leaveYear = searchParams.leaveYear || "";
  const employeeId = searchParams.employeeId || "";

  const queryKey = [
    "leaveReportData",
    { startDate, endDate, leaveType, leaveYear, employeeId },
  ];

  const { data } = useFetchQuery({
    fetchFn: getLeaveReportData,
    queryKey,
    params: { startDate, endDate, leaveType, leaveYear, employeeId },
  });

  const { newData } = data || {};

  return (
    <div className="p-4 space-y-4">
      {newData?.chartData && (
        <>
          <LeaveFilter>
            <LeaveExport rawData={newData?.list || {}} />
          </LeaveFilter>
          <div className="grid 2xl:grid-cols-4 xl:grid-cols-3 lg:grid-cols-3 md:grid-cols-2 grid-cols-1 gap-4 mt-4">
            <LeaveTypeChartData rawData={newData?.chartData || []} />
            <LeaveTypePieChartData rawData={newData?.chartData || []} />
            <LeaveStatusChartData rawData={newData?.statusChartData || []} />
            <LeaveStatusPieChartData rawData={newData?.statusChartData || []} />
          </div>
          <LeaveTable rawData={newData?.list || []} />
        </>
      )}
    </div>
  );
}

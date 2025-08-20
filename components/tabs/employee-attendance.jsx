"use client";

import { useFetchQuery } from "@/hooks/use-query";
import { useAvatar } from "../Avatar/AvatarContext";
import { fetchOfficeEmployeeClockCount } from "@/server/timeOffServer/timeOffServer";
import { DateRangeFilter } from "../filters/filterDate/filterDateRange";

export default function OfficeEmployeeAttendance() {
  const { slug } = useAvatar();
  const { data } = useFetchQuery({
    fetchFn: fetchOfficeEmployeeClockCount,
    params: {
      employeeId: slug[0],
    },
    queryKey: ["officeEmployeeAttendance", slug],
  });
  const { newData: attendanceCount } = data || {};
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Employee Attendance</h1>
      {JSON.stringify(attendanceCount)}
      <DateRangeFilter />
      <p className="mb-4">Attendance data for employee with ID: {slug}</p>
      {/* Additional components and logic can be added here */}
    </div>
  );
}

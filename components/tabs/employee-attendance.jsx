"use client";

import { useFetchQuery } from "@/hooks/use-query";
import { useAvatar } from "../Avatar/AvatarContext";
import {
  fetchAvgAttendance,
  fetchOfficeEmployeeClockCount,
} from "@/server/timeOffServer/timeOffServer";
import { DateRangeFilter } from "../filters/filterDate/filterDateRange";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { format } from "date-fns";
import Image from "next/image";

export default function OfficeEmployeeAttendance() {
  const { slug, searchParams } = useAvatar();
  const { data } = useFetchQuery({
    fetchFn: fetchOfficeEmployeeClockCount,
    params: {
      employeeId: slug[0],
      fromDate: searchParams?.fromDate || null,
      toDate: searchParams?.toDate || null,
    },
    queryKey: ["officeEmployeeAttendance", slug, searchParams],
  });
  const { data: avgData } = useFetchQuery({
    fetchFn: fetchAvgAttendance,
    params: {
      employeeId: slug[0],
      fromDate: searchParams?.fromDate || null,
      toDate: searchParams?.toDate || null,
    },
    queryKey: ["avgAttendance", slug, searchParams],
  });
  const { newData: attendanceCount } = data || {};
  const { newData: avgAttendance } = avgData || {};
  return (
    <div className="">
      <div className="flex items-center justify-between mb-4">
        <CardTitle className="text-xl font-semibold text-pretty tracking-tight">
          Attendance Records
        </CardTitle>
        <DateRangeFilter />
      </div>
      <Card>
        <CardHeader className="flex justify-between">
          <div>
            <CardTitle>Time Tracking Dashboard</CardTitle>
            <CardDescription>
              View and manage employee attendance and time tracking records
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className={"grid grid-cols-4 gap-5"}>
          <Card className="bg-green-50 text-green-600 border-none shadow-none">
            <CardHeader>
              <CardTitle>Avg. Clock In</CardTitle>
              <span className="text-2xl font-semibold">
                {avgAttendance?.avgClockIn || 0.0}
              </span>
            </CardHeader>
          </Card>
          <Card className="bg-red-50 text-red-600 border-none shadow-none">
            <CardHeader>
              <CardTitle>Avg. Clock Out</CardTitle>
              <span className="text-2xl font-semibold">
                {avgAttendance?.avgClockOut || 0.0}
              </span>
            </CardHeader>
          </Card>

          <Card className="bg-blue-50 text-blue-600 border-none shadow-none">
            <CardHeader>
              <CardTitle>Total Hours</CardTitle>
              <span className="text-2xl font-semibold">
                {avgAttendance?.totalHours || 0.0}
              </span>
            </CardHeader>
          </Card>
          <Card className="bg-purple-50 text-purple-600 border-none shadow-none">
            <CardHeader>
              <CardTitle>Average Hours</CardTitle>
              <span className="text-2xl font-semibold">
                {avgAttendance?.avgHours || "0.00"}
              </span>
            </CardHeader>
          </Card>
        </CardContent>
      </Card>
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Attendance Records</CardTitle>
          <CardDescription>
            View the clock-in and clock-out records
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {attendanceCount?.length > 0 ? (
            attendanceCount.map((record, index) => (
              <div
                key={index}
                className="flex items-center justify-between border-b last:border-b-0"
              >
                <div>
                  <CardTitle className="text-slate-600">
                    {format(record.date, "PPPP")}
                  </CardTitle>
                  <CardDescription>
                    {record.totalHours.split(":")[0]} hours{" "}
                    {record.totalHours.split(":")[1]} minutes
                  </CardDescription>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-sm text-gray-600">
                    Clock In:{" "}
                    <span className="font-semibold text-blue-600">
                      {record.clockIn || "N/A"}
                    </span>{" "}
                    | Clock Out:
                    <span className="font-semibold text-red-600">
                      {record.clockOut || "N/A"}
                    </span>
                  </span>
                  <span className="text-sm text-gray-600">
                    Break In : {record.breakIn || "N/A"} | Break Out:{" "}
                    {record.breakOut || "N/A"}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center text-gray-500 w-full">
              <Card>
                <CardContent>
                  <Image
                    src={"/images/emptyFile.svg"}
                    alt="No Data"
                    width={150}
                    height={150}
                    className="mx-auto"
                  />
                  <CardTitle>No Attendance Records Found</CardTitle>
                  <CardDescription>
                    Please check back later or contact your administrator.
                  </CardDescription>
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

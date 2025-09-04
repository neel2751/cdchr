"use client";

import { useFetchQuery } from "@/hooks/use-query";
import { useAvatar } from "../Avatar/AvatarContext";
import {
  fetchChartData,
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
import { ReusableBarAttendanceChart } from "../charts/charts";
import { PaginationWithLinks } from "../filters/pagination/pagination-client";

export default function OfficeEmployeeAttendance() {
  const { slug, searchParams } = useAvatar();
  const { data } = useFetchQuery({
    fetchFn: fetchOfficeEmployeeClockCount,
    params: {
      employeeId: slug[0],
      fromDate: searchParams?.fromDate || null,
      toDate: searchParams?.toDate || null,
      page: searchParams?.page || 1,
      limit: searchParams?.pageSize || 10,
    },
    queryKey: ["officeEmployeeAttendance", slug, searchParams],
  });
  // const { data: barData } = useFetchQuery({
  //   fetchFn: fetchChartData,
  //   params: {
  //     employeeId: slug[0],
  //     fromDate: searchParams?.fromDate || null,
  //     toDate: searchParams?.toDate || null,
  //   },
  //   queryKey: ["chartData", slug, searchParams],
  // });
  // const { newData: barChartData } = barData || {};
  const { newData: attendanceCount } = data || {};
  return (
    <div className="">
      <div className="sm:flex items-center justify-between mb-4">
        <CardTitle className="text-xl font-semibold text-pretty tracking-tight">
          Attendance Records
        </CardTitle>
        <DateRangeFilter />
      </div>
      {/* <div className="mb-5">
        {barChartData && <ReusableBarAttendanceChart data={barChartData} />}
      </div> */}
      <Card>
        <CardHeader className="flex justify-between">
          <div>
            <CardTitle>Time Tracking Dashboard</CardTitle>
            <CardDescription>
              View and manage employee attendance and time tracking records
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className={"grid sm:grid-cols-5 grid-cols-2 gap-5"}>
          <Card className="bg-green-50 text-green-600 border-none shadow-none">
            <CardHeader>
              <CardTitle>Avg. Clock In</CardTitle>
              <span className="text-2xl font-semibold">
                {attendanceCount?.avgClockIn || 0.0}
              </span>
            </CardHeader>
          </Card>
          <Card className="bg-red-50 text-red-600 border-none shadow-none">
            <CardHeader>
              <CardTitle>Avg. Clock Out</CardTitle>
              <span className="text-2xl font-semibold">
                {attendanceCount?.avgClockOut || 0.0}
              </span>
            </CardHeader>
          </Card>

          <Card className="bg-blue-50 text-blue-600 border-none shadow-none">
            <CardHeader>
              <CardTitle>Total Hours</CardTitle>
              <span className="text-2xl font-semibold">
                {attendanceCount?.totalHours || 0.0}
              </span>
            </CardHeader>
          </Card>
          <Card className="bg-purple-50 text-purple-600 border-none shadow-none">
            <CardHeader>
              <CardTitle>Avg. Hours</CardTitle>
              <span className="text-2xl font-semibold">
                {attendanceCount?.avgHours || "0.00"}
              </span>
            </CardHeader>
          </Card>
          <Card className="bg-amber-50 text-amber-600 border-none shadow-none">
            <CardHeader>
              <CardTitle>Avg. Break Hours</CardTitle>
              <span className="text-2xl font-semibold">
                {attendanceCount?.avgBreakHours || "0.00"}
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
          {attendanceCount && attendanceCount?.records?.length > 0 ? (
            attendanceCount?.records?.map((record, index) => (
              <div
                key={index}
                className="flex items-center justify-between border-b last:border-b-0 pb-2 last:pb-0"
              >
                <div>
                  <CardTitle className="text-slate-600">
                    {format(record.date, "PPPP")}
                  </CardTitle>
                  <CardDescription>
                    {record?.totalHoursPerDay?.split(":")[0]} hours{" "}
                    {record?.totalHoursPerDay?.split(":")[1]} minutes
                  </CardDescription>
                  <CardDescription>
                    {record?.breakHoursPerDay?.split(":")[0]} hours{" "}
                    {record?.breakHoursPerDay?.split(":")[1]} minutes
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
          {attendanceCount?.totalRecords > 10 && (
            <PaginationWithLinks totalCount={attendanceCount?.totalRecords} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

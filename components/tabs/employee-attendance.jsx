"use client";

import { useFetchQuery } from "@/hooks/use-query";
import { useAvatar } from "../Avatar/AvatarContext";
import {
  fetchChartData,
  fetchKpiMetrics,
  fetchOfficeEmployeeClockCount,
  fetchPunctualityRate,
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
  const { data: barData } = useFetchQuery({
    fetchFn: fetchPunctualityRate,
    params: {
      employeeId: slug[0],
      fromDate: searchParams?.fromDate || null,
      toDate: searchParams?.toDate || null,
    },
    queryKey: ["chartData", slug, searchParams],
  });
  const { newData: barChartData } = barData || {};
  console.log("barChartData", barChartData);
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
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b last:border-b-0 pb-3 last:pb-0"
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
                <div className="flex flex-col items-start sm:items-end">
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
      {/* Attendance with month start to end ui with present late halfday day off holiday weekend with different colour */}
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Monthly Attendance Overview</CardTitle>
          <CardDescription>
            Overview of attendance status for the month
          </CardDescription>
        </CardHeader>
        <CardContent>
          <section className="overflow-hidden">
            <div className="bg-linear-to-b to-muted relative m-4 overflow-hidden rounded-[2rem] via-pink-100 py-24 [--color-for-foreground:var(--color-pink-950)]">
              <div className="absolute inset-0 bg-[radial-gradient(black_1px,transparent_1px)] mix-blend-overlay [background-size:16px_16px]"></div>
              <div className="@container relative mx-auto w-full max-w-5xl px-6">
                <div className="mx-auto max-w-2xl text-center">
                  <h2 className="text-foreground text-4xl font-semibold">
                    Simple Three-Step Workflow
                  </h2>
                  <p className="text-muted-foreground mt-4 text-balance text-lg">
                    Experience our streamlined approach to data analysis that
                    empowers your team to make informed decisions quickly and
                    efficiently.
                  </p>
                </div>
                <div className="@3xl:grid-cols-3 my-20 grid gap-12">
                  <div className="space-y-6 text-center">
                    <div className="relative flex h-28 items-center">
                      <div className="bg-foreground/5 relative mx-auto size-fit p-2">
                        <span className="absolute -left-px -top-px block rounded-tl border-l border-t size-2 border-purple-500"></span>
                        <span className="absolute -right-px -top-px block rounded-tr border-r border-t size-2 border-purple-500"></span>
                        <span className="absolute -bottom-px -left-px block rounded-bl border-b border-l size-2 border-purple-500"></span>
                        <span className="absolute -bottom-px -right-px block rounded-br border-b border-r size-2 border-purple-500"></span>
                        <div
                          aria-hidden="true"
                          className="bg-background relative z-10 w-16 space-y-2 rounded-md p-2 shadow-md shadow-black/15"
                        >
                          <div className="flex items-center gap-1">
                            <div className="bg-foreground/15 size-2.5 rounded-full"></div>
                            <div className="bg-foreground/15 h-[3px] w-4 rounded-full"></div>
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1">
                              <div className="bg-foreground/15 h-[3px] w-2.5 rounded-full"></div>
                              <div className="bg-foreground/15 h-[3px] w-6 rounded-full"></div>
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="bg-foreground/15 h-[3px] w-2.5 rounded-full"></div>
                              <div className="bg-foreground/15 h-[3px] w-6 rounded-full"></div>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <div className="bg-foreground/15 h-[3px] w-full rounded-full"></div>
                            <div className="flex items-center gap-1">
                              <div className="bg-foreground/15 h-[3px] w-2/3 rounded-full"></div>
                              <div className="bg-foreground/15 h-[3px] w-1/3 rounded-full"></div>
                            </div>
                          </div>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            className="lucide lucide-signature ml-auto size-3"
                          >
                            <path d="m21 17-2.156-1.868A.5.5 0 0 0 18 15.5v.5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1c0-2.545-3.991-3.97-8.5-4a1 1 0 0 0 0 5c4.153 0 4.745-11.295 5.708-13.5a2.5 2.5 0 1 1 3.31 3.284"></path>
                            <path d="M3 21h18"></path>
                          </svg>
                        </div>
                      </div>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="4"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        className="lucide lucide-plus @3xl:block fill-background stroke-background absolute inset-y-0 right-0 my-auto hidden translate-x-[75%] drop-shadow"
                      >
                        <path d="M5 12h14"></path>
                        <path d="M12 5v14"></path>
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-foreground mb-4 text-lg font-semibold">
                        Face Detection
                      </h3>
                      <p className="text-muted-foreground text-balance">
                        Effortlessly identify and manage users with our advanced
                        face recognition system.
                      </p>
                    </div>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="4"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      className="lucide lucide-plus @3xl:hidden fill-background stroke-background mx-auto translate-y-[75%] drop-shadow"
                    >
                      <path d="M5 12h14"></path>
                      <path d="M12 5v14"></path>
                    </svg>
                  </div>
                  <div className="space-y-6 text-center">
                    <div className="relative flex h-28 items-center">
                      <div className="before:bg-background relative mx-auto my-6 w-fit before:absolute before:inset-x-2 before:-bottom-2 before:top-2 before:rounded-xl before:opacity-50 before:shadow">
                        <div className="bg-background relative overflow-hidden rounded-xl border shadow-md">
                          <div className="grid grid-cols-[1fr_auto] gap-6 p-3">
                            <div className="text-left text-sm">
                              <div className="text-foreground">
                                Méschac Irung
                              </div>
                              <div className="text-muted-foreground text-xs">
                                CEO, Acme
                              </div>
                            </div>
                            <div className="border p-2">
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="24"
                                height="24"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                className="lucide lucide-signature size-5"
                              >
                                <path d="m21 17-2.156-1.868A.5.5 0 0 0 18 15.5v.5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1c0-2.545-3.991-3.97-8.5-4a1 1 0 0 0 0 5c4.153 0 4.745-11.295 5.708-13.5a2.5 2.5 0 1 1 3.31 3.284"></path>
                                <path d="M3 21h18"></path>
                              </svg>
                            </div>
                          </div>
                          <div className="bg-linear-to-br flex items-center gap-1 from-yellow-400 to-orange-600 p-2 text-sm">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="24"
                              height="24"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              className="lucide lucide-shield-check size-4 text-white drop-shadow-sm"
                            >
                              <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path>
                              <path d="m9 12 2 2 4-4"></path>
                            </svg>
                            <span className="text-white">Verified</span>
                          </div>
                        </div>
                      </div>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="4"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        className="lucide lucide-equal @3xl:block fill-background stroke-background absolute inset-y-0 right-0 my-auto hidden translate-x-[75%] drop-shadow"
                      >
                        <line x1="5" x2="19" y1="9" y2="9"></line>
                        <line x1="5" x2="19" y1="15" y2="15"></line>
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-foreground mb-4 text-lg font-semibold">
                        Automated Analysis
                      </h3>
                      <p className="text-muted-foreground text-balance">
                        Our AI-powered system processes complex datasets to
                        identify patterns and insights instantly.
                      </p>
                    </div>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="4"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      className="lucide lucide-equal @3xl:hidden fill-background stroke-background mx-auto translate-y-[75%] drop-shadow"
                    >
                      <line x1="5" x2="19" y1="9" y2="9"></line>
                      <line x1="5" x2="19" y1="15" y2="15"></line>
                    </svg>
                  </div>
                  <div className="space-y-6 text-center">
                    <div className="relative flex h-28 items-center">
                      <div className="before:bg-background relative mx-auto my-6 w-fit before:absolute before:inset-x-2 before:-bottom-2 before:top-2 before:rounded-xl before:opacity-50 before:shadow">
                        <div className="bg-linear-to-t to-background inset-ring-1 inset-ring-background relative flex gap-4 overflow-hidden rounded-xl border from-purple-50 p-4 pr-8 shadow-md">
                          <div className="flex size-7 rounded-full bg-emerald-500/10">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="24"
                              height="24"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              className="lucide lucide-badge-check m-auto size-4 text-emerald-600"
                            >
                              <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"></path>
                              <path d="m9 12 2 2 4-4"></path>
                            </svg>
                          </div>
                          <div className="text-left">
                            <div className="mb-3 text-sm">
                              <div className="text-foreground font-medium">
                                Signatures Approved
                              </div>
                              <div className="text-muted-foreground text-xs">
                                Generate reports and insights
                              </div>
                            </div>
                            <button className="cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg]:size-4 [&amp;_svg]:shrink-0 shadow-sm shadow-black/15 border border-transparent bg-background ring-1 ring-foreground/10 duration-200 hover:bg-muted/50 dark:ring-foreground/15 dark:hover:bg-muted/50 rounded-md px-3 text-xs h-7">
                              View Report
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-foreground mb-4 text-lg font-semibold">
                        Actionable Reports
                      </h3>
                      <p className="text-muted-foreground text-balance">
                        Transform insights into beautiful visualizations and
                        shareable reports to drive decisions.
                      </p>
                    </div>
                  </div>
                </div>
                <a
                  className="cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg]:size-4 [&amp;_svg]:shrink-0 shadow-sm shadow-black/15 border border-transparent bg-background ring-1 ring-foreground/10 duration-200 hover:bg-muted/50 dark:ring-foreground/15 dark:hover:bg-muted/50 h-9 px-4 py-2 mx-auto flex w-fit"
                  href="/sign-up"
                >
                  Get Started
                </a>
              </div>
            </div>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

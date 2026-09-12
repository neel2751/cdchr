"use client";

import { useState } from "react";
import { CalendarCheck2, CalendarRange, Loader2, PlusIcon } from "lucide-react";

import SearchDebounce from "@/components/search/searchDebounce";
import { SelectFilter } from "@/components/selectFilter/selectFilter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CommonContext } from "@/context/commonContext";
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import Pagination from "@/lib/pagination";
import {
  getWeeklyAttendanceUploadStats,
  getWeeklyAttendanceUploadYears,
  getWeeklyAttendanceUploads,
} from "@/server/attendanceServer/attendanceUploadServer";
import AttendanceUploadTable from "./attendanceUploadTable";
import UploadAttendanceDialog, { weekLabel } from "./uploadAttendanceDialog";

const MONTH_OPTIONS = [
  { label: "All Months", value: "" },
  ...[
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ].map((name, index) => ({ label: name, value: String(index + 1) })),
];

function StatCard({ icon: Icon, label, value, hint, className }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={`rounded-lg p-2 ${
            className || "bg-neutral-100 text-neutral-600"
          }`}
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-neutral-500">{label}</p>
          <p className="truncate text-xl font-semibold leading-tight">{value}</p>
          {hint ? (
            <p className="truncate text-xs text-neutral-400">{hint}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

const AttendanceUpload = ({ searchParams }) => {
  const currentPage = parseInt(searchParams?.page || "1");
  const pagePerData = parseInt(searchParams?.pageSize || "10");
  const query = searchParams?.query;

  // Month filtering is scoped by year: "September" on its own would mix every
  // September the company has ever recorded, so picking a month with no year
  // pins the year to the current one.
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const { data: yearOptions = [] } = useFetchSelectQuery({
    queryKey: ["attendanceUploadYears"],
    fetchFn: getWeeklyAttendanceUploadYears,
  });

  const { data: statsRaw } = useFetchSelectQuery({
    queryKey: ["attendanceUploadStats"],
    fetchFn: getWeeklyAttendanceUploadStats,
  });
  const stats = Array.isArray(statsRaw) ? {} : statsRaw || {};

  const queryKey = [
    "attendanceUploads",
    { query, currentPage, pagePerData, month, year },
  ];

  const { data, isLoading, isError } = useFetchQuery({
    params: {
      query,
      page: currentPage,
      pageSize: pagePerData,
      month,
      year,
    },
    queryKey,
    fetchFn: getWeeklyAttendanceUploads,
  });

  const { newData: result = [], totalCount = 0 } = data || {};

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          icon={CalendarRange}
          label="Weeks Uploaded"
          value={stats?.totalWeeks ?? "—"}
        />
        <StatCard
          icon={CalendarCheck2}
          label="This Month"
          value={stats?.thisMonth ?? "—"}
          className="bg-emerald-100 text-emerald-600"
        />
        <StatCard
          icon={CalendarRange}
          label="Latest Week"
          value={
            stats?.latestWeekStart
              ? weekLabel(stats.latestWeekStart, stats.latestWeekEnd)
              : "—"
          }
          className="bg-indigo-100 text-indigo-600"
        />
      </div>

      <CommonContext.Provider
        value={{ result, currentPage, pagePerData, totalCount }}
      >
        <Card>
          <CardHeader>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>Weekly Attendance Uploads</CardTitle>
                <CardDescription>
                  One attendance sheet per Monday-to-Sunday week. Upload a week,
                  then review or download it here.
                </CardDescription>
              </div>
              <Button className="gap-2" onClick={() => setIsUploadOpen(true)}>
                <PlusIcon className="size-4" />
                Upload attendance
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SearchDebounce placeholder="Search by file, note, uploader..." />
              <div className="flex flex-wrap items-center gap-2">
                <SelectFilter
                  label="Year"
                  value={year}
                  frameworks={[{ label: "All Years", value: "" }, ...yearOptions]}
                  placeholder="All Years"
                  onChange={(value) => {
                    setYear(value);
                    if (!value) setMonth("");
                  }}
                  noData="No years"
                />
                <SelectFilter
                  label="Month"
                  value={month}
                  frameworks={MONTH_OPTIONS}
                  placeholder="All Months"
                  onChange={(value) => {
                    setMonth(value);
                    if (value && !year) setYear(String(new Date().getFullYear()));
                  }}
                  noData="No months"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex h-20 w-full items-center justify-center">
                <Loader2 className="size-10 animate-spin text-neutral-500" />
              </div>
            ) : isError ? (
              <div className="text-center text-gray-500">
                Something went wrong
              </div>
            ) : result.length <= 0 ? (
              <div className="py-6 text-center text-gray-500">
                No attendance uploaded for this period yet.
              </div>
            ) : (
              <>
                <AttendanceUploadTable />
                {totalCount > 10 && (
                  <div className="mt-2 border-t pt-4">
                    <Pagination />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </CommonContext.Provider>

      {isUploadOpen ? (
        <UploadAttendanceDialog open onOpenChange={setIsUploadOpen} />
      ) : null}
    </div>
  );
};

export default AttendanceUpload;

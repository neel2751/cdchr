"use client";
import { DatePickerWithRange } from "@/components/form/formFields";
import SearchDebounce from "@/components/search/searchDebounce";
import { CommonContext } from "@/context/commonContext";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { useQuery } from "@tanstack/react-query";
import Pagination from "@/lib/pagination";
import { addDays, format } from "date-fns";
import React from "react";
import FilterTable from "./filterTable";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SelectFilter } from "@/components/selectFilter/selectFilter";
import { fetchFilterClockRecordData } from "@/server/siteAssignmentServer/siteAssignmentServer";
import { minutesToHHMM } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  getSelectProjects,
  getSelectOfficeEmployee,
  getSelectSiteEmployee,
} from "@/server/selectServer/selectServer";
import { logCsvExport } from "@/server/auditServer/exportAudit";

const WORKFORCE_OPTIONS = [
  { label: "All Employees", value: "" },
  { label: "Office Employee", value: "office" },
  { label: "Site Employee", value: "site" },
];

const PAYMENT_OPTIONS = [
  { label: "All", value: "All" },
  { label: "Monthly", value: "Monthly" },
  { label: "Weekly", value: "Weekly" },
];

const STATUS_LABEL = {
  work: "Worked",
  paidLeave: "Paid Holiday",
  unpaidLeave: "Unpaid Leave",
};

/** Minutes as "HH:MM", or a dash when there is nothing to show. */
const hm = (minutes) => (minutes ? minutesToHHMM(minutes) : "00:00");

// Whether the client has taken over from the server-rendered markup. Used to
// hold the query back until the browser is driving, and to keep
// `window.history` out of the server pass. Read through useSyncExternalStore
// rather than a setState-in-effect, which cascades an extra render.
const neverChanges = () => () => {};
const useIsHydrated = () =>
  React.useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  );

function StatCard({ label, value, hint, className }) {
  return (
    <Card className={`border-none shadow-none ${className}`}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <span className="text-2xl font-semibold">{value}</span>
        {hint ? <span className="text-xs opacity-70">{hint}</span> : null}
      </CardHeader>
    </Card>
  );
}

const FilterAttendance = ({ searchParams }) => {
  const query = searchParams?.query || "";
  const currentPage = parseInt(searchParams?.page || "1");
  const pagePerData = parseInt(searchParams?.pageSize || "10");
  const isHydrated = useIsHydrated();
  const [filter, setFilter] = React.useState({
    paymentType: searchParams?.paymentType || "All",
    siteId: searchParams?.siteId || "",
    employeeType: searchParams?.employeeType || "",
    employeeId: searchParams?.employeeId || "",
  });

  const [date, setDate] = React.useState({
    // deafult date is before 20 days from today
    from: searchParams.fromDate || addDays(new Date(), -20),
    to: searchParams.toDate || new Date(),
  });

  const isOffice = filter.employeeType === "office";
  const isSite = filter.employeeType === "site";

  const { data: siteData } = useFetchSelectQuery({
    fetchFn: getSelectProjects,
    queryKey: ["siteData"],
  });

  // Only the list matching the chosen workforce is fetched — offering office
  // staff under a site filter would produce a combination that never matches.
  const { data: officeEmployees = [] } = useFetchSelectQuery({
    fetchFn: getSelectOfficeEmployee,
    queryKey: ["officeEmployeeSelect"],
  });
  const { data: siteEmployees = [] } = useFetchSelectQuery({
    fetchFn: getSelectSiteEmployee,
    queryKey: ["siteEmployeeSelect"],
  });

  const employeeOptions = React.useMemo(() => {
    const list = isOffice
      ? officeEmployees
      : isSite
        ? siteEmployees
        : [...officeEmployees, ...siteEmployees];
    return [{ label: "All Employees", value: "" }, ...(list || [])];
  }, [isOffice, isSite, officeEmployees, siteEmployees]);

  const queryKey = [
    "attendanceData",
    { filter, date, query, currentPage, pagePerData },
  ];
  const { data, isLoading, isError } = useQuery({
    queryKey,
    enabled: isHydrated, // <- don't run before hydration
    queryFn: async () => {
      const response = await fetchFilterClockRecordData({
        ...filter,
        query: query || "",
        page: currentPage,
        pageSize: pagePerData,
        fromDate: format(new Date(date.from), "yyyy-MM-dd"),
        toDate: format(new Date(date.to), "yyyy-MM-dd"),
      });
      return {
        newData: JSON.parse(response?.data || "[]"),
        totalCount: response?.totalCount || 0,
        summary: response?.summary || null,
        leaveExcluded: response?.leaveExcluded || false,
        workSetting: response?.workSetting || null,
      };
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  // we have to set the date in query paarams
  React.useEffect(() => {
    if (!isHydrated) return;

    const fromDate = format(new Date(date.from), "yyyy-MM-dd");
    const toDate = format(new Date(date.to), "yyyy-MM-dd");

    const params = new URLSearchParams({
      ...filter,
      query,
      page: currentPage,
      pageSize: pagePerData,
      fromDate,
      toDate,
    });

    window.history.replaceState({}, "", `?${params.toString()}`);
  }, [filter, date, query, currentPage, pagePerData, isHydrated]);

  const { newData, totalCount, summary, leaveExcluded, workSetting } =
    data || {};

  // Every column the export needs is built here, so the CSV and the table can
  // never drift apart — the table renders exactly these keys.
  const filteredData = React.useMemo(() => {
    if (!newData || newData.length === 0) return [];
    return newData.map((item) => {
      const isLeave = item.kind !== "work";
      return {
        Employee: item?.name || "-",
        Workforce: item?.workforce || "-",
        Site: item?.siteName || (isLeave ? "-" : "Office"),
        Date: format(new Date(item?.date), "PPP"),
        Status: STATUS_LABEL[item?.kind] || item?.kind,
        PaymentType: item?.paymentType || "-",
        ClockIn: isLeave ? "-" : item?.clockIn || "-",
        ClockOut: isLeave ? "-" : item?.clockOut || "-",
        Breaks: isLeave
          ? "-"
          : item?.breaks?.length
            ? item.breaks
                .map(
                  (b, i) =>
                    `Break ${i + 1}: ${b.breakIn || "00:00"} - ${
                      b.breakOut || "00:00"
                    }`,
                )
                .join(" | ")
            : "No Breaks",
        TotalHours: isLeave ? "-" : hm(item?.spanMinutes),
        BreakHours: isLeave ? "-" : hm(item?.breakMinutes),
        NetHours: isLeave ? "-" : hm(item?.netMinutes),
        // Every leave category is reported, not only annual leave — the
        // paid/unpaid split comes from the request's own isPaid flag.
        LeaveType: isLeave
          ? `${item?.leaveType || "Leave"}${
              item?.isHalfDay
                ? ` (Half Day${item?.halfDayType ? ` - ${item.halfDayType}` : ""})`
                : ""
            }`
          : "-",
        LeaveDays: isLeave ? (item?.isHalfDay ? "0.5" : "1") : "-",
        LeaveHours: isLeave
          ? item?.leaveMinutes
            ? hm(item.leaveMinutes)
            : "Not set"
          : "-",
      };
    });
  }, [newData]);

  const exportedCSV = () => {
    if (!newData || totalCount === 0) return [];
    let csvContent = "data:text/csv;charset=utf-8,";

    // A totals block above the rows, so an exported sheet carries the same
    // figures as the screen rather than needing them re-derived.
    const totals = [
      ["Range", `${format(new Date(date.from), "PPP")} - ${format(new Date(date.to), "PPP")}`],
      ["Workforce", isOffice ? "Office" : isSite ? "Site" : "All"],
      ["Employees", summary?.employeeCount ?? 0],
      ["Days Worked", summary?.workDays ?? 0],
      ["Total Hours", hm(summary?.totalSpanMinutes)],
      ["Break Hours", hm(summary?.totalBreakMinutes)],
      ["Net Hours", hm(summary?.totalNetMinutes)],
      ["Paid Holiday Days", summary?.paidLeaveDays ?? 0],
      ["Paid Holiday Hours", hm(summary?.paidLeaveMinutes)],
      ["Unpaid Leave Days", summary?.unpaidLeaveDays ?? 0],
      ["Unpaid Leave Hours", hm(summary?.unpaidLeaveMinutes)],
      ["Fixed Weekly Hours", workSetting?.fixedWeeklyHours ?? ""],
    ];
    totals.forEach(([k, v]) => {
      csvContent += `"${k}","${v}"\r\n`;
    });
    csvContent += "\r\n";

    csvContent += Object.keys(filteredData[0]).join(",") + "\r\n";
    filteredData.forEach((row) => {
      const rowValues = Object.values(row).map((value) =>
        typeof value === "string" ? `"${value}"` : value,
      );
      csvContent += rowValues.join(",") + "\r\n";
    });
    var encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `attendance-${format(new Date(date.from), "yyyy-MM-dd")}-to-${format(
        new Date(date.to),
        "yyyy-MM-dd",
      )}.csv`,
    );
    document.body.appendChild(link); // Required for FF
    link.click(); // This will download the data file named "attendance_data.csv".
    document.body.removeChild(link); // Cleanup

    // Record the export for the compliance audit trail (who exported, range, rows)
    logCsvExport({
      source: "filterAttendance",
      label: "Filtered attendance",
      dateFrom: format(new Date(date.from), "yyyy-MM-dd"),
      dateTo: format(new Date(date.to), "yyyy-MM-dd"),
      rowCount: filteredData?.length ?? 0,
    }).catch(() => {});
  };

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader>
          <div className="mb-4 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Filter Attendance</CardTitle>
                <CardDescription>
                  Worked time and leave across office and site staff, for any
                  date range.
                </CardDescription>
              </div>
              <Button onClick={exportedCSV} className="w-fit">
                Export CSV
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <SearchDebounce />
            <div className="flex flex-wrap gap-3">
              <SelectFilter
                label="Type"
                value={filter.employeeType}
                frameworks={WORKFORCE_OPTIONS}
                placeholder="All Employees"
                // Switching workforce clears the narrower filters below it —
                // a site or a person from the old workforce cannot match.
                onChange={(e) =>
                  setFilter({
                    ...filter,
                    employeeType: e,
                    employeeId: "",
                    siteId: e === "office" ? "" : filter.siteId,
                  })
                }
                noData="No Data found"
              />

              {/* Office staff have no site, so the site filter is offered only
                  where it can actually narrow anything. */}
              {!isOffice && siteData && (
                <SelectFilter
                  label="Site"
                  value={filter.siteId}
                  frameworks={[{ label: "All Sites", value: "" }, ...siteData]}
                  placeholder="All Sites"
                  onChange={(e) => setFilter({ ...filter, siteId: e })}
                  noData="No Data found"
                />
              )}

              <SelectFilter
                label="Employee"
                value={filter.employeeId}
                frameworks={employeeOptions}
                placeholder="All Employees"
                onChange={(e) => setFilter({ ...filter, employeeId: e })}
                noData="No employees found"
              />

              <SelectFilter
                label="Payment"
                value={filter?.paymentType}
                frameworks={PAYMENT_OPTIONS}
                placeholder="Payment Type"
                onChange={(e) => setFilter({ ...filter, paymentType: e })}
                noData="No Data found"
              />
              <DatePickerWithRange date={date} setDate={setDate} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard
              label="Total Hours"
              value={hm(summary?.totalSpanMinutes)}
              hint="Clock in to clock out"
              className="bg-indigo-50 text-indigo-600"
            />
            <StatCard
              label="Break Hours"
              value={hm(summary?.totalBreakMinutes)}
              hint="All breaks taken"
              className="bg-yellow-50 text-yellow-700"
            />
            <StatCard
              label="Net Hours"
              value={hm(summary?.totalNetMinutes)}
              hint="Total minus breaks"
              className="bg-green-50 text-green-700"
            />
            <StatCard
              label="Paid Holiday"
              value={hm(summary?.paidLeaveMinutes)}
              hint={`${summary?.paidLeaveDays ?? 0} day${
                summary?.paidLeaveDays === 1 ? "" : "s"
              } paid`}
              className="bg-orange-50 text-orange-700"
            />
            <StatCard
              label="Unpaid Leave"
              value={hm(summary?.unpaidLeaveMinutes)}
              hint={`${summary?.unpaidLeaveDays ?? 0} day${
                summary?.unpaidLeaveDays === 1 ? "" : "s"
              } unpaid`}
              className="bg-rose-50 text-rose-700"
            />
            <StatCard
              label="Employees"
              value={summary?.employeeCount ?? 0}
              hint={`${summary?.workDays ?? 0} days worked`}
              className="bg-neutral-100 text-neutral-700"
            />
          </div>

          {workSetting ? (
            <p className="text-xs text-neutral-500">
              Paid and unpaid leave hours are valued from each employee&rsquo;s
              contract — weekly hours divided by their working days, halved for
              a half day. Employees on fixed hours use{" "}
              <span className="font-medium">
                {workSetting.fixedWeeklyHours}h/week
              </span>
              , adjustable in Leave Management → Settings.
            </p>
          ) : null}

          {leaveExcluded ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              Leave is not recorded against a site, so paid holiday and unpaid
              leave are left out while a site filter is applied.
            </p>
          ) : null}

          <CommonContext.Provider
            value={{
              data: filteredData,
              currentPage,
              pagePerData,
              totalCount,
            }}
          >
            {isLoading && <div>Loading...</div>}
            {isError && <div>Error</div>}
            {!isLoading && newData?.length <= 0 ? (
              <div className="text-center text-gray-500">No data available</div>
            ) : (
              <FilterTable />
            )}
            {totalCount > 10 && (
              <div className="pt-4 mt-2 border-t border-gray-200">
                <Pagination />
                <p className="text-sm text-gray-500 mt-1">
                  Showing {filteredData.length} of {totalCount} results
                </p>
              </div>
            )}
          </CommonContext.Provider>
        </CardContent>
      </Card>
    </div>
  );
};

export default FilterAttendance;

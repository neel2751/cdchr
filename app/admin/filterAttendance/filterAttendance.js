"use client";
import { DatePickerWithRange } from "@/components/form/formFields";
import SearchDebounce from "@/components/search/searchDebounce";
import { CommonContext } from "@/context/commonContext";
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import Pagination from "@/lib/pagination";
// import { fetchEmployeAttendanceDataWithDateRange } from "@/server/attendanceServer/attendanceServer";
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
import { calculateDuration } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { getSelectProjects } from "@/server/selectServer/selectServer";

const FilterAttendance = ({ searchParams }) => {
  const query = searchParams?.query || "";
  const currentPage = parseInt(searchParams?.page || "1");
  const pagePerData = parseInt(searchParams?.pageSize || "10");
  const [isHydrated, setIsHydrated] = React.useState(false);
  const [filter, setFilter] = React.useState({
    paymentType: searchParams?.paymentType || "All",
    siteId: searchParams?.siteId || "",
  });

  const [date, setDate] = React.useState({
    // deafult date is before 20 days from today
    from: searchParams.fromDate || addDays(new Date(), -20),
    to: searchParams.toDate || new Date(),
  });

  React.useEffect(() => {
    setIsHydrated(true);
  }, []);

  const { data: siteData } = useFetchSelectQuery({
    fetchFn: getSelectProjects,
    queryKey: ["siteData"],
  });

  const queryKey = [
    "attendanceData",
    { filter, date, query, currentPage, pagePerData },
  ];
  const { data, isLoading, isError } = useFetchQuery({
    enabled: isHydrated, // <- don't run before hydration
    params: {
      ...filter,
      query: query || "",
      page: currentPage,
      pageSize: pagePerData,
      fromDate: format(date.from, "yyyy-MM-dd"),
      toDate: format(date.to, "yyyy-MM-dd"),
    },
    queryKey,
    fetchFn: fetchFilterClockRecordData,
  });

  // we have to set the date in query paarams
  React.useEffect(() => {
    if (!isHydrated) return;

    const fromDate = format(date.from, "yyyy-MM-dd");
    const toDate = format(date.to, "yyyy-MM-dd");

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

  const { newData, totalCount } = data || {};

  const calculateBreakDuration = (breaks) => {
    let totalMinutes = 0; // Accumulate all break duration in minutes

    breaks.forEach((b) => {
      // Ensure both break-in and break-out times exist
      if (b.breakIn && b.breakOut) {
        // Parse hours and minutes from the "HH:MM" strings
        const [inHour, inMinute] = b.breakIn.split(":").map(Number);
        const [outHour, outMinute] = b.breakOut.split(":").map(Number);

        // Convert times to total minutes from midnight for easy subtraction
        const totalInMinutes = inHour * 60 + inMinute;
        const totalOutMinutes = outHour * 60 + outMinute;

        // Calculate the duration of this specific break in minutes
        const diff = totalOutMinutes - totalInMinutes;

        // Add this break's duration to the total
        totalMinutes += diff;
      }
    });

    // --- New formatting logic starts here ---

    // 1. Calculate final hours and remaining minutes from the totalMinutes
    const finalHours = Math.floor(totalMinutes / 60);
    const finalMinutes = totalMinutes % 60;

    // 2. Format both components to ensure they are two digits (e.g., 9 -> "09")
    //    We use String.padStart(2, '0') for this.
    const formattedHours = String(finalHours).padStart(2, "0");
    const formattedMinutes = String(finalMinutes).padStart(2, "0");

    // 3. Return the result in "hh:mm" format
    return `${formattedHours}:${formattedMinutes}`;
  };

  // we have to send only the data that is required for the table
  const filteredData = React.useMemo(() => {
    if (!newData || newData.length === 0) return [];
    // for office employee we have to show only name, clock in, clock out, break in, break out, total hours, total break;
    return newData.map((item) => ({
      EmployeeName: item?.name,
      Date: format(item?.date, "PPP"),
      ClockIn: item?.clockIn || "00:00",
      ClockOut: item?.clockOut || "00:00",
      Breaks:
        item?.breaks
          .map(
            (b, index) =>
              `Break ${index + 1}: ${b.breakIn || "00:00"} - ${
                b.breakOut || "00:00"
              }`
          )
          .join(" | ") || "No Breaks",
      WorkHours: calculateDuration(item?.clockIn, item?.clockOut),
      BreakHours: calculateBreakDuration(item?.breaks),
    }));
  }, [newData]);

  const exportedCSV = () => {
    if (!newData || totalCount === 0) return [];
    let csvContent = "data:text/csv;charset=utf-8,";
    // Add headers
    csvContent += Object.keys(filteredData[0]).join(",") + "\r\n";
    filteredData.forEach((row) => {
      const rowValues = Object.values(row).map((value) =>
        typeof value === "string" ? `"${value}"` : value
      );
      csvContent += rowValues.join(",") + "\r\n";
    });
    var encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `${format(date.from, "PPP")}-${format(date.to, "PPP")}.csv`
    );
    document.body.appendChild(link); // Required for FF
    link.click(); // This will download the data file named "attendance_data.csv".
    document.body.removeChild(link); // Cleanup
  };
  return (
    <div className="p-4">
      <Card>
        <CardHeader>
          <div className="mb-4 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Filter Attendance</CardTitle>
                <CardDescription>
                  Filter attendance by date and payment type
                </CardDescription>
              </div>
              <Button onClick={exportedCSV} className="w-fit">
                Export CSV
              </Button>
            </div>
          </div>
          <div className={`flex items-center justify-between gap-4`}>
            <SearchDebounce />
            <div className="gap-3 flex">
              <div>
                <SelectFilter
                  value={filter?.paymentType}
                  frameworks={[
                    { label: "All", value: "All" },
                    { label: "Monthly", value: "Monthly" },
                    { label: "Weekly", value: "Weekly" },
                  ]}
                  placeholder={
                    filter?.paymentType === ""
                      ? "Payment Type"
                      : "Select Payment Type"
                  }
                  onChange={(e) => setFilter({ ...filter, paymentType: e })}
                  noData="No Data found"
                />
              </div>
              <div>
                {siteData && (
                  <SelectFilter
                    value={filter.siteId}
                    frameworks={[{ label: "All", value: "" }, ...siteData]}
                    placeholder={
                      filter.siteId === "" ? "All Sites" : "Select Site"
                    }
                    onChange={(e) => setFilter({ ...filter, siteId: e })}
                    noData="No Data found"
                  />
                )}
              </div>
              <DatePickerWithRange date={date} setDate={setDate} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
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
            {newData?.length <= 0 ? (
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

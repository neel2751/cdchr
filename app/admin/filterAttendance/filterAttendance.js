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
import { fetchFilteredAttendanceData } from "@/server/siteAssignmentServer/siteAssignmentServer";
import { calculateDuration, calculateTotalPay } from "@/lib/utils";
import { formatCurrency } from "@/utils/time";
import { Button } from "@/components/ui/button";
import { getSelectProjects } from "@/server/selectServer/selectServer";

const FilterAttendance = ({ searchParams }) => {
  const query = searchParams?.query || "";
  const currentPage = parseInt(searchParams?.page || "1");
  const pagePerData = parseInt(searchParams?.pageSize || "10");
  const [filter, setFilter] = React.useState({
    paymentType: searchParams?.paymentType || "All",
    siteId: searchParams?.siteId || "",
    // for office Employee or site Employee
    employeeType: searchParams?.employeeType || "siteEmployee",
  });

  const [date, setDate] = React.useState({
    from: searchParams.fromDate || new Date(),
    to: searchParams.toDate || addDays(new Date(), 20),
  });

  const { data: siteData } = useFetchSelectQuery({
    fetchFn: getSelectProjects,
    queryKey: ["siteData"],
  });

  // we have to set the date in query paarams
  React.useEffect(() => {
    const fromDate = format(date.from, "yyyy-MM-dd");
    const toDate = format(date.to, "yyyy-MM-dd");
    // query we have to set conditionally
    const params = new URLSearchParams({
      ...filter,
      query,
      page: currentPage,
      pageSize: pagePerData,
      fromDate,
      toDate,
      employeeType: filter.employeeType,
    });
    window.history.replaceState({}, "", `?${params.toString()}`);
  }, [filter, date, query, currentPage, pagePerData]);

  const queryKey = [
    "attendanceData",
    { filter, date, query, currentPage, pagePerData },
  ];
  const { data, isLoading, isError } = useFetchQuery({
    params: {
      ...filter,
      query: query || "",
      page: currentPage,
      pageSize: pagePerData,
      employeeType: filter.employeeType,
      fromDate: format(date.from, "yyyy-MM-dd"),
      toDate: format(date.to, "yyyy-MM-dd"),
    },
    queryKey,
    fetchFn: fetchFilteredAttendanceData,
  });

  const { newData, totalCount } = data || {};

  // we have to send only the data that is required for the table
  const filteredData = React.useMemo(() => {
    if (!newData || newData.length === 0) return [];
    // for office employee we have to show only name, clock in, clock out, break in, break out, total hours, total break;
    if (filter.employeeType === "officeEmployee") {
      return newData.map((item) => ({
        EmployeeName: item?.name,
        date: item?.date ? format(item?.date, "PPP") : "Not Clocked In",
        clockIn: item?.clockIn || "00:00",
        clockOut: item?.clockOut || "00:00",
        BreakIn: item?.breakIn || "00:00",
        BreakOut: item?.breakOut || "00:00",
        TotalHours: calculateDuration(item?.clockIn, item?.clockOut),
        TotalBreak: calculateDuration(item?.breakIn, item?.breakOut),
        FinalHours: calculateDuration(
          calculateDuration(item?.breakIn, item?.breakOut),
          calculateDuration(item?.clockIn, item?.clockOut)
        ),
      }));
    }
    if (filter.employeeType === "siteEmployee") {
      return newData.map((item) => ({
        EmployeeName: item?.firstName + " " + item?.lastName,
        PayRate: formatCurrency(item?.payRate),
        SiteName: item?.siteName,
        PaymentType: item?.paymentType,
        AssignDate: format(item?.assignDate, "PPP"),
        ClockIn: item?.clockIn || "00:00",
        ClockOut: item?.clockOut || "00:00",
        BreakIn: item?.breakIn || "00:00",
        BreakOut: item?.breakOut || "00:00",
        TotalHours: calculateDuration(item?.clockIn, item?.clockOut),
        TotalBreak: calculateDuration(item?.breakIn, item?.breakOut),
        TotalPay:
          item.clockOut &&
          formatCurrency(
            calculateTotalPay(
              calculateDuration(
                calculateDuration(item?.breakIn, item?.breakOut),
                calculateDuration(item?.clockIn, item?.clockOut)
              ),
              item?.payRate
            )
          ),
      }));
    }
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
      `${format(date.from, "PPP")}-${format(date.to, "PPP")}-${
        filter.employeeType === "siteEmployee"
          ? "Site-Employee"
          : "Office-Employee"
      }.csv`
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
              {filter?.employeeType === "siteEmployee" && (
                <>
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
                </>
              )}
              <SelectFilter
                value={filter?.employeeType}
                frameworks={[
                  { label: "Site Employee", value: "siteEmployee" },
                  { label: "Office Employee", value: "officeEmployee" },
                ]}
                placeholder={filter?.employeeType || "Select Payment Type"}
                onChange={(e) => setFilter({ ...filter, employeeType: e })}
                noData="No Data found"
              />
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

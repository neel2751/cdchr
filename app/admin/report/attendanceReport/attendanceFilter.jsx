"use client";
import { DateRangeFilter } from "@/components/filters/filterDate/filterDateRange";
import { SelectFilter } from "@/components/filters/selectFilter/selectFilter";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getSelectEmployee } from "@/server/selectServer/selectServer";
import React from "react";

export default function AttendanceFilter({ children }) {
  return (
    <div className="flex flex-wrap gap-4">
      <FilterDate />
      <FilterEmployee />
      <FilterLeaveYear />
      {children}
    </div>
  );
}

function FilterDate() {
  return <DateRangeFilter />;
}

function FilterEmployee() {
  const { data } = useFetchSelectQuery({
    fetchFn: getSelectEmployee,
    queryKey: ["employeeSelect"],
  });
  if (!data) return null;
  const options = [{ label: "All", value: "all" }, ...data];
  return (
    <SelectFilter name={"employeeId"} label={"Employee"} options={options} />
  );
}

function FilterLeaveYear() {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);
  const options = [{ label: "All", value: "all" }].concat(
    years.map((year) => ({
      label: year.toString(),
      value: year.toString(),
    }))
  );
  return (
    <SelectFilter name={"leaveYear"} label={"Leave Year"} options={options} />
  );
}

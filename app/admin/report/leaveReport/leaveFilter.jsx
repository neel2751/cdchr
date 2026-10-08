"use client";
import { DateRangeFilter } from "@/components/filters/filterDate/filterDateRange";
import { SelectFilter } from "@/components/filters/selectFilter/selectFilter";
import {
  getNextLeaveYearString,
  getPreviousLeaveYearString,
} from "@/helper/getLeaveYearString";
import { useLeaveYear } from "@/hooks/useLeaveYear";
import { useFetchSelectQuery } from "@/hooks/use-query";
import {
  getSelectEmployee,
  getSelectLeaveCategories,
} from "@/server/selectServer/selectServer";
import React from "react";

export default function LeaveFilter({ children }) {
  return (
    <div className="flex flex-wrap gap-4">
      <FilterDate />
      <FilterLeaveType />
      <FilterLeaveYear />
      <FilterEmployee />
      {children}
    </div>
  );
}

function FilterDate() {
  return <DateRangeFilter />;
}

function FilterLeaveType() {
  const { data } = useFetchSelectQuery({
    fetchFn: getSelectLeaveCategories,
    queryKey: ["leaveCategories"],
  });
  if (!data) return null;

  // we have to add all option
  const options = [{ label: "All", value: "all" }, ...data];

  return (
    <SelectFilter name={"leaveType"} label={"Leave Type"} options={options} />
  );
}

function FilterLeaveYear() {
  // The company's leave year, not April's — see hooks/useLeaveYear.js.
  const { currentLeaveYear } = useLeaveYear();
  const previousLeaveYear = getPreviousLeaveYearString(currentLeaveYear);
  const nextLeaveYear = getNextLeaveYearString(currentLeaveYear);

  const options = [
    { label: "All", value: "all" },
    { label: previousLeaveYear, value: previousLeaveYear },
    { label: currentLeaveYear, value: currentLeaveYear },
    { label: nextLeaveYear, value: nextLeaveYear },
  ];

  return (
    <SelectFilter name={"leaveYear"} label={"Leave Year"} options={options} />
  );
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

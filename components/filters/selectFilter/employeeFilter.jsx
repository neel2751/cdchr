"use client";

import React from "react";
import { useQueryState, parseAsString } from "nuqs";
import { SelectFilter as SearchableSelectFilter } from "@/components/selectFilter/selectFilter";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getSelectOfficeEmployee } from "@/server/selectServer/selectServer";

/**
 * Employee-wise filter backed by the URL, so it survives paging and refreshes
 * like the other leave filters. Searchable rather than a plain select — the
 * list is as long as the staff roster.
 */
export function EmployeeFilter({ name = "employeeId", label = "Employee" }) {
  const [isLoading, startTransition] = React.useTransition();

  const [value, setValue] = useQueryState(
    name,
    parseAsString.withDefault("").withOptions({
      startTransition,
      clearOnDefault: true,
      shallow: false,
      throttleMs: 500,
    })
  );

  const { data: employees = [] } = useFetchSelectQuery({
    queryKey: ["select-office-employee"],
    fetchFn: getSelectOfficeEmployee,
  });

  return (
    <SearchableSelectFilter
      value={value}
      onChange={(next) => setValue(next || null)}
      frameworks={employees}
      label={label}
      placeholder="All employees"
      noData="No employee found."
    />
  );
}

export default EmployeeFilter;

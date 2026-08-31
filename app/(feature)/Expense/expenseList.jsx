"use client";
import { DateRangeFilter } from "@/components/filters/filterDate/filterDateRange";
import SearchDebounce from "@/components/filters/search/search-debounce";
import { SelectFilter } from "@/components/filters/selectFilter/selectFilter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFetchQuery } from "@/hooks/use-query";
import { useSelectSiteProject } from "@/hooks/useSelect/useSelect";
import { OFFICE_PROJECT } from "@/lib/expenseFilters";
import { getSelectExpenseCategory } from "@/server/expenseServer/expenseServer";
import AddAdminExpense from "./addExpenseButton";
import ExpenseTable from "./expenseTable";
import React from "react";

export default function ExpenseList({ filter }) {
  // Held here rather than in the table because AddAdminExpense owns the form
  // fields and the category options the edit dialog needs.
  const [editing, setEditing] = React.useState(null);

  const sites = useSelectSiteProject();

  // Read from the URL the filters write to, so the category list can follow the
  // selected site. `filter` is the server's copy of the same search params.
  const projectFilter = filter?.projectId || "";

  /**
   * Categories offered by the filter, following whatever site is selected.
   *
   * The parameter is passed through exactly as the site filter set it, which is
   * what makes the three cases line up: a site id offers that site's
   * categories, OFFICE offers the company-wide ones, and no site at all offers
   * every category — because with no site filter the table is showing every
   * expense, so any category could match.
   *
   * That last case is the one that was wrong: it used to send no project, which
   * the server read as "office", so the filter listed a single category however
   * many the company had.
   */
  const { data: categoryData } = useFetchQuery({
    fetchFn: getSelectExpenseCategory,
    queryKey: ["expense-category-options", projectFilter || "all"],
    params: projectFilter ? { projectId: projectFilter } : {},
  });

  const siteOptions = React.useMemo(
    () => [
      // Not a site but a filter over their absence — see OFFICE_PROJECT.
      { value: OFFICE_PROJECT, label: "Office (no site)" },
      ...(sites || []).map((s) => ({ value: String(s.value), label: s.label })),
    ],
    [sites]
  );

  const categoryOptions = React.useMemo(
    () =>
      (categoryData?.newData || []).map((c) => ({
        value: String(c.value),
        label: c.label,
      })),
    [categoryData]
  );

  return (
    // The table below already scrolls itself (overflow-x-auto); a scroll
    // container here as well made the whole page scroll sideways.
    <div className="min-w-0">
      <Card className="w-full">
        <CardHeader className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle>All Expenses</CardTitle>
            <CardDescription>
              Every expense for this company — on a site or at the office.
            </CardDescription>
          </div>
          <AddAdminExpense
            editing={editing}
            onCloseEdit={() => setEditing(null)}
          />
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="min-w-56 flex-1">
              <SearchDebounce />
            </div>
            <div className="w-52">
              <SelectFilter
                name="projectId"
                label="Site / Office"
                allLabel="All sites"
                options={siteOptions}
              />
            </div>
            <div className="w-52">
              <SelectFilter
                name="categoryId"
                label="Category"
                allLabel="All categories"
                options={categoryOptions}
              />
            </div>
            <DateRangeFilter />
          </div>
          <div className="overflow-x-auto">
            <ExpenseTable filter={filter} onEdit={setEditing} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import ExpenseTable from "@/app/(feature)/Expense/category/expenseTable";
import { DateRangeFilter } from "@/components/filters/filterDate/filterDateRange";
import SearchDebounce from "@/components/filters/search/search-debounce";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useCommonContext } from "@/context/commonContext";

import React from "react";
import AddSiteExpense from "./siteExpense/addSiteExpense";

export default function SiteExpense() {
  const { searchParams, filter } = useCommonContext();
  const siteId = (searchParams && searchParams[0]) || "";
  const filterParams = {
    projectId: siteId,
    page: parseInt(filter?.page || "1"),
    limit: parseInt(filter?.pageSize || "10"),
    ...filter,
  };
  return (
    <div className="p-4 overflow-scroll">
      <Card className="w-full max-w-7xl mx-auto overflow-hidden">
        <CardHeader className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle>Site Expenses</CardTitle>
            <CardDescription>
              Manage and track expenses related to site projects.
            </CardDescription>
          </div>
          <AddSiteExpense />
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <SearchDebounce />
            <DateRangeFilter />
          </div>
          <div className="overflow-x-auto">
            <ExpenseTable filter={filterParams} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

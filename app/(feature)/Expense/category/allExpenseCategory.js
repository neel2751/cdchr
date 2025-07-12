import { DateRangeFilter } from "@/components/filters/filterDate/filterDateRange";
import SearchDebounce from "@/components/filters/search/search-debounce";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import AddAdminExpense from "../addExpense";
import ExpenseTable from "./expenseTable";
import React from "react";

export default function ExpenseCategory({ filter }) {
  return (
    <div className="overflow-scroll">
      <Card className="w-full">
        <CardHeader className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle>Site Expenses</CardTitle>
            <CardDescription>
              Manage and track expenses related to site projects.
            </CardDescription>
          </div>
          <AddAdminExpense />
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <SearchDebounce />
            <DateRangeFilter />
          </div>
          <div className="overflow-x-auto">
            <ExpenseTable filter={filter} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import React from "react";
import AllExpense from "./AllExpense";
import ExpenseCategory from "./category/allExpenseCategory";

export default function Expense({ searchParams }) {
  return (
    <div className="p-4 overflow-hidden w-full">
      <AllExpense filter={searchParams} />
      <ExpenseCategory filter={searchParams} />
    </div>
  );
}

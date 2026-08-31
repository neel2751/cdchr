import React from "react";
import CategoryList from "./categoryList";
import ExpenseList from "./expenseList";

/**
 * The /admin/expense page: the company's expense categories, then its expenses.
 *
 * The two used to be named the other way round — `AllExpense.jsx` rendered the
 * *categories* and `category/allExpenseCategory.js` rendered the *expenses* —
 * which is how a stray dialog and a dropped filter prop both went unnoticed.
 */
export default function Expense({ searchParams }) {
  return (
    // `overflow-hidden` clipped the two cards rather than letting either
    // scroll, and there was no gap between them. min-w-0 keeps the wide expense
    // table from stretching the page instead of scrolling itself.
    <div className="w-full min-w-0 space-y-4 p-4">
      {/* No filter: the search and date controls on this page sit inside the
          expenses card below and belong to it, so feeding them to a second
          table would filter it from a box that does not look related. The
          category card pages itself instead. */}
      <CategoryList />
      <ExpenseList filter={searchParams} />
    </div>
  );
}

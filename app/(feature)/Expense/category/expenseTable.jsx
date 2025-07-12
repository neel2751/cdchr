"use client";
import { PaginationWithLinks } from "@/components/filters/pagination/pagination-client";
import { Status } from "@/components/tableStatus/status";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { useFetchQuery } from "@/hooks/use-query";
import { getAllExpenses } from "@/server/expenseServer/expenseServer";
import { formatCurrency } from "@/utils/time";
import { format } from "date-fns";
import React from "react";
import Invoice from "../invoice";

export default function ExpenseTable({ filter, setIntialValues }) {
  const [invoice, setInvoice] = React.useState(null);

  const filterMap = {
    ...filter,
  };
  const queryKey = ["expenses", filterMap];
  const { data } = useFetchQuery({
    fetchFn: getAllExpenses,
    queryKey,
    params: filterMap,
  });
  const { newData, totalCount } = data || {};

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Site</TableHead>
            <TableHead>Expense Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Receipt Files</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {newData &&
            newData?.expenses?.map((expense) => (
              <TableRow key={expense?._id}>
                <TableCell>{expense?.title}</TableCell>
                <TableCell>{formatCurrency(expense?.amount)}</TableCell>

                <TableCell>{expense?.categoryLabel}</TableCell>
                <TableCell>{expense?.company?.name || "-"}</TableCell>
                <TableCell>{expense?.project?.siteName || "Office"}</TableCell>
                <TableCell>
                  {format(expense?.date || new Date(), "PPP")}
                </TableCell>
                <TableCell>
                  <div onClick={() => setInvoice(expense)}>
                    <span className="text-blue-500 cursor-pointer hover:underline">
                      View Invoice
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Status title={expense?.status} />
                </TableCell>
                <TableCell>{expense?.receiptFiles.length || 0} </TableCell>
                <TableCell>
                  <button className="btn btn-primary">View</button>
                  <button
                    onClick={() => setIntialValues(expense)}
                    className="btn btn-primary"
                  >
                    Edit
                  </button>
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
      <Invoice
        open={!!invoice}
        setOpen={() => setInvoice(null)}
        invoiceData={invoice}
      />
      {totalCount > 10 && <PaginationWithLinks totalCount={totalCount} />}
    </>
  );
}

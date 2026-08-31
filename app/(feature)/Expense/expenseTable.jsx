"use client";
import { PaginationWithLinks } from "@/components/filters/pagination/pagination-client";
import { Status } from "@/components/tableStatus/status";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { useFetchQuery } from "@/hooks/use-query";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { useBranding } from "@/app/admin/providers";
import {
  deleteExpenseAction,
  getAllExpenses,
  getExpenseReceiptUrl,
  setExpenseStatusAction,
} from "@/server/expenseServer/expenseServer";
import { formatCurrency } from "@/utils/time";
import { format } from "date-fns";
import {
  Check,
  FileText,
  Pencil,
  Receipt,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import React from "react";
import Invoice from "./invoice";

// One entry per column, so the header row and the body row cannot drift. They
// had: nine headers over ten cells, which put the status badge under "Receipt
// Files" and the receipt count under "Action".
// No Company column: every expense belongs to the company the viewer is signed
// in to, so it repeated the same name on every row.
const COLUMNS = [
  "Title",
  "Amount",
  "Category",
  "Site",
  "Expense Date",
  "Status",
  "Receipts",
  "Actions",
];

export default function ExpenseTable({ filter, onEdit }) {
  const [invoice, setInvoice] = React.useState(null);
  // The company's own currency, not a hard-coded GBP.
  const currency = useBranding()?.locale?.currency;

  const filterMap = {
    ...filter,
  };
  const queryKey = ["expenses", filterMap];
  const { data, isLoading, isError, error } = useFetchQuery({
    fetchFn: getAllExpenses,
    queryKey,
    params: filterMap,
  });
  const { newData, totalCount } = data || {};
  const expenses = newData?.expenses || [];

  const { mutate: setStatus, isPending: statusPending } = useSubmitMutation({
    mutationFn: async ({ id, status }) => await setExpenseStatusAction(id, status),
    invalidateKey: ["expenses"],
    onSuccessMessage: (message) => message || "Expense updated",
    onClose: () => {},
  });

  const { mutate: removeExpense, isPending: deletePending } = useSubmitMutation({
    mutationFn: async (id) => await deleteExpenseAction(id),
    invalidateKey: ["expenses"],
    onSuccessMessage: (message) => message || "Expense deleted",
    onClose: () => {},
  });

  const busy = statusPending || deletePending;

  /**
   * Open a receipt in a new tab.
   *
   * The link is signed and short-lived, so it is fetched on click rather than
   * rendered into the table — a row of pre-signed URLs would start expiring the
   * moment the page loaded.
   */
  const openReceipt = async (expenseId, key) => {
    const res = await getExpenseReceiptUrl(expenseId, key);
    if (!res?.success || !res?.url) {
      toast.error(res?.message || "Could not open that receipt");
      return;
    }
    window.open(res.url, "_blank", "noopener,noreferrer");
  };

  const body = () => {
    if (isLoading) {
      return (
        <TableRow>
          <TableCell colSpan={COLUMNS.length} className="h-24 text-center text-muted-foreground">
            Loading expenses…
          </TableCell>
        </TableRow>
      );
    }

    // Previously indistinguishable from "no expenses": the query threw, data
    // stayed undefined, and the table rendered zero rows in silence.
    if (isError) {
      return (
        <TableRow>
          <TableCell colSpan={COLUMNS.length} className="h-24 text-center text-destructive">
            {error?.message || "Could not load expenses"}
          </TableCell>
        </TableRow>
      );
    }

    if (expenses.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={COLUMNS.length} className="h-24 text-center text-muted-foreground">
            No expenses yet.
          </TableCell>
        </TableRow>
      );
    }

    return expenses.map((expense) => {
      const receipts = expense?.receiptFiles || [];
      return (
        <TableRow key={expense?._id}>
          <TableCell>{expense?.title}</TableCell>
          <TableCell>{formatCurrency(expense?.amount, currency)}</TableCell>
          <TableCell>{expense?.categoryLabel}</TableCell>
          <TableCell>{expense?.project?.siteName || "Office"}</TableCell>
          <TableCell>
            {expense?.date ? format(new Date(expense.date), "PPP") : "-"}
          </TableCell>
          <TableCell>
            <Status title={expense?.status} />
          </TableCell>
          <TableCell>
            {receipts.length === 0 ? (
              <span className="text-muted-foreground text-xs">None</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {receipts.map((file, index) => (
                  <Button
                    key={file.key || index}
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2"
                    onClick={() => openReceipt(expense._id, file.key)}
                  >
                    <Receipt className="size-3" />
                    {index + 1}
                  </Button>
                ))}
              </div>
            )}
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                title="View invoice"
                onClick={() => setInvoice(expense)}
              >
                <FileText className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Edit"
                onClick={() => onEdit?.(expense)}
              >
                <Pencil className="size-4" />
              </Button>
              {expense?.status === "pending" && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Approve"
                    disabled={busy}
                    onClick={() => setStatus({ id: expense._id, status: "approved" })}
                  >
                    <Check className="size-4 text-green-600" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Reject"
                    disabled={busy}
                    onClick={() => setStatus({ id: expense._id, status: "rejected" })}
                  >
                    <X className="size-4 text-destructive" />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                title="Delete"
                disabled={busy}
                onClick={() => removeExpense(expense._id)}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          </TableCell>
        </TableRow>
      );
    });
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((column) => (
              <TableHead key={column}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{body()}</TableBody>
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

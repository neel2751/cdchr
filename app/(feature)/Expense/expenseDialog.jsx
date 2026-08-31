import React from "react";
import { GlobalForm } from "@/components/form/form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useSubmitMutation } from "@/hooks/use-mutate";
import {
  addExpenseAction,
  updateExpenseAction,
} from "@/server/expenseServer/expenseServer";

/**
 * The fields updateExpenseAction will accept.
 *
 * The company cannot move once an expense is filed, and a receipt cannot be
 * swapped — replacing one orphans the old object in the bucket, which needs the
 * S3 delete to be part of the same unit of work. Both are filtered out of the
 * edit form rather than shown and silently ignored.
 */
const EDITABLE = ["title", "amount", "date", "projectId", "category", "description"];

/** Map an expense row onto the form's field names. */
function toFormValues(expense) {
  if (!expense) return null;
  return {
    title: expense.title || "",
    amount: expense.amount ?? "",
    date: expense.date ? new Date(expense.date) : undefined,
    projectId: expense.projectId ? String(expense.projectId) : "",
    category: expense.categoryId ? String(expense.categoryId) : "",
    description: expense.description || "",
  };
}

/**
 * Add or edit one expense.
 *
 * Both live here because the form is the same one twice; splitting them would
 * duplicate six field definitions to change a title and a mutation.
 *
 * @param {Object} [expense] the row being edited; absent means "add"
 */
export default function ExpenseDialog({
  fields,
  siteId,
  open,
  onClose,
  expense,
}) {
  const isEdit = Boolean(expense?._id);

  const { mutate: onSubmit, isPending } = useSubmitMutation({
    mutationFn: async (data) =>
      isEdit
        ? await updateExpenseAction(expense._id, data)
        : await addExpenseAction({
            ...data,
            projectId: siteId || data.projectId,
          }),
    invalidateKey: ["expenses"],
    onSuccessMessage: (message) =>
      message || (isEdit ? "Expense updated" : "Expense added successfully"),
    onClose,
  });

  const formFields = React.useMemo(() => {
    if (!isEdit) return fields;
    return fields
      .filter((f) => EDITABLE.includes(f.name))
      .map((f) => {
        if (!f.dependField) return f;
        // The category field depends on the company picker so its options
        // reload when the company changes. Editing has no company picker, and
        // GlobalForm's dependency effect fires once on mount and blanks the
        // field it watches — which wiped the expense's existing category and
        // made every edit fail with "Category is required". Nothing to depend
        // on here, so the dependency comes off.
        const { dependField, function: onDepend, ...rest } = f;
        return rest;
      });
  }, [fields, isEdit]);

  const initialValues = React.useMemo(() => toFormValues(expense), [expense]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Expense" : "Add New Expense"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the details below. Changing the amount or category sends the expense back for approval."
              : "Fill in the details below to add a new expense."}
          </DialogDescription>
        </DialogHeader>
        <GlobalForm
          key={expense?._id || "new"}
          fields={formFields}
          onSubmit={onSubmit}
          initialValues={initialValues}
          isLoading={isPending}
          btnName={isEdit ? "Save changes" : "Add Expense"}
        />
      </DialogContent>
    </Dialog>
  );
}

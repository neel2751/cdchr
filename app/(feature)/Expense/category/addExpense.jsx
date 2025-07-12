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
import { addExpenseAction } from "@/server/expenseServer/expenseServer";

export default function AddExpense({
  fields,
  siteId,
  open,
  onClose,
  initialValues,
}) {
  const { mutate: onSubmit } = useSubmitMutation({
    mutationFn: async (data) =>
      await addExpenseAction({ ...data, projectId: siteId || data.projectId }),
    invalidateKey: ["expenses"],
    onSuccessMessage: () => "Expense added successfully",
    onClose: onClose,
  });

  return (
    <Dialog open={initialValues ? true : open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Expense</DialogTitle>
          <DialogDescription>
            Fill in the details below to add a new expense.
          </DialogDescription>
        </DialogHeader>
        <GlobalForm
          fields={fields}
          onSubmit={onSubmit}
          initialValues={initialValues}
        />
      </DialogContent>
    </Dialog>
  );
}

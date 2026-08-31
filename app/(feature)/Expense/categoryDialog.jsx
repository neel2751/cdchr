import { GlobalForm } from "@/components/form/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import React from "react";

const ExpenseForm = ({
  showDialog,
  setShowDialog,
  fields,
  handleSubmit,
  initialValues,
  isEdit,
}) => {
  return (
    <Dialog open={showDialog} onOpenChange={setShowDialog}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Expense" : "Add New Expense"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? " Update the details below to edit the expense."
              : "Please fill in the form below to submit a new expense."}
          </DialogDescription>
        </DialogHeader>
        <GlobalForm
          fields={fields}
          onSubmit={handleSubmit}
          initialValues={initialValues}
          btnName={isEdit ? "Update Expense" : "Add Expense"}
        />
      </DialogContent>
    </Dialog>
  );
};

export default ExpenseForm;

"use client";
import React from "react";
import ExpenseDialog from "./expenseDialog";
import { useFetchQuery } from "@/hooks/use-query";
import { useSelectSiteProject } from "@/hooks/useSelect/useSelect";
import { OFFICE_PROJECT } from "@/lib/expenseFilters";
import { getSelectExpenseCategory } from "@/server/expenseServer/expenseServer";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

/**
 * The "Add Expense" button, and the dialog behind it.
 *
 * Also hosts the *edit* dialog, because the six field definitions below are the
 * same either way and the category options are loaded here. The table asks for
 * an edit by handing the row up through `editing`.
 *
 * @param {Object} [editing] the expense being edited, from the table
 * @param {Function} [onCloseEdit] clears that selection
 */
export default function AddAdminExpense({ editing, onCloseEdit }) {
  // Only the project narrows the category list now. The company used to as
  // well, but it was always the caller's own — the server takes it from the
  // session, so there is nothing here to track.
  const [projectId, setProjectId] = React.useState(null);
  const [open, setOpen] = React.useState(false);
  const onClose = () => {
    setOpen(false);
    setProjectId(null);
  };

  // When editing, the site comes from the row rather than the picker, so the
  // category options match what the expense was filed against. Derived, not
  // copied into state: mirroring it would be a second source of truth kept in
  // sync by an effect.
  //
  // No site means OFFICE, stated explicitly rather than left as "no filter":
  // an expense filed against no site *is* an office expense, so it should be
  // offered the office categories — not every category in the company.
  const chosenSite = editing
    ? editing.projectId
      ? String(editing.projectId)
      : null
    : projectId;
  const scopedProject = chosenSite || OFFICE_PROJECT;

  const sites = useSelectSiteProject();

  const { data } = useFetchQuery({
    fetchFn: getSelectExpenseCategory,
    // Loads immediately — previously it waited for a company to be chosen, so
    // the category dropdown sat empty until the user picked the only option in
    // a list of one.
    // Shares the "expense-categories" root with the list and the filter, so one
    // invalidation after a create or delete refreshes all three.
    queryKey: ["expense-categories", "form-options", scopedProject],
    params: { projectId: scopedProject },
  });

  const checkCategory = React.useCallback((value) => {
    setProjectId(value || null);
  }, []);

  const fields = [
    {
      name: "title",
      labelText: "Title",
      type: "text",
      placeholder: "Enter title",
      validationOptions: {
        required: "Title is required",
        minLength: {
          value: 3,
          message: "Title must be at least 3 characters long",
        },
      },
    },
    {
      name: "amount",
      labelText: "Amount",
      type: "number",
      placeholder: "Enter amount",
      validationOptions: {
        required: "Amount is required",
        pattern: {
          value: /^\d+(\.\d{1,2})?$/,
          message: "Amount must be a valid number",
        },
        min: {
          value: 0,
          message: "Amount must be a positive number",
        },
      },
    },
    {
      name: "date",
      labelText: "Date",
      type: "date",
      placeholder: "Select date",
      validationOptions: {
        required: "Date is required",
      },
    },
    // No Company field: getSelectCompanies only ever returns the signed-in
    // user's own company, so this was a required picker with a single option
    // that the server already knows. addExpenseAction takes it from the session.
    {
      name: "projectId",
      labelText: "Site/Project",
      type: "select",
      placeholder: "Select Site/Project",
      options: sites || [],
      //   validationOptions: {
      //     required: "Site/Project is required",
      //   },
    },
    {
      name: "category",
      labelText: "Category",
      type: "select",
      placeholder: "Select Category",
      dependField: "projectId",
      function: checkCategory,
      options: data?.newData || [],
      validationOptions: {
        required: "Category is required",
      },
    },
    {
      name: "description",
      labelText: "Description",
      type: "textarea",
      placeholder: "Enter description",
      validationOptions: {
        required: false,
        maxLength: {
          value: 500,
          message: "Description cannot exceed 500 characters",
        },
      },
    },
    {
      name: "receipt",
      labelText: "Receipt (optional)",
      type: "image",
      placeholder: "Upload receipt",
      size: true,
      acceptedFileTypes: ["image/jpeg", "image/png", "application/pdf"],
      maxFiles: 2,
      maxFileSize: 5 * 1024 * 1024, // 5 MB
      // Genuinely optional, as the label has always claimed. It carried
      // `required: "Please upload a receipt"`, so the form refused every expense
      // filed without one while telling the user it was optional — and
      // addExpenseAction treats the receipt as optional too, so the rule
      // contradicted both the label beside it and the server behind it.
    },
  ];

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline">
        <Plus />
        Add Expense
      </Button>
      <ExpenseDialog
        fields={fields}
        open={open || Boolean(editing)}
        onClose={editing ? onCloseEdit : onClose}
        expense={editing}
      />
    </>
  );
}

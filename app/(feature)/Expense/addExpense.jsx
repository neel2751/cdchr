"use client";
import React from "react";
import AddExpense from "./category/addExpense";
import { useFetchQuery } from "@/hooks/use-query";
import {
  useSelectCompany,
  useSelectSiteProject,
} from "@/hooks/useSelect/useSelect";
import { getSelectExpenseCategory } from "@/server/selectServer/selectServer";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function AddAdminExpense() {
  const [compId, setCompId] = React.useState({
    companyId: null,
    projectId: null,
  });
  const [open, setOpen] = React.useState(false);
  const onClose = () => {
    setOpen(false);
    setCompId({ companyId: null, projectId: null });
  };

  const company = useSelectCompany();
  const sites = useSelectSiteProject();

  const { data } = useFetchQuery({
    fetchFn: getSelectExpenseCategory,
    queryKey: [
      "expense-categories",
      compId.companyId,
      compId.projectId ?? "__no_project__", // differentiate null vs value
    ],
    enabled: !!compId.companyId, // ONLY require companyId
    params: {
      companyId: compId.companyId,
      ...(compId.projectId ? { projectId: compId.projectId } : {}), // include if available
    },
  });

  const checkCategory = React.useCallback(({ companyId, projectId }) => {
    if (!companyId) return;
    setCompId({ companyId, projectId: projectId || null });
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
    {
      name: "companyId",
      labelText: "Company",
      type: "select",
      options: company || [],
      placeholder: "Select Company",
      validationOptions: {
        required: "Company is required",
      },
    },
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
      dependField: ["companyId", "projectId"],
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
      validationOptions: {
        required: "Please upload a receipt",
      },
    },
  ];

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline">
        <Plus />
        Add Expense
      </Button>
      <AddExpense fields={fields} open={open} onClose={onClose} />
    </>
  );
}

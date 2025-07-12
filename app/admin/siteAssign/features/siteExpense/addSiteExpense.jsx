import AddExpense from "@/app/(feature)/Expense/category/addExpense";
import { Button } from "@/components/ui/button";
import { useCommonContext } from "@/context/commonContext";
import { useFetchQuery } from "@/hooks/use-query";
import { decrypt } from "@/lib/algo";
import { getSelectExpenseCategoryBySite } from "@/server/selectServer/selectServer";
import { Plus } from "lucide-react";
import React from "react";

export default function AddSiteExpense() {
  const { searchParams } = useCommonContext();
  const [open, setOpen] = React.useState(false);
  const onClose = () => {
    setOpen(false);
  };
  const siteId = (searchParams && searchParams[0]) || "";
  const { siteId: decryptedSiteId } = React.useMemo(() => {
    return {
      siteId: decrypt(siteId),
    };
  }, [siteId]);
  const { data } = useFetchQuery({
    fetchFn: getSelectExpenseCategoryBySite,
    queryKey: ["expense-categories", siteId],
    params: {
      projectId: decryptedSiteId || "__no_project__", // Use decrypted siteId or a placeholder
    },
    enabled: !!decryptedSiteId, // Only fetch if siteId is available
  });
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
      name: "category",
      labelText: "Category",
      type: "select",
      placeholder: "Select Category",
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
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus />
        Add Expense
      </Button>
      <AddExpense
        fields={fields}
        siteId={decryptedSiteId}
        open={open}
        onClose={onClose}
      />
    </>
  );
}

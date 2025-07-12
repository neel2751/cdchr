"use client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useSelectCompany,
  useSelectSiteProject,
} from "@/hooks/useSelect/useSelect";
import { Plus } from "lucide-react";

import React from "react";
import ExpenseForm from "./expenseForm";
import { useSubmitMutation } from "@/hooks/use-mutate";
import {
  addExpenseCategoryAction,
  getAllExpenseCategories,
} from "@/server/expenseServer/expenseServer";
import { useFetchQuery } from "@/hooks/use-query";
import ExpenseCategoryTable from "./expenseCategoryTable";
import AddExpense from "./category/addExpense";

export default function AllExpense() {
  const [showDialog, setShowDialog] = React.useState(false);
  const [isEdit, setIsEdit] = React.useState(false);
  const [initialValues, setInitialValues] = React.useState(null);

  const handleAdd = () => {
    setInitialValues(null);
    setIsEdit(false);
    setShowDialog(true);
  };
  const handleClose = () => {
    setInitialValues(null);
    setIsEdit(false);
    setShowDialog(false);
    setIsEdit(false);
  };
  const handleEdit = (item) => {
    setInitialValues(item);
    setIsEdit(true);
    setShowDialog(true);
  };

  const queryKey = ["expense-categories"];

  const { data } = useFetchQuery({
    fetchFn: getAllExpenseCategories,
    queryKey,
    params: {
      page: 1,
      limit: 10,
      isActive: true,
    },
  });

  const { newData, totalCount } = data || {};
  const expenseCategories = newData?.categories || [];

  return (
    <div>
      <Card>
        <CardHeader className={"flex justify-between items-center"}>
          <div>
            <CardTitle>All Expense Categories</CardTitle>
            <CardDescription>
              Manage all your expense categories in one place. Click the button
              below to add a new category.
            </CardDescription>
          </div>
          <Button onClick={handleAdd}>
            <Plus />
            Add Expense Category
          </Button>
        </CardHeader>
        <CardContent>
          <ExpenseCategoryTable
            expenseCategories={expenseCategories}
            handleEdit={handleEdit}
          />
        </CardContent>
        <AddExpense />
      </Card>
      <ModelExpenseCategory
        showDialog={showDialog}
        setShowDialog={handleClose}
        initialValues={initialValues}
        isEdit={isEdit}
        queryKey={queryKey}
      />
    </div>
  );
}

function ModelExpenseCategory({
  showDialog,
  setShowDialog,
  initialValues,
  isEdit,
  queryKey = ["expense-categories"],
}) {
  const company = useSelectCompany();
  const siteProject = useSelectSiteProject();

  const fields = [
    {
      labelText: "Category Name",
      name: "name",
      type: "text",
      placeholder: "Enter Category Name",
      validationOptions: {
        required: "Category name is required",
        minLength: {
          value: 3,
          message: "Category name must be at least 3 characters long",
        },
      },
    },
    {
      labelText: "Budget",
      name: "budget",
      type: "number",
      placeholder: "Enter Budget",
      validationOptions: {
        required: "Budget is required",
        min: {
          value: 0,
          message: "Budget must be a positive number",
        },
      },
    },
    {
      labelText: "Company",
      name: "companyId",
      type: "select",
      options: company,
      placeholder: "Select Company",
      validationOptions: {
        required: "Company is required",
      },
    },
    {
      labelText: "Site Project",
      name: "projectIds",
      type: "multipleSelect",
      options: siteProject,
      placeholder: "Select Site Project",
      size: true,
    },
    {
      labelText: "Description",
      name: "description",
      type: "textarea",
      placeholder: "E.g. Category for office expenses",
      size: true,
    },
  ];

  const { mutate: onSubmit } = useSubmitMutation({
    mutationFn: async (data) =>
      await addExpenseCategoryAction(data, initialValues?._id || null),
    invalidateKey: queryKey,
    onSuccessMessage: (message) =>
      message || "Expense category added successfully",
    onClose: () => setShowDialog(),
  });

  return (
    <ExpenseForm
      showDialog={showDialog}
      setShowDialog={setShowDialog}
      fields={fields}
      initialValues={initialValues}
      isEdit={isEdit}
      handleSubmit={onSubmit}
    />
  );
}

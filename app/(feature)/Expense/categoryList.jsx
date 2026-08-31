"use client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSelectSiteProject } from "@/hooks/useSelect/useSelect";
import { Plus } from "lucide-react";

import React from "react";
import ExpenseForm from "./categoryDialog";
import { useSubmitMutation } from "@/hooks/use-mutate";
import {
  addExpenseCategoryAction,
  deleteExpenseCategoryAction,
  getAllExpenseCategories,
} from "@/server/expenseServer/expenseServer";
import { useFetchQuery } from "@/hooks/use-query";
import ExpenseCategoryTable from "./categoryTable";

const PAGE_SIZE = 10;

export default function CategoryList() {
  const [showDialog, setShowDialog] = React.useState(false);
  const [isEdit, setIsEdit] = React.useState(false);
  const [initialValues, setInitialValues] = React.useState(null);

  /**
   * Paging held in component state, not the URL.
   *
   * `PaginationWithLinks` writes a fixed `?page=` param, and this card shares a
   * page with the expense ledger, which already owns it — paging one would have
   * paged the other. This is the secondary table of the two, so it keeps its
   * position locally.
   *
   * It previously asked for `page: 1` and nothing else, with `totalCount` read
   * and never used, so an eleventh category could not be reached at all.
   */
  const [page, setPage] = React.useState(1);

  const handleAdd = () => {
    setInitialValues(null);
    setIsEdit(false);
    setShowDialog(true);
  };
  const handleClose = () => {
    setInitialValues(null);
    setIsEdit(false);
    setShowDialog(false);
  };
  const handleEdit = (item) => {
    setInitialValues(item);
    setIsEdit(true);
    setShowDialog(true);
  };

  // Read back from the last known total rather than clamped in an effect. If
  // someone else deletes the rows this page was showing, the count drops, this
  // falls back into range on the next render and the query follows — no
  // cascading setState, and no way to strand the view past the end.
  const [lastTotal, setLastTotal] = React.useState(0);
  const totalPages = Math.max(1, Math.ceil(lastTotal / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  // The page belongs in the key, or React Query serves page 1 from cache.
  const queryKey = ["expense-categories", "list", safePage];

  const { data, isLoading, isError, error } = useFetchQuery({
    fetchFn: getAllExpenseCategories,
    queryKey,
    params: {
      page: safePage,
      limit: PAGE_SIZE,
      isActive: true,
    },
  });

  const { newData, totalCount } = data || {};
  const expenseCategories = newData?.categories || [];

  const { mutate: removeCategory, isPending: isDeleting } = useSubmitMutation({
    mutationFn: async (id) => await deleteExpenseCategoryAction(id),
    // Both keys: the category list, and the option lists the expense form and
    // the filters read — a deleted category must stop being offered there too.
    invalidateKey: ["expense-categories"],
    onSuccessMessage: (message) => message || "Expense category deleted",
    onClose: () => {},
  });

  // Recorded during render, not in an effect: React re-runs the render with the
  // new value rather than committing and scheduling a second pass.
  if (totalCount !== undefined && totalCount !== lastTotal) {
    setLastTotal(totalCount);
  }

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
        <CardContent className="space-y-4">
          {isError ? (
            <p className="py-8 text-center text-sm text-destructive">
              {error?.message || "Could not load expense categories"}
            </p>
          ) : isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading categories…
            </p>
          ) : expenseCategories.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No expense categories yet.
            </p>
          ) : (
            <ExpenseCategoryTable
              expenseCategories={expenseCategories}
              handleEdit={handleEdit}
              onDelete={(category) => removeCategory(category._id)}
              isDeleting={isDeleting}
            />
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-3">
              <span className="text-xs text-muted-foreground">
                Page {safePage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage(Math.max(1, safePage - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= totalPages}
                onClick={() => setPage(Math.min(totalPages, safePage + 1))}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
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
    // No Company field. getSelectCompanies only ever returns the signed-in
    // user's own company, so this was a required picker with one option that
    // the server already knows — addExpenseCategoryAction now takes it from the
    // session.
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
    // The whole family, not just this page's slice: a new category has to reach
    // the form and filter option lists as well.
    invalidateKey: ["expense-categories"],
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

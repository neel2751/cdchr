import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableRow,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { formatCurrency } from "@/utils/time";
import { useBranding } from "@/app/admin/providers";
import ConfirmDelete from "@/components/confirmDelete";
import { Edit, Trash2 } from "lucide-react";
import React from "react";

export default function ExpenseCategoryTable({
  expenseCategories,
  handleEdit,
  onDelete,
  isDeleting = false,
}) {
  const currency = useBranding()?.locale?.currency;
  const [pendingDelete, setPendingDelete] = React.useState(null);

  return (
    <>
    <Table>
      <TableHeader>
        <TableRow>
          {[
            // No Company column — see the note in expenseTable.jsx.
            "Category Name",
            "Budget",
            "Description",
            "Sites",
            "Actions",
          ].map((item, index) => (
            <TableHead className="uppercase text-xs" key={index}>
              {item}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {expenseCategories?.map((category, index) => (
          <TableRow key={index}>
            <TableCell className="cursor-pointer">{category.name}</TableCell>
            <TableCell>{formatCurrency(category.budget, currency)}</TableCell>
            <TableCell>{category.description}</TableCell>
            <TableCell className={"flex flex-col gap-1 flex-wrap"}>
              {category?.projects.length > 0 ? (
                <Badge>
                  {category?.projects
                    .map((project) => project.siteName)
                    .join(", ")}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">
                  No Projects Assigned
                </span>
              )}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <Button
                  onClick={() => handleEdit(category)}
                  variant="outline"
                  size="icon"
                  title="Edit"
                >
                  <Edit />
                </Button>
                <Button
                  onClick={() => setPendingDelete(category)}
                  variant="outline"
                  size="icon"
                  title="Delete"
                  disabled={isDeleting}
                >
                  <Trash2 className="text-destructive" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>

    <ConfirmDelete
      target={pendingDelete}
      isPending={isDeleting}
      onCancel={() => setPendingDelete(null)}
      onConfirm={() => {
        onDelete?.(pendingDelete);
        setPendingDelete(null);
      }}
      title={`Delete "${pendingDelete?.name}"?`}
      description={
        <>
          It will stop being offered when filing new expenses. Expenses already
          filed against it keep their category name, so past reports are
          unaffected.
        </>
      }
      confirmLabel="Delete category"
    />
    </>
  );
}

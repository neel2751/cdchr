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
import { Edit } from "lucide-react";
import React from "react";

export default function ExpenseCategoryTable({
  expenseCategories,
  handleEdit,
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {[
            "Company",
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
            <TableCell>{category?.company?.name || "N/A"}</TableCell>
            <TableCell className="cursor-pointer">{category.name}</TableCell>
            <TableCell>{formatCurrency(category.budget) || "N/A"}</TableCell>
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
              <Button
                onClick={() => handleEdit(category)}
                variant="outline"
                size="icon"
              >
                <Edit />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

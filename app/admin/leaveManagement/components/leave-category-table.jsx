import { TableStatus } from "@/components/tableStatus/status";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCommonContext } from "@/context/commonContext";
import { format } from "date-fns";
import { Edit, Trash2 } from "lucide-react";
import React from "react";
import EmployeeForm from "../../officeEmployee/employeeForm";

const LeaveCategoryTable = () => {
  const { data, handleEdit, isEdit, setIsEdit, handleAlert } =
    useCommonContext();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {[
            "id",
            "category",
            "total",
            // "remaining",
            "note", // TODO: remove this column
            "status",
            "date",
            "updated",
            "Actions",
          ].map((item, index) => (
            <TableHead className="uppercase text-xs" key={index}>
              {item}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data?.map((item, index) => (
          <TableRow key={index}>
            <TableCell>{index + 1}</TableCell>
            <TableCell>{item?.leaveType}</TableCell>
            <TableCell>{item?.total || 0}</TableCell>
            <TableCell>{item?.note || "-"}</TableCell>
            <TableCell>
              {item?.isEditable ? (
                <div
                  onClick={() =>
                    handleAlert(item?._id, "Update", item?.isActive)
                  }
                >
                  <TableStatus isActive={item?.isActive} />
                </div>
              ) : (
                <TableStatus isActive={item?.isActive} />
              )}
            </TableCell>
            <TableCell>{format(new Date(item?.createdAt), "PPP")}</TableCell>
            <TableCell>{format(new Date(item?.updatedAt), "PPP")}</TableCell>
            {item?.isEditable && (
              <TableCell>
                <div className="flex gap-2">
                  <Dialog open={isEdit} onOpenChange={setIsEdit}>
                    <DialogTrigger asChild>
                      <Button
                        onClick={() => handleEdit(item)}
                        variant="outline"
                        size="icon"
                      >
                        <Edit className="text-indigo-600" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-xl max-h-max">
                      <DialogHeader>
                        <DialogTitle>Edit Site</DialogTitle>
                        <DialogDescription>
                          Make changes to here. Click update when you're done.
                        </DialogDescription>
                      </DialogHeader>
                      <EmployeeForm />
                    </DialogContent>
                  </Dialog>
                  <Button
                    onClick={() =>
                      handleAlert(item?._id, "Delete", item?.isActive)
                    }
                    variant="outline"
                    size="icon"
                  >
                    <Trash2 className="text-rose-600" />
                  </Button>
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export default LeaveCategoryTable;

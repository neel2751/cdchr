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

import { format } from "date-fns";
import { Edit, Trash2 } from "lucide-react";
import React from "react";
import { useCommonContext } from "@/context/commonContext";
import EmployeeForm from "../officeEmployee/employeeForm";
import { TableStatus } from "@/components/tableStatus/status";

const CompanyTable = () => {
  const {
    officeEmployeeData: data,
    handleEdit,
    isEdit,
    setIsEdit,
    handleAlert,
  } = useCommonContext();

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {[
              "id",
              "company name",
              "description",
              "status",
              "date",
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
              <TableCell>{item?.name}</TableCell>
              <TableCell>{item?.description || "N/A"}</TableCell>
              <TableCell>
                <div
                  onClick={() =>
                    handleAlert(item?._id, "Update", item?.isActive)
                  }
                >
                  <TableStatus isActive={item?.isActive} />
                </div>
              </TableCell>
              <TableCell>{format(new Date(item?.createdAt), "PPP")}</TableCell>

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
                        <DialogTitle>Edit Company</DialogTitle>
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
};

export default CompanyTable;

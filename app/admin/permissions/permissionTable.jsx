import { Status } from "@/components/tableStatus/status";
import TableHeaderCom from "@/components/tableStatus/tableHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { useCommonContext } from "@/context/commonContext";
import { format } from "date-fns";
import { Edit, Trash2 } from "lucide-react";
import React from "react";
import EmployeeForm from "../officeEmployee/employeeForm";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { COMMONMENUITEMS, MENU } from "@/data/menu";
import { Badge } from "@/components/ui/badge";
import { mergeAndFilterMenus } from "@/lib/object";

const PermissionTable = () => {
  const { result, isEdit, setIsEdit, handleEdit } = useCommonContext();

  const tableHead = [
    "name",
    "Employee",
    "CDC Feature",
    "description",
    "status",
    "report date",
    "actions",
  ];

  return (
    <Table>
      <TableHeaderCom tableHead={tableHead} />
      <TableBody>
        {result?.map((item, index) => (
          <TableRow key={index}>
            <TableCell>{item?.name}</TableCell>
            <TableCell>{item?.result[0]?.name}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                {mergeAndFilterMenus(COMMONMENUITEMS, MENU)
                  .filter((it) => item?.permissions?.includes(it?.path))
                  .map((im) => (
                    <Badge key={im.name} variant="outline">
                      {im?.name}
                    </Badge>
                  ))}
                {/* {MENU.filter((it) => item?.permissions?.includes(it.path)).map(
                  (im) => (
                    <Badge key={im?.name} variant="outline">
                      {im?.name}
                    </Badge>
                  )
                )} */}
              </div>
            </TableCell>
            <TableCell className="cursor-pointer">
              <HoverCard>
                <HoverCardTrigger asChild>
                  <div className="w-40 overflow-hidden truncate">
                    {item?.description}
                  </div>
                </HoverCardTrigger>
                <HoverCardContent>
                  <p className="text-sm text-gray-800 font-medium">
                    {item?.description}
                  </p>
                </HoverCardContent>
              </HoverCard>
            </TableCell>
            <TableCell>
              <Status title={item?.isActive ? "Active" : "Inactive"} />
            </TableCell>
            <TableCell>{format(item?.createdAt, "PPP")}</TableCell>
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
                      <DialogTitle>Edit Role Type</DialogTitle>
                      <DialogDescription>
                        Make changes to here. Click update when you're done.
                      </DialogDescription>
                    </DialogHeader>
                    <EmployeeForm />
                  </DialogContent>
                </Dialog>
                <Button variant="outline" size="icon">
                  <Trash2 className="text-rose-600" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export default PermissionTable;

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

const ReportIssueTable = () => {
  const { result, isEdit, setIsEdit } = useCommonContext();

  const tableHead = [
    "tracking id",
    "Name",
    "title",
    "CDC Feature",
    "description",
    "Type",
    "report date",
    "status",
    "actions",
  ];

  return (
    <Table>
      <TableHeaderCom tableHead={tableHead} />
      <TableBody>
        {result.map((item, index) => (
          <TableRow key={index}>
            <TableCell className="truncate">{item?.trackingId}</TableCell>
            <TableCell>{item?.userId.name}</TableCell>
            <TableCell>{item?.title}</TableCell>
            <TableCell>{item?.issue || "-"}</TableCell>
            <TableCell className="cursor-pointer">
              <HoverCard>
                <HoverCardTrigger asChild>
                  <div className="w-56 overflow-hidden truncate">
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
              <Status title={item.issueType} />
            </TableCell>
            <TableCell>
              {format(item?.startDate ? item?.startDate : new Date(), "PPP")}
            </TableCell>
            <TableCell>
              <Status title={item?.ticketStatus} />
            </TableCell>
            <TableCell>
              {item?.ticketStatus === "Open" && (
                <div className="flex gap-2">
                  <Dialog open={isEdit} onOpenChange={setIsEdit}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="icon">
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
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export default ReportIssueTable;

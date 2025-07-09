import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCommonContext } from "@/context/commonContext";
import React from "react";
import { Status, TableStatus } from "@/components/tableStatus/status";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Edit, Eye, Shield, Trash2 } from "lucide-react";
import EmployeeForm from "../officeEmployee/employeeForm";
import { format } from "date-fns";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { encrypt } from "@/lib/algo";

const SiteAssignTable = () => {
  const { data, handleEdit, isEdit, handleEditClose, handleAlert } =
    useCommonContext();

  const { data: session } = useSession();

  const tabelHead = [
    "id",
    "sitename",
    "assign to",
    "sitestatus",
    "sitetype",
    "status",
    "startDate",
    "endDate",
    "action",
  ];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {tabelHead.map((item, index) => (
            <TableHead className="uppercase text-xs" key={index}>
              {item}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data &&
          data?.map((item, index) => (
            <TableRow key={index}>
              <TableCell>{index + 1}</TableCell>
              <TableCell>{item?.siteName}</TableCell>
              <TableCell>{item?.roleName}</TableCell>
              <TableCell>
                <Status title={item?.siteStatus} />
              </TableCell>
              <TableCell>{item?.siteType}</TableCell>
              <TableCell>
                <div
                  onClick={() =>
                    handleAlert(item?._id, "Update", item?.isActive)
                  }
                >
                  <TableStatus isActive={item?.isActive} />
                </div>
              </TableCell>
              <TableCell>{format(item?.startDate, "PPP") || "-"}</TableCell>
              <TableCell>{format(item?.endDate, "PPP") || "-"}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {(session?.user?.role === "superAdmin" ||
                    session?.user.role === "admin") && (
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleEdit(item)}
                        variant="outline"
                        size="icon"
                      >
                        <Edit className="text-indigo-600" />
                      </Button>
                      <Dialog open={isEdit} onOpenChange={handleEditClose}>
                        <DialogContent className="sm:max-w-xl max-h-max">
                          <DialogHeader>
                            <DialogTitle>Edit Site Assign</DialogTitle>
                            <DialogDescription>
                              Make changes to here. Click update when you're
                              done.
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
                  )}
                  <Button variant="outline" size="icon" asChild>
                    <Link
                      href={`/admin/siteAssign/${encrypt(
                        item?.projectSiteID
                      )}/overview`}
                    >
                      <Eye className="text-indigo-600" />
                    </Link>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
};

export default SiteAssignTable;

import TableHeaderCom from "@/components/tableStatus/tableHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { EditIcon, EyeIcon, Trash2Icon } from "lucide-react";
import React from "react";
import EmailTest from "./emailTest";
import EmailStatus from "./emailStatus";
import Link from "next/link";
import { encrypt } from "@/lib/algo";

export default function EmailTable({ newData, onEdit, queryKey }) {
  const tableHead = [
    "SMTP Host",
    "Port",
    "From Name",
    "Feature",
    "Status",
    "User Name",
    "Password",
    "Actions",
  ];

  return (
    <>
      <Table>
        <TableHeaderCom tableHead={tableHead} />
        <TableBody>
          {newData?.length > 0 ? (
            newData.map((item, index) => (
              <TableRow key={index}>
                <TableCell>{item.host}</TableCell>
                <TableCell>{item.port}</TableCell>
                <TableCell>{item.fromName}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="capitalize">
                    {item?.feature || "General"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <EmailStatus data={item} queryKey={queryKey} />
                </TableCell>
                <TableCell>
                  {item?.userName ? (
                    <Badge variant="secondary">{item?.userName}</Badge>
                  ) : (
                    <Badge variant="destructive">Not Configured</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {item?.password ? (
                    <Badge
                      variant="secondary"
                      className={"bg-green-100 text-green-800"}
                    >
                      Configured
                    </Badge>
                  ) : (
                    <Badge variant="destructive">Not Configured</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="space-x-2">
                    <Button size={"icon"} variant={"outline"} asChild>
                      <Link href={`/admin/email/${encrypt(item?._id)}`}>
                        <EyeIcon />
                      </Link>
                    </Button>
                    <EmailTest data={item} />
                    <Button
                      size={"icon"}
                      variant={"outline"}
                      onClick={() => onEdit(item)}
                    >
                      <EditIcon />
                    </Button>
                    <Button size={"icon"} variant={"outline"}>
                      <Trash2Icon />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={6} className="text-center">
                No SMTP configurations found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </>
  );
}

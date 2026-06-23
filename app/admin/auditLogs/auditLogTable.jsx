"use client";
import TableHeaderCom from "@/components/tableStatus/tableHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  TableRow,
} from "@/components/ui/table";
import { useCommonContext } from "@/context/commonContext";
import { format } from "date-fns";
import { Eye } from "lucide-react";
import React from "react";

const tableHead = [
  "date / time",
  "user",
  "action",
  "module",
  "description",
  "status",
  "details",
];

// Render a value (primitive or object) as a readable string for the diff view.
const show = (value) => {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const AuditLogTable = () => {
  const { result } = useCommonContext();

  return (
    <Table>
      <TableHeaderCom tableHead={tableHead} />
      <TableBody>
        {result?.map((item) => {
          const changeEntries = item?.changes
            ? Object.entries(item.changes)
            : [];
          return (
            <TableRow key={item?._id}>
              <TableCell className="whitespace-nowrap">
                {item?.createdAt
                  ? format(new Date(item.createdAt), "PPp")
                  : "—"}
              </TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium">
                    {item?.actorName || "Unknown"}
                  </span>
                  <span className="text-xs text-gray-500">
                    {item?.actorEmail}
                  </span>
                  {item?.actorRole && (
                    <Badge variant="outline" className="mt-1 w-fit">
                      {item.actorRole}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {item?.action}
              </TableCell>
              <TableCell>{item?.module || "—"}</TableCell>
              <TableCell className="max-w-xs">
                <div className="truncate" title={item?.description}>
                  {item?.description || "—"}
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  className={
                    item?.status === "failure"
                      ? "bg-red-100 text-red-800 hover:bg-red-200"
                      : "bg-green-100 text-green-800 hover:bg-green-200"
                  }
                >
                  {item?.status || "success"}
                </Badge>
              </TableCell>
              <TableCell>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="icon">
                      <Eye className="text-indigo-600" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{item?.action}</DialogTitle>
                      <DialogDescription>
                        {item?.description || "No description"}
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 text-sm">
                      <div className="grid grid-cols-2 gap-2">
                        <Meta label="User" value={item?.actorName} />
                        <Meta label="Email" value={item?.actorEmail} />
                        <Meta label="Role" value={item?.actorRole} />
                        <Meta label="Module" value={item?.module} />
                        <Meta label="Entity ID" value={item?.entityId} />
                        <Meta label="IP" value={item?.ipAddress} />
                        <Meta
                          label="When"
                          value={
                            item?.createdAt
                              ? format(new Date(item.createdAt), "PPpp")
                              : ""
                          }
                        />
                        <Meta label="Status" value={item?.status} />
                      </div>

                      {item?.status === "failure" && item?.errorMessage && (
                        <div className="rounded-md bg-red-50 p-3 text-red-800">
                          {item.errorMessage}
                        </div>
                      )}

                      {changeEntries.length > 0 && (
                        <div>
                          <h4 className="font-medium mb-2">Changes</h4>
                          <div className="rounded-md border divide-y">
                            {changeEntries.map(([field, diff]) => (
                              <div
                                key={field}
                                className="grid grid-cols-3 gap-2 p-2"
                              >
                                <span className="font-medium break-all">
                                  {field}
                                </span>
                                <span className="text-red-700 break-all line-through">
                                  {show(diff?.from)}
                                </span>
                                <span className="text-green-700 break-all">
                                  {show(diff?.to)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Snapshot title="Before" data={item?.before} />
                        <Snapshot title="After" data={item?.after} />
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

const Meta = ({ label, value }) => (
  <div className="flex flex-col">
    <span className="text-xs text-gray-500">{label}</span>
    <span className="break-all">{value ? String(value) : "—"}</span>
  </div>
);

const Snapshot = ({ title, data }) => (
  <div>
    <h4 className="font-medium mb-1">{title}</h4>
    <pre className="rounded-md bg-gray-50 p-2 text-xs overflow-auto max-h-60 whitespace-pre-wrap break-all">
      {data ? JSON.stringify(data, null, 2) : "—"}
    </pre>
  </div>
);

export default AuditLogTable;

"use client";
import React from "react";
import HandleVisitor from "./handleVisitor";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/hooks/use-query";
import { getAllVisitors } from "@/server/visitorServer";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import ViewVisitorHistory from "./viewVisitor";
import SearchDebounce from "@/components/filters/search/search-debounce";
import { PaginationWithLinks } from "@/components/filters/pagination/pagination-client";
import VisitorCount from "./visitorCount";

export default function Visitor({ searchParams }) {
  const [open, setOpen] = React.useState(false);
  const [initialValues, setInitialValues] = React.useState(null);
  const queryKey = ["visitorList", searchParams];
  const { data } = useFetchQuery({
    fetchFn: getAllVisitors,
    queryKey: queryKey,
    params: searchParams,
  });
  const { newData, totalCount } = data || {};

  const handleEdit = (visitor) => {
    setInitialValues(visitor);
    setOpen(true);
  };

  return (
    <div className="p-4">
      <div className="mb-4">
        <VisitorCount />
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Visitors</CardTitle>
              <CardDescription>List of all visitors</CardDescription>
            </div>
            <Button onClick={() => setOpen(true)} className="mb-4">
              Add Visitor
            </Button>
          </div>
          <SearchDebounce />
        </CardHeader>
        <CardContent>
          <VisitorList
            visitors={newData || []}
            handleEdit={handleEdit}
            totalCount={totalCount}
          />
          {totalCount > 10 && (
            <div className="mt-4 border-t pt-4">
              <PaginationWithLinks totalCount={totalCount} />
            </div>
          )}
        </CardContent>
      </Card>
      <HandleVisitor
        open={open}
        onOpenChange={setOpen}
        queryKey={queryKey}
        initialValues={initialValues}
      />
    </div>
  );
}

const VisitorList = ({ visitors, handleEdit }) => {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Visitor Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Phone</TableHead>
          <TableHead>Total Visit</TableHead>
          <TableHead>Purpose</TableHead>
          <TableHead>Check-In Time</TableHead>
          <TableHead>Check-Out Time</TableHead>
          <TableHead>Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {visitors.map((visitor) => (
          <TableRow key={visitor._id}>
            <TableCell>{visitor.visitorName}</TableCell>
            <TableCell>{visitor.visitorEmail}</TableCell>
            <TableCell>{visitor.visitorPhone}</TableCell>
            <TableCell>{visitor.visitorPurpose.length}</TableCell>
            <TableCell>
              {visitor.visitorPurpose[0].visitorPurpose || "N/A"}
            </TableCell>
            <TableCell>
              {visitor.visitorPurpose.some((p) => p.visitorCheckInTime)
                ? new Date(
                    visitor.visitorPurpose[0].visitorCheckInTime
                  ).toLocaleString()
                : "N/A"}
            </TableCell>
            <TableCell>
              {visitor.visitorPurpose.some((p) => p.visitorCheckOutTime)
                ? new Date(
                    visitor.visitorPurpose[0].visitorCheckOutTime
                  ).toLocaleString()
                : "N/A"}
            </TableCell>
            {/* View Option */}
            <TableCell>
              <ViewVisitorHistory visitor={visitor} handleEdit={handleEdit} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

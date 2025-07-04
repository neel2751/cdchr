import { Button } from "@/components/ui/button";
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
import { format } from "date-fns";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import React from "react";

const RecentData = ({ data }) => {
  return (
    <Card className="w-full">
      <CardHeader className="px-7 flex flex-row items-center justify-between">
        <div className="grid gap-2">
          <CardTitle>Attendance</CardTitle>
          <CardDescription>Recent Attendance from you.</CardDescription>
        </div>
        {data?.length > 0 && (
          <Button asChild>
            <Link href="/admin/filterAttendance" className="text-sm">
              <ArrowUpRight className="h-4 w-4" />
              View All
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="hidden sm:table-cell">PayRate</TableHead>
              <TableHead className="hidden sm:table-cell">Hours</TableHead>
              <TableHead className="hidden md:table-cell">Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((item, index) => (
              <TableRow key={index}>
                <TableCell>
                  <div className="font-medium">
                    {item.firstName} {item.lastName}
                  </div>
                  <div className="hidden text-sm text-muted-foreground md:inline">
                    {item.paymentType || "No Type"}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  £{item.payRate.toFixed(2)}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {item.totalHours.toFixed(2)}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {format(new Date(), "PPP")}
                </TableCell>
                <TableCell className="text-right font-medium">
                  £{item.totalPay.toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default RecentData;
